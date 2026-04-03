# Browser State And Tabs

Use this reference together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for browser-state decisions.

## When To Read

Read this reference when the task is mostly about browser state rather than page content:

- open or reuse tabs
- find the right existing app tab
- switch focus
- navigate or reload an existing tab
- close one or more tabs
- clean up all tabs except a specific one
- use a raw Chrome API that is not wrapped elsewhere

## Relevant Helpers

- `connectWeb(options?)`
- `withWebBrowser(fn, options?)`
- `browser.openTab(url, options?)`
- `browser.listTabs(filter?)`
- `browser.findTabs(predicateOrFilter)`
- `browser.closeTabs(ids)`
- `browser.closeOtherTabs(keepIds)`
- `browser.chrome(method, ...args)`
- `tab.info()`
- `tab.goto(url)`
- `tab.reload()`
- `tab.focus()`
- `tab.close()`

## Recommended Patterns

### Reuse An Existing Tab When User State Matters

If the task depends on an already-signed-in session, search for an existing tab first:

```ts
const matchingTabs = await browser.findTabs((info) =>
  Boolean(info.url?.startsWith('https://mail.google.com/'))
);
const tab = matchingTabs[0] ?? (await browser.openTab('https://mail.google.com/mail/u/0/#inbox'));
```

### Keep A Verification Tab Open

If the user wants to inspect the result afterward:

1. Do the task in a normal tab.
2. Do not call `tab.close()`.
3. Close only the helper session with `browser.close()` or by returning from `withWebBrowser(...)`.

The tab remains open in Chrome because the helper session and the tab lifecycle are separate.

### Clean Up Browser State

For tasks like "close everything except Notion":

```ts
const notionTabs = await browser.findTabs((info) => info.title?.includes('Notion') === true);
if (notionTabs[0]) {
  await browser.closeOtherTabs(notionTabs[0].id);
}
```

This is the same pattern we used when keeping only the Notion tab open.

## Raw Chrome API Escape Hatch

Use `browser.chrome(...)` when Chrome already has a method you need and there is no first-class wrapper yet:

```ts
const cookies = await browser.chrome('cookies.getAll', {
  domain: 'github.com',
});
```

This keeps the public API flexible without requiring a dedicated wrapper for every Chrome namespace.

## Verification Tips

- After navigation, call `tab.info()` or `waitFor(...)` instead of assuming the URL changed.
- When multiple tabs match, prefer the one with the clearest title or the right active/window state.
- Use a fresh temp tab for exploratory tasks that should not disturb the user's current app tab.
