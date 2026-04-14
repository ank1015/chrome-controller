import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { getChromeControllerHome } from '../session-store.js';

import { parsePositiveInteger } from './support.js';

import type { BrowserService, CliRunOptions, CliSessionRecord } from '../types.js';

interface CaptureScreenshotResult {
  data?: string;
}

export interface ParsedScreenshotOptions {
  outputPath: string;
  format: 'png' | 'jpeg' | 'webp';
  quality?: number;
  fullPage: boolean;
}

export function parseScreenshotOptions(
  args: string[],
  env: CliRunOptions['env']
): ParsedScreenshotOptions {
  let outputPath: string | undefined;
  let format: 'png' | 'jpeg' | 'webp' = 'png';
  let quality: number | undefined;
  let fullPage = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('-') && !outputPath) {
      outputPath = resolve(arg);
      const inferred = inferFormatFromPath(outputPath);
      if (inferred) {
        format = inferred;
      }
      continue;
    }

    if (arg === '--format') {
      format = parseScreenshotFormat(readRequiredOptionValue(args, index, '--format'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) {
      format = parseScreenshotFormat(arg.slice('--format='.length));
      continue;
    }
    if (arg === '--quality') {
      quality = clampQuality(
        parsePositiveInteger(readRequiredOptionValue(args, index, '--quality'), '--quality')
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = clampQuality(parsePositiveInteger(arg.slice('--quality='.length), '--quality'));
      continue;
    }
    if (arg === '--full-page') {
      fullPage = true;
      continue;
    }

    throw new Error(`Unknown option for screenshot take: ${arg}`);
  }

  if (!outputPath) {
    outputPath = resolveDefaultScreenshotPath(env, format);
  }

  if (format !== 'jpeg') {
    quality = undefined;
  }

  return {
    outputPath,
    format,
    ...(quality !== undefined ? { quality } : {}),
    fullPage,
  };
}

export async function captureScreenshotForTab(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  parsed: ParsedScreenshotOptions
): Promise<{ sizeBytes: number }> {
  const attachResult = await browserService.attachDebugger(session, tabId);

  try {
    await browserService.sendDebuggerCommand(session, tabId, 'Page.enable');

    const result = await browserService.sendDebuggerCommand(
      session,
      tabId,
      'Page.captureScreenshot',
      {
        format: parsed.format,
        ...(parsed.quality !== undefined ? { quality: parsed.quality } : {}),
        ...(parsed.fullPage ? { captureBeyondViewport: true } : {}),
      }
    ) as CaptureScreenshotResult;

    const dataBase64 = result.data ?? '';
    if (!dataBase64) {
      throw new Error(`Failed to capture screenshot for tab ${tabId}`);
    }

    await mkdir(dirname(parsed.outputPath), { recursive: true });
    const buffer = Buffer.from(dataBase64, 'base64');
    await writeFile(parsed.outputPath, buffer);

    return {
      sizeBytes: buffer.byteLength,
    };
  } finally {
    if (!attachResult.alreadyAttached) {
      await browserService.detachDebugger(session, tabId);
    }
  }
}

function inferFormatFromPath(path: string): 'png' | 'jpeg' | 'webp' | null {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') {
    return 'png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg';
  }
  if (extension === '.webp') {
    return 'webp';
  }

  return null;
}

function parseScreenshotFormat(value: string): 'png' | 'jpeg' | 'webp' {
  if (value === 'png' || value === 'jpeg' || value === 'webp') {
    return value;
  }

  throw new Error(`Invalid screenshot format: ${value}`);
}

function clampQuality(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function resolveDefaultScreenshotPath(
  env: CliRunOptions['env'],
  format: 'png' | 'jpeg' | 'webp'
): string {
  const home = getChromeControllerHome(env);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return join(home, 'artifacts', 'screenshots', `screenshot-${timestamp}.${extension}`);
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}
