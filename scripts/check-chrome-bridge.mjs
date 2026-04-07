#!/usr/bin/env node

import { createServer } from 'node:http';

import { connectWeb } from '../dist/index.js';

const DEFAULT_TIMEOUT_MS = 15_000;

function buildDataUrl(title, bodyText) {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <main id="app">${bodyText}</main>
  </body>
</html>`)
  );
}

const BOOTSTRAP_URL = buildDataUrl(
  'ank1015 chrome bridge bootstrap',
  'bootstrap bridge check ready'
);

function printHelp() {
  process.stdout.write(`Chrome bridge integration check

Usage:
  node ./scripts/check-chrome-bridge.mjs [--url <target-url>] [--timeout-ms <ms>] [--keep-tab] [--json]

Options:
  --url <target-url>    Optional URL to navigate the temp tab to after bootstrap.
                        Defaults to a local http://127.0.0.1 fixture page so host permissions
                        and scripting are exercised without relying on the public internet.
  --timeout-ms <ms>     Max wait time for load and wait checks. Default: ${DEFAULT_TIMEOUT_MS}
  --keep-tab            Leave the temp tab open after the test completes.
  --json                Print only the JSON report.
  --help, -h            Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    url: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepTab: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--keep-tab') {
      options.keepTab = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--url') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --url');
      }
      options.url = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
      continue;
    }

    if (arg === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --timeout-ms');
      }
      const timeoutMs = Number.parseInt(value, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${value}`);
      }
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      const value = arg.slice('--timeout-ms='.length);
      const timeoutMs = Number.parseInt(value, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${value}`);
      }
      options.timeoutMs = timeoutMs;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function summarizeTab(tab) {
  return {
    id: typeof tab?.id === 'number' ? tab.id : null,
    windowId: typeof tab?.windowId === 'number' ? tab.windowId : null,
    active: typeof tab?.active === 'boolean' ? tab.active : null,
    status: typeof tab?.status === 'string' ? tab.status : null,
    title: typeof tab?.title === 'string' ? tab.title : null,
    url: typeof tab?.url === 'string' ? tab.url : null,
  };
}

function normalizeScriptResult(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return { frameCount: 0, result: null };
  }

  const first = results[0];
  return {
    frameCount: results.length,
    frameId: typeof first?.frameId === 'number' ? first.frameId : null,
    documentId: typeof first?.documentId === 'string' ? first.documentId : null,
    result: first?.result ?? null,
  };
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function startLocalTargetServer() {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ank1015 chrome bridge target</title>
  </head>
  <body>
    <main id="app">target bridge check ready</main>
  </body>
</html>`;

  const server = createServer((request, response) => {
    if (!request.url || request.url === '/bridge-check') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      });
      response.end(html);
      return;
    }

    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
    });
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine local target server address');
  }

  return {
    url: `http://127.0.0.1:${address.port}/bridge-check`,
    async close() {
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function getUrlExpectation(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  if (url.startsWith('data:')) {
    return 'data:';
  }

  return url;
}

async function runStep(report, name, fn) {
  const startedAt = Date.now();

  try {
    const data = await fn();
    report.steps.push({
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      data,
    });
    return data;
  } catch (error) {
    report.steps.push({
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    });
    throw error;
  }
}

function printTextReport(report) {
  process.stdout.write(`Chrome bridge integration check
Target URL: ${report.targetUrl}
Checked at: ${report.checkedAt}

`);

  for (const step of report.steps) {
    process.stdout.write(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} (${step.durationMs}ms)\n`);
    if (step.ok) {
      process.stdout.write(`  ${JSON.stringify(step.data)}\n`);
    } else {
      process.stdout.write(`  ${step.error}\n`);
    }
  }

  process.stdout.write(`
Result: ${report.ok ? 'PASS' : 'FAIL'}
Temp tab id: ${report.tempTabId ?? 'n/a'}
Temp tab cleaned up: ${report.cleanedUp ? 'yes' : 'no'}
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const localTargetServer = options.url ? null : await startLocalTargetServer();
  const targetUrl = options.url ?? localTargetServer.url;
  const browser = await connectWeb({ launch: false });

  const report = {
    ok: false,
    targetUrl,
    checkedAt: new Date().toISOString(),
    tempTabId: null,
    cleanedUp: false,
    steps: [],
  };

  let tempTab = null;

  try {
    await runStep(report, 'runtime.getPlatformInfo', async () => {
      const platform = await browser.chrome('runtime.getPlatformInfo');
      return {
        arch: platform?.arch ?? null,
        naclArch: platform?.nacl_arch ?? null,
        os: platform?.os ?? null,
      };
    });

    await runStep(report, 'windows.getLastFocused', async () => {
      const windowInfo = await browser.chrome('windows.getLastFocused');
      return {
        id: typeof windowInfo?.id === 'number' ? windowInfo.id : null,
        focused: typeof windowInfo?.focused === 'boolean' ? windowInfo.focused : null,
        state: typeof windowInfo?.state === 'string' ? windowInfo.state : null,
      };
    });

    await runStep(report, 'tabs.query active window', async () => {
      const tabs = await browser.chrome('tabs.query', {
        active: true,
        lastFocusedWindow: true,
      });

      return {
        count: Array.isArray(tabs) ? tabs.length : 0,
        tabIds: Array.isArray(tabs)
          ? tabs.map((tab) => (typeof tab?.id === 'number' ? tab.id : null))
          : [],
      };
    });

    await runStep(report, 'web.openTab bootstrap', async () => {
      tempTab = await browser.openTab(BOOTSTRAP_URL, { active: false });
      report.tempTabId = tempTab.id;
      const info = await tempTab.waitForLoad({ timeoutMs: options.timeoutMs });
      return summarizeTab(info);
    });

    await runStep(report, 'tabs.get bootstrap', async () => {
      const tab = await browser.chrome('tabs.get', tempTab.id);
      return summarizeTab(tab);
    });

    await runStep(report, 'web.waitFor bootstrap text', async () => {
      await tempTab.waitFor({
        text: 'bootstrap bridge check ready',
        timeoutMs: options.timeoutMs,
      });
      return { text: 'bootstrap bridge check ready' };
    });

    await runStep(report, 'web.goto target', async () => {
      await tempTab.goto(targetUrl, { active: false });
      await tempTab.waitForLoad({ timeoutMs: options.timeoutMs });
      await tempTab.waitFor({
        urlIncludes: getUrlExpectation(targetUrl),
        timeoutMs: options.timeoutMs,
      });
      const info = await tempTab.info();
      return summarizeTab(info);
    });

    await runStep(report, 'scripting.executeScript', async () => {
      const results = await browser.chrome('scripting.executeScript', {
        target: { tabId: tempTab.id },
        code: `(() => {
          document.body.dataset.bridgeScript = 'ok';
          return {
            title: document.title,
            href: location.href,
            marker: document.body.dataset.bridgeScript,
            readyState: document.readyState
          };
        })()`,
      });

      const summary = normalizeScriptResult(results);
      if (summary.result?.marker !== 'ok') {
        throw new Error('scripting.executeScript did not set the expected marker');
      }

      return summary;
    });

    await runStep(report, 'debugger.evaluate', async () => {
      const evaluation = await tempTab.evaluate(`({
        title: document.title,
        href: location.href,
        marker: document.body?.dataset?.bridgeScript ?? '',
        readyState: document.readyState,
        bodyText: document.body?.innerText?.trim() ?? ''
      })`);

      if (evaluation?.marker !== 'ok') {
        throw new Error('debugger.evaluate could not read the scripting marker');
      }

      if (evaluation?.readyState !== 'complete') {
        throw new Error(`Unexpected readyState from debugger.evaluate: ${evaluation?.readyState}`);
      }

      return evaluation;
    });

    await runStep(report, 'downloads.search', async () => {
      const downloads = await browser.chrome('downloads.search', {});
      return {
        count: Array.isArray(downloads) ? downloads.length : 0,
      };
    });

    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = serializeError(error);
  } finally {
    if (tempTab && !options.keepTab) {
      try {
        await tempTab.close();
        report.cleanedUp = true;
      } catch {
        report.cleanedUp = false;
      }
    }

    await browser.close();

    if (localTargetServer) {
      await localTargetServer.close();
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printTextReport(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
