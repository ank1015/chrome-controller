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

function createTab(overrides: Partial<CliTabInfo> = {}): CliTabInfo {
  return {
    id: overrides.id ?? 101,
    windowId: overrides.windowId ?? 11,
    active: overrides.active ?? false,
    pinned: overrides.pinned ?? false,
    audible: overrides.audible ?? false,
    muted: overrides.muted ?? false,
    title: overrides.title ?? `Tab ${overrides.id ?? 101}`,
    url: overrides.url ?? `https://example.com/${overrides.id ?? 101}`,
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {

  private readonly tabs = new Map<number, CliTabInfo>([
    [101, createTab({ id: 101, windowId: 11, active: true, title: 'Home', url: 'https://example.com' })],
    [102, createTab({ id: 102, windowId: 11, active: false, title: 'Docs', url: 'https://docs.example.com', index: 1 })],
    [201, createTab({ id: 201, windowId: 22, active: true, title: 'Other', url: 'https://other.example.com' })],
  ]);
  private readonly delayedListVisibility = new Map<number, number>();

  private nextTabId = 300;

  async listWindows(_session: CliSessionRecord): Promise<CliWindowInfo[]> {
    return [];
  }

  async getCurrentWindow(_session: CliSessionRecord): Promise<CliWindowInfo> {
    throw new Error('getCurrentWindow is not used in tabs CLI tests');
  }

  async getWindow(_session: CliSessionRecord, _windowId: number): Promise<CliWindowInfo> {
    throw new Error('getWindow is not used in tabs CLI tests');
  }

  async createWindow(
    _session: CliSessionRecord,
    _options?: CliCreateWindowOptions
  ): Promise<CliWindowInfo> {
    throw new Error('createWindow is not used in tabs CLI tests');
  }

  async focusWindow(_session: CliSessionRecord, _windowId: number): Promise<CliWindowInfo> {
    throw new Error('focusWindow is not used in tabs CLI tests');
  }

  async closeWindow(_session: CliSessionRecord, _windowId: number): Promise<void> {
    throw new Error('closeWindow is not used in tabs CLI tests');
  }

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    const tabs = [...this.tabs.values()];
    const matchingTabs =
      options.windowId !== undefined
        ? tabs.filter((tab) => tab.windowId === options.windowId)
        : options.currentWindow === false || options.currentWindow === undefined
          ? tabs
          : tabs.filter((tab) => tab.windowId === 11);

    return matchingTabs
      .filter((tab) => this.shouldIncludeTabInList(tab.id as number))
      .map((tab) => ({ ...tab }));
  }

  async openTab(session: CliSessionRecord, options: CliOpenTabOptions): Promise<CliTabInfo> {
    this.calls.push({
      method: 'openTab',
      sessionId: session.id,
      payload: options,
    });

    if (options.url === 'https://reuse.example.com') {
      const reused = this.requireStoredTab(102);
      reused.url = options.url;
      reused.title = 'Reused existing tab';
      reused.active = options.active ?? reused.active;
      return this.requireTab(102);
    }

    const tab = createTab({
      id: this.nextTabId++,
      windowId: options.windowId ?? 11,
      active: options.active ?? true,
      pinned: options.pinned ?? false,
      title: 'Opened tab',
      url: options.url,
      index: 99,
    });
    this.tabs.set(tab.id as number, tab);
    if (options.url === 'https://eventual.example.com') {
      this.delayedListVisibility.set(tab.id as number, 1);
    }
    return tab;
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    return this.requireTab(tabId);
  }

  async activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'activateTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.requireTab(tabId);
    for (const existing of this.tabs.values()) {
      if (existing.windowId === tab.windowId) {
        existing.active = existing.id === tab.id;
      }
    }

    return this.requireTab(tabId);
  }

  async closeTabs(session: CliSessionRecord, tabIds: number[]): Promise<void> {
    this.calls.push({
      method: 'closeTabs',
      sessionId: session.id,
      payload: tabIds,
    });

    for (const tabId of tabIds) {
      this.tabs.delete(tabId);
    }
  }

  async closeOtherTabs(
    session: CliSessionRecord,
    options: CliCloseOtherTabsOptions = {}
  ): Promise<{ closedTabIds: number[]; keptTabIds: number[] }> {
    this.calls.push({
      method: 'closeOtherTabs',
      sessionId: session.id,
      payload: options,
    });

    const windowId = options.windowId ?? 11;
    const tabs = [...this.tabs.values()].filter((tab) => tab.windowId === windowId);
    const keepTabIds =
      options.keepTabId !== undefined
        ? [options.keepTabId]
        : tabs.filter((tab) => tab.active).map((tab) => tab.id as number);
    const kept = new Set(keepTabIds);
    const closedTabIds = tabs
      .filter((tab) => !kept.has(tab.id as number))
      .map((tab) => tab.id as number);

    for (const tabId of closedTabIds) {
      this.tabs.delete(tabId);
    }

    return {
      closedTabIds,
      keptTabIds: [...kept],
    };
  }

  async reloadTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'reloadTab',
      sessionId: session.id,
      payload: tabId,
    });

    return this.requireTab(tabId);
  }

  async duplicateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'duplicateTab',
      sessionId: session.id,
      payload: tabId,
    });

    const source = this.requireTab(tabId);
    const duplicate = createTab({
      ...source,
      id: this.nextTabId++,
      active: false,
      title: `${source.title ?? 'Tab'} copy`,
    });
    this.tabs.set(duplicate.id as number, duplicate);
    return duplicate;
  }

  async moveTab(
    session: CliSessionRecord,
    tabId: number,
    options: CliMoveTabOptions
  ): Promise<CliTabInfo> {
    this.calls.push({
      method: 'moveTab',
      sessionId: session.id,
      payload: {
        tabId,
        options,
      },
    });

    const tab = this.requireStoredTab(tabId);
    if (options.windowId !== undefined) {
      tab.windowId = options.windowId;
    }
    if (options.index !== undefined) {
      tab.index = options.index;
    }

    return this.requireTab(tabId);
  }

  async pinTabs(
    session: CliSessionRecord,
    tabIds: number[],
    pinned: boolean
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'pinTabs',
      sessionId: session.id,
      payload: {
        tabIds,
        pinned,
      },
    });

    return tabIds.map((tabId) => {
      const tab = this.requireStoredTab(tabId);
      tab.pinned = pinned;
      return this.requireTab(tabId);
    });
  }

  async muteTabs(
    session: CliSessionRecord,
    tabIds: number[],
    muted: boolean
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'muteTabs',
      sessionId: session.id,
      payload: {
        tabIds,
        muted,
      },
    });

    return tabIds.map((tabId) => {
      const tab = this.requireStoredTab(tabId);
      tab.muted = muted;
      return this.requireTab(tabId);
    });
  }

  async groupTabs(
    session: CliSessionRecord,
    tabIds: number[]
  ): Promise<{ groupId: number; tabs: CliTabInfo[] }> {
    this.calls.push({
      method: 'groupTabs',
      sessionId: session.id,
      payload: tabIds,
    });

    const groupId = 77;
    const tabs = tabIds.map((tabId) => {
      const tab = this.requireStoredTab(tabId);
      tab.groupId = groupId;
      return this.requireTab(tabId);
    });

    return {
      groupId,
      tabs,
    };
  }

  async ungroupTabs(session: CliSessionRecord, tabIds: number[]): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'ungroupTabs',
      sessionId: session.id,
      payload: tabIds,
    });

    return tabIds.map((tabId) => {
      const tab = this.requireStoredTab(tabId);
      tab.groupId = -1;
      return this.requireTab(tabId);
    });
  }

  private requireStoredTab(tabId: number): CliTabInfo {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return tab;
  }

  private requireTab(tabId: number): CliTabInfo {
    return { ...this.requireStoredTab(tabId) };
  }

  private shouldIncludeTabInList(tabId: number): boolean {
    const remainingHiddenListCalls = this.delayedListVisibility.get(tabId) ?? 0;
    if (remainingHiddenListCalls <= 0) {
      return true;
    }

    this.delayedListVisibility.set(tabId, remainingHiddenListCalls - 1);
    return false;
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

describe('native CLI tabs commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-tabs-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('lists tabs in the current window by default and auto-creates a session', async () => {
    const outcome = await runCliCommand(['tabs', 'list', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data.count).toBe(2);
    expect(payload.data.tabs).toEqual([
      {
        id: 101,
        windowId: 11,
        active: true,
        pinned: false,
        audible: false,
        muted: false,
        title: 'Home',
        url: 'https://example.com',
        index: 0,
        status: 'complete',
        groupId: -1,
      },
      {
        id: 102,
        windowId: 11,
        active: false,
        pinned: false,
        audible: false,
        muted: false,
        title: 'Docs',
        url: 'https://docs.example.com',
        index: 1,
        status: 'complete',
        groupId: -1,
      },
    ]);
    expect(browserService.calls).toEqual([
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          currentWindow: true,
        },
      },
    ]);
  });

  it('lists tabs across all windows when --all is provided', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const outcome = await runCliCommand(['tabs', 'list', '--all', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('alpha');
    expect(payload.data.count).toBe(3);
    expect(browserService.calls.at(-1)).toEqual({
      method: 'listTabs',
      sessionId: 'alpha',
      payload: {},
    });
  });

  it('sets, shows, and clears a pinned target tab for the session', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const set = await runCliCommand(
      ['tabs', 'target', 'set', '102', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const show = await runCliCommand(
      ['tabs', 'target', 'show', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const clear = await runCliCommand(
      ['tabs', 'target', 'clear', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const setPayload = JSON.parse(set.stdout);
    const showPayload = JSON.parse(show.stdout);
    const clearPayload = JSON.parse(clear.stdout);

    expect(set.exitCode).toBe(0);
    expect(show.exitCode).toBe(0);
    expect(clear.exitCode).toBe(0);
    expect(setPayload.sessionId).toBe('alpha');
    expect(setPayload.data.targetTabId).toBe(102);
    expect(showPayload.data).toEqual({
      targetTabId: 102,
      tab: expect.objectContaining({
        id: 102,
        url: 'https://docs.example.com',
      }),
      stale: false,
    });
    expect(clearPayload.data).toEqual({
      clearedTargetTabId: 102,
      targetTabId: null,
    });
  });

  it('opens a tab with parsed options', async () => {
    const outcome = await runCliCommand(
      [
        'tabs',
        'open',
        '--url',
        'https://openai.com',
        '--window',
        '22',
        '--active=false',
        '--pinned',
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
      tab: {
        id: 300,
        windowId: 22,
        active: false,
        pinned: true,
        audible: false,
        muted: false,
        title: 'Opened tab',
        url: 'https://openai.com',
        index: 99,
        status: 'complete',
        groupId: -1,
      },
      createdNewTab: true,
      reusedExistingTab: false,
    });
    expect(browserService.calls).toEqual([
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          windowId: 22,
        },
      },
      {
        method: 'openTab',
        sessionId: 's1',
        payload: {
          url: 'https://openai.com',
          windowId: 22,
          active: false,
          pinned: true,
        },
      },
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          currentWindow: false,
        },
      },
    ]);
  });

  it('waits for a newly opened tab to appear in all-tabs listings before returning', async () => {
    const open = await runCliCommand(
      ['tabs', 'open', 'https://eventual.example.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const list = await runCliCommand(
      ['tabs', 'list', '--all', '--json'],
      tempHome,
      browserService,
      now
    );

    const openPayload = JSON.parse(open.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(open.exitCode).toBe(0);
    expect(openPayload.data.tab.id).toBe(300);
    expect(list.exitCode).toBe(0);
    expect(listPayload.data.count).toBe(4);
    expect(listPayload.data.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 300,
          url: 'https://eventual.example.com',
        }),
      ])
    );
  });

  it('opens a tab with a named session created via the global --session flag', async () => {
    const create = await runCliCommand(
      ['session', 'create', '--session', 'linkedin-dm-task1', '--json'],
      tempHome,
      browserService,
      now
    );
    const open = await runCliCommand(
      [
        'tabs',
        'open',
        'https://www.linkedin.com/messaging/',
        '--active=false',
        '--session',
        'linkedin-dm-task1',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );

    const createPayload = JSON.parse(create.stdout);
    const openPayload = JSON.parse(open.stdout);

    expect(create.exitCode).toBe(0);
    expect(createPayload.sessionId).toBe('linkedin-dm-task1');
    expect(open.exitCode).toBe(0);
    expect(openPayload.sessionId).toBe('linkedin-dm-task1');
    expect(browserService.calls.slice(-3)).toEqual([
      {
        method: 'listTabs',
        sessionId: 'linkedin-dm-task1',
        payload: {
          currentWindow: false,
        },
      },
      {
        method: 'openTab',
        sessionId: 'linkedin-dm-task1',
        payload: {
          url: 'https://www.linkedin.com/messaging/',
          active: false,
        },
      },
      {
        method: 'listTabs',
        sessionId: 'linkedin-dm-task1',
        payload: {
          currentWindow: false,
        },
      },
    ]);
  });

  it('prints resolved tab context for state-changing tab commands', async () => {
    const openOutcome = await runCliCommand(
      ['tabs', 'open', 'https://openai.com'],
      tempHome,
      browserService,
      now
    );

    expect(openOutcome.exitCode).toBe(0);
    expect(openOutcome.stdout).toContain(
      'Opened tab 300 window=11 "Opened tab" https://openai.com'
    );
  });

  it('reports when Chrome reuses an existing blank or loading tab', async () => {
    const outcome = await runCliCommand(
      ['tabs', 'open', 'https://reuse.example.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.createdNewTab).toBe(false);
    expect(payload.data.reusedExistingTab).toBe(true);
    expect(payload.data.tab.id).toBe(102);
  });

  it('reuses an existing exact-url tab before opening a duplicate', async () => {
    const outcome = await runCliCommand(
      ['tabs', 'open', 'https://docs.example.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.createdNewTab).toBe(false);
    expect(payload.data.reusedExistingTab).toBe(true);
    expect(payload.data.tab.id).toBe(102);
    expect(browserService.calls).toEqual([
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          currentWindow: false,
        },
      },
    ]);
  });

  it('activates, closes others, and closes explicit tab ids', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const activate = await runCliCommand(['tabs', 'activate', '102', '--json'], tempHome, browserService, now);
    const closeOthers = await runCliCommand(
      ['tabs', 'close-others', '--window', '11', '--keep', '102', '--json'],
      tempHome,
      browserService,
      now
    );
    const close = await runCliCommand(['tabs', 'close', '201', '--json'], tempHome, browserService, now);

    const activatePayload = JSON.parse(activate.stdout);
    const closeOthersPayload = JSON.parse(closeOthers.stdout);
    const closePayload = JSON.parse(close.stdout);

    expect(activate.exitCode).toBe(0);
    expect(closeOthers.exitCode).toBe(0);
    expect(close.exitCode).toBe(0);
    expect(activatePayload.data.tab.id).toBe(102);
    expect(activatePayload.data.tab.active).toBe(true);
    expect(closeOthersPayload.data).toEqual({
      closedTabIds: [101],
      keptTabIds: [102],
    });
    expect(closePayload.data).toEqual({
      closed: true,
      tabIds: [201],
    });
    expect(browserService.calls.slice(-3)).toEqual([
      {
        method: 'activateTab',
        sessionId: 'alpha',
        payload: 102,
      },
      {
        method: 'closeOtherTabs',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
          keepTabId: 102,
        },
      },
      {
        method: 'closeTabs',
        sessionId: 'alpha',
        payload: [201],
      },
    ]);
  });

  it('moves, pins, mutes, groups, and ungroups tabs', async () => {
    const move = await runCliCommand(
      ['tabs', 'move', '102', '--window', '22', '--index', '5', '--json'],
      tempHome,
      browserService,
      now
    );
    const pin = await runCliCommand(['tabs', 'pin', '101', '102', '--json'], tempHome, browserService, now);
    const mute = await runCliCommand(['tabs', 'mute', '101', '--json'], tempHome, browserService, now);
    const group = await runCliCommand(['tabs', 'group', '101', '102', '--json'], tempHome, browserService, now);
    const ungroup = await runCliCommand(['tabs', 'ungroup', '101', '102', '--json'], tempHome, browserService, now);

    const movePayload = JSON.parse(move.stdout);
    const pinPayload = JSON.parse(pin.stdout);
    const mutePayload = JSON.parse(mute.stdout);
    const groupPayload = JSON.parse(group.stdout);
    const ungroupPayload = JSON.parse(ungroup.stdout);

    expect(move.exitCode).toBe(0);
    expect(pin.exitCode).toBe(0);
    expect(mute.exitCode).toBe(0);
    expect(group.exitCode).toBe(0);
    expect(ungroup.exitCode).toBe(0);
    expect(movePayload.data.tab.windowId).toBe(22);
    expect(movePayload.data.tab.index).toBe(5);
    expect(pinPayload.data.tabs).toEqual([
      expect.objectContaining({ id: 101, pinned: true }),
      expect.objectContaining({ id: 102, pinned: true }),
    ]);
    expect(mutePayload.data.tabs).toEqual([expect.objectContaining({ id: 101, muted: true })]);
    expect(groupPayload.data).toEqual({
      groupId: 77,
      tabs: [
        expect.objectContaining({ id: 101, groupId: 77 }),
        expect.objectContaining({ id: 102, groupId: 77 }),
      ],
    });
    expect(ungroupPayload.data.tabs).toEqual([
      expect.objectContaining({ id: 101, groupId: -1 }),
      expect.objectContaining({ id: 102, groupId: -1 }),
    ]);
    expect(browserService.calls).toEqual([
      {
        method: 'moveTab',
        sessionId: 's1',
        payload: {
          tabId: 102,
          options: {
            windowId: 22,
            index: 5,
          },
        },
      },
      {
        method: 'pinTabs',
        sessionId: 's1',
        payload: {
          tabIds: [101, 102],
          pinned: true,
        },
      },
      {
        method: 'muteTabs',
        sessionId: 's1',
        payload: {
          tabIds: [101],
          muted: true,
        },
      },
      {
        method: 'groupTabs',
        sessionId: 's1',
        payload: [101, 102],
      },
      {
        method: 'ungroupTabs',
        sessionId: 's1',
        payload: [101, 102],
      },
    ]);
  });
});
