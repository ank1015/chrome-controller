import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

await Promise.all([
  rm(join(packageDir, 'dist'), { recursive: true, force: true }),
  rm(join(packageDir, 'dist-sea'), { recursive: true, force: true }),
  rm(join(packageDir, 'artifacts'), { recursive: true, force: true }),
  rm(join(packageDir, 'coverage'), { recursive: true, force: true }),
]);

const entries = await readdir(packageDir);

await Promise.all(
  entries
    .filter((entry) => entry.endsWith('.tsbuildinfo'))
    .map((entry) => rm(join(packageDir, entry), { force: true }))
);
