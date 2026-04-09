import type { CliDebuggerEvent } from './types.js';

declare const document: any;
declare const location: any;
declare const globalThis: any;
declare const MutationObserver: any;

export const PAGE_STABILITY_EVAL_MARKER = '__chrome_controller_wait_stable_v1__';

export interface CliPageStabilityInfo {
  readyState: string;
  url: string | null;
  nowMs: number;
  lastMutationAtMs: number;
  quietForMs: number;
  mutationCount: number;
}

export interface CliNetworkStabilityInfo {
  eventCount: number;
  inflightRequests: number;
  finishedRequests: number;
  failedRequests: number;
}

interface NetworkEventLike {
  method: string;
  params?: {
    requestId?: string;
  };
}

interface PageStabilityState {
  url: string;
  lastMutationAtMs: number;
  mutationCount: number;
  observer?: any;
}

export function buildPageStabilityEvaluationCode(): string {
  return `(${pageStabilityRuntime.toString()})(${JSON.stringify(PAGE_STABILITY_EVAL_MARKER)})`;
}

export function parsePageStabilityInfo(raw: unknown): CliPageStabilityInfo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Failed to capture page stability state');
  }

  const payload = raw as Record<string, unknown>;
  if (payload[PAGE_STABILITY_EVAL_MARKER] !== true) {
    throw new Error('Failed to capture page stability state');
  }

  const nowMs = asFiniteNumber(payload.nowMs) ?? Date.now();
  const lastMutationAtMs = asFiniteNumber(payload.lastMutationAtMs) ?? nowMs;
  const quietForMs = asFiniteNumber(payload.quietForMs) ?? Math.max(0, nowMs - lastMutationAtMs);

  return {
    readyState: typeof payload.readyState === 'string' ? payload.readyState : 'unknown',
    url: typeof payload.url === 'string' ? payload.url : null,
    nowMs,
    lastMutationAtMs,
    quietForMs,
    mutationCount: asNonNegativeInteger(payload.mutationCount) ?? 0,
  };
}

export function summarizeNetworkEventsForStability(
  events: CliDebuggerEvent[]
): CliNetworkStabilityInfo {
  const inflightRequestIds = new Set<string>();
  let finishedRequests = 0;
  let failedRequests = 0;

  for (const event of events as NetworkEventLike[]) {
    const requestId =
      typeof event.params?.requestId === 'string' ? event.params.requestId : null;
    if (!requestId) {
      continue;
    }

    if (event.method === 'Network.requestWillBeSent') {
      inflightRequestIds.add(requestId);
      continue;
    }

    if (event.method === 'Network.loadingFinished') {
      if (inflightRequestIds.delete(requestId)) {
        finishedRequests += 1;
      }
      continue;
    }

    if (event.method === 'Network.loadingFailed') {
      if (inflightRequestIds.delete(requestId)) {
        failedRequests += 1;
      }
    }
  }

  return {
    eventCount: events.length,
    inflightRequests: inflightRequestIds.size,
    finishedRequests,
    failedRequests,
  };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function pageStabilityRuntime(marker: string): Record<string, unknown> {
  const global = globalThis as Record<string, PageStabilityState | undefined>;
  const nowMs = Date.now();
  const url = typeof location?.href === 'string' ? location.href : '';
  const existing = global[marker];

  const ensureState = (): PageStabilityState => {
    if (existing && existing.url === url && existing.observer) {
      return existing;
    }

    if (existing?.observer) {
      existing.observer.disconnect();
    }

    const state: PageStabilityState = {
      url,
      lastMutationAtMs: nowMs,
      mutationCount: 0,
    };

    const observer = new MutationObserver((mutations: unknown[]) => {
      state.lastMutationAtMs = Date.now();
      state.mutationCount += mutations.length;
      state.url = typeof location?.href === 'string' ? location.href : state.url;
    });

    const root = document.documentElement ?? document.body ?? document;
    if (root) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }

    state.observer = observer;
    global[marker] = state;
    return state;
  };

  const state = ensureState();

  if (state.url !== url) {
    state.url = url;
    state.lastMutationAtMs = nowMs;
  }

  return {
    [marker]: true,
    readyState: typeof document?.readyState === 'string' ? document.readyState : 'unknown',
    url: url || null,
    nowMs,
    lastMutationAtMs: state.lastMutationAtMs,
    quietForMs: Math.max(0, nowMs - state.lastMutationAtMs),
    mutationCount: state.mutationCount,
  };
}
