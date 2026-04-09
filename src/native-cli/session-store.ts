import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  CliSessionRecord,
  SessionResolutionResult,
  SessionStoreOptions,
  SessionWithCurrentFlag,
} from './types.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GENERATED_SESSION_ID_PATTERN = /^s(\d+)$/;
const CURRENT_SESSION_FILENAME = 'current-session.json';
const SESSIONS_DIRECTORY_NAME = 'sessions';
const JSON_READ_RETRY_COUNT = 3;
const JSON_READ_RETRY_DELAY_MS = 5;

interface CurrentSessionPointer {
  id: string;
}

export class SessionStore {
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => Date;

  constructor(options: SessionStoreOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => new Date());
  }

  get homeDir(): string {
    return getChromeControllerHome(this.#env);
  }

  get sessionsDir(): string {
    return join(this.homeDir, SESSIONS_DIRECTORY_NAME);
  }

  get currentSessionPath(): string {
    return join(this.homeDir, CURRENT_SESSION_FILENAME);
  }

  async createSession(id?: string): Promise<CliSessionRecord> {
    await this.ensureStorage();

    const sessionId = id ? normalizeSessionId(id) : await this.generateSessionId();
    const existing = await this.getSession(sessionId);
    if (existing) {
      throw new Error(`Session "${sessionId}" already exists`);
    }

    const timestamp = this.#now().toISOString();
    const session: CliSessionRecord = {
      id: sessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
      targetTabId: null,
    };

    await this.writeSession(session);
    await this.writeCurrentSession({ id: session.id });
    return session;
  }

  async ensureCurrentSession(): Promise<SessionResolutionResult> {
    const currentSession = await this.getCurrentSession();
    if (currentSession) {
      const session = await this.touchSession(currentSession.id);
      return {
        session,
        created: false,
        source: 'current',
      };
    }

    const session = await this.createSession();
    return {
      session,
      created: true,
      source: 'created',
    };
  }

  async resolveSession(explicitSessionId?: string | null): Promise<SessionResolutionResult> {
    if (explicitSessionId) {
      const session = await this.getSession(normalizeSessionId(explicitSessionId));
      if (!session) {
        throw new Error(`Session "${explicitSessionId}" does not exist`);
      }

      return {
        session: await this.touchSession(session.id),
        created: false,
        source: 'explicit',
      };
    }

    return await this.ensureCurrentSession();
  }

  async useSession(id: string): Promise<CliSessionRecord> {
    const sessionId = normalizeSessionId(id);
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" does not exist`);
    }

    await this.writeCurrentSession({ id: sessionId });
    return await this.touchSession(sessionId);
  }

  async getSession(id: string): Promise<CliSessionRecord | null> {
    const sessionId = normalizeSessionId(id);
    const filePath = this.getSessionPath(sessionId);
    const session = await readJsonFile<CliSessionRecord>(filePath);
    if (!session) {
      return null;
    }

    return normalizeStoredSession(session, sessionId);
  }

  async getCurrentSessionId(): Promise<string | null> {
    const pointer = await readJsonFile<CurrentSessionPointer>(this.currentSessionPath);
    if (!pointer?.id || !isValidSessionId(pointer.id)) {
      await this.clearCurrentSession();
      return null;
    }

    return pointer.id;
  }

  async getCurrentSession(): Promise<CliSessionRecord | null> {
    const currentSessionId = await this.getCurrentSessionId();
    if (!currentSessionId) {
      return null;
    }

    const session = await this.getSession(currentSessionId);
    if (!session) {
      await this.clearCurrentSession();
      return null;
    }

    return session;
  }

  async listSessions(): Promise<SessionWithCurrentFlag[]> {
    await this.ensureStorage();

    const currentSessionId = await this.getCurrentSessionId();
    const entryNames = await readdir(this.sessionsDir);
    const sessions = await Promise.all(
      entryNames
        .filter((entryName) => entryName.endsWith('.json'))
        .map(async (entryName) => {
          const sessionId = entryName.slice(0, -'.json'.length);
          return await this.getSession(sessionId);
        })
    );

    return sessions
      .filter((session): session is CliSessionRecord => session !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        ...session,
        current: session.id === currentSessionId,
      }));
  }

  async closeSession(id: string): Promise<{
    closed: boolean;
    session: CliSessionRecord | null;
    wasCurrent: boolean;
  }> {
    const sessionId = normalizeSessionId(id);
    const session = await this.getSession(sessionId);
    if (!session) {
      return {
        closed: false,
        session: null,
        wasCurrent: false,
      };
    }

    const wasCurrent = (await this.getCurrentSessionId()) === sessionId;
    await rm(this.getSessionPath(sessionId), { force: true });
    if (wasCurrent) {
      await this.clearCurrentSession();
    }

    return {
      closed: true,
      session,
      wasCurrent,
    };
  }

  async closeCurrentSession(): Promise<{
    closed: boolean;
    session: CliSessionRecord | null;
    wasCurrent: boolean;
  }> {
    const currentSession = await this.getCurrentSession();
    if (!currentSession) {
      return {
        closed: false,
        session: null,
        wasCurrent: false,
      };
    }

    return await this.closeSession(currentSession.id);
  }

  async closeAllSessions(): Promise<{ closedSessions: CliSessionRecord[] }> {
    const sessions = await this.listSessions();
    await Promise.all(sessions.map((session) => rm(this.getSessionPath(session.id), { force: true })));
    await this.clearCurrentSession();
    return {
      closedSessions: sessions.map(({ current, ...session }) => session),
    };
  }

  async clearCurrentSession(): Promise<void> {
    await rm(this.currentSessionPath, { force: true });
  }

  async ensureStorage(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  async touchSession(id: string): Promise<CliSessionRecord> {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session "${id}" does not exist`);
    }

    const timestamp = this.#now().toISOString();
    const updatedSession: CliSessionRecord = {
      ...session,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    };

    await this.writeSession(updatedSession);
    return updatedSession;
  }

  async writeSession(session: CliSessionRecord): Promise<void> {
    await this.ensureStorage();
    await writeJsonFile(this.getSessionPath(session.id), session);
  }

  async setTargetTab(id: string, targetTabId: number): Promise<CliSessionRecord> {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session "${id}" does not exist`);
    }

    return await this.writeUpdatedSession(session, {
      targetTabId: normalizeTargetTabId(targetTabId),
    });
  }

  async clearTargetTab(id: string): Promise<CliSessionRecord> {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session "${id}" does not exist`);
    }

    return await this.writeUpdatedSession(session, {
      targetTabId: null,
    });
  }

  async writeCurrentSession(pointer: CurrentSessionPointer): Promise<void> {
    await this.ensureStorage();
    await writeJsonFile(this.currentSessionPath, pointer);
  }

  getSessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  async generateSessionId(): Promise<string> {
    await this.ensureStorage();

    const entryNames = await readdir(this.sessionsDir);
    let maxId = 0;

    for (const entryName of entryNames) {
      if (!entryName.endsWith('.json')) {
        continue;
      }

      const sessionId = entryName.slice(0, -'.json'.length);
      const match = GENERATED_SESSION_ID_PATTERN.exec(sessionId);
      if (!match) {
        continue;
      }

      const numericId = Number.parseInt(match[1] ?? '0', 10);
      if (Number.isFinite(numericId)) {
        maxId = Math.max(maxId, numericId);
      }
    }

    return `s${maxId + 1}`;
  }

  private async writeUpdatedSession(
    session: CliSessionRecord,
    updates: Partial<CliSessionRecord>
  ): Promise<CliSessionRecord> {
    const timestamp = this.#now().toISOString();
    const updatedSession: CliSessionRecord = {
      ...session,
      ...updates,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    };

    await this.writeSession(updatedSession);
    return updatedSession;
  }
}

export function getChromeControllerHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicitHome = env.CHROME_CONTROLLER_HOME?.trim();
  if (explicitHome) {
    return resolve(explicitHome);
  }

  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) {
    return resolve(join(xdgStateHome, 'chrome-controller'));
  }

  const home = env.HOME?.trim() || homedir();
  if (home) {
    return resolve(join(home, '.chrome-controller'));
  }

  return resolve(join(tmpdir(), 'chrome-controller'));
}

export function normalizeSessionId(id: string): string {
  const normalized = id.trim();
  if (!isValidSessionId(normalized)) {
    throw new Error(
      'Invalid session id. Use 1-64 characters from letters, numbers, ".", "_" or "-".'
    );
  }

  return normalized;
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

function normalizeStoredSession(session: CliSessionRecord, fallbackId: string): CliSessionRecord {
  const id = session.id?.trim() || fallbackId;
  if (!isValidSessionId(id)) {
    throw new Error(`Stored session "${fallbackId}" is invalid`);
  }

  return {
    id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastUsedAt: session.lastUsedAt,
    targetTabId: normalizeStoredTargetTabId((session as Partial<CliSessionRecord>).targetTabId),
  };
}

function normalizeStoredTargetTabId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeTargetTabId(value);
}

function normalizeTargetTabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Stored target tab id is invalid: ${String(value)}`);
  }

  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt <= JSON_READ_RETRY_COUNT; attempt += 1) {
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      if (
        attempt < JSON_READ_RETRY_COUNT &&
        isRetryableJsonReadError(error)
      ) {
        await sleep(JSON_READ_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      throw error;
    }
  }

  return null;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;

  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isRetryableJsonReadError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
