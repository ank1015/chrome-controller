import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  readChromeControllerConfig,
  writeChromeControllerConfig,
} from '../config.js';

import type { CliCommandResult, CliWritable } from '../types.js';

export interface ChromeProfileChoice {
  directory: string;
  displayName: string;
  email: string | null;
  isDefault: boolean;
  isLastUsed: boolean;
}

interface SetupArgs {
  help: boolean;
  profileQuery?: string;
}

interface SetupCommandDependencies {
  listProfiles?: (options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }) => Promise<ChromeProfileChoice[]>;
  promptForProfile?: (options: {
    profiles: ChromeProfileChoice[];
    currentProfileDirectory: string | null;
    output: CliWritable;
  }) => Promise<ChromeProfileChoice>;
  runInstaller?: (options: {
    profile: ChromeProfileChoice;
    output: CliWritable;
    errorOutput: CliWritable;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }) => Promise<void>;
  platform?: NodeJS.Platform;
  stdout?: CliWritable;
  stderr?: CliWritable;
}

export interface SetupCommandOptions extends SetupCommandDependencies {
  args: string[];
  json: boolean;
  env?: NodeJS.ProcessEnv;
}

interface ChromeLocalState {
  profile?: {
    last_used?: unknown;
    last_active_profiles?: unknown;
    info_cache?: Record<string, unknown>;
  };
}

export async function runSetupCommand(
  options: SetupCommandOptions
): Promise<CliCommandResult> {
  if (options.json) {
    throw new Error('`chrome-controller setup` does not support --json yet.');
  }

  const parsed = parseSetupArgs(options.args);
  if (parsed.help) {
    return {
      lines: createSetupHelpLines(),
    };
  }

  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('`chrome-controller setup` currently supports macOS and Windows only.');
  }

  const output = options.stdout ?? process.stdout;
  const errorOutput = options.stderr ?? process.stderr;
  const config = await readChromeControllerConfig(options.env);
  const profiles = await (options.listProfiles ?? listChromeProfiles)({
    env: options.env,
    platform,
  });

  if (profiles.length === 0) {
    throw new Error(
      'No Chrome profiles were found. Open Google Chrome once before running `chrome-controller setup`.'
    );
  }

  const selectedProfile = parsed.profileQuery
    ? resolveProfileQuery(parsed.profileQuery, profiles)
    : await (options.promptForProfile ?? promptForChromeProfile)({
        profiles,
        currentProfileDirectory: config.chromeProfileDirectory ?? null,
        output,
      });

  const configPath = await writeChromeControllerConfig(
    {
      chromeProfileDirectory: selectedProfile.directory,
      chromeProfileEmail: selectedProfile.email,
    },
    options.env
  );

  await (options.runInstaller ?? runSetupInstallerForPlatform)({
    profile: selectedProfile,
    output,
    errorOutput,
    env: options.env,
    platform,
  });

  return {
    data: {
      profileDirectory: selectedProfile.directory,
      profileName: selectedProfile.displayName,
      profileEmail: selectedProfile.email,
      configPath,
    },
    lines: [
      `Configured chrome-controller to use Chrome profile ${formatProfileSummary(selectedProfile)}`,
      `Saved config to ${configPath}`,
      'Setup complete. If Chrome was already open, the installer restarted it for the selected profile.',
    ],
  };
}

export async function listChromeProfiles(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
} = {}): Promise<ChromeProfileChoice[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('Chrome profile discovery is currently supported on macOS and Windows only.');
  }

  const localStatePath = getChromeLocalStatePath(options.env, platform);
  let raw: string;
  try {
    raw = await readFile(localStatePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  let parsed: ChromeLocalState;
  try {
    parsed = JSON.parse(raw) as ChromeLocalState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse Chrome Local State at ${localStatePath}: ${message}`);
  }

  const profile = parsed.profile ?? {};
  const infoCache =
    typeof profile.info_cache === 'object' && profile.info_cache !== null
      ? (profile.info_cache as Record<string, Record<string, unknown>>)
      : {};
  const lastUsed =
    typeof profile.last_used === 'string' && profile.last_used.trim().length > 0
      ? profile.last_used.trim()
      : null;

  const results = new Map<string, ChromeProfileChoice>();
  for (const [directory, metadata] of Object.entries(infoCache)) {
    const displayName = normalizeOptionalString(metadata.name)
      ?? normalizeOptionalString(metadata.user_name)
      ?? directory;
    const email = normalizeOptionalString(metadata.user_name);

    results.set(directory, {
      directory,
      displayName,
      email,
      isDefault: directory === 'Default',
      isLastUsed: directory === lastUsed,
    });
  }

  if (!results.has('Default')) {
    results.set('Default', {
      directory: 'Default',
      displayName: 'Default',
      email: null,
      isDefault: true,
      isLastUsed: lastUsed === 'Default',
    });
  }

  return [...results.values()].sort(compareChromeProfiles);
}

function compareChromeProfiles(left: ChromeProfileChoice, right: ChromeProfileChoice): number {
  if (left.isLastUsed !== right.isLastUsed) {
    return left.isLastUsed ? -1 : 1;
  }

  if (left.isDefault !== right.isDefault) {
    return left.isDefault ? -1 : 1;
  }

  return left.displayName.localeCompare(right.displayName);
}

async function promptForChromeProfile(options: {
  profiles: ChromeProfileChoice[];
  currentProfileDirectory: string | null;
  output: CliWritable;
}): Promise<ChromeProfileChoice> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Setup requires an interactive terminal. Re-run `chrome-controller setup` in a terminal, or pass `--profile <name-or-directory>`.'
    );
  }

  const defaultIndex = Math.max(
    0,
    options.profiles.findIndex((profile) => profile.directory === options.currentProfileDirectory)
  );
  const lines = ['Chrome profiles:', ''];
  for (const [index, profile] of options.profiles.entries()) {
    const markers: string[] = [];
    if (profile.isDefault) {
      markers.push('Default');
    }
    if (profile.directory === options.currentProfileDirectory) {
      markers.push('current');
    }
    if (profile.isLastUsed) {
      markers.push('last used');
    }

    const markerText = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
    const emailText = profile.email ? ` <${profile.email}>` : '';
    lines.push(
      `  ${index + 1}. ${profile.displayName} (${profile.directory})${emailText}${markerText}`
    );
  }
  lines.push('');
  options.output.write(`${lines.join('\n')}\n`);

  const promptLabel = `Select profile number [${defaultIndex + 1}]: `;
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const answer = (await readline.question(promptLabel)).trim();
      if (answer.length === 0) {
        return options.profiles[defaultIndex] as ChromeProfileChoice;
      }

      const numericChoice = Number.parseInt(answer, 10);
      if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= options.profiles.length) {
        return options.profiles[numericChoice - 1] as ChromeProfileChoice;
      }

      const matched = tryResolveProfileByText(answer, options.profiles);
      if (matched) {
        return matched;
      }

      options.output.write(
        `Invalid selection: ${answer}. Enter a profile number, profile directory, or display name.\n`
      );
    }
  } finally {
    readline.close();
  }
}

function resolveProfileQuery(
  query: string,
  profiles: ChromeProfileChoice[]
): ChromeProfileChoice {
  const profile = tryResolveProfileByText(query, profiles);
  if (profile) {
    return profile;
  }

  throw new Error(
    `Unknown Chrome profile ${JSON.stringify(query)}. Run \`chrome-controller setup\` without \`--profile\` to choose from the detected profiles.`
  );
}

function tryResolveProfileByText(
  query: string,
  profiles: ChromeProfileChoice[]
): ChromeProfileChoice | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  const exactMatch = profiles.find(
    (profile) =>
      profile.directory.toLowerCase() === normalizedQuery ||
      profile.displayName.toLowerCase() === normalizedQuery ||
      (profile.email ? profile.email.toLowerCase() === normalizedQuery : false)
  );
  if (exactMatch) {
    return exactMatch;
  }

  return (
    profiles.find(
      (profile) =>
        profile.directory.toLowerCase().includes(normalizedQuery) ||
        profile.displayName.toLowerCase().includes(normalizedQuery) ||
        (profile.email ? profile.email.toLowerCase().includes(normalizedQuery) : false)
    ) ?? null
  );
}

async function runMacSetupInstaller(options: {
  profile: ChromeProfileChoice;
  output: CliWritable;
  errorOutput: CliWritable;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'darwin') {
    throw new Error('The macOS setup installer can only run on macOS.');
  }

  const scriptPath = fileURLToPath(
    new URL('../../../install_ext_and_restart_chrome_mac.sh', import.meta.url)
  );
  try {
    await access(scriptPath);
  } catch {
    throw new Error(`Setup installer script not found: ${scriptPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', [scriptPath, options.profile.directory], {
      env: options.env ?? process.env,
      cwd: dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      options.output.write(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      options.errorOutput.write(String(chunk));
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Setup installer exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function runWindowsSetupInstaller(options: {
  profile: ChromeProfileChoice;
  output: CliWritable;
  errorOutput: CliWritable;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') {
    throw new Error('The Windows setup installer can only run on Windows.');
  }

  const scriptPath = fileURLToPath(
    new URL('../../../install_ext_and_restart_chrome_windows.ps1', import.meta.url)
  );
  try {
    await access(scriptPath);
  } catch {
    throw new Error(`Setup installer script not found: ${scriptPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        options.profile.directory,
      ],
      {
        env: options.env ?? process.env,
        cwd: dirname(scriptPath),
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    child.stdout.on('data', (chunk) => {
      options.output.write(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      options.errorOutput.write(String(chunk));
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Setup installer exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function runSetupInstallerForPlatform(options: {
  profile: ChromeProfileChoice;
  output: CliWritable;
  errorOutput: CliWritable;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<void> {
  const platform = options.platform ?? process.platform;

  if (platform === 'darwin') {
    await runMacSetupInstaller(options);
    return;
  }

  if (platform === 'win32') {
    await runWindowsSetupInstaller(options);
    return;
  }

  throw new Error('`chrome-controller setup` currently supports macOS and Windows only.');
}

function parseSetupArgs(args: string[]): SetupArgs {
  let help = false;
  let profileQuery: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h' || arg === 'help') {
      help = true;
      continue;
    }

    if (arg === '--profile') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --profile');
      }

      profileQuery = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      profileQuery = arg.slice('--profile='.length);
      continue;
    }

    throw new Error(`Unknown option for setup: ${arg}`);
  }

  return {
    help,
    profileQuery,
  };
}

function createSetupHelpLines(): string[] {
  return [
    'chrome-controller setup',
    '',
    'Detect a Chrome profile, save it to the central config, and install the extension/native host.',
    '',
    'Usage:',
    '  chrome-controller setup',
    '  chrome-controller setup --profile <name-or-directory>',
    '',
    'Notes:',
    '  Setup currently supports macOS and Windows.',
    '  Without --profile, setup lists detected Chrome profiles and prompts you to choose one.',
    '  The selected profile is saved to ~/.chrome-controller/config.json (or CHROME_CONTROLLER_HOME/config.json).',
    '  Setup then runs the platform-specific installer script to install the extension, register native messaging, and restart Chrome.',
  ];
}

function formatProfileSummary(profile: ChromeProfileChoice): string {
  const emailText = profile.email ? ` <${profile.email}>` : '';
  return `"${profile.displayName}" (${profile.directory})${emailText}`;
}

function getChromeLocalStatePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const home = env.HOME || homedir();

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Local State');
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State');
  }

  throw new Error(`Chrome Local State lookup is not supported on ${platform}`);
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
