import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type { BrowserService, CliSessionRecord, CliTabInfo } from '../../../src/native-cli/types.js';

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
    title: overrides.title ?? 'Mouse test',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  async listTabs(session: CliSessionRecord): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: {
        windowId: 11,
      },
    });

    return [createTab()];
  }

  async activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'activateTab',
      sessionId: session.id,
      payload: tabId,
    });

    return createTab({ id: tabId, active: true });
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
      alreadyAttached: false,
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

    return {};
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

describe('native CLI mouse commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-mouse-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('dispatches a right-click sequence at explicit coordinates', async () => {
    const outcome = await runCliCommand(
      ['mouse', 'click', '10', '20', '--button', 'right', '--count', '2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      x: 10,
      y: 20,
      button: 'right',
      count: 2,
    });
    expect(
      browserService.calls.filter((call) => call.method === 'sendDebuggerCommand')
    ).toEqual([
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseMoved',
            x: 10,
            y: 20,
            button: 'none',
            buttons: 0,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mousePressed',
            x: 10,
            y: 20,
            button: 'right',
            buttons: 2,
            clickCount: 1,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseReleased',
            x: 10,
            y: 20,
            button: 'right',
            buttons: 0,
            clickCount: 1,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mousePressed',
            x: 10,
            y: 20,
            button: 'right',
            buttons: 2,
            clickCount: 2,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseReleased',
            x: 10,
            y: 20,
            button: 'right',
            buttons: 0,
            clickCount: 2,
          },
        },
      },
    ]);
  });

  it('drags across a tab with interpolated mouse move steps', async () => {
    const outcome = await runCliCommand(
      ['mouse', 'drag', '0', '0', '10', '20', '--steps', '2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      fromX: 0,
      fromY: 0,
      toX: 10,
      toY: 20,
      steps: 2,
    });
    expect(
      browserService.calls.filter((call) => call.method === 'sendDebuggerCommand')
    ).toEqual([
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseMoved',
            x: 0,
            y: 0,
            button: 'none',
            buttons: 0,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mousePressed',
            x: 0,
            y: 0,
            button: 'left',
            buttons: 1,
            clickCount: 1,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseMoved',
            x: 5,
            y: 10,
            button: 'left',
            buttons: 1,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseMoved',
            x: 10,
            y: 20,
            button: 'left',
            buttons: 1,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseReleased',
            x: 10,
            y: 20,
            button: 'left',
            buttons: 0,
            clickCount: 1,
          },
        },
      },
    ]);
  });
});
