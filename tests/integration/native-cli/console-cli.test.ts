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
    title: overrides.title ?? 'Console tab',
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
          method: 'Runtime.consoleAPICalled',
          params: {
            type: 'log',
            args: [{ value: 'hello' }],
            timestamp: 1,
          },
        },
        {
          method: 'Log.entryAdded',
          params: {
            entry: {
              level: 'warning',
              text: 'warn log',
              url: 'https://example.com/app.js',
              lineNumber: 9,
              timestamp: 2,
            },
          },
        },
      ],
    ],
  ]);

  private getEventsCalls = 0;

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
    this.getEventsCalls += 1;
    if (this.getEventsCalls >= 2 && !options.clear && !existing.some((event) => event.method === 'Runtime.exceptionThrown')) {
      existing.push({
        method: 'Runtime.exceptionThrown',
        params: {
          timestamp: 3,
          exceptionDetails: {
            text: 'boom',
            url: 'https://example.com/app.js',
            lineNumber: 4,
            columnNumber: 1,
          },
        },
      });
      this.events.set(tabId, existing);
    }

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

describe('native CLI console commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-console-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('lists recent console entries and enables console monitoring automatically', async () => {
    const outcome = await runCliCommand(
      ['observe', 'console', 'list', '--limit', '2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.totalCount).toBe(2);
    expect(payload.data.count).toBe(2);
    expect(payload.data.entries).toEqual([
      expect.objectContaining({ source: 'console', level: 'log', text: 'hello' }),
      expect.objectContaining({ source: 'log', level: 'warning', text: 'warn log' }),
    ]);
  });

  it('tails for new console entries and returns them without timing out', async () => {
    const outcome = await runCliCommand(
      ['observe', 'console', 'tail', '--timeout-ms', '20', '--poll-ms', '1', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.timedOut).toBe(false);
    expect(payload.data.count).toBe(1);
    expect(payload.data.entries).toEqual([
      expect.objectContaining({ source: 'exception', text: 'boom' }),
    ]);
  });

  it('clears tracked console entries', async () => {
    const outcome = await runCliCommand(
      ['observe', 'console', 'clear', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      clearedCount: 2,
    });
  });

  it('lists console entries through the observe surface', async () => {
    const outcome = await runCliCommand(
      ['observe', 'console', 'list', '--limit', '1', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.count).toBe(1);
    expect(payload.data.entries).toEqual([
      expect.objectContaining({ source: 'log', level: 'warning', text: 'warn log' }),
    ]);
  });
});
