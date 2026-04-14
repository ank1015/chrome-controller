import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOutdir = join(packageDir, 'dist-sea', 'bundles');

const entryPoints = {
  cli: join(packageDir, 'src', 'sea', 'cli.ts'),
  host: join(packageDir, 'src', 'sea', 'host.ts'),
};

export async function bundleSeaRuntimes(options = {}) {
  const outdir = resolve(options.outdir ?? defaultOutdir);
  await mkdir(outdir, { recursive: true });

  const outputs = {};
  for (const [name, entryPoint] of Object.entries(entryPoints)) {
    const outfile = join(outdir, `${name}.bundle.cjs`);
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      legalComments: 'none',
      sourcemap: false,
    });
    outputs[name] = outfile;
  }

  return outputs;
}

function parseArgs(argv) {
  let outdir;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--outdir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --outdir');
      }
      outdir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--outdir=')) {
      outdir = arg.slice('--outdir='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { outdir };
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  const options = parseArgs(process.argv.slice(2));
  const outputs = await bundleSeaRuntimes(options);
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}
