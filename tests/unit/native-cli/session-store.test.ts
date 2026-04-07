import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionStore } from '../../../src/native-cli/session-store.js';

function createNowGenerator(): () => Date {
  const base = Date.parse('2026-04-06T00:00:00.000Z');
  let tick = 0;

  return () => new Date(base + tick++ * 1_000);
}

describe('SessionStore', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-session-store-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('creates a session and marks it as current', async () => {
    const sessionStore = new SessionStore({
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      now: createNowGenerator(),
    });

    const session = await sessionStore.createSession('alpha');
    const currentSession = await sessionStore.getCurrentSession();
    const sessions = await sessionStore.listSessions();

    expect(session.id).toBe('alpha');
    expect(currentSession?.id).toBe('alpha');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'alpha',
      current: true,
    });
  });

  it('generates short sequential session ids by default', async () => {
    const sessionStore = new SessionStore({
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      now: createNowGenerator(),
    });

    const first = await sessionStore.createSession();
    const second = await sessionStore.createSession();

    expect(first.id).toBe('s1');
    expect(second.id).toBe('s2');
  });

  it('ensures a current session and reuses it on later calls', async () => {
    const sessionStore = new SessionStore({
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      now: createNowGenerator(),
    });

    const first = await sessionStore.ensureCurrentSession();
    const second = await sessionStore.ensureCurrentSession();

    expect(first.created).toBe(true);
    expect(first.source).toBe('created');
    expect(second.created).toBe(false);
    expect(second.source).toBe('current');
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.updatedAt > first.session.updatedAt).toBe(true);
  });

  it('resolves an explicit session without changing the current pointer', async () => {
    const sessionStore = new SessionStore({
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      now: createNowGenerator(),
    });

    const alpha = await sessionStore.createSession('alpha');
    await sessionStore.createSession('beta');

    const resolved = await sessionStore.resolveSession('alpha');
    const currentSession = await sessionStore.getCurrentSession();

    expect(resolved).toMatchObject({
      created: false,
      source: 'explicit',
    });
    expect(resolved.session.id).toBe(alpha.id);
    expect(currentSession?.id).toBe('beta');
  });

  it('closes the current session and clears the current pointer', async () => {
    const sessionStore = new SessionStore({
      env: { ...process.env, CHROME_CONTROLLER_HOME: tempHome },
      now: createNowGenerator(),
    });

    await sessionStore.createSession('alpha');
    const outcome = await sessionStore.closeCurrentSession();

    expect(outcome.closed).toBe(true);
    expect(outcome.session?.id).toBe('alpha');
    expect(await sessionStore.getCurrentSession()).toBeNull();
    expect(await sessionStore.listSessions()).toEqual([]);
  });
});
