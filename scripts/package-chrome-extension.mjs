import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = join(packageDir, 'dist', 'chrome');
const manifestPath = join(extensionDir, 'manifest.json');
const artifactsDir = join(packageDir, 'artifacts');

const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
const baseName = `${manifest.name}-chrome-webstore-v${manifest.version}`.replace(
  /[^a-z0-9._-]+/gi,
  '-'
);
const zipPath = join(artifactsDir, `${baseName}.zip`);

await mkdir(artifactsDir, { recursive: true });
await rm(zipPath, { force: true });

const entries = (await readdir(extensionDir)).filter((entry) => !entry.startsWith('.')).sort();

const result = spawnSync('zip', ['-r', '-q', '-X', zipPath, ...entries], {
  cwd: extensionDir,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`zip exited with status ${result.status ?? 'unknown'}`);
}

process.stdout.write(`Created Chrome Web Store package: ${zipPath}\n`);
