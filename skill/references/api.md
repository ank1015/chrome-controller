# Web Helper API Reference

Use this reference to look up the browser helpers exposed by `@ank1015/llm-agents`.

## Imports

Import from the package root:

```ts
import {
  WebBrowser,
  WebDebuggerSession,
  WebTab,
  connectWeb,
  withWebBrowser,
  type ConnectWebOptions,
  type WebBrowserTabQuery,
  type WebCaptureNetworkOptions,
  type WebDebuggerEvent,
  type WebDebuggerEventFilter,
  type WebDownloadFilter,
  type WebDownloadInfo,
  type WebDownloadWaitOptions,
  type WebEvaluateOptions,
  type WebFindTabsPredicate,
  type WebGetMarkdownOptions,
  type WebNetworkCapture,
  type WebNetworkCaptureAction,
  type WebNetworkRequest,
  type WebNetworkSummary,
  type WebOpenTabOptions,
  type WebScreenshotOptions,
  type WebScreenshotResult,
  type WebTabInfo,
  type WebUploadFilesResult,
  type WebWaitForOptions,
  type WebWaitPredicate,
} from '@ank1015/llm-agents';
```

## Session Helpers

- `connectWeb(...)` returns a managed `WebBrowser` that you close manually.
- `withWebBrowser(...)` opens a managed `WebBrowser`, passes it into a callback, and always closes the helper session in `finally`.
- `WebBrowser.close()` closes the helper session and underlying socket. It does not close Chrome itself, so tabs can remain open for verification after the script exits.

## Top-Level Helpers

### `ConnectWebOptions`

```ts
interface ConnectWebOptions {
  port?: number;
  host?: string;
  launch?: boolean;
  launchTimeout?: number;
}
```

- `port`
  - Chrome bridge TCP port
  - default: extension package default port
- `host`
  - Chrome bridge host
  - default: `127.0.0.1`
- `launch`
  - when `true`, attempt to launch Chrome automatically if the first connection is refused
- `launchTimeout`
  - max milliseconds to wait for Chrome and the native host to become reachable

### `connectWeb(options?)`

```ts
function connectWeb(options?: ConnectWebOptions): Promise<WebBrowser>;
```

Use this when you need manual control of the browser helper lifecycle or want to leave tabs open while still closing the helper connection yourself.

### `withWebBrowser(fn, options?)`

```ts
function withWebBrowser<T>(
  fn: (browser: WebBrowser) => Promise<T>,
  options?: ConnectWebOptions
): Promise<T>;
```

Use this as the default for one-off scripts. The callback return value becomes the return value of `withWebBrowser(...)`.

## Shared Browser And Tab Types

### `WebOpenTabOptions`

```ts
interface WebOpenTabOptions {
  active?: boolean;
  windowId?: number;
  pinned?: boolean;
}
```

### `WebBrowserTabQuery`

```ts
interface WebBrowserTabQuery {
  active?: boolean;
  currentWindow?: boolean;
  lastFocusedWindow?: boolean;
  windowId?: number;
  status?: string;
  title?: string;
  url?: string | readonly string[];
  [key: string]: unknown;
}
```

This is a lightweight wrapper around Chrome tab query filters, with passthrough support for extra query keys when needed.

### `WebTabInfo`

```ts
interface WebTabInfo {
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
```

### `WebFindTabsPredicate`

```ts
type WebFindTabsPredicate = (info: WebTabInfo) => boolean | Promise<boolean>;
```

`findTabs(...)` passes the cached `WebTabInfo` from `tabs.query` into this predicate.

## `WebBrowser`

The class methods below are the core browser-level surface:

```ts
class WebBrowser {
  static connect(options?: ConnectWebOptions): Promise<WebBrowser>;
  close(): Promise<void>;
  openTab(url: string, options?: WebOpenTabOptions): Promise<WebTab>;
  listTabs(filter?: WebBrowserTabQuery): Promise<WebTab[]>;
  findTabs(predicateOrFilter: WebFindTabsPredicate | WebBrowserTabQuery): Promise<WebTab[]>;
  closeTabs(ids: number | WebTab | readonly number[] | readonly WebTab[]): Promise<void>;
  closeOtherTabs(keepIds: number | WebTab | readonly number[] | readonly WebTab[]): Promise<void>;
  chrome<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  listDownloads(filter?: WebDownloadFilter): Promise<WebDownloadInfo[]>;
  waitForDownload(
    filter?: WebDownloadFilter,
    options?: WebDownloadWaitOptions
  ): Promise<WebDownloadInfo>;
  getPageMarkdown(tabId: number, options?: WebGetMarkdownOptions): Promise<string>;
}
```

### Behavior Notes

- `openTab(...)` returns a `WebTab`, not raw tab info.
- `listTabs(...)` and `findTabs(...)` return `WebTab[]`.
- `closeTabs(...)` and `closeOtherTabs(...)` accept tab ids, `WebTab` instances, or arrays of either.
- `chrome(...)` is the raw Chrome API escape hatch. Use it when Chrome already exposes a method you need and there is no first-class wrapper yet.
- `getPageMarkdown(...)` is the browser-level form of markdown capture. Most task code should prefer `tab.getMarkdown(...)`.

## Wait, Evaluation, And Screenshot Types

### `WebWaitPredicate`

```ts
type WebWaitPredicate = string | (() => boolean | Promise<boolean>);
```

- When you pass a string, it is used as page-side JavaScript source.
- When you pass a function, the helper serializes it and runs it in the page.

### `WebWaitForOptions`

```ts
interface WebWaitForOptions {
  selector?: string;
  text?: string;
  urlIncludes?: string;
  predicate?: WebWaitPredicate;
  timeoutMs?: number;
  pollIntervalMs?: number;
}
```

`waitFor(...)` requires at least one of `selector`, `text`, `urlIncludes`, or `predicate`.

### `WebEvaluateOptions`

```ts
interface WebEvaluateOptions {
  awaitPromise?: boolean;
  userGesture?: boolean;
  returnByValue?: boolean;
}
```

### `WebGetMarkdownOptions`

```ts
interface WebGetMarkdownOptions {
  timeoutMs?: number;
  converterUrl?: string;
}
```

### `WebScreenshotOptions`

```ts
type WebScreenshotFormat = 'png' | 'jpeg' | 'webp';

interface WebScreenshotOptions {
  format?: WebScreenshotFormat;
  quality?: number;
  fullPage?: boolean;
  outputPath?: string;
}
```

### `WebScreenshotResult`

```ts
interface WebScreenshotResult {
  mimeType: string;
  format: WebScreenshotFormat;
  path?: string;
  dataBase64: string;
}
```

## `WebTab`

```ts
class WebTab {
  readonly id: number;
  peekInfo(): WebTabInfo;
  info(): Promise<WebTabInfo>;
  goto(url: string, options?: { active?: boolean }): Promise<WebTabInfo>;
  reload(): Promise<void>;
  focus(): Promise<WebTabInfo>;
  close(): Promise<void>;
  waitForLoad(options?: { timeoutMs?: number }): Promise<WebTabInfo>;
  waitFor(options: WebWaitForOptions): Promise<void>;
  waitForIdle(ms: number): Promise<void>;
  evaluate<T = unknown>(code: string, options?: WebEvaluateOptions): Promise<T>;
  getMarkdown(options?: WebGetMarkdownOptions): Promise<string>;
  screenshot(options?: WebScreenshotOptions): Promise<WebScreenshotResult>;
  withDebugger<T>(fn: (debuggerSession: WebDebuggerSession) => Promise<T>): Promise<T>;
  captureNetwork<T>(
    fn: WebNetworkCaptureAction<T>,
    options?: WebCaptureNetworkOptions
  ): Promise<WebNetworkCapture<T>>;
  uploadFiles(selector: string, paths: string | readonly string[]): Promise<WebUploadFilesResult>;
}
```

### Behavior Notes

- `peekInfo()` returns the cached `WebTabInfo` already held by the `WebTab`. It does not refresh from Chrome.
- `info()` fetches fresh tab metadata from Chrome and updates the cached tab info.
- `waitForLoad(...)` waits for `tabs.get(...).status === 'complete'` and returns the fresh `WebTabInfo`.
- `waitFor(...)` resolves when all provided conditions match. It returns `Promise<void>`, not the matched element or data.
- `waitForIdle(ms)` is a simple sleep helper for SPA hydration and post-navigation settling.
- `evaluate(...)` is the main DOM primitive. Pass a self-contained JavaScript string, usually an IIFE like `(() => { ... })()`.
- `getMarkdown(...)` captures page HTML and posts it to a local markdown converter service.
- `screenshot(...)` always returns base64 data, and writes a file only when `outputPath` is provided. If `outputPath` has no extension, the helper appends one for the chosen format.
- `withDebugger(...)` attaches a debugger session for the duration of the callback and detaches automatically when appropriate.
- `uploadFiles(...)` validates that the selector resolves to a real file input and converts input paths to absolute paths before sending them through CDP.

## Network Capture Types

### `WebCaptureNetworkOptions`

```ts
interface WebCaptureNetworkOptions {
  disableCache?: boolean;
  clearExisting?: boolean;
  includeRawEvents?: boolean;
  settleMs?: number;
}
```

### `WebNetworkCaptureAction<T>`

```ts
type WebNetworkCaptureAction<T> = (tab: WebTab, debuggerSession: WebDebuggerSession) => Promise<T>;
```

### `WebNetworkRequest`

```ts
interface WebNetworkRequest {
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
```

### `WebNetworkSummary`

```ts
interface WebNetworkSummary {
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
```

### `WebNetworkCapture<T>`

```ts
interface WebNetworkCapture<T = unknown> {
  result: T;
  events?: WebDebuggerEvent[];
  requests: WebNetworkRequest[];
  summary: WebNetworkSummary;
}
```

`captureNetwork(...)` includes raw `events` by default. Set `includeRawEvents: false` to omit them.

## Download Types

### `WebDownloadFilter`

```ts
interface WebDownloadFilter {
  id?: number;
  state?: string;
  filenameIncludes?: string;
  urlIncludes?: string;
  mimeType?: string;
}
```

### `WebDownloadWaitOptions`

```ts
interface WebDownloadWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  requireComplete?: boolean;
}
```

### `WebDownloadInfo`

```ts
interface WebDownloadInfo {
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
```

`waitForDownload(...)` defaults `requireComplete` to `true`, so it normally resolves only when a matching download reaches `state === 'complete'`.

## Upload Types

### `WebUploadFilesResult`

```ts
interface WebUploadFilesResult {
  selector: string;
  files: string[];
}
```

## Debugger Types And Methods

### `WebDebuggerEvent`

```ts
interface WebDebuggerEvent {
  method: string;
  params: Record<string, unknown>;
}
```

### `WebDebuggerEventFilter`

```ts
type WebDebuggerEventFilter = string;
```

This is usually a prefix filter like `'Network.'` or `'Log.'`.

### `WebDebuggerSession`

```ts
class WebDebuggerSession {
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  events(filter?: WebDebuggerEventFilter): Promise<WebDebuggerEvent[]>;
  clearEvents(filter?: WebDebuggerEventFilter): Promise<void>;
}
```

### Behavior Notes

- `cdp(...)` is the raw Chrome DevTools Protocol escape hatch.
- `events(filter?)` returns captured debugger events for the tab.
- `clearEvents(filter?)` clears previously captured debugger events and returns `Promise<void>`.

## Minimal Example

```ts
import { withWebBrowser } from '@ank1015/llm-agents';

const pageTitle = await withWebBrowser(
  async (browser) => {
    const tab = await browser.openTab('https://example.com', { active: false });
    await tab.waitForLoad();
    await tab.waitFor({ selector: 'body' });
    return await tab.evaluate<string>('document.title');
  },
  { launch: true }
);
```

For task flow and helper selection, continue with [workflow.md](workflow.md).
