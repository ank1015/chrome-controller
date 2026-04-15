import { readFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { connectManagedChromeBridge } from './bridge.js';

import type {
  BrowserService,
  CliCloseOtherTabsOptions,
  CliCookieInfo,
  CliDownloadInfo,
  CliDownloadsFilter,
  CliCreateWindowOptions,
  CliUpdateWindowOptions,
  CliDebuggerEvent,
  CliListTabsOptions,
  CliMoveTabOptions,
  CliOpenTabOptions,
  CliSessionRecord,
  CliStorageArea,
  CliStorageState,
  CliTabInfo,
  CliWindowBounds,
  CliWindowInfo,
  CliWindowTabInfo,
} from './types.js';

type RawWindow = Record<string, unknown>;
type RawTab = Record<string, unknown>;
type RawCookie = Record<string, unknown>;
type RawDownload = Record<string, unknown>;

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_MS = 250;

export class ChromeBrowserService implements BrowserService {
  async callBrowserMethod(method: string, ...args: unknown[]): Promise<unknown> {
    return await this.callChrome(method, ...args);
  }

  async createManagedSessionWindow(session: CliSessionRecord): Promise<CliWindowInfo> {
    const bridge = await connectManagedChromeBridge({
      launch: true,
    });

    try {
      const launchWindows = bridge.launched
        ? await this.listBridgeWindows(bridge)
        : [];
      const adoptableWindow = selectAdoptableLaunchWindow(launchWindows);

      if (adoptableWindow) {
        return adoptableWindow;
      }

      const createdWindow = normalizeWindow(
        await bridge.client.call<RawWindow>('windows.create', {
          focused: false,
        })
      );

      if (bridge.launched && typeof createdWindow.id === 'number') {
        await this.closeDisposableLaunchWindows(bridge, launchWindows, createdWindow.id);
      }

      return createdWindow;
    } finally {
      await bridge.close();
    }
  }

  async listWindows(_session: CliSessionRecord): Promise<CliWindowInfo[]> {
    const windows = await this.callChrome<RawWindow[]>('windows.getAll', {
      populate: true,
    });
    return windows.map((window) => normalizeWindow(window));
  }

  async getCurrentWindow(_session: CliSessionRecord): Promise<CliWindowInfo> {
    const window = await this.callChrome<RawWindow>('windows.getCurrent', {
      populate: true,
    });
    return normalizeWindow(window);
  }

  async getWindow(_session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    const window = await this.callChrome<RawWindow>('windows.get', windowId, {
      populate: true,
    });
    return normalizeWindow(window);
  }

  async createWindow(
    _session: CliSessionRecord,
    options: CliCreateWindowOptions = {}
  ): Promise<CliWindowInfo> {
    const window = await this.callChrome<RawWindow>('windows.create', options);
    return normalizeWindow(window);
  }

  async updateWindow(
    session: CliSessionRecord,
    windowId: number,
    options: CliUpdateWindowOptions
  ): Promise<CliWindowInfo> {
    await this.callChrome<RawWindow>('windows.update', windowId, options);
    return await this.getWindow(session, windowId);
  }

  async focusWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    return await this.updateWindow(session, windowId, {
      focused: true,
    });
  }

  async closeWindow(_session: CliSessionRecord, windowId: number): Promise<void> {
    await this.callChrome('windows.remove', windowId);
  }

  async listTabs(
    _session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    const query =
      options.windowId !== undefined
        ? { windowId: options.windowId }
        : options.currentWindow === false
          ? {}
          : { currentWindow: true };
    const tabs = await this.callChrome<RawTab[]>('tabs.query', query);
    return tabs.map((tab) => normalizeCliTab(tab));
  }

  async openTab(_session: CliSessionRecord, options: CliOpenTabOptions): Promise<CliTabInfo> {
    const tab = await this.callChrome<RawTab>('tabs.create', {
      url: options.url,
      ...(options.windowId !== undefined ? { windowId: options.windowId } : {}),
      ...(options.active !== undefined ? { active: options.active } : {}),
      ...(options.pinned !== undefined ? { pinned: options.pinned } : {}),
    });
    return normalizeCliTab(tab);
  }

  async navigateTab(
    _session: CliSessionRecord,
    tabId: number,
    url: string
  ): Promise<CliTabInfo> {
    const tab = await this.callChrome<RawTab>('tabs.update', tabId, {
      url,
    });
    return normalizeCliTab(tab);
  }

  async evaluateTab(
    _session: CliSessionRecord,
    tabId: number,
    code: string,
    options: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    } = {}
  ): Promise<unknown> {
    return await this.evaluateOnTab(tabId, code, options);
  }

  async printToPdf(
    session: CliSessionRecord,
    tabId: number,
    options: {
      landscape?: boolean;
      printBackground?: boolean;
      scale?: number;
      paperWidth?: number;
      paperHeight?: number;
      preferCSSPageSize?: boolean;
    } = {}
  ): Promise<{ dataBase64: string }> {
    const attachResult = await this.attachDebugger(session, tabId);

    try {
      const result = await this.sendDebuggerCommand(
        session,
        tabId,
        'Page.printToPDF',
        options
      ) as { data?: string };

      if (typeof result.data !== 'string' || result.data.length === 0) {
        throw new Error(`Failed to generate PDF for tab ${tabId}`);
      }

      return {
        dataBase64: result.data,
      };
    } finally {
      if (!attachResult.alreadyAttached) {
        await this.detachDebugger(session, tabId);
      }
    }
  }

  async getTab(_session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    const tab = await this.callChrome<RawTab>('tabs.get', tabId);
    return normalizeCliTab(tab);
  }

  async activateTab(_session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    const updatedTab = await this.callChrome<RawTab>('tabs.update', tabId, {
      active: true,
    });

    return normalizeCliTab(updatedTab);
  }

  async closeTabs(_session: CliSessionRecord, tabIds: number[]): Promise<void> {
    await this.callChrome('tabs.remove', tabIds.length === 1 ? tabIds[0] : tabIds);
  }

  async closeOtherTabs(
    session: CliSessionRecord,
    options: CliCloseOtherTabsOptions = {}
  ): Promise<{ closedTabIds: number[]; keptTabIds: number[] }> {
    const tabs = await this.listTabs(session, {
      ...(options.windowId !== undefined ? { windowId: options.windowId } : { currentWindow: true }),
    });

    if (tabs.length === 0) {
      return {
        closedTabIds: [],
        keptTabIds: [],
      };
    }

    const keepTabIds = new Set<number>();
    if (typeof options.keepTabId === 'number') {
      keepTabIds.add(options.keepTabId);
    } else {
      for (const tab of tabs) {
        if (tab.active && typeof tab.id === 'number') {
          keepTabIds.add(tab.id);
        }
      }
    }

    if (keepTabIds.size === 0 && typeof tabs[0]?.id === 'number') {
      keepTabIds.add(tabs[0].id);
    }

    const closedTabIds = tabs
      .filter((tab) => typeof tab.id === 'number' && !keepTabIds.has(tab.id))
      .map((tab) => tab.id as number);

    if (closedTabIds.length > 0) {
      await this.closeTabs(session, closedTabIds);
    }

    return {
      closedTabIds,
      keptTabIds: [...keepTabIds],
    };
  }

  async reloadTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    await this.callChrome('tabs.reload', tabId);
    return await this.getTab(session, tabId);
  }

  async duplicateTab(_session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    const duplicatedTab = await this.callChrome<RawTab>('tabs.duplicate', tabId);
    return normalizeCliTab(duplicatedTab);
  }

  async moveTab(
    session: CliSessionRecord,
    tabId: number,
    options: CliMoveTabOptions
  ): Promise<CliTabInfo> {
    const movedTab = await this.callChrome<RawTab | RawTab[]>('tabs.move', tabId, {
      ...(options.windowId !== undefined ? { windowId: options.windowId } : {}),
      ...(options.index !== undefined ? { index: options.index } : {}),
    });
    const resolvedTab = Array.isArray(movedTab) ? movedTab[0] : movedTab;
    if (!resolvedTab) {
      return await this.getTab(session, tabId);
    }
    return normalizeCliTab(resolvedTab);
  }

  async pinTabs(
    session: CliSessionRecord,
    tabIds: number[],
    pinned: boolean
  ): Promise<CliTabInfo[]> {
    return await this.updateTabsBooleanState(session, tabIds, { pinned });
  }

  async muteTabs(
    session: CliSessionRecord,
    tabIds: number[],
    muted: boolean
  ): Promise<CliTabInfo[]> {
    return await this.updateTabsBooleanState(session, tabIds, { muted });
  }

  async groupTabs(
    session: CliSessionRecord,
    tabIds: number[]
  ): Promise<{ groupId: number; tabs: CliTabInfo[] }> {
    const groupId = await this.callChrome<number>('tabs.group', { tabIds });
    const tabs = await Promise.all(tabIds.map(async (tabId) => await this.getTab(session, tabId)));
    return {
      groupId,
      tabs,
    };
  }

  async ungroupTabs(session: CliSessionRecord, tabIds: number[]): Promise<CliTabInfo[]> {
    await this.callChrome('tabs.ungroup', tabIds);
    return await Promise.all(tabIds.map(async (tabId) => await this.getTab(session, tabId)));
  }

  async attachDebugger(
    _session: CliSessionRecord,
    tabId: number
  ): Promise<{ attached: boolean; alreadyAttached: boolean }> {
    const result = await this.callChrome<{ attached?: boolean; alreadyAttached?: boolean }>(
      'debugger.attach',
      { tabId }
    );

    return {
      attached: result.attached === true || result.alreadyAttached === true,
      alreadyAttached: result.alreadyAttached === true,
    };
  }

  async detachDebugger(
    _session: CliSessionRecord,
    tabId: number
  ): Promise<{ detached: boolean }> {
    const result = await this.callChrome<{ detached?: boolean }>('debugger.detach', { tabId });
    return {
      detached: result.detached !== false,
    };
  }

  async sendDebuggerCommand(
    _session: CliSessionRecord,
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    return await this.callChrome('debugger.sendCommand', {
      tabId,
      method,
      ...(params ? { params } : {}),
    });
  }

  async getDebuggerEvents(
    _session: CliSessionRecord,
    tabId: number,
    options: { filter?: string; clear?: boolean } = {}
  ): Promise<CliDebuggerEvent[]> {
    const events = await this.callChrome<Array<{ method?: unknown; params?: unknown }>>(
      'debugger.getEvents',
      {
        tabId,
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.clear === true ? { clear: true } : {}),
      }
    );

    return events.map((event) => ({
      method: typeof event.method === 'string' ? event.method : 'unknown',
      params:
        typeof event.params === 'object' && event.params !== null
          ? (event.params as Record<string, unknown>)
          : {},
    }));
  }

  async getStorageItems(
    _session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea
  ): Promise<Record<string, string>> {
    return await this.evaluateOnTab<Record<string, string>>(
      tabId,
      buildStorageItemsCode(area)
    );
  }

  async getStorageValue(
    _session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string
  ): Promise<string | null> {
    return await this.evaluateOnTab<string | null>(
      tabId,
      buildStorageValueCode(area, key)
    );
  }

  async setStorageValue(
    _session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string,
    value: string
  ): Promise<string | null> {
    return await this.evaluateOnTab<string | null>(
      tabId,
      buildStorageSetCode(area, key, value)
    );
  }

  async clearStorage(
    _session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key?: string
  ): Promise<{ clearedCount: number; existed?: boolean }> {
    if (key) {
      const result = await this.evaluateOnTab<{ existed?: boolean }>(
        tabId,
        buildStorageClearKeyCode(area, key)
      );

      return {
        clearedCount: result.existed ? 1 : 0,
        existed: result.existed === true,
      };
    }

    const result = await this.evaluateOnTab<{ clearedCount?: number }>(
      tabId,
      buildStorageClearAllCode(area)
    );

    return {
      clearedCount: typeof result.clearedCount === 'number' ? result.clearedCount : 0,
    };
  }

  async captureStorageState(
    session: CliSessionRecord,
    tabId: number
  ): Promise<CliStorageState> {
    const tab = await this.getTab(session, tabId);
    const parsedUrl = parseTabUrl(tab.url);
    const localStorage = await this.getStorageItems(session, tabId, 'local');
    const sessionStorage = await this.getStorageItems(session, tabId, 'session');
    const cookies =
      parsedUrl && isCookieUrl(parsedUrl)
        ? await this.callChrome<RawCookie[]>('cookies.getAll', { url: tab.url })
        : [];

    return {
      version: 1,
      url: tab.url,
      origin: parsedUrl?.origin ?? null,
      title: tab.title,
      localStorage,
      sessionStorage,
      cookies: cookies.map((cookie) => normalizeCookie(cookie)),
    };
  }

  async applyStorageState(
    session: CliSessionRecord,
    tabId: number,
    state: CliStorageState
  ): Promise<{
    origin: string | null;
    url: string | null;
    localCount: number;
    sessionCount: number;
    cookieCount: number;
  }> {
    const tab = await this.getTab(session, tabId);
    const currentUrl = parseTabUrl(tab.url);
    const stateUrl = parseTabUrl(state.url);

    if (state.origin && currentUrl?.origin && state.origin !== currentUrl.origin) {
      throw new Error(
        `Saved state origin ${state.origin} does not match tab origin ${currentUrl.origin}`
      );
    }

    await this.clearStorage(session, tabId, 'local');
    await this.clearStorage(session, tabId, 'session');

    for (const [key, value] of Object.entries(state.localStorage)) {
      await this.setStorageValue(session, tabId, 'local', key, value);
    }

    for (const [key, value] of Object.entries(state.sessionStorage)) {
      await this.setStorageValue(session, tabId, 'session', key, value);
    }

    const cookieUrl = state.url ?? tab.url;
    const cookieTarget = parseTabUrl(cookieUrl);
    let cookieCount = 0;

    if (cookieTarget && isCookieUrl(cookieTarget)) {
      for (const cookie of state.cookies) {
        await this.callChrome('cookies.set', buildCookieSetDetails(cookie, cookieUrl));
        cookieCount += 1;
      }
    }

    return {
      origin: state.origin ?? currentUrl?.origin ?? null,
      url: state.url ?? tab.url,
      localCount: Object.keys(state.localStorage).length,
      sessionCount: Object.keys(state.sessionStorage).length,
      cookieCount,
    };
  }

  async uploadFiles(
    session: CliSessionRecord,
    tabId: number,
    selector: string,
    paths: string[]
  ): Promise<{ selector: string; files: string[] }> {
    const files = normalizeFilePaths(paths);
    const attachResult = await this.attachDebugger(session, tabId);

    try {
      await this.sendDebuggerCommand(session, tabId, 'DOM.enable');
      await this.sendDebuggerCommand(session, tabId, 'Runtime.enable');

      const runtimeResult = await this.sendDebuggerCommand(session, tabId, 'Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        objectGroup: 'web-upload',
      }) as RuntimeEvaluateResult;

      const objectId = runtimeResult.result?.objectId;
      if (!objectId) {
        throw new Error(`Could not find element for selector: ${selector}`);
      }

      const validation = await this.sendDebuggerCommand(session, tabId, 'Runtime.evaluate', {
        expression: `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return { found: false };
          const isInput = element instanceof HTMLInputElement;
          return {
            found: true,
            isFileInput: isInput && element.type === 'file'
          };
        })()`,
        returnByValue: true,
      }) as RuntimeEvaluateResult;

      const value = validation.result?.value as
        | { found?: boolean; isFileInput?: boolean }
        | undefined;
      if (!value?.found) {
        throw new Error(`Could not find element for selector: ${selector}`);
      }
      if (!value.isFileInput) {
        throw new Error(`Selector does not target a file input: ${selector}`);
      }

      const node = await this.sendDebuggerCommand(session, tabId, 'DOM.requestNode', {
        objectId,
      }) as DomRequestNodeResult;
      if (typeof node.nodeId !== 'number') {
        throw new Error(`Could not resolve file input node for selector: ${selector}`);
      }

      try {
        await this.sendDebuggerCommand(session, tabId, 'DOM.setFileInputFiles', {
          nodeId: node.nodeId,
          files,
        });
      } catch (error) {
        if (!shouldFallbackToSyntheticUpload(error)) {
          throw error;
        }

        const syntheticFiles = await readSyntheticUploadFiles(files);
        const fallbackResult = await this.evaluateOnTab<{
          assignedCount?: number;
          names?: string[];
        }>(
          tabId,
          buildSyntheticFileUploadCode(selector, syntheticFiles),
          {
            awaitPromise: true,
            userGesture: true,
          }
        );

        if (fallbackResult?.assignedCount !== files.length) {
          throw new Error(
            `Synthetic upload fallback assigned ${fallbackResult?.assignedCount ?? 0}/${files.length} files for selector: ${selector}`
          );
        }
      }
    } finally {
      if (!attachResult.alreadyAttached) {
        await this.detachDebugger(session, tabId);
      }
    }

    return {
      selector,
      files,
    };
  }

  async listCookies(
    _session: CliSessionRecord,
    options: { url?: string; domain?: string } = {}
  ): Promise<CliCookieInfo[]> {
    const filter = buildCookieFilter(options);
    const cookies = await this.callChrome<RawCookie[]>('cookies.getAll', filter);
    return cookies.map((cookie) => normalizeCookie(cookie));
  }

  async getCookie(
    session: CliSessionRecord,
    name: string,
    options: { url?: string; domain?: string } = {}
  ): Promise<CliCookieInfo | null> {
    const cookies = await this.listCookies(session, {
      ...options,
    });

    const match = cookies.find((cookie) => cookie.name === name);
    return match ?? null;
  }

  async setCookie(
    _session: CliSessionRecord,
    cookie: {
      name: string;
      value: string;
      url: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: string;
      expirationDate?: number;
      storeId?: string;
    }
  ): Promise<CliCookieInfo> {
    const result = await this.callChrome<RawCookie>('cookies.set', {
      url: cookie.url,
      name: cookie.name,
      value: cookie.value,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.path ? { path: cookie.path } : {}),
      ...(cookie.secure ? { secure: true } : {}),
      ...(cookie.httpOnly ? { httpOnly: true } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    });

    return normalizeCookie(result);
  }

  async clearCookies(
    session: CliSessionRecord,
    options: { url?: string; domain?: string; name?: string } = {}
  ): Promise<{ clearedCount: number }> {
    const cookies = await this.listCookies(session, {
      ...(options.url ? { url: options.url } : {}),
      ...(options.domain ? { domain: options.domain } : {}),
    });

    const matches = options.name
      ? cookies.filter((cookie) => cookie.name === options.name)
      : cookies;

    let clearedCount = 0;
    for (const cookie of matches) {
      const url = cookie.url ?? deriveCookieUrl(cookie);
      if (!url) {
        continue;
      }

      await this.callChrome('cookies.remove', {
        url,
        name: cookie.name,
        ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
      });
      clearedCount += 1;
    }

    return {
      clearedCount,
    };
  }

  async listDownloads(
    _session: CliSessionRecord,
    filter?: CliDownloadsFilter
  ): Promise<CliDownloadInfo[]> {
    const downloads = await this.callChrome<RawDownload[]>('downloads.search', {});
    return downloads.map((download) => normalizeDownload(download)).filter((download) =>
      matchesDownloadFilter(download, filter)
    );
  }

  async waitForDownload(
    session: CliSessionRecord,
    filter?: CliDownloadsFilter,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      requireComplete?: boolean;
    }
  ): Promise<CliDownloadInfo> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS;
    const requireComplete = options?.requireComplete ?? true;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const downloads = await this.listDownloads(session, filter);
      const match = downloads.find((download) =>
        requireComplete ? download.state === 'complete' : true
      );

      if (match) {
        return match;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for download within ${timeoutMs}ms`);
  }

  async cancelDownloads(_session: CliSessionRecord, downloadIds: number[]): Promise<void> {
    await Promise.all(
      downloadIds.map(async (downloadId) => {
        await this.callChrome('downloads.cancel', downloadId);
      })
    );
  }

  async eraseDownloads(_session: CliSessionRecord, downloadIds: number[]): Promise<void> {
    await Promise.all(
      downloadIds.map(async (downloadId) => {
        await this.callChrome('downloads.erase', { id: downloadId });
      })
    );
  }

  private async callChrome<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const bridge = await connectManagedChromeBridge({
      launch: true,
    });

    try {
      return await bridge.client.call<T>(method, ...args);
    } finally {
      await bridge.close();
    }
  }

  private async listBridgeWindows(
    bridge: Awaited<ReturnType<typeof connectManagedChromeBridge>>
  ): Promise<CliWindowInfo[]> {
    const windows = await bridge.client.call<RawWindow[]>('windows.getAll', {
      populate: true,
    });
    return windows.map((window) => normalizeWindow(window));
  }

  private async closeDisposableLaunchWindows(
    bridge: Awaited<ReturnType<typeof connectManagedChromeBridge>>,
    windows: CliWindowInfo[],
    keepWindowId: number
  ): Promise<void> {
    for (const window of windows) {
      if (window.id === keepWindowId || !isDisposableLaunchWindow(window)) {
        continue;
      }

      try {
        await bridge.client.call('windows.remove', window.id);
      } catch {
        // The startup window may already be gone by the time cleanup runs.
      }
    }
  }

  private async updateTabsBooleanState(
    session: CliSessionRecord,
    tabIds: number[],
    state: { pinned?: boolean; muted?: boolean }
  ): Promise<CliTabInfo[]> {
    await Promise.all(
      tabIds.map(async (tabId) => {
        await this.callChrome('tabs.update', tabId, state);
      })
    );

    return await Promise.all(tabIds.map(async (tabId) => await this.getTab(session, tabId)));
  }

  private async evaluateOnTab<T>(
    tabId: number,
    code: string,
    options: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    } = {}
  ): Promise<T> {
    const result = await this.callChrome<{ result?: T }>('debugger.evaluate', {
      tabId,
      code,
      returnByValue: true,
      ...(options.awaitPromise !== undefined ? { awaitPromise: options.awaitPromise } : {}),
      ...(options.userGesture !== undefined ? { userGesture: options.userGesture } : {}),
    });

    return result.result as T;
  }
}

function normalizeWindow(window: RawWindow): CliWindowInfo {
  const tabs = Array.isArray(window.tabs)
    ? window.tabs.map((tab) => normalizeTab(tab as RawTab))
    : [];
  const activeTab = tabs.find((tab) => tab.active) ?? null;

  return {
    id: typeof window.id === 'number' ? window.id : null,
    focused: window.focused === true,
    incognito: window.incognito === true,
    type: typeof window.type === 'string' ? window.type : null,
    state: typeof window.state === 'string' ? window.state : null,
    tabCount: tabs.length,
    tabs,
    activeTab,
    bounds: normalizeBounds(window),
  };
}

function normalizeTab(tab: RawTab): CliWindowTabInfo {
  return {
    id: typeof tab.id === 'number' ? tab.id : null,
    active: tab.active === true,
    url: typeof tab.url === 'string' ? tab.url : null,
  };
}

function normalizeCliTab(tab: RawTab): CliTabInfo {
  const mutedInfo =
    typeof tab.mutedInfo === 'object' && tab.mutedInfo !== null
      ? (tab.mutedInfo as Record<string, unknown>)
      : null;

  return {
    id: typeof tab.id === 'number' ? tab.id : null,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
    active: tab.active === true,
    pinned: tab.pinned === true,
    audible: tab.audible === true,
    muted: mutedInfo?.muted === true,
    title: typeof tab.title === 'string' ? tab.title : null,
    url: typeof tab.url === 'string' ? tab.url : null,
    index: typeof tab.index === 'number' ? tab.index : null,
    status: typeof tab.status === 'string' ? tab.status : null,
    groupId: typeof tab.groupId === 'number' ? tab.groupId : null,
  };
}

function normalizeCookie(cookie: RawCookie): CliCookieInfo {
  const normalized: CliCookieInfo = {
    name: typeof cookie.name === 'string' ? cookie.name : '',
    value: typeof cookie.value === 'string' ? cookie.value : '',
    domain: typeof cookie.domain === 'string' ? cookie.domain : null,
    path: typeof cookie.path === 'string' ? cookie.path : null,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: typeof cookie.sameSite === 'string' ? cookie.sameSite : null,
    expirationDate:
      typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null,
    storeId: typeof cookie.storeId === 'string' ? cookie.storeId : null,
  };

  const url = deriveCookieUrl(normalized);
  if (url) {
    normalized.url = url;
  }

  return normalized;
}

function normalizeDownload(download: RawDownload): CliDownloadInfo {
  return {
    id: typeof download.id === 'number' ? download.id : null,
    url: typeof download.url === 'string' ? download.url : null,
    filename: typeof download.filename === 'string' ? download.filename : null,
    state: typeof download.state === 'string' ? download.state : null,
    mime: typeof download.mime === 'string' ? download.mime : null,
    exists: download.exists === true,
    bytesReceived:
      typeof download.bytesReceived === 'number' ? download.bytesReceived : null,
    totalBytes: typeof download.totalBytes === 'number' ? download.totalBytes : null,
    error: typeof download.error === 'string' ? download.error : null,
  };
}

function normalizeBounds(window: RawWindow): CliWindowBounds {
  return {
    left: typeof window.left === 'number' ? window.left : null,
    top: typeof window.top === 'number' ? window.top : null,
    width: typeof window.width === 'number' ? window.width : null,
    height: typeof window.height === 'number' ? window.height : null,
  };
}

interface SyntheticUploadFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

async function readSyntheticUploadFiles(files: string[]): Promise<SyntheticUploadFile[]> {
  return await Promise.all(
    files.map(async (filePath) => {
      const data = await readFile(filePath);
      return {
        name: basename(filePath),
        mimeType: guessMimeType(filePath),
        dataBase64: data.toString('base64'),
      };
    })
  );
}

function guessMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();

  switch (extension) {
    case '.txt':
    case '.log':
    case '.md':
    case '.csv':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function shouldFallbackToSyntheticUpload(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('"Not allowed"') || error.message.includes('Not allowed');
}

function buildSyntheticFileUploadCode(
  selector: string,
  files: SyntheticUploadFile[]
): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const files = ${JSON.stringify(files)};
    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
      throw new Error('Selector does not target a file input: ' + selector);
    }

    const decodeBase64 = (value) => {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    };

    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(
        new File([decodeBase64(file.dataBase64)], file.name, {
          type: file.mimeType,
        })
      );
    }

    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return {
      assignedCount: input.files ? input.files.length : 0,
      names: Array.from(input.files || []).map((file) => file.name),
    };
  })()`;
}

function selectAdoptableLaunchWindow(windows: CliWindowInfo[]): CliWindowInfo | null {
  const adoptableWindows = windows.filter((window) => isDisposableLaunchWindow(window));
  if (adoptableWindows.length !== 1) {
    return null;
  }

  return adoptableWindows[0] ?? null;
}

function isDisposableLaunchWindow(window: CliWindowInfo): boolean {
  if (typeof window.id !== 'number') {
    return false;
  }

  if (window.type !== null && window.type !== 'normal') {
    return false;
  }

  if (window.tabCount !== 1) {
    return false;
  }

  const activeTab = window.activeTab ?? window.tabs[0] ?? null;
  return isDisposableLaunchUrl(activeTab?.url ?? null);
}

function isDisposableLaunchUrl(url: string | null): boolean {
  if (url === null) {
    return true;
  }

  const normalized = url.trim().replace(/\/+$/, '');
  return (
    normalized === 'about:blank'
    || normalized === 'chrome://newtab'
    || normalized === 'chrome://new-tab-page'
    || normalized === 'chrome-native://newtab'
  );
}

function parseTabUrl(url: string | null): URL | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isCookieUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function getStorageExpression(area: CliStorageArea): string {
  return area === 'local' ? 'window.localStorage' : 'window.sessionStorage';
}

function buildStorageItemsCode(area: CliStorageArea): string {
  const storageExpr = getStorageExpression(area);
  return `(() => {
    const storage = ${storageExpr};
    const items = {};
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) {
        const value = storage.getItem(key);
        items[key] = value === null ? '' : value;
      }
    }
    return items;
  })()`;
}

function buildStorageValueCode(area: CliStorageArea, key: string): string {
  const storageExpr = getStorageExpression(area);
  return `(() => {
    const storage = ${storageExpr};
    return storage.getItem(${JSON.stringify(key)});
  })()`;
}

function buildStorageSetCode(area: CliStorageArea, key: string, value: string): string {
  const storageExpr = getStorageExpression(area);
  return `(() => {
    const storage = ${storageExpr};
    storage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});
    return storage.getItem(${JSON.stringify(key)});
  })()`;
}

function buildStorageClearKeyCode(area: CliStorageArea, key: string): string {
  const storageExpr = getStorageExpression(area);
  return `(() => {
    const storage = ${storageExpr};
    const existed = storage.getItem(${JSON.stringify(key)}) !== null;
    storage.removeItem(${JSON.stringify(key)});
    return { existed };
  })()`;
}

function buildStorageClearAllCode(area: CliStorageArea): string {
  const storageExpr = getStorageExpression(area);
  return `(() => {
    const storage = ${storageExpr};
    const clearedCount = storage.length;
    storage.clear();
    return { clearedCount };
  })()`;
}

function buildCookieSetDetails(cookie: CliCookieInfo, url: string | null): Record<string, unknown> {
  if (!url) {
    throw new Error('Cannot restore cookies without a valid URL');
  }

  return {
    url,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.path ? { path: cookie.path } : {}),
    ...(cookie.secure ? { secure: true } : {}),
    ...(cookie.httpOnly ? { httpOnly: true } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.expirationDate !== null ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
  };
}

function buildCookieFilter(options: { url?: string; domain?: string }): Record<string, unknown> {
  if (options.url) {
    return { url: options.url };
  }

  if (options.domain) {
    return { domain: options.domain };
  }

  return {};
}

function deriveCookieUrl(cookie: Pick<CliCookieInfo, 'domain' | 'path' | 'secure' | 'url'>): string | null {
  if (cookie.url) {
    return cookie.url;
  }

  if (!cookie.domain) {
    return null;
  }

  const hostname = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  if (!hostname) {
    return null;
  }

  const path = cookie.path ?? '/';
  return `${cookie.secure ? 'https' : 'http'}://${hostname}${path}`;
}

function matchesDownloadFilter(download: CliDownloadInfo, filter?: CliDownloadsFilter): boolean {
  if (!filter) {
    return true;
  }

  if (filter.id !== undefined && download.id !== filter.id) {
    return false;
  }
  if (filter.state !== undefined && download.state !== filter.state) {
    return false;
  }
  if (filter.filenameIncludes && !download.filename?.includes(filter.filenameIncludes)) {
    return false;
  }
  if (filter.urlIncludes && !download.url?.includes(filter.urlIncludes)) {
    return false;
  }
  if (filter.mimeType && download.mime !== filter.mimeType) {
    return false;
  }

  return true;
}

function normalizeFilePaths(paths: string | readonly string[]): string[] {
  return (Array.isArray(paths) ? [...paths] : [paths]).map((path) => resolvePath(path));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RuntimeEvaluateResult {
  result?: {
    value?: unknown;
    objectId?: string;
  };
}

interface DomRequestNodeResult {
  nodeId?: number;
}
