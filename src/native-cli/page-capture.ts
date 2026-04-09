import { buildPageTextEvaluationCode } from './page-markdown.js';
import { buildPageSnapshotEvaluationCode } from './page-snapshot.js';
import { retryDetachedOperation, sleep } from './interaction-support.js';

import type { BrowserService, CliSessionRecord } from './types.js';

export async function captureStablePageText(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number
): Promise<unknown> {
  return await captureStablePagePayload({
    browserService,
    session,
    tabId,
    operationName: 'page text',
    buildCode: () => buildPageTextEvaluationCode(),
    getSignature: (payload) => {
      const object = asObject(payload);
      const html = typeof object?.html === 'string' ? object.html : '';
      return `${object?.title ?? ''}|${object?.url ?? ''}|${html.length}|${html.slice(-256)}`;
    },
  });
}

export async function captureStablePageSnapshot(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number
): Promise<unknown> {
  return await captureStablePagePayload({
    browserService,
    session,
    tabId,
    operationName: 'page snapshot',
    buildCode: () => buildPageSnapshotEvaluationCode(),
    getSignature: (payload) => {
      const object = asObject(payload);
      const elements = Array.isArray(object?.elements) ? object.elements : [];
      const elementSignature = elements
        .slice(0, 12)
        .map((element) => {
          const item = asObject(element);
          return [
            item?.role ?? '',
            item?.name ?? '',
            item?.selector ?? '',
            item?.top ?? '',
            item?.left ?? '',
          ].join('|');
        })
        .join('::');

      return `${object?.title ?? ''}|${object?.url ?? ''}|${object?.count ?? elements.length}|${elementSignature}`;
    },
  });
}

async function captureStablePagePayload(options: {
  browserService: BrowserService;
  session: CliSessionRecord;
  tabId: number;
  operationName: string;
  buildCode: () => string;
  getSignature: (payload: unknown) => string;
}): Promise<unknown> {
  let lastPayload: unknown = null;
  let lastSignature: string | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = await retryDetachedOperation(
      options.operationName,
      async () =>
        await options.browserService.evaluateTab(
          options.session,
          options.tabId,
          options.buildCode()
        ),
      {
        attempts: 3,
        delayMs: 150,
      }
    );

    const signature = options.getSignature(payload);
    if (signature === lastSignature && attempt > 0) {
      return payload;
    }

    lastPayload = payload;
    lastSignature = signature;

    if (attempt < 3) {
      await sleep(150);
    }
  }

  return lastPayload;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
