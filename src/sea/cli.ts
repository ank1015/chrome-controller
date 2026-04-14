import { dirname } from 'node:path';

import { runCli } from '../native-cli/cli-core.js';
import { ensureChromeControllerRuntimeRoot } from '../native-cli/runtime-paths.js';

ensureChromeControllerRuntimeRoot(dirname(process.execPath));

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
