import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { PAGE_TEXT_EVAL_MARKER } from '../../../src/native-cli/page-markdown.js';
import {
  getPageSnapshotCachePath,
  PAGE_SNAPSHOT_EVAL_MARKER,
} from '../../../src/native-cli/page-snapshot.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliListTabsOptions,
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
    pinned: false,
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
  pageTextDetachedFailuresRemaining = 0;
  pageSnapshotDetachedFailuresRemaining = 0;
  pageTextResponses: Array<{ title: string; url: string; html: string }> | null = null;

  private readonly tabs = new Map<number, CliTabInfo>([
    [101, createTab({ id: 101, active: true, title: 'Home', url: 'https://example.com/home' })],
    [102, createTab({ id: 102, active: false, title: 'Docs', url: 'https://example.com/docs', index: 1 })],
  ]);

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return [...this.tabs.values()].map((tab) => ({ ...tab }));
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return { ...tab };
  }

  async activateTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'activateTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    for (const candidate of this.tabs.values()) {
      if (candidate.windowId === tab.windowId) {
        candidate.active = candidate.id === tabId;
      }
    }

    return { ...tab, active: true };
  }

  async navigateTab(
    session: CliSessionRecord,
    tabId: number,
    url: string
  ): Promise<CliTabInfo> {
    this.calls.push({
      method: 'navigateTab',
      sessionId: session.id,
      payload: {
        tabId,
        url,
      },
    });

    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    const staleTab = { ...tab };
    tab.url = url;
    tab.status = 'loading';
    tab.title = 'Loading...';
    return staleTab;
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
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
        code,
        options,
      },
    });

    if (code.includes(PAGE_SNAPSHOT_EVAL_MARKER)) {
      if (this.pageSnapshotDetachedFailuresRemaining > 0) {
        this.pageSnapshotDetachedFailuresRemaining -= 1;
        throw new Error('Detached while handling command.');
      }

      return {
        [PAGE_SNAPSHOT_EVAL_MARKER]: true,
        title: 'Example Login',
        url: 'https://example.com/login',
        elements: [
          {
            role: 'textbox',
            name: 'Email',
            tagName: 'input',
            inputType: 'email',
            selector: '#email',
            alternativeSelectors: ['input[name="email"]'],
            placeholder: 'Email',
            disabled: false,
            checked: null,
            inViewport: true,
            top: 120,
            left: 24,
            distanceFromViewport: 0,
          },
          {
            role: 'button',
            name: 'Sign in',
            tagName: 'button',
            inputType: null,
            selector: 'button[type="submit"]',
            alternativeSelectors: [],
            placeholder: null,
            disabled: false,
            checked: null,
            inViewport: true,
            top: 180,
            left: 24,
            distanceFromViewport: 0,
          },
        ],
        count: 2,
        truncated: false,
      };
    }

    if (code.includes(PAGE_TEXT_EVAL_MARKER)) {
      if (this.pageTextDetachedFailuresRemaining > 0) {
        this.pageTextDetachedFailuresRemaining -= 1;
        throw new Error('Detached while handling command.');
      }

      if (this.pageTextResponses && this.pageTextResponses.length > 0) {
        const next = this.pageTextResponses.shift() as {
          title: string;
          url: string;
          html: string;
        };
        return {
          [PAGE_TEXT_EVAL_MARKER]: true,
          ...next,
        };
      }

      return {
        [PAGE_TEXT_EVAL_MARKER]: true,
        title: 'Example Article',
        url: 'https://example.com/article',
        html: '<main><h1>Hello world</h1><p>Visit <a href="https://example.com/docs">the docs</a>.</p><script>ignore()</script></main>',
      };
    }

    return {
      tabId,
      echoedCode: code,
      awaitPromise: options.awaitPromise === true,
      userGesture: options.userGesture === true,
    };
  }

  async printToPdf(
    session: CliSessionRecord,
    tabId: number,
    options: {
      landscape?: boolean;
      printBackground?: boolean;
      scale?: number;
      paperWidth?: number;
      paperHeight?: number;
      preferCSSPageSize?: boolean;
    } = {}
  ): Promise<{ dataBase64: string }> {
    this.calls.push({
      method: 'printToPdf',
      sessionId: session.id,
      payload: {
        tabId,
        options,
      },
    });

    return {
      dataBase64: Buffer.from(
        JSON.stringify({
          tabId,
          options,
        }),
        'utf8'
      ).toString('base64'),
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

    if (method === 'Page.captureScreenshot') {
      return {
        data: Buffer.from('fake image').toString('base64'),
      };
    }

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

describe('native CLI page commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-page-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('returns the current page url and title from the active tab by default', async () => {
    const urlOutcome = await runCliCommand(['page', 'url', '--json'], tempHome, browserService, now);
    const titleOutcome = await runCliCommand(['page', 'title', '--json'], tempHome, browserService, now);

    const urlPayload = JSON.parse(urlOutcome.stdout);
    const titlePayload = JSON.parse(titleOutcome.stdout);

    expect(urlOutcome.exitCode).toBe(0);
    expect(titleOutcome.exitCode).toBe(0);
    expect(urlPayload.data).toEqual({
      tabId: 101,
      url: 'https://example.com/home',
    });
    expect(titlePayload.data).toEqual({
      tabId: 101,
      title: 'Home',
    });
  });

  it('uses the session current tab by default', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    await runCliCommand(
      ['tabs', 'use', '102', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    browserService.calls.length = 0;

    const titleOutcome = await runCliCommand(
      ['page', 'title', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(titleOutcome.stdout);

    expect(titleOutcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 102,
      title: 'Docs',
    });
    expect(browserService.calls.filter((call) => call.method !== 'getWindow')).toEqual([
      {
        method: 'listTabs',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
        },
      },
    ]);
  });

  it('navigates the current tab by default', async () => {
    const outcome = await runCliCommand(
      ['page', 'goto', 'https://openai.com', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.tab).toEqual({
      id: 101,
      windowId: 11,
      active: true,
      pinned: false,
      audible: false,
      muted: false,
      title: 'Loading...',
      url: 'https://openai.com',
      index: 0,
      status: 'loading',
      groupId: -1,
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
        method: 'navigateTab',
        sessionId: 's1',
        payload: {
          tabId: 101,
          url: 'https://openai.com',
        },
      },
      {
        method: 'getTab',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('navigates whichever tab the session is currently using', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    await runCliCommand(
      ['tabs', 'use', '102', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );

    browserService.calls.length = 0;

    const outcome = await runCliCommand(
      ['page', 'goto', 'https://platform.openai.com', '--session', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.tab).toEqual(
      expect.objectContaining({
        id: 102,
        url: 'https://platform.openai.com',
      })
    );
    expect(browserService.calls.filter((call) => call.method !== 'getWindow')).toEqual([
      {
        method: 'listTabs',
        sessionId: 'alpha',
        payload: {
          windowId: 11,
        },
      },
      {
        method: 'navigateTab',
        sessionId: 'alpha',
        payload: {
          tabId: 102,
          url: 'https://platform.openai.com',
        },
      },
      {
        method: 'getTab',
        sessionId: 'alpha',
        payload: 102,
      },
    ]);
  });

  it('evaluates code on the resolved tab', async () => {
    const outcome = await runCliCommand(
      ['page', 'eval', 'document.title', '--await-promise', '--user-gesture', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      result: {
        tabId: 101,
        echoedCode: 'document.title',
        awaitPromise: true,
        userGesture: true,
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
        payload: {
          tabId: 101,
          code: 'document.title',
          options: {
            awaitPromise: true,
            userGesture: true,
          },
        },
      },
    ]);
  });

  it('converts the page html into markdown text', async () => {
    const outcome = await runCliCommand(['page', 'text', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      title: 'Example Article',
      url: 'https://example.com/article',
      markdown: '# Hello world\n\nVisit [the docs](https://example.com/docs).',
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
        payload: {
          tabId: 101,
          code: expect.stringContaining(PAGE_TEXT_EVAL_MARKER),
          options: {},
        },
      },
      {
        method: 'evaluateTab',
        sessionId: 's1',
        payload: {
          tabId: 101,
          code: expect.stringContaining(PAGE_TEXT_EVAL_MARKER),
          options: {},
        },
      },
    ]);
  });

  it('retries page text once when the page detaches during evaluation', async () => {
    browserService.pageTextDetachedFailuresRemaining = 1;

    const outcome = await runCliCommand(['page', 'text', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.markdown).toBe('# Hello world\n\nVisit [the docs](https://example.com/docs).');
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(3);
  });

  it('waits for page text output to stabilize on streaming pages', async () => {
    browserService.pageTextResponses = [
      {
        title: 'Chat',
        url: 'https://example.com/chat',
        html: '<main><div data-message-author-role="user"><p>Explain gravity</p></div></main>',
      },
      {
        title: 'Chat',
        url: 'https://example.com/chat',
        html: '<main><div data-message-author-role="user"><p>Explain gravity</p></div><div data-message-author-role="assistant"><p>Gravity is the curvature of spacetime.</p></div></main>',
      },
      {
        title: 'Chat',
        url: 'https://example.com/chat',
        html: '<main><div data-message-author-role="user"><p>Explain gravity</p></div><div data-message-author-role="assistant"><p>Gravity is the curvature of spacetime.</p></div></main>',
      },
    ];

    const outcome = await runCliCommand(['page', 'text', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.markdown).toContain('Gravity is the curvature of spacetime.');
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(3);
  });

  it('uses the resolved tab url in plain-text goto output', async () => {
    const outcome = await runCliCommand(
      ['page', 'goto', 'https://github.com/openai?tab=readme'],
      tempHome,
      browserService,
      now
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(
      'Navigated tab 101 to https://github.com/openai?tab=readme'
    );
  });

  it('writes a PDF file for the resolved tab', async () => {
    const outputPath = join(tempHome, 'artifacts', 'custom-page.pdf');
    const outcome = await runCliCommand(
      ['page', 'pdf', outputPath, '--format', 'a4', '--background', '--scale', '1.25', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);
    const fileContent = await readFile(outputPath, 'utf8');

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: outputPath,
      sizeBytes: Buffer.byteLength(fileContent, 'utf8'),
      landscape: false,
      printBackground: true,
      format: 'a4',
      preferCSSPageSize: false,
      scale: 1.25,
    });
    expect(JSON.parse(fileContent)).toEqual({
      tabId: 101,
      options: {
        printBackground: true,
        scale: 1.25,
        paperWidth: 8.27,
        paperHeight: 11.69,
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
        method: 'printToPdf',
        sessionId: 's1',
        payload: {
          tabId: 101,
          options: {
            printBackground: true,
            scale: 1.25,
            paperWidth: 8.27,
            paperHeight: 11.69,
          },
        },
      },
    ]);
  });

  it('captures a screenshot file for the current tab', async () => {
    const outputPath = join(tempHome, 'artifacts', 'custom-page.webp');
    const outcome = await runCliCommand(
      ['page', 'screenshot', outputPath, '--format', 'webp', '--full-page', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);
    const fileContent = await readFile(outputPath, 'utf8');

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: outputPath,
      format: 'webp',
      mimeType: 'image/webp',
      sizeBytes: Buffer.byteLength(fileContent, 'utf8'),
    });
    expect(fileContent).toBe('fake image');
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
        method: 'attachDebugger',
        sessionId: 's1',
        payload: 101,
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Page.enable',
          params: null,
        },
      },
      {
        method: 'sendDebuggerCommand',
        sessionId: 's1',
        payload: {
          tabId: 101,
          method: 'Page.captureScreenshot',
          params: {
            format: 'webp',
            captureBeyondViewport: true,
          },
        },
      },
      {
        method: 'detachDebugger',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('captures an interactive snapshot and saves the ref cache for the tab', async () => {
    const outcome = await runCliCommand(['page', 'snapshot', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);
    const cachePath = getPageSnapshotCachePath(
      { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      's1',
      101
    );
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      source: 'dom-interactive-v1',
      snapshotId: expect.any(String),
      capturedAt: expect.any(String),
      tabId: 101,
      title: 'Example Login',
      url: 'https://example.com/login',
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
      count: 2,
      visibleCount: 2,
      displayedCount: 2,
      scope: 'viewport',
      truncated: false,
    });
    expect(cache).toEqual({
      version: 1,
      sessionId: 's1',
      source: 'dom-interactive-v1',
      snapshotId: payload.data.snapshotId,
      capturedAt: payload.data.capturedAt,
      tabId: 101,
      title: 'Example Login',
      url: 'https://example.com/login',
      elements: payload.data.elements,
      count: 2,
      visibleCount: 2,
      truncated: false,
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
        payload: {
          tabId: 101,
          code: expect.stringContaining(PAGE_SNAPSHOT_EVAL_MARKER),
          options: {},
        },
      },
      {
        method: 'evaluateTab',
        sessionId: 's1',
        payload: {
          tabId: 101,
          code: expect.stringContaining(PAGE_SNAPSHOT_EVAL_MARKER),
          options: {},
        },
      },
    ]);
  });

  it('retries page snapshot when reactive pages detach during capture', async () => {
    browserService.pageSnapshotDetachedFailuresRemaining = 1;

    const outcome = await runCliCommand(['page', 'snapshot', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.tabId).toBe(101);
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(3);
  });
});
