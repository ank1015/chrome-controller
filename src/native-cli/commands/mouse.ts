import { SessionStore } from '../session-store.js';

import {
  parseRequiredFloat,
  parseOptionalIntegerFlag,
  sleep,
  withAttachedDebugger,
} from '../interaction-support.js';
import { parseOptionalTabFlag, resolveSession, resolveTabId } from './support.js';

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
  rawArgs: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'mouse move');
  const [rawX, rawY, ...rest] = args;
  if (!rawX || !rawY) {
    throw new Error('Usage: chrome-controller mouse move <x> <y> [--tab <id>]');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse move: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
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
  rawArgs: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'mouse click');
  const parsedButton = parseButtonFlag(args);
  const parsedCount = parseOptionalIntegerFlag(parsedButton.args, '--count');
  const [rawX, rawY, ...rest] = parsedCount.rest;
  if (!rawX || !rawY) {
    throw new Error(
      'Usage: chrome-controller mouse click <x> <y> [--button <left|middle|right>] [--count <n>] [--tab <id>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse click: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const button = parsedButton.button;
  const count = parsedCount.value ?? 1;
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
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
  rawArgs: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, `mouse ${action}`);
  const parsedButton = parseButtonFlag(args);
  const [rawX, rawY, ...rest] = parsedButton.args;
  if (!rawX || !rawY) {
    throw new Error(
      `Usage: chrome-controller mouse ${action} <x> <y> [--button <left|middle|right>] [--tab <id>]`
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse ${action}: ${rest[0]}`);
  }

  const x = parseRequiredFloat(rawX, 'x');
  const y = parseRequiredFloat(rawY, 'y');
  const button = parsedButton.button;
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
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
  rawArgs: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'mouse wheel');
  const parsedX = parseNamedFloatFlag(args, '--x');
  const parsedY = parseNamedFloatFlag(parsedX.args, '--y');
  const [rawDeltaX, rawDeltaY, ...rest] = parsedY.args;
  if (!rawDeltaX || !rawDeltaY) {
    throw new Error(
      'Usage: chrome-controller mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>] [--tab <id>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for mouse wheel: ${rest[0]}`);
  }

  const deltaX = parseRequiredFloat(rawDeltaX, 'deltaX');
  const deltaY = parseRequiredFloat(rawDeltaY, 'deltaY');
  const x = parsedX.value ?? 0;
  const y = parsedY.value ?? 0;
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
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
  rawArgs: string[],
  options: MouseCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'mouse drag');
  const parsedSteps = parseOptionalIntegerFlag(args, '--steps');
  const [rawFromX, rawFromY, rawToX, rawToY, ...rest] = parsedSteps.rest;
  if (!rawFromX || !rawFromY || !rawToX || !rawToY) {
    throw new Error(
      'Usage: chrome-controller mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>] [--tab <id>]'
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
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
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

function createMouseHelpLines(): string[] {
  return [
    'Mouse commands',
    '',
    'Usage:',
    '  chrome-controller mouse move <x> <y> [--tab <id>]',
    '  chrome-controller mouse click <x> <y> [--button <left|middle|right>] [--count <n>] [--tab <id>]',
    '  chrome-controller mouse down <x> <y> [--button <left|middle|right>] [--tab <id>]',
    '  chrome-controller mouse up <x> <y> [--button <left|middle|right>] [--tab <id>]',
    '  chrome-controller mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>] [--tab <id>]',
    '  chrome-controller mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>] [--tab <id>]',
    '',
    'Notes:',
    '  Use element box to get live coordinates for a selector or @ref when needed.',
  ];
}
