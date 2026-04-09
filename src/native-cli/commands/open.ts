import { CliPartialResultError } from '../command-error.js';
import { SessionStore } from '../session-store.js';

import { openTabWithSettle } from './tabs.js';
import { parsePositiveInteger, resolveSession } from './support.js';
import { waitForTabStable } from './wait.js';

import type {
  BrowserService,
  CliCommandResult,
  CliOpenTabOptions,
  CliSessionRecord,
  CliTabInfo,
} from '../types.js';

interface OpenCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

interface ParsedOpenCommandArgs {
  openOptions: CliOpenTabOptions;
  ready: boolean;
  timeoutMs?: number;
  pollMs?: number;
  quietMs?: number;
}

export async function runOpenCommand(
  options: OpenCommandOptions
): Promise<CliCommandResult> {
  if (isHelpRequest(options.args)) {
    return {
      lines: createOpenHelpLines(),
    };
  }

  const parsed = parseOpenCommandArgs(options.args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const { tab: openedTab, createdNewTab, reusedExistingTab } = await openTabWithSettle(
    options.browserService,
    session,
    parsed.openOptions
  );

  if (typeof openedTab.id !== 'number') {
    throw new Error('Could not resolve opened tab id');
  }

  const updatedSession = await options.sessionStore.setTargetTab(session.id, openedTab.id);
  let stability: Awaited<ReturnType<typeof waitForTabStable>> | null = null;
  let readyError: string | null = null;

  if (parsed.ready) {
    try {
      stability = await waitForTabStable(options.browserService, updatedSession, openedTab.id, {
        ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
        ...(parsed.pollMs !== undefined ? { pollMs: parsed.pollMs } : {}),
        ...(parsed.quietMs !== undefined ? { quietMs: parsed.quietMs } : {}),
      });
    } catch (error) {
      readyError = getErrorMessage(error);
    }
  }

  const ready = parsed.ready && readyError === null;
  let tab: CliTabInfo;

  try {
    tab = await options.browserService.getTab(updatedSession, openedTab.id);
  } catch (error) {
    throw new CliPartialResultError(getErrorMessage(error), {
      session: updatedSession,
      data: {
        sessionId: updatedSession.id,
        windowId: openedTab.windowId,
        tabId: openedTab.id,
        url: openedTab.url,
        title: openedTab.title,
        ready,
        readyRequested: parsed.ready,
        targetTabId: updatedSession.targetTabId,
        createdNewTab,
        reusedExistingTab,
        tab: openedTab,
        ...(stability ? { stability } : {}),
        ...(readyError ? { readyError } : {}),
      },
      lines: [
        `Pinned target tab ${openedTab.id} for session ${updatedSession.id}`,
      ],
    });
  }

  return {
    session: updatedSession,
    data: {
      sessionId: updatedSession.id,
      windowId: tab.windowId,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      ready,
      readyRequested: parsed.ready,
      targetTabId: updatedSession.targetTabId,
      createdNewTab,
      reusedExistingTab,
      tab,
      ...(stability ? { stability } : {}),
      ...(readyError ? { readyError } : {}),
    },
    lines: createOpenResultLines(updatedSession, tab, {
      ready,
      readyRequested: parsed.ready,
      readyError,
      reusedExistingTab,
    }),
  };
}

function isHelpRequest(args: string[]): boolean {
  return args.length === 1 && ['help', '--help', '-h'].includes(args[0] ?? '');
}

function parseOpenCommandArgs(args: string[]): ParsedOpenCommandArgs {
  let url: string | null = null;
  let ready = false;
  let timeoutMs: number | undefined;
  let pollMs: number | undefined;
  let quietMs: number | undefined;
  const openOptions: Omit<CliOpenTabOptions, 'url'> = {
    active: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('-') && url === null) {
      url = arg;
      continue;
    }

    if (arg === '--url') {
      url = readRequiredOptionValue(args, index, '--url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
      continue;
    }

    if (arg === '--window') {
      openOptions.windowId = parsePositiveInteger(
        readRequiredOptionValue(args, index, '--window'),
        '--window'
      );
      index += 1;
      continue;
    }

    if (arg.startsWith('--window=')) {
      openOptions.windowId = parsePositiveInteger(arg.slice('--window='.length), '--window');
      continue;
    }

    if (arg === '--active' || arg.startsWith('--active=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--active');
      openOptions.active = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--pinned' || arg.startsWith('--pinned=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--pinned');
      openOptions.pinned = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--ready') {
      ready = true;
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
      pollMs = parsePositiveInteger(
        readRequiredOptionValue(args, index, '--poll-ms'),
        '--poll-ms'
      );
      index += 1;
      continue;
    }

    if (arg.startsWith('--poll-ms=')) {
      pollMs = parsePositiveInteger(arg.slice('--poll-ms='.length), '--poll-ms');
      continue;
    }

    if (arg === '--quiet-ms') {
      quietMs = parsePositiveInteger(
        readRequiredOptionValue(args, index, '--quiet-ms'),
        '--quiet-ms'
      );
      index += 1;
      continue;
    }

    if (arg.startsWith('--quiet-ms=')) {
      quietMs = parsePositiveInteger(arg.slice('--quiet-ms='.length), '--quiet-ms');
      continue;
    }

    throw new Error(`Unknown option for open: ${arg}`);
  }

  if (!url) {
    throw new Error(
      'Usage: chrome-controller open <url> [--window <id>] [--active[=<bool>]] [--pinned[=<bool>]] [--ready] [--timeout-ms <n>] [--poll-ms <n>] [--quiet-ms <n>]'
    );
  }

  return {
    openOptions: {
      ...openOptions,
      url,
    },
    ready,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(pollMs !== undefined ? { pollMs } : {}),
    ...(quietMs !== undefined ? { quietMs } : {}),
  };
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function readBooleanFlag(
  args: string[],
  index: number,
  flagName: string
): { value: boolean; consumedNextArgument: boolean } {
  const arg = args[index] ?? '';
  if (arg.startsWith(`${flagName}=`)) {
    return {
      value: parseBoolean(arg.slice(flagName.length + 1), flagName),
      consumedNextArgument: false,
    };
  }

  const nextValue = args[index + 1];
  if (nextValue === 'true' || nextValue === 'false') {
    return {
      value: parseBoolean(nextValue, flagName),
      consumedNextArgument: true,
    };
  }

  return {
    value: true,
    consumedNextArgument: false,
  };
}

function parseBoolean(rawValue: string, flagName: string): boolean {
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean value for ${flagName}: ${rawValue}`);
}

function createOpenHelpLines(): string[] {
  return [
    'Open command',
    '',
    'Usage:',
    '  chrome-controller open <url> [--window <id>] [--active[=<bool>]] [--pinned[=<bool>]] [--ready] [--timeout-ms <n>] [--poll-ms <n>] [--quiet-ms <n>]',
    '',
    'Notes:',
    '  Opens a tab or reuses an existing exact URL match, pins it as the session target tab, and can wait for stable readiness.',
    '  This command defaults to --active=false so later commands can stay pinned to the chosen tab without stealing focus.',
    '  If --ready cannot confirm stability, the tab still opens and stays pinned. JSON output includes ready=false and readyError.',
  ];
}

function createOpenResultLines(
  session: CliSessionRecord,
  tab: CliTabInfo,
  options: {
    ready: boolean;
    readyRequested: boolean;
    readyError: string | null;
    reusedExistingTab: boolean;
  }
): string[] {
  const lines = [
    `${options.reusedExistingTab ? 'Reused' : 'Opened'} ${formatTabSummary(tab)}`,
    `Pinned target tab ${tab.id ?? 'unknown'} for session ${session.id}`,
  ];

  if (options.readyRequested && options.ready && typeof tab.id === 'number') {
    lines.push(`Tab ${tab.id} became stable`);
  }

  if (options.readyRequested && options.readyError) {
    lines.push(`Ready check did not complete: ${options.readyError}`);
  }

  if (tab.title) {
    lines.push(`Title: ${tab.title}`);
  }

  if (tab.url) {
    lines.push(`URL: ${tab.url}`);
  }

  return lines;
}

function formatTabSummary(tab: CliTabInfo): string {
  const parts = [`tab ${tab.id ?? 'unknown'}`];

  if (tab.windowId !== null) {
    parts.push(`window=${tab.windowId}`);
  }

  if (tab.title) {
    parts.push(JSON.stringify(tab.title));
  }

  if (tab.url) {
    parts.push(tab.url);
  }

  return parts.join(' ');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
