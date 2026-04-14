#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCli } from './cli-core.js';
import { ensureChromeControllerRuntimeRoot } from './runtime-paths.js';

export { runCli } from './cli-core.js';

ensureChromeControllerRuntimeRoot(fileURLToPath(new URL('../../', import.meta.url)));

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
    const invokedPath = realpathSync(process.argv[1]);
    return currentModulePath === invokedPath;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectRun()) {
  runCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  );
}
