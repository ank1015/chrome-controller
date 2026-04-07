export interface TrackedDebuggerSession {
  events: { method: string; params: unknown }[];
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

export async function ensureTrackedDebuggerSession(
  api: ChromeDebuggerApi,
  sessions: Map<number, TrackedDebuggerSession>,
  tabId: number
): Promise<{ attached: boolean; alreadyAttached: boolean }> {
  const existing = sessions.get(tabId);

  if (existing) {
    const isAttached = await isDebuggerAttached(api, tabId);
    if (isAttached) {
      return {
        attached: true,
        alreadyAttached: true,
      };
    }

    sessions.delete(tabId);
  }

  await api.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  sessions.set(tabId, existing ?? { events: [] });
  return {
    attached: true,
    alreadyAttached: false,
  };
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

export function clearTrackedDebuggerSession(
  sessions: Map<number, TrackedDebuggerSession>,
  debuggee: ChromeDebuggerDebuggee
): void {
  if (typeof debuggee.tabId !== 'number') {
    return;
  }

  sessions.delete(debuggee.tabId);
}

async function isDebuggerAttached(api: ChromeDebuggerApi, tabId: number): Promise<boolean> {
  const targets = await api.getTargets();
  return targets.some((target) => target.tabId === tabId && target.attached === true);
}
