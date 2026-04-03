# Web Task Workflow

Use this guide to choose helpers, structure the task, and verify the result.

## Choose The Task Mode

Pick the dominant mode first. This tells you which helpers to reach for.

- read
  - goal: understand or extract information from a page
  - start with `openTab(...)`, `waitForLoad()`, `waitFor(...)`, and `evaluate(...)`
- interact
  - goal: change page state, fill forms, create drafts, or click through a workflow
  - start with `waitForLoad()`, `waitFor(...)`, `evaluate(...)`, and explicit verification
- debug
  - goal: inspect network activity, debugger events, screenshots, or raw CDP behavior
  - start with `withDebugger(...)`, `captureNetwork(...)`, `screenshot(...)`, or `cdp(...)`
- browser-state
  - goal: manage tabs, focus, navigation, or cleanup
  - start with `listTabs(...)`, `findTabs(...)`, `focus()`, `goto(...)`, `closeTabs(...)`, or `closeOtherTabs(...)`
- file-transfer
  - goal: wait on downloads or upload local files into a page
  - start with `listDownloads(...)`, `waitForDownload(...)`, or `uploadFiles(...)`

## Default Algorithm

Use this loop unless the task clearly needs something more specialized:

1. Choose the dominant mode.
2. Use `withWebBrowser(...)` by default.
3. Reuse an existing tab only when the task depends on current user state. Otherwise open a fresh tab.
4. Wait twice:
   - browser readiness with `waitForLoad()`
   - app readiness with `waitFor(...)`
5. Probe the page with a small `evaluate(...)` call before taking action.
6. Do the smallest useful step.
7. Verify the result immediately.
8. Repeat only if the task still needs another step.
9. Leave tabs open only when the user asked for verification.

## Which Helper To Use

### Use `evaluate(...)` when:

- you need to inspect page-specific DOM content
- you need a custom extraction shape
- you need to interact with framework-specific inputs or editors
- you already know the selector and the action is page-specific

This is the main DOM primitive. Most unfamiliar-site work should flow through `evaluate(...)`.

### Use `chrome(...)` when:

- Chrome already exposes what you need as a standard browser API
- the task is about tabs, windows, cookies, downloads, or other browser state
- there is no higher-level helper for the exact Chrome namespace or method

### Use `withDebugger(...)` or `cdp(...)` when:

- the task is specifically about debugger domains
- you need raw DevTools Protocol access
- you are doing something lower-level than standard DOM work

### Use `captureNetwork(...)` when:

- the user asks what network activity happens on load or during an action
- you want a summarized result instead of manually reconstructing `Network.*` events

### Use `getMarkdown(...)` when:

- the page is documentation, an article, or long-form content
- markdown is a better representation than raw DOM text

### Use `waitForDownload(...)` and `uploadFiles(...)` when:

- the browser is managing file transfer state
- you want a stable browser/helper abstraction instead of hand-rolled DOM code

## Verification Rules

- Never assume the page is ready just because `waitForLoad()` finished.
- Never assume a DOM mutation succeeded without reading the state back.
- Prefer reversible actions like drafts, previews, and fills over irreversible submit actions.
- For feed and inbox tasks, verify the container and then extract only the first few visible items.
- For network tasks, attach before the navigation or action you want to study.

## Examples Mapped To Real Tasks

- docs site overview
  - `openTab(...)` -> `waitForLoad()` -> `waitFor(...)` -> `evaluate(...)` -> optional `getMarkdown(...)`
- top Gmail messages
  - reuse or open Gmail tab -> `waitFor(...)` for inbox rows -> `evaluate(...)` to extract first visible rows
- Gmail draft
  - `waitFor(...)` for compose UI -> `evaluate(...)` to fill fields -> `evaluate(...)` again to verify the draft values
- GitHub network activity
  - open `about:blank` -> `captureNetwork(...)` -> navigate inside the callback -> summarize `summary` and `requests`
- first posts on X while keeping the tab open
  - `connectWeb(...)` -> open tab -> extract with `evaluate(...)` -> `browser.close()` without closing the tab
- close everything except Notion
  - `findTabs(...)` -> identify the keeper tab -> `closeOtherTabs(...)`

## Next References

- Read [read.md](read.md) for read-heavy extraction patterns.
- Read [interact.md](interact.md) for page-state changes and draft/form behavior.
- Read [debug.md](debug.md) for debugger and network-specific tasks.
- Read [browser-state.md](browser-state.md) for tab and window flows.
- Read [downloads.md](downloads.md) for file-transfer tasks.
- Read [recipes.md](recipes.md) for compact end-to-end templates.
