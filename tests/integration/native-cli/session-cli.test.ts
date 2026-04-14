import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

class MockBrowserService extends BaseMockBrowserService {}

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

async function runCliCommand(
  args: string[],
  homeDir: string,
  browserService: MockBrowserService,
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

describe('native CLI session commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-session-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('creates short generated session ids', async () => {
    const first = await runCliCommand(['session', 'create', '--json'], tempHome, browserService, now);
    const second = await runCliCommand(['session', 'create', '--json'], tempHome, browserService, now);
    const current = await runCliCommand(['session', 'info', '--json'], tempHome, browserService, now);

    const firstPayload = JSON.parse(first.stdout);
    const secondPayload = JSON.parse(second.stdout);
    const currentPayload = JSON.parse(current.stdout);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(current.exitCode).toBe(0);

    expect(firstPayload.success).toBe(true);
    expect(firstPayload.sessionId).toBe('s1');
    expect(secondPayload.sessionId).toBe('s2');
    expect(currentPayload.data.session.id).toBe('s2');
  });

  it('creates, switches, and lists sessions', async () => {
    const createAlpha = await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const createBeta = await runCliCommand(
      ['session', 'create', '--id', 'beta', '--json'],
      tempHome,
      browserService,
      now
    );
    const useAlpha = await runCliCommand(['session', 'use', 'alpha', '--json'], tempHome, browserService, now);
    const list = await runCliCommand(['session', 'list', '--json'], tempHome, browserService, now);

    const createAlphaPayload = JSON.parse(createAlpha.stdout);
    const createBetaPayload = JSON.parse(createBeta.stdout);
    const useAlphaPayload = JSON.parse(useAlpha.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(createAlphaPayload.sessionId).toBe('alpha');
    expect(createBetaPayload.sessionId).toBe('beta');
    expect(useAlphaPayload.sessionId).toBe('alpha');
    expect(listPayload.data.currentSessionId).toBe('alpha');
    expect(listPayload.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'alpha', current: true }),
        expect.objectContaining({ id: 'beta', current: false }),
      ])
    );
  });

  it('creates a named session when session create uses the global --session flag', async () => {
    const create = await runCliCommand(
      ['session', 'create', '--session', 'linkedin-dm-task1', '--json'],
      tempHome,
      browserService,
      now
    );
    const list = await runCliCommand(['session', 'list', '--json'], tempHome, browserService, now);

    const createPayload = JSON.parse(create.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(create.exitCode).toBe(0);
    expect(createPayload.sessionId).toBe('linkedin-dm-task1');
    expect(createPayload.data.session.id).toBe('linkedin-dm-task1');
    expect(listPayload.data.currentSessionId).toBe('linkedin-dm-task1');
    expect(listPayload.data.sessions).toEqual([
      expect.objectContaining({ id: 'linkedin-dm-task1', current: true }),
    ]);
  });

  it('rejects conflicting create ids when both --id and --session are provided', async () => {
    const outcome = await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--session', 'beta', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(1);
    expect(payload).toEqual({
      success: false,
      error: 'Conflicting session ids provided: --id alpha and --session beta',
    });
  });

  it('returns JSON errors for invalid commands in json mode', async () => {
    const outcome = await runCliCommand(['session', 'use', 'missing', '--json'], tempHome, browserService, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(1);
    expect(payload).toEqual({
      success: false,
      error: 'Session "missing" does not exist',
    });
    expect(outcome.stderr).toBe('');
  });

  it('closes a named session and keeps the others', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, browserService, now);
    await runCliCommand(['session', 'create', '--id', 'beta', '--json'], tempHome, browserService, now);

    const close = await runCliCommand(['session', 'close', 'alpha', '--json'], tempHome, browserService, now);
    const list = await runCliCommand(['session', 'list', '--json'], tempHome, browserService, now);

    const closePayload = JSON.parse(close.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(close.exitCode).toBe(0);
    expect(closePayload.data.closed).toBe(true);
    expect(closePayload.data.session.id).toBe('alpha');
    expect(listPayload.data.sessions).toEqual([
      expect.objectContaining({ id: 'beta', current: true }),
    ]);
  });

  it('recreates the managed window when a session window is missing', async () => {
    const create = await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const createdPayload = JSON.parse(create.stdout);

    await browserService.closeWindow(createdPayload.data.session, createdPayload.data.session.windowId);
    browserService.calls.length = 0;

    const info = await runCliCommand(['session', 'info', 'alpha', '--json'], tempHome, browserService, now);
    const infoPayload = JSON.parse(info.stdout);

    expect(info.exitCode).toBe(0);
    expect(infoPayload.data.session.id).toBe('alpha');
    expect(infoPayload.data.session.windowId).toBe(12);
    expect(browserService.calls).toEqual([
      {
        method: 'getWindow',
        sessionId: 'alpha',
        payload: 11,
      },
      {
        method: 'createWindow',
        sessionId: 'alpha',
        payload: {
          focused: false,
        },
      },
    ]);
  });

  it('resets a session by replacing its managed window', async () => {
    const create = await runCliCommand(
      ['session', 'create', '--id', 'alpha', '--json'],
      tempHome,
      browserService,
      now
    );
    const createdPayload = JSON.parse(create.stdout);

    browserService.calls.length = 0;

    const reset = await runCliCommand(['session', 'reset', 'alpha', '--json'], tempHome, browserService, now);
    const resetPayload = JSON.parse(reset.stdout);

    expect(reset.exitCode).toBe(0);
    expect(resetPayload.data.session.id).toBe('alpha');
    expect(resetPayload.data.session.windowId).toBe(12);
    expect(resetPayload.data.session.targetTabId).toBeNull();
    expect(browserService.calls).toEqual([
      {
        method: 'closeWindow',
        sessionId: 'alpha',
        payload: createdPayload.data.session.windowId,
      },
      {
        method: 'createWindow',
        sessionId: 'alpha',
        payload: {
          focused: false,
        },
      },
    ]);
  });
});
