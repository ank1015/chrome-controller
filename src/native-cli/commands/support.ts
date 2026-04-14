import { SessionStore } from '../session-store.js';

import type { BrowserService, CliSessionRecord, CliWindowInfo } from '../types.js';

export async function resolveSession(
  sessionStore: SessionStore,
  browserService: BrowserService,
  explicitSessionId?: string
): Promise<CliSessionRecord> {
  const result = await sessionStore.resolveSession(explicitSessionId);
  return await ensureSessionWindow(sessionStore, browserService, result.session);
}

export async function ensureSessionWindow(
  sessionStore: SessionStore,
  browserService: BrowserService,
  session: CliSessionRecord
): Promise<CliSessionRecord> {
  if (typeof session.windowId === 'number') {
    try {
      const window = await browserService.getWindow(session, session.windowId);
      if (typeof window.id === 'number') {
        return session;
      }
    } catch {
      // Fall through to recreate the missing managed window.
    }
  }

  const window = await createManagedSessionWindow(browserService, session);
  if (typeof window.id !== 'number') {
    throw new Error(`Could not create a managed window for session ${session.id}`);
  }

  return await sessionStore.setWindow(session.id, window.id, {
    clearTargetTab: true,
  });
}

export async function createManagedSessionWindow(
  browserService: BrowserService,
  session: CliSessionRecord
): Promise<CliWindowInfo> {
  const managedBrowserService = browserService as BrowserService & {
    createManagedSessionWindow?: (session: CliSessionRecord) => Promise<CliWindowInfo>;
  };

  if (typeof managedBrowserService.createManagedSessionWindow === 'function') {
    return await managedBrowserService.createManagedSessionWindow(session);
  }

  return await browserService.createWindow(session, {
    focused: false,
  });
}

export async function resolveTabId(
  browserService: BrowserService,
  session: CliSessionRecord,
  explicitTabId?: number
): Promise<number> {
  const tab = await resolveTab(browserService, session, explicitTabId);
  return tab.id as number;
}

export async function resolveTab(
  browserService: BrowserService,
  session: CliSessionRecord,
  explicitTabId?: number
): Promise<{ id: number; url: string | null; title: string | null }> {
  if (typeof explicitTabId === 'number') {
    const tab = await browserService.getTab(session, explicitTabId);
    if (typeof tab.id !== 'number') {
      throw new Error(`Could not resolve tab ${explicitTabId}`);
    }

    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
    };
  }

  if (typeof session.targetTabId === 'number') {
    try {
      const tab = await browserService.getTab(session, session.targetTabId);
      if (typeof tab.id !== 'number') {
        throw new Error(`Could not resolve tab ${session.targetTabId}`);
      }

      if (typeof session.windowId === 'number' && tab.windowId !== session.windowId) {
        throw new Error(
          `Pinned target tab ${session.targetTabId} is no longer in managed window ${session.windowId}`
        );
      }

      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
      };
    } catch {
      // Fall back to the active tab in the managed window when the remembered
      // session tab has disappeared or moved elsewhere.
    }
  }

  const tabs = await browserService.listTabs(
    session,
    typeof session.windowId === 'number'
      ? { windowId: session.windowId }
      : { currentWindow: true }
  );
  const activeTab = tabs.find((tab) => tab.active && typeof tab.id === 'number');

  if (!activeTab || typeof activeTab.id !== 'number') {
    if (typeof session.windowId === 'number') {
      throw new Error(`Could not resolve an active tab in managed window ${session.windowId}`);
    }

    throw new Error('Could not resolve an active tab in the managed session window');
  }

  return {
    id: activeTab.id,
    url: activeTab.url,
    title: activeTab.title,
  };
}

export function createImplicitTabResolutionHelpLines(): string[] {
  return [
    "  When --tab is omitted, the session's current tab is used first.",
    "  If the session's current tab is missing or not set, the active tab in the managed session window is used.",
  ];
}

export function createImplicitTabUrlScopeHelpLines(): string[] {
  return [
    "  When no scope is provided, commands use the session's current tab URL first.",
    "  If the session's current tab is missing or not set, they fall back to the active tab URL in the managed session window.",
  ];
}

export function parseOptionalTabFlag(
  args: string[],
  commandName: string
): { args: string[]; tabId?: number } {
  const rest: string[] = [];
  let tabId: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--tab') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value for --tab in ${commandName}`);
      }

      tabId = parsePositiveInteger(value, '--tab');
      index += 1;
      continue;
    }

    if (arg.startsWith('--tab=')) {
      tabId = parsePositiveInteger(arg.slice('--tab='.length), '--tab');
      continue;
    }

    rest.push(arg);
  }

  return {
    args: rest,
    ...(tabId !== undefined ? { tabId } : {}),
  };
}

export function parsePositiveInteger(rawValue: string, flagName: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid integer value for ${flagName}: ${rawValue}`);
  }

  return value;
}

export function parseJsonObject(
  rawValue: string,
  flagName: string
): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${flagName}: ${message}`);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${flagName} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}
