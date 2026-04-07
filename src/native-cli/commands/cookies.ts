import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { SessionStore } from '../session-store.js';

import { parseOptionalTabFlag, parsePositiveInteger, resolveSession, resolveTab } from './support.js';

import type {
  BrowserService,
  CliCommandResult,
  CliCookieInfo,
  CliSessionRecord,
} from '../types.js';

interface CookiesCommandOptions {
  args: string[];
  explicitSessionId?: string;
  sessionStore: SessionStore;
  browserService: BrowserService;
}

interface CookieScopeOptions {
  url?: string;
  domain?: string;
  all?: boolean;
}

const DEFAULT_COOKIE_LIST_LIMIT = 50;

export async function runCookiesCommand(
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'help', ...rest] = options.args;

  switch (subcommand) {
    case 'list':
      return await runListCookiesCommand(rest, options);
    case 'get':
      return await runGetCookieCommand(rest, options);
    case 'set':
      return await runSetCookieCommand(rest, options);
    case 'clear':
      return await runClearCookiesCommand(rest, options);
    case 'export':
      return await runExportCookiesCommand(rest, options);
    case 'import':
      return await runImportCookiesCommand(rest, options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createCookiesHelpLines(),
      };
    default:
      throw new Error(`Unknown cookies command: ${subcommand}`);
  }
}

async function runListCookiesCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies list');
  const parsed = parseCookieScopeOptions(args, {
    allowAll: true,
    allowLimit: true,
  });
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const scope = await resolveCookieScope(options.browserService, session, explicitTabId, parsed.scope);
  const cookies = await options.browserService.listCookies(session, scopeToFilter(scope));
  const limitedCookies = cookies.slice(0, parsed.limit);

  return {
    session,
    data: {
      scope,
      count: limitedCookies.length,
      totalCount: cookies.length,
      truncated: limitedCookies.length < cookies.length,
      cookies: limitedCookies,
    },
    lines: [
      `Listed ${limitedCookies.length}/${cookies.length} cookie${
        cookies.length === 1 ? '' : 's'
      }`,
    ],
  };
}

async function runGetCookieCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies get');
  const [name, ...rest] = args;
  if (!name) {
    throw new Error('Usage: chrome-controller cookies get <name> [--url <url>] [--tab <id>]');
  }

  const parsed = parseCookieScopeOptions(rest);
  if (parsed.scope.all) {
    throw new Error('cookies get does not support --all');
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const scope = await resolveCookieScope(options.browserService, session, explicitTabId, parsed.scope);
  const cookie = await options.browserService.getCookie(session, name, scopeToFilter(scope));

  return {
    session,
    data: {
      scope,
      name,
      cookie,
    },
    lines: [
      cookie
        ? `Found cookie ${name}`
        : `Cookie ${name} was not found`,
    ],
  };
}

async function runSetCookieCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies set');
  const [name, value, ...rest] = args;
  if (!name || value === undefined) {
    throw new Error(
      'Usage: chrome-controller cookies set <name> <value> [--url <url>] [--path <path>] [--domain <domain>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>] [--tab <id>]'
    );
  }

  const parsed = parseSetCookieOptions(rest);
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const scope = await resolveCookieScope(options.browserService, session, explicitTabId, {
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(parsed.domain ? { domain: parsed.domain } : {}),
  });

  if (!scope.url) {
    throw new Error('cookies set requires a URL or a current tab with a valid URL');
  }

  const cookie = await options.browserService.setCookie(session, {
    name,
    value,
    url: scope.url,
    ...(parsed.domain ? { domain: parsed.domain } : {}),
    ...(parsed.path ? { path: parsed.path } : {}),
    ...(parsed.secure ? { secure: true } : {}),
    ...(parsed.httpOnly ? { httpOnly: true } : {}),
    ...(parsed.sameSite ? { sameSite: parsed.sameSite } : {}),
    ...(parsed.expirationDate !== undefined ? { expirationDate: parsed.expirationDate } : {}),
  });

  return {
    session,
    data: {
      scope,
      cookie,
    },
    lines: [`Set cookie ${name}`],
  };
}

async function runClearCookiesCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies clear');
  const [possibleName, ...rest] = args;
  const name = possibleName && !possibleName.startsWith('--') ? possibleName : undefined;
  const optionArgs = name ? rest : args;
  const parsed = parseCookieScopeOptions(optionArgs, {
    allowAll: true,
  });

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const scope = await resolveCookieScope(options.browserService, session, explicitTabId, parsed.scope);
  const outcome = await options.browserService.clearCookies(session, {
    ...scopeToFilter(scope),
    ...(name ? { name } : {}),
  });

  return {
    session,
    data: {
      scope,
      ...(name ? { name } : {}),
      ...outcome,
    },
    lines: [
      `Cleared ${outcome.clearedCount} cookie${
        outcome.clearedCount === 1 ? '' : 's'
      }`,
    ],
  };
}

async function runExportCookiesCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies export');
  const [filePath, ...rest] = args;
  if (!filePath) {
    throw new Error(
      'Usage: chrome-controller cookies export <path> [--url <url>] [--domain <domain>] [--all] [--tab <id>]'
    );
  }

  const parsed = parseCookieScopeOptions(rest, {
    allowAll: true,
  });
  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const scope = await resolveCookieScope(options.browserService, session, explicitTabId, parsed.scope);
  const cookies = await options.browserService.listCookies(session, scopeToFilter(scope));
  const absolutePath = resolve(filePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        scope,
        cookies,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    session,
    data: {
      path: absolutePath,
      scope,
      count: cookies.length,
    },
    lines: [`Exported ${cookies.length} cookie${cookies.length === 1 ? '' : 's'} to ${absolutePath}`],
  };
}

async function runImportCookiesCommand(
  rawArgs: string[],
  options: CookiesCommandOptions
): Promise<CliCommandResult> {
  const { args, tabId: explicitTabId } = parseOptionalTabFlag(rawArgs, 'cookies import');
  const [filePath, ...rest] = args;
  if (!filePath) {
    throw new Error(
      'Usage: chrome-controller cookies import <path> [--url <url>] [--tab <id>]'
    );
  }

  const parsed = parseCookieScopeOptions(rest);
  if (parsed.scope.all || parsed.scope.domain) {
    throw new Error('cookies import only supports --url and --tab');
  }

  const session = await resolveSession(options.sessionStore, options.explicitSessionId);
  const fallbackScope = await resolveCookieScope(
    options.browserService,
    session,
    explicitTabId,
    parsed.scope
  );
  const absolutePath = resolve(filePath);
  const exported = parseCookiesExportFile(await readFile(absolutePath, 'utf8'));

  let importedCount = 0;
  for (const cookie of exported.cookies) {
    const cookieUrl = parsed.scope.url ?? cookie.url ?? deriveCookieUrl(cookie) ?? fallbackScope.url;
    if (!cookieUrl) {
      throw new Error(`Could not determine a URL for cookie ${cookie.name}`);
    }

    await options.browserService.setCookie(session, {
      name: cookie.name,
      value: cookie.value,
      url: cookieUrl,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.path ? { path: cookie.path } : {}),
      ...(cookie.secure ? { secure: true } : {}),
      ...(cookie.httpOnly ? { httpOnly: true } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(cookie.expirationDate !== null ? { expirationDate: cookie.expirationDate } : {}),
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    });
    importedCount += 1;
  }

  return {
    session,
    data: {
      path: absolutePath,
      importedCount,
      scope: {
        ...(parsed.scope.url
          ? { url: parsed.scope.url }
          : fallbackScope.url
            ? { url: fallbackScope.url }
            : {}),
        ...(fallbackScope.domain ? { domain: fallbackScope.domain } : {}),
      },
    },
    lines: [`Imported ${importedCount} cookie${importedCount === 1 ? '' : 's'} from ${absolutePath}`],
  };
}

function parseCookieScopeOptions(
  args: string[],
  options: { allowAll?: boolean; allowLimit?: boolean } = {}
): { scope: CookieScopeOptions; limit: number } {
  const scope: CookieScopeOptions = {};
  let limit = DEFAULT_COOKIE_LIST_LIMIT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--url') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --url');
      }
      scope.url = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      scope.url = arg.slice('--url='.length);
      continue;
    }

    if (arg === '--domain') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --domain');
      }
      scope.domain = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--domain=')) {
      scope.domain = arg.slice('--domain='.length);
      continue;
    }

    if (options.allowAll && arg === '--all') {
      scope.all = true;
      continue;
    }

    if (options.allowLimit && arg === '--limit') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --limit');
      }
      limit = parsePositiveInteger(value, '--limit');
      index += 1;
      continue;
    }

    if (options.allowLimit && arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    throw new Error(`Unknown option for cookies command: ${arg}`);
  }

  return {
    scope,
    limit,
  };
}

function parseSetCookieOptions(args: string[]): {
  url?: string;
  domain?: string;
  path?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expirationDate?: number;
} {
  let url: string | undefined;
  let domain: string | undefined;
  let path: string | undefined;
  let secure = false;
  let httpOnly = false;
  let sameSite: string | undefined;
  let expirationDate: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--url') {
      url = requireOptionValue(args, index, '--url');
      index += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
      continue;
    }
    if (arg === '--domain') {
      domain = requireOptionValue(args, index, '--domain');
      index += 1;
      continue;
    }
    if (arg.startsWith('--domain=')) {
      domain = arg.slice('--domain='.length);
      continue;
    }
    if (arg === '--path') {
      path = requireOptionValue(args, index, '--path');
      index += 1;
      continue;
    }
    if (arg.startsWith('--path=')) {
      path = arg.slice('--path='.length);
      continue;
    }
    if (arg === '--secure') {
      secure = true;
      continue;
    }
    if (arg === '--http-only') {
      httpOnly = true;
      continue;
    }
    if (arg === '--same-site') {
      sameSite = requireOptionValue(args, index, '--same-site');
      index += 1;
      continue;
    }
    if (arg.startsWith('--same-site=')) {
      sameSite = arg.slice('--same-site='.length);
      continue;
    }
    if (arg === '--expires') {
      expirationDate = parsePositiveInteger(requireOptionValue(args, index, '--expires'), '--expires');
      index += 1;
      continue;
    }
    if (arg.startsWith('--expires=')) {
      expirationDate = parsePositiveInteger(arg.slice('--expires='.length), '--expires');
      continue;
    }

    throw new Error(`Unknown option for cookies set: ${arg}`);
  }

  return {
    ...(url ? { url } : {}),
    ...(domain ? { domain } : {}),
    ...(path ? { path } : {}),
    secure,
    httpOnly,
    ...(sameSite ? { sameSite } : {}),
    ...(expirationDate !== undefined ? { expirationDate } : {}),
  };
}

async function resolveCookieScope(
  browserService: BrowserService,
  session: CliSessionRecord,
  explicitTabId: number | undefined,
  scope: CookieScopeOptions
): Promise<CookieScopeOptions> {
  if (scope.all) {
    return { all: true };
  }
  if (scope.url || scope.domain) {
    return scope;
  }

  const tab = await resolveTab(browserService, session, explicitTabId);
  if (!tab.url) {
    throw new Error('Current tab does not have a URL that can be used for cookies');
  }

  return {
    url: tab.url,
  };
}

function scopeToFilter(scope: CookieScopeOptions): { url?: string; domain?: string } {
  if (scope.url) {
    return { url: scope.url };
  }
  if (scope.domain) {
    return { domain: scope.domain };
  }

  return {};
}

function parseCookiesExportFile(rawFile: string): { cookies: CliCookieInfo[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse cookies export file: ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Cookies import file must contain a JSON object');
  }

  const input = parsed as Record<string, unknown>;
  if (input.version !== 1) {
    throw new Error(`Unsupported cookies export version: ${String(input.version)}`);
  }
  if (!Array.isArray(input.cookies)) {
    throw new Error('cookies must be an array');
  }

  return {
    cookies: input.cookies.map((cookie, index) => normalizeImportedCookie(cookie, index)),
  };
}

function normalizeImportedCookie(value: unknown, index: number): CliCookieInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`cookies[${index}] must be an object`);
  }

  const input = value as Record<string, unknown>;
  if (typeof input.name !== 'string') {
    throw new Error(`cookies[${index}].name must be a string`);
  }
  if (typeof input.value !== 'string') {
    throw new Error(`cookies[${index}].value must be a string`);
  }

  return {
    name: input.name,
    value: input.value,
    ...(typeof input.url === 'string' ? { url: input.url } : {}),
    domain: typeof input.domain === 'string' ? input.domain : null,
    path: typeof input.path === 'string' ? input.path : null,
    secure: input.secure === true,
    httpOnly: input.httpOnly === true,
    sameSite: typeof input.sameSite === 'string' ? input.sameSite : null,
    expirationDate:
      typeof input.expirationDate === 'number' ? input.expirationDate : null,
    storeId: typeof input.storeId === 'string' ? input.storeId : null,
  };
}

function deriveCookieUrl(cookie: CliCookieInfo): string | null {
  if (cookie.url) {
    return cookie.url;
  }
  if (!cookie.domain) {
    return null;
  }

  const hostname = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  if (!hostname) {
    return null;
  }

  return `${cookie.secure ? 'https' : 'http'}://${hostname}${cookie.path ?? '/'}`;
}

function requireOptionValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}`);
  }

  return value;
}

function createCookiesHelpLines(): string[] {
  return [
    'Cookies commands',
    '',
    'Usage:',
    '  chrome-controller cookies list [--url <url>] [--domain <domain>] [--all] [--limit <n>] [--tab <id>]',
    '  chrome-controller cookies get <name> [--url <url>] [--tab <id>]',
    '  chrome-controller cookies set <name> <value> [--url <url>] [--domain <domain>] [--path <path>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>] [--tab <id>]',
    '  chrome-controller cookies clear [name] [--url <url>] [--domain <domain>] [--all] [--tab <id>]',
    '  chrome-controller cookies export <path> [--url <url>] [--domain <domain>] [--all] [--tab <id>]',
    '  chrome-controller cookies import <path> [--url <url>] [--tab <id>]',
    '',
    'Notes:',
    '  When no scope is provided, commands default to the current active tab URL.',
  ];
}
