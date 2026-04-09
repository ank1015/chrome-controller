import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    title: overrides.title ?? 'Screenshot tab',
    url: overrides.url ?? 'https://example.com',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return [createTab({ id: 101, active: true })];
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

describe('native CLI screenshot commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-screenshot-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('captures a screenshot to the default artifacts location', async () => {
    const outcome = await runCliCommand(['screenshot', 'take', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);
    const savedBuffer = await readFile(payload.data.path);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: expect.stringContaining(join(tempHome, 'artifacts', 'screenshots')),
      format: 'png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });
    expect(savedBuffer.toString()).toBe('fake image');
    expect(browserService.calls.at(-1)).toEqual({
      method: 'detachDebugger',
      sessionId: 's1',
      payload: 101,
    });
  });

  it('captures a jpeg screenshot with explicit options', async () => {
    const targetPath = join(tempHome, 'shots', 'page.jpg');
    const outcome = await runCliCommand(
      ['screenshot', 'take', targetPath, '--format', 'jpeg', '--quality', '80', '--full-page', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: targetPath,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(browserService.calls).toContainEqual({
      method: 'sendDebuggerCommand',
      sessionId: 's1',
      payload: {
        tabId: 101,
        method: 'Page.captureScreenshot',
        params: {
          format: 'jpeg',
          quality: 80,
          captureBeyondViewport: true,
        },
      },
    });
  });
});
