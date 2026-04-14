import { exec } from 'node:child_process';

import { readChromeControllerConfig } from './config.js';

import type { ChromeControllerConfig } from './config.js';

export async function launchChrome(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  } = {}
): Promise<void> {
  const config = await readChromeControllerConfig(options.env);
  const commands = getChromeLaunchCommands(options.platform ?? process.platform, config);
  if (commands.length === 0) {
    throw new Error(`Auto-launch is not supported on ${options.platform ?? process.platform}`);
  }

  await tryLaunchCommands(commands);
}

export function getChromeLaunchCommands(
  platform: NodeJS.Platform,
  config: ChromeControllerConfig
): string[] {
  const profileArgument = getProfileLaunchArgument(platform, config);

  if (platform === 'darwin') {
    return [
      `open -g -a "Google Chrome" --args ${profileArgument}`,
      `open -g -a "Chromium" --args ${profileArgument}`,
    ];
  }

  if (platform === 'linux') {
    return [
      `google-chrome ${profileArgument} &`,
      `google-chrome-stable ${profileArgument} &`,
      `chromium ${profileArgument} &`,
      `chromium-browser ${profileArgument} &`,
    ];
  }

  if (platform === 'win32') {
    return [
      `start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" ${profileArgument}`,
      `start "" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" ${profileArgument}`,
      `start "" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" ${profileArgument}`,
    ];
  }

  return [];
}

function getProfileLaunchArgument(
  platform: NodeJS.Platform,
  config: ChromeControllerConfig
): string {
  if (platform === 'win32' && config.chromeProfileEmail) {
    return `--profile-email=${quoteCommandValue(config.chromeProfileEmail)}`;
  }

  return `--profile-directory=${quoteCommandValue(config.chromeProfileDirectory)}`;
}

function quoteCommandValue(value: string): string {
  return JSON.stringify(value);
}

async function tryLaunchCommands(commands: string[]): Promise<void> {
  const failures: string[] = [];

  for (const command of commands) {
    try {
      await execCommand(command);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${command}: ${message}`);
    }
  }

  throw new Error(`Failed to launch Chrome: ${failures.join(' | ')}`);
}

function execCommand(command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    exec(command, { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
