import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getChromeControllerConfigPath,
  normalizeChromeControllerConfig,
  readChromeControllerConfig,
} from '../../../src/native-cli/config.js';

describe('chrome-controller config', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-config-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('defaults to the Default profile when the config file is missing', async () => {
    const config = await readChromeControllerConfig({
      ...process.env,
      CHROME_CONTROLLER_HOME: tempHome,
    });

    expect(config).toEqual({
      chromeProfileDirectory: 'Default',
      chromeProfileEmail: null,
    });
  });

  it('reads nested chrome profile settings from config.json', async () => {
    const configPath = getChromeControllerConfigPath({
      ...process.env,
      CHROME_CONTROLLER_HOME: tempHome,
    });
    await writeFile(
      configPath,
      `${JSON.stringify({
        chrome: {
          profileDirectory: 'Profile 1',
          profileEmail: 'agent@example.com',
        },
      }, null, 2)}\n`,
      'utf8'
    );

    const config = await readChromeControllerConfig({
      ...process.env,
      CHROME_CONTROLLER_HOME: tempHome,
    });

    expect(config).toEqual({
      chromeProfileDirectory: 'Profile 1',
      chromeProfileEmail: 'agent@example.com',
    });
  });

  it('accepts top-level profile settings for compatibility', () => {
    expect(
      normalizeChromeControllerConfig({
        chromeProfileDirectory: 'Profile 2',
        chromeProfileEmail: 'operator@example.com',
      })
    ).toEqual({
      chromeProfileDirectory: 'Profile 2',
      chromeProfileEmail: 'operator@example.com',
    });
  });
});
