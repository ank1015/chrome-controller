import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { connectManagedChromeBridge } from './core/transport.js';
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_MS = 250;
const DEFAULT_NETWORK_SETTLE_MS = 1_500;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const TABS_REMOVE_METHOD = 'tabs.remove';
export class WebBrowser {
    #bridge;
    #closed = false;
    constructor(bridge) {
        this.#bridge = bridge;
    }
    static async connect(options) {
        const bridge = await connectManagedChromeBridge(options);
        return new WebBrowser(bridge);
    }
    async close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        await Promise.race([
            this.#bridge.close(),
            sleep(BROWSER_CLOSE_TIMEOUT_MS).then(() => undefined),
        ]);
    }
    async openTab(url, options) {
        this.assertOpen();
        const tab = await this.chrome('tabs.create', buildTabCreateOptions(url, options));
        const tabId = assertTabId(tab, `Failed to open tab for ${url}`);
        return new WebTab(this, tabId, tab);
    }
    async listTabs(filter) {
        this.assertOpen();
        const tabs = await this.chrome('tabs.query', filter ?? {});
        return tabs
            .filter((tab) => typeof tab.id === 'number')
            .map((tab) => new WebTab(this, tab.id, tab));
    }
    async findTabs(predicateOrFilter) {
        if (typeof predicateOrFilter !== 'function') {
            return await this.listTabs(predicateOrFilter);
        }
        const tabs = await this.listTabs();
        const matches = [];
        for (const tab of tabs) {
            const info = tab.peekInfo();
            if (await predicateOrFilter(info)) {
                matches.push(tab);
            }
        }
        return matches;
    }
    async closeTabs(ids) {
        this.assertOpen();
        const normalizedIds = normalizeTabIds(ids);
        if (normalizedIds.length === 0) {
            return;
        }
        await this.chrome(TABS_REMOVE_METHOD, normalizedIds);
    }
    async closeOtherTabs(keepIds) {
        this.assertOpen();
        const keep = new Set(normalizeTabIds(keepIds));
        const tabs = await this.listTabs();
        const idsToClose = tabs.filter((tab) => !keep.has(tab.id)).map((tab) => tab.id);
        if (idsToClose.length > 0) {
            await this.chrome(TABS_REMOVE_METHOD, idsToClose);
        }
    }
    async chrome(method, ...args) {
        this.assertOpen();
        return await this.#bridge.client.call(method, ...args);
    }
    async listDownloads(filter) {
        this.assertOpen();
        const downloads = await this.chrome('downloads.search', {});
        return downloads.filter((download) => matchesDownloadFilter(download, filter));
    }
    async waitForDownload(filter, options) {
        const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
        const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS;
        const requireComplete = options?.requireComplete ?? true;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const downloads = await this.listDownloads(filter);
            const match = downloads.find((download) => requireComplete ? download.state === 'complete' : true);
            if (match) {
                return match;
            }
            await sleep(pollIntervalMs);
        }
        throw new Error(`Timed out waiting for download within ${timeoutMs}ms`);
    }
    assertOpen() {
        if (this.#closed) {
            throw new Error('WebBrowser is closed');
        }
    }
}
export class WebTab {
    id;
    #browser;
    #info;
    constructor(browser, id, info) {
        this.#browser = browser;
        this.id = id;
        this.#info = info ?? { id };
    }
    peekInfo() {
        return { ...this.#info };
    }
    async info() {
        const info = await this.#browser.chrome('tabs.get', this.id);
        this.#info = info;
        return info;
    }
    async goto(url, options) {
        const tab = await this.#browser.chrome('tabs.update', this.id, {
            url,
            ...(options?.active !== undefined ? { active: options.active } : {}),
        });
        this.#info = tab;
        return tab;
    }
    async reload() {
        await this.#browser.chrome('tabs.reload', this.id);
    }
    async focus() {
        const updated = await this.#browser.chrome('tabs.update', this.id, {
            active: true,
        });
        this.#info = updated;
        const windowId = updated.windowId ?? this.#info.windowId;
        if (typeof windowId === 'number') {
            await this.#browser.chrome('windows.update', windowId, { focused: true });
        }
        return updated;
    }
    async close() {
        await this.#browser.chrome(TABS_REMOVE_METHOD, this.id);
    }
    async waitForLoad(options) {
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
    async waitFor(options) {
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
    async waitForIdle(ms) {
        await sleep(ms);
    }
    async evaluate(code, options) {
        const result = await this.#browser.chrome('debugger.evaluate', {
            tabId: this.id,
            code,
            returnByValue: options?.returnByValue ?? true,
            awaitPromise: options?.awaitPromise ?? false,
            userGesture: options?.userGesture ?? false,
        });
        return result.result;
    }
    async screenshot(options) {
        return await this.withDebugger(async (debuggerSession) => {
            await debuggerSession.cdp('Page.enable');
            const format = options?.format ?? 'png';
            const quality = format === 'jpeg' && typeof options?.quality === 'number'
                ? Math.max(0, Math.min(100, options.quality))
                : undefined;
            const result = await debuggerSession.cdp('Page.captureScreenshot', {
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
    async withDebugger(fn) {
        const attachResult = await this.#browser.chrome('debugger.attach', { tabId: this.id });
        const shouldDetach = attachResult.alreadyAttached !== true;
        const debuggerSession = new WebDebuggerSession(this.#browser, this.id, shouldDetach);
        try {
            return await fn(debuggerSession);
        }
        finally {
            await debuggerSession.dispose();
        }
    }
    async captureNetwork(fn, options) {
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
    async uploadFiles(selector, paths) {
        const files = normalizeFilePaths(paths);
        await this.withDebugger(async (debuggerSession) => {
            await debuggerSession.cdp('DOM.enable');
            await debuggerSession.cdp('Runtime.enable');
            const expression = `document.querySelector(${JSON.stringify(selector)})`;
            const runtimeResult = await debuggerSession.cdp('Runtime.evaluate', {
                expression,
                objectGroup: 'web-upload',
            });
            const objectId = runtimeResult.result?.objectId;
            if (!objectId) {
                throw new Error(`Could not find element for selector: ${selector}`);
            }
            const validation = await debuggerSession.cdp('Runtime.evaluate', {
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
            const value = validation.result?.value;
            if (!value?.found) {
                throw new Error(`Could not find element for selector: ${selector}`);
            }
            if (!value.isFileInput) {
                throw new Error(`Selector does not target a file input: ${selector}`);
            }
            const node = await debuggerSession.cdp('DOM.requestNode', { objectId });
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
    async matchesWaitCondition(options) {
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
        return await this.evaluate(`(() => {
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
      })()`, {
            awaitPromise: typeof options.predicate === 'function' && isAsyncFunction(options.predicate),
        });
    }
}
export class WebDebuggerSession {
    #browser;
    #tabId;
    #shouldDetach;
    #disposed = false;
    constructor(browser, tabId, shouldDetach) {
        this.#browser = browser;
        this.#tabId = tabId;
        this.#shouldDetach = shouldDetach;
    }
    async cdp(method, params) {
        return await this.#browser.chrome('debugger.sendCommand', {
            tabId: this.#tabId,
            method,
            ...(params ? { params } : {}),
        });
    }
    async events(filter) {
        return await this.#browser.chrome('debugger.getEvents', {
            tabId: this.#tabId,
            ...(filter ? { filter } : {}),
        });
    }
    async clearEvents(filter) {
        await this.#browser.chrome('debugger.getEvents', {
            tabId: this.#tabId,
            ...(filter ? { filter } : {}),
            clear: true,
        });
    }
    async dispose() {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        if (!this.#shouldDetach) {
            return;
        }
        try {
            await this.#browser.chrome('debugger.detach', { tabId: this.#tabId });
        }
        catch {
            // Safe to ignore cleanup failures when the tab is already gone.
        }
    }
}
export async function connectWeb(options) {
    return await WebBrowser.connect(options);
}
export async function withWebBrowser(fn, options) {
    const browser = await connectWeb(options);
    try {
        return await fn(browser);
    }
    finally {
        await browser.close();
    }
}
function buildTabCreateOptions(url, options) {
    return {
        url,
        ...(options?.active !== undefined ? { active: options.active } : {}),
        ...(options?.windowId !== undefined ? { windowId: options.windowId } : {}),
        ...(options?.pinned !== undefined ? { pinned: options.pinned } : {}),
    };
}
function assertTabId(tab, errorMessage) {
    if (typeof tab.id !== 'number') {
        throw new Error(errorMessage);
    }
    return tab.id;
}
function normalizeTabIds(ids) {
    const values = Array.isArray(ids) ? ids : [ids];
    const normalized = [];
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
function normalizeFilePaths(paths) {
    return (Array.isArray(paths) ? [...paths] : [paths]).map((path) => resolve(path));
}
function matchesDownloadFilter(download, filter) {
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
function serializeWaitPredicate(predicate) {
    if (!predicate) {
        return null;
    }
    if (typeof predicate === 'string') {
        return predicate;
    }
    return `(${predicate.toString()})()`;
}
function isAsyncFunction(fn) {
    return fn.constructor.name === 'AsyncFunction';
}
function summarizeNetworkRequests(events) {
    const requests = new Map();
    for (const event of events) {
        const requestId = event.params.requestId ?? '';
        if (!requestId) {
            continue;
        }
        const current = requests.get(requestId) ??
            {
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
            };
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
            current.fromCache = Boolean(event.params.response?.fromDiskCache ||
                event.params.response?.fromPrefetchCache ||
                event.params.response?.fromServiceWorker);
        }
        if (event.method === 'Network.loadingFailed') {
            current.failed = true;
            current.errorText = event.params.errorText ?? '';
        }
        requests.set(requestId, current);
    }
    return [...requests.values()].filter((request) => request.url.length > 0);
}
function summarizeNetwork(events, requests) {
    const domainCounts = new Map();
    const typeCounts = new Map();
    const statusCounts = new Map();
    const redirects = [];
    const failures = [];
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
    for (const event of events) {
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
        mainDocument: requests.find((request) => request.type === 'Document' && request.url.startsWith('http')) ??
            null,
        redirects,
        failures,
    };
}
function increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}
function sortCounts(map) {
    return [...map.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([key, count]) => ({ key, count }));
}
function getHostname(rawUrl) {
    try {
        return new URL(rawUrl).hostname;
    }
    catch {
        return '';
    }
}
function isFirstPartyHostname(hostname) {
    return (hostname === 'github.com' ||
        hostname.endsWith('.github.com') ||
        hostname === 'githubassets.com' ||
        hostname.endsWith('.githubassets.com') ||
        hostname === 'githubusercontent.com' ||
        hostname.endsWith('.githubusercontent.com'));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function _createWebBrowserForTesting(bridge) {
    return new WebBrowser(bridge);
}
export function _getScreenshotExtension(format) {
    if (format === 'jpeg') {
        return '.jpg';
    }
    return `.${format}`;
}
export function _defaultScreenshotPath(outputPath, format) {
    return extname(outputPath) ? outputPath : `${outputPath}${_getScreenshotExtension(format)}`;
}
//# sourceMappingURL=web.js.map