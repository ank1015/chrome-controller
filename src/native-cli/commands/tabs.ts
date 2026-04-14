import { SessionStore } from '../session-store.js';
import { sleep } from '../interaction-support.js';
import { resolveSession as resolveManagedSession } from './support.js';

import type {
  BrowserService,
  CliCommandResult,
  CliOpenTabOptions,
  CliSessionRecord,
  CliTabInfo,
} from '../types.js';

interface TabsCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

interface ResolvedManagedTab {
  session: CliSessionRecord;
  tab: CliTabInfo;
}

const OPEN_TAB_LIST_SETTLE_TIMEOUT_MS = 2_000;
const OPEN_TAB_LIST_SETTLE_POLL_MS = 100;

export async function runTabsCommand(options: TabsCommandOptions): Promise<CliCommandResult> {
  const [subcommand = 'list', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListTabsCommand(rest, options);
    case 'current':
      return await runCurrentTabCommand(rest, options);
    case 'new':
      return await runNewTabCommand(rest, options);
    case 'use':
      return await runUseTabCommand(rest, options);
    case 'close':
      return await runCloseCurrentTabCommand(rest, options);
    case 'close-others':
      return await runCloseOtherTabsCommand(rest, options);
    case 'reload':
      return await runReloadTabCommand(rest, options);
    case 'duplicate':
      return await runDuplicateTabCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createTabsHelpLines(),
      };
    default:
      throw new Error(`Unknown tabs command: ${subcommand}`);
  }
}

async function runListTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'list');
  const session = await resolveSession(options);
  const tabs = await listManagedTabs(options.browserService, session);
  const currentTabId = selectCurrentSessionTab(session, tabs)?.id ?? null;

  return {
    session,
    data: {
      tabs,
      count: tabs.length,
      currentTabId,
    },
    lines: createTabListLines(tabs, currentTabId),
  };
}

async function runCurrentTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'current');
  const { session, tab } = await resolveManagedTab(options, {
    syncTargetTab: true,
  });

  return {
    session,
    data: {
      tab,
      currentTabId: tab.id ?? null,
    },
    lines: createTabDetailLines(tab, true),
  };
}

async function runNewTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const url = parseOptionalUrlArg(args, 'new [url]');
  const session = await resolveSession(options);
  const tab = await options.browserService.openTab(session, {
    url: url ?? 'about:blank',
    windowId: requireManagedWindowId(session),
    active: true,
  });

  if (typeof tab.id !== 'number') {
    throw new Error('Could not resolve the new tab id');
  }

  const updatedSession = await options.sessionStore.setTargetTab(session.id, tab.id);
  const resolvedTab = await getTabOrFallback(options.browserService, updatedSession, tab.id, tab);

  return {
    session: updatedSession,
    data: {
      tab: resolvedTab,
      currentTabId: resolvedTab.id ?? null,
    },
    lines: [formatTabActionLine('Opened', resolvedTab)],
  };
}

async function runUseTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabId = readRequiredTabId(args[0], 'use');
  ensureNoArgs(args.slice(1), 'use <tabId>');

  const session = await resolveSession(options);
  const managedWindowId = requireManagedWindowId(session);
  const tab = await options.browserService.getTab(session, tabId);
  if (tab.windowId !== managedWindowId) {
    throw new Error(`Tab ${tabId} is not in managed window ${managedWindowId}`);
  }

  const activeTab = tab.active ? tab : await options.browserService.activateTab(session, tabId);
  const updatedSession = await options.sessionStore.setTargetTab(session.id, tabId);

  return {
    session: updatedSession,
    data: {
      tab: activeTab,
      currentTabId: activeTab.id ?? null,
    },
    lines: [formatTabActionLine('Using', activeTab)],
  };
}

async function runCloseCurrentTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'close');
  const { session, tab } = await resolveManagedTab(options, {
    syncTargetTab: false,
  });
  const tabId = requireTabId(tab, 'close');

  await options.browserService.closeTabs(session, [tabId]);
  const followUp = await resolveSessionAfterTabChange(options, session);

  return {
    session: followUp.session,
    data: {
      closedTabId: tabId,
      currentTabId: followUp.tab?.id ?? null,
      currentTab: followUp.tab,
    },
    lines: [formatCloseTabLine(tabId, followUp.tab)],
  };
}

async function runCloseOtherTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'close-others');
  const { session, tab } = await resolveManagedTab(options, {
    syncTargetTab: true,
  });
  const tabId = requireTabId(tab, 'close-others');
  const outcome = await options.browserService.closeOtherTabs(session, {
    windowId: requireManagedWindowId(session),
    keepTabId: tabId,
  });
  const resolvedTab = await getTabOrFallback(options.browserService, session, tabId, tab);
  const updatedSession =
    session.targetTabId === tabId
      ? session
      : await options.sessionStore.setTargetTab(session.id, tabId);

  return {
    session: updatedSession,
    data: {
      closedTabIds: outcome.closedTabIds,
      keptTabId: tabId,
      currentTabId: resolvedTab.id ?? null,
      tab: resolvedTab,
    },
    lines: [formatCloseOtherTabsLine(outcome.closedTabIds, resolvedTab)],
  };
}

async function runReloadTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'reload');
  const { session, tab } = await resolveManagedTab(options, {
    syncTargetTab: true,
  });
  const tabId = requireTabId(tab, 'reload');
  const reloadedTab = await options.browserService.reloadTab(session, tabId);

  return {
    session,
    data: {
      tab: reloadedTab,
      currentTabId: reloadedTab.id ?? null,
    },
    lines: [formatTabActionLine('Reloaded', reloadedTab)],
  };
}

async function runDuplicateTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  ensureNoArgs(args, 'duplicate');
  const { session, tab } = await resolveManagedTab(options, {
    syncTargetTab: true,
  });
  const sourceTabId = requireTabId(tab, 'duplicate');
  const duplicatedTab = await options.browserService.duplicateTab(session, sourceTabId);

  if (typeof duplicatedTab.id !== 'number') {
    throw new Error(`Could not resolve duplicated tab for source tab ${sourceTabId}`);
  }

  const activeDuplicate = duplicatedTab.active
    ? duplicatedTab
    : await options.browserService.activateTab(session, duplicatedTab.id);
  const updatedSession = await options.sessionStore.setTargetTab(session.id, duplicatedTab.id);

  return {
    session: updatedSession,
    data: {
      sourceTabId,
      tab: activeDuplicate,
      currentTabId: activeDuplicate.id ?? null,
    },
    lines: [formatDuplicateTabLine(sourceTabId, activeDuplicate)],
  };
}

async function resolveSession(options: TabsCommandOptions): Promise<CliSessionRecord> {
  return await resolveManagedSession(
    options.sessionStore,
    options.browserService,
    options.explicitSessionId
  );
}

async function resolveManagedTab(
  options: TabsCommandOptions,
  config: {
    syncTargetTab: boolean;
  }
): Promise<ResolvedManagedTab> {
  let session = await resolveSession(options);
  const tabs = await listManagedTabs(options.browserService, session);
  const selectedTab = selectCurrentSessionTab(session, tabs);

  if (!selectedTab || typeof selectedTab.id !== 'number') {
    if (session.targetTabId !== null) {
      session = await options.sessionStore.clearTargetTab(session.id);
    }

    throw new Error(
      `Managed window ${session.windowId ?? 'unknown'} has no tabs. Run \`chrome-controller tabs new\`.`
    );
  }

  if (config.syncTargetTab && session.targetTabId !== selectedTab.id) {
    session = await options.sessionStore.setTargetTab(session.id, selectedTab.id);
  }

  return {
    session,
    tab: selectedTab,
  };
}

async function resolveSessionAfterTabChange(
  options: TabsCommandOptions,
  session: CliSessionRecord
): Promise<{ session: CliSessionRecord; tab: CliTabInfo | null }> {
  let updatedSession = session;
  const remainingTabs = await listManagedTabs(options.browserService, session);
  const nextTab = selectCurrentSessionTab(session, remainingTabs);

  if (nextTab && typeof nextTab.id === 'number') {
    updatedSession = await options.sessionStore.setTargetTab(session.id, nextTab.id);
    return {
      session: updatedSession,
      tab: nextTab,
    };
  }

  updatedSession = await options.sessionStore.clearTargetTab(session.id);
  return {
    session: updatedSession,
    tab: null,
  };
}

async function listManagedTabs(
  browserService: BrowserService,
  session: CliSessionRecord
): Promise<CliTabInfo[]> {
  return await browserService.listTabs(session, {
    windowId: requireManagedWindowId(session),
  });
}

function selectCurrentSessionTab(
  session: CliSessionRecord,
  tabs: CliTabInfo[]
): CliTabInfo | null {
  const targetedTab =
    typeof session.targetTabId === 'number'
      ? tabs.find((tab) => tab.id === session.targetTabId) ?? null
      : null;
  if (targetedTab) {
    return targetedTab;
  }

  return tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
}

function requireManagedWindowId(session: CliSessionRecord): number {
  if (typeof session.windowId !== 'number') {
    throw new Error(`Could not resolve a managed window for session ${session.id}`);
  }

  return session.windowId;
}

function requireTabId(tab: CliTabInfo, commandName: string): number {
  if (typeof tab.id !== 'number') {
    throw new Error(`Could not resolve a tab id for tabs ${commandName}`);
  }

  return tab.id;
}

function parseOptionalUrlArg(args: string[], usage: string): string | null {
  if (args.length === 0) {
    return null;
  }

  if (args.length > 1) {
    throw new Error(`Usage: chrome-controller tabs ${usage}`);
  }

  const value = args[0] ?? '';
  if (value.startsWith('-')) {
    throw new Error(`Usage: chrome-controller tabs ${usage}`);
  }

  return value;
}

function ensureNoArgs(args: string[], usage: string): void {
  if (args.length > 0) {
    throw new Error(`Usage: chrome-controller tabs ${usage}`);
  }
}

function readRequiredTabId(rawValue: string | undefined, commandName: string): number {
  if (!rawValue) {
    throw new Error(`Usage: chrome-controller tabs ${commandName} <tabId>`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid tab id: ${rawValue}`);
  }

  return value;
}

function createTabsHelpLines(): string[] {
  return [
    'Tabs commands',
    '',
    "All tabs commands act inside the active session's managed window.",
    'The session also remembers one current tab for later page-level commands.',
    '',
    'Usage:',
    '  chrome-controller tabs list',
    '  chrome-controller tabs current',
    '  chrome-controller tabs new [url]',
    '  chrome-controller tabs use <tabId>',
    '  chrome-controller tabs close',
    '  chrome-controller tabs close-others',
    '  chrome-controller tabs reload',
    '  chrome-controller tabs duplicate',
    '',
    'Notes:',
    '  `tabs new` always opens a fresh tab in the managed window and makes it the current tab.',
    '  `tabs use` switches to an existing tab in the managed window and makes it the current tab.',
    '  Use top-level `open <url>` when you want to reuse an already-open exact URL match instead of always creating a fresh tab.',
  ];
}

function createTabListLines(tabs: CliTabInfo[], currentTabId: number | null): string[] {
  if (tabs.length === 0) {
    return ['No tabs found in the managed session window'];
  }

  const lines = ['Tabs'];
  for (const tab of tabs) {
    const isCurrent = typeof currentTabId === 'number' && tab.id === currentTabId;
    lines.push(
      `${isCurrent ? '*' : ' '} ${formatTabId(tab)}  active=${tab.active ? 'true' : 'false'}  ${tab.url ?? 'about:blank'}`
    );
  }

  return lines;
}

function createTabDetailLines(tab: CliTabInfo, current: boolean): string[] {
  return [
    `Tab ${formatTabId(tab)}`,
    `Current: ${current ? 'true' : 'false'}`,
    `Window: ${tab.windowId ?? 'unknown'}`,
    `Active: ${tab.active ? 'true' : 'false'}`,
    `Pinned: ${tab.pinned ? 'true' : 'false'}`,
    `Audible: ${tab.audible ? 'true' : 'false'}`,
    `Muted: ${tab.muted ? 'true' : 'false'}`,
    `Index: ${tab.index ?? 'unknown'}`,
    `Status: ${tab.status ?? 'unknown'}`,
    `Group: ${tab.groupId ?? 'none'}`,
    `URL: ${tab.url ?? 'none'}`,
    `Title: ${tab.title ?? 'none'}`,
  ];
}

function formatTabId(tab: CliTabInfo): string {
  return tab.id === null ? 'unknown' : String(tab.id);
}

function formatTabActionLine(action: string, tab: CliTabInfo): string {
  return `${action} ${formatTabSummary(tab)}`;
}

function formatDuplicateTabLine(sourceTabId: number, tab: CliTabInfo): string {
  return `Duplicated tab ${sourceTabId} as ${formatTabSummary(tab)}`;
}

function formatCloseTabLine(closedTabId: number, currentTab: CliTabInfo | null): string {
  if (!currentTab || typeof currentTab.id !== 'number') {
    return `Closed tab ${closedTabId}`;
  }

  return `Closed tab ${closedTabId}; current tab is now ${formatTabSummary(currentTab)}`;
}

function formatCloseOtherTabsLine(closedTabIds: number[], keptTab: CliTabInfo): string {
  if (closedTabIds.length === 0) {
    return `Closed no other tabs; current tab remains ${formatTabSummary(keptTab)}`;
  }

  if (closedTabIds.length === 1) {
    return `Closed 1 other tab (${closedTabIds[0]}); current tab remains ${formatTabSummary(keptTab)}`;
  }

  return `Closed ${closedTabIds.length} other tabs (${closedTabIds.join(', ')}); current tab remains ${formatTabSummary(keptTab)}`;
}

function formatTabSummary(tab: CliTabInfo): string {
  const parts = [`tab ${tab.id ?? 'unknown'}`];

  if (tab.title) {
    parts.push(JSON.stringify(tab.title));
  }

  if (tab.url) {
    parts.push(tab.url);
  }

  return parts.join(' ');
}

async function getTabOrFallback(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  fallback: CliTabInfo
): Promise<CliTabInfo> {
  try {
    return await browserService.getTab(session, tabId);
  } catch {
    return fallback;
  }
}

export async function openTabWithSettle(
  browserService: BrowserService,
  session: CliSessionRecord,
  openOptions: CliOpenTabOptions
): Promise<{
  tab: CliTabInfo;
  createdNewTab: boolean | null;
  reusedExistingTab: boolean;
}> {
  const existingTabs = await browserService.listTabs(
    session,
    openOptions.windowId !== undefined
      ? { windowId: openOptions.windowId }
      : { currentWindow: false }
  );
  const reusableTab = findReusableTab(session, existingTabs, openOptions.url);

  if (reusableTab) {
    return {
      tab: await applyReusableTabOptions(browserService, session, reusableTab, openOptions),
      createdNewTab: false,
      reusedExistingTab: true,
    };
  }

  const existingTabIds = new Set(
    existingTabs
      .map((candidate) => candidate.id)
      .filter((value): value is number => typeof value === 'number')
  );
  const openedTab = await browserService.openTab(session, openOptions);
  const reusedExistingTab =
    typeof openedTab.id === 'number' && existingTabIds.has(openedTab.id);
  const createdNewTab = typeof openedTab.id === 'number' ? !reusedExistingTab : null;
  const tab =
    createdNewTab && typeof openedTab.id === 'number'
      ? await waitForOpenedTabToAppearInLists(
          browserService,
          session,
          openedTab
        )
      : openedTab;

  return {
    tab,
    createdNewTab,
    reusedExistingTab,
  };
}

function findReusableTab(
  session: CliSessionRecord,
  tabs: CliTabInfo[],
  requestedUrl: string
): CliTabInfo | null {
  const requestedUrlKey = normalizeTabUrlForReuse(requestedUrl);
  const matchingTabs = tabs.filter((tab) => {
    if (typeof tab.id !== 'number') {
      return false;
    }

    return normalizeTabUrlForReuse(tab.url) === requestedUrlKey;
  });

  if (matchingTabs.length === 0) {
    return null;
  }

  return matchingTabs.reduce((bestTab, candidate) => {
    if (!bestTab) {
      return candidate;
    }

    const candidateScore = scoreReusableTab(session, candidate);
    const bestScore = scoreReusableTab(session, bestTab);
    if (candidateScore !== bestScore) {
      return candidateScore > bestScore ? candidate : bestTab;
    }

    const candidateIndex = candidate.index ?? Number.MAX_SAFE_INTEGER;
    const bestIndex = bestTab.index ?? Number.MAX_SAFE_INTEGER;
    return candidateIndex < bestIndex ? candidate : bestTab;
  }, null as CliTabInfo | null);
}

function scoreReusableTab(session: CliSessionRecord, tab: CliTabInfo): number {
  let score = 0;

  if (tab.id === session.targetTabId) {
    score += 100;
  }

  if (tab.status === 'complete') {
    score += 10;
  }

  if (tab.active) {
    score += 5;
  }

  if (tab.pinned) {
    score += 1;
  }

  return score;
}

async function applyReusableTabOptions(
  browserService: BrowserService,
  session: CliSessionRecord,
  tab: CliTabInfo,
  openOptions: CliOpenTabOptions
): Promise<CliTabInfo> {
  if (typeof tab.id !== 'number') {
    return tab;
  }

  let updatedTab = tab;

  if (openOptions.pinned !== undefined && updatedTab.pinned !== openOptions.pinned) {
    const [pinnedTab] = await browserService.pinTabs(session, [updatedTab.id], openOptions.pinned);
    updatedTab = pinnedTab ?? await browserService.getTab(session, updatedTab.id);
  }

  if (openOptions.active === true && !updatedTab.active) {
    updatedTab = await browserService.activateTab(session, updatedTab.id);
  }

  return updatedTab;
}

function normalizeTabUrlForReuse(url: string | null): string | null {
  if (typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

async function waitForOpenedTabToAppearInLists(
  browserService: BrowserService,
  session: CliSessionRecord,
  openedTab: CliTabInfo
): Promise<CliTabInfo> {
  const tabId = openedTab.id;
  if (typeof tabId !== 'number') {
    return openedTab;
  }

  const deadline = Date.now() + OPEN_TAB_LIST_SETTLE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const tabs = await browserService.listTabs(session, {
      currentWindow: false,
    });
    const listedTab = tabs.find((candidate) => candidate.id === tabId);
    if (listedTab) {
      return listedTab;
    }

    await sleep(OPEN_TAB_LIST_SETTLE_POLL_MS);
  }

  return openedTab;
}
