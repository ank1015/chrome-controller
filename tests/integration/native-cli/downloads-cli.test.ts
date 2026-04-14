import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliDownloadInfo,
  CliDownloadsFilter,
  CliSessionRecord,
} from '../../../src/native-cli/types.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

function createDownload(overrides: Partial<CliDownloadInfo> = {}): CliDownloadInfo {
  return {
    id: overrides.id ?? 1,
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

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  async listDownloads(
    session: CliSessionRecord,
    filter: CliDownloadsFilter = {}
  ): Promise<CliDownloadInfo[]> {
    this.calls.push({
      method: 'listDownloads',
      sessionId: session.id,
      payload: filter,
    });

    return [
      createDownload({ id: 1, filename: '/tmp/report.pdf', state: 'complete' }),
      createDownload({ id: 2, filename: '/tmp/image.png', mime: 'image/png', state: 'in_progress' }),
      createDownload({ id: 3, filename: '/tmp/archive.zip', mime: 'application/zip', state: 'interrupted' }),
    ];
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

    return createDownload({ id: 9, filename: '/tmp/match.pdf', state: 'complete' });
  }

  async cancelDownloads(session: CliSessionRecord, downloadIds: number[]): Promise<void> {
    this.calls.push({
      method: 'cancelDownloads',
      sessionId: session.id,
      payload: downloadIds,
    });
  }

  async eraseDownloads(session: CliSessionRecord, downloadIds: number[]): Promise<void> {
    this.calls.push({
      method: 'eraseDownloads',
      sessionId: session.id,
      payload: downloadIds,
    });
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

describe('native CLI downloads commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-downloads-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('lists downloads with filters and a compact limit', async () => {
    const outcome = await runCliCommand(
      ['observe', 'downloads', 'list', '--state', 'complete', '--limit', '2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.count).toBe(2);
    expect(payload.data.totalCount).toBe(3);
    expect(payload.data.truncated).toBe(true);
    expect(payload.data.filter).toEqual({
      state: 'complete',
    });
  });

  it('waits for a matching download with timeout options', async () => {
    const outcome = await runCliCommand(
      [
        'observe',
        'downloads',
        'wait',
        '--filename-includes',
        'report',
        '--timeout-ms',
        '2000',
        '--poll-ms',
        '100',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.download).toEqual(
      expect.objectContaining({
        id: 9,
        filename: '/tmp/match.pdf',
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
          timeoutMs: 2000,
          pollIntervalMs: 100,
          requireComplete: true,
        },
      },
    });
  });

  it('cancels and erases downloads by id', async () => {
    const cancel = await runCliCommand(
      ['observe', 'downloads', 'cancel', '2', '3', '--json'],
      tempHome,
      browserService,
      now
    );
    const erase = await runCliCommand(
      ['observe', 'downloads', 'erase', '1', '--json'],
      tempHome,
      browserService,
      now
    );

    const cancelPayload = JSON.parse(cancel.stdout);
    const erasePayload = JSON.parse(erase.stdout);

    expect(cancel.exitCode).toBe(0);
    expect(erase.exitCode).toBe(0);
    expect(cancelPayload.data).toEqual({
      downloadIds: [2, 3],
      cancelled: true,
    });
    expect(erasePayload.data).toEqual({
      downloadIds: [1],
      erased: true,
    });
  });
});
