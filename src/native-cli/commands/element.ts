import { SessionStore } from '../session-store.js';

import {
  resolveElementTarget,
  retryStaleDomOperation,
  runDomOperation,
  withAttachedDebugger,
} from '../interaction-support.js';
import { pressKeyOnTab } from './keyboard.js';
import { parsePositiveInteger, resolveManagedCurrentTab } from './support.js';

import type { BrowserService, CliCommandResult, CliRunOptions } from '../types.js';

interface ElementCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
  env?: CliRunOptions['env'];
}

export async function runElementCommand(
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'click':
      return await runElementActionCommand('click', rest, options);
    case 'fill':
    case 'type':
    case 'select':
      return await runElementValueCommand(subcommand, rest, options);
    case 'check':
    case 'uncheck':
      return await runElementActionCommand(subcommand, rest, options);
    case 'press':
      return await runElementPressCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createElementHelpLines(),
      };
    default:
      throw new Error(`Unknown element command: ${subcommand}`);
  }
}

async function runElementActionCommand(
  action: 'click' | 'check' | 'uncheck',
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const parsed =
    action === 'click'
      ? parseClickFlags(rawArgs)
      : {
          ...parseRetryStaleFlag(rawArgs),
          openInNewTab: false,
        };
  const [target, ...rest] = parsed.args;
  if (!target) {
    throw new Error(getElementActionUsage(action));
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element ${action}: ${rest[0]}`);
  }

  const resolved = await resolveElementCommandTarget(options, target);
  if (action === 'click' && parsed.openInNewTab) {
    const boxOperation = async () =>
      await runDomOperation(
        options.browserService,
        resolved.session,
        resolved.tabId,
        resolved.target,
        'box'
      );
    const boxResult = parsed.retryStale
      ? await retryStaleDomOperation(
          `element click ${resolved.target.ref ?? resolved.target.raw}`,
          boxOperation
        )
      : await boxOperation();

    if (!boxResult.box) {
      throw new Error(`Could not determine click position for ${resolved.target.description}`);
    }

    await options.browserService.activateTab(resolved.session, resolved.tabId);
    const newTabModifier = getNewTabClickModifier();
    await withAttachedDebugger(
      options.browserService,
      resolved.session,
      resolved.tabId,
      async () => {
        await dispatchDebuggerMouseEvent(
          options.browserService,
          resolved.session,
          resolved.tabId,
          'mouseMoved',
          {
            x: boxResult.box.centerX,
            y: boxResult.box.centerY,
            button: 'none',
            buttons: 0,
          }
        );
        await dispatchDebuggerMouseEvent(
          options.browserService,
          resolved.session,
          resolved.tabId,
          'mousePressed',
          {
            x: boxResult.box.centerX,
            y: boxResult.box.centerY,
            button: 'left',
            buttons: 1,
            clickCount: 1,
            modifiers: newTabModifier.mask,
          }
        );
        await dispatchDebuggerMouseEvent(
          options.browserService,
          resolved.session,
          resolved.tabId,
          'mouseReleased',
          {
            x: boxResult.box.centerX,
            y: boxResult.box.centerY,
            button: 'left',
            buttons: 0,
            clickCount: 1,
            modifiers: newTabModifier.mask,
          }
        );
      }
    );

    return {
      session: resolved.session,
      data: {
        tabId: resolved.tabId,
        target: resolved.target.ref ?? resolved.target.raw,
        matchedSelector: boxResult.matchedSelector ?? null,
        modifierKey: newTabModifier.key,
        newTab: true,
      },
      lines: [`Opened ${resolved.target.description} in a new tab`],
    };
  }

  const evaluateOptions = shouldUseUserGesture(action)
    ? { userGesture: true }
    : undefined;
  const result = parsed.retryStale
    ? await retryStaleDomOperation(
        `element ${action} ${resolved.target.ref ?? resolved.target.raw}`,
        async () =>
          await runDomOperation(
            options.browserService,
            resolved.session,
            resolved.tabId,
            resolved.target,
            action,
            {},
            evaluateOptions
          )
      )
    : await runDomOperation(
        options.browserService,
        resolved.session,
        resolved.tabId,
        resolved.target,
        action,
        {},
        evaluateOptions
      );

  return {
    session: resolved.session,
    data: {
      tabId: resolved.tabId,
      target: resolved.target.ref ?? resolved.target.raw,
      matchedSelector: result.matchedSelector ?? null,
      ...(result.checked !== undefined ? { checked: result.checked } : {}),
      result,
    },
    lines: [`${formatActionVerb(action)} ${resolved.target.description}`],
  };
}

async function dispatchDebuggerMouseEvent(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveManagedCurrentTab>>['session'],
  tabId: number,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  const params = {
    type,
    ...payload,
  };

  try {
    await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchMouseEvent', params);
  } catch (error) {
    if (!isMissingDebuggerSessionError(error)) {
      throw error;
    }

    await browserService.attachDebugger(session, tabId);
    await browserService.sendDebuggerCommand(session, tabId, 'Input.dispatchMouseEvent', params);
  }
}

async function runElementValueCommand(
  action: 'fill' | 'type' | 'select',
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const parsedRetry = parseRetryStaleFlag(rawArgs);
  const [target, ...rest] = parsedRetry.args;
  if (!target || rest.length === 0) {
    throw new Error(`Usage: chrome-controller element ${action} <selector|@ref> <value>`);
  }

  let valueArgs = rest;
  let delayMs: number | undefined;

  if (action === 'type') {
    const parsedDelay = parseDelayMsFlag(rest);
    valueArgs = parsedDelay.args;
    delayMs = parsedDelay.delayMs;
  }

  const value = valueArgs.join(' ');
  if (!value) {
    throw new Error(`Usage: chrome-controller element ${action} <selector|@ref> <value>`);
  }

  const resolved = await resolveElementCommandTarget(options, target);
  const result = parsedRetry.retryStale
    ? await retryStaleDomOperation(
        `element ${action} ${resolved.target.ref ?? resolved.target.raw}`,
        async () =>
          await runDomOperation(
            options.browserService,
            resolved.session,
            resolved.tabId,
            resolved.target,
            action,
            {
              value,
              ...(delayMs !== undefined ? { delayMs } : {}),
            },
            {
              ...(action === 'type' ? { awaitPromise: true } : {}),
            }
          )
      )
    : await runDomOperation(
        options.browserService,
        resolved.session,
        resolved.tabId,
        resolved.target,
        action,
        {
          value,
          ...(delayMs !== undefined ? { delayMs } : {}),
        },
        {
          ...(action === 'type' ? { awaitPromise: true } : {}),
        }
      );

  return {
    session: resolved.session,
    data: {
      tabId: resolved.tabId,
      target: resolved.target.ref ?? resolved.target.raw,
      matchedSelector: result.matchedSelector ?? null,
      value: result.value ?? value,
      ...(delayMs !== undefined ? { delayMs } : {}),
      result,
    },
    lines: [`${formatActionVerb(action)} ${resolved.target.description}`],
  };
}

async function runElementPressCommand(
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const parsedRetry = parseRetryStaleFlag(rawArgs);
  const parsedCount = parseCountFlag(parsedRetry.args);
  const [target, keyName, ...rest] = parsedCount.args;
  if (!target || !keyName) {
    throw new Error(
      'Usage: chrome-controller element press <selector|@ref> <key> [--count <n>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element press: ${rest[0]}`);
  }

  const resolved = await resolveElementCommandTarget(options, target);
  const focusOperation = async () =>
    await runDomOperation(
      options.browserService,
      resolved.session,
      resolved.tabId,
      resolved.target,
      'focus'
    );
  const focusResult = parsedRetry.retryStale
    ? await retryStaleDomOperation(
        `element press ${resolved.target.ref ?? resolved.target.raw}`,
        focusOperation
      )
    : await focusOperation();
  const submitResult =
    parsedCount.count === 1 && keyName.trim().toLowerCase() === 'enter'
      ? await runDomOperation(
          options.browserService,
          resolved.session,
          resolved.tabId,
          resolved.target,
          'submit'
        )
      : null;

  if (submitResult?.submitted === true) {
    return {
      session: resolved.session,
      data: {
        tabId: resolved.tabId,
        target: resolved.target.ref ?? resolved.target.raw,
        matchedSelector: focusResult.matchedSelector ?? null,
        key: 'Enter',
        count: 1,
        result: {
          ...focusResult,
          submitted: true,
          strategy: submitResult.strategy ?? null,
        },
      },
      lines: [`Submitted ${resolved.target.description}`],
    };
  }

  const keyResult = await pressKeyOnTab(
    options.browserService,
    resolved.session,
    resolved.tabId,
    keyName,
    parsedCount.count
  );

  return {
    session: resolved.session,
    data: {
      tabId: resolved.tabId,
      target: resolved.target.ref ?? resolved.target.raw,
      matchedSelector: focusResult.matchedSelector ?? null,
      key: keyResult.key,
      count: keyResult.count,
      result: focusResult,
    },
    lines: [
      `Pressed ${keyResult.key}${keyResult.count === 1 ? '' : ` x${keyResult.count}`} on ${resolved.target.description}`,
    ],
  };
}

async function resolveElementCommandTarget(
  options: ElementCommandOptions,
  rawTarget: string
): Promise<{
  session: Awaited<ReturnType<typeof resolveManagedCurrentTab>>['session'];
  tabId: number;
  target: Awaited<ReturnType<typeof resolveElementTarget>>;
}> {
  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = requireTabId(tab);
  const target = await resolveElementTarget(options.env, session, tabId, rawTarget);

  return {
    session,
    tabId,
    target,
  };
}

function parseRetryStaleFlag(args: string[]): {
  args: string[];
  retryStale: boolean;
} {
  const rest: string[] = [];
  let retryStale = false;

  for (const arg of args) {
    if (arg === '--retry-stale') {
      retryStale = true;
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    retryStale,
  };
}

function parseClickFlags(args: string[]): {
  args: string[];
  retryStale: boolean;
  openInNewTab: boolean;
} {
  const rest: string[] = [];
  let retryStale = false;
  let openInNewTab = false;

  for (const arg of args) {
    if (arg === '--retry-stale') {
      retryStale = true;
      continue;
    }
    if (arg === '--new-tab') {
      openInNewTab = true;
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    retryStale,
    openInNewTab,
  };
}

function parseDelayMsFlag(args: string[]): {
  args: string[];
  delayMs?: number;
} {
  const rest: string[] = [];
  let delayMs: number | undefined;

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

    rest.push(arg);
  }

  return {
    args: rest,
    ...(delayMs !== undefined ? { delayMs } : {}),
  };
}

function parseCountFlag(args: string[]): {
  args: string[];
  count: number;
} {
  const rest: string[] = [];
  let count = 1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--count') {
      const value = args[index + 1];
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

    rest.push(arg);
  }

  return {
    args: rest,
    count,
  };
}

function parseNonNegativeInteger(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value for ${flagName}: ${value}`);
  }

  return parsed;
}

function requireTabId(tab: { id: number | null }): number {
  if (typeof tab.id !== 'number') {
    throw new Error('Could not resolve a tab id for element');
  }

  return tab.id;
}

function getNewTabClickModifier(): {
  key: 'Meta' | 'Control';
  mask: number;
} {
  if (process.platform === 'darwin') {
    return {
      key: 'Meta',
      mask: 4,
    };
  }

  return {
    key: 'Control',
    mask: 2,
  };
}

function isMissingDebuggerSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No debugger session');
}

function getElementActionUsage(action: 'click' | 'check' | 'uncheck'): string {
  if (action === 'click') {
    return 'Usage: chrome-controller element click <selector|@ref> [--new-tab] [--retry-stale]';
  }

  return `Usage: chrome-controller element ${action} <selector|@ref>`;
}

function formatActionVerb(action: string): string {
  switch (action) {
    case 'type':
      return 'Typed into';
    case 'select':
      return 'Selected';
    case 'check':
      return 'Checked';
    case 'uncheck':
      return 'Unchecked';
    default:
      return `${action[0]?.toUpperCase() ?? ''}${action.slice(1)}ed`;
  }
}

function createElementHelpLines(): string[] {
  return [
    'Element commands',
    '',
    "All element commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab element commands operate on.',
    '',
    'Usage:',
    '  chrome-controller element click <selector|@ref> [--new-tab] [--retry-stale]',
    '  chrome-controller element fill <selector|@ref> <value>',
    '  chrome-controller element type <selector|@ref> <value> [--delay-ms <n>]',
    '  chrome-controller element press <selector|@ref> <key> [--count <n>]',
    '  chrome-controller element select <selector|@ref> <value>',
    '  chrome-controller element check <selector|@ref>',
    '  chrome-controller element uncheck <selector|@ref>',
    '',
    'Notes:',
    '  Targets can be CSS selectors or snapshot refs like @e1.',
    '  Add --new-tab to open a link in a background tab. It uses Command-click on macOS and Ctrl-click elsewhere.',
    '  Add --retry-stale to retry transient detached or re-render races on dynamic pages.',
  ];
}

function shouldUseUserGesture(action: 'click' | 'check' | 'uncheck'): boolean {
  return action === 'click';
}
