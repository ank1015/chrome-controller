import { SessionStore } from '../session-store.js';

import {
  parseRequiredFloat,
  parseOptionalIntegerFlag,
  sleep,
  withAttachedDebugger,
} from '../interaction-support.js';
import { resolveManagedCurrentTab } from './support.js';

import type { BrowserService, CliCommandResult, CliSessionRecord } from '../types.js';

interface MouseCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

type MouseButton = 'left' | 'middle' | 'right';

export async function runMouseCommand(
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'move':
      return await runMouseMoveCommand(rest, options);
    case 'click':
      return await runMouseClickCommand(rest, options);
    case 'down':
      return await runMouseButtonCommand('down', rest, options);
    case 'up':
      return await runMouseButtonCommand('up', rest, options);
    case 'wheel':
      return await runMouseWheelCommand(rest, options);
    case 'drag':
      return await runMouseDragCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createMouseHelpLines(),
      };
    default:
      throw new Error(`Unknown mouse command: ${subcommand}`);
  }
}

async function runMouseMoveCommand(
  args: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const [rawX, rawY, ...rest] = args;
  if (!rawX || !rawY) {
    throw new Error('Usage: chrome-controller mouse move <x> <y>');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse move: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'move');
  await options.browserService.activateTab(session, tabId);

  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await dispatchMouseEvent(options.browserService, session, tabId, 'mouseMoved', {
      x,
      y,
      button: 'none',
      buttons: 0,
    });
  });

  return {
    session,
    data: {
      tabId,
      x,
      y,
    },
    lines: [`Moved mouse to (${x}, ${y})`],
  };
}

async function runMouseClickCommand(
  args: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const parsedButton = parseButtonFlag(args);
  const parsedCount = parseOptionalIntegerFlag(parsedButton.args, '--count');
  const [rawX, rawY, ...rest] = parsedCount.rest;
  if (!rawX || !rawY) {
    throw new Error(
      'Usage: chrome-controller mouse click <x> <y> [--button <left|middle|right>] [--count <n>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse click: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const button = parsedButton.button;
  const count = parsedCount.value ?? 1;
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'click');
  await options.browserService.activateTab(session, tabId);

  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await dispatchMouseClick(options.browserService, session, tabId, x, y, button, count);
  });

  return {
    session,
    data: {
      tabId,
      x,
      y,
      button,
      count,
    },
    lines: [`Clicked ${button} mouse button at (${x}, ${y})`],
  };
}

async function runMouseButtonCommand(
  action: 'down' | 'up',
  args: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const parsedButton = parseButtonFlag(args);
  const [rawX, rawY, ...rest] = parsedButton.args;
  if (!rawX || !rawY) {
    throw new Error(
      `Usage: chrome-controller mouse ${action} <x> <y> [--button <left|middle|right>]`
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse ${action}: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const button = parsedButton.button;
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, action);
  await options.browserService.activateTab(session, tabId);

  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await dispatchMouseEvent(options.browserService, session, tabId, action === 'down' ? 'mousePressed' : 'mouseReleased', {
      x,
      y,
      button,
      buttons: action === 'down' ? getMouseButtonsMask(button) : 0,
      clickCount: 1,
    });
  });

  return {
    session,
    data: {
      tabId,
      x,
      y,
      button,
      action,
    },
    lines: [`Mouse ${action} at (${x}, ${y})`],
  };
}

async function runMouseWheelCommand(
  args: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const parsedX = parseNamedFloatFlag(args, '--x');
  const parsedY = parseNamedFloatFlag(parsedX.args, '--y');
  const [rawDeltaX, rawDeltaY, ...rest] = parsedY.args;
  if (!rawDeltaX || !rawDeltaY) {
    throw new Error(
      'Usage: chrome-controller mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse wheel: ${rest[0]}`);
  }

  const deltaX = parseRequiredFloat(rawDeltaX, 'deltaX');
  const deltaY = parseRequiredFloat(rawDeltaY, 'deltaY');
  const x = parsedX.value ?? 0;
  const y = parsedY.value ?? 0;
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'wheel');
  await options.browserService.activateTab(session, tabId);

  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await dispatchMouseEvent(options.browserService, session, tabId, 'mouseWheel', {
      x,
      y,
      button: 'none',
      buttons: 0,
      deltaX,
      deltaY,
    });
  });

  return {
    session,
    data: {
      tabId,
      x,
      y,
      deltaX,
      deltaY,
    },
    lines: [`Mouse wheel at (${x}, ${y}) delta=(${deltaX}, ${deltaY})`],
  };
}

async function runMouseDragCommand(
  args: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const parsedSteps = parseOptionalIntegerFlag(args, '--steps');
  const [rawFromX, rawFromY, rawToX, rawToY, ...rest] = parsedSteps.rest;
  if (!rawFromX || !rawFromY || !rawToX || !rawToY) {
    throw new Error(
      'Usage: chrome-controller mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse drag: ${rest[0]}`);
  }

  const fromX = parseRequiredFloat(rawFromX, 'fromX');
  const fromY = parseRequiredFloat(rawFromY, 'fromY');
  const toX = parseRequiredFloat(rawToX, 'toX');
  const toY = parseRequiredFloat(rawToY, 'toY');
  const steps = Math.max(1, parsedSteps.value ?? 10);
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'drag');
  await options.browserService.activateTab(session, tabId);

  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await dispatchMouseEvent(options.browserService, session, tabId, 'mouseMoved', {
      x: fromX,
      y: fromY,
      button: 'none',
      buttons: 0,
    });
    await dispatchMouseEvent(options.browserService, session, tabId, 'mousePressed', {
      x: fromX,
      y: fromY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const x = fromX + (toX - fromX) * progress;
      const y = fromY + (toY - fromY) * progress;
      await dispatchMouseEvent(options.browserService, session, tabId, 'mouseMoved', {
        x,
        y,
        button: 'left',
        buttons: 1,
      });
      if (step < steps) {
        await sleep(8);
      }
    }

    await dispatchMouseEvent(options.browserService, session, tabId, 'mouseReleased', {
      x: toX,
      y: toY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  });

  return {
    session,
    data: {
      tabId,
      fromX,
      fromY,
      toX,
      toY,
      steps,
    },
    lines: [`Dragged mouse from (${fromX}, ${fromY}) to (${toX}, ${toY})`],
  };
}

async function dispatchMouseClick(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  x: number,
  y: number,
  button: MouseButton,
  count: number
): Promise<void> {
  await dispatchMouseEvent(browserService, session, tabId, 'mouseMoved', {
    x,
    y,
    button: 'none',
    buttons: 0,
  });

  for (let clickIndex = 1; clickIndex <= count; clickIndex += 1) {
    await dispatchMouseEvent(browserService, session, tabId, 'mousePressed', {
      x,
      y,
      button,
      buttons: getMouseButtonsMask(button),
      clickCount: clickIndex,
    });
    await dispatchMouseEvent(browserService, session, tabId, 'mouseReleased', {
      x,
      y,
      button,
      buttons: 0,
      clickCount: clickIndex,
    });
  }
}

async function dispatchMouseEvent(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchMouseEvent', {
    type,
    ...payload,
  });
}

function parseButtonFlag(args: string[]): {
  args: string[];
  button: MouseButton;
} {
  const rest: string[] = [];
  let button: MouseButton = 'left';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--button') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --button');
      }
      button = parseMouseButton(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--button=')) {
      button = parseMouseButton(arg.slice('--button='.length));
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    button,
  };
}

function parseMouseButton(value: string): MouseButton {
  if (value === 'left' || value === 'middle' || value === 'right') {
    return value;
  }

  throw new Error(`Invalid mouse button: ${value}`);
}

function parseNamedFloatFlag(args: string[], flagName: string): {
  args: string[];
  value?: number;
} {
  const rest: string[] = [];
  let value: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      const rawValue = args[index + 1];
      if (!rawValue) {
        throw new Error(`Missing value for ${flagName}`);
      }
      value = parseRequiredFloat(rawValue, flagName);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${flagName}=`)) {
      value = parseRequiredFloat(arg.slice(flagName.length + 1), flagName);
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    ...(value !== undefined ? { value } : {}),
  };
}

function getMouseButtonsMask(button: MouseButton): number {
  if (button === 'left') {
    return 1;
  }
  if (button === 'right') {
    return 2;
  }
  return 4;
}

function requireTabId(
  tab: Awaited<ReturnType<typeof resolveManagedCurrentTab>>['tab'],
  commandName: string
): number {
  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve tab id for mouse ${commandName}`);
  }

  return tab.id;
}

function createMouseHelpLines(): string[] {
  return [
    'Mouse commands',
    '',
    "All mouse commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab mouse commands operate on.',
    '',
    'Usage:',
    '  chrome-controller mouse move <x> <y>',
    '  chrome-controller mouse click <x> <y> [--button <left|middle|right>] [--count <n>]',
    '  chrome-controller mouse down <x> <y> [--button <left|middle|right>]',
    '  chrome-controller mouse up <x> <y> [--button <left|middle|right>]',
    '  chrome-controller mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>]',
    '  chrome-controller mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>]',
    '',
    'Notes:',
    '  Use element box to get live coordinates for a selector or @ref when needed.',
  ];
}
