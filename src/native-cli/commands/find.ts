import { captureStablePageSnapshot, captureStablePageText } from '../page-capture.js';
import {
  createFindPageModelMarkdown,
  runFindPageModelLlm,
} from '../find-page-model.js';
import { createPageMarkdown } from '../page-markdown.js';
import { createPageSnapshotRecord, writePageSnapshotCache } from '../page-snapshot.js';
import { SessionStore } from '../session-store.js';

import { parseOptionalTabFlag, resolveSession, resolveTabId } from './support.js';

import type { BrowserService, CliCommandResult, CliRunOptions } from '../types.js';

interface FindCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
  env?: CliRunOptions['env'];
}

export async function runFindCommand(
  options: FindCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(options.args, 'find');
  const parsed = parseFindArgs(args);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const tabId = await resolveTabId(options.browserService, session, explicitTabId);

  const rawSnapshot = await captureStablePageSnapshot(options.browserService, session, tabId);
  const snapshotRecord = createPageSnapshotRecord({
    sessionId: session.id,
    tabId,
    raw: rawSnapshot,
  });
  await writePageSnapshotCache(options.env, snapshotRecord);

  const rawTextCapture = await captureStablePageText(options.browserService, session, tabId);
  const pageMarkdown = createPageMarkdown(rawTextCapture);
  const pageModelMarkdown = createFindPageModelMarkdown({
    snapshot: snapshotRecord,
    pageText: pageMarkdown,
  });
  const resultMarkdown = await runFindPageModelLlm({
    query: parsed.query,
    pageModelMarkdown,
    limit: parsed.limit,
  });

  return {
    session,
    data: {
      tabId,
      query: parsed.query,
      limit: parsed.limit,
      title: snapshotRecord.title ?? pageMarkdown.title,
      url: snapshotRecord.url ?? pageMarkdown.url,
      snapshotId: snapshotRecord.snapshotId,
      pageModelMarkdown,
      resultMarkdown,
      elementCount: snapshotRecord.count,
      visibleElementCount: snapshotRecord.visibleCount,
    },
    lines: resultMarkdown ? resultMarkdown.split('\n') : [''],
  };
}

function parseFindArgs(args: string[]): {
  query: string;
  limit: number;
} {
  let query: string | undefined;
  let limit = 20;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--limit') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --limit');
      }

      limit = parseFindLimit(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      limit = parseFindLimit(arg.slice('--limit='.length));
      continue;
    }

    if (!arg.startsWith('-') && !query) {
      query = arg;
      continue;
    }

    throw new Error(`Unknown option for find: ${arg}`);
  }

  if (!query) {
    throw new Error('Usage: chrome-controller find <query> [--limit <n>] [--tab <id>]');
  }

  return {
    query,
    limit,
  };
}

function parseFindLimit(rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid integer value for --limit: ${rawValue}`);
  }

  return value;
}
