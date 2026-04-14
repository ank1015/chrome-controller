import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliDebuggerEvent,
  CliListTabsOptions,
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
    active: overrides.active ?? false,
    pinned: false,
    audible: false,
    muted: false,
    title: overrides.title ?? 'Network tab',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  private readonly tabs = [createTab({ id: 101, active: true })];
  private readonly events = new Map<number, CliDebuggerEvent[]>([
    [
      101,
      [
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'req-1',
            timestamp: 1,
            wallTime: 1_700_000_000,
            type: 'Document',
            request: {
              url: 'https://example.com?token=secret-token',
              method: 'GET',
            },
          },
        },
        {
          method: 'Network.responseReceived',
          params: {
            requestId: 'req-1',
            type: 'Document',
            response: {
              url: 'https://example.com?token=secret-token',
              status: 200,
              mimeType: 'text/html',
              protocol: 'h2',
              headers: {
                authorization: 'Bearer top-secret',
                'set-cookie': 'session=abc123',
              },
            },
          },
        },
        {
          method: 'Network.loadingFinished',
          params: {
            requestId: 'req-1',
            timestamp: 1.2,
            encodedDataLength: 321,
          },
        },
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'req-2',
            timestamp: 2,
            wallTime: 1_700_000_001,
            type: 'XHR',
            request: {
              url: 'https://api.example.com/data',
              method: 'POST',
            },
          },
        },
        {
          method: 'Network.loadingFailed',
          params: {
            requestId: 'req-2',
            timestamp: 2.1,
            errorText: 'ERR_CONNECTION_RESET',
          },
        },
      ],
    ],
  ]);

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { windowId: 11 }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return this.tabs.map((tab) => ({ ...tab }));
  }

  async attachDebugger(
    session: CliSessionRecord,
    tabId: number
  ): Promise<{ attached: boolean; alreadyAttached: boolean }> {
    this.calls.push({
      method: 'attachDebugger',
      sessionId: session.id,
      payload: tabId,
    });

    return {
      attached: true,
      alreadyAttached: true,
    };
  }

  async sendDebuggerCommand(
    session: CliSessionRecord,
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    this.calls.push({
      method: 'sendDebuggerCommand',
      sessionId: session.id,
      payload: {
        tabId,
        method,
        params: params ?? null,
      },
    });

    return {};
  }

  async getDebuggerEvents(
    session: CliSessionRecord,
    tabId: number,
    options: { filter?: string; clear?: boolean } = {}
  ): Promise<CliDebuggerEvent[]> {
    this.calls.push({
      method: 'getDebuggerEvents',
      sessionId: session.id,
      payload: {
        tabId,
        options,
      },
    });

    const existing = [...(this.events.get(tabId) ?? [])];
    const filtered = options.filter
      ? existing.filter((event) => event.method.startsWith(options.filter as string))
      : existing;

    if (options.clear) {
      if (options.filter) {
        this.events.set(
          tabId,
          existing.filter((event) => !event.method.startsWith(options.filter as string))
        );
      } else {
        this.events.set(tabId, []);
      }
    }

    return filtered.map((event) => ({ ...event, params: { ...event.params } }));
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

describe('native CLI network commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-network-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('starts capture and summarizes existing network traffic', async () => {
    const start = await runCliCommand(
      ['observe', 'network', 'start', '--no-clear', '--disable-cache', '--json'],
      tempHome,
      browserService,
      now
    );
    const summary = await runCliCommand(
      ['observe', 'network', 'summary', '--json'],
      tempHome,
      browserService,
      now
    );

    const startPayload = JSON.parse(start.stdout);
    const summaryPayload = JSON.parse(summary.stdout);

    expect(start.exitCode).toBe(0);
    expect(summary.exitCode).toBe(0);
    expect(startPayload.data).toEqual({
      tabId: 101,
      attached: true,
      alreadyAttached: true,
      cleared: false,
      disableCache: true,
    });
    expect(summaryPayload.data.summary).toEqual(
      expect.objectContaining({
        totalRequests: 2,
        totalFailures: 1,
        totalResponses: 1,
        thirdPartyRequests: 0,
      })
    );
  });

  it('lists requests, gets an individual request, clears, and exports har', async () => {
    const list = await runCliCommand(
      ['observe', 'network', 'list', '--failed', '--json'],
      tempHome,
      browserService,
      now
    );
    const get = await runCliCommand(
      ['observe', 'network', 'get', 'req-1', '--json'],
      tempHome,
      browserService,
      now
    );
    const harPath = join(tempHome, 'artifacts', 'capture.har');
    const exportHar = await runCliCommand(
      ['observe', 'network', 'export-har', harPath, '--json'],
      tempHome,
      browserService,
      now
    );
    const clear = await runCliCommand(
      ['observe', 'network', 'clear', '--json'],
      tempHome,
      browserService,
      now
    );

    const listPayload = JSON.parse(list.stdout);
    const getPayload = JSON.parse(get.stdout);
    const exportPayload = JSON.parse(exportHar.stdout);
    const clearPayload = JSON.parse(clear.stdout);
    const harFile = JSON.parse(await readFile(harPath, 'utf8'));

    expect(list.exitCode).toBe(0);
    expect(get.exitCode).toBe(0);
    expect(exportHar.exitCode).toBe(0);
    expect(clear.exitCode).toBe(0);
    expect(listPayload.data.requests).toEqual([
      expect.objectContaining({ requestId: 'req-2', failed: true }),
    ]);
    expect(getPayload.data.request).toEqual(
      expect.objectContaining({
        requestId: 'req-1',
        status: 200,
        url: 'https://example.com/?token=%5BREDACTED%5D',
      })
    );
    expect(getPayload.data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            response: expect.objectContaining({
              headers: expect.objectContaining({
                authorization: '[REDACTED]',
                'set-cookie': '[REDACTED]',
              }),
            }),
          }),
        }),
      ])
    );
    expect(exportPayload.data.entryCount).toBe(2);
    expect(harFile.log.entries).toHaveLength(2);
    expect(clearPayload.data.clearedCount).toBe(5);
  });

  it('applies blocking, offline, throttle, and stop commands', async () => {
    const block = await runCliCommand(
      ['observe', 'network', 'block', '*://*.ads.com/*', '*://tracker.example/*', '--json'],
      tempHome,
      browserService,
      now
    );
    const offline = await runCliCommand(
      ['observe', 'network', 'offline', 'on', '--json'],
      tempHome,
      browserService,
      now
    );
    const throttle = await runCliCommand(
      ['observe', 'network', 'throttle', 'fast-3g', '--json'],
      tempHome,
      browserService,
      now
    );
    const stop = await runCliCommand(
      ['observe', 'network', 'stop', '--json'],
      tempHome,
      browserService,
      now
    );

    const blockPayload = JSON.parse(block.stdout);
    const offlinePayload = JSON.parse(offline.stdout);
    const throttlePayload = JSON.parse(throttle.stdout);
    const stopPayload = JSON.parse(stop.stdout);

    expect(block.exitCode).toBe(0);
    expect(offline.exitCode).toBe(0);
    expect(throttle.exitCode).toBe(0);
    expect(stop.exitCode).toBe(0);
    expect(blockPayload.data.patterns).toEqual(['*://*.ads.com/*', '*://tracker.example/*']);
    expect(offlinePayload.data.offline).toBe(true);
    expect(throttlePayload.data.preset).toBe('fast-3g');
    expect(stopPayload.data).toEqual({
      tabId: 101,
      stopped: true,
    });
  });

  it('summarizes network activity through the observe surface', async () => {
    const outcome = await runCliCommand(
      ['observe', 'network', 'summary', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.summary).toEqual(
      expect.objectContaining({
        totalRequests: 2,
        totalFailures: 1,
        totalResponses: 1,
      })
    );
  });
});
