import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { createCapturedOutput } from '../../helpers/io.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

async function runCliCommand(
  args: string[],
  homeDir: string,
  now: () => Date = createNowGenerator()
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = createCapturedOutput();
  const stderr = createCapturedOutput();
  const exitCode = await runCli(args, {
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

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-session-'));
    now = createNowGenerator();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('creates short generated session ids', async () => {
    const first = await runCliCommand(['session', 'create', '--json'], tempHome, now);
    const second = await runCliCommand(['session', 'create', '--json'], tempHome, now);
    const current = await runCliCommand(['session', 'current', '--json'], tempHome, now);

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
      now
    );
    const createBeta = await runCliCommand(
      ['session', 'create', '--id', 'beta', '--json'],
      tempHome,
      now
    );
    const useAlpha = await runCliCommand(['session', 'use', 'alpha', '--json'], tempHome, now);
    const list = await runCliCommand(['session', 'list', '--json'], tempHome, now);

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

  it('returns JSON errors for invalid commands in json mode', async () => {
    const outcome = await runCliCommand(['session', 'use', 'missing', '--json'], tempHome, now);
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(1);
    expect(payload).toEqual({
      success: false,
      error: 'Session "missing" does not exist',
    });
    expect(outcome.stderr).toBe('');
  });

  it('closes a named session and keeps the others', async () => {
    await runCliCommand(['session', 'create', '--id', 'alpha', '--json'], tempHome, now);
    await runCliCommand(['session', 'create', '--id', 'beta', '--json'], tempHome, now);

    const close = await runCliCommand(['session', 'close', 'alpha', '--json'], tempHome, now);
    const list = await runCliCommand(['session', 'list', '--json'], tempHome, now);

    const closePayload = JSON.parse(close.stdout);
    const listPayload = JSON.parse(list.stdout);

    expect(close.exitCode).toBe(0);
    expect(closePayload.data.closed).toBe(true);
    expect(closePayload.data.session.id).toBe('alpha');
    expect(listPayload.data.sessions).toEqual([
      expect.objectContaining({ id: 'beta', current: true }),
    ]);
  });
});
