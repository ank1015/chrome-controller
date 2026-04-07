import type { CliDebuggerEvent } from './types.js';

export interface CliNetworkRequestInfo {
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
  encodedDataLength: number | null;
  durationMs: number | null;
}

export interface CliNetworkSummary {
  totalEvents: number;
  totalRequests: number;
  totalResponses: number;
  totalFailures: number;
  domains: Array<{ hostname: string; count: number }>;
  resourceTypes: Array<{ type: string; count: number }>;
  statusCodes: Array<{ status: string; count: number }>;
  cachedResponses: number;
  thirdPartyRequests: number;
  mainDocument: CliNetworkRequestInfo | null;
  redirects: Array<{ from: string; to: string; status: number | null }>;
  failures: Array<{ url: string; errorText: string; type: string }>;
}

interface NetworkEvent {
  method: string;
  params: {
    requestId?: string;
    timestamp?: number;
    wallTime?: number;
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
    encodedDataLength?: number;
    errorText?: string;
  };
}

interface InternalNetworkRequest extends CliNetworkRequestInfo {
  startedDateTime: string | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
}

export function summarizeNetworkRequests(events: CliDebuggerEvent[]): CliNetworkRequestInfo[] {
  return buildInternalNetworkRequests(events).map(
    ({ startedDateTime, startTimestamp, endTimestamp, ...request }) =>
      redactNetworkRequestInfo(request)
  );
}

export function summarizeNetwork(
  events: CliDebuggerEvent[],
  requests: CliNetworkRequestInfo[]
): CliNetworkSummary {
  const domainCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const redirects: Array<{ from: string; to: string; status: number | null }> = [];
  const failures: Array<{ url: string; errorText: string; type: string }> = [];

  let cachedResponses = 0;
  let thirdPartyRequests = 0;
  const mainDocumentHostname =
    requests.find((request) => request.type === 'Document' && request.url.startsWith('http'))
      ?.hostname ??
    requests.find((request) => request.url.startsWith('http'))?.hostname ??
    '';

  for (const request of requests) {
    increment(domainCounts, request.hostname);
    increment(typeCounts, request.type);
    increment(statusCounts, request.status === null ? 'none' : String(request.status));

    if (request.fromCache) {
      cachedResponses += 1;
    }

    if (
      request.hostname &&
      mainDocumentHostname &&
      !isFirstPartyHostname(request.hostname, mainDocumentHostname)
    ) {
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

export function findNetworkRequest(
  events: CliDebuggerEvent[],
  requestId: string
): {
  request: CliNetworkRequestInfo | null;
  events: CliDebuggerEvent[];
} {
  const requests = buildInternalNetworkRequests(events);
  const request = requests.find((item) => item.requestId === requestId) ?? null;
  const matchingEvents = events.filter((event) => {
    const params = event.params as { requestId?: string };
    return params.requestId === requestId;
  });

  return {
    request: request
      ? redactNetworkRequestInfo({
          requestId: request.requestId,
          url: request.url,
          hostname: request.hostname,
          method: request.method,
          type: request.type,
          status: request.status,
          mimeType: request.mimeType,
          protocol: request.protocol,
          fromCache: request.fromCache,
          failed: request.failed,
          errorText: request.errorText,
          encodedDataLength: request.encodedDataLength,
          durationMs: request.durationMs,
        })
      : null,
    events: matchingEvents.map((event) => redactDebuggerEvent(event)),
  };
}

export function buildHar(events: CliDebuggerEvent[]): Record<string, unknown> {
  const requests = buildInternalNetworkRequests(events);
  const startedDateTime =
    requests.find((request) => request.startedDateTime)?.startedDateTime ?? new Date().toISOString();

  return {
    log: {
      version: '1.2',
      creator: {
        name: 'chrome-controller',
        version: '0.0.14',
      },
      pages: [
        {
          id: 'page_1',
          startedDateTime,
          title: 'Chrome Controller Capture',
          pageTimings: {},
        },
      ],
      entries: requests.map((request) => buildHarEntry(request)),
    },
  };
}

function buildInternalNetworkRequests(events: CliDebuggerEvent[]): InternalNetworkRequest[] {
  const requests = new Map<string, InternalNetworkRequest>();

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
        encodedDataLength: null,
        durationMs: null,
        startedDateTime: null,
        startTimestamp: null,
        endTimestamp: null,
      } satisfies InternalNetworkRequest);

    if (event.method === 'Network.requestWillBeSent') {
      const url = event.params.request?.url ?? current.url;
      current.url = url;
      current.hostname = getHostname(url);
      current.method = event.params.request?.method ?? current.method;
      current.type = event.params.type ?? current.type;
      current.startTimestamp =
        typeof event.params.timestamp === 'number' ? event.params.timestamp : current.startTimestamp;
      if (typeof event.params.wallTime === 'number') {
        current.startedDateTime = new Date(event.params.wallTime * 1000).toISOString();
      } else if (current.startedDateTime === null) {
        current.startedDateTime = new Date().toISOString();
      }
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

    if (event.method === 'Network.loadingFinished') {
      current.encodedDataLength =
        typeof event.params.encodedDataLength === 'number'
          ? event.params.encodedDataLength
          : current.encodedDataLength;
      current.endTimestamp =
        typeof event.params.timestamp === 'number' ? event.params.timestamp : current.endTimestamp;
    }

    if (event.method === 'Network.loadingFailed') {
      current.failed = true;
      current.errorText = event.params.errorText ?? '';
      current.endTimestamp =
        typeof event.params.timestamp === 'number' ? event.params.timestamp : current.endTimestamp;
    }

    if (
      typeof current.startTimestamp === 'number' &&
      typeof current.endTimestamp === 'number'
    ) {
      current.durationMs = Math.max(
        0,
        Math.round((current.endTimestamp - current.startTimestamp) * 1000)
      );
    }

    requests.set(requestId, current);
  }

  return [...requests.values()].filter((request) => request.url.length > 0);
}

function buildHarEntry(request: InternalNetworkRequest): Record<string, unknown> {
  return {
    pageref: 'page_1',
    startedDateTime: request.startedDateTime ?? new Date().toISOString(),
    time: request.durationMs ?? 0,
    request: {
      method: request.method || 'GET',
      url: request.url,
      httpVersion: request.protocol || 'unknown',
      cookies: [],
      headers: [],
      queryString: parseQueryString(request.url),
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: request.status ?? 0,
      statusText: '',
      httpVersion: request.protocol || 'unknown',
      cookies: [],
      headers: [],
      content: {
        size: request.encodedDataLength ?? 0,
        mimeType: request.mimeType,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: request.encodedDataLength ?? -1,
    },
    cache: {},
    timings: {
      send: 0,
      wait: request.durationMs ?? 0,
      receive: 0,
    },
  };
}

function parseQueryString(url: string): Array<{ name: string; value: string }> {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.entries()].map(([name, value]) => ({
      name,
      value,
    }));
  } catch {
    return [];
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortCounts(map: Map<string, number>): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isFirstPartyHostname(hostname: string, primaryHostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  const normalizedPrimaryHostname = primaryHostname.trim().toLowerCase();

  if (!normalizedHostname || !normalizedPrimaryHostname) {
    return false;
  }

  return getSiteKey(normalizedHostname) === getSiteKey(normalizedPrimaryHostname);
}

function getSiteKey(hostname: string): string {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isIpAddress(hostname)
  ) {
    return hostname;
  }

  const segments = hostname.split('.').filter(Boolean);
  if (segments.length <= 2) {
    return hostname;
  }

  const lastTwo = segments.slice(-2).join('.');
  const publicSuffixPairs = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.in',
    'com.br',
    'co.jp',
  ]);

  if (publicSuffixPairs.has(lastTwo) && segments.length >= 3) {
    return segments.slice(-3).join('.');
  }

  return lastTwo;
}

function isIpAddress(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

function redactNetworkRequestInfo(request: CliNetworkRequestInfo): CliNetworkRequestInfo {
  return {
    ...request,
    url: redactUrl(request.url),
  };
}

function redactDebuggerEvent(event: CliDebuggerEvent): CliDebuggerEvent {
  return {
    method: event.method,
    params: redactSecretValue(event.params, null) as Record<string, unknown>,
  };
}

function redactSecretValue(value: unknown, key: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretValue(item, key));
  }

  if (typeof value === 'object' && value !== null) {
    if (hasHeaderEntryShape(value)) {
      const headerName = typeof (value as { name?: unknown }).name === 'string'
        ? String((value as { name?: unknown }).name)
        : '';
      return {
        ...value,
        value: isSensitiveKey(headerName.toLowerCase())
          ? '[REDACTED]'
          : redactSecretValue((value as { value?: unknown }).value, 'value'),
      };
    }

    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactSecretValue(entryValue, entryKey);
    }
    return result;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = key?.trim().toLowerCase() ?? null;
  if (normalizedKey === 'url' || normalizedKey === 'documenturl') {
    return redactUrl(value);
  }

  if (normalizedKey === 'headers') {
    return value;
  }

  if (normalizedKey && isSensitiveKey(normalizedKey)) {
    return '[REDACTED]';
  }

  if (looksLikeAuthorizationValue(value) || looksLikeCookieHeader(value)) {
    return '[REDACTED]';
  }

  if (normalizedKey === 'postdata' || normalizedKey === 'postdatatext' || normalizedKey === 'body') {
    return redactStructuredString(value);
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return /(authorization|cookie|set-cookie|token|secret|session|csrf|api[-_]?key|password|email|auth)/i.test(
    key
  );
}

function looksLikeAuthorizationValue(value: string): boolean {
  return /^\s*bearer\s+\S+/i.test(value) || /^basic\s+\S+/i.test(value);
}

function looksLikeCookieHeader(value: string): boolean {
  return /(^|;\s*)(__secure-|__host-|session|token|auth|cookie)=/i.test(value);
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function redactStructuredString(rawValue: string): string {
  const json = tryParseJson(rawValue);
  if (json !== null) {
    return JSON.stringify(redactSecretValue(json, null));
  }

  try {
    const params = new URLSearchParams(rawValue);
    let changed = false;
    for (const key of params.keys()) {
      if (isSensitiveKey(key)) {
        params.set(key, '[REDACTED]');
        changed = true;
      }
    }
    if (changed) {
      return params.toString();
    }
  } catch {
    // ignore parse failure and fall through
  }

  if (looksLikeAuthorizationValue(rawValue) || looksLikeCookieHeader(rawValue)) {
    return '[REDACTED]';
  }

  return rawValue;
}

function tryParseJson(rawValue: string): unknown | null {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function hasHeaderEntryShape(value: object): value is { name?: unknown; value?: unknown } {
  return 'name' in value && 'value' in value;
}
