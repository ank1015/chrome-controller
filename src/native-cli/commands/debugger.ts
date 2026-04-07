import { SessionStore } from '../session-store.js';

import { parseJsonObject, parseOptionalTabFlag, parsePositiveInteger, resolveSession, resolveTabId } from './support.js';

import type { BrowserService, CliCommandResult, CliDebuggerEvent } from '../types.js';

interface DebuggerCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

const DEFAULT_EVENTS_LIMIT = 50;

export async function runDebuggerCommand(
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'attach':
      return await runAttachCommand(rest, options);
    case 'detach':
      return await runDetachCommand(rest, options);
    case 'cmd':
      return await runCmdCommand(rest, options);
    case 'events':
      return await runEventsCommand(rest, options);
    case 'clear-events':
      return await runClearEventsCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createDebuggerHelpLines(),
      };
    default:
      throw new Error(`Unknown debugger command: ${subcommand}`);
  }
}

async function runAttachCommand(
  rawArgs: string[],
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'debugger attach');
  if (args.length > 0) {
    throw new Error(`Unknown argument for debugger attach: ${args[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const result = await options.browserService.attachDebugger(session, tabId);

  return {
    session,
    data: {
      tabId,
      ...result,
    },
    lines: [
      result.alreadyAttached
        ? `Debugger already attached to tab ${tabId}`
        : `Attached debugger to tab ${tabId}`,
    ],
  };
}

async function runDetachCommand(
  rawArgs: string[],
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'debugger detach');
  if (args.length > 0) {
    throw new Error(`Unknown argument for debugger detach: ${args[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const result = await options.browserService.detachDebugger(session, tabId);

  return {
    session,
    data: {
      tabId,
      ...result,
    },
    lines: [`Detached debugger from tab ${tabId}`],
  };
}

async function runCmdCommand(
  rawArgs: string[],
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'debugger cmd');
  const parsed = parseCmdOptions(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const result = await options.browserService.sendDebuggerCommand(
    session,
    tabId,
    parsed.method,
    parsed.params
  );

  return {
    session,
    data: {
      tabId,
      method: parsed.method,
      result,
    },
    lines: [`Sent ${parsed.method} to tab ${tabId}`],
  };
}

async function runEventsCommand(
  rawArgs: string[],
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'debugger events');
  const parsed = parseEventsOptions(args, 'debugger events');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const events = await options.browserService.getDebuggerEvents(session, tabId, {
    ...(parsed.filter ? { filter: parsed.filter } : {}),
    ...(parsed.clear ? { clear: true } : {}),
  });
  const limitedEvents = limitEvents(events, parsed.limit);

  return {
    session,
    data: {
      tabId,
      filter: parsed.filter ?? null,
      count: limitedEvents.length,
      totalCount: events.length,
      truncated: limitedEvents.length < events.length,
      cleared: parsed.clear,
      events: limitedEvents,
    },
    lines: [
      formatEventsSummaryLine(tabId, limitedEvents.length, events.length, parsed.filter, parsed.clear),
    ],
  };
}

async function runClearEventsCommand(
  rawArgs: string[],
  options: DebuggerCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'debugger clear-events');
  const parsed = parseEventsOptions(args, 'debugger clear-events', {
    allowLimit: false,
    allowClear: false,
  });
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const clearedEvents = await options.browserService.getDebuggerEvents(session, tabId, {
    ...(parsed.filter ? { filter: parsed.filter } : {}),
    clear: true,
  });

  return {
    session,
    data: {
      tabId,
      filter: parsed.filter ?? null,
      clearedCount: clearedEvents.length,
    },
    lines: [
      `Cleared ${clearedEvents.length} debugger event${
        clearedEvents.length === 1 ? '' : 's'
      } from tab ${tabId}`,
    ],
  };
}

function parseCmdOptions(args: string[]): {
  method: string;
  params?: Record<string, unknown>;
} {
  const [method, ...rest] = args;
  if (!method) {
    throw new Error('Missing CDP method. Usage: chrome-controller debugger cmd <method>');
  }

  let params: Record<string, unknown> | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === '--params-json') {
      const value = rest[index + 1];
      if (!value) {
        throw new Error('Missing value for --params-json');
      }
      params = parseJsonObject(value, '--params-json');
      index += 1;
      continue;
    }

    if (arg.startsWith('--params-json=')) {
      params = parseJsonObject(arg.slice('--params-json='.length), '--params-json');
      continue;
    }

    throw new Error(`Unknown option for debugger cmd: ${arg}`);
  }

  return {
    method,
    ...(params ? { params } : {}),
  };
}

function parseEventsOptions(
  args: string[],
  commandName: string,
  config: { allowLimit?: boolean; allowClear?: boolean } = {}
): {
  filter?: string;
  limit: number;
  clear: boolean;
} {
  const allowLimit = config.allowLimit !== false;
  const allowClear = config.allowClear !== false;
  let filter: string | undefined;
  let limit = DEFAULT_EVENTS_LIMIT;
  let clear = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--filter') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --filter');
      }
      filter = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--filter=')) {
      filter = arg.slice('--filter='.length);
      continue;
    }

    if (allowLimit && arg === '--limit') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --limit');
      }
      limit = parsePositiveInteger(value, '--limit');
      index += 1;
      continue;
    }

    if (allowLimit && arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (allowClear && arg === '--clear') {
      clear = true;
      continue;
    }

    throw new Error(`Unknown option for ${commandName}: ${arg}`);
  }

  return {
    ...(filter ? { filter } : {}),
    limit,
    clear,
  };
}

function limitEvents(events: CliDebuggerEvent[], limit: number): CliDebuggerEvent[] {
  if (events.length <= limit) {
    return events;
  }

  return events.slice(events.length - limit);
}

function formatEventsSummaryLine(
  tabId: number,
  count: number,
  totalCount: number,
  filter?: string,
  cleared = false
): string {
  const scope = filter ? ` filter=${filter}` : '';
  const clearSuffix = cleared ? ' and cleared them' : '';
  return `Read ${count}/${totalCount} debugger event${totalCount === 1 ? '' : 's'} from tab ${tabId}${scope}${clearSuffix}`;
}

function createDebuggerHelpLines(): string[] {
  return [
    'Debugger commands',
    '',
    'Usage:',
    '  chrome-controller debugger attach [--tab <id>]',
    '  chrome-controller debugger detach [--tab <id>]',
    '  chrome-controller debugger cmd <method> [--params-json <json>] [--tab <id>]',
    '  chrome-controller debugger events [--filter <prefix>] [--limit <n>] [--clear] [--tab <id>]',
    '  chrome-controller debugger clear-events [--filter <prefix>] [--tab <id>]',
    '',
    'Notes:',
    '  When --tab is omitted, the current active tab in the current window is used.',
  ];
}
