import { dirname } from 'node:path';

import { CHROME_CONTROLLER_RUNTIME_ROOT_ENV } from '../native-cli/runtime-paths.js';
import { startNativeHost } from '../native/host-runtime.js';

process.env[CHROME_CONTROLLER_RUNTIME_ROOT_ENV] ??= dirname(process.execPath);

startNativeHost();
