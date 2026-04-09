import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { PAGE_STABILITY_EVAL_MARKER } from '../../../src/native-cli/wait-support.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliDebuggerEvent,
  CliListTabsOptions,
  CliOpenTabOptions,
  CliSessionRecord,
  CliTabInfo,
} from '../../../src/native-cli/types.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

function createTab(overrides: Partial<CliTabInfo> = {}): CliTabInfo {
  return {
    id: overrides.id ?? 101,
    windowId: overrides.windowId ?? 11,
    active: overrides.active ?? false,
    pinned: overrides.pinned ?? false,
    audible: false,
    muted: false,
    title: overrides.title ?? 'Example title',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  private readonly tabs = new Map<number, CliTabInfo>([
    [101, createTab({ id: 101, active: true, title: 'Home', url: 'https://example.com/home' })],
    [102, createTab({ id: 102, active: false, title: 'Docs', url: 'https://example.com/docs', index: 1 })],
  ]);
  private readonly getTabResponses = new Map<number, CliTabInfo[]>();
  private readonly pageStabilityBehaviors = new Map<
    number,
    'default' | 'ready' | 'timeout' | 'context-error'
  >();
  private readonly pageStabilityResponses = new Map<
    number,
    Array<{ readyState: string; quietForMs: number; url: string }>
  >();
  private readonly debuggerEvents = new Map<number, CliDebuggerEvent[]>();

  private nextTabId = 300;

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    const tabs = [...this.tabs.values()];
    const matchingTabs =
      options.windowId !== undefined
        ? tabs.filter((tab) => tab.windowId === options.windowId)
        : options.currentWindow === false || options.currentWindow === undefined
          ? tabs
          : tabs.filter((tab) => tab.windowId === 11);

    return matchingTabs.map((tab) => ({ ...tab }));
  }

  async openTab(session: CliSessionRecord, options: CliOpenTabOptions): Promise<CliTabInfo> {
    this.calls.push({
      method: 'openTab',
      sessionId: session.id,
      payload: options,
    });

    const tabId = this.nextTabId++;
    const pageStabilityBehavior = options.url.includes('context-error')
      ? 'context-error'
      : options.url.includes('unstable')
        ? 'timeout'
        : options.url.includes('ready')
          ? 'ready'
          : 'default';
    const loadingTab = createTab({
      id: tabId,
      windowId: options.windowId ?? 11,
      active: options.active ?? false,
      pinned: options.pinned ?? false,
      title: 'Opening...',
      url: options.url,
      index: 99,
      status: 'loading',
    });
    const finalTab = createTab({
      ...loadingTab,
      title: pageStabilityBehavior === 'ready' ? 'Ready page' : 'Opened page',
      status: 'complete',
    });

    this.tabs.set(tabId, loadingTab);
    this.pageStabilityBehaviors.set(tabId, pageStabilityBehavior);
    this.getTabResponses.set(
      tabId,
      pageStabilityBehavior === 'ready'
        ? [{ ...loadingTab }, { ...finalTab }, { ...finalTab }]
        : [{ ...finalTab }]
    );
    if (pageStabilityBehavior === 'ready') {
      this.pageStabilityResponses.set(tabId, [
        {
          readyState: 'loading',
          quietForMs: 0,
          url: options.url,
        },
        {
          readyState: 'complete',
          quietForMs: 25,
          url: options.url,
        },
      ]);
    }

    return { ...loadingTab };
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    const queued = this.getTabResponses.get(tabId);
    if (queued && queued.length > 0) {
      const next = queued.shift() as CliTabInfo;
      this.tabs.set(tabId, { ...next });
      return { ...next };
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return { ...tab };
  }

  async evaluateTab(
    session: CliSessionRecord,
    tabId: number,
    code: string,
    options?: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    }
  ): Promise<unknown> {
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
        code,
        options: options ?? {},
      },
    });

    if (!code.includes(PAGE_STABILITY_EVAL_MARKER)) {
      throw new Error(`Unexpected evaluateTab code: ${code}`);
    }

    const pageStabilityBehavior = this.pageStabilityBehaviors.get(tabId) ?? 'default';
    if (pageStabilityBehavior === 'context-error') {
      throw new Error('Cannot find default execution context');
    }

    if (pageStabilityBehavior === 'timeout') {
      return {
        [PAGE_STABILITY_EVAL_MARKER]: true,
        readyState: 'loading',
        url: this.tabs.get(tabId)?.url ?? 'about:blank',
        nowMs: 1_000,
        lastMutationAtMs: 1_000,
        quietForMs: 0,
        mutationCount: 0,
      };
    }

    const queued = this.pageStabilityResponses.get(tabId) ?? [];
    const next = queued.length > 0
      ? (queued.shift() as { readyState: string; quietForMs: number; url: string })
      : {
          readyState: 'complete',
          quietForMs: 25,
          url: this.tabs.get(tabId)?.url ?? 'about:blank',
        };

    return {
      [PAGE_STABILITY_EVAL_MARKER]: true,
      readyState: next.readyState,
      url: next.url,
      nowMs: 1_000,
      lastMutationAtMs: 1_000 - next.quietForMs,
      quietForMs: next.quietForMs,
      mutationCount: 0,
    };
  }

  async attachDebugger(
    session: CliSessionRecord,
    tabId: number
  ): Promise<{ attached: boolean; alreadyAttached: boolean }> {
    this.calls.push({
      method: 'attachDebugger',
      sessionId: session.id,
      payload: tabId,
    });

    return {
      attached: true,
      alreadyAttached: false,
    };
  }

  async detachDebugger(
    session: CliSessionRecord,
    tabId: number
  ): Promise<{ detached: boolean }> {
    this.calls.push({
      method: 'detachDebugger',
      sessionId: session.id,
      payload: tabId,
    });

    return {
      detached: true,
    };
  }

  async sendDebuggerCommand(
    session: CliSessionRecord,
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    this.calls.push({
      method: 'sendDebuggerCommand',
      sessionId: session.id,
      payload: {
        tabId,
        method,
        params: params ?? null,
      },
    });

    return {};
  }

  async getDebuggerEvents(
    session: CliSessionRecord,
    tabId: number,
    options?: { filter?: string; clear?: boolean }
  ): Promise<CliDebuggerEvent[]> {
    this.calls.push({
      method: 'getDebuggerEvents',
      sessionId: session.id,
      payload: {
        tabId,
        options: options ?? {},
      },
    });

    if (options?.clear) {
      this.debuggerEvents.set(tabId, []);
      return [];
    }

    return [...(this.debuggerEvents.get(tabId) ?? [])];
  }
}

async function runCliCommand(
  args: string[],
  homeDir: string,
  browserService: BrowserService,
  now: () => Date = createNowGenerator()
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = createCapturedOutput();
  const stderr = createCapturedOutput();
  const exitCode = await runCli(args, {
    browserService,
    env: { ...process.env, CHROME_CONTROLLER_HOME: homeDir },
    stdout: stdout.stream,
    stderr: stderr.stream,
    now,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
  };
}

describe('native CLI open command', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-open-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('opens a tab, pins it to the session, and lets later page commands reuse it', async () => {
    const openOutcome = await runCliCommand(
      ['open', 'https://example.com/workspace', '--json'],
      tempHome,
      browserService,
      now
    );
    const titleOutcome = await runCliCommand(
      ['page', 'title', '--json'],
      tempHome,
      browserService,
      now
    );

    const openPayload = JSON.parse(openOutcome.stdout);
    const titlePayload = JSON.parse(titleOutcome.stdout);

    expect(openOutcome.exitCode).toBe(0);
    expect(openPayload.sessionId).toBe('s1');
    expect(openPayload.data).toEqual({
      sessionId: 's1',
      windowId: 11,
      tabId: 300,
      url: 'https://example.com/workspace',
      title: 'Opened page',
      ready: false,
      readyRequested: false,
      targetTabId: 300,
      createdNewTab: true,
      reusedExistingTab: false,
      tab: expect.objectContaining({
        id: 300,
        windowId: 11,
        url: 'https://example.com/workspace',
        title: 'Opened page',
        active: false,
      }),
    });
    expect(titleOutcome.exitCode).toBe(0);
    expect(titlePayload.data).toEqual({
      tabId: 300,
      title: 'Opened page',
    });
    expect(browserService.calls).toContainEqual({
      method: 'openTab',
      sessionId: 's1',
      payload: {
        url: 'https://example.com/workspace',
        active: false,
      },
    });
  });

  it('reuses an existing exact-url tab instead of opening a duplicate', async () => {
    const outcome = await runCliCommand(
      ['open', 'https://example.com/docs', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data).toEqual({
      sessionId: 's1',
      windowId: 11,
      tabId: 102,
      url: 'https://example.com/docs',
      title: 'Docs',
      ready: false,
      readyRequested: false,
      targetTabId: 102,
      createdNewTab: false,
      reusedExistingTab: true,
      tab: expect.objectContaining({
        id: 102,
        windowId: 11,
        url: 'https://example.com/docs',
        title: 'Docs',
        active: false,
      }),
    });
    expect(browserService.calls).not.toContainEqual(
      expect.objectContaining({
        method: 'openTab',
      })
    );
  });

  it('waits for stable readiness when requested and returns final tab details', async () => {
    await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const outcome = await runCliCommand(
      [
        'open',
        'https://ready.example.com/login',
        '--session',
        'alpha',
        '--ready',
        '--quiet-ms',
        '20',
        '--timeout-ms',
        '100',
        '--poll-ms',
        '1',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('alpha');
    expect(payload.data).toEqual({
      sessionId: 'alpha',
      windowId: 11,
      tabId: 300,
      url: 'https://ready.example.com/login',
      title: 'Ready page',
      ready: true,
      readyRequested: true,
      targetTabId: 300,
      createdNewTab: true,
      reusedExistingTab: false,
      tab: expect.objectContaining({
        id: 300,
        windowId: 11,
        url: 'https://ready.example.com/login',
        title: 'Ready page',
        status: 'complete',
      }),
      stability: expect.objectContaining({
        tabId: 300,
        quietMs: 20,
        readyState: 'complete',
        url: 'https://ready.example.com/login',
        domQuietForMs: 25,
        inflightRequests: 0,
      }),
    });
    expect(browserService.calls).toContainEqual({
      method: 'attachDebugger',
      sessionId: 'alpha',
      payload: 300,
    });
    expect(browserService.calls).toContainEqual({
      method: 'sendDebuggerCommand',
      sessionId: 'alpha',
      payload: {
        tabId: 300,
        method: 'Network.enable',
        params: null,
      },
    });
    expect(browserService.calls).toContainEqual({
      method: 'detachDebugger',
      sessionId: 'alpha',
      payload: 300,
    });
  });

  it('keeps the opened tab pinned when --ready times out', async () => {
    await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const openOutcome = await runCliCommand(
      [
        'open',
        'https://unstable.example.com/inbox',
        '--session',
        'alpha',
        '--ready',
        '--timeout-ms',
        '10',
        '--poll-ms',
        '1',
        '--quiet-ms',
        '5',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const titleOutcome = await runCliCommand(
      ['page', 'title', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const openPayload = JSON.parse(openOutcome.stdout);
    const titlePayload = JSON.parse(titleOutcome.stdout);

    expect(openOutcome.exitCode).toBe(0);
    expect(openOutcome.stderr).toBe('');
    expect(openPayload.sessionId).toBe('alpha');
    expect(openPayload.data).toEqual({
      sessionId: 'alpha',
      windowId: 11,
      tabId: 300,
      url: 'https://unstable.example.com/inbox',
      title: 'Opened page',
      ready: false,
      readyRequested: true,
      readyError: 'Timed out waiting for tab 300 to become stable',
      targetTabId: 300,
      createdNewTab: true,
      reusedExistingTab: false,
      tab: expect.objectContaining({
        id: 300,
        title: 'Opened page',
        status: 'complete',
        url: 'https://unstable.example.com/inbox',
      }),
    });
    expect(titleOutcome.exitCode).toBe(0);
    expect(titlePayload.data).toEqual({
      tabId: 300,
      title: 'Opened page',
    });
  });

  it('keeps the opened tab pinned when readiness hits a transient page-context error', async () => {
    await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const openOutcome = await runCliCommand(
      [
        'open',
        'https://context-error.example.com/inbox',
        '--session',
        'alpha',
        '--ready',
        '--timeout-ms',
        '10',
        '--poll-ms',
        '1',
        '--quiet-ms',
        '5',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const titleOutcome = await runCliCommand(
      ['page', 'title', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    const openPayload = JSON.parse(openOutcome.stdout);
    const titlePayload = JSON.parse(titleOutcome.stdout);

    expect(openOutcome.exitCode).toBe(0);
    expect(openOutcome.stderr).toBe('');
    expect(openPayload.sessionId).toBe('alpha');
    expect(openPayload.data).toEqual({
      sessionId: 'alpha',
      windowId: 11,
      tabId: 300,
      url: 'https://context-error.example.com/inbox',
      title: 'Opened page',
      ready: false,
      readyRequested: true,
      readyError:
        'wait stable tab 300 could not finish because the page was navigating or re-rendering. Wait for the page to settle, then try again.',
      targetTabId: 300,
      createdNewTab: true,
      reusedExistingTab: false,
      tab: expect.objectContaining({
        id: 300,
        title: 'Opened page',
        status: 'complete',
        url: 'https://context-error.example.com/inbox',
      }),
    });
    expect(titleOutcome.exitCode).toBe(0);
    expect(titlePayload.data).toEqual({
      tabId: 300,
      title: 'Opened page',
    });
  });
});
