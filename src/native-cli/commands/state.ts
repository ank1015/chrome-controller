import { SessionStore } from '../session-store.js';

import { runCookiesCommand } from './cookies.js';
import { runStorageCommand } from './storage.js';

import type { BrowserService, CliCommandResult } from '../types.js';

interface StateCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runStateCommand(
  options: StateCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'local':
      return await runStateStorageAreaCommand('local', rest, options);
    case 'session':
      return await runStateStorageAreaCommand('session', rest, options);
    case 'save':
      return await runStorageCommand({
        ...options,
        args: ['state-save', ...rest],
      });
    case 'load':
      return await runStorageCommand({
        ...options,
        args: ['state-load', ...rest],
      });
    case 'cookies':
      return await runCookiesCommand({
        ...options,
        args: rest,
      });
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createStateHelpLines(),
      };
    default:
      throw new Error(`Unknown state command: ${subcommand}`);
  }
}

async function runStateStorageAreaCommand(
  area: 'local' | 'session',
  args: string[],
  options: StateCommandOptions
): Promise<CliCommandResult> {
  const [action, ...rest] = args;
  if (!action || !['get', 'set', 'clear'].includes(action)) {
    throw new Error(`Usage: chrome-controller state ${area} <get|set|clear> [...]`);
  }

  return await runStorageCommand({
    ...options,
    args: [`${area}-${action}`, ...rest],
  });
}

function createStateHelpLines(): string[] {
  return [
    'State commands',
    '',
    "State commands act on the active session's current tab or its URL scope.",
    'Use `tabs use <tabId>` to switch which tab state commands operate on by default.',
    '',
    'Usage:',
    '  chrome-controller state local get [key]',
    '  chrome-controller state local set <key> <value>',
    '  chrome-controller state local clear [key]',
    '  chrome-controller state session get [key]',
    '  chrome-controller state session set <key> <value>',
    '  chrome-controller state session clear [key]',
    '  chrome-controller state save <path>',
    '  chrome-controller state load <path> [--reload]',
    '  chrome-controller state cookies list [--url <url>] [--domain <domain>] [--all] [--limit <n>]',
    '  chrome-controller state cookies get <name> [--url <url>]',
    '  chrome-controller state cookies set <name> <value> [--url <url>] [--domain <domain>] [--path <path>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>]',
    '  chrome-controller state cookies clear [name] [--url <url>] [--domain <domain>] [--all]',
    '  chrome-controller state cookies export <path> [--url <url>] [--domain <domain>] [--all]',
    '  chrome-controller state cookies import <path> [--url <url>]',
  ];
}
