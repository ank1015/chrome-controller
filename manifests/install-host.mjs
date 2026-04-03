import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function printUsage() {
  console.log(`Usage: node manifests/install-host.mjs [extension-id] [--chrome-profile <name>]

Installs the Chrome native messaging host for the current OS.

Arguments:
  extension-id              Chrome extension ID. Required on macOS/Linux.
  --chrome-profile <name>   Windows-only Chrome profile name for extension auto-detection.
                            Defaults to "Default".
`);
}

const args = process.argv.slice(2);

let extensionId;
let chromeProfile = 'Default';

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }

  if (arg === '--chrome-profile') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --chrome-profile');
      process.exit(1);
    }

    chromeProfile = value;
    i += 1;
    continue;
  }

  if (arg.startsWith('--chrome-profile=')) {
    chromeProfile = arg.slice('--chrome-profile='.length);
    continue;
  }

  if (arg.startsWith('-')) {
    console.error(`Unknown option: ${arg}`);
    printUsage();
    process.exit(1);
  }

  if (extensionId) {
    console.error(`Unexpected extra argument: ${arg}`);
    printUsage();
    process.exit(1);
  }

  extensionId = arg;
}

const manifestsDir = dirname(fileURLToPath(import.meta.url));

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

if (process.platform === 'win32') {
  const scriptPath = join(manifestsDir, 'windows', 'install-host-windows.ps1');
  const commandArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ChromeProfile',
    chromeProfile,
  ];

  if (extensionId) {
    commandArgs.push('-ExtensionId', extensionId);
  }

  run('powershell.exe', commandArgs);
} else {
  if (!extensionId) {
    console.error('extension-id is required on macOS/Linux.');
    printUsage();
    process.exit(1);
  }

  const scriptPath = join(manifestsDir, 'unix', 'install-host.sh');
  run('bash', [scriptPath, extensionId]);
}
