import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliCloseOtherTabsOptions,
  CliCreateWindowOptions,
  CliListTabsOptions,
  CliMoveTabOptions,
  CliOpenTabOptions,
  CliSessionRecord,
  CliTabInfo,
  CliWindowInfo,
} from '../../../src/native-cli/types.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {

  async listWindows(session: CliSessionRecord): Promise<CliWindowInfo[]> {
    this.calls.push({
      method: 'listWindows',
      sessionId: session.id,
    });

    return [
      {
        id: 11,
        focused: true,
        incognito: false,
        state: 'normal',
        type: 'normal',
        tabCount: 2,
        tabs: [
          { id: 101, active: true, url: 'https://example.com' },
          { id: 102, active: false, url: 'https://openai.com' },
        ],
        activeTab: { id: 101, active: true, url: 'https://example.com' },
        bounds: { left: 0, top: 0, width: 1280, height: 800 },
      },
      {
        id: 22,
        focused: false,
        incognito: false,
        state: 'maximized',
        type: 'popup',
        tabCount: 1,
        tabs: [{ id: 201, active: true, url: 'https://vercel.com' }],
        activeTab: { id: 201, active: true, url: 'https://vercel.com' },
        bounds: { left: 20, top: 20, width: 900, height: 700 },
      },
    ];
  }

  async getCurrentWindow(session: CliSessionRecord): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'getCurrentWindow',
      sessionId: session.id,
    });

    return {
      id: 11,
      focused: true,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 2,
      tabs: [
        { id: 101, active: true, url: 'https://example.com' },
        { id: 102, active: false, url: 'https://openai.com' },
      ],
      activeTab: { id: 101, active: true, url: 'https://example.com' },
      bounds: { left: 10, top: 20, width: 1280, height: 800 },
    };
  }

  async getWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'getWindow',
      sessionId: session.id,
      payload: windowId,
    });

    return {
      id: windowId,
      focused: false,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 0,
      tabs: [],
      activeTab: null,
      bounds: { left: null, top: null, width: null, height: null },
    };
  }

  async createWindow(
    session: CliSessionRecord,
    options: CliCreateWindowOptions = {}
  ): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'createWindow',
      sessionId: session.id,
      payload: options,
    });

    return {
      id: 33,
      focused: options.focused ?? true,
      incognito: options.incognito ?? false,
      state: options.state ?? 'normal',
      type: options.type ?? 'normal',
      tabCount: 0,
      tabs: [],
      activeTab: null,
      bounds: {
        left: options.left ?? null,
        top: options.top ?? null,
        width: options.width ?? null,
        height: options.height ?? null,
      },
    };
  }

  async focusWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'focusWindow',
      sessionId: session.id,
      payload: windowId,
    });

    return {
      id: windowId,
      focused: true,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 0,
      tabs: [],
      activeTab: null,
      bounds: { left: null, top: null, width: null, height: null },
    };
  }

  async closeWindow(session: CliSessionRecord, windowId: number): Promise<void> {
    this.calls.push({
      method: 'closeWindow',
      sessionId: session.id,
      payload: windowId,
    });
  }

  async listTabs(
    _session: CliSessionRecord,
    _options?: CliListTabsOptions
  ): Promise<CliTabInfo[]> {
    return [];
  }

  async openTab(
    _session: CliSessionRecord,
    _options: CliOpenTabOptions
  ): Promise<CliTabInfo> {
    throw new Error('openTab is not used in windows CLI tests');
  }

  async getTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw new Error('getTab is not used in windows CLI tests');
  }

  async activateTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw new Error('activateTab is not used in windows CLI tests');
  }

  async closeTabs(_session: CliSessionRecord, _tabIds: number[]): Promise<void> {
    throw new Error('closeTabs is not used in windows CLI tests');
  }

  async closeOtherTabs(
    _session: CliSessionRecord,
    _options?: CliCloseOtherTabsOptions
  ): Promise<{ closedTabIds: number[]; keptTabIds: number[] }> {
    throw new Error('closeOtherTabs is not used in windows CLI tests');
  }

  async reloadTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw new Error('reloadTab is not used in windows CLI tests');
  }

  async duplicateTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw new Error('duplicateTab is not used in windows CLI tests');
  }

  async moveTab(
    _session: CliSessionRecord,
    _tabId: number,
    _options: CliMoveTabOptions
  ): Promise<CliTabInfo> {
    throw new Error('moveTab is not used in windows CLI tests');
  }

  async pinTabs(
    _session: CliSessionRecord,
    _tabIds: number[],
    _pinned: boolean
  ): Promise<CliTabInfo[]> {
    throw new Error('pinTabs is not used in windows CLI tests');
  }

  async muteTabs(
    _session: CliSessionRecord,
    _tabIds: number[],
    _muted: boolean
  ): Promise<CliTabInfo[]> {
    throw new Error('muteTabs is not used in windows CLI tests');
  }

  async groupTabs(
    _session: CliSessionRecord,
    _tabIds: number[]
  ): Promise<{ groupId: number; tabs: CliTabInfo[] }> {
    throw new Error('groupTabs is not used in windows CLI tests');
  }

  async ungroupTabs(_session: CliSessionRecord, _tabIds: number[]): Promise<CliTabInfo[]> {
    throw new Error('ungroupTabs is not used in windows CLI tests');
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

  it('lists windows and auto-creates a session when needed', async () => {
    const outcome = await runCliCommand(['windows', 'list', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data.count).toBe(2);
    expect(payload.data.windows[0]).toEqual({
      id: 11,
      focused: true,
      state: 'normal',
      type: 'normal',
      tabCount: 2,
      tabs: [
        { id: 101, active: true, url: 'https://example.com' },
        { id: 102, active: false, url: 'https://openai.com' },
      ],
    });
    expect(browserService.calls).toEqual([
      {
        method: 'listWindows',
        sessionId: 's1',
      },
    ]);
  });

  it('gets the current window using the current session', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const outcome = await runCliCommand(['windows', 'current', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('alpha');
    expect(payload.data.window).toEqual({
      id: 11,
      focused: true,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 2,
      tabs: [
        { id: 101, active: true, url: 'https://example.com' },
        { id: 102, active: false, url: 'https://openai.com' },
      ],
      activeTab: { id: 101, active: true, url: 'https://example.com' },
      bounds: { left: 10, top: 20, width: 1280, height: 800 },
    });
    expect(browserService.calls.at(-1)).toEqual({
      method: 'getCurrentWindow',
      sessionId: 'alpha',
    });
  });

  it('creates a window with parsed options', async () => {
    const outcome = await runCliCommand(
      [
        'windows',
        'create',
        '--url',
        'https://example.com',
        '--url',
        'https://openai.com',
        '--focused=false',
        '--incognito',
        '--state',
        'maximized',
        '--type=popup',
        '--left',
        '12',
        '--top',
        '24',
        '--width',
        '1440',
        '--height',
        '900',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data.window).toEqual({
      id: 33,
      focused: false,
      incognito: true,
      state: 'maximized',
      type: 'popup',
      tabCount: 0,
      tabs: [],
      activeTab: null,
      bounds: { left: 12, top: 24, width: 1440, height: 900 },
    });
    expect(browserService.calls).toEqual([
      {
        method: 'createWindow',
        sessionId: 's1',
        payload: {
          url: ['https://example.com', 'https://openai.com'],
          focused: false,
          incognito: true,
          state: 'maximized',
          type: 'popup',
          left: 12,
          top: 24,
          width: 1440,
          height: 900,
        },
      },
    ]);
  });

  it('focuses and closes windows by id', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const focus = await runCliCommand(['windows', 'focus', '44', '--json'], tempHome, browserService, now);
    const close = await runCliCommand(['windows', 'close', '44', '--json'], tempHome, browserService, now);

    const focusPayload = JSON.parse(focus.stdout);
    const closePayload = JSON.parse(close.stdout);

    expect(focus.exitCode).toBe(0);
    expect(close.exitCode).toBe(0);
    expect(focusPayload.data.window.id).toBe(44);
    expect(closePayload.data).toEqual({
      closed: true,
      windowId: 44,
    });
    expect(browserService.calls.slice(-2)).toEqual([
      {
        method: 'focusWindow',
        sessionId: 'alpha',
        payload: 44,
      },
      {
        method: 'closeWindow',
        sessionId: 'alpha',
        payload: 44,
      },
    ]);
  });
});
