import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { captureStablePageSnapshot, captureStablePageText } from '../page-capture.js';
import {
  createPageSnapshotDisplay,
  createPageSnapshotRecord,
  renderPageSnapshotLines,
  writePageSnapshotCache,
} from '../page-snapshot.js';
import { createPageMarkdown } from '../page-markdown.js';
import { getChromeControllerHome, SessionStore } from '../session-store.js';
import { sleep } from '../interaction-support.js';
import { runFindCommand } from './find.js';
import {
  captureScreenshotForTab,
  parseScreenshotOptions,
} from './screenshot.js';

import { resolveManagedCurrentTab, resolveSession } from './support.js';

import type {
  BrowserService,
  CliCommandResult,
  CliRunOptions,
} from '../types.js';

interface PageCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
  env?: CliRunOptions['env'];
}

export async function runPageCommand(
  options: PageCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'goto':
      return await runGotoPageCommand(rest, options);
    case 'url':
      return await runPageUrlCommand(rest, options);
    case 'title':
      return await runPageTitleCommand(rest, options);
    case 'text':
      return await runPageTextCommand(rest, options);
    case 'snapshot':
      return await runPageSnapshotCommand(rest, options);
    case 'find':
      return await runFindCommand({
        ...options,
        args: rest,
      });
    case 'eval':
      return await runPageEvalCommand(rest, options);
    case 'pdf':
      return await runPagePdfCommand(rest, options);
    case 'screenshot':
      return await runPageScreenshotCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createPageHelpLines(),
      };
    default:
      throw new Error(`Unknown page command: ${subcommand}`);
  }
}

async function runGotoPageCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  const [url, ...rest] = rawArgs;
  if (!url) {
    throw new Error('Usage: chrome-controller page goto <url>');
  }
  if (rest.length > 0) {
    throw new Error(`Unknown option for page goto: ${rest[0]}`);
  }

  const { session, tab } = await resolvePageTab(options);
  const updatedTab = await options.browserService.navigateTab(session, tab.id, url);
  const resolvedTab = await resolveNavigatedTab(
    options.browserService,
    session,
    updatedTab,
    url,
    tab.url
  );

  return {
    session,
    data: {
      tab: resolvedTab,
      requestedUrl: url,
    },
    lines: [formatGotoResultLine(resolvedTab, url, tab.id)],
  };
}

async function runPageUrlCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option for page url: ${rawArgs[0]}`);
  }

  const { session, tab } = await resolvePageTab(options);

  return {
    session,
    data: {
      tabId: tab.id,
      url: tab.url,
    },
    lines: [tab.url ?? 'No URL'],
  };
}

async function runPageTitleCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option for page title: ${rawArgs[0]}`);
  }

  const { session, tab } = await resolvePageTab(options);

  return {
    session,
    data: {
      tabId: tab.id,
      title: tab.title,
    },
    lines: [tab.title ?? 'No title'],
  };
}

async function runPageTextCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option for page text: ${rawArgs[0]}`);
  }

  const { session, tab } = await resolvePageTab(options);
  const tabId = requireTabId(tab, 'text');
  const rawTextCapture = await captureStablePageText(options.browserService, session, tabId);
  const pageMarkdown = createPageMarkdown(rawTextCapture);

  return {
    session,
    data: {
      tabId,
      title: pageMarkdown.title,
      url: pageMarkdown.url,
      markdown: pageMarkdown.markdown,
    },
    lines: pageMarkdown.markdown ? pageMarkdown.markdown.split('\n') : [''],
  };
}

async function runPageEvalCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  const parsed = parsePageEvalArgs(rawArgs);
  const { session, tab } = await resolvePageTab(options);
  const tabId = requireTabId(tab, 'eval');
  const result = await options.browserService.evaluateTab(session, tabId, parsed.code, {
    ...(parsed.awaitPromise ? { awaitPromise: true } : {}),
    ...(parsed.userGesture ? { userGesture: true } : {}),
  });

  return {
    session,
    data: {
      tabId,
      result,
    },
    lines: [formatEvalResult(result)],
  };
}

async function runPageSnapshotCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option for page snapshot: ${rawArgs[0]}`);
  }

  const { session, tab } = await resolvePageTab(options);
  const tabId = requireTabId(tab, 'snapshot');
  const rawSnapshot = await captureStablePageSnapshot(options.browserService, session, tabId);
  const snapshotRecord = createPageSnapshotRecord({
    sessionId: session.id,
    tabId,
    raw: rawSnapshot,
  });
  const snapshotDisplay = createPageSnapshotDisplay(snapshotRecord);

  await writePageSnapshotCache(options.env, snapshotRecord);

  return {
    session,
    data: {
      source: snapshotRecord.source,
      snapshotId: snapshotRecord.snapshotId,
      capturedAt: snapshotRecord.capturedAt,
      tabId: snapshotRecord.tabId,
      title: snapshotRecord.title,
      url: snapshotRecord.url,
      elements: snapshotDisplay.elements,
      count: snapshotRecord.count,
      visibleCount: snapshotRecord.visibleCount,
      displayedCount: snapshotDisplay.displayedCount,
      scope: snapshotDisplay.scope,
      truncated: snapshotDisplay.truncated,
    },
    lines: renderPageSnapshotLines(snapshotRecord),
  };
}

async function runPagePdfCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  const parsed = parsePagePdfArgs(rawArgs, options.env);
  const { session, tab } = await resolvePageTab(options);
  const tabId = requireTabId(tab, 'pdf');
  const pdf = await options.browserService.printToPdf(session, tabId, {
    ...(parsed.landscape ? { landscape: true } : {}),
    ...(parsed.printBackground ? { printBackground: true } : {}),
    ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
    ...(parsed.paperWidth !== undefined ? { paperWidth: parsed.paperWidth } : {}),
    ...(parsed.paperHeight !== undefined ? { paperHeight: parsed.paperHeight } : {}),
    ...(parsed.preferCSSPageSize ? { preferCSSPageSize: true } : {}),
  });

  await mkdir(dirname(parsed.outputPath), { recursive: true });
  const buffer = Buffer.from(pdf.dataBase64, 'base64');
  await writeFile(parsed.outputPath, buffer);

  return {
    session,
    data: {
      tabId,
      path: parsed.outputPath,
      sizeBytes: buffer.byteLength,
      landscape: parsed.landscape,
      printBackground: parsed.printBackground,
      format: parsed.format,
      preferCSSPageSize: parsed.preferCSSPageSize,
      ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
    },
    lines: [`Saved PDF for tab ${tabId} to ${parsed.outputPath}`],
  };
}

async function runPageScreenshotCommand(
  rawArgs: string[],
  options: PageCommandOptions
): Promise<CliCommandResult> {
  const parsed = parseScreenshotOptions(rawArgs, options.env);
  const { session, tab } = await resolvePageTab(options);
  const tabId = requireTabId(tab, 'screenshot');
  const result = await captureScreenshotForTab(
    options.browserService,
    session,
    tabId,
    parsed
  );

  return {
    session,
    data: {
      tabId,
      path: parsed.outputPath,
      format: parsed.format,
      mimeType: `image/${parsed.format === 'jpeg' ? 'jpeg' : parsed.format}`,
      sizeBytes: result.sizeBytes,
    },
    lines: [`Saved screenshot for tab ${tabId} to ${parsed.outputPath}`],
  };
}

function parsePageEvalArgs(args: string[]): {
  code: string;
  awaitPromise: boolean;
  userGesture: boolean;
} {
  let code: string | undefined;
  let awaitPromise = false;
  let userGesture = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--await-promise') {
      awaitPromise = true;
      continue;
    }
    if (arg === '--user-gesture') {
      userGesture = true;
      continue;
    }
    if (arg === '--code') {
      code = readRequiredOptionValue(args, index, '--code');
      index += 1;
      continue;
    }
    if (arg.startsWith('--code=')) {
      code = arg.slice('--code='.length);
      continue;
    }
    if (!arg.startsWith('-') && !code) {
      code = arg;
      continue;
    }

    throw new Error(`Unknown option for page eval: ${arg}`);
  }

  if (!code) {
    throw new Error(
      'Usage: chrome-controller page eval <code> [--await-promise] [--user-gesture]'
    );
  }

  return {
    code,
    awaitPromise,
    userGesture,
  };
}

async function resolveNavigatedTab(
  browserService: BrowserService,
  session: Awaited<ReturnType<typeof resolveSession>>,
  initialTab: Awaited<ReturnType<BrowserService['navigateTab']>>,
  requestedUrl: string,
  previousUrl: string | null
): Promise<Awaited<ReturnType<BrowserService['navigateTab']>>> {
  let latestTab = initialTab;

  if (isResolvedNavigationTab(latestTab, requestedUrl, previousUrl)) {
    return latestTab;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(100);
    latestTab = await browserService.getTab(session, initialTab.id as number);
    if (isResolvedNavigationTab(latestTab, requestedUrl, previousUrl)) {
      return latestTab;
    }
  }

  return latestTab;
}

function formatGotoResultLine(
  tab: Awaited<ReturnType<typeof resolveNavigatedTab>>,
  requestedUrl: string,
  fallbackTabId: number
): string {
  const parts = [`Navigated tab ${tab.id ?? fallbackTabId} to ${tab.url ?? requestedUrl}`];

  if (tab.title) {
    parts.push(JSON.stringify(tab.title));
  }

  return parts.join(' ');
}

function isResolvedNavigationTab(
  tab: Awaited<ReturnType<BrowserService['navigateTab']>>,
  requestedUrl: string,
  previousUrl: string | null
): boolean {
  if (tab.url === requestedUrl) {
    return true;
  }

  if (tab.url && previousUrl && tab.url !== previousUrl) {
    return true;
  }

  if (tab.url && !previousUrl) {
    return true;
  }

  return false;
}

function parsePagePdfArgs(
  args: string[],
  env: CliRunOptions['env']
): {
  outputPath: string;
  format: 'letter' | 'a4' | 'legal' | 'tabloid';
  landscape: boolean;
  printBackground: boolean;
  preferCSSPageSize: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
} {
  let outputPath: string | undefined;
  let format: 'letter' | 'a4' | 'legal' | 'tabloid' = 'letter';
  let landscape = false;
  let printBackground = false;
  let preferCSSPageSize = false;
  let scale: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('-') && !outputPath) {
      outputPath = resolve(withPdfExtension(arg));
      continue;
    }
    if (arg === '--format') {
      format = parsePdfFormat(readRequiredOptionValue(args, index, '--format'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) {
      format = parsePdfFormat(arg.slice('--format='.length));
      continue;
    }
    if (arg === '--landscape') {
      landscape = true;
      continue;
    }
    if (arg === '--background') {
      printBackground = true;
      continue;
    }
    if (arg === '--css-page-size') {
      preferCSSPageSize = true;
      continue;
    }
    if (arg === '--scale') {
      scale = parseScale(readRequiredOptionValue(args, index, '--scale'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--scale=')) {
      scale = parseScale(arg.slice('--scale='.length));
      continue;
    }

    throw new Error(`Unknown option for page pdf: ${arg}`);
  }

  if (!outputPath) {
    outputPath = resolveDefaultPdfPath(env);
  }

  const paperSize = resolvePaperSize(format);

  return {
    outputPath,
    format,
    landscape,
    printBackground,
    preferCSSPageSize,
    ...(scale !== undefined ? { scale } : {}),
    paperWidth: paperSize.width,
    paperHeight: paperSize.height,
  };
}

function formatEvalResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result === undefined) {
    return 'undefined';
  }

  return JSON.stringify(result, null, 2);
}

function parsePdfFormat(value: string): 'letter' | 'a4' | 'legal' | 'tabloid' {
  if (value === 'letter' || value === 'a4' || value === 'legal' || value === 'tabloid') {
    return value;
  }

  throw new Error(`Invalid PDF format: ${value}`);
}

function resolvePaperSize(format: 'letter' | 'a4' | 'legal' | 'tabloid'): {
  width: number;
  height: number;
} {
  switch (format) {
    case 'a4':
      return { width: 8.27, height: 11.69 };
    case 'legal':
      return { width: 8.5, height: 14 };
    case 'tabloid':
      return { width: 11, height: 17 };
    case 'letter':
    default:
      return { width: 8.5, height: 11 };
  }
}

function parseScale(value: string): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Invalid number value for --scale: ${value}`);
  }

  return Math.max(0.1, Math.min(2, scale));
}

function withPdfExtension(path: string): string {
  return extname(path).toLowerCase() === '.pdf' ? path : `${path}.pdf`;
}

function resolveDefaultPdfPath(env: CliRunOptions['env']): string {
  const home = getChromeControllerHome(env);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(home, 'artifacts', 'pdfs', `page-${timestamp}.pdf`);
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function createPageHelpLines(): string[] {
  return [
    'Page commands',
    '',
    "All page commands act on the active session's current tab.",
    'Use `tabs use <tabId>` to switch which tab page commands operate on.',
    '',
    'Usage:',
    '  chrome-controller page goto <url>',
    '  chrome-controller page url',
    '  chrome-controller page title',
    '  chrome-controller page text',
    '  chrome-controller page snapshot',
    '  chrome-controller page find <query> [--limit <n>]',
    '  chrome-controller page eval <code> [--await-promise] [--user-gesture]',
    '  chrome-controller page pdf [path] [--format <letter|a4|legal|tabloid>] [--landscape] [--background] [--scale <number>] [--css-page-size]',
    '  chrome-controller page screenshot [path] [--format <png|jpeg|webp>] [--quality <0-100>] [--full-page]',
    '',
    'Notes:',
    '  When no PDF path is provided, the file is saved under CHROME_CONTROLLER_HOME/artifacts/pdfs.',
    '  When no screenshot path is provided, the file is saved under CHROME_CONTROLLER_HOME/artifacts/screenshots.',
    '  Snapshot output is interactive-first and saves the latest ref map per session/tab.',
    '  Top-level `open <url>` is the safer way to move to a known URL while reusing an exact match in the managed window when possible.',
  ];
}

async function resolvePageTab(
  options: PageCommandOptions
): Promise<Awaited<ReturnType<typeof resolveManagedCurrentTab>>> {
  return await resolveManagedCurrentTab(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
}

function requireTabId(tab: { id: number | null }, commandName: string): number {
  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve a tab id for page ${commandName}`);
  }

  return tab.id;
}
