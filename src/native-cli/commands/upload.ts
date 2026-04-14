import { SessionStore } from '../session-store.js';

import {
  createImplicitTabResolutionHelpLines,
  parseOptionalTabFlag,
  resolveSession,
  resolveTabId,
} from './support.js';

import type { BrowserService, CliCommandResult } from '../types.js';

interface UploadCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

export async function runUploadCommand(
  options: UploadCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'files':
      return await runUploadFilesCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createUploadHelpLines(),
      };
    default:
      throw new Error(`Unknown upload command: ${subcommand}`);
  }
}

async function runUploadFilesCommand(
  rawArgs: string[],
  options: UploadCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'upload files');
  const [selector, ...paths] = args;

  if (!selector || paths.length === 0) {
    throw new Error(
      'Usage: chrome-controller upload files <selector> <path...> [--tab <id>]'
    );
  }

  const session = await resolveSession(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);
  const result = await options.browserService.uploadFiles(session, tabId, selector, paths);

  return {
    session,
    data: {
      tabId,
      ...result,
    },
    lines: [`Uploaded ${result.files.length} file${result.files.length === 1 ? '' : 's'} to ${selector} on tab ${tabId}`],
  };
}

function createUploadHelpLines(): string[] {
  return [
    'Upload commands',
    '',
    'Usage:',
    '  chrome-controller upload files <selector> <path...> [--tab <id>]',
    '',
    'Notes:',
    ...createImplicitTabResolutionHelpLines(),
  ];
}
