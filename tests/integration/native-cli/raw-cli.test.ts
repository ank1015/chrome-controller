import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
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
    title: overrides.title ?? 'Raw tab',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  private readonly tabs = [
    createTab({ id: 101, active: true, title: 'Active raw tab' }),
  ];

  private readonly attachedTabs = new Set<number>();

  async callBrowserMethod(method: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({
      method: 'callBrowserMethod',
      payload: {
        method,
        args,
      },
    });

    return {
      ok: true,
      method,
      args,
    };
  }

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

describe('native CLI raw commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-raw-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('calls raw browser methods without resolving a session', async () => {
    const outcome = await runCliCommand(
      ['raw', 'browser', 'tabs.update', '[101,{"active":true}]', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBeNull();
    expect(payload.data).toEqual({
      method: 'tabs.update',
      args: [101, { active: true }],
      result: {
        ok: true,
        method: 'tabs.update',
        args: [101, { active: true }],
      },
    });
    expect(browserService.calls).toEqual([
      {
        method: 'callBrowserMethod',
        payload: {
          method: 'tabs.update',
          args: [101, { active: true }],
        },
      },
    ]);
  });

  it('calls raw cdp on the active session tab and detaches when needed', async () => {
    const outcome = await runCliCommand(
      [
        'raw',
        'cdp',
        'Runtime.evaluate',
        '{"expression":"document.title","returnByValue":true}',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data).toEqual({
      tabId: 101,
      method: 'Runtime.evaluate',
      params: {
        expression: 'document.title',
        returnByValue: true,
      },
      attached: true,
      alreadyAttached: false,
      result: {
        ok: true,
        method: 'Runtime.evaluate',
        params: {
          expression: 'document.title',
          returnByValue: true,
        },
      },
    });
    expect(browserService.calls).toEqual([
      {
        method: 'createWindow',
        sessionId: 's1',
        payload: {
          focused: false,
        },
      },
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          windowId: 11,
        },
      },
      {
        method: 'attachDebugger',
        sessionId: 's1',
        payload: 101,
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Runtime.evaluate',
          params: {
            expression: 'document.title',
            returnByValue: true,
          },
        },
      },
      {
        method: 'detachDebugger',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });
});
