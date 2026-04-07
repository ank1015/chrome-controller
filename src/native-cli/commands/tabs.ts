import { SessionStore } from '../session-store.js';

import type {
  BrowserService,
  CliCloseOtherTabsOptions,
  CliCommandResult,
  CliMoveTabOptions,
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

export async function runTabsCommand(options: TabsCommandOptions): Promise<CliCommandResult> {
  const [subcommand = 'list', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListTabsCommand(rest, options);
    case 'open':
      return await runOpenTabCommand(rest, options);
    case 'get':
      return await runGetTabCommand(rest, options);
    case 'activate':
      return await runActivateTabCommand(rest, options);
    case 'close':
      return await runCloseTabsCommand(rest, options);
    case 'close-others':
      return await runCloseOtherTabsCommand(rest, options);
    case 'reload':
      return await runReloadTabCommand(rest, options);
    case 'duplicate':
      return await runDuplicateTabCommand(rest, options);
    case 'move':
      return await runMoveTabCommand(rest, options);
    case 'pin':
      return await runPinTabsCommand(rest, options);
    case 'unpin':
      return await runPinTabsCommand(rest, options, false);
    case 'mute':
      return await runMuteTabsCommand(rest, options);
    case 'unmute':
      return await runMuteTabsCommand(rest, options, false);
    case 'group':
      return await runGroupTabsCommand(rest, options);
    case 'ungroup':
      return await runUngroupTabsCommand(rest, options);
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
  const listOptions = parseListTabsOptions(args);
  const session = await resolveSession(options);
  const tabs = await options.browserService.listTabs(session, listOptions);

  return {
    session,
    data: {
      tabs,
      count: tabs.length,
    },
    lines: createTabListLines(tabs),
  };
}

async function runOpenTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const openOptions = parseOpenTabOptions(args);
  const session = await resolveSession(options);
  const existingTabs = await options.browserService.listTabs(session, {
    currentWindow: false,
  });
  const existingTabIds = new Set(
    existingTabs
      .map((candidate) => candidate.id)
      .filter((value): value is number => typeof value === 'number')
  );
  const tab = await options.browserService.openTab(session, openOptions);
  const reusedExistingTab = typeof tab.id === 'number' && existingTabIds.has(tab.id);
  const createdNewTab = typeof tab.id === 'number' ? !reusedExistingTab : null;

  return {
    session,
    data: {
      tab,
      createdNewTab,
      reusedExistingTab,
    },
    lines: [formatTabActionLine(reusedExistingTab ? 'Reused' : 'Opened', tab)],
  };
}

async function runGetTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabId = readRequiredTabId(args[0], 'get');
  const session = await resolveSession(options);
  const tab = await options.browserService.getTab(session, tabId);

  return {
    session,
    data: {
      tab,
    },
    lines: createTabDetailLines(tab),
  };
}

async function runActivateTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabId = readRequiredTabId(args[0], 'activate');
  const session = await resolveSession(options);
  const tab = await options.browserService.activateTab(session, tabId);

  return {
    session,
    data: {
      tab,
    },
    lines: [formatTabActionLine('Activated', tab)],
  };
}

async function runCloseTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabIds = parseRequiredTabIds(args, 'close');
  const session = await resolveSession(options);
  await options.browserService.closeTabs(session, tabIds);

  return {
    session,
    data: {
      closed: true,
      tabIds,
    },
    lines: [formatClosedTabsLine(tabIds)],
  };
}

async function runCloseOtherTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const closeOtherOptions = parseCloseOtherTabsOptions(args);
  const session = await resolveSession(options);
  const outcome = await options.browserService.closeOtherTabs(session, closeOtherOptions);

  return {
    session,
    data: outcome,
    lines: [
      formatCloseOtherTabsLine(outcome),
    ],
  };
}

async function runReloadTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabId = readRequiredTabId(args[0], 'reload');
  const session = await resolveSession(options);
  const tab = await options.browserService.reloadTab(session, tabId);

  return {
    session,
    data: {
      tab,
    },
    lines: [formatTabActionLine('Reloaded', tab)],
  };
}

async function runDuplicateTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabId = readRequiredTabId(args[0], 'duplicate');
  const session = await resolveSession(options);
  const tab = await options.browserService.duplicateTab(session, tabId);

  return {
    session,
    data: {
      tab,
    },
    lines: [formatTabActionLine('Duplicated', tab)],
  };
}

async function runMoveTabCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const { tabId, moveOptions } = parseMoveTabOptions(args);
  const session = await resolveSession(options);
  const tab = await options.browserService.moveTab(session, tabId, moveOptions);

  return {
    session,
    data: {
      tab,
    },
    lines: [formatTabActionLine('Moved', tab)],
  };
}

async function runPinTabsCommand(
  args: string[],
  options: TabsCommandOptions,
  pinned = true
): Promise<CliCommandResult> {
  const tabIds = parseRequiredTabIds(args, pinned ? 'pin' : 'unpin');
  const session = await resolveSession(options);
  const tabs = await options.browserService.pinTabs(session, tabIds, pinned);

  return {
    session,
    data: {
      tabs,
    },
    lines: [formatBulkTabActionLine(pinned ? 'Pinned' : 'Unpinned', tabs)],
  };
}

async function runMuteTabsCommand(
  args: string[],
  options: TabsCommandOptions,
  muted = true
): Promise<CliCommandResult> {
  const tabIds = parseRequiredTabIds(args, muted ? 'mute' : 'unmute');
  const session = await resolveSession(options);
  const tabs = await options.browserService.muteTabs(session, tabIds, muted);

  return {
    session,
    data: {
      tabs,
    },
    lines: [formatBulkTabActionLine(muted ? 'Muted' : 'Unmuted', tabs)],
  };
}

async function runGroupTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabIds = parseRequiredTabIds(args, 'group');
  const session = await resolveSession(options);
  const outcome = await options.browserService.groupTabs(session, tabIds);

  return {
    session,
    data: outcome,
    lines: [formatGroupedTabsLine(outcome.groupId, outcome.tabs)],
  };
}

async function runUngroupTabsCommand(
  args: string[],
  options: TabsCommandOptions
): Promise<CliCommandResult> {
  const tabIds = parseRequiredTabIds(args, 'ungroup');
  const session = await resolveSession(options);
  const tabs = await options.browserService.ungroupTabs(session, tabIds);

  return {
    session,
    data: {
      tabs,
    },
    lines: [formatBulkTabActionLine('Ungrouped', tabs)],
  };
}

async function resolveSession(options: TabsCommandOptions): Promise<CliSessionRecord> {
  const result = await options.sessionStore.resolveSession(options.explicitSessionId);
  return result.session;
}

function parseListTabsOptions(args: string[]): { windowId?: number; currentWindow?: boolean } {
  const listOptions: { windowId?: number; currentWindow?: boolean } = {
    currentWindow: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--all') {
      delete listOptions.currentWindow;
      continue;
    }

    if (arg === '--window') {
      listOptions.windowId = readRequiredNumericOption(args, index, '--window');
      delete listOptions.currentWindow;
      index += 1;
      continue;
    }

    if (arg.startsWith('--window=')) {
      listOptions.windowId = parseInteger(arg.slice('--window='.length), '--window');
      delete listOptions.currentWindow;
      continue;
    }

    throw new Error(`Unknown option for tabs list: ${arg}`);
  }

  return listOptions;
}

function parseOpenTabOptions(args: string[]): CliOpenTabOptions {
  let url: string | null = null;
  const openOptions: Omit<CliOpenTabOptions, 'url'> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('-') && url === null) {
      url = arg;
      continue;
    }

    if (arg === '--url') {
      url = readRequiredOptionValue(args, index, '--url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
      continue;
    }

    if (arg === '--window') {
      openOptions.windowId = readRequiredNumericOption(args, index, '--window');
      index += 1;
      continue;
    }

    if (arg.startsWith('--window=')) {
      openOptions.windowId = parseInteger(arg.slice('--window='.length), '--window');
      continue;
    }

    if (arg === '--active' || arg.startsWith('--active=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--active');
      openOptions.active = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    if (arg === '--pinned' || arg.startsWith('--pinned=')) {
      const { value, consumedNextArgument } = readBooleanFlag(args, index, '--pinned');
      openOptions.pinned = value;
      index += consumedNextArgument ? 1 : 0;
      continue;
    }

    throw new Error(`Unknown option for tabs open: ${arg}`);
  }

  if (!url) {
    throw new Error('Missing URL. Usage: chrome-controller tabs open <url>');
  }

  return {
    ...openOptions,
    url,
  };
}

function parseMoveTabOptions(args: string[]): { tabId: number; moveOptions: CliMoveTabOptions } {
  const [firstArg, ...rest] = args;
  const tabId = readRequiredTabId(firstArg, 'move');
  const moveOptions: CliMoveTabOptions = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === '--window') {
      moveOptions.windowId = readRequiredNumericOption(rest, index, '--window');
      index += 1;
      continue;
    }

    if (arg.startsWith('--window=')) {
      moveOptions.windowId = parseInteger(arg.slice('--window='.length), '--window');
      continue;
    }

    if (arg === '--index') {
      moveOptions.index = readRequiredNumericOption(rest, index, '--index');
      index += 1;
      continue;
    }

    if (arg.startsWith('--index=')) {
      moveOptions.index = parseInteger(arg.slice('--index='.length), '--index');
      continue;
    }

    throw new Error(`Unknown option for tabs move: ${arg}`);
  }

  return {
    tabId,
    moveOptions,
  };
}

function parseCloseOtherTabsOptions(args: string[]): CliCloseOtherTabsOptions {
  const closeOtherOptions: CliCloseOtherTabsOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--window') {
      closeOtherOptions.windowId = readRequiredNumericOption(args, index, '--window');
      index += 1;
      continue;
    }

    if (arg.startsWith('--window=')) {
      closeOtherOptions.windowId = parseInteger(arg.slice('--window='.length), '--window');
      continue;
    }

    if (arg === '--keep') {
      closeOtherOptions.keepTabId = readRequiredNumericOption(args, index, '--keep');
      index += 1;
      continue;
    }

    if (arg.startsWith('--keep=')) {
      closeOtherOptions.keepTabId = parseInteger(arg.slice('--keep='.length), '--keep');
      continue;
    }

    throw new Error(`Unknown option for tabs close-others: ${arg}`);
  }

  return closeOtherOptions;
}

function parseRequiredTabIds(args: string[], commandName: string): number[] {
  const tabIds = args.map((arg) => readRequiredTabId(arg, commandName));
  if (tabIds.length === 0) {
    throw new Error(`Missing tab id. Usage: chrome-controller tabs ${commandName} <tabId...>`);
  }

  return tabIds;
}

function readRequiredTabId(rawValue: string | undefined, commandName: string): number {
  if (!rawValue) {
    throw new Error(`Missing tab id. Usage: chrome-controller tabs ${commandName} <tabId>`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid tab id: ${rawValue}`);
  }

  return value;
}

function readRequiredOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function readRequiredNumericOption(args: string[], index: number, flagName: string): number {
  return parseInteger(readRequiredOptionValue(args, index, flagName), flagName);
}

function readBooleanFlag(
  args: string[],
  index: number,
  flagName: string
): { value: boolean; consumedNextArgument: boolean } {
  const arg = args[index];
  if (arg.startsWith(`${flagName}=`)) {
    return {
      value: parseBoolean(arg.slice(flagName.length + 1), flagName),
      consumedNextArgument: false,
    };
  }

  const nextValue = args[index + 1];
  if (nextValue === 'true' || nextValue === 'false') {
    return {
      value: parseBoolean(nextValue, flagName),
      consumedNextArgument: true,
    };
  }

  return {
    value: true,
    consumedNextArgument: false,
  };
}

function parseBoolean(rawValue: string, flagName: string): boolean {
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean value for ${flagName}: ${rawValue}`);
}

function parseInteger(rawValue: string, flagName: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid integer value for ${flagName}: ${rawValue}`);
  }

  return value;
}

function createTabsHelpLines(): string[] {
  return [
    'Tabs commands',
    '',
    'Usage:',
    '  chrome-controller tabs list [--window <id>] [--all]',
    '  chrome-controller tabs open <url> [--window <id>] [--active] [--pinned]',
    '  chrome-controller tabs get <tabId>',
    '  chrome-controller tabs activate <tabId>',
    '  chrome-controller tabs close <tabId...>',
    '  chrome-controller tabs close-others [--window <id>] [--keep <tabId>]',
    '  chrome-controller tabs reload <tabId>',
    '  chrome-controller tabs duplicate <tabId>',
    '  chrome-controller tabs move <tabId> [--window <id>] [--index <n>]',
    '  chrome-controller tabs pin <tabId...>',
    '  chrome-controller tabs unpin <tabId...>',
    '  chrome-controller tabs mute <tabId...>',
    '  chrome-controller tabs unmute <tabId...>',
    '  chrome-controller tabs group <tabId...>',
    '  chrome-controller tabs ungroup <tabId...>',
  ];
}

function createTabListLines(tabs: CliTabInfo[]): string[] {
  if (tabs.length === 0) {
    return ['No tabs found'];
  }

  const lines = ['Tabs'];
  for (const tab of tabs) {
    lines.push(
      `${tab.active ? '*' : ' '} ${formatTabId(tab)}  window=${tab.windowId ?? 'unknown'}  ${tab.url ?? 'about:blank'}`
    );
  }

  return lines;
}

function createTabDetailLines(tab: CliTabInfo): string[] {
  return [
    `Tab ${formatTabId(tab)}`,
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

function formatBulkTabActionLine(action: string, tabs: CliTabInfo[]): string {
  if (tabs.length === 1) {
    return formatTabActionLine(action, tabs[0]);
  }

  return `${action} ${tabs.length} tabs: ${tabs.map((tab) => formatTabId(tab)).join(', ')}`;
}

function formatGroupedTabsLine(groupId: number, tabs: CliTabInfo[]): string {
  if (tabs.length === 1) {
    return `${formatTabActionLine('Grouped', tabs[0])} into group ${groupId}`;
  }

  return `Grouped ${tabs.length} tabs into group ${groupId}: ${tabs
    .map((tab) => formatTabId(tab))
    .join(', ')}`;
}

function formatClosedTabsLine(tabIds: number[]): string {
  if (tabIds.length === 1) {
    return `Closed tab ${tabIds[0]}`;
  }

  return `Closed ${tabIds.length} tabs: ${tabIds.join(', ')}`;
}

function formatCloseOtherTabsLine(outcome: {
  closedTabIds: number[];
  keptTabIds: number[];
}): string {
  const closedLabel =
    outcome.closedTabIds.length === 0
      ? 'Closed no other tabs'
      : outcome.closedTabIds.length === 1
        ? `Closed 1 other tab: ${outcome.closedTabIds[0]}`
        : `Closed ${outcome.closedTabIds.length} other tabs: ${outcome.closedTabIds.join(', ')}`;

  if (outcome.keptTabIds.length === 0) {
    return closedLabel;
  }

  return `${closedLabel}; kept ${outcome.keptTabIds.join(', ')}`;
}

function formatTabSummary(tab: CliTabInfo): string {
  const parts = [`tab ${formatTabId(tab)}`];

  if (tab.windowId !== null) {
    parts.push(`window=${tab.windowId}`);
  }

  if (tab.title) {
    parts.push(JSON.stringify(tab.title));
  }

  if (tab.url) {
    parts.push(tab.url);
  }

  return parts.join(' ');
}
