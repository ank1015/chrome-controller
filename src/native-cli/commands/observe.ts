import { SessionStore } from '../session-store.js';

import { runConsoleCommand } from './console.js';
import { runDownloadsCommand } from './downloads.js';
import { runNetworkCommand } from './network.js';

import type { BrowserService, CliCommandResult } from '../types.js';

interface ObserveCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runObserveCommand(
  options: ObserveCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'console':
      return await runConsoleCommand({
        ...options,
        args: rest,
      });
    case 'network':
      return await runNetworkCommand({
        ...options,
        args: rest,
      });
    case 'downloads':
      return await runDownloadsCommand({
        ...options,
        args: rest,
      });
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createObserveHelpLines(),
      };
    default:
      throw new Error(`Unknown observe command: ${subcommand}`);
  }
}

function createObserveHelpLines(): string[] {
  return [
    'Observe commands',
    '',
    'Use observe when you want to inspect runtime signals from the active session.',
    "Console and network commands act on the active session's current tab.",
    'Downloads commands act on the active session and current Chrome profile.',
    '',
    'Usage:',
    '  chrome-controller observe console list [--limit <n>] [--clear]',
    '  chrome-controller observe console tail [--limit <n>] [--timeout-ms <n>] [--poll-ms <n>]',
    '  chrome-controller observe console clear',
    '  chrome-controller observe network start [--no-clear] [--disable-cache]',
    '  chrome-controller observe network stop',
    '  chrome-controller observe network list [--limit <n>] [--url-includes <text>] [--status <code>] [--failed]',
    '  chrome-controller observe network get <requestId>',
    '  chrome-controller observe network summary',
    '  chrome-controller observe network clear',
    '  chrome-controller observe network export-har <path>',
    '  chrome-controller observe network block <pattern...>',
    '  chrome-controller observe network unblock',
    '  chrome-controller observe network offline <on|off>',
    '  chrome-controller observe network throttle <slow-3g|fast-3g|slow-4g|off>',
    '  chrome-controller observe downloads list [downloads filters]',
    '  chrome-controller observe downloads wait [downloads wait options]',
    '  chrome-controller observe downloads cancel <downloadId...>',
    '  chrome-controller observe downloads erase <downloadId...>',
  ];
}
