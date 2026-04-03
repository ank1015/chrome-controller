# Debug Pages And Network Activity

Use this reference together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for debugger selection and verification.

## When To Read

Read this reference when the task is about:

- network activity during page load or an interaction
- screenshots for verification or debugging
- raw Chrome DevTools Protocol work
- collecting debugger events from a tab

## Relevant Helpers

Import from `@ank1015/llm-agents`:

```ts
import { withWebBrowser } from '@ank1015/llm-agents';
```

The key helpers are:

- `tab.withDebugger(fn)`
- `tab.captureNetwork(fn, options?)`
- `tab.screenshot(options?)`
- `WebDebuggerSession.cdp(method, params?)`
- `WebDebuggerSession.events(filter?)`
- `WebDebuggerSession.clearEvents(filter?)`

## Recommended Network Workflow

1. Open a fresh tab when you want a clean capture from the start of navigation.
2. Use `captureNetwork(...)` so the helper attaches CDP, enables `Network`, and summarizes requests for you.
3. Use `disableCache: true` when you care about the real first-load request graph.
4. Trigger exactly one navigation or action inside the capture callback.
5. Summarize domains, resource types, statuses, failures, redirects, and interesting endpoints.

## Example: Capture Homepage Network Activity

```ts
const capture = await tab.captureNetwork(
  async (activeTab, debuggerSession) => {
    await debuggerSession.cdp('Page.enable');
    await debuggerSession.cdp('Page.navigate', { url: 'https://github.com/' });
    await activeTab.waitForLoad();
    await activeTab.waitForIdle(1_500);
    return { url: 'https://github.com/' };
  },
  {
    disableCache: true,
  }
);
```

This is the pattern we used for GitHub: attach first, navigate inside the capture, then summarize the resulting request graph.

## Raw CDP Escape Hatch

Use `withDebugger(...)` and `cdp(...)` when the task needs something more specialized than the built-in helpers:

```ts
await tab.withDebugger(async (debuggerSession) => {
  await debuggerSession.cdp('Runtime.enable');
  await debuggerSession.cdp('Log.enable');
  const events = await debuggerSession.events('Log.');
  console.log(events.length);
});
```

This keeps CDP lifecycle management inside the helper layer while still giving you low-level access.

## Screenshots

Use `tab.screenshot(...)` for:

- visual verification
- debugging layout issues
- collecting evidence for a user report

```ts
const screenshot = await tab.screenshot({
  fullPage: true,
  format: 'png',
  outputPath: './artifacts/homepage',
});
```

The helper writes the file when `outputPath` is provided and also returns the base64 payload.

## Debugging Heuristics

- If you need the entire page-load network story, attach before navigation.
- If you need the network story for one button click, wait until the page is ready first, then capture around the click.
- Prefer summarized results in the final answer. Use raw events only when you truly need low-level debugging detail.
