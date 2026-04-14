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
    title: overrides.title ?? 'Keyboard test',
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
        currentWindow: true,
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

describe('native CLI keyboard commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-keyboard-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('presses a named key through the debugger input domain', async () => {
    const outcome = await runCliCommand(
      ['keyboard', 'press', 'Enter', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      key: 'Enter',
      count: 1,
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
          currentWindow: true,
        },
      },
      {
        method: 'activateTab',
        sessionId: 's1',
        payload: 101,
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
          method: 'Input.dispatchKeyEvent',
          params: {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
            text: '\r',
            unmodifiedText: '\r',
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchKeyEvent',
          params: {
            type: 'char',
            key: 'Enter',
            code: 'Enter',
            text: '\r',
            unmodifiedText: '\r',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.dispatchKeyEvent',
          params: {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
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

  it('types text as a sequence of insertText commands', async () => {
    const outcome = await runCliCommand(
      ['keyboard', 'type', 'hi', '--delay-ms', '0', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      text: 'hi',
      delayMs: 0,
    });
    expect(
      browserService.calls.filter((call) => call.method === 'sendDebuggerCommand')
    ).toEqual([
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.insertText',
          params: {
            text: 'h',
          },
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Input.insertText',
          params: {
            text: 'i',
          },
        },
      },
    ]);
  });
});
