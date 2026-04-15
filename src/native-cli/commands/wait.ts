import { SessionStore } from '../session-store.js';

import {
  resolveElementTarget,
  retryDetachedOperation,
  runDomOperation,
  sleep,
} from '../interaction-support.js';
import {
  buildPageStabilityEvaluationCode,
  parsePageStabilityInfo,
  summarizeNetworkEventsForStability,
} from '../wait-support.js';
import { runDownloadsCommand } from './downloads.js';
import { resolveManagedCurrentTab, resolveSession } from './support.js';

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
const DEFAULT_STABLE_QUIET_MS = 500;

export interface TabStabilityResult {
  tabId: number;
  quietMs: number;
  waitedMs: number;
  readyState: string;
  url: string | null;
  domQuietForMs: number;
  networkQuietForMs: number;
  inflightRequests: number;
}

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
    case 'stable':
      return await runWaitStableCommand(rest, options);
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
  const parsed = parseWaitElementArgs(rawArgs);
  const { session, tabId } = await resolveWaitTab(options);
  const target = await resolveElementTarget(options.env, session, tabId, parsed.target);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const state = await retryDetachedOperation(
        `wait element ${target.description}`,
        async () =>
          await runDomOperation(
            options.browserService,
            session,
            tabId,
            target,
            'exists'
          )
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
  const parsed = parseWaitTextArgs(rawArgs);
  const { session, tabId } = await resolveWaitTab(options);
  const target = parsed.target
    ? await resolveElementTarget(options.env, session, tabId, parsed.target)
    : null;

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      if (target) {
        const state = await retryDetachedOperation(
          `wait text ${JSON.stringify(parsed.text)}`,
          async () =>
            await runDomOperation(
              options.browserService,
              session,
              tabId,
              target,
              'text-contains',
              { text: parsed.text }
            )
        );
        return state.value === true;
      }

      const state = (await retryDetachedOperation(
        `wait text ${JSON.stringify(parsed.text)}`,
        async () =>
          await options.browserService.evaluateTab(
            session,
            tabId,
            `(() => {
              const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
              const text = ${JSON.stringify(parsed.text)};
              const haystack = normalize(document.body?.innerText || document.body?.textContent || '');
              return { value: haystack.includes(text) };
            })()`
          )
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
  const parsed = parseWaitUrlArgs(rawArgs);
  const { session, tabId } = await resolveWaitTab(options);

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
  const parsed = parseCommonWaitArgs(rawArgs, 'wait load');
  const { session, tabId } = await resolveWaitTab(options);

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

async function runWaitStableCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseWaitStableArgs(rawArgs);
  const { session, tabId } = await resolveWaitTab(options);
  const stability = await waitForTabStable(options.browserService, session, tabId, {
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
    quietMs: parsed.quietMs,
  });

  return {
    session,
    data: stability,
    lines: [`Tab ${tabId} became stable`],
  };
}

export async function waitForTabStable(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    quietMs?: number;
  } = {}
): Promise<TabStabilityResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_WAIT_POLL_MS;
  const quietMs = options.quietMs ?? DEFAULT_STABLE_QUIET_MS;
  const attachResult = await browserService.attachDebugger(session, tabId);

  let previousNetworkEventCount = 0;
  let lastNetworkActivityAt: number | null = null;
  let lastObservedState: {
    readyState: string;
    url: string | null;
    domQuietForMs: number;
    networkQuietForMs: number;
    inflightRequests: number;
  } | null = null;
  const startedAt = Date.now();

  try {
    await browserService.sendDebuggerCommand(session, tabId, 'Network.enable');
    await browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
      clear: true,
    });

    await waitUntil(
      timeoutMs,
      pollMs,
      async () => {
        const tab = await browserService.getTab(session, tabId);
        const pageState = parsePageStabilityInfo(
          await retryDetachedOperation(
            `wait stable tab ${tabId}`,
            async () =>
              await browserService.evaluateTab(
                session,
                tabId,
                buildPageStabilityEvaluationCode()
              ),
            {
              attempts: 3,
              delayMs: 100,
            }
          )
        );
        const networkEvents = await readStableNetworkEvents(
          browserService,
          session,
          tabId
        );
        const networkState = summarizeNetworkEventsForStability(networkEvents);
        const nowMs = Date.now();

        if (networkState.eventCount > previousNetworkEventCount) {
          lastNetworkActivityAt = nowMs;
        }
        previousNetworkEventCount = networkState.eventCount;

        const networkQuietForMs =
          lastNetworkActivityAt === null ? pageState.quietForMs : nowMs - lastNetworkActivityAt;

        lastObservedState = {
          readyState: pageState.readyState,
          url: pageState.url,
          domQuietForMs: pageState.quietForMs,
          networkQuietForMs,
          inflightRequests: networkState.inflightRequests,
        };

        return (
          tab.status === 'complete' &&
          pageState.readyState === 'complete' &&
          pageState.quietForMs >= quietMs &&
          networkQuietForMs >= quietMs
        );
      },
      `Timed out waiting for tab ${tabId} to become stable`
    );
  } finally {
    if (!attachResult.alreadyAttached) {
      await browserService.detachDebugger(session, tabId);
    }
  }

  return {
    tabId,
    quietMs,
    waitedMs: Date.now() - startedAt,
    readyState: lastObservedState?.readyState ?? 'unknown',
    url: lastObservedState?.url ?? null,
    domQuietForMs: lastObservedState?.domQuietForMs ?? 0,
    networkQuietForMs: lastObservedState?.networkQuietForMs ?? 0,
    inflightRequests: lastObservedState?.inflightRequests ?? 0,
  };
}

async function runWaitIdleCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const [rawMs, ...rest] = rawArgs;
  if (!rawMs) {
    throw new Error('Usage: chrome-controller wait idle <ms>');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for wait idle: ${rest[0]}`);
  }

  const ms = parsePositiveInteger(rawMs, 'ms');

  await sleep(ms);

  return {
    session: null,
    data: {
      ms,
    },
    lines: [`Waited ${ms}ms`],
  };
}

async function runWaitFnCommand(
  rawArgs: string[],
  options: WaitCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseWaitFnArgs(rawArgs);
  const { session, tabId } = await resolveWaitTab(options);

  await waitUntil(
    parsed.timeoutMs,
    parsed.pollMs,
    async () => {
      const result = (await retryDetachedOperation(
        'wait fn condition',
        async () =>
          await options.browserService.evaluateTab(
            session,
            tabId,
            parsed.awaitPromise
              ? `(async () => ({ value: await (${parsed.expression}) }))()`
              : `(() => ({ value: (${parsed.expression}) }))()`,
            {
              ...(parsed.awaitPromise ? { awaitPromise: true } : {}),
            }
          )
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

async function resolveWaitTab(
  options: WaitCommandOptions
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

async function readStableNetworkEvents(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number
) {
  try {
    return await browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
    });
  } catch (error) {
    if (!isMissingDebuggerSession(error)) {
      throw error;
    }

    await browserService.attachDebugger(session, tabId);
    await browserService.sendDebuggerCommand(session, tabId, 'Network.enable');
    await browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
      clear: true,
    });
    return [];
  }
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
      'Usage: chrome-controller wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>]'
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
      'Usage: chrome-controller wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>]'
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
      'Usage: chrome-controller wait url <text> [--timeout-ms <n>] [--poll-ms <n>]'
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
      'Usage: chrome-controller wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>]'
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

function parseWaitStableArgs(args: string[]): {
  timeoutMs: number;
  pollMs: number;
  quietMs: number;
} {
  const parsed = parseCommonWaitArgs(args, 'wait stable');
  let quietMs = DEFAULT_STABLE_QUIET_MS;

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--quiet-ms') {
      const value = parsed.rest[index + 1];
      if (!value) {
        throw new Error('Missing value for --quiet-ms');
      }
      quietMs = parsePositiveInteger(value, '--quiet-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--quiet-ms=')) {
      quietMs = parsePositiveInteger(arg.slice('--quiet-ms='.length), '--quiet-ms');
      continue;
    }

    throw new Error(`Unknown option for wait stable: ${arg}`);
  }

  return {
    timeoutMs: parsed.timeoutMs,
    pollMs: parsed.pollMs,
    quietMs,
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

function isMissingDebuggerSession(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No debugger session');
}

function createWaitHelpLines(): string[] {
  return [
    'Wait commands',
    '',
    "All wait commands except `wait idle` act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab wait commands operate on.',
    '',
    'Usage:',
    '  chrome-controller wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait url <text> [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait load [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait stable [--quiet-ms <n>] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait idle <ms>',
    '  chrome-controller wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller wait download [downloads wait options]',
    '',
    'Notes:',
    '  wait stable defaults to --timeout-ms 30000 --poll-ms 250 --quiet-ms 500, so you usually do not need to pass them.',
    '  Override those flags only for unusually slow pages, very noisy apps, or debugging.',
    '  wait stable tolerates persistent background requests once the DOM and network have been quiet for the requested window.',
  ];
}
