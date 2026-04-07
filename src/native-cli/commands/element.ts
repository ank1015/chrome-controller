import { SessionStore } from '../session-store.js';

import {
  resolveElementTarget,
  retryDetachedOperation,
  runDomOperation,
} from '../interaction-support.js';
import { parseOptionalTabFlag, resolveSession, resolveTabId } from './support.js';

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
    case 'dblclick':
    case 'rightclick':
    case 'hover':
    case 'focus':
    case 'clear':
    case 'scroll-into-view':
      return await runElementActionCommand(subcommand, rest, options);
    case 'fill':
    case 'type':
    case 'select':
      return await runElementValueCommand(subcommand, rest, options);
    case 'check':
    case 'uncheck':
      return await runElementToggleCommand(subcommand, rest, options);
    case 'text':
    case 'html':
    case 'value':
    case 'visible':
    case 'enabled':
    case 'checked':
    case 'box':
      return await runElementReadCommand(subcommand, rest, options);
    case 'attr':
      return await runElementAttrCommand(rest, options);
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
  action: string,
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, `element ${action}`);
  const [target, ...rest] = args;
  if (!target) {
    throw new Error(`Usage: chrome-controller element ${action} <selector|@ref> [--tab <id>]`);
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element ${action}: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const resolvedTarget = await resolveElementTarget(options.env, session, tabId, target);
  const result = await runDomOperation(
    options.browserService,
    session,
    tabId,
    resolvedTarget,
    action
  );

  return {
    session,
    data: {
      tabId,
      target: resolvedTarget.ref ?? resolvedTarget.raw,
      matchedSelector: result.matchedSelector ?? null,
      result,
    },
    lines: [`${formatActionVerb(action)} ${resolvedTarget.description}`],
  };
}

async function runElementValueCommand(
  action: string,
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, `element ${action}`);
  const [target, ...rest] = args;
  if (!target || rest.length === 0) {
    throw new Error(
      `Usage: chrome-controller element ${action} <selector|@ref> <value> [--tab <id>]`
    );
  }

  let operationArgs = rest;
  let delayMs: number | undefined;

  if (action === 'type') {
    const parsed = parseDelayMsFlag(rest);
    operationArgs = parsed.args;
    delayMs = parsed.delayMs;
  }

  const value = operationArgs.join(' ');
  if (!value && action !== 'clear') {
    throw new Error(
      `Usage: chrome-controller element ${action} <selector|@ref> <value> [--tab <id>]`
    );
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const resolvedTarget = await resolveElementTarget(options.env, session, tabId, target);
  const result = await runDomOperation(
    options.browserService,
    session,
    tabId,
    resolvedTarget,
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
    session,
    data: {
      tabId,
      target: resolvedTarget.ref ?? resolvedTarget.raw,
      matchedSelector: result.matchedSelector ?? null,
      value: result.value ?? value,
      result,
    },
    lines: [`${formatActionVerb(action)} ${resolvedTarget.description}`],
  };
}

async function runElementToggleCommand(
  action: string,
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, `element ${action}`);
  const [target, ...rest] = args;
  if (!target) {
    throw new Error(`Usage: chrome-controller element ${action} <selector|@ref> [--tab <id>]`);
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element ${action}: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const resolvedTarget = await resolveElementTarget(options.env, session, tabId, target);
  const result = await runDomOperation(
    options.browserService,
    session,
    tabId,
    resolvedTarget,
    action
  );

  return {
    session,
    data: {
      tabId,
      target: resolvedTarget.ref ?? resolvedTarget.raw,
      matchedSelector: result.matchedSelector ?? null,
      checked: result.checked ?? null,
      result,
    },
    lines: [`${formatActionVerb(action)} ${resolvedTarget.description}`],
  };
}

async function runElementReadCommand(
  action: string,
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, `element ${action}`);
  const [target, ...rest] = args;
  if (!target) {
    throw new Error(`Usage: chrome-controller element ${action} <selector|@ref> [--tab <id>]`);
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element ${action}: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const resolvedTarget = await resolveElementTarget(options.env, session, tabId, target);
  const result = await runDomOperation(
    options.browserService,
    session,
    tabId,
    resolvedTarget,
    action
  );
  const value =
    action === 'text'
      ? result.text ?? null
      : action === 'html'
        ? result.html ?? null
        : action === 'box'
          ? result.box ?? null
          : result.value ?? null;

  return {
    session,
    data: {
      tabId,
      target: resolvedTarget.ref ?? resolvedTarget.raw,
      matchedSelector: result.matchedSelector ?? null,
      value,
      result,
    },
    lines: formatReadLines(action, value),
  };
}

async function runElementAttrCommand(
  rawArgs: string[],
  options: ElementCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'element attr');
  const [target, attribute, ...rest] = args;
  if (!target || !attribute) {
    throw new Error(
      'Usage: chrome-controller element attr <selector|@ref> <name> [--tab <id>]'
    );
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for element attr: ${rest[0]}`);
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const resolvedTarget = await resolveElementTarget(options.env, session, tabId, target);
  const result = await retryDetachedOperation(
    `element attr ${resolvedTarget.ref ?? resolvedTarget.raw}`,
    async () =>
      await runDomOperation(
        options.browserService,
        session,
        tabId,
        resolvedTarget,
        'attr',
        {
          attribute,
        }
      ),
    {
      attempts: 3,
      delayMs: 150,
    }
  );

  return {
    session,
    data: {
      tabId,
      target: resolvedTarget.ref ?? resolvedTarget.raw,
      matchedSelector: result.matchedSelector ?? null,
      attribute,
      value: result.value ?? null,
      result,
    },
    lines: [result.value === null ? 'null' : String(result.value)],
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
      delayMs = parseInteger(value, '--delay-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--delay-ms=')) {
      delayMs = parseInteger(arg.slice('--delay-ms='.length), '--delay-ms');
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    ...(delayMs !== undefined ? { delayMs } : {}),
  };
}

function parseInteger(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value for ${flagName}: ${value}`);
  }

  return parsed;
}

function formatActionVerb(action: string): string {
  switch (action) {
    case 'dblclick':
      return 'Double-clicked';
    case 'rightclick':
      return 'Right-clicked';
    case 'type':
      return 'Typed into';
    case 'scroll-into-view':
      return 'Scrolled to';
    default:
      return `${action[0]?.toUpperCase() ?? ''}${action.slice(1)}ed`;
  }
}

function formatReadLines(action: string, value: unknown): string[] {
  if (action === 'box') {
    if (!value || typeof value !== 'object') {
      return ['null'];
    }

    const box = value as {
      left: number;
      top: number;
      width: number;
      height: number;
      centerX: number;
      centerY: number;
    };
    return [
      `left=${box.left} top=${box.top} width=${box.width} height=${box.height} center=(${box.centerX}, ${box.centerY})`,
    ];
  }

  if (typeof value === 'string') {
    return [value];
  }

  return [value === null ? 'null' : JSON.stringify(value)];
}

function createElementHelpLines(): string[] {
  return [
    'Element commands',
    '',
    'Usage:',
    '  chrome-controller element click <selector|@ref> [--tab <id>]',
    '  chrome-controller element dblclick <selector|@ref> [--tab <id>]',
    '  chrome-controller element rightclick <selector|@ref> [--tab <id>]',
    '  chrome-controller element hover <selector|@ref> [--tab <id>]',
    '  chrome-controller element focus <selector|@ref> [--tab <id>]',
    '  chrome-controller element fill <selector|@ref> <value> [--tab <id>]',
    '  chrome-controller element type <selector|@ref> <value> [--delay-ms <n>] [--tab <id>]',
    '  chrome-controller element clear <selector|@ref> [--tab <id>]',
    '  chrome-controller element select <selector|@ref> <value> [--tab <id>]',
    '  chrome-controller element check <selector|@ref> [--tab <id>]',
    '  chrome-controller element uncheck <selector|@ref> [--tab <id>]',
    '  chrome-controller element scroll-into-view <selector|@ref> [--tab <id>]',
    '  chrome-controller element text <selector|@ref> [--tab <id>]',
    '  chrome-controller element html <selector|@ref> [--tab <id>]',
    '  chrome-controller element attr <selector|@ref> <name> [--tab <id>]',
    '  chrome-controller element value <selector|@ref> [--tab <id>]',
    '  chrome-controller element visible <selector|@ref> [--tab <id>]',
    '  chrome-controller element enabled <selector|@ref> [--tab <id>]',
    '  chrome-controller element checked <selector|@ref> [--tab <id>]',
    '  chrome-controller element box <selector|@ref> [--tab <id>]',
    '',
    'Notes:',
    '  Targets can be CSS selectors or snapshot refs like @e1.',
  ];
}
