import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { SessionStore } from '../session-store.js';

import { buildHar, findNetworkRequest, summarizeNetwork, summarizeNetworkRequests } from '../network-utils.js';

import { parseOptionalTabFlag, parsePositiveInteger, resolveSession, resolveTabId } from './support.js';

import type { BrowserService, CliCommandResult, CliDebuggerEvent } from '../types.js';

interface NetworkCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

const DEFAULT_NETWORK_LIMIT = 50;

export async function runNetworkCommand(
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'start':
      return await runStartNetworkCommand(rest, options);
    case 'stop':
      return await runStopNetworkCommand(rest, options);
    case 'list':
      return await runListNetworkCommand(rest, options);
    case 'get':
      return await runGetNetworkRequestCommand(rest, options);
    case 'summary':
      return await runSummaryNetworkCommand(rest, options);
    case 'clear':
      return await runClearNetworkCommand(rest, options);
    case 'export-har':
      return await runExportHarCommand(rest, options);
    case 'block':
      return await runBlockNetworkCommand(rest, options);
    case 'unblock':
      return await runUnblockNetworkCommand(rest, options);
    case 'offline':
      return await runOfflineNetworkCommand(rest, options);
    case 'throttle':
      return await runThrottleNetworkCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createNetworkHelpLines(),
      };
    default:
      throw new Error(`Unknown network command: ${subcommand}`);
  }
}

async function runStartNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network start');
  const parsed = parseStartNetworkOptions(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const attachResult = await ensureNetworkMonitoring(
    options.browserService,
    session,
    tabId,
    parsed
  );

  return {
    session,
    data: {
      tabId,
      attached: attachResult.attached,
      alreadyAttached: attachResult.alreadyAttached,
      cleared: parsed.clear,
      disableCache: parsed.disableCache,
    },
    lines: [`Started network capture on tab ${tabId}`],
  };
}

async function runStopNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network stop');
  if (args.length > 0) {
    throw new Error(`Unknown option for network stop: ${args[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  try {
    await options.browserService.sendDebuggerCommand(session, tabId, 'Network.disable');
    return {
      session,
      data: {
        tabId,
        stopped: true,
      },
      lines: [`Stopped network capture on tab ${tabId}`],
    };
  } catch (error) {
    if (isMissingDebuggerSession(error)) {
      return {
        session,
        data: {
          tabId,
          stopped: false,
          alreadyStopped: true,
        },
        lines: [`Network capture was not running on tab ${tabId}`],
      };
    }

    throw error;
  }
}

async function runListNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network list');
  const parsed = parseNetworkListOptions(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const events = await readNetworkEvents(options.browserService, session, tabId);
  const requests = filterNetworkRequests(summarizeNetworkRequests(events), parsed);
  const limitedRequests = requests.slice(0, parsed.limit);

  return {
    session,
    data: {
      tabId,
      count: limitedRequests.length,
      totalCount: requests.length,
      truncated: limitedRequests.length < requests.length,
      requests: limitedRequests,
    },
    lines: [`Listed ${limitedRequests.length}/${requests.length} network request${requests.length === 1 ? '' : 's'} on tab ${tabId}`],
  };
}

async function runGetNetworkRequestCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network get');
  const [requestId, ...rest] = args;
  if (!requestId) {
    throw new Error('Usage: chrome-controller network get <requestId> [--tab <id>]');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for network get: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const events = await readNetworkEvents(options.browserService, session, tabId);
  const result = findNetworkRequest(events, requestId);

  if (!result.request) {
    throw new Error(`Network request ${requestId} was not found on tab ${tabId}`);
  }

  return {
    session,
    data: {
      tabId,
      request: result.request,
      events: result.events,
    },
    lines: [`Loaded network request ${requestId} from tab ${tabId}`],
  };
}

async function runSummaryNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network summary');
  if (args.length > 0) {
    throw new Error(`Unknown option for network summary: ${args[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const events = await readNetworkEvents(options.browserService, session, tabId);
  const requests = summarizeNetworkRequests(events);
  const summary = summarizeNetwork(events, requests);

  return {
    session,
    data: {
      tabId,
      summary,
    },
    lines: [`Summarized ${requests.length} network request${requests.length === 1 ? '' : 's'} on tab ${tabId}`],
  };
}

async function runClearNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network clear');
  if (args.length > 0) {
    throw new Error(`Unknown option for network clear: ${args[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  try {
    const cleared = await options.browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
      clear: true,
    });
    return {
      session,
      data: {
        tabId,
        clearedCount: cleared.length,
      },
      lines: [`Cleared ${cleared.length} network event${cleared.length === 1 ? '' : 's'} from tab ${tabId}`],
    };
  } catch (error) {
    if (isMissingDebuggerSession(error)) {
      return {
        session,
        data: {
          tabId,
          clearedCount: 0,
        },
        lines: [`No network events were stored for tab ${tabId}`],
      };
    }

    throw error;
  }
}

async function runExportHarCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network export-har');
  const [filePath, ...rest] = args;
  if (!filePath) {
    throw new Error('Usage: chrome-controller network export-har <path> [--tab <id>]');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for network export-har: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const events = await readNetworkEvents(options.browserService, session, tabId);
  const har = buildHar(events);
  const absolutePath = resolve(filePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(har, null, 2)}\n`, 'utf8');

  return {
    session,
    data: {
      tabId,
      path: absolutePath,
      entryCount: (har.log as { entries: unknown[] }).entries.length,
    },
    lines: [`Exported HAR for tab ${tabId} to ${absolutePath}`],
  };
}

async function runBlockNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network block');
  if (args.length === 0) {
    throw new Error('Usage: chrome-controller network block <pattern...> [--tab <id>]');
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  await ensureNetworkMonitoring(options.browserService, session, tabId, {});
  await options.browserService.sendDebuggerCommand(session, tabId, 'Network.setBlockedURLs', {
    urls: args,
  });

  return {
    session,
    data: {
      tabId,
      patterns: args,
    },
    lines: [`Blocked ${args.length} network pattern${args.length === 1 ? '' : 's'} on tab ${tabId}`],
  };
}

async function runUnblockNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network unblock');
  if (args.length > 0) {
    throw new Error('network unblock does not take patterns; it clears all blocked URLs');
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  await ensureNetworkMonitoring(options.browserService, session, tabId, {});
  await options.browserService.sendDebuggerCommand(session, tabId, 'Network.setBlockedURLs', {
    urls: [],
  });

  return {
    session,
    data: {
      tabId,
      cleared: true,
    },
    lines: [`Cleared blocked network URLs on tab ${tabId}`],
  };
}

async function runOfflineNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network offline');
  const [state, ...rest] = args;
  if (!state || rest.length > 0 || !['on', 'off'].includes(state)) {
    throw new Error('Usage: chrome-controller network offline <on|off> [--tab <id>]');
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  await ensureNetworkMonitoring(options.browserService, session, tabId, {});
  await options.browserService.sendDebuggerCommand(
    session,
    tabId,
    'Network.emulateNetworkConditions',
    state === 'on'
      ? {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        }
      : {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        }
  );

  return {
    session,
    data: {
      tabId,
      offline: state === 'on',
    },
    lines: [`Turned ${state === 'on' ? 'on' : 'off'} offline mode for tab ${tabId}`],
  };
}

async function runThrottleNetworkCommand(
  rawArgs: string[],
  options: NetworkCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'network throttle');
  const [preset, ...rest] = args;
  if (!preset || rest.length > 0) {
    throw new Error('Usage: chrome-controller network throttle <slow-3g|fast-3g|slow-4g|off> [--tab <id>]');
  }

  const config = getThrottlePreset(preset);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  await ensureNetworkMonitoring(options.browserService, session, tabId, {});
  await options.browserService.sendDebuggerCommand(
    session,
    tabId,
    'Network.emulateNetworkConditions',
    config
  );

  return {
    session,
    data: {
      tabId,
      preset,
    },
    lines: [`Applied network throttle preset ${preset} to tab ${tabId}`],
  };
}

async function ensureNetworkMonitoring(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number,
  options: { clear?: boolean; disableCache?: boolean }
) {
  const attachResult = await browserService.attachDebugger(session, tabId);
  if (options.clear) {
    await browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
      clear: true,
    });
  }
  await browserService.sendDebuggerCommand(session, tabId, 'Network.enable');
  if (options.disableCache) {
    await browserService.sendDebuggerCommand(session, tabId, 'Network.setCacheDisabled', {
      cacheDisabled: true,
    });
  }

  return attachResult;
}

async function readNetworkEvents(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  tabId: number
): Promise<CliDebuggerEvent[]> {
  try {
    return await browserService.getDebuggerEvents(session, tabId, {
      filter: 'Network.',
    });
  } catch (error) {
    if (isMissingDebuggerSession(error)) {
      throw new Error(`No network capture for tab ${tabId}. Call network start first.`);
    }

    throw error;
  }
}

function parseStartNetworkOptions(args: string[]): { clear: boolean; disableCache: boolean } {
  let clear = true;
  let disableCache = false;

  for (const arg of args) {
    if (arg === '--no-clear') {
      clear = false;
      continue;
    }
    if (arg === '--disable-cache') {
      disableCache = true;
      continue;
    }

    throw new Error(`Unknown option for network start: ${arg}`);
  }

  return { clear, disableCache };
}

function parseNetworkListOptions(args: string[]): {
  limit: number;
  urlIncludes?: string;
  status?: number;
  failed: boolean;
} {
  let limit = DEFAULT_NETWORK_LIMIT;
  let urlIncludes: string | undefined;
  let status: number | undefined;
  let failed = false;

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
    if (arg === '--url-includes') {
      urlIncludes = readRequiredOptionValue(args, index, '--url-includes');
      index += 1;
      continue;
    }
    if (arg.startsWith('--url-includes=')) {
      urlIncludes = arg.slice('--url-includes='.length);
      continue;
    }
    if (arg === '--status') {
      status = parsePositiveInteger(readRequiredOptionValue(args, index, '--status'), '--status');
      index += 1;
      continue;
    }
    if (arg.startsWith('--status=')) {
      status = parsePositiveInteger(arg.slice('--status='.length), '--status');
      continue;
    }
    if (arg === '--failed') {
      failed = true;
      continue;
    }

    throw new Error(`Unknown option for network list: ${arg}`);
  }

  return {
    limit,
    ...(urlIncludes ? { urlIncludes } : {}),
    ...(status !== undefined ? { status } : {}),
    failed,
  };
}

function filterNetworkRequests(
  requests: ReturnType<typeof summarizeNetworkRequests>,
  options: ReturnType<typeof parseNetworkListOptions>
) {
  return requests.filter((request) => {
    if (options.urlIncludes && !request.url.includes(options.urlIncludes)) {
      return false;
    }
    if (options.status !== undefined && request.status !== options.status) {
      return false;
    }
    if (options.failed && !request.failed) {
      return false;
    }

    return true;
  });
}

function getThrottlePreset(
  preset: string
): {
  offline: boolean;
  latency: number;
  downloadThroughput: number;
  uploadThroughput: number;
} {
  switch (preset) {
    case 'slow-3g':
      return {
        offline: false,
        latency: 400,
        downloadThroughput: 50 * 1024,
        uploadThroughput: 50 * 1024,
      };
    case 'fast-3g':
      return {
        offline: false,
        latency: 150,
        downloadThroughput: 200 * 1024,
        uploadThroughput: 96 * 1024,
      };
    case 'slow-4g':
      return {
        offline: false,
        latency: 120,
        downloadThroughput: 500 * 1024,
        uploadThroughput: 375 * 1024,
      };
    case 'off':
      return {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      };
    default:
      throw new Error(
        `Unknown throttle preset: ${preset}. Use slow-3g, fast-3g, slow-4g, or off.`
      );
  }
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function isMissingDebuggerSession(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No debugger session');
}

function createNetworkHelpLines(): string[] {
  return [
    'Network commands',
    '',
    'Usage:',
    '  chrome-controller network start [--no-clear] [--disable-cache] [--tab <id>]',
    '  chrome-controller network stop [--tab <id>]',
    '  chrome-controller network list [--limit <n>] [--url-includes <text>] [--status <code>] [--failed] [--tab <id>]',
    '  chrome-controller network get <requestId> [--tab <id>]',
    '  chrome-controller network summary [--tab <id>]',
    '  chrome-controller network clear [--tab <id>]',
    '  chrome-controller network export-har <path> [--tab <id>]',
    '  chrome-controller network block <pattern...> [--tab <id>]',
    '  chrome-controller network unblock [--tab <id>]',
    '  chrome-controller network offline <on|off> [--tab <id>]',
    '  chrome-controller network throttle <slow-3g|fast-3g|slow-4g|off> [--tab <id>]',
    '',
    'Notes:',
    '  Call network start before listing, summarizing, or exporting captured requests.',
  ];
}
