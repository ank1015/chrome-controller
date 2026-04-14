import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CliPartialResultError } from '../command-error.js';
import { SessionStore } from '../session-store.js';

import {
  resolveManagedCurrentTab,
} from './support.js';

import type {
  BrowserService,
  CliCommandResult,
  CliCookieInfo,
  CliStorageArea,
  CliStorageState,
} from '../types.js';

interface StorageCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runStorageCommand(
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'local-get':
      return await runGetStorageCommand('local', rest, options);
    case 'local-set':
      return await runSetStorageCommand('local', rest, options);
    case 'local-clear':
      return await runClearStorageCommand('local', rest, options);
    case 'session-get':
      return await runGetStorageCommand('session', rest, options);
    case 'session-set':
      return await runSetStorageCommand('session', rest, options);
    case 'session-clear':
      return await runClearStorageCommand('session', rest, options);
    case 'state-save':
      return await runStateSaveCommand(rest, options);
    case 'state-load':
      return await runStateLoadCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createStorageHelpLines(),
      };
    default:
      throw new Error(`Unknown storage command: ${subcommand}`);
  }
}

async function runGetStorageCommand(
  area: CliStorageArea,
  rawArgs: string[],
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const args = rawArgs;
  if (args.length > 1) {
    throw new Error(`Too many arguments for storage ${area}-get`);
  }

  const key = args[0];
  const { session, tabId } = await resolveStorageTab(options);

  if (key) {
    const value = await options.browserService.getStorageValue(session, tabId, area, key);
    return {
      session,
      data: {
        tabId,
        area,
        key,
        value,
      },
      lines: [
        value === null
          ? `${area}Storage key ${key} is not set on tab ${tabId}`
          : `${area}Storage key ${key} read from tab ${tabId}`,
      ],
    };
  }

  const items = await options.browserService.getStorageItems(session, tabId, area);

  return {
    session,
    data: {
      tabId,
      area,
      count: Object.keys(items).length,
      items,
    },
    lines: [`Read ${Object.keys(items).length} ${area}Storage entr${Object.keys(items).length === 1 ? 'y' : 'ies'} from tab ${tabId}`],
  };
}

async function runSetStorageCommand(
  area: CliStorageArea,
  rawArgs: string[],
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const [key, value, ...rest] = rawArgs;
  if (!key || value === undefined) {
    throw new Error(`Usage: chrome-controller state ${area} set <key> <value>`);
  }
  if (rest.length > 0) {
    throw new Error(`Too many arguments for storage ${area}-set`);
  }

  const { session, tabId } = await resolveStorageTab(options);
  const storedValue = await options.browserService.setStorageValue(session, tabId, area, key, value);

  return {
    session,
    data: {
      tabId,
      area,
      key,
      value: storedValue,
    },
    lines: [`Set ${area}Storage key ${key} on tab ${tabId}`],
  };
}

async function runClearStorageCommand(
  area: CliStorageArea,
  rawArgs: string[],
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const args = rawArgs;
  if (args.length > 1) {
    throw new Error(`Too many arguments for storage ${area}-clear`);
  }

  const key = args[0];
  const { session, tabId } = await resolveStorageTab(options);
  const outcome = await options.browserService.clearStorage(session, tabId, area, key);

  return {
    session,
    data: {
      tabId,
      area,
      ...(key ? { key } : {}),
      ...outcome,
    },
    lines: [
      key
        ? `Cleared ${area}Storage key ${key} on tab ${tabId}`
        : `Cleared ${outcome.clearedCount} ${area}Storage entr${
            outcome.clearedCount === 1 ? 'y' : 'ies'
          } on tab ${tabId}`,
    ],
  };
}

async function runStateSaveCommand(
  rawArgs: string[],
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const [filePath, ...rest] = rawArgs;
  if (!filePath) {
    throw new Error('Usage: chrome-controller state save <path>');
  }
  if (rest.length > 0) {
    throw new Error(`Too many arguments for storage state-save: ${rest[0]}`);
  }

  const { session, tabId } = await resolveStorageTab(options);
  const state = await options.browserService.captureStorageState(session, tabId);
  const absolutePath = resolve(filePath);
  const snapshot: CliStorageState = {
    ...state,
    savedAt: new Date().toISOString(),
  };

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  return {
    session,
    data: {
      tabId,
      path: absolutePath,
      origin: snapshot.origin,
      url: snapshot.url,
      localCount: Object.keys(snapshot.localStorage).length,
      sessionCount: Object.keys(snapshot.sessionStorage).length,
      cookieCount: snapshot.cookies.length,
    },
    lines: [`Saved storage state from tab ${tabId} to ${absolutePath}`],
  };
}

async function runStateLoadCommand(
  rawArgs: string[],
  options: StorageCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseStateLoadOptions(rawArgs);
  const absolutePath = resolve(parsed.filePath);
  const rawFile = await readFile(absolutePath, 'utf8');
  const state = parseStorageStateFile(rawFile);
  const { session, tabId } = await resolveStorageTab(options);
  const outcome = await options.browserService.applyStorageState(session, tabId, state);

  if (parsed.reload) {
    try {
      await options.browserService.reloadTab(session, tabId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliPartialResultError(message, {
        session,
        data: {
          tabId,
          path: absolutePath,
          ...outcome,
          reloaded: false,
          reloadRequested: true,
          reloadError: message,
        },
        lines: [
          `Loaded storage state into tab ${tabId} from ${absolutePath}`,
          `Reload did not complete for tab ${tabId}`,
        ],
      });
    }
  }

  return {
    session,
    data: {
      tabId,
      path: absolutePath,
      ...outcome,
      reloaded: parsed.reload,
    },
    lines: [
      parsed.reload
        ? `Loaded storage state into tab ${tabId} from ${absolutePath} and reloaded the tab`
        : `Loaded storage state into tab ${tabId} from ${absolutePath}`,
    ],
  };
}

async function resolveStorageTab(
  options: StorageCommandOptions
): Promise<{ session: Awaited<ReturnType<typeof resolveManagedCurrentTab>>['session']; tabId: number }> {
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );

  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve the active session tab for session ${session.id}`);
  }

  return {
    session,
    tabId: tab.id,
  };
}

function parseStateLoadOptions(args: string[]): { filePath: string; reload: boolean } {
  const [filePath, ...rest] = args;
  if (!filePath) {
    throw new Error('Usage: chrome-controller state load <path> [--reload]');
  }

  let reload = false;

  for (const arg of rest) {
    if (arg === '--reload') {
      reload = true;
      continue;
    }

    throw new Error(`Unknown option for storage state-load: ${arg}`);
  }

  return {
    filePath,
    reload,
  };
}

function parseStorageStateFile(rawFile: string): CliStorageState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse storage state file: ${message}`);
  }

  return normalizeStorageState(parsed);
}

function normalizeStorageState(value: unknown): CliStorageState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Storage state file must contain a JSON object');
  }

  const input = value as Record<string, unknown>;
  const version = input.version;
  if (version !== 1) {
    throw new Error(`Unsupported storage state version: ${String(version)}`);
  }

  return {
    version: 1,
    ...(typeof input.savedAt === 'string' ? { savedAt: input.savedAt } : {}),
    url: normalizeNullableString(input.url, 'url'),
    origin: normalizeNullableString(input.origin, 'origin'),
    title: normalizeNullableString(input.title, 'title'),
    localStorage: normalizeStorageRecord(input.localStorage, 'localStorage'),
    sessionStorage: normalizeStorageRecord(input.sessionStorage, 'sessionStorage'),
    cookies: normalizeCookies(input.cookies),
  };
}

function normalizeStorageRecord(value: unknown, fieldName: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const record: Record<string, string> = {};
  for (const [key, itemValue] of Object.entries(value)) {
    if (typeof itemValue !== 'string') {
      throw new Error(`${fieldName}.${key} must be a string`);
    }
    record[key] = itemValue;
  }

  return record;
}

function normalizeCookies(value: unknown): CliCookieInfo[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('cookies must be an array');
  }

  return value.map((cookie, index) => normalizeCookie(cookie, index));
}

function normalizeCookie(value: unknown, index: number): CliCookieInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`cookies[${index}] must be an object`);
  }

  const input = value as Record<string, unknown>;
  if (typeof input.name !== 'string') {
    throw new Error(`cookies[${index}].name must be a string`);
  }
  if (typeof input.value !== 'string') {
    throw new Error(`cookies[${index}].value must be a string`);
  }

  return {
    name: input.name,
    value: input.value,
    domain: normalizeNullableString(input.domain, `cookies[${index}].domain`),
    path: normalizeNullableString(input.path, `cookies[${index}].path`),
    secure: input.secure === true,
    httpOnly: input.httpOnly === true,
    sameSite: normalizeNullableString(input.sameSite, `cookies[${index}].sameSite`),
    expirationDate:
      typeof input.expirationDate === 'number' ? input.expirationDate : null,
    storeId: normalizeNullableString(input.storeId, `cookies[${index}].storeId`),
  };
}

function normalizeNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null`);
  }

  return value;
}

function createStorageHelpLines(): string[] {
  return [
    'Storage commands',
    '',
    "All storage commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab storage commands operate on.',
    '',
    'Usage:',
    '  chrome-controller state local get [key]',
    '  chrome-controller state local set <key> <value>',
    '  chrome-controller state local clear [key]',
    '  chrome-controller state session get [key]',
    '  chrome-controller state session set <key> <value>',
    '  chrome-controller state session clear [key]',
    '  chrome-controller state save <path>',
    '  chrome-controller state load <path> [--reload]',
  ];
}
