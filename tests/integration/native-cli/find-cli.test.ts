import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

const { getTextMock, llmMock, userMessageMock } = vi.hoisted(() => ({
  llmMock: vi.fn(),
  getTextMock: vi.fn((message: { mockText?: string } | null | undefined) => message?.mockText ?? ''),
  userMessageMock: vi.fn((content: string) => ({
    role: 'user',
    id: 'user-message-1',
    timestamp: 0,
    content: [{ type: 'text', content }],
  })),
}));

vi.mock('@ank1015/llm-sdk', () => ({
  llm: llmMock,
  getText: getTextMock,
  userMessage: userMessageMock,
}));

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
  const base = Date.parse('2026-04-07T00:00:00.000Z');
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
  private readonly tabs = new Map<number, CliTabInfo>([
    [101, createTab({ id: 101, active: true, title: 'Home', url: 'https://example.com/home' })],
    [102, createTab({ id: 102, active: false, title: 'Docs', url: 'https://example.com/docs' })],
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
      return {
        [PAGE_TEXT_EVAL_MARKER]: true,
        title: 'Example Login',
        url: 'https://example.com/login',
        html: '<main><h1>Welcome back</h1><p>Use your work email to continue.</p></main>',
      };
    }

    throw new Error(`Unexpected evaluation code for tab ${tabId}`);
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

describe('native CLI find command', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-find-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
    llmMock.mockReset();
    getTextMock.mockClear();
    userMessageMock.mockClear();
    llmMock.mockResolvedValue({
      mockText: [
        '## Relevant elements',
        '- @e1 [textbox type="email"] "Email" selector="#email" alt="input[name=\\"email\\"]"',
        '- @e2 [button] "Sign in" selector="button[type=\\"submit\\"]"',
        '',
        '## Relevant text',
        '- Welcome back',
      ].join('\n'),
    });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('builds a page model, returns the llm-ranked result, and refreshes the snapshot cache', async () => {
    const outcome = await runCliCommand(
      ['find', 'search box and sign in button', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.query).toBe('search box and sign in button');
    expect(payload.data.limit).toBe(20);
    expect(payload.data.resultMarkdown).toBe(
      [
        '## Relevant elements',
        '- @e1 [textbox type="email"] "Email" selector="#email" alt="input[name=\\"email\\"]"',
        '- @e2 [button] "Sign in" selector="button[type=\\"submit\\"]"',
        '',
        '## Relevant text',
        '- Welcome back',
      ].join('\n')
    );
    expect(payload.data.pageModelMarkdown).toContain('## Interactive elements');
    expect(payload.data.pageModelMarkdown).toContain(
      '- @e1 [textbox type="email"] "Email" selector="#email"'
    );
    expect(payload.data.pageModelMarkdown).toContain('# Welcome back');
    expect(payload.data.snapshotId).toEqual(expect.stringMatching(/^snap-101-/));
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab')
    ).toHaveLength(4);
    expect(llmMock).toHaveBeenCalledTimes(1);
    expect(userMessageMock).toHaveBeenCalledWith(payload.data.pageModelMarkdown);

    const cachedSnapshot = JSON.parse(
      await readFile(
        getPageSnapshotCachePath(
          { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
          's1',
          101
        ),
        'utf8'
      )
    );
    expect(cachedSnapshot.elements).toEqual([
      expect.objectContaining({
        ref: '@e1',
        role: 'textbox',
        name: 'Email',
      }),
      expect.objectContaining({
        ref: '@e2',
        role: 'button',
        name: 'Sign in',
      }),
    ]);
  });

  it('supports explicit tab selection and forwards the requested result limit', async () => {
    const outcome = await runCliCommand(
      ['find', 'email field', '--tab', '102', '--limit', '30', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data.tabId).toBe(102);
    expect(payload.data.query).toBe('email field');
    expect(payload.data.limit).toBe(30);
    expect(payload.data.resultMarkdown).toContain('## Relevant elements');
    expect(browserService.calls[0]).toEqual({
      method: 'getTab',
      sessionId: 's1',
      payload: 102,
    });
    expect(
      browserService.calls.filter((call) => call.method === 'evaluateTab').every((call) =>
        Boolean(
          typeof call.payload === 'object' &&
            call.payload !== null &&
            'tabId' in call.payload &&
            (call.payload as { tabId: number }).tabId === 102
        )
      )
    ).toBe(true);
  });
});
