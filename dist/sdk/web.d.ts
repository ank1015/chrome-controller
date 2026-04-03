import type { ManagedChromeBridge, ConnectWebTransportOptions } from './core/transport.js';
export interface ConnectWebOptions extends ConnectWebTransportOptions {
}
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
    domains: Array<{
        hostname: string;
        count: number;
    }>;
    resourceTypes: Array<{
        type: string;
        count: number;
    }>;
    statusCodes: Array<{
        status: string;
        count: number;
    }>;
    cachedResponses: number;
    thirdPartyRequests: number;
    mainDocument: WebNetworkRequest | null;
    redirects: Array<{
        from: string;
        to: string;
        status: number | null;
    }>;
    failures: Array<{
        url: string;
        errorText: string;
        type: string;
    }>;
}
export interface WebCaptureNetworkOptions {
    disableCache?: boolean;
    clearExisting?: boolean;
    includeRawEvents?: boolean;
    settleMs?: number;
}
export type WebNetworkCaptureAction<T> = (tab: WebTab, debuggerSession: WebDebuggerSession) => Promise<T>;
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
export declare class WebBrowser {
    #private;
    constructor(bridge: ManagedChromeBridge);
    static connect(options?: ConnectWebOptions): Promise<WebBrowser>;
    close(): Promise<void>;
    openTab(url: string, options?: WebOpenTabOptions): Promise<WebTab>;
    listTabs(filter?: WebBrowserTabQuery): Promise<WebTab[]>;
    findTabs(predicateOrFilter: WebFindTabsPredicate | WebBrowserTabQuery): Promise<WebTab[]>;
    closeTabs(ids: number | WebTab | readonly number[] | readonly WebTab[]): Promise<void>;
    closeOtherTabs(keepIds: number | WebTab | readonly number[] | readonly WebTab[]): Promise<void>;
    chrome<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
    listDownloads(filter?: WebDownloadFilter): Promise<WebDownloadInfo[]>;
    waitForDownload(filter?: WebDownloadFilter, options?: WebDownloadWaitOptions): Promise<WebDownloadInfo>;
    assertOpen(): void;
}
export declare class WebTab {
    #private;
    readonly id: number;
    constructor(browser: WebBrowser, id: number, info?: WebTabInfo);
    peekInfo(): WebTabInfo;
    info(): Promise<WebTabInfo>;
    goto(url: string, options?: {
        active?: boolean;
    }): Promise<WebTabInfo>;
    reload(): Promise<void>;
    focus(): Promise<WebTabInfo>;
    close(): Promise<void>;
    waitForLoad(options?: {
        timeoutMs?: number;
    }): Promise<WebTabInfo>;
    waitFor(options: WebWaitForOptions): Promise<void>;
    waitForIdle(ms: number): Promise<void>;
    evaluate<T = unknown>(code: string, options?: WebEvaluateOptions): Promise<T>;
    screenshot(options?: WebScreenshotOptions): Promise<WebScreenshotResult>;
    withDebugger<T>(fn: (debuggerSession: WebDebuggerSession) => Promise<T>): Promise<T>;
    captureNetwork<T>(fn: WebNetworkCaptureAction<T>, options?: WebCaptureNetworkOptions): Promise<WebNetworkCapture<T>>;
    uploadFiles(selector: string, paths: string | readonly string[]): Promise<WebUploadFilesResult>;
    matchesWaitCondition(options: WebWaitForOptions): Promise<boolean>;
}
export declare class WebDebuggerSession {
    #private;
    constructor(browser: WebBrowser, tabId: number, shouldDetach: boolean);
    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    events(filter?: WebDebuggerEventFilter): Promise<WebDebuggerEvent[]>;
    clearEvents(filter?: WebDebuggerEventFilter): Promise<void>;
    dispose(): Promise<void>;
}
export declare function connectWeb(options?: ConnectWebOptions): Promise<WebBrowser>;
export declare function withWebBrowser<T>(fn: (browser: WebBrowser) => Promise<T>, options?: ConnectWebOptions): Promise<T>;
export declare function _createWebBrowserForTesting(bridge: ManagedChromeBridge): WebBrowser;
export declare function _getScreenshotExtension(format: WebScreenshotFormat): string;
export declare function _defaultScreenshotPath(outputPath: string, format: WebScreenshotFormat): string;
//# sourceMappingURL=web.d.ts.map