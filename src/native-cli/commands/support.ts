import { SessionStore } from '../session-store.js';

import type { BrowserService, CliSessionRecord } from '../types.js';

export async function resolveSession(
  sessionStore: SessionStore,
  explicitSessionId?: string
): Promise<CliSessionRecord> {
  const result = await sessionStore.resolveSession(explicitSessionId);
  return result.session;
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

  const tabs = await browserService.listTabs(session, {
    currentWindow: true,
  });
  const activeTab = tabs.find((tab) => tab.active && typeof tab.id === 'number');

  if (!activeTab || typeof activeTab.id !== 'number') {
    throw new Error('Could not resolve an active tab in the current window');
  }

  return {
    id: activeTab.id,
    url: activeTab.url,
    title: activeTab.title,
  };
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
