import { createServer } from 'node:http';

import { connectChromeController } from '../../../src/sdk/index.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CliDebuggerEvent } from '../../../src/native-cli/types.js';

const runLiveSdkTests = process.env.CHROME_CONTROLLER_RUN_LIVE_SDK_TESTS === '1';
const describeLive = runLiveSdkTests ? describe : describe.skip;
const DEFAULT_TIMEOUT_MS = 20_000;

describeLive('live sdk controller', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? '/';

      if (path === '/page-one') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(buildPageHtml('SDK Live One', 'one', 'First page'));
        return;
      }

      if (path === '/page-two') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(buildPageHtml('SDK Live Two', 'two', 'Second page'));
        return;
      }

      response.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('not found');
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve live SDK test server address');
    }

    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it(
    'connects to the real bridge, evaluates a page, subscribes to tab updates, and captures debugger events',
    async () => {
      const controller = await connectChromeController();
      const tabUpdates: unknown[] = [];
      const unsubscribe = controller.subscribe<unknown[]>(
        'tabs.onUpdated',
        (eventArgs) => {
          tabUpdates.push(eventArgs);
        }
      );

      let tabId: number | null = null;

      try {
        const openedTab = await controller.call<{ id?: unknown }>('tabs.create', {
          url: `${baseUrl}/page-one`,
          active: false,
        });
        tabId = asRequiredTabId(openedTab.id);

        await waitForTabCompletion(controller, tabId, '/page-one');
        await waitForCondition(
          () => hasTabUpdateEvent(tabUpdates, tabId as number),
          'Timed out waiting for tabs.onUpdated event for the created tab'
        );

        const title = await controller.evaluate<string>(tabId, 'document.title');
        expect(title).toBe('SDK Live One');

        const marker = await controller.evaluate<string>(
          tabId,
          `(() => {
            window.__sdkMarker = 'marker:' + document.body.dataset.page;
            return window.__sdkMarker;
          })()`
        );
        expect(marker).toBe('marker:one');

        const debuggerSession = await controller.debugger.attach(tabId);
        expect(debuggerSession.tabId).toBe(tabId);

        await debuggerSession.send('Network.enable');
        await debuggerSession.send('Page.enable');
        await debuggerSession.getEvents({ filter: 'Network.', clear: true });

        const runtimeResult = await debuggerSession.send<{
          result?: { value?: unknown };
        }>('Runtime.evaluate', {
          expression: 'document.body.dataset.page',
          returnByValue: true,
        });
        expect(runtimeResult.result?.value).toBe('one');

        await controller.call('tabs.update', tabId, {
          url: `${baseUrl}/page-two`,
        });
        await waitForTabCompletion(controller, tabId, '/page-two');

        const updatedTitle = await controller.evaluate<string>(tabId, 'document.title');
        expect(updatedTitle).toBe('SDK Live Two');

        await waitForCondition(
          async () => {
            const events = await debuggerSession.getEvents({ filter: 'Network.' });
            return hasNetworkRequestForPath(events, '/page-two');
          },
          'Timed out waiting for debugger network events after navigation'
        );

        const events = await debuggerSession.getEvents({ filter: 'Network.' });
        expect(hasNetworkRequestForPath(events, '/page-two')).toBe(true);

        await debuggerSession.detach();
      } finally {
        unsubscribe();

        if (tabId !== null) {
          await controller.call('tabs.remove', tabId).catch(() => undefined);
        }

        await controller.close();
      }
    },
    90_000
  );
});

function buildPageHtml(title: string, pageId: string, heading: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body data-page="${pageId}">
    <main>
      <h1>${heading}</h1>
      <button id="action">Action</button>
    </main>
  </body>
</html>`;
}

async function waitForTabCompletion(
  controller: Awaited<ReturnType<typeof connectChromeController>>,
  tabId: number,
  pathSuffix: string
): Promise<void> {
  await waitForCondition(
    async () => {
      const tab = await controller.call<{
        status?: unknown;
        url?: unknown;
      }>('tabs.get', tabId);

      return (
        tab.status === 'complete' &&
        typeof tab.url === 'string' &&
        tab.url.includes(pathSuffix)
      );
    },
    `Timed out waiting for tab ${tabId} to load ${pathSuffix}`
  );
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMessage: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await sleep(pollMs);
  }

  throw new Error(timeoutMessage);
}

function hasTabUpdateEvent(events: unknown[], tabId: number): boolean {
  return events.some((event) => {
    if (!Array.isArray(event) || event.length === 0) {
      return false;
    }

    return event[0] === tabId;
  });
}

function hasNetworkRequestForPath(events: CliDebuggerEvent[], pathSuffix: string): boolean {
  return events.some((event) => {
    if (event.method !== 'Network.requestWillBeSent') {
      return false;
    }

    const params = event.params as {
      request?: {
        url?: unknown;
      };
    };
    return (
      typeof params.request?.url === 'string' && params.request.url.includes(pathSuffix)
    );
  });
}

function asRequiredTabId(value: unknown): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid tab id returned from live SDK test: ${String(value)}`);
  }

  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
