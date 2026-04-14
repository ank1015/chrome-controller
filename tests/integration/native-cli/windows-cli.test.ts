import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type { BrowserService } from '../../../src/native-cli/types.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {}

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

describe('native CLI windows commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-windows-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('shows the managed session window and auto-creates it when needed', async () => {
    const outcome = await runCliCommand(['windows', 'info', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data.window).toEqual({
      id: 11,
      focused: false,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 0,
      tabs: [],
      activeTab: null,
      bounds: { left: null, top: null, width: null, height: null },
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
        method: 'getWindow',
        sessionId: 's1',
        payload: 11,
      },
    ]);
  });

  it('focuses the active session window', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const outcome = await runCliCommand(['windows', 'focus', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('alpha');
    expect(payload.data.window.focused).toBe(true);
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'focusWindow',
        sessionId: 'alpha',
        payload: 11,
      },
    ]);
  });

  it('resizes and moves the active session window', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const resize = await runCliCommand(
      ['windows', 'resize', '1440', '900', '--json'],
      tempHome,
      browserService,
      now
    );
    const move = await runCliCommand(
      ['windows', 'move', '-20', '30', '--json'],
      tempHome,
      browserService,
      now
    );

    const resizePayload = JSON.parse(resize.stdout);
    const movePayload = JSON.parse(move.stdout);

    expect(resize.exitCode).toBe(0);
    expect(move.exitCode).toBe(0);
    expect(resizePayload.data.window.bounds).toEqual({
      left: null,
      top: null,
      width: 1440,
      height: 900,
    });
    expect(movePayload.data.window.bounds).toEqual({
      left: -20,
      top: 30,
      width: 1440,
      height: 900,
    });
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            width: 1440,
            height: 900,
          },
        },
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            left: -20,
            top: 30,
          },
        },
      },
    ]);
  });

  it('maximizes, minimizes, and restores the active session window', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const maximize = await runCliCommand(['windows', 'maximize', '--json'], tempHome, browserService, now);
    const minimize = await runCliCommand(['windows', 'minimize', '--json'], tempHome, browserService, now);
    const restore = await runCliCommand(['windows', 'restore', '--json'], tempHome, browserService, now);

    const maximizePayload = JSON.parse(maximize.stdout);
    const minimizePayload = JSON.parse(minimize.stdout);
    const restorePayload = JSON.parse(restore.stdout);

    expect(maximize.exitCode).toBe(0);
    expect(minimize.exitCode).toBe(0);
    expect(restore.exitCode).toBe(0);
    expect(maximizePayload.data.window.state).toBe('maximized');
    expect(minimizePayload.data.window.state).toBe('minimized');
    expect(restorePayload.data.window.state).toBe('normal');
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            state: 'maximized',
          },
        },
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            state: 'minimized',
          },
        },
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            state: 'normal',
          },
        },
      },
    ]);
  });

  it('restores to normal before resizing a maximized window', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    await runCliCommand(['windows', 'maximize', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const outcome = await runCliCommand(
      ['windows', 'resize', '1200', '800', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.window.state).toBe('normal');
    expect(payload.data.window.bounds).toEqual({
      left: null,
      top: null,
      width: 1200,
      height: 800,
    });
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            state: 'normal',
          },
        },
      },
      {
        method: 'updateWindow',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          options: {
            width: 1200,
            height: 800,
          },
        },
      },
    ]);
  });
});
