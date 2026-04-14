import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getChromeControllerHome } from './session-store.js';

export interface ChromeControllerConfig {
  chromeProfileDirectory: string;
  chromeProfileEmail: string | null;
}

const DEFAULT_CHROME_PROFILE_DIRECTORY = 'Default';

export function getChromeControllerConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getChromeControllerHome(env), 'config.json');
}

export async function readChromeControllerConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<ChromeControllerConfig> {
  const configPath = getChromeControllerConfigPath(env);

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultChromeControllerConfig();
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse chrome-controller config at ${configPath}: ${message}`);
  }

  return normalizeChromeControllerConfig(parsed, configPath);
}

export async function writeChromeControllerConfig(
  config: ChromeControllerConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const configPath = getChromeControllerConfigPath(env);
  await mkdir(getChromeControllerHome(env), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        chrome: {
          profileDirectory: config.chromeProfileDirectory,
          ...(config.chromeProfileEmail ? { profileEmail: config.chromeProfileEmail } : {}),
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return configPath;
}

export function normalizeChromeControllerConfig(
  value: unknown,
  configPath = 'chrome-controller config'
): ChromeControllerConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${configPath}: expected a JSON object`);
  }

  const rawConfig = value as Record<string, unknown>;
  const chromeSection =
    typeof rawConfig.chrome === 'object' && rawConfig.chrome !== null && !Array.isArray(rawConfig.chrome)
      ? (rawConfig.chrome as Record<string, unknown>)
      : null;

  const profileDirectory =
    normalizeOptionalString(chromeSection?.profileDirectory)
    ?? normalizeOptionalString(rawConfig.profileDirectory)
    ?? normalizeOptionalString(rawConfig.chromeProfileDirectory)
    ?? DEFAULT_CHROME_PROFILE_DIRECTORY;

  const profileEmail =
    normalizeOptionalString(chromeSection?.profileEmail)
    ?? normalizeOptionalString(rawConfig.profileEmail)
    ?? normalizeOptionalString(rawConfig.chromeProfileEmail)
    ?? null;

  return {
    chromeProfileDirectory: profileDirectory,
    chromeProfileEmail: profileEmail,
  };
}

function createDefaultChromeControllerConfig(): ChromeControllerConfig {
  return {
    chromeProfileDirectory: DEFAULT_CHROME_PROFILE_DIRECTORY,
    chromeProfileEmail: null,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
