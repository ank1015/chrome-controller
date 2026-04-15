import { SessionStore } from '../session-store.js';

import { resolveManagedCurrentTab } from './support.js';

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
  args: string[],
  options: UploadCommandOptions
): Promise<CliCommandResult> {
  const [selector, ...paths] = args;

  if (!selector || paths.length === 0) {
    throw new Error('Usage: chrome-controller upload files <selector> <path...>');
  }

  const { session, tab } = await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
  if (typeof tab.id !== 'number') {
    throw new Error('Could not resolve the current tab for upload files');
  }

  const tabId = tab.id;
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
    "All upload commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab upload commands operate on.',
    '',
    'Usage:',
    '  chrome-controller upload files <selector> <path...>',
  ];
}
