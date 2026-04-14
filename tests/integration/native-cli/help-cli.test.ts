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

  it('describes keyboard, mouse, and upload commands as acting on the session current tab', async () => {
    const commands = [
      ['keyboard', 'help'],
      ['mouse', 'help'],
      ['upload', 'help'],
    ];

    for (const command of commands) {
      const outcome = await runCliCommand(command, tempHome);

      expect(outcome.exitCode).toBe(0);
      expect(outcome.stderr).toBe('');
      expect(outcome.stdout).toContain("active session's current tab");
      expect(outcome.stdout).toContain('Use `tabs use <tabId>` to switch which tab');
      expect(outcome.stdout).not.toContain('[--tab <id>]');
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
    expect(outcome.stdout).toContain(
      'chrome-controller page text [--find <query> [--limit <n>]]'
    );
    expect(outcome.stdout).toContain(
      'chrome-controller page snapshot [--find <query>] [--limit <n>]'
    );
    expect(outcome.stdout).toContain('chrome-controller page back');
    expect(outcome.stdout).toContain('chrome-controller page screenshot');
    expect(outcome.stdout).toContain(
      'Add `--find "<query>"` to `page text` or `page snapshot`'
    );
    expect(outcome.stdout).toContain(
      'For raw `page snapshot` output, `--limit` caps how many visible elements are shown.'
    );
    expect(outcome.stdout).not.toContain('chrome-controller page find <query> [--limit <n>]');
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
      'chrome-controller element click <selector|@ref> [--new-tab] [--retry-stale]'
    );
    expect(outcome.stdout).toContain(
      'chrome-controller element press <selector|@ref> <key> [--count <n>]'
    );
    expect(outcome.stdout).toContain(
      'Add --new-tab to open a link in a background tab.'
    );
    expect(outcome.stdout).not.toContain('[--tab <id>]');
  });

  it('describes wait, observe, and state commands around the managed session model', async () => {
    const waitOutcome = await runCliCommand(['wait', 'help'], tempHome);
    const observeOutcome = await runCliCommand(['observe', 'help'], tempHome);
    const stateOutcome = await runCliCommand(['state', 'help'], tempHome);
    const rawOutcome = await runCliCommand(['raw', 'help'], tempHome);
    const openOutcome = await runCliCommand(['open', 'help'], tempHome);

    expect(waitOutcome.exitCode).toBe(0);
    expect(waitOutcome.stderr).toBe('');
    expect(waitOutcome.stdout).toContain(
      "All wait commands except `wait idle` act on the active session's current tab."
    );
    expect(waitOutcome.stdout).toContain('chrome-controller wait idle <ms>');
    expect(waitOutcome.stdout).toContain(
      'wait stable defaults to --timeout-ms 30000 --poll-ms 250 --quiet-ms 500'
    );
    expect(waitOutcome.stdout).not.toContain('[--tab <id>]');

    expect(observeOutcome.exitCode).toBe(0);
    expect(observeOutcome.stderr).toBe('');
    expect(observeOutcome.stdout).toContain(
      'Use observe when you want to inspect runtime signals from the active session.'
    );
    expect(observeOutcome.stdout).toContain('chrome-controller observe console list');
    expect(observeOutcome.stdout).toContain('chrome-controller observe network start');

    expect(stateOutcome.exitCode).toBe(0);
    expect(stateOutcome.stderr).toBe('');
    expect(stateOutcome.stdout).toContain(
      "State commands act on the active session's current tab or its URL scope."
    );
    expect(stateOutcome.stdout).toContain('chrome-controller state local get [key]');
    expect(stateOutcome.stdout).toContain('chrome-controller state cookies list');

    expect(rawOutcome.exitCode).toBe(0);
    expect(rawOutcome.stderr).toBe('');
    expect(rawOutcome.stdout).toContain(
      'Use raw commands only when the opinionated CLI surface cannot do the job.'
    );
    expect(rawOutcome.stdout).toContain('chrome-controller raw browser <method> [argsJson]');
    expect(rawOutcome.stdout).toContain('chrome-controller raw cdp <method> [paramsJson]');

    expect(openOutcome.exitCode).toBe(0);
    expect(openOutcome.stderr).toBe('');
    expect(openOutcome.stdout).toContain(
      'the wait defaults are --timeout-ms 30000 --poll-ms 250 --quiet-ms 500'
    );
  });
});
