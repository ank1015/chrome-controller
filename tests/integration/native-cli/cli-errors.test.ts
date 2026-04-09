import { mkdtemp, rm } from 'node:fs/promises';
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

function createTab(overrides: Partial<CliTabInfo> = {}): CliTabInfo {
  return {
    id: overrides.id ?? 101,
    windowId: overrides.windowId ?? 11,
    active: overrides.active ?? true,
    pinned: false,
    audible: false,
    muted: false,
    title: overrides.title ?? 'Error test',
    url: overrides.url ?? 'https://example.com/dashboard',
    index: overrides.index ?? 0,
    status: overrides.status ?? 'complete',
    groupId: overrides.groupId ?? -1,
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

    return [createTab()];
  }

  async evaluateTab(session: CliSessionRecord, tabId: number): Promise<unknown> {
    this.calls.push({
      method: 'evaluateTab',
      sessionId: session.id,
      payload: {
        tabId,
      },
    });

    throw new Error('{"code":-32000,"message":"Cannot find default execution context"}');
  }
}

describe('native CLI error normalization', () => {
  let tempHome: string;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-errors-'));
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('normalizes transient execution-context errors into actionable guidance', async () => {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();

    const exitCode = await runCli(['page', 'eval', 'document.title', '--json'], {
      browserService,
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.read())).toEqual({
      success: false,
      error:
        'The page changed while the command was running. Wait for the page to settle, and if you are using snapshot refs run `chrome-controller page snapshot` again before retrying.',
    });
    expect(stderr.read()).toBe('');
  });
});
