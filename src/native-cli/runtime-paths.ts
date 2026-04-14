import { join } from 'node:path';

export const CHROME_CONTROLLER_RUNTIME_ROOT_ENV = 'CHROME_CONTROLLER_RUNTIME_ROOT';

export function getChromeControllerRuntimeRoot(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const value = env[CHROME_CONTROLLER_RUNTIME_ROOT_ENV];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getChromeControllerHostBinaryName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? 'chrome-controller-host.exe' : 'chrome-controller-host';
}

export function getChromeControllerCliBinaryName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? 'chrome-controller.exe' : 'chrome-controller';
}

export function getSetupInstallerFilename(
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'darwin') {
    return 'install_ext_and_restart_chrome_mac.sh';
  }

  if (platform === 'win32') {
    return 'install_ext_and_restart_chrome_windows.ps1';
  }

  throw new Error('Standalone setup installers are currently supported on macOS and Windows only.');
}

export function resolveSetupInstallerPath(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): string {
  const platform = options.platform ?? process.platform;
  const installerFilename = getSetupInstallerFilename(platform);
  const runtimeRoot = getChromeControllerRuntimeRoot(options.env);

  if (!runtimeRoot) {
    throw new Error(
      `Missing ${CHROME_CONTROLLER_RUNTIME_ROOT_ENV}. The CLI runtime root must be configured before running setup.`
    );
  }

  return join(runtimeRoot, installerFilename);
}

export function ensureChromeControllerRuntimeRoot(
  runtimeRoot: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!env[CHROME_CONTROLLER_RUNTIME_ROOT_ENV]) {
    env[CHROME_CONTROLLER_RUNTIME_ROOT_ENV] = runtimeRoot;
  }
}

export function resolveStandaloneHostExecutablePath(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const runtimeRoot = getChromeControllerRuntimeRoot(options.env);
  if (!runtimeRoot) {
    return null;
  }

  return join(runtimeRoot, getChromeControllerHostBinaryName(options.platform));
}
