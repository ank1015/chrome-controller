import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { writePageSnapshotCache } from '../../../src/native-cli/page-snapshot.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliPageSnapshotCacheRecord,
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
    active: overrides.active ?? true,
    pinned: false,
    audible: false,
    muted: false,
    title: overrides.title ?? 'Element test',
    url: overrides.url ?? 'https://example.com/login',
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
  };
}

function extractDomRequest(code: string): Record<string, unknown> {
  const boundary = code.lastIndexOf(')(');
  if (boundary === -1 || !code.endsWith(')')) {
    throw new Error(`Unexpected DOM operation code: ${code}`);
  }

  return JSON.parse(code.slice(boundary + 2, -1)) as Record<string, unknown>;
}

function createSnapshotRecord(sessionId: string, tabId: number): CliPageSnapshotCacheRecord {
  return {
    version: 1,
    sessionId,
    source: 'dom-interactive-v1',
    snapshotId: 'snap-101',
    capturedAt: '2026-04-06T00:00:00.000Z',
    tabId,
    title: 'Example Login',
    url: 'https://example.com/login',
    count: 4,
    visibleCount: 4,
    truncated: false,
    elements: [
      {
        ref: '@e1',
        role: 'textbox',
        name: 'Email',
        tagName: 'input',
        inputType: 'email',
        selector: '#email',
        alternativeSelectors: ['input[name="email"]'],
        placeholder: 'Email',
        disabled: false,
        checked: null,
      },
      {
        ref: '@e2',
        role: 'button',
        name: 'Sign in',
        tagName: 'button',
        inputType: null,
        selector: 'button[type="submit"]',
        alternativeSelectors: [],
        placeholder: null,
        disabled: false,
        checked: null,
      },
      {
        ref: '@e3',
        role: 'checkbox',
        name: 'Remember me',
        tagName: 'input',
        inputType: 'checkbox',
        selector: '#remember',
        alternativeSelectors: ['input[name="remember"]'],
        placeholder: null,
        disabled: false,
        checked: false,
      },
      {
        ref: '@e4',
        role: 'combobox',
        name: 'Role',
        tagName: 'select',
        inputType: null,
        selector: '#role',
        alternativeSelectors: ['select[name="role"]'],
        placeholder: null,
        disabled: false,
        checked: null,
      },
    ],
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  clickDetachedFailuresRemaining = 0;

  async listTabs(session: CliSessionRecord): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: {
        windowId: 11,
      },
    });

    return [createTab()];
  }

  async activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'activateTab',
      sessionId: session.id,
      payload: tabId,
    });

    return createTab({ id: tabId, active: true });
  }

  async evaluateTab(
    session: CliSessionRecord,
    tabId: number,
    code: string,
    options: {
      awaitPromise?: boolean;
      userGesture?: boolean;
    } = {}
  ): Promise<unknown> {
    const request = extractDomRequest(code);
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
        request,
        options,
      },
    });

    if (request.operation === 'click') {
      if (this.clickDetachedFailuresRemaining > 0) {
        this.clickDetachedFailuresRemaining -= 1;
        throw new Error('Detached while handling command.');
      }

      return {
        ok: true,
        matchedSelector: 'button[type="submit"]',
      };
    }

    if (request.operation === 'fill') {
      return {
        ok: true,
        matchedSelector: '#email',
        value: request.value,
      };
    }

    if (request.operation === 'type') {
      return {
        ok: true,
        matchedSelector: '#email',
        value: request.value,
      };
    }

    if (request.operation === 'select') {
      return {
        ok: true,
        matchedSelector: '#role',
        value: request.value,
      };
    }

    if (request.operation === 'check' || request.operation === 'uncheck') {
      return {
        ok: true,
        matchedSelector: '#remember',
        checked: request.operation === 'check',
      };
    }

    if (request.operation === 'focus') {
      return {
        ok: true,
        matchedSelector: 'button[type="submit"]',
      };
    }

    throw new Error(`Unexpected DOM operation: ${String(request.operation)}`);
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

describe('native CLI element commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-element-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
    await writePageSnapshotCache(
      { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      createSnapshotRecord('s1', 101)
    );
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('clicks a snapshot ref using the cached selector hints', async () => {
    const outcome = await runCliCommand(
      ['element', 'click', '@e2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e2',
      matchedSelector: 'button[type="submit"]',
      result: {
        ok: true,
        matchedSelector: 'button[type="submit"]',
      },
    });
    expect(browserService.calls).toEqual([
      {
        method: 'createWindow',
        sessionId: 's1',
        payload: {
          focused: false,
        },
      },
      {
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          windowId: 11,
        },
      },
      {
        method: 'evaluateTab',
        sessionId: 's1',
        payload: expect.objectContaining({
          tabId: 101,
          options: {
            userGesture: true,
          },
          request: expect.objectContaining({
            selectors: ['button[type="submit"]'],
            operation: 'click',
            failureMessage:
              'Could not uniquely resolve @e2. The page may have changed or the cached selectors are ambiguous. Run `chrome-controller page snapshot` again.',
          }),
        }),
      },
    ]);
  });

  it('fills a cached textbox ref and returns the resolved value', async () => {
    const outcome = await runCliCommand(
      ['element', 'fill', '@e1', 'alice@example.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e1',
      matchedSelector: '#email',
      value: 'alice@example.com',
      result: {
        ok: true,
        matchedSelector: '#email',
        value: 'alice@example.com',
      },
    });
  });

  it('types into a cached textbox ref and returns the resolved value', async () => {
    const outcome = await runCliCommand(
      ['element', 'type', '@e1', 'hello world', '--delay-ms', '12', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.value).toBe('hello world');
    expect(payload.data.delayMs).toBe(12);
    expect(payload.data.matchedSelector).toBe('#email');
  });

  it('selects an option in a select control', async () => {
    const outcome = await runCliCommand(
      ['element', 'select', '@e4', 'admin', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e4',
      matchedSelector: '#role',
      value: 'admin',
      result: {
        ok: true,
        matchedSelector: '#role',
        value: 'admin',
      },
    });
  });

  it('checks and unchecks a checkbox ref', async () => {
    const checkOutcome = await runCliCommand(
      ['element', 'check', '@e3', '--json'],
      tempHome,
      browserService,
      now
    );
    const uncheckOutcome = await runCliCommand(
      ['element', 'uncheck', '@e3', '--json'],
      tempHome,
      browserService,
      now
    );

    expect(JSON.parse(checkOutcome.stdout).data.checked).toBe(true);
    expect(JSON.parse(uncheckOutcome.stdout).data.checked).toBe(false);
  });

  it('focuses an element and presses a key on it', async () => {
    const outcome = await runCliCommand(
      ['element', 'press', '@e2', 'Enter', '--count', '2', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e2',
      matchedSelector: 'button[type="submit"]',
      key: 'Enter',
      count: 2,
      result: {
        ok: true,
        matchedSelector: 'button[type="submit"]',
      },
    });
    expect(browserService.calls.filter((call) => call.method === 'sendDebuggerCommand')).toHaveLength(6);
  });

  it('surfaces actionable detached errors for non-retried element actions', async () => {
    browserService.clickDetachedFailuresRemaining = 1;

    const outcome = await runCliCommand(['element', 'click', '@e2'], tempHome, browserService, now);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      'The page changed while the command was running. Wait for the page to settle'
    );
    expect(outcome.stderr).toContain('page snapshot');
  });

  it('retries a transient detached click when --retry-stale is enabled', async () => {
    browserService.clickDetachedFailuresRemaining = 1;

    const outcome = await runCliCommand(
      ['element', 'click', '@e2', '--retry-stale', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      target: '@e2',
      matchedSelector: 'button[type="submit"]',
      result: {
        ok: true,
        matchedSelector: 'button[type="submit"]',
      },
    });
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(2);
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab').every((call) =>
        Boolean(
          typeof call.payload === 'object' &&
            call.payload !== null &&
            'options' in call.payload &&
            (call.payload as { options?: { userGesture?: boolean } }).options?.userGesture === true
        )
      )
    ).toBe(true);
  });
});
