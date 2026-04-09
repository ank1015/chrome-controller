import { SessionStore } from '../session-store.js';

import { parsePositiveInteger, resolveSession } from './support.js';

import type {
  BrowserService,
  CliCommandResult,
  CliDownloadInfo,
  CliDownloadsFilter,
} from '../types.js';

interface DownloadsCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

const DEFAULT_DOWNLOADS_LIMIT = 50;

export async function runDownloadsCommand(
  options: DownloadsCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListDownloadsCommand(rest, options);
    case 'wait':
      return await runWaitForDownloadCommand(rest, options);
    case 'cancel':
      return await runCancelDownloadsCommand(rest, options);
    case 'erase':
      return await runEraseDownloadsCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createDownloadsHelpLines(),
      };
    default:
      throw new Error(`Unknown downloads command: ${subcommand}`);
  }
}

async function runListDownloadsCommand(
  args: string[],
  options: DownloadsCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseDownloadsQueryOptions(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const downloads = await options.browserService.listDownloads(session, parsed.filter);
  const limitedDownloads = downloads.slice(0, parsed.limit);

  return {
    session,
    data: {
      filter: parsed.filter,
      count: limitedDownloads.length,
      totalCount: downloads.length,
      truncated: limitedDownloads.length < downloads.length,
      downloads: limitedDownloads,
    },
    lines: [`Listed ${limitedDownloads.length}/${downloads.length} download${downloads.length === 1 ? '' : 's'}`],
  };
}

async function runWaitForDownloadCommand(
  args: string[],
  options: DownloadsCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseDownloadsWaitOptions(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const download = await options.browserService.waitForDownload(session, parsed.filter, {
    timeoutMs: parsed.timeoutMs,
    pollIntervalMs: parsed.pollIntervalMs,
    requireComplete: parsed.requireComplete,
  });

  return {
    session,
    data: {
      filter: parsed.filter,
      download,
    },
    lines: [`Matched download ${formatDownloadId(download)}`],
  };
}

async function runCancelDownloadsCommand(
  args: string[],
  options: DownloadsCommandOptions
): Promise<CliCommandResult> {
  const downloadIds = parseDownloadIds(args, 'cancel');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  await options.browserService.cancelDownloads(session, downloadIds);

  return {
    session,
    data: {
      downloadIds,
      cancelled: true,
    },
    lines: [`Cancelled ${downloadIds.length} download${downloadIds.length === 1 ? '' : 's'}`],
  };
}

async function runEraseDownloadsCommand(
  args: string[],
  options: DownloadsCommandOptions
): Promise<CliCommandResult> {
  const downloadIds = parseDownloadIds(args, 'erase');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  await options.browserService.eraseDownloads(session, downloadIds);

  return {
    session,
    data: {
      downloadIds,
      erased: true,
    },
    lines: [`Erased ${downloadIds.length} download${downloadIds.length === 1 ? '' : 's'}`],
  };
}

function parseDownloadsQueryOptions(args: string[]): {
  filter: CliDownloadsFilter;
  limit: number;
} {
  let limit = DEFAULT_DOWNLOADS_LIMIT;
  const filter: CliDownloadsFilter = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--id') {
      filter.id = parsePositiveInteger(requireOptionValue(args, index, '--id'), '--id');
      index += 1;
      continue;
    }
    if (arg.startsWith('--id=')) {
      filter.id = parsePositiveInteger(arg.slice('--id='.length), '--id');
      continue;
    }
    if (arg === '--state') {
      filter.state = requireOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    if (arg.startsWith('--state=')) {
      filter.state = arg.slice('--state='.length);
      continue;
    }
    if (arg === '--filename-includes') {
      filter.filenameIncludes = requireOptionValue(args, index, '--filename-includes');
      index += 1;
      continue;
    }
    if (arg.startsWith('--filename-includes=')) {
      filter.filenameIncludes = arg.slice('--filename-includes='.length);
      continue;
    }
    if (arg === '--url-includes') {
      filter.urlIncludes = requireOptionValue(args, index, '--url-includes');
      index += 1;
      continue;
    }
    if (arg.startsWith('--url-includes=')) {
      filter.urlIncludes = arg.slice('--url-includes='.length);
      continue;
    }
    if (arg === '--mime') {
      filter.mimeType = requireOptionValue(args, index, '--mime');
      index += 1;
      continue;
    }
    if (arg.startsWith('--mime=')) {
      filter.mimeType = arg.slice('--mime='.length);
      continue;
    }
    if (arg === '--limit') {
      limit = parsePositiveInteger(requireOptionValue(args, index, '--limit'), '--limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    throw new Error(`Unknown option for downloads command: ${arg}`);
  }

  return {
    filter,
    limit,
  };
}

function parseDownloadsWaitOptions(args: string[]): {
  filter: CliDownloadsFilter;
  timeoutMs?: number;
  pollIntervalMs?: number;
  requireComplete: boolean;
} {
  const queryArgs: string[] = [];
  let timeoutMs: number | undefined;
  let pollIntervalMs: number | undefined;
  let requireComplete = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--timeout-ms') {
      timeoutMs = parsePositiveInteger(requireOptionValue(args, index, '--timeout-ms'), '--timeout-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }
    if (arg === '--poll-ms') {
      pollIntervalMs = parsePositiveInteger(requireOptionValue(args, index, '--poll-ms'), '--poll-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--poll-ms=')) {
      pollIntervalMs = parsePositiveInteger(arg.slice('--poll-ms='.length), '--poll-ms');
      continue;
    }
    if (arg === '--allow-incomplete') {
      requireComplete = false;
      continue;
    }

    queryArgs.push(arg);
    const nextArg = args[index + 1];
    if (
      [
        '--id',
        '--state',
        '--filename-includes',
        '--url-includes',
        '--mime',
        '--limit',
      ].includes(arg) &&
      nextArg
    ) {
      queryArgs.push(nextArg);
      index += 1;
    }
  }

  const parsed = parseDownloadsQueryOptions(queryArgs);

  return {
    filter: parsed.filter,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    requireComplete,
  };
}

function parseDownloadIds(args: string[], commandName: string): number[] {
  if (args.length === 0) {
    throw new Error(
      `Usage: chrome-controller downloads ${commandName} <downloadId...>`
    );
  }

  return args.map((arg) => parsePositiveInteger(arg, 'downloadId'));
}

function requireOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function formatDownloadId(download: CliDownloadInfo): string {
  return download.id === null ? 'unknown' : String(download.id);
}

function createDownloadsHelpLines(): string[] {
  return [
    'Downloads commands',
    '',
    'Usage:',
    '  chrome-controller downloads list [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--limit <n>]',
    '  chrome-controller downloads wait [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--timeout-ms <n>] [--poll-ms <n>] [--allow-incomplete]',
    '  chrome-controller downloads cancel <downloadId...>',
    '  chrome-controller downloads erase <downloadId...>',
  ];
}
