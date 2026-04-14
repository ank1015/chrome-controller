import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

class HelpMockBrowserService extends BaseMockBrowserService {}

async function runCliCommand(
  args: string[],
  homeDir: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = createCapturedOutput();
  const stderr = createCapturedOutput();
  const exitCode = await runCli(args, {
    browserService: new HelpMockBrowserService(),
    env: { ...process.env, CHROME_CONTROLLER_HOME: homeDir },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
  };
}

describe('native CLI help text', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-help-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('describes current-session-tab resolution for optional --tab commands', async () => {
    const commands = [
      ['console', 'help'],
      ['storage', 'help'],
      ['upload', 'help'],
      ['debugger', 'help'],
    ];

    for (const command of commands) {
      const outcome = await runCliCommand(command, tempHome);

      expect(outcome.exitCode).toBe(0);
      expect(outcome.stderr).toBe('');
      expect(outcome.stdout).toContain(
        "When --tab is omitted, the session's current tab is used first."
      );
      expect(outcome.stdout).toContain(
        "If the session's current tab is missing or not set, the active tab in the managed session window is used."
      );
      expect(outcome.stdout).not.toContain(
        'When --tab is omitted, the current active tab in the current window is used.'
      );
    }
  });

  it('describes page commands as acting on the session current tab', async () => {
    const outcome = await runCliCommand(['page', 'help'], tempHome);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(outcome.stdout).toContain(
      "All page commands act on the active session's current tab."
    );
    expect(outcome.stdout).toContain(
      'Use `tabs use <tabId>` to switch which tab page commands operate on.'
    );
    expect(outcome.stdout).toContain('chrome-controller page find <query> [--limit <n>]');
    expect(outcome.stdout).toContain('chrome-controller page screenshot');
    expect(outcome.stdout).not.toContain(
      "When --tab is omitted, the session's current tab is used first."
    );
  });

  it('describes element commands as acting on the session current tab', async () => {
    const outcome = await runCliCommand(['element', 'help'], tempHome);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(outcome.stdout).toContain(
      "All element commands act on the active session's current tab."
    );
    expect(outcome.stdout).toContain(
      'Use `tabs use <tabId>` to switch which tab element commands operate on.'
    );
    expect(outcome.stdout).toContain(
      'chrome-controller element press <selector|@ref> <key> [--count <n>]'
    );
    expect(outcome.stdout).not.toContain('[--tab <id>]');
  });

  it('describes current-session-tab-first URL scoping for cookies help', async () => {
    const outcome = await runCliCommand(['cookies', 'help'], tempHome);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(outcome.stdout).toContain(
      "When no scope is provided, commands use the session's current tab URL first."
    );
    expect(outcome.stdout).toContain(
      "If the session's current tab is missing or not set, they fall back to the active tab URL in the managed session window."
    );
    expect(outcome.stdout).not.toContain(
      'When no scope is provided, commands default to the current active tab URL.'
    );
  });
});
