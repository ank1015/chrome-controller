#!/usr/bin/env node

import { ChromeBrowserService } from './browser-service.js';
import { isCliPartialResultError } from './command-error.js';
import { isDetachedEvaluationError } from './interaction-support.js';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { runSessionCommand } from './commands/session.js';
import { runDebuggerCommand } from './commands/debugger.js';
import { runCookiesCommand } from './commands/cookies.js';
import { runDownloadsCommand } from './commands/downloads.js';
import { runStorageCommand } from './commands/storage.js';
import { runTabsCommand } from './commands/tabs.js';
import { runUploadCommand } from './commands/upload.js';
import { runConsoleCommand } from './commands/console.js';
import { runElementCommand } from './commands/element.js';
import { runFindCommand } from './commands/find.js';
import { runNetworkCommand } from './commands/network.js';
import { runKeyboardCommand } from './commands/keyboard.js';
import { runMouseCommand } from './commands/mouse.js';
import { runOpenCommand } from './commands/open.js';
import { runPageCommand } from './commands/page.js';
import { runScreenshotCommand } from './commands/screenshot.js';
import { runWaitCommand } from './commands/wait.js';
import { runWindowsCommand } from './commands/windows.js';
import { SessionStore } from './session-store.js';

import type { CliCommandResult, CliRunOptions, CliWritable } from './types.js';

interface ParsedArgs {
  json: boolean;
  help: boolean;
  explicitSessionId?: string;
  commandArgs: string[];
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  options: CliRunOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const jsonMode = hasJsonFlag(argv);
  const sessionStore = new SessionStore({
    env: options.env,
    now: options.now,
  });
  const browserService = options.browserService ?? new ChromeBrowserService();

  try {
    const parsedArgs = parseArgs(argv);
    if (parsedArgs.help || parsedArgs.commandArgs.length === 0) {
      writeLines(stdout, createHelpLines());
      return 0;
    }

    const [command, ...rest] = parsedArgs.commandArgs;
    const result = await dispatchCommand(command, rest, {
      json: parsedArgs.json,
      explicitSessionId: parsedArgs.explicitSessionId,
      browserService,
      sessionStore,
      env: options.env,
    });

    writeResult(stdout, parsedArgs.json, result);
    return 0;
  } catch (error) {
    writeError(stderr, stdout, jsonMode, error);
    return 1;
  }
}

async function dispatchCommand(
  command: string,
  args: string[],
  context: {
    browserService: CliRunOptions['browserService'];
    json: boolean;
    explicitSessionId?: string;
    sessionStore: SessionStore;
    env?: NodeJS.ProcessEnv;
  }
): Promise<CliCommandResult> {
  switch (command) {
    case 'help':
      return {
        lines: createHelpLines(),
      };
    case 'session':
      return await runSessionCommand({
        args,
        json: context.json,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
      });
    case 'windows':
      return await runWindowsCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'tabs':
      return await runTabsCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'debugger':
      return await runDebuggerCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'storage':
      return await runStorageCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'upload':
      return await runUploadCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'cookies':
      return await runCookiesCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'console':
      return await runConsoleCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'element':
      return await runElementCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
        env: context.env,
      });
    case 'find':
      return await runFindCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
        env: context.env,
      });
    case 'downloads':
      return await runDownloadsCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'keyboard':
      return await runKeyboardCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'mouse':
      return await runMouseCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'network':
      return await runNetworkCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'open':
      return await runOpenCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'page':
      return await runPageCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
        env: context.env,
      });
    case 'screenshot':
      return await runScreenshotCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
        env: context.env,
      });
    case 'wait':
      return await runWaitCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
        env: context.env,
      });
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const commandArgs: string[] = [];
  let json = false;
  let help = false;
  let explicitSessionId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--session') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --session');
      }

      explicitSessionId = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--session=')) {
      explicitSessionId = arg.slice('--session='.length);
      continue;
    }

    commandArgs.push(arg);
  }

  return {
    json,
    help,
    explicitSessionId,
    commandArgs,
  };
}

function hasJsonFlag(argv: string[]): boolean {
  return argv.includes('--json');
}

function writeResult(stdout: CliWritable, json: boolean, result: CliCommandResult): void {
  if (json) {
    const payload = {
      success: true,
      sessionId: result.session?.id ?? null,
      data: result.data ?? null,
    };
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (result.lines && result.lines.length > 0) {
    writeLines(stdout, result.lines);
  }
}

function writeError(
  stderr: CliWritable,
  stdout: CliWritable,
  json: boolean,
  error: unknown
): void {
  const partialResult = isCliPartialResultError(error) ? error.result : null;
  const message = normalizeErrorMessage(error);

  if (json) {
    stdout.write(`${JSON.stringify({
      success: false,
      error: message,
      ...(partialResult
        ? {
            sessionId: partialResult.session?.id ?? null,
            data: partialResult.data ?? null,
            partial: true,
          }
        : {}),
    }, null, 2)}\n`);
    return;
  }

  if (partialResult?.lines && partialResult.lines.length > 0) {
    writeLines(stdout, partialResult.lines);
  }

  stderr.write(`${message}\n`);
}

function normalizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isDetachedEvaluationError(error)) {
    return 'The page changed while the command was running. Wait for the page to settle, and if you are using snapshot refs run `chrome-controller page snapshot` again before retrying.';
  }

  if (message.startsWith('Could not find element for selectors:')) {
    return `${message}. The page may have re-rendered or the snapshot ref may be stale. Run \`chrome-controller page snapshot\` again, or retry with a selector.`;
  }

  if (message.startsWith('Unknown element ref @e')) {
    return `${message} Snapshot refs are ephemeral. Run \`chrome-controller page snapshot\` again and use the new ref.`;
  }

  if (message.includes('No snapshot cache found for tab')) {
    return `${message} Snapshot refs only work after \`chrome-controller page snapshot\`.`;
  }

  if (message.includes('does not have a usable selector')) {
    return `${message} The page may have re-rendered. Run \`chrome-controller page snapshot\` again and retry.`;
  }

  return message;
}

function writeLines(output: CliWritable, lines: string[]): void {
  output.write(`${lines.join('\n')}\n`);
}

function createHelpLines(): string[] {
  return [
    'chrome-controller',
    '',
    'Session-aware CLI foundation for Chrome controller commands.',
    '',
    'Usage:',
    '  chrome-controller <command> [options]',
    '',
    'Commands:',
    '  cookies   Inspect and modify browser cookies',
    '  console   Read browser console output',
    '  debugger  Control Chrome DevTools Protocol sessions',
    '  downloads Inspect and manage browser downloads',
    '  element   Interact with page elements using selectors or @refs',
    '  find      Build an LLM-friendly page model for semantic lookup',
    '  keyboard  Send keyboard input to the active tab',
    '  mouse     Send mouse input to the active tab',
    '  network   Capture and control browser network traffic',
    '  open      Safely open or reuse a matching tab and pin it to the session',
    '  page      Navigate and inspect basic page metadata',
    '  screenshot Capture page screenshots',
    '  session   Manage CLI sessions',
    '  storage   Read and modify page storage state',
    '  tabs      Inspect and manage browser tabs',
    '  upload    Upload files through file inputs',
    '  wait      Wait for page and browser conditions',
    '  windows   Inspect and manage browser windows',
    '  help      Show this help',
    '',
    'Global options:',
    '  --json            Output machine-readable JSON',
    '  --session <id>    Use an explicit session when supported',
    '  --help, -h        Show help',
  ];
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
    const invokedPath = realpathSync(process.argv[1]);
    return currentModulePath === invokedPath;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectRun()) {
  runCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  );
}
