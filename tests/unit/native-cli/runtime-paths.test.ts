import { join } from 'node:path';

import {
  CHROME_CONTROLLER_RUNTIME_ROOT_ENV,
  ensureChromeControllerRuntimeRoot,
  getChromeControllerCliBinaryName,
  getChromeControllerHostBinaryName,
  resolveSetupInstallerPath,
  resolveStandaloneHostExecutablePath,
} from '../../../src/native-cli/runtime-paths.js';

describe('native-cli runtime paths', () => {
  it('resolves setup installers from the standalone runtime root when present', () => {
    const env = {
      ...process.env,
      [CHROME_CONTROLLER_RUNTIME_ROOT_ENV]: '/tmp/chrome-controller-release',
    };

    expect(resolveSetupInstallerPath({ platform: 'darwin', env })).toBe(
      '/tmp/chrome-controller-release/install_ext_and_restart_chrome_mac.sh'
    );
    expect(resolveSetupInstallerPath({ platform: 'win32', env })).toBe(
      '/tmp/chrome-controller-release/install_ext_and_restart_chrome_windows.ps1'
    );
  });

  it('uses the configured runtime root for npm/dev installs too', () => {
    const env = {
      ...process.env,
    };
    ensureChromeControllerRuntimeRoot('/tmp/chrome-controller-package', env);

    expect(resolveSetupInstallerPath({ platform: 'darwin', env })).toBe(
      '/tmp/chrome-controller-package/install_ext_and_restart_chrome_mac.sh'
    );
    expect(resolveSetupInstallerPath({ platform: 'win32', env })).toBe(
      '/tmp/chrome-controller-package/install_ext_and_restart_chrome_windows.ps1'
    );
  });

  it('derives standalone host executable paths from the runtime root', () => {
    const env = {
      ...process.env,
      [CHROME_CONTROLLER_RUNTIME_ROOT_ENV]: join('/tmp', 'chrome-controller-release'),
    };

    expect(resolveStandaloneHostExecutablePath({ platform: 'darwin', env })).toBe(
      '/tmp/chrome-controller-release/chrome-controller-host'
    );
    expect(resolveStandaloneHostExecutablePath({ platform: 'win32', env })).toBe(
      '/tmp/chrome-controller-release/chrome-controller-host.exe'
    );
  });

  it('returns the release binary names for CLI and host', () => {
    expect(getChromeControllerCliBinaryName('darwin')).toBe('chrome-controller');
    expect(getChromeControllerCliBinaryName('win32')).toBe('chrome-controller.exe');
    expect(getChromeControllerHostBinaryName('darwin')).toBe('chrome-controller-host');
    expect(getChromeControllerHostBinaryName('win32')).toBe('chrome-controller-host.exe');
  });
});
