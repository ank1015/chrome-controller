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
    count: 2,
    visibleCount: 2,
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
    ],
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  attrDetachedFailuresRemaining = 0;
  clickDetachedFailuresRemaining = 0;

  async listTabs(session: CliSessionRecord): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: {
        currentWindow: true,
      },
    });

    return [createTab()];
  }

  async evaluateTab(
    session: CliSessionRecord,
    tabId: number,
    code: string
  ): Promise<unknown> {
    const request = extractDomRequest(code);
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
        request,
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

    if (request.operation === 'box') {
      return {
        matchedSelector: '#email',
        box: {
          left: 24,
          top: 120,
          width: 280,
          height: 40,
          centerX: 164,
          centerY: 140,
        },
      };
    }

    if (request.operation === 'attr') {
      if (this.attrDetachedFailuresRemaining > 0) {
        this.attrDetachedFailuresRemaining -= 1;
        throw new Error('Detached while handling command.');
      }

      return {
        matchedSelector: '#email',
        value: request.attribute === 'placeholder' ? 'Email' : null,
      };
    }

    throw new Error(`Unexpected DOM operation: ${String(request.operation)}`);
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
        method: 'listTabs',
        sessionId: 's1',
        payload: {
          currentWindow: true,
        },
      },
      {
        method: 'evaluateTab',
        sessionId: 's1',
        payload: {
          tabId: 101,
          request: expect.objectContaining({
            selectors: ['button[type="submit"]'],
            operation: 'click',
            failureMessage:
              'Could not uniquely resolve @e2. The page may have changed or the cached selectors are ambiguous. Run `chrome-controller page snapshot` again.',
          }),
        },
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

  it('reads a live element box for later mouse commands', async () => {
    const outcome = await runCliCommand(
      ['element', 'box', '@e1', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.value).toEqual({
      left: 24,
      top: 120,
      width: 280,
      height: 40,
      centerX: 164,
      centerY: 140,
    });
    expect(payload.data.matchedSelector).toBe('#email');
  });

  it('retries element attr once when the page detaches during evaluation', async () => {
    browserService.attrDetachedFailuresRemaining = 1;

    const outcome = await runCliCommand(
      ['element', 'attr', '@e1', 'placeholder', '--json'],
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
      attribute: 'placeholder',
      value: 'Email',
      result: {
        matchedSelector: '#email',
        value: 'Email',
      },
    });
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(2);
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
});
