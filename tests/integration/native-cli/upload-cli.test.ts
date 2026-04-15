import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
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
    title: overrides.title ?? 'Tab',
    url: overrides.url ?? 'https://example.com/upload',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { windowId: 11 }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return [createTab({ id: 101, active: true }), createTab({ id: 102, active: false, index: 1 })];
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    return createTab({ id: tabId, active: tabId === 101 });
  }

  async uploadFiles(
    session: CliSessionRecord,
    tabId: number,
    selector: string,
    paths: string[]
  ): Promise<{ selector: string; files: string[] }> {
    this.calls.push({
      method: 'uploadFiles',
      sessionId: session.id,
      payload: {
        tabId,
        selector,
        paths,
      },
    });

    return {
      selector,
      files: paths.map((path) => resolve(path)),
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

describe('native CLI upload commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-upload-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('uploads files to the current active tab by default', async () => {
    const outcome = await runCliCommand(
      ['upload', 'files', 'input[type=file]', './fixtures/a.txt', './fixtures/b.txt', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.sessionId).toBe('s1');
    expect(payload.data).toEqual({
      tabId: 101,
      selector: 'input[type=file]',
      files: [resolve('./fixtures/a.txt'), resolve('./fixtures/b.txt')],
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
        method: 'uploadFiles',
        sessionId: 's1',
        payload: {
          tabId: 101,
          selector: 'input[type=file]',
          paths: ['./fixtures/a.txt', './fixtures/b.txt'],
        },
      },
    ]);
  });
});
