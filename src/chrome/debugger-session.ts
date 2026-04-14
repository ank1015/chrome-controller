export interface TrackedDebuggerSession {
  events: { method: string; params: unknown }[];
  holds?: number;
}

export interface ChromeDebuggerTarget {
  tabId?: number;
  attached: boolean;
}

export interface ChromeDebuggerDebuggee {
  tabId?: number;
}

export interface ChromeDebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>;
  sendCommand(
    target: { tabId: number },
    method: string,
    params?: object
  ): Promise<unknown>;
  detach(target: { tabId: number }): Promise<void>;
  getTargets(): Promise<ChromeDebuggerTarget[]>;
}

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DETACHED_DEBUGGER_MESSAGE = 'Debugger is not attached to the tab with id';
const ALREADY_ATTACHED_DEBUGGER_MESSAGE = 'Another debugger is already attached';
const MAX_ATTACH_ATTEMPTS = 3;
const ATTACH_RETRY_DELAY_MS = 25;
const tabDebuggerLocks = new Map<number, Promise<void>>();

export async function ensureTrackedDebuggerSession(
  api: ChromeDebuggerApi,
  sessions: Map<number, TrackedDebuggerSession>,
  tabId: number
): Promise<{ attached: boolean; alreadyAttached: boolean }> {
  return await withTabDebuggerLock(tabId, async () => {
    const existing = sessions.get(tabId);

    if (existing) {
      const isAttached = await isDebuggerAttached(api, tabId);
      if (isAttached) {
        existing.holds = getHoldCount(existing) + 1;
        return {
          attached: true,
          alreadyAttached: true,
        };
      }

      sessions.delete(tabId);
    }

    for (let attempt = 0; attempt < MAX_ATTACH_ATTEMPTS; attempt += 1) {
      try {
        await api.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
        sessions.set(tabId, {
          events: existing?.events ?? [],
          holds: getHoldCount(existing, 0) + 1,
        });
        return {
          attached: true,
          alreadyAttached: false,
        };
      } catch (error) {
        if (!isAlreadyAttachedDebuggerError(error)) {
          throw error;
        }

        const isAttached = await isDebuggerAttached(api, tabId);
        if (isAttached) {
          sessions.set(tabId, {
            events: existing?.events ?? [],
            holds: getHoldCount(existing, 0) + 1,
          });
          return {
            attached: true,
            alreadyAttached: true,
          };
        }

        if (attempt < MAX_ATTACH_ATTEMPTS - 1) {
          await delay(ATTACH_RETRY_DELAY_MS);
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Failed to attach debugger to tab ${tabId}`);
  });
}

export async function sendTrackedDebuggerCommand(
  api: ChromeDebuggerApi,
  sessions: Map<number, TrackedDebuggerSession>,
  tabId: number,
  method: string,
  params?: object
): Promise<unknown> {
  const existing = sessions.get(tabId);
  if (!existing) {
    throw new Error(`No debugger session for tab ${tabId} — call debugger.attach first`);
  }

  try {
    return await api.sendCommand({ tabId }, method, params);
  } catch (error) {
    if (!isDetachedDebuggerError(error)) {
      throw error;
    }

    await api.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
    sessions.set(tabId, existing);
    return await api.sendCommand({ tabId }, method, params);
  }
}

export function isDetachedDebuggerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DETACHED_DEBUGGER_MESSAGE);
}

function isAlreadyAttachedDebuggerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ALREADY_ATTACHED_DEBUGGER_MESSAGE);
}

export function clearTrackedDebuggerSession(
  sessions: Map<number, TrackedDebuggerSession>,
  debuggee: ChromeDebuggerDebuggee
): void {
  if (typeof debuggee.tabId !== 'number') {
    return;
  }

  sessions.delete(debuggee.tabId);
}

export async function releaseTrackedDebuggerSession(
  api: ChromeDebuggerApi,
  sessions: Map<number, TrackedDebuggerSession>,
  tabId: number
): Promise<{ detached: boolean; remainingHolds: number }> {
  return await withTabDebuggerLock(tabId, async () => {
    const session = sessions.get(tabId);
    if (!session) {
      return {
        detached: true,
        remainingHolds: 0,
      };
    }

    const remainingHolds = Math.max(0, getHoldCount(session) - 1);
    session.holds = remainingHolds;

    if (remainingHolds > 0) {
      return {
        detached: false,
        remainingHolds,
      };
    }

    sessions.delete(tabId);

    try {
      await api.detach({ tabId });
    } catch {
      // Already detached or tab closed
    }

    return {
      detached: true,
      remainingHolds: 0,
    };
  });
}

async function isDebuggerAttached(api: ChromeDebuggerApi, tabId: number): Promise<boolean> {
  const targets = await api.getTargets();
  return targets.some((target) => target.tabId === tabId && target.attached === true);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getHoldCount(session: TrackedDebuggerSession | undefined, defaultValue = 1): number {
  if (!session) {
    return defaultValue;
  }

  return typeof session.holds === 'number' && session.holds > 0 ? session.holds : defaultValue;
}

async function withTabDebuggerLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const previous = tabDebuggerLocks.get(tabId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  tabDebuggerLocks.set(tabId, chained);

  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release?.();
    if (tabDebuggerLocks.get(tabId) === chained) {
      tabDebuggerLocks.delete(tabId);
    }
  }
}
