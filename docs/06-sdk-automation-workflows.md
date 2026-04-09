# 06. SDK Automation Workflows

This guide explains how to use the TypeScript SDK for repeatable browser automation.

The SDK is intentionally low level.

It is not a second CLI.

Use the CLI when you are exploring a page, discovering selectors, reading page snapshots, or figuring out the shape of a workflow.

Use the SDK when you already understand the page well enough to write a script that can be run again and again.

## The intended split

The simplest mental model is:

- use the CLI for discovery
- use the SDK for repetition

Typical flow:

1. open the page with the CLI
2. inspect the page structure with `find`, `page snapshot`, `page text`, `network`, and `debugger`
3. figure out the stable URL, tab lookup strategy, selectors, eval snippets, and CDP commands you need
4. move that knowledge into a script that uses the SDK
5. run that script whenever you need the workflow again

The SDK does not carry over CLI state such as:

- sessions
- pinned target tabs
- snapshot caches
- `@eN` refs
- CLI artifact folders

That is by design.

SDK scripts should be explicit about which tab they target and what they do.

## Install and import

```bash
npm install @ank1015/chrome-controller
```

Recommended import:

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```
The SDK is exported from the root package.

## The core SDK surface

The SDK is centered around one persistent connection:

```ts
const chrome = await connectChromeController();
```

From that connection, you use four main capabilities:

- `chrome.call(method, ...args)`
  Raw access to Chrome extension APIs exposed through the bridge, such as `tabs.query`, `tabs.create`, `tabs.update`, `windows.getAll`, `downloads.search`, and so on.
- `chrome.evaluate(tabId, code, options?)`
  Evaluate JavaScript in a tab and get the returned value back.
- `chrome.subscribe(event, callback)`
  Subscribe to raw Chrome events such as `tabs.onUpdated`.
- `chrome.debugger.attach(tabId)`
  Create a long-lived debugger session for CDP commands and debugger event collection.

Always close the connection when you are done:

```ts
await chrome.close();
```

## Your first script

This example finds an existing tab, opens one if needed, reads page data, and closes the connection cleanly.

```ts
import { connectChromeController } from '@ank1015/chrome-controller';

async function main() {
  const chrome = await connectChromeController();

  try {
    const existingTabs = await chrome.call<Array<{ id?: number; url?: string }>>(
      'tabs.query',
      [{ currentWindow: true }]
    );

    let tabId =
      existingTabs.find((tab) => tab.url?.startsWith('https://example.com/dashboard'))?.id ??
      null;

    if (!tabId) {
      const opened = await chrome.call<{ id?: number }>('tabs.create', {
        url: 'https://example.com/dashboard',
        active: false,
      });
      tabId = opened.id ?? null;
    }

    if (!tabId) {
      throw new Error('Could not resolve dashboard tab');
    }

    const title = await chrome.evaluate<string>(tabId, 'document.title');
    const summary = await chrome.evaluate<{ heading: string | null; count: number }>(
      tabId,
      `(() => {
        return {
          heading: document.querySelector('h1')?.textContent?.trim() ?? null,
          count: document.querySelectorAll('[data-row]').length,
        };
      })()`
    );

    console.log({ title, summary });
  } finally {
    await chrome.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Pattern: resolve your tab explicitly

In the CLI, page-level commands can follow the current session and pinned target tab.

In the SDK, do not rely on “whatever tab is active right now” unless that is truly what you want.

Prefer one of these patterns:

- query for an existing tab by URL and reuse it
- create a new tab and keep its `tabId`
- accept `tabId` as an explicit input to your workflow

Good:

```ts
const tabs = await chrome.call<Array<{ id?: number; url?: string }>>('tabs.query', [
  { currentWindow: true },
]);
const tabId = tabs.find((tab) => tab.url?.includes('/reports'))?.id;
```

Riskier:

```ts
const tabs = await chrome.call<Array<{ id?: number }>>('tabs.query', [
  { active: true, currentWindow: true },
]);
```

The second version is fine for personal scripts, but it is easier to aim at the wrong tab.

## Pattern: use `evaluate` for page-native logic

The SDK’s biggest strength is that once you know the structure of a page, you can write page-native logic directly.

Examples:

- read headings, tables, counters, and data attributes
- submit forms using page APIs
- extract structured data from the DOM
- click elements by selector from inside `evaluate`
- wait on page-defined globals or DOM conditions

Example:

```ts
const result = await chrome.evaluate<{ ok: boolean; text: string | null }>(
  tabId,
  `(() => {
    const button = document.querySelector('button[type="submit"]');
    const text = document.querySelector('.status')?.textContent?.trim() ?? null;
    if (button instanceof HTMLButtonElement) {
      button.click();
      return { ok: true, text };
    }
    return { ok: false, text };
  })()`
);
```

This is often better than recreating every interaction as a sequence of external click commands once you already know the page well.

## Pattern: use the debugger for network and CDP domains

When you need CDP access, attach once and keep the session local to the workflow.

```ts
const debuggerSession = await chrome.debugger.attach(tabId);

try {
  await debuggerSession.send('Network.enable');
  await debuggerSession.send('Page.enable');

  const result = await debuggerSession.send<{
    result?: { value?: unknown };
  }>('Runtime.evaluate', {
    expression: 'document.body.dataset.state',
    returnByValue: true,
  });

  console.log(result.result?.value);

  const events = await debuggerSession.getEvents({ filter: 'Network.' });
  console.log(events.length);
} finally {
  await debuggerSession.detach();
}
```

This is useful for:

- watching network requests
- reading CDP-only state
- emulating conditions
- inspecting runtime state
- collecting debugger events for later analysis

## Pattern: subscribe when the browser should tell you something

`subscribe` is useful when the browser should push updates instead of you polling constantly.

Example:

```ts
const updates: unknown[] = [];

const unsubscribe = chrome.subscribe('tabs.onUpdated', (args) => {
  updates.push(args);
});

try {
  await chrome.call('tabs.update', tabId, { url: 'https://example.com/next' });
  // inspect updates or wait until the event you need arrives
} finally {
  unsubscribe();
}
```

This works well for:

- tab lifecycle updates
- download events
- other raw extension events exposed through the bridge

## Building a workflow from CLI exploration

Here is the recommended path from exploration to automation.

### Step 1: Explore with the CLI

Use the CLI to answer questions like:

- what is the right page URL?
- which tab should I target?
- which selectors are stable?
- can this task be done with a single `evaluate` block?
- do I need CDP network events or only DOM reads?
- which request or response actually matters?

Useful commands:

- `open --ready`
- `page url`
- `page title`
- `page text`
- `page snapshot`
- `find`
- `debugger cmd`
- `network start`
- `network list`
- `wait stable`

### Step 2: Remove CLI-only concepts

Before writing the script, translate CLI discoveries into script-safe inputs:

- replace `@eN` refs with real selectors or DOM traversal logic
- replace session defaults with explicit `tabId` lookup
- replace ad hoc waiting with explicit checks
- replace temporary manual steps with reusable functions

### Step 3: Write the script around one clear outcome

Good workflow shapes:

- `runDailyReport()`
- `exportInvoices({ startDate, endDate })`
- `collectInboxThreads()`
- `submitPrompt(prompt)`
- `captureNetworkTrace(url)`

Avoid writing a giant generic browser framework at first.

Start with one repeatable job.

### Step 4: Add explicit checks

A good workflow checks that it is on the right page before doing work.

Examples:

- verify the URL matches the expected path
- verify the document title contains the expected app name
- verify a key element exists before continuing
- verify a network request happened before parsing results

### Step 5: Make cleanup predictable

Use `try/finally` around:

- `chrome.close()`
- `debuggerSession.detach()`
- raw event subscriptions
- temporary tabs you create only for the workflow

## Example workflow: scrape a structured report

```ts
import { connectChromeController } from '@ank1015/chrome-controller';

export async function scrapeReport() {
  const chrome = await connectChromeController();

  try {
    const created = await chrome.call<{ id?: number }>('tabs.create', {
      url: 'https://example.com/reports/daily',
      active: false,
    });

    const tabId = created.id;
    if (!tabId) {
      throw new Error('Could not open report tab');
    }

    await waitFor(
      async () => {
        const tab = await chrome.call<{ status?: string }>('tabs.get', tabId);
        return tab.status === 'complete';
      },
      'Report tab did not finish loading'
    );

    return await chrome.evaluate<Array<{ name: string; value: string }>>(
      tabId,
      `(() => {
        return [...document.querySelectorAll('[data-report-row]')].map((row) => ({
          name: row.querySelector('[data-name]')?.textContent?.trim() ?? '',
          value: row.querySelector('[data-value]')?.textContent?.trim() ?? '',
        }));
      })()`
    );
  } finally {
    await chrome.close();
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  errorMessage: string,
  timeoutMs = 15000,
  pollMs = 100
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(errorMessage);
}
```

## Example workflow: capture network activity for a page

```ts
import { connectChromeController } from '@ank1015/chrome-controller';

export async function captureRequests(url: string) {
  const chrome = await connectChromeController();

  try {
    const tab = await chrome.call<{ id?: number }>('tabs.create', {
      url,
      active: false,
    });
    const tabId = tab.id;

    if (!tabId) {
      throw new Error('Could not open tab');
    }

    const debuggerSession = await chrome.debugger.attach(tabId);

    try {
      await debuggerSession.send('Network.enable');
      await debuggerSession.getEvents({ filter: 'Network.', clear: true });

      await waitFor(
        async () => {
          const current = await chrome.call<{ status?: string }>('tabs.get', tabId);
          return current.status === 'complete';
        },
        'Tab did not finish loading'
      );

      return await debuggerSession.getEvents({ filter: 'Network.' });
    } finally {
      await debuggerSession.detach();
    }
  } finally {
    await chrome.close();
  }
}
```

## Best practices

- Import the SDK from `@ank1015/chrome-controller`.
- Keep scripts explicit about how they find their tab.
- Prefer `evaluate` for page-native read and write logic once the page is understood.
- Use debugger sessions only when you need CDP domains or event streams.
- Do not build scripts around CLI-only concepts like session defaults or `@eN` refs.
- Close connections and detach debugger sessions in `finally` blocks.
- Start with narrow workflows and grow small helpers only after repetition appears.

## When not to use the SDK

Stay in the CLI when:

- you are still discovering how the page works
- you need `page snapshot` and `find` to narrow the page down
- the task is exploratory and not yet repeatable
- the workflow is changing every run

Move to the SDK when:

- the target page is understood
- you know how to resolve the correct tab
- the selectors or page logic are stable enough
- the same task will be repeated often enough to justify a script
