import { ChromeBrowserService } from './browser-service.js';
import { isCliPartialResultError } from './command-error.js';
import { isDetachedEvaluationError } from './interaction-support.js';

import { runSessionCommand } from './commands/session.js';
import { runSetupCommand } from './commands/setup.js';
import { runObserveCommand } from './commands/observe.js';
import { runStateCommand } from './commands/state.js';
import { runTabsCommand } from './commands/tabs.js';
import { runUploadCommand } from './commands/upload.js';
import { runElementCommand } from './commands/element.js';
import { runKeyboardCommand } from './commands/keyboard.js';
import { runMouseCommand } from './commands/mouse.js';
import { runOpenCommand } from './commands/open.js';
import { runPageCommand } from './commands/page.js';
import { runRawCommand } from './commands/raw.js';
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
      stdout,
      stderr,
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
    stdout: CliWritable;
    stderr: CliWritable;
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
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'setup':
      return await runSetupCommand({
        args,
        json: context.json,
        env: context.env,
        stdout: context.stdout,
        stderr: context.stderr,
      });
    case 'windows':
      return await runWindowsCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'observe':
      return await runObserveCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
      });
    case 'state':
      return await runStateCommand({
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
    case 'upload':
      return await runUploadCommand({
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
    case 'raw':
      return await runRawCommand({
        args,
        explicitSessionId: context.explicitSessionId,
        sessionStore: context.sessionStore,
        browserService: context.browserService ?? new ChromeBrowserService(),
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

  writeLines(stdout, result.lines ?? []);
}

function writeError(
  stderr: CliWritable,
  stdout: CliWritable,
  json: boolean,
  error: unknown
): void {
  if (json) {
    if (isCliPartialResultError(error)) {
      stdout.write(
        `${JSON.stringify(
          {
            success: false,
            error: error.message,
            sessionId: error.result.session?.id ?? null,
            partial: true,
            data: error.result.data ?? null,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    const message = getErrorMessage(error);
    stdout.write(
      `${JSON.stringify(
        {
          success: false,
          error: message,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const message = getErrorMessage(error);
  stderr.write(`${message}\n`);
}

function getErrorMessage(error: unknown): string {
  if (isCliPartialResultError(error)) {
    return error.message;
  }

  if (isDetachedEvaluationError(error)) {
    return 'The page changed while the command was running. Wait for the page to settle, and if you are using snapshot refs run `chrome-controller page snapshot` again before retrying.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
    '  observe   Observe console, network, and download activity',
    '  state     Read and modify page storage state and cookies',
    '  element   Interact with page elements using selectors or @refs',
    '  keyboard  Send keyboard input to the active session tab',
    '  mouse     Send mouse input to the active session tab',
    '  open      Safely open or reuse a matching tab and pin it to the session',
    '  page      Navigate and inspect page state and content',
    '  raw       Advanced escape hatch for raw browser APIs and CDP',
    '  session   Manage CLI sessions',
    '  setup     Choose a Chrome profile and install the extension/native host',
    '  tabs      Inspect and manage browser tabs',
    '  upload    Upload files through file inputs',
    '  wait      Wait for page and browser conditions',
    '  windows   Manage the active session window',
    '  help      Show this help',
    '',
    'Global options:',
    '  --json            Output machine-readable JSON',
    '  --session <id>    Use an explicit session when supported',
    '  --help, -h        Show help',
  ];
}
