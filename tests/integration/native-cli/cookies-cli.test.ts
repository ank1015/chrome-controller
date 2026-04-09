import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runCli } from '../../../src/native-cli/cli.js';
import { BaseMockBrowserService } from '../../helpers/native-cli/base-mock-browser-service.js';
import { createCapturedOutput } from '../../helpers/io.js';

import type {
  BrowserService,
  CliCookieInfo,
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
    title: overrides.title ?? 'Dashboard',
    url: overrides.url ?? 'https://example.com/dashboard',
    index: overrides.index ?? 0,
    status: 'complete',
    groupId: -1,
  };
}

function createCookie(overrides: Partial<CliCookieInfo> = {}): CliCookieInfo {
  return {
    name: overrides.name ?? 'sid',
    value: overrides.value ?? 'cookie-1',
    ...(overrides.url !== undefined ? { url: overrides.url } : { url: 'https://example.com/' }),
    domain: overrides.domain ?? '.example.com',
    path: overrides.path ?? '/',
    secure: overrides.secure ?? true,
    httpOnly: overrides.httpOnly ?? true,
    sameSite: overrides.sameSite ?? 'lax',
    expirationDate: overrides.expirationDate ?? 1000,
    storeId: overrides.storeId ?? '0',
  };
}

class MockBrowserService extends BaseMockBrowserService implements BrowserService {
  private cookies: CliCookieInfo[] = [
    createCookie({ name: 'sid', value: 'cookie-1' }),
    createCookie({ name: 'pref', value: 'dark', httpOnly: false }),
  ];

  async listTabs(
    session: CliSessionRecord,
    options: CliListTabsOptions = { currentWindow: true }
  ): Promise<CliTabInfo[]> {
    this.calls.push({
      method: 'listTabs',
      sessionId: session.id,
      payload: options,
    });

    return [createTab({ active: true })];
  }

  async listCookies(
    session: CliSessionRecord,
    options: { url?: string; domain?: string } = {}
  ): Promise<CliCookieInfo[]> {
    this.calls.push({
      method: 'listCookies',
      sessionId: session.id,
      payload: options,
    });

    return this.cookies.map((cookie) => ({ ...cookie }));
  }

  async getCookie(
    session: CliSessionRecord,
    name: string,
    options: { url?: string; domain?: string } = {}
  ): Promise<CliCookieInfo | null> {
    this.calls.push({
      method: 'getCookie',
      sessionId: session.id,
      payload: {
        name,
        options,
      },
    });

    const cookie = this.cookies.find((item) => item.name === name);
    return cookie ? { ...cookie } : null;
  }

  async setCookie(
    session: CliSessionRecord,
    cookie: {
      name: string;
      value: string;
      url: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: string;
      expirationDate?: number;
      storeId?: string;
    }
  ): Promise<CliCookieInfo> {
    this.calls.push({
      method: 'setCookie',
      sessionId: session.id,
      payload: cookie,
    });

    const normalized = createCookie({
      name: cookie.name,
      value: cookie.value,
      url: cookie.url,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.path ? { path: cookie.path } : {}),
      secure: cookie.secure ?? false,
      httpOnly: cookie.httpOnly ?? false,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      expirationDate: cookie.expirationDate ?? null,
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    });

    this.cookies = this.cookies.filter((item) => item.name !== cookie.name).concat(normalized);
    return { ...normalized };
  }

  async clearCookies(
    session: CliSessionRecord,
    options: { url?: string; domain?: string; name?: string } = {}
  ): Promise<{ clearedCount: number }> {
    this.calls.push({
      method: 'clearCookies',
      sessionId: session.id,
      payload: options,
    });

    const before = this.cookies.length;
    this.cookies = options.name
      ? this.cookies.filter((cookie) => cookie.name !== options.name)
      : [];

    return {
      clearedCount: before - this.cookies.length,
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

describe('native CLI cookies commands', () => {
  let tempHome: string;
  let now: () => Date;
  let browserService: MockBrowserService;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-cli-cookies-'));
    now = createNowGenerator();
    browserService = new MockBrowserService();
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('lists and gets cookies scoped to the current active tab url by default', async () => {
    const list = await runCliCommand(['cookies', 'list', '--json'], tempHome, browserService, now);
    const get = await runCliCommand(['cookies', 'get', 'sid', '--json'], tempHome, browserService, now);

    const listPayload = JSON.parse(list.stdout);
    const getPayload = JSON.parse(get.stdout);

    expect(list.exitCode).toBe(0);
    expect(get.exitCode).toBe(0);
    expect(listPayload.data.scope).toEqual({
      url: 'https://example.com/dashboard',
    });
    expect(listPayload.data.totalCount).toBe(2);
    expect(getPayload.data.cookie).toEqual(
      expect.objectContaining({
        name: 'sid',
        value: 'cookie-1',
      })
    );
  });

  it('sets and clears cookies with a compact payload', async () => {
    const set = await runCliCommand(
      [
        'cookies',
        'set',
        'sid',
        'fresh-cookie',
        '--path',
        '/',
        '--secure',
        '--http-only',
        '--json',
      ],
      tempHome,
      browserService,
      now
    );
    const clear = await runCliCommand(
      ['cookies', 'clear', 'sid', '--json'],
      tempHome,
      browserService,
      now
    );

    const setPayload = JSON.parse(set.stdout);
    const clearPayload = JSON.parse(clear.stdout);

    expect(set.exitCode).toBe(0);
    expect(clear.exitCode).toBe(0);
    expect(setPayload.data.cookie).toEqual(
      expect.objectContaining({
        name: 'sid',
        value: 'fresh-cookie',
      })
    );
    expect(clearPayload.data.clearedCount).toBe(1);
  });

  it('exports and imports cookies through a file', async () => {
    const exportPath = join(tempHome, 'cookies', 'export.json');
    const exportOutcome = await runCliCommand(
      ['cookies', 'export', exportPath, '--json'],
      tempHome,
      browserService,
      now
    );

    const exportedFile = JSON.parse(await readFile(exportPath, 'utf8'));
    expect(exportOutcome.exitCode).toBe(0);
    expect(exportedFile).toEqual(
      expect.objectContaining({
        version: 1,
        scope: {
          url: 'https://example.com/dashboard',
        },
        cookies: expect.any(Array),
      })
    );

    const importPath = join(tempHome, 'cookies', 'import.json');
    await writeJson(importPath, {
      version: 1,
      exportedAt: '2026-04-06T00:00:00.000Z',
      cookies: [
        createCookie({
          name: 'token',
          value: 'token-2',
          url: 'https://example.com/',
          httpOnly: false,
        }),
      ],
    });

    const importOutcome = await runCliCommand(
      ['cookies', 'import', importPath, '--json'],
      tempHome,
      browserService,
      now
    );
    const importPayload = JSON.parse(importOutcome.stdout);

    expect(importOutcome.exitCode).toBe(0);
    expect(importPayload.data).toEqual({
      path: importPath,
      importedCount: 1,
      scope: {
        url: 'https://example.com/dashboard',
      },
    });
    expect(browserService.calls.at(-1)).toEqual({
      method: 'setCookie',
      sessionId: 's1',
      payload: {
        name: 'token',
        value: 'token-2',
        url: 'https://example.com/',
        domain: '.example.com',
        path: '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: 1000,
        storeId: '0',
      },
    });
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
