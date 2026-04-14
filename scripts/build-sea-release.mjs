import { access, chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { bundleSeaRuntimes } from './build-sea-bundles.mjs';

const execFileAsync = promisify(execFile);
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pinnedNodeVersion = '22.22.2';
const seaResourceName = 'NODE_SEA_BLOB';
const seaSentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const targets = {
  'windows-x64': {
    platform: 'win32',
    arch: 'x64',
    cliBinary: 'chrome-controller.exe',
    hostBinary: 'chrome-controller-host.exe',
    installerScript: 'install_ext_and_restart_chrome_windows.ps1',
  },
  'macos-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    cliBinary: 'chrome-controller',
    hostBinary: 'chrome-controller-host',
    installerScript: 'install_ext_and_restart_chrome_mac.sh',
  },
};

export async function buildStandaloneRelease(options) {
  const target = options?.target;
  if (!target || !(target in targets)) {
    throw new Error(
      `Unknown or missing --platform target. Supported targets: ${Object.keys(targets).join(', ')}`
    );
  }

  const targetInfo = targets[target];
  assertPinnedSeaNodeVersion();
  assertLocalPlatform(target, targetInfo);

  const bundles = await bundleSeaRuntimes({
    outdir: join(packageDir, 'dist-sea', 'bundles'),
  });

  const workDir = join(packageDir, 'dist-sea', 'work', target);
  const releaseDir = join(packageDir, 'dist-sea', 'release', target);
  await rm(workDir, { recursive: true, force: true });
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(releaseDir, { recursive: true });

  await buildBinary({
    bundlePath: bundles.cli,
    binaryName: targetInfo.cliBinary,
    targetInfo,
    workDir,
    releaseDir,
  });
  await buildBinary({
    bundlePath: bundles.host,
    binaryName: targetInfo.hostBinary,
    targetInfo,
    workDir,
    releaseDir,
  });

  const installerSource = join(packageDir, targetInfo.installerScript);
  const installerDest = join(releaseDir, targetInfo.installerScript);
  await copyFile(installerSource, installerDest);
  if (targetInfo.platform !== 'win32') {
    await chmod(installerDest, 0o755);
  }

  await writeFile(join(releaseDir, 'README.txt'), createReleaseReadme(target, targetInfo), 'utf8');

  return {
    target,
    releaseDir,
  };
}

async function buildBinary(options) {
  const nameWithoutExtension = options.binaryName.replace(/\.exe$/u, '');
  const configPath = join(options.workDir, `${nameWithoutExtension}.sea-config.json`);
  const blobPath = join(options.workDir, `${nameWithoutExtension}.blob`);
  const destBinary = join(options.releaseDir, options.binaryName);

  const config = {
    main: options.bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    mainFormat: 'commonjs',
    execArgvExtension: 'none',
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  await execFileAsync(process.execPath, ['--experimental-sea-config', configPath], {
    cwd: packageDir,
  });

  await copyFile(process.execPath, destBinary);
  if (options.targetInfo.platform !== 'win32') {
    await chmod(destBinary, 0o755);
    await removeExistingSignature(destBinary);
  }

  await injectSeaBlob(destBinary, blobPath, options.targetInfo);

  if (options.targetInfo.platform === 'darwin') {
    await execFileAsync('codesign', ['--force', '--sign', '-', destBinary], {
      cwd: packageDir,
    });
  }
}

async function injectSeaBlob(binaryPath, blobPath, targetInfo) {
  const postjectBinary = join(
    packageDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'postject.cmd' : 'postject'
  );
  await access(postjectBinary, fsConstants.X_OK).catch(async () => {
    const statMode = targetInfo.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK;
    await access(postjectBinary, statMode);
  });

  const args = [
    binaryPath,
    seaResourceName,
    blobPath,
    '--sentinel-fuse',
    seaSentinelFuse,
  ];
  if (targetInfo.platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA');
  }

  await execFileAsync(postjectBinary, args, {
    cwd: packageDir,
    shell: targetInfo.platform === 'win32',
  });
}

async function removeExistingSignature(binaryPath) {
  try {
    await execFileAsync('codesign', ['--remove-signature', binaryPath], {
      cwd: packageDir,
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    if (!message.includes('code object is not signed at all')) {
      throw error;
    }
  }
}

function assertPinnedSeaNodeVersion() {
  if (process.versions.node !== pinnedNodeVersion) {
    throw new Error(
      `SEA builds require Node ${pinnedNodeVersion}. Current runtime is ${process.versions.node}.`
    );
  }
}

function assertLocalPlatform(target, targetInfo) {
  if (process.platform !== targetInfo.platform || process.arch !== targetInfo.arch) {
    throw new Error(
      `Target ${target} must be built on ${targetInfo.platform}-${targetInfo.arch}. ` +
        `Current runtime is ${process.platform}-${process.arch}.`
    );
  }
}

function createReleaseReadme(target, targetInfo) {
  const executable = targetInfo.cliBinary;
  return [
    `chrome-controller standalone release: ${target}`,
    '',
    'Contents:',
    `- ${targetInfo.cliBinary}`,
    `- ${targetInfo.hostBinary}`,
    `- ${targetInfo.installerScript}`,
    '',
    'First run:',
    `1. Unzip this folder somewhere permanent.`,
    `2. Run \`${executable} setup\` from this directory.`,
    '3. Choose the Chrome profile that should host the extension/native messaging bridge.',
    '',
    'Notes:',
    '- The CLI and native host are standalone binaries in this release.',
    '- The Chrome extension is installed from the Chrome Web Store during setup.',
    '- The SDK remains npm-only and is not included in this standalone release.',
  ].join('\n');
}

function extractErrorMessage(error) {
  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    return error.stderr;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseArgs(argv) {
  let target;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --platform');
      }
      target = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--platform=')) {
      target = arg.slice('--platform='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { target };
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildStandaloneRelease(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
