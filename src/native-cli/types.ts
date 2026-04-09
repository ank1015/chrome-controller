export interface CliSessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  targetTabId: number | null;
}

export interface CliWindowTabInfo {
  id: number | null;
  active: boolean;
  url: string | null;
}

export interface CliWindowBounds {
  left: number | null;
  top: number | null;
  width: number | null;
  height: number | null;
}

export interface CliWindowInfo {
  id: number | null;
  focused: boolean;
  incognito: boolean;
  type: string | null;
  state: string | null;
  tabCount: number;
  tabs: CliWindowTabInfo[];
  activeTab: CliWindowTabInfo | null;
  bounds: CliWindowBounds;
}

export interface CliTabInfo {
  id: number | null;
  windowId: number | null;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  title: string | null;
  url: string | null;
  index: number | null;
  status: string | null;
  groupId: number | null;
}

export interface CliDebuggerEvent {
  method: string;
  params: Record<string, unknown>;
}

export type CliStorageArea = 'local' | 'session';

export interface CliCookieInfo {
  name: string;
  value: string;
  url?: string | null;
  domain: string | null;
  path: string | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  expirationDate: number | null;
  storeId: string | null;
}

export interface CliStorageState {
  version: 1;
  savedAt?: string;
  url: string | null;
  origin: string | null;
  title: string | null;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: CliCookieInfo[];
}

export interface CliDownloadsFilter {
  id?: number;
  state?: string;
  filenameIncludes?: string;
  urlIncludes?: string;
  mimeType?: string;
}

export interface CliDownloadInfo {
  id: number | null;
  url: string | null;
  filename: string | null;
  state: string | null;
  mime: string | null;
  exists: boolean;
  bytesReceived: number | null;
  totalBytes: number | null;
  error: string | null;
}

export interface CliSnapshotElementInfo {
  ref: string;
  role: string;
  name: string | null;
  tagName: string | null;
  inputType: string | null;
  selector: string | null;
  alternativeSelectors: string[];
  placeholder: string | null;
  disabled: boolean;
  checked: boolean | null;
}

export interface CliPageSnapshot {
  source: 'dom-interactive-v1';
  snapshotId: string;
  capturedAt: string;
  tabId: number;
  title: string | null;
  url: string | null;
  elements: CliSnapshotElementInfo[];
  count: number;
  visibleCount: number;
  truncated: boolean;
}

export interface CliPageSnapshotCacheRecord extends CliPageSnapshot {
  version: 1;
  sessionId: string;
}

export interface CliCreateWindowOptions {
  url?: string | string[];
  focused?: boolean;
  incognito?: boolean;
  type?: string;
  state?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface CliListTabsOptions {
  windowId?: number;
  currentWindow?: boolean;
}

export interface CliOpenTabOptions {
  url: string;
  windowId?: number;
  active?: boolean;
  pinned?: boolean;
}

export interface CliMoveTabOptions {
  windowId?: number;
  index?: number;
}

export interface CliCloseOtherTabsOptions {
  windowId?: number;
  keepTabId?: number;
}

export interface BrowserService {
  listWindows(session: CliSessionRecord): Promise<CliWindowInfo[]>;
  getCurrentWindow(session: CliSessionRecord): Promise<CliWindowInfo>;
  getWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo>;
  createWindow(
    session: CliSessionRecord,
    options?: CliCreateWindowOptions
  ): Promise<CliWindowInfo>;
  focusWindow(session: CliSessionRecord, windowId: number): Promise<CliWindowInfo>;
  closeWindow(session: CliSessionRecord, windowId: number): Promise<void>;
  listTabs(session: CliSessionRecord, options?: CliListTabsOptions): Promise<CliTabInfo[]>;
  openTab(session: CliSessionRecord, options: CliOpenTabOptions): Promise<CliTabInfo>;
  navigateTab(session: CliSessionRecord, tabId: number, url: string): Promise<CliTabInfo>;
  evaluateTab(
    session: CliSessionRecord,
    tabId: number,
    code: string,
    options?: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    }
  ): Promise<unknown>;
  printToPdf(
    session: CliSessionRecord,
    tabId: number,
    options?: {
      landscape?: boolean;
      printBackground?: boolean;
      scale?: number;
      paperWidth?: number;
      paperHeight?: number;
      preferCSSPageSize?: boolean;
    }
  ): Promise<{ dataBase64: string }>;
  getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo>;
  activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo>;
  closeTabs(session: CliSessionRecord, tabIds: number[]): Promise<void>;
  closeOtherTabs(
    session: CliSessionRecord,
    options?: CliCloseOtherTabsOptions
  ): Promise<{ closedTabIds: number[]; keptTabIds: number[] }>;
  reloadTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo>;
  duplicateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo>;
  moveTab(
    session: CliSessionRecord,
    tabId: number,
    options: CliMoveTabOptions
  ): Promise<CliTabInfo>;
  pinTabs(session: CliSessionRecord, tabIds: number[], pinned: boolean): Promise<CliTabInfo[]>;
  muteTabs(session: CliSessionRecord, tabIds: number[], muted: boolean): Promise<CliTabInfo[]>;
  groupTabs(session: CliSessionRecord, tabIds: number[]): Promise<{
    groupId: number;
    tabs: CliTabInfo[];
  }>;
  ungroupTabs(session: CliSessionRecord, tabIds: number[]): Promise<CliTabInfo[]>;
  attachDebugger(
    session: CliSessionRecord,
    tabId: number
  ): Promise<{ attached: boolean; alreadyAttached: boolean }>;
  detachDebugger(session: CliSessionRecord, tabId: number): Promise<{ detached: boolean }>;
  sendDebuggerCommand(
    session: CliSessionRecord,
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown>;
  getDebuggerEvents(
    session: CliSessionRecord,
    tabId: number,
    options?: { filter?: string; clear?: boolean }
  ): Promise<CliDebuggerEvent[]>;
  getStorageItems(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea
  ): Promise<Record<string, string>>;
  getStorageValue(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string
  ): Promise<string | null>;
  setStorageValue(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string,
    value: string
  ): Promise<string | null>;
  clearStorage(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key?: string
  ): Promise<{ clearedCount: number; existed?: boolean }>;
  captureStorageState(session: CliSessionRecord, tabId: number): Promise<CliStorageState>;
  applyStorageState(
    session: CliSessionRecord,
    tabId: number,
    state: CliStorageState
  ): Promise<{
    origin: string | null;
    url: string | null;
    localCount: number;
    sessionCount: number;
    cookieCount: number;
  }>;
  uploadFiles(
    session: CliSessionRecord,
    tabId: number,
    selector: string,
    paths: string[]
  ): Promise<{ selector: string; files: string[] }>;
  listCookies(
    session: CliSessionRecord,
    options?: { url?: string; domain?: string }
  ): Promise<CliCookieInfo[]>;
  getCookie(
    session: CliSessionRecord,
    name: string,
    options?: { url?: string; domain?: string }
  ): Promise<CliCookieInfo | null>;
  setCookie(
    session: CliSessionRecord,
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
  ): Promise<CliCookieInfo>;
  clearCookies(
    session: CliSessionRecord,
    options?: { url?: string; domain?: string; name?: string }
  ): Promise<{ clearedCount: number }>;
  listDownloads(
    session: CliSessionRecord,
    filter?: CliDownloadsFilter
  ): Promise<CliDownloadInfo[]>;
  waitForDownload(
    session: CliSessionRecord,
    filter?: CliDownloadsFilter,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      requireComplete?: boolean;
    }
  ): Promise<CliDownloadInfo>;
  cancelDownloads(session: CliSessionRecord, downloadIds: number[]): Promise<void>;
  eraseDownloads(session: CliSessionRecord, downloadIds: number[]): Promise<void>;
}

export type SessionResolutionSource = 'explicit' | 'current' | 'created';

export interface SessionResolutionResult {
  session: CliSessionRecord;
  created: boolean;
  source: SessionResolutionSource;
}

export interface SessionWithCurrentFlag extends CliSessionRecord {
  current: boolean;
}

export interface CliCommandResult {
  data?: unknown;
  lines?: string[];
  session?: CliSessionRecord | null;
}

export interface CliWritable {
  write(chunk: string): unknown;
}

export interface SessionStoreOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface CliRunOptions extends SessionStoreOptions {
  browserService?: BrowserService;
  cwd?: string;
  stdout?: CliWritable;
  stderr?: CliWritable;
}
