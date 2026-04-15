import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCapturedOutput } from '../../helpers/io.js';
import {
  listChromeProfiles,
  runSetupCommand,
} from '../../../src/native-cli/commands/setup.js';
import { readChromeControllerConfig } from '../../../src/native-cli/config.js';

describe('chrome-controller setup', () => {
  let tempRoot: string;
  let tempHome: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'chrome-controller-setup-'));
    tempHome = join(tempRoot, 'controller-home');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lists Chrome profiles from Local State on macOS', async () => {
    const chromeDir = join(tempRoot, 'Library', 'Application Support', 'Google', 'Chrome');
    await mkdir(chromeDir, { recursive: true });
    await writeFile(
      join(chromeDir, 'Local State'),
      JSON.stringify({
        profile: {
          last_used: 'Profile 1',
          info_cache: {
            Default: {
              name: 'Personal',
            },
            'Profile 1': {
              name: 'Work',
              user_name: 'work@example.com',
            },
          },
        },
      }),
      'utf8'
    );

    const profiles = await listChromeProfiles({
      env: {
        ...process.env,
        HOME: tempRoot,
      },
      platform: 'darwin',
    });

    expect(profiles).toEqual([
      {
        directory: 'Profile 1',
        displayName: 'Work',
        email: 'work@example.com',
        isDefault: false,
        isLastUsed: true,
      },
      {
        directory: 'Default',
        displayName: 'Personal',
        email: null,
        isDefault: true,
        isLastUsed: false,
      },
    ]);
  });

  it('lists Chrome profiles from Local State on Windows', async () => {
    const chromeDir = join(tempRoot, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    await mkdir(chromeDir, { recursive: true });
    await writeFile(
      join(chromeDir, 'Local State'),
      JSON.stringify({
        profile: {
          last_used: 'Profile 2',
          info_cache: {
            Default: {
              name: 'Personal',
            },
            'Profile 2': {
              name: 'Work',
              user_name: 'work@example.com',
            },
          },
        },
      }),
      'utf8'
    );

    const profiles = await listChromeProfiles({
      env: {
        ...process.env,
        HOME: tempRoot,
        LOCALAPPDATA: join(tempRoot, 'AppData', 'Local'),
      },
      platform: 'win32',
    });

    expect(profiles).toEqual([
      {
        directory: 'Profile 2',
        displayName: 'Work',
        email: 'work@example.com',
        isDefault: false,
        isLastUsed: true,
      },
      {
        directory: 'Default',
        displayName: 'Personal',
        email: null,
        isDefault: true,
        isLastUsed: false,
      },
    ]);
  });

  it('writes the selected profile to config and runs the installer', async () => {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    const runInstaller = vi.fn(async () => {});

    const result = await runSetupCommand({
      args: [],
      json: false,
      env: {
        ...process.env,
        CHROME_CONTROLLER_HOME: tempHome,
      },
      platform: 'darwin',
      stdout: stdout.stream,
      stderr: stderr.stream,
      listProfiles: async () => [
        {
          directory: 'Default',
          displayName: 'Personal',
          email: null,
          isDefault: true,
          isLastUsed: true,
        },
        {
          directory: 'Profile 1',
          displayName: 'Work',
          email: 'work@example.com',
          isDefault: false,
          isLastUsed: false,
        },
      ],
      promptForProfile: async ({ profiles }) => profiles[1] as (typeof profiles)[number],
      runInstaller,
    });

    expect(runInstaller).toHaveBeenCalledWith({
      profile: {
        directory: 'Profile 1',
        displayName: 'Work',
        email: 'work@example.com',
        isDefault: false,
        isLastUsed: false,
      },
      output: stdout.stream,
      errorOutput: stderr.stream,
      env: {
        ...process.env,
        CHROME_CONTROLLER_HOME: tempHome,
      },
      platform: 'darwin',
    });

    expect(result.lines).toEqual([
      'Configured chrome-controller to use Chrome profile "Work" (Profile 1) <work@example.com>',
      `Saved config to ${join(tempHome, 'config.json')}`,
      'Setup complete. If Chrome was already open, the installer restarted it for the selected profile.',
    ]);

    const config = await readChromeControllerConfig({
      ...process.env,
      CHROME_CONTROLLER_HOME: tempHome,
    });
    expect(config).toEqual({
      chromeProfileDirectory: 'Profile 1',
      chromeProfileEmail: 'work@example.com',
    });
  });

  it('supports non-interactive setup with --profile', async () => {
    const runInstaller = vi.fn(async () => {});

    const result = await runSetupCommand({
      args: ['--profile', 'Work'],
      json: false,
      env: {
        ...process.env,
        CHROME_CONTROLLER_HOME: tempHome,
      },
      platform: 'darwin',
      listProfiles: async () => [
        {
          directory: 'Default',
          displayName: 'Personal',
          email: null,
          isDefault: true,
          isLastUsed: false,
        },
        {
          directory: 'Profile 1',
          displayName: 'Work',
          email: 'work@example.com',
          isDefault: false,
          isLastUsed: true,
        },
      ],
      runInstaller,
    });

    expect(runInstaller).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      profileDirectory: 'Profile 1',
      profileName: 'Work',
      profileEmail: 'work@example.com',
    });
  });

  it('supports Windows setup with --profile', async () => {
    const runInstaller = vi.fn(async () => {});

    const result = await runSetupCommand({
      args: ['--profile', 'Profile 2'],
      json: false,
      env: {
        ...process.env,
        CHROME_CONTROLLER_HOME: tempHome,
      },
      platform: 'win32',
      listProfiles: async () => [
        {
          directory: 'Default',
          displayName: 'Personal',
          email: null,
          isDefault: true,
          isLastUsed: false,
        },
        {
          directory: 'Profile 2',
          displayName: 'Work',
          email: 'work@example.com',
          isDefault: false,
          isLastUsed: true,
        },
      ],
      runInstaller,
    });

    expect(runInstaller).toHaveBeenCalledWith({
      profile: {
        directory: 'Profile 2',
        displayName: 'Work',
        email: 'work@example.com',
        isDefault: false,
        isLastUsed: true,
      },
      output: process.stdout,
      errorOutput: process.stderr,
      env: {
        ...process.env,
        CHROME_CONTROLLER_HOME: tempHome,
      },
      platform: 'win32',
    });
    expect(result.data).toMatchObject({
      profileDirectory: 'Profile 2',
      profileName: 'Work',
      profileEmail: 'work@example.com',
    });
  });
});
