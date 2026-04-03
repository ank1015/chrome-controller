import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import { connectManagedChromeBridge } from './core/transport.js';

import type { ManagedChromeBridge, ConnectWebTransportOptions } from './core/transport.js';

export interface ConnectWebOptions extends ConnectWebTransportOptions {}

export interface WebOpenTabOptions {
  active?: boolean;
  windowId?: number;
  pinned?: boolean;
}

export interface WebBrowserTabQuery {
  active?: boolean;
  currentWindow?: boolean;
  lastFocusedWindow?: boolean;
  windowId?: number;
  status?: string;
  title?: string;
  url?: string | readonly string[];
  [key: string]: unknown;
}

export interface WebTabInfo {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
  status?: string;
  active?: boolean;
  pinned?: boolean;
  favIconUrl?: string;
  audible?: boolean;
  discarded?: boolean;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export type WebFindTabsPredicate = (info: WebTabInfo) => boolean | Promise<boolean>;
export type WebWaitPredicate = string | (() => boolean | Promise<boolean>);

export interface WebWaitForOptions {
  selector?: string;
  text?: string;
  urlIncludes?: string;
  predicate?: WebWaitPredicate;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface WebEvaluateOptions {
  awaitPromise?: boolean;
  userGesture?: boolean;
  returnByValue?: boolean;
}


export type WebScreenshotFormat = 'png' | 'jpeg' | 'webp';

export interface WebScreenshotOptions {
  format?: WebScreenshotFormat;
  quality?: number;
  fullPage?: boolean;
  outputPath?: string;
}

export interface WebScreenshotResult {
  mimeType: string;
  format: WebScreenshotFormat;
  path?: string;
  dataBase64: string;
}

export interface WebDebuggerEvent {
  method: string;
  params: Record<string, unknown>;
}

export type WebDebuggerEventFilter = string;

export interface WebNetworkRequest {
  requestId: string;
  url: string;
  hostname: string;
  method: string;
  type: string;
  status: number | null;
  mimeType: string;
  protocol: string;
  fromCache: boolean;
  failed: boolean;
  errorText: string;
}

export interface WebNetworkSummary {
  totalEvents: number;
  totalRequests: number;
  totalResponses: number;
  totalFailures: number;
  domains: Array<{ hostname: string; count: number }>;
  resourceTypes: Array<{ type: string; count: number }>;
  statusCodes: Array<{ status: string; count: number }>;
  cachedResponses: number;
  thirdPartyRequests: number;
  mainDocument: WebNetworkRequest | null;
  redirects: Array<{ from: string; to: string; status: number | null }>;
  failures: Array<{ url: string; errorText: string; type: string }>;
}

export interface WebCaptureNetworkOptions {
  disableCache?: boolean;
  clearExisting?: boolean;
  includeRawEvents?: boolean;
  settleMs?: number;
}

export type WebNetworkCaptureAction<T> = (
  tab: WebTab,
  debuggerSession: WebDebuggerSession
) => Promise<T>;

export interface WebNetworkCapture<T = unknown> {
  result: T;
  events?: WebDebuggerEvent[];
  requests: WebNetworkRequest[];
  summary: WebNetworkSummary;
}

export interface WebDownloadFilter {
  id?: number;
  state?: string;
  filenameIncludes?: string;
  urlIncludes?: string;
  mimeType?: string;
}

export interface WebDownloadWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  requireComplete?: boolean;
}

export interface WebDownloadInfo {
  id?: number;
  url?: string;
  filename?: string;
  state?: string;
  mime?: string;
  exists?: boolean;
  bytesReceived?: number;
  totalBytes?: number;
  error?: string;
  [key: string]: unknown;
}

export interface WebUploadFilesResult {
  selector: string;
  files: string[];
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_MS = 250;
const DEFAULT_NETWORK_SETTLE_MS = 1_500;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const TABS_REMOVE_METHOD = 'tabs.remove';

interface RuntimeEvaluateResult {
  result?: {
    type?: string;
    subtype?: string;
    value?: unknown;
    objectId?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
}

interface DomRequestNodeResult {
  nodeId?: number;
}

interface CaptureScreenshotResult {
  data?: string;
}

interface NetworkEvent {
  method: string;
  params: {
    requestId?: string;
    type?: string;
    request?: {
      url?: string;
      method?: string;
    };
    response?: {
      url?: string;
      status?: number;
      mimeType?: string;
      protocol?: string;
      fromDiskCache?: boolean;
      fromServiceWorker?: boolean;
      fromPrefetchCache?: boolean;
    };
    redirectResponse?: {
      url?: string;
      status?: number;
    };
    errorText?: string;
  };
}

export class WebBrowser {
  #bridge: ManagedChromeBridge;
  #closed = false;

  constructor(bridge: ManagedChromeBridge) {
    this.#bridge = bridge;
  }

  static async connect(options?: ConnectWebOptions): Promise<WebBrowser> {
    const bridge = await connectManagedChromeBridge(options);
    return new WebBrowser(bridge);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;

    await Promise.race([
      this.#bridge.close(),
      sleep(BROWSER_CLOSE_TIMEOUT_MS).then(() => undefined),
    ]);
  }

  async openTab(url: string, options?: WebOpenTabOptions): Promise<WebTab> {
    this.assertOpen();

    const tab = await this.chrome<WebTabInfo>('tabs.create', buildTabCreateOptions(url, options));
    const tabId = assertTabId(tab, `Failed to open tab for ${url}`);
    return new WebTab(this, tabId, tab);
  }

  async listTabs(filter?: WebBrowserTabQuery): Promise<WebTab[]> {
    this.assertOpen();

    const tabs = await this.chrome<WebTabInfo[]>('tabs.query', filter ?? {});
    return tabs
      .filter((tab) => typeof tab.id === 'number')
      .map((tab) => new WebTab(this, tab.id as number, tab));
  }

  async findTabs(predicateOrFilter: WebFindTabsPredicate | WebBrowserTabQuery): Promise<WebTab[]> {
    if (typeof predicateOrFilter !== 'function') {
      return await this.listTabs(predicateOrFilter);
    }

    const tabs = await this.listTabs();
    const matches: WebTab[] = [];

    for (const tab of tabs) {
      const info = tab.peekInfo();
      if (await predicateOrFilter(info)) {
        matches.push(tab);
      }
    }

    return matches;
  }

  async closeTabs(ids: number | WebTab | readonly number[] | readonly WebTab[]): Promise<void> {
    this.assertOpen();

    const normalizedIds = normalizeTabIds(ids);
    if (normalizedIds.length === 0) {
      return;
    }

    await this.chrome(TABS_REMOVE_METHOD, normalizedIds);
  }

  async closeOtherTabs(
    keepIds: number | WebTab | readonly number[] | readonly WebTab[]
  ): Promise<void> {
    this.assertOpen();

    const keep = new Set(normalizeTabIds(keepIds));
    const tabs = await this.listTabs();
    const idsToClose = tabs.filter((tab) => !keep.has(tab.id)).map((tab) => tab.id);

    if (idsToClose.length > 0) {
      await this.chrome(TABS_REMOVE_METHOD, idsToClose);
    }
  }

  async chrome<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    this.assertOpen();
    return await this.#bridge.client.call<T>(method, ...args);
  }

  async listDownloads(filter?: WebDownloadFilter): Promise<WebDownloadInfo[]> {
    this.assertOpen();

    const downloads = await this.chrome<WebDownloadInfo[]>('downloads.search', {});
    return downloads.filter((download) => matchesDownloadFilter(download, filter));
  }

  async waitForDownload(
    filter?: WebDownloadFilter,
    options?: WebDownloadWaitOptions
  ): Promise<WebDownloadInfo> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS;
    const requireComplete = options?.requireComplete ?? true;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const downloads = await this.listDownloads(filter);
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

  assertOpen(): void {
    if (this.#closed) {
      throw new Error('WebBrowser is closed');
    }
  }
}

export class WebTab {
  readonly id: number;
  #browser: WebBrowser;
  #info: WebTabInfo;

  constructor(browser: WebBrowser, id: number, info?: WebTabInfo) {
    this.#browser = browser;
    this.id = id;
    this.#info = info ?? { id };
  }

  peekInfo(): WebTabInfo {
    return { ...this.#info };
  }

  async info(): Promise<WebTabInfo> {
    const info = await this.#browser.chrome<WebTabInfo>('tabs.get', this.id);
    this.#info = info;
    return info;
  }

  async goto(url: string, options?: { active?: boolean }): Promise<WebTabInfo> {
    const tab = await this.#browser.chrome<WebTabInfo>('tabs.update', this.id, {
      url,
      ...(options?.active !== undefined ? { active: options.active } : {}),
    });
    this.#info = tab;
    return tab;
  }

  async reload(): Promise<void> {
    await this.#browser.chrome('tabs.reload', this.id);
  }

  async focus(): Promise<WebTabInfo> {
    const updated = await this.#browser.chrome<WebTabInfo>('tabs.update', this.id, {
      active: true,
    });
    this.#info = updated;

    const windowId = updated.windowId ?? this.#info.windowId;
    if (typeof windowId === 'number') {
      await this.#browser.chrome('windows.update', windowId, { focused: true });
    }

    return updated;
  }

  async close(): Promise<void> {
    await this.#browser.chrome(TABS_REMOVE_METHOD, this.id);
  }

  async waitForLoad(options?: { timeoutMs?: number }): Promise<WebTabInfo> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const info = await this.info();
      if (info.status === 'complete') {
        return info;
      }

      await sleep(DEFAULT_WAIT_POLL_MS);
    }

    throw new Error(`Tab ${this.id} did not finish loading within ${timeoutMs}ms`);
  }

  async waitFor(options: WebWaitForOptions): Promise<void> {
    if (!options.selector && !options.text && !options.urlIncludes && !options.predicate) {
      throw new Error('waitFor requires at least one condition');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.matchesWaitCondition(options)) {
        return;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for tab condition within ${timeoutMs}ms`);
  }

  async waitForIdle(ms: number): Promise<void> {
    await sleep(ms);
  }

  async evaluate<T = unknown>(code: string, options?: WebEvaluateOptions): Promise<T> {
    const result = await this.#browser.chrome<{ result?: T }>('debugger.evaluate', {
      tabId: this.id,
      code,
      returnByValue: options?.returnByValue ?? true,
      awaitPromise: options?.awaitPromise ?? false,
      userGesture: options?.userGesture ?? false,
    });

    return result.result as T;
  }

  async screenshot(options?: WebScreenshotOptions): Promise<WebScreenshotResult> {
    return await this.withDebugger(async (debuggerSession) => {
      await debuggerSession.cdp('Page.enable');

      const format = options?.format ?? 'png';
      const quality =
        format === 'jpeg' && typeof options?.quality === 'number'
          ? Math.max(0, Math.min(100, options.quality))
          : undefined;

      const result = await debuggerSession.cdp<CaptureScreenshotResult>('Page.captureScreenshot', {
        format,
        ...(quality !== undefined ? { quality } : {}),
        ...(options?.fullPage ? { captureBeyondViewport: true } : {}),
      });

      const dataBase64 = result.data ?? '';
      if (!dataBase64) {
        throw new Error(`Failed to capture screenshot for tab ${this.id}`);
      }

      const outputPath = options?.outputPath
        ? resolve(_defaultScreenshotPath(options.outputPath, format))
        : undefined;
      if (outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, Buffer.from(dataBase64, 'base64'));
      }

      return {
        mimeType: `image/${format === 'jpeg' ? 'jpeg' : format}`,
        format,
        ...(outputPath ? { path: outputPath } : {}),
        dataBase64,
      };
    });
  }

  async withDebugger<T>(fn: (debuggerSession: WebDebuggerSession) => Promise<T>): Promise<T> {
    const attachResult = await this.#browser.chrome<{
      attached?: boolean;
      alreadyAttached?: boolean;
    }>('debugger.attach', { tabId: this.id });

    const shouldDetach = attachResult.alreadyAttached !== true;
    const debuggerSession = new WebDebuggerSession(this.#browser, this.id, shouldDetach);

    try {
      return await fn(debuggerSession);
    } finally {
      await debuggerSession.dispose();
    }
  }

  async captureNetwork<T>(
    fn: WebNetworkCaptureAction<T>,
    options?: WebCaptureNetworkOptions
  ): Promise<WebNetworkCapture<T>> {
    return await this.withDebugger(async (debuggerSession) => {
      if (options?.clearExisting !== false) {
        await debuggerSession.clearEvents('Network.');
      }

      await debuggerSession.cdp('Network.enable');
      if (options?.disableCache) {
        await debuggerSession.cdp('Network.setCacheDisabled', { cacheDisabled: true });
      }

      const result = await fn(this, debuggerSession);
      await sleep(options?.settleMs ?? DEFAULT_NETWORK_SETTLE_MS);

      const events = await debuggerSession.events('Network.');
      const requests = summarizeNetworkRequests(events);

      return {
        result,
        ...(options?.includeRawEvents !== false ? { events } : {}),
        requests,
        summary: summarizeNetwork(events, requests),
      };
    });
  }

  async uploadFiles(
    selector: string,
    paths: string | readonly string[]
  ): Promise<WebUploadFilesResult> {
    const files = normalizeFilePaths(paths);

    await this.withDebugger(async (debuggerSession) => {
      await debuggerSession.cdp('DOM.enable');
      await debuggerSession.cdp('Runtime.enable');

      const expression = `document.querySelector(${JSON.stringify(selector)})`;
      const runtimeResult = await debuggerSession.cdp<RuntimeEvaluateResult>('Runtime.evaluate', {
        expression,
        objectGroup: 'web-upload',
      });

      const objectId = runtimeResult.result?.objectId;
      if (!objectId) {
        throw new Error(`Could not find element for selector: ${selector}`);
      }

      const validation = await debuggerSession.cdp<RuntimeEvaluateResult>('Runtime.evaluate', {
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
      });

      const value = validation.result?.value as
        | { found?: boolean; isFileInput?: boolean }
        | undefined;
      if (!value?.found) {
        throw new Error(`Could not find element for selector: ${selector}`);
      }
      if (!value.isFileInput) {
        throw new Error(`Selector does not target a file input: ${selector}`);
      }

      const node = await debuggerSession.cdp<DomRequestNodeResult>('DOM.requestNode', { objectId });
      if (typeof node.nodeId !== 'number') {
        throw new Error(`Could not resolve file input node for selector: ${selector}`);
      }

      await debuggerSession.cdp('DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files,
      });
    });

    return { selector, files };
  }

  async matchesWaitCondition(options: WebWaitForOptions): Promise<boolean> {
    if (options.urlIncludes) {
      const info = await this.info();
      if (!info.url?.includes(options.urlIncludes)) {
        return false;
      }
    }

    if (!options.selector && !options.text && !options.predicate) {
      return true;
    }

    const predicateSource = serializeWaitPredicate(options.predicate);
    const selector = options.selector ?? null;
    const text = options.text ?? null;

    return await this.evaluate<boolean>(
      `(() => {
        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const selector = ${JSON.stringify(selector)};
        const text = ${JSON.stringify(text)};
        let element = null;

        if (selector) {
          element = document.querySelector(selector);
          if (!element) {
            return false;
          }
        }

        if (text) {
          const haystack = normalize(element ? (element.textContent || '') : (document.body?.innerText || ''));
          if (!haystack.includes(text)) {
            return false;
          }
        }

        if (${predicateSource !== null}) {
          return Boolean(${predicateSource ?? 'true'});
        }

        return true;
      })()`,
      {
        awaitPromise: typeof options.predicate === 'function' && isAsyncFunction(options.predicate),
      }
    );
  }
}

export class WebDebuggerSession {
  #browser: WebBrowser;
  #tabId: number;
  #shouldDetach: boolean;
  #disposed = false;

  constructor(browser: WebBrowser, tabId: number, shouldDetach: boolean) {
    this.#browser = browser;
    this.#tabId = tabId;
    this.#shouldDetach = shouldDetach;
  }

  async cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return await this.#browser.chrome<T>('debugger.sendCommand', {
      tabId: this.#tabId,
      method,
      ...(params ? { params } : {}),
    });
  }

  async events(filter?: WebDebuggerEventFilter): Promise<WebDebuggerEvent[]> {
    return await this.#browser.chrome<WebDebuggerEvent[]>('debugger.getEvents', {
      tabId: this.#tabId,
      ...(filter ? { filter } : {}),
    });
  }

  async clearEvents(filter?: WebDebuggerEventFilter): Promise<void> {
    await this.#browser.chrome('debugger.getEvents', {
      tabId: this.#tabId,
      ...(filter ? { filter } : {}),
      clear: true,
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    if (!this.#shouldDetach) {
      return;
    }

    try {
      await this.#browser.chrome('debugger.detach', { tabId: this.#tabId });
    } catch {
      // Safe to ignore cleanup failures when the tab is already gone.
    }
  }
}

export async function connectWeb(options?: ConnectWebOptions): Promise<WebBrowser> {
  return await WebBrowser.connect(options);
}

export async function withWebBrowser<T>(
  fn: (browser: WebBrowser) => Promise<T>,
  options?: ConnectWebOptions
): Promise<T> {
  const browser = await connectWeb(options);

  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

function buildTabCreateOptions(url: string, options?: WebOpenTabOptions): Record<string, unknown> {
  return {
    url,
    ...(options?.active !== undefined ? { active: options.active } : {}),
    ...(options?.windowId !== undefined ? { windowId: options.windowId } : {}),
    ...(options?.pinned !== undefined ? { pinned: options.pinned } : {}),
  };
}

function assertTabId(tab: WebTabInfo, errorMessage: string): number {
  if (typeof tab.id !== 'number') {
    throw new Error(errorMessage);
  }

  return tab.id;
}

function normalizeTabIds(ids: number | WebTab | readonly number[] | readonly WebTab[]): number[] {
  const values = Array.isArray(ids) ? ids : [ids];
  const normalized: number[] = [];

  for (const value of values) {
    if (typeof value === 'number') {
      normalized.push(value);
      continue;
    }

    if (value instanceof WebTab) {
      normalized.push(value.id);
    }
  }

  return normalized;
}

function normalizeFilePaths(paths: string | readonly string[]): string[] {
  return (Array.isArray(paths) ? [...paths] : [paths]).map((path) => resolve(path));
}

function matchesDownloadFilter(download: WebDownloadInfo, filter?: WebDownloadFilter): boolean {
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

  const mimeType = download.mime;
  if (filter.mimeType && mimeType !== filter.mimeType) {
    return false;
  }

  return true;
}

function serializeWaitPredicate(predicate?: WebWaitPredicate): string | null {
  if (!predicate) {
    return null;
  }

  if (typeof predicate === 'string') {
    return predicate;
  }

  return `(${predicate.toString()})()`;
}

function isAsyncFunction(fn: Function): boolean {
  return fn.constructor.name === 'AsyncFunction';
}

function summarizeNetworkRequests(events: WebDebuggerEvent[]): WebNetworkRequest[] {
  const requests = new Map<string, WebNetworkRequest>();

  for (const event of events as NetworkEvent[]) {
    const requestId = event.params.requestId ?? '';
    if (!requestId) {
      continue;
    }

    const current =
      requests.get(requestId) ??
      ({
        requestId,
        url: '',
        hostname: '',
        method: '',
        type: event.params.type ?? 'Unknown',
        status: null,
        mimeType: '',
        protocol: '',
        fromCache: false,
        failed: false,
        errorText: '',
      } satisfies WebNetworkRequest);

    if (event.method === 'Network.requestWillBeSent') {
      const url = event.params.request?.url ?? current.url;
      current.url = url;
      current.hostname = getHostname(url);
      current.method = event.params.request?.method ?? current.method;
      current.type = event.params.type ?? current.type;
    }

    if (event.method === 'Network.responseReceived') {
      current.url = event.params.response?.url ?? current.url;
      current.hostname = getHostname(current.url);
      current.type = event.params.type ?? current.type;
      current.status = event.params.response?.status ?? current.status;
      current.mimeType = event.params.response?.mimeType ?? current.mimeType;
      current.protocol = event.params.response?.protocol ?? current.protocol;
      current.fromCache = Boolean(
        event.params.response?.fromDiskCache ||
        event.params.response?.fromPrefetchCache ||
        event.params.response?.fromServiceWorker
      );
    }

    if (event.method === 'Network.loadingFailed') {
      current.failed = true;
      current.errorText = event.params.errorText ?? '';
    }

    requests.set(requestId, current);
  }

  return [...requests.values()].filter((request) => request.url.length > 0);
}

function summarizeNetwork(
  events: WebDebuggerEvent[],
  requests: WebNetworkRequest[]
): WebNetworkSummary {
  const domainCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const redirects: Array<{ from: string; to: string; status: number | null }> = [];
  const failures: Array<{ url: string; errorText: string; type: string }> = [];

  let cachedResponses = 0;
  let thirdPartyRequests = 0;

  for (const request of requests) {
    increment(domainCounts, request.hostname);
    increment(typeCounts, request.type);
    increment(statusCounts, request.status === null ? 'none' : String(request.status));

    if (request.fromCache) {
      cachedResponses += 1;
    }

    if (request.hostname && !isFirstPartyHostname(request.hostname)) {
      thirdPartyRequests += 1;
    }

    if (request.failed) {
      failures.push({
        url: request.url,
        errorText: request.errorText,
        type: request.type,
      });
    }
  }

  for (const event of events as NetworkEvent[]) {
    if (event.method !== 'Network.requestWillBeSent') {
      continue;
    }

    const redirect = event.params.redirectResponse;
    const to = event.params.request?.url;
    if (!redirect?.url || !to || redirect.url === to) {
      continue;
    }

    redirects.push({
      from: redirect.url,
      to,
      status: redirect.status ?? null,
    });
  }

  return {
    totalEvents: events.length,
    totalRequests: requests.length,
    totalResponses: requests.filter((request) => request.status !== null).length,
    totalFailures: failures.length,
    domains: sortCounts(domainCounts).map((item) => ({
      hostname: item.key,
      count: item.count,
    })),
    resourceTypes: sortCounts(typeCounts).map((item) => ({
      type: item.key,
      count: item.count,
    })),
    statusCodes: sortCounts(statusCounts).map((item) => ({
      status: item.key,
      count: item.count,
    })),
    cachedResponses,
    thirdPartyRequests,
    mainDocument:
      requests.find((request) => request.type === 'Document' && request.url.startsWith('http')) ??
      null,
    redirects,
    failures,
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortCounts(map: Map<string, number>): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

function isFirstPartyHostname(hostname: string): boolean {
  return (
    hostname === 'github.com' ||
    hostname.endsWith('.github.com') ||
    hostname === 'githubassets.com' ||
    hostname.endsWith('.githubassets.com') ||
    hostname === 'githubusercontent.com' ||
    hostname.endsWith('.githubusercontent.com')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function _createWebBrowserForTesting(bridge: ManagedChromeBridge): WebBrowser {
  return new WebBrowser(bridge);
}

export function _getScreenshotExtension(format: WebScreenshotFormat): string {
  if (format === 'jpeg') {
    return '.jpg';
  }

  return `.${format}`;
}

export function _defaultScreenshotPath(outputPath: string, format: WebScreenshotFormat): string {
  return extname(outputPath) ? outputPath : `${outputPath}${_getScreenshotExtension(format)}`;
}
