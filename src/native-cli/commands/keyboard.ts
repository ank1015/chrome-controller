import { SessionStore } from '../session-store.js';

import { withAttachedDebugger, sleep } from '../interaction-support.js';
import { resolveManagedCurrentTab } from './support.js';

import type { BrowserService, CliCommandResult, CliSessionRecord } from '../types.js';

interface KeyboardCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
};

export async function runKeyboardCommand(
  options: KeyboardCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'press':
      return await runKeyboardPressCommand(rest, options);
    case 'type':
      return await runKeyboardTypeCommand(rest, options);
    case 'down':
      return await runKeyboardDownUpCommand('down', rest, options);
    case 'up':
      return await runKeyboardDownUpCommand('up', rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createKeyboardHelpLines(),
      };
    default:
      throw new Error(`Unknown keyboard command: ${subcommand}`);
  }
}

async function runKeyboardPressCommand(
  args: string[],
  options: KeyboardCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseKeyAndCount(args, 'keyboard press');
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'press');

  const outcome = await pressKeyOnTab(
    options.browserService,
    session,
    tabId,
    parsed.key.key,
    parsed.count
  );

  return {
    session,
    data: {
      tabId,
      key: outcome.key,
      count: outcome.count,
    },
    lines: [`Pressed ${outcome.key}${outcome.count === 1 ? '' : ` x${outcome.count}`}`],
  };
}

async function runKeyboardTypeCommand(
  args: string[],
  options: KeyboardCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseKeyboardTypeArgs(args);
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, 'type');

  await options.browserService.activateTab(session, tabId);
  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    for (const character of parsed.text) {
      await options.browserService.sendDebuggerCommand(session, tabId, 'Input.insertText', {
        text: character,
      });
      if (parsed.delayMs > 0) {
        await sleep(parsed.delayMs);
      }
    }
  });

  return {
    session,
    data: {
      tabId,
      text: parsed.text,
      delayMs: parsed.delayMs,
    },
    lines: [`Typed ${parsed.text.length} character${parsed.text.length === 1 ? '' : 's'}`],
  };
}

async function runKeyboardDownUpCommand(
  action: 'down' | 'up',
  args: string[],
  options: KeyboardCommandOptions
): Promise<CliCommandResult> {
  const [keyName, ...rest] = args;
  if (!keyName) {
    throw new Error(`Usage: chrome-controller keyboard ${action} <key>`);
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for keyboard ${action}: ${rest[0]}`);
  }

  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab, action);
  const key = normalizeKeyDefinition(keyName);

  await options.browserService.activateTab(session, tabId);
  await withAttachedDebugger(options.browserService, session, tabId, async () => {
    await options.browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchKeyEvent', {
      type: action === 'down' ? 'rawKeyDown' : 'keyUp',
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      ...(action === 'down' && key.text ? { text: key.text, unmodifiedText: key.text } : {}),
    });
  });

  return {
    session,
    data: {
      tabId,
      key: key.key,
      action,
    },
    lines: [`Key ${action}: ${key.key}`],
  };
}

function parseKeyAndCount(
  args: string[],
  commandName: string
): {
  key: KeyDefinition;
  count: number;
} {
  const [keyName, ...rest] = args;
  if (!keyName) {
    throw new Error(`Usage: chrome-controller ${commandName} <key> [--count <n>]`);
  }

  let count = 1;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--count') {
      const value = rest[index + 1];
      if (!value) {
        throw new Error('Missing value for --count');
      }
      count = parsePositiveInteger(value, '--count');
      index += 1;
      continue;
    }
    if (arg.startsWith('--count=')) {
      count = parsePositiveInteger(arg.slice('--count='.length), '--count');
      continue;
    }

    throw new Error(`Unknown option for ${commandName}: ${arg}`);
  }

  return {
    key: normalizeKeyDefinition(keyName),
    count,
  };
}

function parseKeyboardTypeArgs(args: string[]): {
  text: string;
  delayMs: number;
} {
  const textParts: string[] = [];
  let delayMs = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--delay-ms') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --delay-ms');
      }
      delayMs = parseNonNegativeInteger(value, '--delay-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--delay-ms=')) {
      delayMs = parseNonNegativeInteger(arg.slice('--delay-ms='.length), '--delay-ms');
      continue;
    }

    textParts.push(arg);
  }

  const text = textParts.join(' ');
  if (!text) {
    throw new Error('Usage: chrome-controller keyboard type <text> [--delay-ms <n>]');
  }

  return {
    text,
    delayMs,
  };
}

async function sendKeyPress(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  key: KeyDefinition
): Promise<void> {
  const keyDownType = key.text ? 'keyDown' : 'rawKeyDown';

  await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchKeyEvent', {
    type: keyDownType,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
    ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}),
  });

  if (key.text) {
    await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchKeyEvent', {
      type: 'char',
      key: key.key,
      code: key.code,
      text: key.text,
      unmodifiedText: key.text,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
    });
  }

  await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
  });
}

export async function pressKeyOnTab(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  rawKeyName: string,
  count = 1
): Promise<{ key: string; count: number }> {
  const key = normalizeKeyDefinition(rawKeyName);
  const safeCount = Math.max(1, count);

  await browserService.activateTab(session, tabId);
  await withAttachedDebugger(browserService, session, tabId, async () => {
    for (let index = 0; index < safeCount; index += 1) {
      await sendKeyPress(browserService, session, tabId, key);
    }
  });

  return {
    key: key.key,
    count: safeCount,
  };
}

function normalizeKeyDefinition(rawValue: string): KeyDefinition {
  const normalized = rawValue.trim();
  if (!normalized) {
    throw new Error('Key is required');
  }

  const named = NAMED_KEYS[normalized.toLowerCase()];
  if (named) {
    return named;
  }

  if (normalized.length === 1) {
    const character = normalized;
    const upper = character.toUpperCase();
    const code = /[a-z]/i.test(character)
      ? `Key${upper}`
      : /[0-9]/.test(character)
        ? `Digit${character}`
        : 'Unidentified';

    return {
      key: character,
      code,
      keyCode: character.toUpperCase().charCodeAt(0),
      text: character,
    };
  }

  throw new Error(`Unsupported key: ${rawValue}`);
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value for ${name}: ${value}`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value for ${name}: ${value}`);
  }

  return parsed;
}

function requireTabId(
  tab: Awaited<ReturnType<typeof resolveManagedCurrentTab>>['tab'],
  commandName: string
): number {
  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve tab id for keyboard ${commandName}`);
  }

  return tab.id;
}

function createKeyboardHelpLines(): string[] {
  return [
    'Keyboard commands',
    '',
    "All keyboard commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab keyboard commands operate on.',
    '',
    'Usage:',
    '  chrome-controller keyboard press <key> [--count <n>]',
    '  chrome-controller keyboard type <text> [--delay-ms <n>]',
    '  chrome-controller keyboard down <key>',
    '  chrome-controller keyboard up <key>',
  ];
}
