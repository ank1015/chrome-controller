import { SessionStore } from '../session-store.js';

import { CONSOLE_EVENT_PREFIXES, toConsoleEntries } from '../console-utils.js';

import {
  parsePositiveInteger,
  resolveManagedCurrentTab,
  resolveSession,
} from './support.js';

import type { BrowserService, CliCommandResult } from '../types.js';

interface ConsoleCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

const DEFAULT_CONSOLE_LIMIT = 50;
const DEFAULT_TAIL_TIMEOUT_MS = 5_000;
const DEFAULT_TAIL_POLL_MS = 250;

export async function runConsoleCommand(
  options: ConsoleCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListConsoleCommand(rest, options);
    case 'tail':
      return await runTailConsoleCommand(rest, options);
    case 'clear':
      return await runClearConsoleCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createConsoleHelpLines(),
      };
    default:
      throw new Error(`Unknown console command: ${subcommand}`);
  }
}

async function runListConsoleCommand(
  rawArgs: string[],
  options: ConsoleCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseConsoleListOptions(rawArgs);
  const { session, tabId } = await resolveConsoleTab(options);
  await ensureConsoleMonitoring(options.browserService, session, tabId);

  const allEntries = await readConsoleEntries(options.browserService, session, tabId);
  const entries = tailEntries(allEntries, parsed.limit);

  if (parsed.clear) {
    await clearConsoleEntries(options.browserService, session, tabId);
  }

  return {
    session,
    data: {
      tabId,
      count: entries.length,
      totalCount: allEntries.length,
      truncated: entries.length < allEntries.length,
      cleared: parsed.clear,
      entries,
    },
    lines: [`Read ${entries.length}/${allEntries.length} console entr${allEntries.length === 1 ? 'y' : 'ies'} from tab ${tabId}`],
  };
}

async function runTailConsoleCommand(
  rawArgs: string[],
  options: ConsoleCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseConsoleTailOptions(rawArgs);
  const { session, tabId } = await resolveConsoleTab(options);
  await ensureConsoleMonitoring(options.browserService, session, tabId);

  const baseline = await readConsoleEntries(options.browserService, session, tabId);
  const startedAt = Date.now();
  const deadline = startedAt + parsed.timeoutMs;

  while (Date.now() < deadline) {
    await sleep(parsed.pollMs);
    const current = await readConsoleEntries(options.browserService, session, tabId);
    if (current.length > baseline.length) {
      const newEntries = tailEntries(current.slice(baseline.length), parsed.limit);
      return {
        session,
        data: {
          tabId,
          count: newEntries.length,
          timedOut: false,
          waitedMs: Date.now() - startedAt,
          entries: newEntries,
        },
        lines: [`Received ${newEntries.length} new console entr${newEntries.length === 1 ? 'y' : 'ies'} from tab ${tabId}`],
      };
    }
  }

  return {
    session,
    data: {
      tabId,
      count: 0,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      entries: [],
    },
    lines: [`No new console entries arrived for tab ${tabId}`],
  };
}

async function runClearConsoleCommand(
  rawArgs: string[],
  options: ConsoleCommandOptions
): Promise<CliCommandResult> {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option for console clear: ${rawArgs[0]}`);
  }

  const { session, tabId } = await resolveConsoleTab(options);
  await ensureConsoleMonitoring(options.browserService, session, tabId);
  const clearedCount = await clearConsoleEntries(options.browserService, session, tabId);

  return {
    session,
    data: {
      tabId,
      clearedCount,
    },
    lines: [`Cleared ${clearedCount} console entr${clearedCount === 1 ? 'y' : 'ies'} from tab ${tabId}`],
  };
}

async function ensureConsoleMonitoring(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number
): Promise<void> {
  await browserService.attachDebugger(session, tabId);
  await browserService.sendDebuggerCommand(session, tabId, 'Runtime.enable');
  await browserService.sendDebuggerCommand(session, tabId, 'Log.enable');
}

async function readConsoleEntries(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number
) {
  const events = await browserService.getDebuggerEvents(session, tabId);
  return toConsoleEntries(events);
}

async function clearConsoleEntries(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number
): Promise<number> {
  let clearedCount = 0;

  for (const prefix of CONSOLE_EVENT_PREFIXES) {
    const cleared = await browserService.getDebuggerEvents(session, tabId, {
      filter: prefix,
      clear: true,
    });
    clearedCount += cleared.length;
  }

  return clearedCount;
}

async function resolveConsoleTab(
  options: ConsoleCommandOptions
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

function parseConsoleListOptions(args: string[]): { limit: number; clear: boolean } {
  let limit = DEFAULT_CONSOLE_LIMIT;
  let clear = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--limit') {
      limit = parsePositiveInteger(readRequiredOptionValue(args, index, '--limit'), '--limit');
      index += 1;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg === '--clear') {
      clear = true;
      continue;
    }

    throw new Error(`Unknown option for console list: ${arg}`);
  }

  return { limit, clear };
}

function parseConsoleTailOptions(args: string[]): {
  limit: number;
  timeoutMs: number;
  pollMs: number;
} {
  let limit = DEFAULT_CONSOLE_LIMIT;
  let timeoutMs = DEFAULT_TAIL_TIMEOUT_MS;
  let pollMs = DEFAULT_TAIL_POLL_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--limit') {
      limit = parsePositiveInteger(readRequiredOptionValue(args, index, '--limit'), '--limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = parsePositiveInteger(
        readRequiredOptionValue(args, index, '--timeout-ms'),
        '--timeout-ms'
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }
    if (arg === '--poll-ms') {
      pollMs = parsePositiveInteger(readRequiredOptionValue(args, index, '--poll-ms'), '--poll-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--poll-ms=')) {
      pollMs = parsePositiveInteger(arg.slice('--poll-ms='.length), '--poll-ms');
      continue;
    }

    throw new Error(`Unknown option for console tail: ${arg}`);
  }

  return { limit, timeoutMs, pollMs };
}

function tailEntries<T>(entries: T[], limit: number): T[] {
  if (entries.length <= limit) {
    return entries;
  }

  return entries.slice(entries.length - limit);
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createConsoleHelpLines(): string[] {
  return [
    'Console commands',
    '',
    "All console commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab console commands operate on.',
    '',
    'Usage:',
    '  chrome-controller observe console list [--limit <n>] [--clear]',
    '  chrome-controller observe console tail [--limit <n>] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller observe console clear',
  ];
}
