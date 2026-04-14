import type {
  BrowserService,
  CliCloseOtherTabsOptions,
  CliCookieInfo,
  CliCreateWindowOptions,
  CliDebuggerEvent,
  CliDownloadInfo,
  CliDownloadsFilter,
  CliListTabsOptions,
  CliMoveTabOptions,
  CliOpenTabOptions,
  CliSessionRecord,
  CliStorageArea,
  CliStorageState,
  CliTabInfo,
  CliWindowInfo,
} from '../../../src/native-cli/types.js';

export abstract class BaseMockBrowserService implements BrowserService {
  readonly calls: Array<{ method: string; sessionId: string; payload?: unknown }> = [];
  private readonly windows = new Map<number, CliWindowInfo>();
  private nextWindowId = 11;

  async listWindows(session: CliSessionRecord): Promise<CliWindowInfo[]> {
    this.calls.push({
      method: 'listWindows',
      sessionId: session.id,
    });

    return [...this.windows.values()].map((window) => cloneWindow(window));
  }

  async getCurrentWindow(session: CliSessionRecord): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'getCurrentWindow',
      sessionId: session.id,
    });

    const window = [...this.windows.values()].find((candidate) => candidate.focused)
      ?? [...this.windows.values()][0];
    if (!window) {
      throw this.unsupported('getCurrentWindow');
    }

    return cloneWindow(window);
  }

  async getWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'getWindow',
      sessionId: session.id,
      payload: windowId,
    });

    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Missing window ${windowId}`);
    }

    return cloneWindow(window);
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

    const id = this.nextWindowId++;
    const window: CliWindowInfo = {
      id,
      focused: options.focused ?? false,
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
    this.windows.set(id, window);
    return cloneWindow(window);
  }

  async focusWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo> {
    this.calls.push({
      method: 'focusWindow',
      sessionId: session.id,
      payload: windowId,
    });

    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Missing window ${windowId}`);
    }

    for (const candidate of this.windows.values()) {
      candidate.focused = candidate.id === windowId;
    }

    return cloneWindow(window);
  }

  async closeWindow(session: CliSessionRecord, windowId: number): Promise<void> {
    this.calls.push({
      method: 'closeWindow',
      sessionId: session.id,
      payload: windowId,
    });

    if (!this.windows.delete(windowId)) {
      throw new Error(`Missing window ${windowId}`);
    }
  }

  async listTabs(
    _session: CliSessionRecord,
    _options?: CliListTabsOptions
  ): Promise<CliTabInfo[]> {
    throw this.unsupported('listTabs');
  }

  async openTab(
    _session: CliSessionRecord,
    _options: CliOpenTabOptions
  ): Promise<CliTabInfo> {
    throw this.unsupported('openTab');
  }

  async navigateTab(
    _session: CliSessionRecord,
    _tabId: number,
    _url: string
  ): Promise<CliTabInfo> {
    throw this.unsupported('navigateTab');
  }

  async evaluateTab(
    _session: CliSessionRecord,
    _tabId: number,
    _code: string,
    _options?: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    }
  ): Promise<unknown> {
    throw this.unsupported('evaluateTab');
  }

  async printToPdf(
    _session: CliSessionRecord,
    _tabId: number,
    _options?: {
      landscape?: boolean;
      printBackground?: boolean;
      scale?: number;
      paperWidth?: number;
      paperHeight?: number;
      preferCSSPageSize?: boolean;
    }
  ): Promise<{ dataBase64: string }> {
    throw this.unsupported('printToPdf');
  }

  async getTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw this.unsupported('getTab');
  }

  async activateTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw this.unsupported('activateTab');
  }

  async closeTabs(_session: CliSessionRecord, _tabIds: number[]): Promise<void> {
    throw this.unsupported('closeTabs');
  }

  async closeOtherTabs(
    _session: CliSessionRecord,
    _options?: CliCloseOtherTabsOptions
  ): Promise<{ closedTabIds: number[]; keptTabIds: number[] }> {
    throw this.unsupported('closeOtherTabs');
  }

  async reloadTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw this.unsupported('reloadTab');
  }

  async duplicateTab(_session: CliSessionRecord, _tabId: number): Promise<CliTabInfo> {
    throw this.unsupported('duplicateTab');
  }

  async moveTab(
    _session: CliSessionRecord,
    _tabId: number,
    _options: CliMoveTabOptions
  ): Promise<CliTabInfo> {
    throw this.unsupported('moveTab');
  }

  async pinTabs(
    _session: CliSessionRecord,
    _tabIds: number[],
    _pinned: boolean
  ): Promise<CliTabInfo[]> {
    throw this.unsupported('pinTabs');
  }

  async muteTabs(
    _session: CliSessionRecord,
    _tabIds: number[],
    _muted: boolean
  ): Promise<CliTabInfo[]> {
    throw this.unsupported('muteTabs');
  }

  async groupTabs(
    _session: CliSessionRecord,
    _tabIds: number[]
  ): Promise<{ groupId: number; tabs: CliTabInfo[] }> {
    throw this.unsupported('groupTabs');
  }

  async ungroupTabs(_session: CliSessionRecord, _tabIds: number[]): Promise<CliTabInfo[]> {
    throw this.unsupported('ungroupTabs');
  }

  async attachDebugger(
    _session: CliSessionRecord,
    _tabId: number
  ): Promise<{ attached: boolean; alreadyAttached: boolean }> {
    throw this.unsupported('attachDebugger');
  }

  async detachDebugger(
    _session: CliSessionRecord,
    _tabId: number
  ): Promise<{ detached: boolean }> {
    throw this.unsupported('detachDebugger');
  }

  async sendDebuggerCommand(
    _session: CliSessionRecord,
    _tabId: number,
    _method: string,
    _params?: Record<string, unknown>
  ): Promise<unknown> {
    throw this.unsupported('sendDebuggerCommand');
  }

  async getDebuggerEvents(
    _session: CliSessionRecord,
    _tabId: number,
    _options?: { filter?: string; clear?: boolean }
  ): Promise<CliDebuggerEvent[]> {
    throw this.unsupported('getDebuggerEvents');
  }

  async getStorageItems(
    _session: CliSessionRecord,
    _tabId: number,
    _area: CliStorageArea
  ): Promise<Record<string, string>> {
    throw this.unsupported('getStorageItems');
  }

  async getStorageValue(
    _session: CliSessionRecord,
    _tabId: number,
    _area: CliStorageArea,
    _key: string
  ): Promise<string | null> {
    throw this.unsupported('getStorageValue');
  }

  async setStorageValue(
    _session: CliSessionRecord,
    _tabId: number,
    _area: CliStorageArea,
    _key: string,
    _value: string
  ): Promise<string | null> {
    throw this.unsupported('setStorageValue');
  }

  async clearStorage(
    _session: CliSessionRecord,
    _tabId: number,
    _area: CliStorageArea,
    _key?: string
  ): Promise<{ clearedCount: number; existed?: boolean }> {
    throw this.unsupported('clearStorage');
  }

  async captureStorageState(
    _session: CliSessionRecord,
    _tabId: number
  ): Promise<CliStorageState> {
    throw this.unsupported('captureStorageState');
  }

  async applyStorageState(
    _session: CliSessionRecord,
    _tabId: number,
    _state: CliStorageState
  ): Promise<{
    origin: string | null;
    url: string | null;
    localCount: number;
    sessionCount: number;
    cookieCount: number;
  }> {
    throw this.unsupported('applyStorageState');
  }

  async uploadFiles(
    _session: CliSessionRecord,
    _tabId: number,
    _selector: string,
    _paths: string[]
  ): Promise<{ selector: string; files: string[] }> {
    throw this.unsupported('uploadFiles');
  }

  async listCookies(
    _session: CliSessionRecord,
    _options?: { url?: string; domain?: string }
  ): Promise<CliCookieInfo[]> {
    throw this.unsupported('listCookies');
  }

  async getCookie(
    _session: CliSessionRecord,
    _name: string,
    _options?: { url?: string; domain?: string }
  ): Promise<CliCookieInfo | null> {
    throw this.unsupported('getCookie');
  }

  async setCookie(
    _session: CliSessionRecord,
    _cookie: {
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
    throw this.unsupported('setCookie');
  }

  async clearCookies(
    _session: CliSessionRecord,
    _options?: { url?: string; domain?: string; name?: string }
  ): Promise<{ clearedCount: number }> {
    throw this.unsupported('clearCookies');
  }

  async listDownloads(
    _session: CliSessionRecord,
    _filter?: CliDownloadsFilter
  ): Promise<CliDownloadInfo[]> {
    throw this.unsupported('listDownloads');
  }

  async waitForDownload(
    _session: CliSessionRecord,
    _filter?: CliDownloadsFilter,
    _options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      requireComplete?: boolean;
    }
  ): Promise<CliDownloadInfo> {
    throw this.unsupported('waitForDownload');
  }

  async cancelDownloads(_session: CliSessionRecord, _downloadIds: number[]): Promise<void> {
    throw this.unsupported('cancelDownloads');
  }

  async eraseDownloads(_session: CliSessionRecord, _downloadIds: number[]): Promise<void> {
    throw this.unsupported('eraseDownloads');
  }

  protected unsupported(method: string): Error {
    return new Error(`${method} is not used in this test`);
  }
}

function cloneWindow(window: CliWindowInfo): CliWindowInfo {
  return {
    ...window,
    tabs: window.tabs.map((tab) => ({ ...tab })),
    activeTab: window.activeTab ? { ...window.activeTab } : null,
    bounds: { ...window.bounds },
  };
}
