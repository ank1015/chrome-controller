import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliCloseOtherTabsOptions,
  CliListTabsOptions,
  CliOpenTabOptions,
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

  private nextTabId = 300;

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

    return matchingTabs.map((tab) => ({ ...tab }));
  }

  async openTab(session: CliSessionRecord, options: CliOpenTabOptions): Promise<CliTabInfo> {
    this.calls.push({
      method: 'openTab',
      sessionId: session.id,
      payload: options,
    });

    const tab = createTab({
      id: this.nextTabId++,
      windowId: options.windowId ?? 11,
      active: options.active ?? true,
      pinned: options.pinned ?? false,
      title: options.url === 'about:blank' ? 'New Tab' : 'Opened tab',
      url: options.url,
      index: 99,
    });
    if (tab.active) {
      this.setActiveTab(tab.windowId ?? 11, tab.id as number);
    }
    this.tabs.set(tab.id as number, tab);
    return { ...tab };
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return { ...tab };
  }

  async activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'activateTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    this.setActiveTab(tab.windowId ?? 11, tabId);
    return { ...tab, active: true };
  }

  async closeTabs(session: CliSessionRecord, tabIds: number[]): Promise<void> {
    this.calls.push({
      method: 'closeTabs',
      sessionId: session.id,
      payload: tabIds,
    });

    for (const tabId of tabIds) {
      const tab = this.tabs.get(tabId);
      if (!tab) {
        continue;
      }

      const closingActive = tab.active;
      const windowId = tab.windowId ?? 11;
      this.tabs.delete(tabId);
      if (closingActive) {
        const remaining = [...this.tabs.values()].filter((candidate) => candidate.windowId === windowId);
        const fallback = remaining[0];
        if (fallback?.id !== undefined) {
          this.setActiveTab(windowId, fallback.id);
        }
      }
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
    const keepTabId =
      options.keepTabId
      ?? tabs.find((tab) => tab.active)?.id
      ?? tabs[0]?.id
      ?? null;

    const closedTabIds = tabs
      .filter((tab) => tab.id !== keepTabId)
      .map((tab) => tab.id as number);

    for (const tabId of closedTabIds) {
      this.tabs.delete(tabId);
    }

    if (typeof keepTabId === 'number') {
      this.setActiveTab(windowId, keepTabId);
    }

    return {
      closedTabIds,
      keptTabIds: typeof keepTabId === 'number' ? [keepTabId] : [],
    };
  }

  async reloadTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'reloadTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    tab.status = 'complete';
    return { ...tab };
  }

  async duplicateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'duplicateTab',
      sessionId: session.id,
      payload: tabId,
    });

    const source = this.tabs.get(tabId);
    if (!source) {
      throw new Error(`Missing tab ${tabId}`);
    }

    const duplicate = createTab({
      ...source,
      id: this.nextTabId++,
      active: false,
      title: `${source.title ?? 'Tab'} copy`,
      index: (source.index ?? 0) + 1,
    });
    this.tabs.set(duplicate.id as number, duplicate);
    return { ...duplicate };
  }

  private setActiveTab(windowId: number, activeTabId: number): void {
    for (const tab of this.tabs.values()) {
      if (tab.windowId === windowId) {
        tab.active = tab.id === activeTabId;
      }
    }
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

  it('lists tabs in the managed session window and reports the current session tab', async () => {
    const outcome = await runCliCommand(['tabs', 'list', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data.count).toBe(2);
    expect(payload.data.currentTabId).toBe(101);
    expect(payload.data.tabs).toEqual([
      expect.objectContaining({
        id: 101,
        windowId: 11,
        active: true,
        url: 'https://example.com',
      }),
      expect.objectContaining({
        id: 102,
        windowId: 11,
        active: false,
        url: 'https://docs.example.com',
      }),
    ]);
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
    ]);
  });

  it('returns the current managed tab and syncs it into the session', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);

    const current = await runCliCommand(['tabs', 'current', '--json'], tempHome, browserService, now);
    const sessionInfo = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const currentPayload = JSON.parse(current.stdout);
    const sessionPayload = JSON.parse(sessionInfo.stdout);

    expect(current.exitCode).toBe(0);
    expect(currentPayload.data.currentTabId).toBe(101);
    expect(currentPayload.data.tab).toEqual(
      expect.objectContaining({
        id: 101,
        active: true,
      })
    );
    expect(sessionPayload.data.session.targetTabId).toBe(101);
  });

  it('opens a fresh tab with tabs new and makes it the current tab', async () => {
    const outcome = await runCliCommand(
      ['tabs', 'new', 'https://openai.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const sessionInfo = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const payload = JSON.parse(outcome.stdout);
    const sessionPayload = JSON.parse(sessionInfo.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.currentTabId).toBe(300);
    expect(payload.data.tab).toEqual(
      expect.objectContaining({
        id: 300,
        windowId: 11,
        active: true,
        url: 'https://openai.com',
      })
    );
    expect(sessionPayload.data.session.targetTabId).toBe(300);
    expect(browserService.calls).toContainEqual({
      method: 'openTab',
      sessionId: 's1',
      payload: {
        url: 'https://openai.com',
        windowId: 11,
        active: true,
      },
    });
  });

  it('uses an existing tab in the managed window and makes it current', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const outcome = await runCliCommand(['tabs', 'use', '102', '--json'], tempHome, browserService, now);
    const sessionInfo = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const payload = JSON.parse(outcome.stdout);
    const sessionPayload = JSON.parse(sessionInfo.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.currentTabId).toBe(102);
    expect(payload.data.tab).toEqual(
      expect.objectContaining({
        id: 102,
        active: true,
      })
    );
    expect(sessionPayload.data.session.targetTabId).toBe(102);
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'getTab',
        sessionId: 'alpha',
        payload: 102,
      },
      {
        method: 'activateTab',
        sessionId: 'alpha',
        payload: 102,
      },
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
    ]);
  });

  it('closes the current tab and falls back to another managed-window tab', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    await runCliCommand(['tabs', 'use', '102', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const close = await runCliCommand(['tabs', 'close', '--json'], tempHome, browserService, now);
    const sessionInfo = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const closePayload = JSON.parse(close.stdout);
    const sessionPayload = JSON.parse(sessionInfo.stdout);

    expect(close.exitCode).toBe(0);
    expect(closePayload.data).toEqual({
      closedTabId: 102,
      currentTabId: 101,
      currentTab: expect.objectContaining({
        id: 101,
        active: true,
      }),
    });
    expect(sessionPayload.data.session.targetTabId).toBe(101);
  });

  it('closes the other tabs in the managed window and keeps the current tab', async () => {
    await runCliCommand(['tabs', 'new', 'https://openai.com', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const closeOthers = await runCliCommand(['tabs', 'close-others', '--json'], tempHome, browserService, now);
    const list = await runCliCommand(['tabs', 'list', '--json'], tempHome, browserService, now);

    const closePayload = JSON.parse(closeOthers.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(closeOthers.exitCode).toBe(0);
    expect(closePayload.data).toEqual({
      closedTabIds: [101, 102],
      keptTabId: 300,
      currentTabId: 300,
      tab: expect.objectContaining({
        id: 300,
        active: true,
      }),
    });
    expect(listPayload.data.count).toBe(1);
    expect(listPayload.data.currentTabId).toBe(300);
  });

  it('reloads and duplicates the current tab', async () => {
    await runCliCommand(['tabs', 'current', '--json'], tempHome, browserService, now);
    browserService.calls.length = 0;

    const reload = await runCliCommand(['tabs', 'reload', '--json'], tempHome, browserService, now);
    const duplicate = await runCliCommand(['tabs', 'duplicate', '--json'], tempHome, browserService, now);
    const sessionInfo = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const reloadPayload = JSON.parse(reload.stdout);
    const duplicatePayload = JSON.parse(duplicate.stdout);
    const sessionPayload = JSON.parse(sessionInfo.stdout);

    expect(reload.exitCode).toBe(0);
    expect(duplicate.exitCode).toBe(0);
    expect(reloadPayload.data.tab).toEqual(
      expect.objectContaining({
        id: 101,
      })
    );
    expect(duplicatePayload.data).toEqual({
      sourceTabId: 101,
      currentTabId: 300,
      tab: expect.objectContaining({
        id: 300,
        active: true,
        title: 'Home copy',
      }),
    });
    expect(sessionPayload.data.session.targetTabId).toBe(300);
  });
});
