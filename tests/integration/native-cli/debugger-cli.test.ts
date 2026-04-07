import { mkdtemp, rm } from 'node:fs/promises';
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
    title: overrides.title ?? 'Tab',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  private readonly tabs = [
    createTab({ id: 101, active: true, title: 'Active tab', url: 'https://example.com' }),
    createTab({ id: 102, active: false, title: 'Other tab', url: 'https://openai.com', index: 1 }),
  ];

  private readonly attachedTabs = new Set<number>();
  private readonly events = new Map<number, CliDebuggerEvent[]>([
    [
      101,
      [
        { method: 'Network.requestWillBeSent', params: { requestId: '1' } },
        { method: 'Page.loadEventFired', params: { timestamp: 1 } },
        { method: 'Network.responseReceived', params: { requestId: '1', status: 200 } },
      ],
    ],
  ]);

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return this.tabs.map((tab) => ({ ...tab }));
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return { ...tab };
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

    const alreadyAttached = this.attachedTabs.has(tabId);
    this.attachedTabs.add(tabId);
    return {
      attached: true,
      alreadyAttached,
    };
  }

  async detachDebugger(
    session: CliSessionRecord,
    tabId: number
  ): Promise<{ detached: boolean }> {
    this.calls.push({
      method: 'detachDebugger',
      sessionId: session.id,
      payload: tabId,
    });

    this.attachedTabs.delete(tabId);
    return {
      detached: true,
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

    return {
      ok: true,
      method,
      params: params ?? null,
    };
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
    const matching = options.filter
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

    return matching.map((event) => ({ ...event, params: { ...event.params } }));
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

describe('native CLI debugger commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-debugger-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('attaches to the current active tab by default', async () => {
    const outcome = await runCliCommand(['debugger', 'attach', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data).toEqual({
      tabId: 101,
      attached: true,
      alreadyAttached: false,
    });
    expect(browserService.calls).toEqual([
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          currentWindow: true,
        },
      },
      {
        method: 'attachDebugger',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('sends raw CDP commands with params json', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const outcome = await runCliCommand(
      [
        'debugger',
        'cmd',
        'Network.enable',
        '--params-json',
        '{"maxTotalBufferSize":4096}',
        '--tab',
        '102',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('alpha');
    expect(payload.data).toEqual({
      tabId: 102,
      method: 'Network.enable',
      result: {
        ok: true,
        method: 'Network.enable',
        params: {
          maxTotalBufferSize: 4096,
        },
      },
    });
    expect(browserService.calls.at(-1)).toEqual({
      method: 'sendDebuggerCommand',
      sessionId: 'alpha',
      payload: {
        tabId: 102,
        method: 'Network.enable',
        params: {
          maxTotalBufferSize: 4096,
        },
      },
    });
  });

  it('reads limited event slices and clears filtered events', async () => {
    const events = await runCliCommand(
      ['debugger', 'events', '--filter', 'Network.', '--limit', '1', '--tab', '101', '--json'],
      tempHome,
      browserService,
      now
    );
    const clear = await runCliCommand(
      ['debugger', 'clear-events', '--filter', 'Network.', '--tab', '101', '--json'],
      tempHome,
      browserService,
      now
    );
    const detach = await runCliCommand(['debugger', 'detach', '--tab', '101', '--json'], tempHome, browserService, now);

    const eventsPayload = JSON.parse(events.stdout);
    const clearPayload = JSON.parse(clear.stdout);
    const detachPayload = JSON.parse(detach.stdout);

    expect(events.exitCode).toBe(0);
    expect(clear.exitCode).toBe(0);
    expect(detach.exitCode).toBe(0);
    expect(eventsPayload.data).toEqual({
      tabId: 101,
      filter: 'Network.',
      count: 1,
      totalCount: 2,
      truncated: true,
      cleared: false,
      events: [{ method: 'Network.responseReceived', params: { requestId: '1', status: 200 } }],
    });
    expect(clearPayload.data).toEqual({
      tabId: 101,
      filter: 'Network.',
      clearedCount: 2,
    });
    expect(detachPayload.data).toEqual({
      tabId: 101,
      detached: true,
    });
  });
});
