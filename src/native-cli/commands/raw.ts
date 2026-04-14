import { SessionStore } from '../session-store.js';

import { connectManagedChromeBridge } from '../bridge.js';

import { resolveManagedCurrentTab } from './support.js';

import type { BrowserService, CliCommandResult } from '../types.js';

interface RawCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runRawCommand(
  options: RawCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'browser':
      return await runRawBrowserCommand(rest, options);
    case 'cdp':
      return await runRawCdpCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createRawHelpLines(),
      };
    default:
      throw new Error(`Unknown raw command: ${subcommand}`);
  }
}

async function runRawBrowserCommand(
  rawArgs: string[],
  options: RawCommandOptions
): Promise<CliCommandResult> {
  const [method, rawArgsJson, ...rest] = rawArgs;
  if (!method) {
    throw new Error('Usage: chrome-controller raw browser <method> [argsJson]');
  }
  if (rest.length > 0) {
    throw new Error(`Too many arguments for raw browser: ${rest[0]}`);
  }

  const args = rawArgsJson === undefined ? [] : normalizeRawBrowserArgs(rawArgsJson);
  const result = await callRawBrowserMethod(options.browserService, method, args);

  return {
    session: null,
    data: {
      method,
      args,
      result,
    },
    lines: [`Called raw browser method ${method}`],
  };
}

async function runRawCdpCommand(
  rawArgs: string[],
  options: RawCommandOptions
): Promise<CliCommandResult> {
  const [method, rawParamsJson, ...rest] = rawArgs;
  if (!method) {
    throw new Error('Usage: chrome-controller raw cdp <method> [paramsJson]');
  }
  if (rest.length > 0) {
    throw new Error(`Too many arguments for raw cdp: ${rest[0]}`);
  }

  const params = rawParamsJson === undefined ? undefined : parseRawParamsJson(rawParamsJson);
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );

  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve the active session tab for session ${session.id}`);
  }

  const attachResult = await options.browserService.attachDebugger(session, tab.id);

  try {
    const result = await options.browserService.sendDebuggerCommand(
      session,
      tab.id,
      method,
      params
    );

    return {
      session,
      data: {
        tabId: tab.id,
        method,
        ...(params !== undefined ? { params } : {}),
        attached: true,
        alreadyAttached: attachResult.alreadyAttached,
        result,
      },
      lines: [`Called raw CDP method ${method} on tab ${tab.id}`],
    };
  } finally {
    if (!attachResult.alreadyAttached) {
      await options.browserService.detachDebugger(session, tab.id);
    }
  }
}

async function callRawBrowserMethod(
  browserService: BrowserService,
  method: string,
  args: unknown[]
): Promise<unknown> {
  if (typeof browserService.callBrowserMethod === 'function') {
    return await browserService.callBrowserMethod(method, ...args);
  }

  const bridge = await connectManagedChromeBridge({
    launch: true,
  });

  try {
    return await bridge.client.call(method, ...args);
  } finally {
    await bridge.close();
  }
}

function normalizeRawBrowserArgs(rawValue: string): unknown[] {
  const parsed = parseRawJsonValue(rawValue, 'argsJson');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseRawParamsJson(rawValue: string): Record<string, unknown> {
  const parsed = parseRawJsonValue(rawValue, 'paramsJson');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('paramsJson must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function parseRawJsonValue(rawValue: string, name: 'argsJson' | 'paramsJson'): unknown {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${name}: ${message}`);
  }
}

function createRawHelpLines(): string[] {
  return [
    'Raw commands',
    '',
    'Use raw commands only when the opinionated CLI surface cannot do the job.',
    '`raw browser` calls any bridge/browser API method directly.',
    '`raw cdp` sends any Chrome DevTools Protocol command to the active session tab.',
    '',
    'Usage:',
    '  chrome-controller raw browser <method> [argsJson]',
    '  chrome-controller raw cdp <method> [paramsJson]',
    '',
    'Examples:',
    '  chrome-controller raw browser windows.getAll \'[{"populate":true}]\'',
    '  chrome-controller raw browser tabs.query \'[{"active":true}]\'',
    '  chrome-controller raw cdp Runtime.evaluate \'{"expression":"document.title","returnByValue":true}\'',
  ];
}
