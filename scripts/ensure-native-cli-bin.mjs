import { chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageDir, 'dist', 'native-cli', 'cli.js');

await chmod(cliPath, 0o755);
