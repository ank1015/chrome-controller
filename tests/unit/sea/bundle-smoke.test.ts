import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';

const execFileAsync = promisify(execFile);

describe('SEA bundle smoke tests', () => {
  let outdir: string;

  beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), 'chrome-controller-sea-bundles-'));
    const { bundleSeaRuntimes } = await import('../../../scripts/build-sea-bundles.mjs');
    await bundleSeaRuntimes({ outdir });
  }, 30_000);

  afterAll(async () => {
    if (outdir) {
      await rm(outdir, { recursive: true, force: true });
    }
  });

  it('runs the bundled CLI entrypoint', async () => {
    const { stdout } = await execFileAsync(process.execPath, [join(outdir, 'cli.bundle.cjs'), 'help']);

    expect(stdout).toContain('chrome-controller');
    expect(stdout).toContain('setup');
  });

  it('starts and exits the bundled native host entrypoint', async () => {
    const child = spawn(process.execPath, [join(outdir, 'host.bundle.cjs')], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.end();

    const [exitCode] = await once(child, 'close');

    expect(exitCode).toBe(0);
    expect(stderr).toContain('[host] started');
  });
});
