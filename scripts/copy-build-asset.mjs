import { chmod, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2];

const assets = {
  chrome: {
    from: join(packageDir, 'src', 'chrome', 'manifest.json'),
    to: join(packageDir, 'dist', 'chrome', 'manifest.json'),
  },
  native: {
    from: join(packageDir, 'src', 'native', 'host-wrapper.sh'),
    to: join(packageDir, 'dist', 'native', 'host-wrapper.sh'),
    mode: 0o755,
  },
};

const asset = assets[target];

if (!asset) {
  throw new Error(`Unknown build asset target: ${target ?? '<missing>'}`);
}

await mkdir(dirname(asset.to), { recursive: true });
await cp(asset.from, asset.to);

if ('mode' in asset) {
  await chmod(asset.to, asset.mode);
}
