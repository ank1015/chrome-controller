import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { writePageSnapshotCache } from '../../../src/native-cli/page-snapshot.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliDownloadInfo,
  CliDownloadsFilter,
  CliPageSnapshotCacheRecord,
  CliSessionRecord,
  CliTabInfo,
} from '../../../src/native-cli/types.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

function createTab(overrides: Partial<CliTabInfo> = {}): CliTabInfo {
  return {
    id: overrides.id ?? 101,
    windowId: overrides.windowId ?? 11,
    active: overrides.active ?? true,
    pinned: false,
    audible: false,
    muted: false,
    title: overrides.title ?? 'Wait test',
    url: overrides.url ?? 'https://example.com/dashboard',
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
  };
}

function createDownload(overrides: Partial<CliDownloadInfo> = {}): CliDownloadInfo {
  return {
    id: overrides.id ?? 9,
    url: overrides.url ?? 'https://example.com/report.pdf',
    filename: overrides.filename ?? '/tmp/report.pdf',
    state: overrides.state ?? 'complete',
    mime: overrides.mime ?? 'application/pdf',
    exists: overrides.exists ?? true,
    bytesReceived: overrides.bytesReceived ?? 100,
    totalBytes: overrides.totalBytes ?? 100,
    error: overrides.error ?? null,
  };
}

function extractDomRequest(code: string): Record<string, unknown> {
  const boundary = code.lastIndexOf(')(');
  if (boundary === -1 || !code.endsWith(')')) {
    throw new Error(`Unexpected DOM operation code: ${code}`);
  }

  return JSON.parse(code.slice(boundary + 2, -1)) as Record<string, unknown>;
}

function createSnapshotRecord(sessionId: string, tabId: number): CliPageSnapshotCacheRecord {
  return {
    version: 1,
    sessionId,
    source: 'dom-interactive-v1',
    snapshotId: 'snap-101',
    capturedAt: '2026-04-06T00:00:00.000Z',
    tabId,
    title: 'Dashboard',
    url: 'https://example.com/dashboard',
    count: 1,
    visibleCount: 1,
    truncated: false,
    elements: [
      {
        ref: '@e1',
        role: 'button',
        name: 'Continue',
        tagName: 'button',
        inputType: null,
        selector: 'button.continue',
        alternativeSelectors: ['[data-testid="continue"]'],
        placeholder: null,
        disabled: false,
        checked: null,
      },
    ],
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  async listTabs(session: CliSessionRecord): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: {
        currentWindow: true,
      },
    });

    return [createTab()];
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    return createTab({ id: tabId });
  }

  async evaluateTab(
    session: CliSessionRecord,
    tabId: number,
    code: string,
    options?: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    }
  ): Promise<unknown> {
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
        code,
        options: options ?? {},
      },
    });

    if (code.includes('Promise.resolve(true)') || code.includes('({ value: await (')) {
      return {
        value: true,
      };
    }

    const request = extractDomRequest(code);
    if (request.operation === 'exists') {
      return {
        exists: true,
        visible: true,
        enabled: true,
        matchedSelector: 'button.continue',
      };
    }

    if (request.operation === 'text-contains') {
      return {
        value: true,
        matchedSelector: 'button.continue',
      };
    }

    throw new Error(`Unexpected evaluateTab code: ${code}`);
  }

  async waitForDownload(
    session: CliSessionRecord,
    filter: CliDownloadsFilter = {},
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      requireComplete?: boolean;
    }
  ): Promise<CliDownloadInfo> {
    this.calls.push({
      method: 'waitForDownload',
      sessionId: session.id,
      payload: {
        filter,
        options,
      },
    });

    return createDownload();
  }
}

async function runCliCommand(
  args: string[],
  homeDir: string,
  browserService: BrowserService,
  now: () => Date = createNowGenerator()
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = createCapturedOutput();
  const stderr = createCapturedOutput();
  const exitCode = await runCli(args, {
    browserService,
    env: { ...process.env, CHROME_CONTROLLER_HOME: homeDir },
    stdout: stdout.stream,
    stderr: stderr.stream,
    now,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
  };
}

describe('native CLI wait commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-wait-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
    await writePageSnapshotCache(
      { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      createSnapshotRecord('s1', 101)
    );
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('waits for a cached element ref to become enabled', async () => {
    const outcome = await runCliCommand(
      ['wait', 'element', '@e1', '--state', 'enabled', '--timeout-ms', '5', '--poll-ms', '1', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e1',
      state: 'enabled',
    });
  });

  it('accepts --tab for wait idle and validates the explicit tab', async () => {
    const outcome = await runCliCommand(
      ['wait', 'idle', '5', '--tab', '101', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      ms: 5,
      tabId: 101,
    });
    expect(browserService.calls).toEqual([
      {
        method: 'getTab',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('waits for an async function condition with await-promise support', async () => {
    const outcome = await runCliCommand(
      ['wait', 'fn', 'Promise.resolve(true)', '--await-promise', '--timeout-ms', '5', '--poll-ms', '1', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      expression: 'Promise.resolve(true)',
    });
    expect(browserService.calls.some((call) => {
      if (call.method !== 'evaluateTab') {
        return false;
      }
      const payload = call.payload as { options?: { awaitPromise?: boolean } };
      return payload.options?.awaitPromise === true;
    })).toBe(true);
  });

  it('aliases wait download to the downloads wait implementation', async () => {
    const outcome = await runCliCommand(
      ['wait', 'download', '--filename-includes', 'report', '--timeout-ms', '20', '--poll-ms', '5', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.download).toEqual(
      expect.objectContaining({
        id: 9,
        filename: '/tmp/report.pdf',
      })
    );
    expect(browserService.calls.at(-1)).toEqual({
      method: 'waitForDownload',
      sessionId: 's1',
      payload: {
        filter: {
          filenameIncludes: 'report',
        },
        options: {
          timeoutMs: 20,
          pollIntervalMs: 5,
          requireComplete: true,
        },
      },
    });
  });
});
