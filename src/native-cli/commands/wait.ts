import { SessionStore } from '../session-store.js';

import { resolveElementTarget, runDomOperation, sleep } from '../interaction-support.js';
import { runDownloadsCommand } from './downloads.js';
import { parseOptionalTabFlag, resolveSession, resolveTabId } from './support.js';

import type { BrowserService, CliCommandResult, CliRunOptions } from '../types.js';

interface WaitCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
  env?: CliRunOptions['env'];
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_MS = 250;

export async function runWaitCommand(
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'element':
      return await runWaitElementCommand(rest, options);
    case 'text':
      return await runWaitTextCommand(rest, options);
    case 'url':
      return await runWaitUrlCommand(rest, options);
    case 'load':
      return await runWaitLoadCommand(rest, options);
    case 'idle':
      return await runWaitIdleCommand(rest, options);
    case 'fn':
      return await runWaitFnCommand(rest, options);
    case 'download':
      return await runDownloadsCommand({
        args: ['wait', ...rest],
        explicitSessionId: options.explicitSessionId,
        sessionStore: options.sessionStore,
        browserService: options.browserService,
      });
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createWaitHelpLines(),
      };
    default:
      throw new Error(`Unknown wait command: ${subcommand}`);
  }
}

async function runWaitElementCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait element');
  const parsed = parseWaitElementArgs(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const target = await resolveElementTarget(options.env, session, tabId, parsed.target);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const state = await runDomOperation(
        options.browserService,
        session,
        tabId,
        target,
        'exists'
      );

      switch (parsed.state) {
        case 'attached':
          return state.exists === true;
        case 'hidden':
          return state.exists !== true || state.visible !== true;
        case 'enabled':
          return state.exists === true && state.enabled === true;
        case 'visible':
        default:
          return state.exists === true && state.visible === true;
      }
    },
    `Timed out waiting for element ${target.description} to become ${parsed.state}`
  );

  return {
    session,
    data: {
      tabId,
      target: target.ref ?? target.raw,
      state: parsed.state,
    },
    lines: [`Element ${target.description} is ${parsed.state}`],
  };
}

async function runWaitTextCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait text');
  const parsed = parseWaitTextArgs(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const target = parsed.target
    ? await resolveElementTarget(options.env, session, tabId, parsed.target)
    : null;

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      if (target) {
        const state = await runDomOperation(
          options.browserService,
          session,
          tabId,
          target,
          'text-contains',
          { text: parsed.text }
        );
        return state.value === true;
      }

      const state = (await options.browserService.evaluateTab(
        session,
        tabId,
        `(() => {
          const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
          const text = ${JSON.stringify(parsed.text)};
          const haystack = normalize(document.body?.innerText || document.body?.textContent || '');
          return { value: haystack.includes(text) };
        })()`
      )) as { value?: boolean };
      return state.value === true;
    },
    `Timed out waiting for text ${JSON.stringify(parsed.text)}`
  );

  return {
    session,
    data: {
      tabId,
      text: parsed.text,
      ...(target ? { target: target.ref ?? target.raw } : {}),
    },
    lines: [`Found text ${JSON.stringify(parsed.text)}`],
  };
}

async function runWaitUrlCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait url');
  const parsed = parseWaitUrlArgs(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const tab = await options.browserService.getTab(session, tabId);
      return tab.url?.includes(parsed.urlIncludes) === true;
    },
    `Timed out waiting for url containing ${JSON.stringify(parsed.urlIncludes)}`
  );

  return {
    session,
    data: {
      tabId,
      urlIncludes: parsed.urlIncludes,
    },
    lines: [`URL contains ${JSON.stringify(parsed.urlIncludes)}`],
  };
}

async function runWaitLoadCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait load');
  const parsed = parseCommonWaitArgs(args, 'wait load');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const tab = await options.browserService.getTab(session, tabId);
      return tab.status === 'complete';
    },
    `Timed out waiting for tab ${tabId} to finish loading`
  );

  return {
    session,
    data: {
      tabId,
      loaded: true,
    },
    lines: [`Tab ${tabId} finished loading`],
  };
}

async function runWaitIdleCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait idle');
  const [rawMs, ...rest] = args;
  if (!rawMs) {
    throw new Error('Usage: chrome-controller wait idle <ms> [--tab <id>]');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for wait idle: ${rest[0]}`);
  }

  const ms = parsePositiveInteger(rawMs, 'ms');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId =
    explicitTabId !== undefined
      ? await resolveTabId(options.browserService, session, explicitTabId)
      : undefined;

  await sleep(ms);

  return {
    session,
    data: {
      ms,
      ...(tabId !== undefined ? { tabId } : {}),
    },
    lines: [`Waited ${ms}ms`],
  };
}

async function runWaitFnCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'wait fn');
  const parsed = parseWaitFnArgs(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const result = (await options.browserService.evaluateTab(
        session,
        tabId,
        parsed.awaitPromise
          ? `(async () => ({ value: await (${parsed.expression}) }))()`
          : `(() => ({ value: (${parsed.expression}) }))()`,
        {
          ...(parsed.awaitPromise ? { awaitPromise: true } : {}),
        }
      )) as { value?: unknown };
      return Boolean(result.value);
    },
    'Timed out waiting for function condition'
  );

  return {
    session,
    data: {
      tabId,
      expression: parsed.expression,
    },
    lines: ['Function condition matched'],
  };
}

async function waitUntil(
  timeoutMs: number,
  pollMs: number,
  condition: () => Promise<boolean>,
  timeoutMessage: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await sleep(pollMs);
  }

  throw new Error(timeoutMessage);
}

function parseWaitElementArgs(args: string[]): {
  target: string;
  state: 'visible' | 'attached' | 'hidden' | 'enabled';
  timeoutMs: number;
  pollMs: number;
} {
  const [target, ...rest] = args;
  if (!target) {
    throw new Error(
      'Usage: chrome-controller wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]'
    );
  }

  const parsed = parseCommonWaitArgs(rest, 'wait element');
  let state: 'visible' | 'attached' | 'hidden' | 'enabled' = 'visible';

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--state') {
      const value = parsed.rest[index + 1];
      if (!value) {
        throw new Error('Missing value for --state');
      }
      state = parseElementWaitState(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--state=')) {
      state = parseElementWaitState(arg.slice('--state='.length));
      continue;
    }

    throw new Error(`Unknown option for wait element: ${arg}`);
  }

  return {
    target,
    state,
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
  };
}

function parseWaitTextArgs(args: string[]): {
  text: string;
  target?: string;
  timeoutMs: number;
  pollMs: number;
} {
  const [text, ...rest] = args;
  if (!text) {
    throw new Error(
      'Usage: chrome-controller wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]'
    );
  }

  const parsed = parseCommonWaitArgs(rest, 'wait text');
  let target: string | undefined;

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--target') {
      const value = parsed.rest[index + 1];
      if (!value) {
        throw new Error('Missing value for --target');
      }
      target = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length);
      continue;
    }

    throw new Error(`Unknown option for wait text: ${arg}`);
  }

  return {
    text,
    ...(target ? { target } : {}),
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
  };
}

function parseWaitUrlArgs(args: string[]): {
  urlIncludes: string;
  timeoutMs: number;
  pollMs: number;
} {
  const [urlIncludes, ...rest] = args;
  if (!urlIncludes) {
    throw new Error(
      'Usage: chrome-controller wait url <text> [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]'
    );
  }

  const parsed = parseCommonWaitArgs(rest, 'wait url');
  if (parsed.rest.length > 0) {
    throw new Error(`Unknown option for wait url: ${parsed.rest[0]}`);
  }

  return {
    urlIncludes,
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
  };
}

function parseWaitFnArgs(args: string[]): {
  expression: string;
  timeoutMs: number;
  pollMs: number;
  awaitPromise: boolean;
} {
  const [expression, ...rest] = args;
  if (!expression) {
    throw new Error(
      'Usage: chrome-controller wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]'
    );
  }

  const parsed = parseCommonWaitArgs(rest, 'wait fn');
  let awaitPromise = false;

  for (const arg of parsed.rest) {
    if (arg === '--await-promise') {
      awaitPromise = true;
      continue;
    }

    throw new Error(`Unknown option for wait fn: ${arg}`);
  }

  return {
    expression,
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
    awaitPromise,
  };
}

function parseCommonWaitArgs(
  args: string[],
  commandName: string
): {
  timeoutMs: number;
  pollMs: number;
  rest: string[];
} {
  const rest: string[] = [];
  let timeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  let pollMs = DEFAULT_WAIT_POLL_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--timeout-ms') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --timeout-ms');
      }
      timeoutMs = parsePositiveInteger(value, '--timeout-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }
    if (arg === '--poll-ms') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --poll-ms');
      }
      pollMs = parsePositiveInteger(value, '--poll-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--poll-ms=')) {
      pollMs = parsePositiveInteger(arg.slice('--poll-ms='.length), '--poll-ms');
      continue;
    }

    rest.push(arg);
  }

  return {
    timeoutMs,
    pollMs,
    rest,
  };
}

function parseElementWaitState(value: string): 'visible' | 'attached' | 'hidden' | 'enabled' {
  if (value === 'visible' || value === 'attached' || value === 'hidden' || value === 'enabled') {
    return value;
  }

  throw new Error(`Invalid wait element state: ${value}`);
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value for ${name}: ${value}`);
  }

  return parsed;
}

function createWaitHelpLines(): string[] {
  return [
    'Wait commands',
    '',
    'Usage:',
    '  chrome-controller wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]',
    '  chrome-controller wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]',
    '  chrome-controller wait url <text> [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]',
    '  chrome-controller wait load [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]',
    '  chrome-controller wait idle <ms> [--tab <id>]',
    '  chrome-controller wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]',
    '  chrome-controller wait download [downloads wait options]',
  ];
}
