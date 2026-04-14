import type {
  BrowserService,
  CliCommandResult,
  CliSessionRecord,
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

interface ManagedWindowResolution {
  session: CliSessionRecord;
  windowId: number;
}

export async function runWindowsCommand(
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'info', ...rest] = options.args;

  switch (subcommand) {
    case 'info':
      return await runWindowInfoCommand(rest, options);
    case 'focus':
      return await runFocusWindowCommand(rest, options);
    case 'resize':
      return await runResizeWindowCommand(rest, options);
    case 'move':
      return await runMoveWindowCommand(rest, options);
    case 'maximize':
      return await runWindowStateCommand(rest, options, 'maximized', 'Maximized');
    case 'minimize':
      return await runWindowStateCommand(rest, options, 'minimized', 'Minimized');
    case 'restore':
      return await runWindowStateCommand(rest, options, 'normal', 'Restored');
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

async function runWindowInfoCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'info');
  const { session, windowId } = await resolveSessionWindow(options);
  const window = await options.browserService.getWindow(session, windowId);

  return {
    session,
    data: {
      window,
    },
    lines: createWindowDetailLines(window),
  };
}

async function runFocusWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'focus');
  const { session, windowId } = await resolveSessionWindow(options);
  const window = await options.browserService.focusWindow(session, windowId);

  return createWindowActionResult(session, window, 'Focused');
}

async function runResizeWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const width = parseRequiredPositiveIntegerArg(args[0], 'width', 'resize <width> <height>');
  const height = parseRequiredPositiveIntegerArg(args[1], 'height', 'resize <width> <height>');
  ensureNoArgs(args.slice(2), 'resize <width> <height>');

  const { session, windowId } = await resolveSessionWindow(options);
  const window = await updateManagedWindowBounds(options.browserService, session, windowId, {
    width,
    height,
  });

  return createWindowActionResult(session, window, 'Resized', {
    includeBounds: true,
  });
}

async function runMoveWindowCommand(
  args: string[],
  options: WindowsCommandOptions
): Promise<CliCommandResult> {
  const left = parseRequiredIntegerArg(args[0], 'left', 'move <left> <top>');
  const top = parseRequiredIntegerArg(args[1], 'top', 'move <left> <top>');
  ensureNoArgs(args.slice(2), 'move <left> <top>');

  const { session, windowId } = await resolveSessionWindow(options);
  const window = await updateManagedWindowBounds(options.browserService, session, windowId, {
    left,
    top,
  });

  return createWindowActionResult(session, window, 'Moved', {
    includeBounds: true,
  });
}

async function runWindowStateCommand(
  args: string[],
  options: WindowsCommandOptions,
  state: 'maximized' | 'minimized' | 'normal',
  action: 'Maximized' | 'Minimized' | 'Restored'
): Promise<CliCommandResult> {
  ensureNoArgs(args, action.toLowerCase());
  const { session, windowId } = await resolveSessionWindow(options);
  const window = await options.browserService.updateWindow(session, windowId, {
    state,
  });

  return createWindowActionResult(session, window, action);
}

async function resolveSession(options: WindowsCommandOptions): Promise<CliSessionRecord> {
  return await resolveManagedSession(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
}

async function resolveSessionWindow(
  options: WindowsCommandOptions
): Promise<ManagedWindowResolution> {
  const session = await resolveSession(options);
  if (typeof session.windowId !== 'number') {
    throw new Error(`Could not resolve a managed window for session ${session.id}`);
  }

  return {
    session,
    windowId: session.windowId,
  };
}

async function updateManagedWindowBounds(
  browserService: BrowserService,
  session: CliSessionRecord,
  windowId: number,
  bounds: {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }
): Promise<CliWindowInfo> {
  const window = await browserService.getWindow(session, windowId);
  if (window.state && window.state !== 'normal') {
    await browserService.updateWindow(session, windowId, {
      state: 'normal',
    });
  }

  return await browserService.updateWindow(session, windowId, bounds);
}

function ensureNoArgs(args: string[], usage: string): void {
  if (args.length > 0) {
    throw new Error(`Usage: chrome-controller windows ${usage}`);
  }
}

function parseRequiredPositiveIntegerArg(
  rawValue: string | undefined,
  name: string,
  usage: string
): number {
  if (!rawValue) {
    throw new Error(`Usage: chrome-controller windows ${usage}`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return value;
}

function parseRequiredIntegerArg(
  rawValue: string | undefined,
  name: string,
  usage: string
): number {
  if (!rawValue) {
    throw new Error(`Usage: chrome-controller windows ${usage}`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return value;
}

function createWindowsHelpLines(): string[] {
  return [
    'Windows commands',
    '',
    "All windows commands act on the active session's managed window.",
    'If that managed window is missing, it is recreated automatically.',
    '',
    'Usage:',
    '  chrome-controller windows info',
    '  chrome-controller windows focus',
    '  chrome-controller windows resize <width> <height>',
    '  chrome-controller windows move <left> <top>',
    '  chrome-controller windows maximize',
    '  chrome-controller windows minimize',
    '  chrome-controller windows restore',
    '',
    'Restore returns a minimized, maximized, or fullscreen managed window to the normal state.',
  ];
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

function createWindowActionResult(
  session: CliSessionRecord,
  window: CliWindowInfo,
  action: string,
  options: {
    includeBounds?: boolean;
  } = {}
): CliCommandResult {
  return {
    session,
    data: {
      window,
    },
    lines: [formatWindowActionLine(action, window, options)],
  };
}

function formatWindowActionLine(
  action: string,
  window: CliWindowInfo,
  options: {
    includeBounds?: boolean;
  } = {}
): string {
  const parts = [`${action} window ${formatWindowId(window)}`];

  if (window.state) {
    parts.push(`state=${window.state}`);
  }

  if (window.focused) {
    parts.push('focused');
  }

  if (options.includeBounds) {
    parts.push(`left=${window.bounds.left ?? 'unknown'}`);
    parts.push(`top=${window.bounds.top ?? 'unknown'}`);
    parts.push(`width=${window.bounds.width ?? 'unknown'}`);
    parts.push(`height=${window.bounds.height ?? 'unknown'}`);
  }

  return parts.join(' ');
}
