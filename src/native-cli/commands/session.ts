import { SessionStore } from '../session-store.js';
import { createManagedSessionWindow, ensureSessionWindow } from './support.js';

import type { BrowserService, CliCommandResult, CliSessionRecord } from '../types.js';

interface SessionCommandOptions {
  args: string[];
  json: boolean;
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runSessionCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'info', ...rest] = options.args;

  switch (subcommand) {
    case 'create':
      return await runCreateSessionCommand(rest, options);
    case 'info':
      return await runInfoSessionCommand(rest, options);
    case 'list':
      return await runListSessionsCommand(options);
    case 'use':
      return await runUseSessionCommand(rest, options);
    case 'close':
      return await runCloseSessionCommand(rest, options);
    case 'reset':
      return await runResetSessionCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createSessionHelpLines(),
      };
    default:
      throw new Error(`Unknown session command: ${subcommand}`);
  }
}

async function runCreateSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = resolveCreateSessionId(args, options.explicitSessionId);
  if (sessionId) {
    const existingSession = await options.sessionStore.getSession(sessionId);
    if (existingSession) {
      throw createExistingSessionCreateError(existingSession.id);
    }
  }

  let createdSession: CliSessionRecord;
  try {
    createdSession = await options.sessionStore.createSession(sessionId ?? undefined);
  } catch (error) {
    if (sessionId && isExistingSessionCreateError(error)) {
      throw createExistingSessionCreateError(sessionId);
    }
    throw error;
  }

  let session: CliSessionRecord;
  try {
    const window = await createManagedSessionWindow(options.browserService, createdSession);
    if (typeof window.id !== 'number') {
      throw new Error(`Could not create a managed window for session ${createdSession.id}`);
    }

    session = await options.sessionStore.setWindow(createdSession.id, window.id);
  } catch (error) {
    await options.sessionStore.closeSession(createdSession.id);
    throw error;
  }

  return {
    session,
    data: {
      session,
      created: true,
      windowId: session.windowId,
    },
    lines: [`Created session ${session.id} window=${session.windowId ?? 'none'}`],
  };
}

function resolveCreateSessionId(
  args: string[],
  explicitSessionId?: string
): string | null {
  const requestedId = readOptionalFlagValue(args, '--id');

  if (
    requestedId &&
    explicitSessionId &&
    normalizeSessionIdForComparison(requestedId) !==
      normalizeSessionIdForComparison(explicitSessionId)
  ) {
    throw new Error(
      `Conflicting session ids provided: --id ${requestedId} and --session ${explicitSessionId}`
    );
  }

  return requestedId ?? explicitSessionId ?? null;
}

async function runInfoSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const session = await resolveSessionForInfo(args, options);
  if (!session) {
    return {
      session: null,
      data: {
        session: null,
      },
      lines: ['No current session'],
    };
  }

  return {
    session,
    data: {
      session,
    },
    lines: createSessionDetailLines(session.id, session),
  };
}

async function runListSessionsCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessions = await options.sessionStore.listSessions();
  if (sessions.length === 0) {
    return {
      data: {
        sessions: [],
        currentSessionId: null,
      },
      lines: ['No sessions found'],
    };
  }

  const currentSession = sessions.find((session) => session.current) ?? null;
  return {
    session: currentSession,
    data: {
      sessions,
      currentSessionId: currentSession?.id ?? null,
    },
    lines: createSessionListLines(sessions),
  };
}

async function runUseSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = args[0];
  if (!sessionId) {
    throw new Error('Missing session id. Usage: chrome-controller session use <id>');
  }

  await options.sessionStore.useSession(sessionId);
  const storedSession = await options.sessionStore.getSession(sessionId);
  if (!storedSession) {
    throw new Error(`Session "${sessionId}" does not exist`);
  }

  const session = await ensureSessionWindow(
    options.sessionStore,
    options.browserService,
    storedSession
  );
  return {
    session,
    data: {
      session,
    },
    lines: [`Current session set to ${session.id} window=${session.windowId ?? 'none'}`],
  };
}

async function runCloseSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = args[0] ?? options.explicitSessionId ?? null;
  const session = sessionId
    ? await options.sessionStore.getSession(sessionId)
    : await options.sessionStore.getCurrentSession();

  let windowClosed = false;
  let closedWindowId: number | null = session?.windowId ?? null;
  if (session && typeof session.windowId === 'number') {
    try {
      await options.browserService.closeWindow(session, session.windowId);
      windowClosed = true;
    } catch {
      windowClosed = false;
    }
  }

  const outcome = sessionId
    ? await options.sessionStore.closeSession(sessionId)
    : await options.sessionStore.closeCurrentSession();

  return {
    data: {
      closed: outcome.closed,
      wasCurrent: outcome.wasCurrent,
      session: outcome.session,
      windowClosed,
      closedWindowId,
    },
    lines: [
      outcome.closed && outcome.session
        ? `Closed session ${outcome.session.id}${
            closedWindowId !== null ? ` window=${closedWindowId}` : ''
          }`
        : sessionId
          ? `Session "${sessionId}" was not found`
          : 'No current session to close',
    ],
  };
}

async function runResetSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const storedSession = await resolveRequiredSession(args, options);

  if (typeof storedSession.windowId === 'number') {
    try {
      await options.browserService.closeWindow(storedSession, storedSession.windowId);
    } catch {
      // Reset should still proceed when the managed window was already closed.
    }
  }

  const clearedSession = await options.sessionStore.clearWindow(storedSession.id, {
    clearTargetTab: true,
  });
  const recreatedWindow = await createManagedSessionWindow(options.browserService, clearedSession);
  if (typeof recreatedWindow.id !== 'number') {
    throw new Error(`Could not recreate a managed window for session ${clearedSession.id}`);
  }

  const session = await options.sessionStore.setWindow(clearedSession.id, recreatedWindow.id, {
    clearTargetTab: true,
  });

  return {
    session,
    data: {
      session,
      reset: true,
      windowId: session.windowId,
    },
    lines: [`Reset session ${session.id} window=${session.windowId ?? 'none'}`],
  };
}

function readOptionalFlagValue(args: string[], flagName: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(`Missing value for ${flagName}`);
      }
      return nextValue;
    }

    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }

  return null;
}

function createExistingSessionCreateError(sessionId: string): Error {
  return new Error(
    `Session "${sessionId}" already exists. Use "chrome-controller session use ${sessionId}" to switch to it or "chrome-controller session reset ${sessionId}" to recreate its managed window.`
  );
}

function isExistingSessionCreateError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('already exists');
}

function createSessionHelpLines(): string[] {
  return [
    'Session commands',
    '',
    'Usage:',
    '  chrome-controller session create [--id <id>]',
    '  chrome-controller session create --session <id>',
    '  chrome-controller session info [<id>]',
    '  chrome-controller session list',
    '  chrome-controller session use <id>',
    '  chrome-controller session close [<id>]',
    '  chrome-controller session reset [<id>]',
  ];
}

function normalizeSessionIdForComparison(value: string): string {
  return value.trim();
}

function createSessionDetailLines(
  id: string,
  session: {
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string;
    windowId: number | null;
    targetTabId: number | null;
  }
): string[] {
  return [
    `Session ${id}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    `Last used: ${session.lastUsedAt}`,
    `Window: ${session.windowId ?? 'none'}`,
    `Current tab: ${session.targetTabId ?? 'none'}`,
  ];
}

function createSessionListLines(
  sessions: Array<{
    id: string;
    current: boolean;
    updatedAt: string;
    windowId: number | null;
    targetTabId: number | null;
  }>
): string[] {
  const lines = ['Sessions'];

  for (const session of sessions) {
    lines.push(
      `${session.current ? '*' : ' '} ${session.id}  updated=${session.updatedAt}  window=${
        session.windowId ?? 'none'
      }  currentTab=${session.targetTabId ?? 'none'}`
    );
  }

  return lines;
}

async function resolveSessionForInfo(
  args: string[],
  options: SessionCommandOptions
): Promise<CliSessionRecord | null> {
  const sessionId = args[0] ?? options.explicitSessionId;
  if (sessionId) {
    const session = await options.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" does not exist`);
    }

    return await ensureSessionWindow(options.sessionStore, options.browserService, session);
  }

  const session = await options.sessionStore.getCurrentSession();
  if (!session) {
    return null;
  }

  return await ensureSessionWindow(options.sessionStore, options.browserService, session);
}

async function resolveRequiredSession(
  args: string[],
  options: SessionCommandOptions
): Promise<CliSessionRecord> {
  const sessionId = args[0] ?? options.explicitSessionId;
  if (sessionId) {
    const session = await options.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" does not exist`);
    }

    return session;
  }

  const currentSession = await options.sessionStore.getCurrentSession();
  if (!currentSession) {
    throw new Error('No current session');
  }

  return currentSession;
}
