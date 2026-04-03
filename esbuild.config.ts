import { mkdirSync } from 'node:fs';

import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/chrome/background.ts'],
  bundle: true,
  format: 'esm' as const,
  platform: 'browser' as const,
  outdir: 'dist/chrome',
  target: 'chrome120',
  logLevel: 'info' as const,
  logOverride: {
    'direct-eval': 'silent' as const,
  },
};

async function main(): Promise<void> {
  mkdirSync('dist/chrome', { recursive: true });

  if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.warn('[esbuild] watching for changes...');
  } else {
    await build(buildOptions);
  }
}

main();
