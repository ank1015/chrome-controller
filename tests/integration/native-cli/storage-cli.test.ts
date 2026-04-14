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
  CliStorageArea,
  CliStorageState,
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
    url: overrides.url ?? 'https://example.com/dashboard',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  reloadFailureMessage: string | null = null;
  private readonly tabs = [
    createTab({ id: 101, active: true, title: 'Dashboard' }),
  ];

  private readonly storage = {
    local: new Map<number, Record<string, string>>([
      [101, { token: 'abc', theme: 'dark' }],
    ]),
    session: new Map<number, Record<string, string>>([
      [101, { draft: 'pending' }],
    ]),
  };

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { windowId: 11 }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return this.tabs.map((tab) => ({ ...tab }));
  }

  async getTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'getTab',
      sessionId: session.id,
      payload: tabId,
    });

    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) {
      throw new Error(`Missing tab ${tabId}`);
    }

    return { ...tab };
  }

  async getStorageItems(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea
  ): Promise<Record<string, string>> {
    this.calls.push({
      method: 'getStorageItems',
      sessionId: session.id,
      payload: {
        tabId,
        area,
      },
    });

    return { ...(this.storage[area].get(tabId) ?? {}) };
  }

  async getStorageValue(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string
  ): Promise<string | null> {
    this.calls.push({
      method: 'getStorageValue',
      sessionId: session.id,
      payload: {
        tabId,
        area,
        key,
      },
    });

    return this.storage[area].get(tabId)?.[key] ?? null;
  }

  async setStorageValue(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key: string,
    value: string
  ): Promise<string | null> {
    this.calls.push({
      method: 'setStorageValue',
      sessionId: session.id,
      payload: {
        tabId,
        area,
        key,
        value,
      },
    });

    const bucket = { ...(this.storage[area].get(tabId) ?? {}) };
    bucket[key] = value;
    this.storage[area].set(tabId, bucket);
    return bucket[key];
  }

  async clearStorage(
    session: CliSessionRecord,
    tabId: number,
    area: CliStorageArea,
    key?: string
  ): Promise<{ clearedCount: number; existed?: boolean }> {
    this.calls.push({
      method: 'clearStorage',
      sessionId: session.id,
      payload: {
        tabId,
        area,
        key: key ?? null,
      },
    });

    const bucket = { ...(this.storage[area].get(tabId) ?? {}) };
    if (key) {
      const existed = Object.prototype.hasOwnProperty.call(bucket, key);
      delete bucket[key];
      this.storage[area].set(tabId, bucket);
      return {
        clearedCount: existed ? 1 : 0,
        existed,
      };
    }

    const clearedCount = Object.keys(bucket).length;
    this.storage[area].set(tabId, {});
    return {
      clearedCount,
    };
  }

  async captureStorageState(
    session: CliSessionRecord,
    tabId: number
  ): Promise<CliStorageState> {
    this.calls.push({
      method: 'captureStorageState',
      sessionId: session.id,
      payload: tabId,
    });

    return {
      version: 1,
      url: 'https://example.com/dashboard',
      origin: 'https://example.com',
      title: 'Dashboard',
      localStorage: {
        token: 'abc',
        theme: 'dark',
      },
      sessionStorage: {
        draft: 'pending',
      },
      cookies: [
        {
          name: 'sid',
          value: 'cookie-1',
          domain: '.example.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          expirationDate: 1000,
          storeId: '0',
        },
      ],
    };
  }

  async applyStorageState(
    session: CliSessionRecord,
    tabId: number,
    state: CliStorageState
  ): Promise<{
    origin: string | null;
    url: string | null;
    localCount: number;
    sessionCount: number;
    cookieCount: number;
  }> {
    this.calls.push({
      method: 'applyStorageState',
      sessionId: session.id,
      payload: {
        tabId,
        state,
      },
    });

    this.storage.local.set(tabId, { ...state.localStorage });
    this.storage.session.set(tabId, { ...state.sessionStorage });

    return {
      origin: state.origin,
      url: state.url,
      localCount: Object.keys(state.localStorage).length,
      sessionCount: Object.keys(state.sessionStorage).length,
      cookieCount: state.cookies.length,
    };
  }

  async reloadTab(session: CliSessionRecord, tabId: number): Promise<CliTabInfo> {
    this.calls.push({
      method: 'reloadTab',
      sessionId: session.id,
      payload: tabId,
    });

    if (this.reloadFailureMessage) {
      throw new Error(this.reloadFailureMessage);
    }

    return { ...this.tabs[0], id: tabId };
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

describe('native CLI storage commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-storage-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('gets, sets, and clears local storage on the current active tab', async () => {
    const getAll = await runCliCommand(['state', 'local', 'get', '--json'], tempHome, browserService, now);
    const set = await runCliCommand(
      ['state', 'local', 'set', 'token', 'updated-token', '--json'],
      tempHome,
      browserService,
      now
    );
    const getKey = await runCliCommand(
      ['state', 'local', 'get', 'token', '--json'],
      tempHome,
      browserService,
      now
    );
    const clearKey = await runCliCommand(
      ['state', 'local', 'clear', 'theme', '--json'],
      tempHome,
      browserService,
      now
    );

    const getAllPayload = JSON.parse(getAll.stdout);
    const setPayload = JSON.parse(set.stdout);
    const getKeyPayload = JSON.parse(getKey.stdout);
    const clearPayload = JSON.parse(clearKey.stdout);

    expect(getAll.exitCode).toBe(0);
    expect(set.exitCode).toBe(0);
    expect(getKey.exitCode).toBe(0);
    expect(clearKey.exitCode).toBe(0);
    expect(getAllPayload.data).toEqual({
      tabId: 101,
      area: 'local',
      count: 2,
      items: {
        token: 'abc',
        theme: 'dark',
      },
    });
    expect(setPayload.data).toEqual({
      tabId: 101,
      area: 'local',
      key: 'token',
      value: 'updated-token',
    });
    expect(getKeyPayload.data).toEqual({
      tabId: 101,
      area: 'local',
      key: 'token',
      value: 'updated-token',
    });
    expect(clearPayload.data).toEqual({
      tabId: 101,
      area: 'local',
      key: 'theme',
      clearedCount: 1,
      existed: true,
    });
  });

  it('reads and clears session storage on the current managed tab', async () => {
    const getSession = await runCliCommand(['state', 'session', 'get', '--json'], tempHome, browserService, now);
    const clearSession = await runCliCommand(['state', 'session', 'clear', '--json'], tempHome, browserService, now);

    const getPayload = JSON.parse(getSession.stdout);
    const clearPayload = JSON.parse(clearSession.stdout);

    expect(getSession.exitCode).toBe(0);
    expect(clearSession.exitCode).toBe(0);
    expect(getPayload.data).toEqual({
      tabId: 101,
      area: 'session',
      count: 1,
      items: {
        draft: 'pending',
      },
    });
    expect(clearPayload.data).toEqual({
      tabId: 101,
      area: 'session',
      clearedCount: 1,
    });
  });

  it('saves storage state to a file and returns a compact summary', async () => {
    const statePath = join(tempHome, 'state', 'example-state.json');

    const outcome = await runCliCommand(
      ['state', 'save', statePath, '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);
    const savedFile = JSON.parse(await readFile(statePath, 'utf8'));

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: statePath,
      origin: 'https://example.com',
      url: 'https://example.com/dashboard',
      localCount: 2,
      sessionCount: 1,
      cookieCount: 1,
    });
    expect(savedFile).toEqual(
      expect.objectContaining({
        version: 1,
        origin: 'https://example.com',
        url: 'https://example.com/dashboard',
        localStorage: {
          token: 'abc',
          theme: 'dark',
        },
        sessionStorage: {
          draft: 'pending',
        },
      })
    );
    expect(typeof savedFile.savedAt).toBe('string');
  });

  it('loads storage state from a file and can reload the tab', async () => {
    const statePath = join(tempHome, 'incoming-state.json');
    await writeStateFile(statePath, {
      version: 1,
      savedAt: '2026-04-06T00:00:00.000Z',
      url: 'https://example.com/dashboard',
      origin: 'https://example.com',
      title: 'Dashboard',
      localStorage: {
        token: 'fresh',
      },
      sessionStorage: {
        draft: 'done',
      },
      cookies: [
        {
          name: 'sid',
          value: 'cookie-2',
          domain: '.example.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          expirationDate: 2000,
          storeId: '0',
        },
      ],
    });

    const outcome = await runCliCommand(
      ['state', 'load', statePath, '--reload', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      path: statePath,
      origin: 'https://example.com',
      url: 'https://example.com/dashboard',
      localCount: 1,
      sessionCount: 1,
      cookieCount: 1,
      reloaded: true,
    });
    expect(browserService.calls.slice(-2)).toEqual([
      {
        method: 'applyStorageState',
        sessionId: 's1',
        payload: {
          tabId: 101,
          state: {
            version: 1,
            savedAt: '2026-04-06T00:00:00.000Z',
            url: 'https://example.com/dashboard',
            origin: 'https://example.com',
            title: 'Dashboard',
            localStorage: {
              token: 'fresh',
            },
            sessionStorage: {
              draft: 'done',
            },
            cookies: [
              {
                name: 'sid',
                value: 'cookie-2',
                domain: '.example.com',
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'lax',
                expirationDate: 2000,
                storeId: '0',
              },
            ],
          },
        },
      },
      {
        method: 'reloadTab',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('returns partial JSON data when state load succeeds but reload fails', async () => {
    const statePath = join(tempHome, 'incoming-state.json');
    await writeStateFile(statePath, {
      version: 1,
      savedAt: '2026-04-06T00:00:00.000Z',
      url: 'https://example.com/dashboard',
      origin: 'https://example.com',
      title: 'Dashboard',
      localStorage: {
        token: 'fresh',
      },
      sessionStorage: {
        draft: 'done',
      },
      cookies: [
        {
          name: 'sid',
          value: 'cookie-2',
          domain: '.example.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          expirationDate: 2000,
          storeId: '0',
        },
      ],
    });
    browserService.reloadFailureMessage = 'Reload failed';

    const outcome = await runCliCommand(
      ['state', 'load', statePath, '--reload', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toBe('');
    expect(payload).toEqual({
      success: false,
      error: 'Reload failed',
      sessionId: 's1',
      partial: true,
      data: {
        tabId: 101,
        path: statePath,
        origin: 'https://example.com',
        url: 'https://example.com/dashboard',
        localCount: 1,
        sessionCount: 1,
        cookieCount: 1,
        reloaded: false,
        reloadRequested: true,
        reloadError: 'Reload failed',
      },
    });
    expect(browserService.calls.slice(-2)).toEqual([
      {
        method: 'applyStorageState',
        sessionId: 's1',
        payload: {
          tabId: 101,
          state: {
            version: 1,
            savedAt: '2026-04-06T00:00:00.000Z',
            url: 'https://example.com/dashboard',
            origin: 'https://example.com',
            title: 'Dashboard',
            localStorage: {
              token: 'fresh',
            },
            sessionStorage: {
              draft: 'done',
            },
            cookies: [
              {
                name: 'sid',
                value: 'cookie-2',
                domain: '.example.com',
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'lax',
                expirationDate: 2000,
                storeId: '0',
              },
            ],
          },
        },
      },
      {
        method: 'reloadTab',
        sessionId: 's1',
        payload: 101,
      },
    ]);
  });

  it('supports the state wrapper for local storage', async () => {
    const outcome = await runCliCommand(
      ['state', 'local', 'get', 'token', '--json'],
      tempHome,
      browserService,
      now
    );
    const payload = JSON.parse(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(payload.data).toEqual({
      tabId: 101,
      area: 'local',
      key: 'token',
      value: 'abc',
    });
  });
});

async function writeStateFile(path: string, state: CliStorageState): Promise<void> {
  const json = `${JSON.stringify(state, null, 2)}\n`;
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, 'utf8');
}
