import type {
  BrowserService,
  CliCommandResult,
  CliCreateWindowOptions,
  CliSessionRecord,
  CliWindowTabInfo,
  CliWindowInfo,
} from '../types.js';
import { SessionStore } from '../session-store.js';
import { resolveSession as resolveManagedSession } from './support.js';

interface WindowsCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

interface CliWindowListItem {
  id: number | null;
  focused: boolean;
  state: string | null;
  type: string | null;
  tabCount: number;
  tabs: CliWindowTabInfo[];
}

export async function runWindowsCommand(
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'list', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListWindowsCommand(options);
    case 'current':
      return await runCurrentWindowCommand(options);
    case 'get':
      return await runGetWindowCommand(rest, options);
    case 'create':
      return await runCreateWindowCommand(rest, options);
    case 'focus':
      return await runFocusWindowCommand(rest, options);
    case 'close':
      return await runCloseWindowCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createWindowsHelpLines(),
      };
    default:
      throw new Error(`Unknown windows command: ${subcommand}`);
  }
}

async function runListWindowsCommand(
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const session = await resolveSession(options);
  const windows = await options.browserService.listWindows(session);
  const summaries = windows.map((window) => toWindowListItem(window));

  return {
    session,
    data: {
      windows: summaries,
      count: summaries.length,
    },
    lines: createWindowListLines(windows),
  };
}

async function runCurrentWindowCommand(
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const session = await resolveSession(options);
  const window = await options.browserService.getCurrentWindow(session);

  return {
    session,
    data: {
      window,
    },
    lines: createWindowDetailLines(window),
  };
}

async function runGetWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const windowId = readRequiredWindowId(args[0], 'get');
  const session = await resolveSession(options);
  const window = await options.browserService.getWindow(session, windowId);

  return {
    session,
    data: {
      window,
    },
    lines: createWindowDetailLines(window),
  };
}

async function runCreateWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const createOptions = parseCreateWindowOptions(args);
  const session = await resolveSession(options);
  const window = await options.browserService.createWindow(session, createOptions);

  return {
    session,
    data: {
      window,
    },
    lines: [formatWindowActionLine('Created', window)],
  };
}

async function runFocusWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const windowId = readRequiredWindowId(args[0], 'focus');
  const session = await resolveSession(options);
  const window = await options.browserService.focusWindow(session, windowId);

  return {
    session,
    data: {
      window,
    },
    lines: [formatWindowActionLine('Focused', window)],
  };
}

async function runCloseWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const windowId = readRequiredWindowId(args[0], 'close');
  const session = await resolveSession(options);
  await options.browserService.closeWindow(session, windowId);

  return {
    session,
    data: {
      closed: true,
      windowId,
    },
    lines: [`Closed window ${windowId}`],
  };
}

async function resolveSession(options: WindowsCommandOptions): Promise<CliSessionRecord> {
  return await resolveManagedSession(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
}

function parseCreateWindowOptions(args: string[]): CliCreateWindowOptions {
  const createOptions: CliCreateWindowOptions = {};
  const urls: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--url') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --url');
      }
      urls.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      urls.push(arg.slice('--url='.length));
      continue;
    }

    if (arg === '--type') {
      createOptions.type = readRequiredOptionValue(args, index, '--type');
      index += 1;
      continue;
    }

    if (arg.startsWith('--type=')) {
      createOptions.type = arg.slice('--type='.length);
      continue;
    }

    if (arg === '--state') {
      createOptions.state = readRequiredOptionValue(args, index, '--state');
      index += 1;
      continue;
    }

    if (arg.startsWith('--state=')) {
      createOptions.state = arg.slice('--state='.length);
      continue;
    }

    if (arg === '--focused' || arg.startsWith('--focused=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--focused');
      createOptions.focused = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--incognito' || arg.startsWith('--incognito=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--incognito');
      createOptions.incognito = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--left' || arg.startsWith('--left=')) {
      const { value, consumedNextArgument } = readIntegerFlag(args, index, '--left');
      createOptions.left = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--top' || arg.startsWith('--top=')) {
      const { value, consumedNextArgument } = readIntegerFlag(args, index, '--top');
      createOptions.top = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--width' || arg.startsWith('--width=')) {
      const { value, consumedNextArgument } = readIntegerFlag(args, index, '--width');
      createOptions.width = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--height' || arg.startsWith('--height=')) {
      const { value, consumedNextArgument } = readIntegerFlag(args, index, '--height');
      createOptions.height = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    throw new Error(`Unknown option for windows create: ${arg}`);
  }

  if (urls.length === 1) {
    createOptions.url = urls[0];
  } else if (urls.length > 1) {
    createOptions.url = urls;
  }

  return createOptions;
}

function readRequiredWindowId(rawValue: string | undefined, commandName: string): number {
  if (!rawValue) {
    throw new Error(`Missing window id. Usage: chrome-controller windows ${commandName} <id>`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid window id: ${rawValue}`);
  }

  return value;
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
  const arg = args[index];
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

function readIntegerFlag(
  args: string[],
  index: number,
  flagName: string
): { value: number; consumedNextArgument: boolean } {
  const arg = args[index];
  if (arg.startsWith(`${flagName}=`)) {
    return {
      value: parseInteger(arg.slice(flagName.length + 1), flagName),
      consumedNextArgument: false,
    };
  }

  const nextValue = args[index + 1];
  if (!nextValue) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return {
    value: parseInteger(nextValue, flagName),
    consumedNextArgument: true,
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

function parseInteger(rawValue: string, flagName: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid integer value for ${flagName}: ${rawValue}`);
  }

  return value;
}

function createWindowsHelpLines(): string[] {
  return [
    'Windows commands',
    '',
    'Usage:',
    '  chrome-controller windows list',
    '  chrome-controller windows current',
    '  chrome-controller windows get <id>',
    '  chrome-controller windows create [--url <url>] [--focused] [--incognito]',
    '  chrome-controller windows create [--type <type>] [--state <state>]',
    '  chrome-controller windows create [--left <n>] [--top <n>] [--width <n>] [--height <n>]',
    '  chrome-controller windows focus <id>',
    '  chrome-controller windows close <id>',
  ];
}

function createWindowListLines(windows: CliWindowInfo[]): string[] {
  if (windows.length === 0) {
    return ['No windows found'];
  }

  const lines = ['Windows'];
  for (const window of windows) {
    const activeTabUrl = window.activeTab?.url ?? 'none';
    lines.push(
      `${window.focused ? '*' : ' '} ${formatWindowId(window)}  state=${window.state ?? 'unknown'}  type=${window.type ?? 'unknown'}  tabs=${window.tabCount}  active=${activeTabUrl}`
    );
  }

  return lines;
}

function toWindowListItem(window: CliWindowInfo): CliWindowListItem {
  return {
    id: window.id,
    focused: window.focused,
    state: window.state,
    type: window.type,
    tabCount: window.tabCount,
    tabs: window.tabs,
  };
}

function createWindowDetailLines(window: CliWindowInfo): string[] {
  return [
    `Window ${formatWindowId(window)}`,
    `Focused: ${window.focused ? 'true' : 'false'}`,
    `State: ${window.state ?? 'unknown'}`,
    `Type: ${window.type ?? 'unknown'}`,
    `Incognito: ${window.incognito ? 'true' : 'false'}`,
    `Bounds: left=${window.bounds.left ?? 'unknown'} top=${window.bounds.top ?? 'unknown'} width=${window.bounds.width ?? 'unknown'} height=${window.bounds.height ?? 'unknown'}`,
    `Tabs: ${window.tabCount}`,
    `Active tab: ${window.activeTab?.url ?? 'none'}`,
  ];
}

function formatWindowId(window: CliWindowInfo): string {
  return typeof window.id === 'number' ? String(window.id) : 'unknown';
}

function formatWindowActionLine(action: string, window: CliWindowInfo): string {
  const parts = [`${action} window ${formatWindowId(window)}`];

  if (window.state) {
    parts.push(`state=${window.state}`);
  }

  if (window.focused) {
    parts.push('focused');
  }

  if (window.activeTab?.id !== null && window.activeTab?.id !== undefined) {
    parts.push(`activeTab=${window.activeTab.id}`);
  }

  if (window.activeTab?.url) {
    parts.push(window.activeTab.url);
  }

  return parts.join(' ');
}
