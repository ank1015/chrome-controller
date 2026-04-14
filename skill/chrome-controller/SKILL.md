---
name: chrome-controller
description: Control Chrome with the `chrome-controller` CLI and build repeatable browser workflows with the root-package SDK. Use when you need to inspect or manipulate real browser tabs and pages, manage sessions/windows/tabs, navigate pages, snapshot and interact with elements, capture debugger/console/network state, manage cookies/storage/uploads/downloads, or convert an explored browser task into a reusable script with `connectChromeController`.
---

# Chrome Controller Guide

This skill explains how to control Chrome with the `chrome-controller` CLI and how to build repeatable scripts with the SDK.

The main workflow is:

- use the CLI to explore and understand the page
- use the SDK to automate the parts that repeat

## What this CLI gives you

You can use the CLI to:

- manage browser sessions
- safely open or reuse a working tab with `open --ready`
- inspect and rearrange windows and tabs
- navigate pages
- turn pages into markdown
- semantically narrow large pages down with `find`
- snapshot interactive elements and act on them with refs like `@e1`
- type, click, wait, drag, and upload files
- capture console output, network traffic, screenshots, and PDFs
- manage cookies, storage, and downloads
- drop down to raw Chrome DevTools Protocol commands when needed

## What the SDK gives you

You can use the SDK to:

- connect once and keep a persistent browser bridge open
- call raw browser APIs directly
- evaluate JavaScript inside tabs
- attach debugger sessions and send CDP commands
- subscribe to raw browser events
- turn an explored browser task into a script you can run again later

Import the SDK from the root package:

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```

## Safety model

Sessions are not isolated browser contexts.

The safest mental model is:

- a session is a CLI workspace label
- it is not a browser container
- it does not protect you from acting on the wrong real tab if you rely on defaults

A session only tracks CLI state such as:

- the current `sessionId`
- the current tab for page-level commands
- snapshot caches and `@eN` refs
- command routing when you omit `--session`

A session does not create:

- a separate Chrome profile
- a separate cookie jar
- a separate tab sandbox
- a separate browser window unless the CLI creates the managed session window

So sessions isolate CLI workflow state, not cookies or profile data.

If you want safety, choose a current tab early with `open --ready`, `tabs use`, or `tabs new`.

## Command shape

Most commands use:

```bash
chrome-controller <group> <command> [options]
```

The safe browser-entry command is top-level:

```bash
chrome-controller open <url> [options]
```

Examples:

```bash
chrome-controller open https://example.com --ready
chrome-controller tabs list
chrome-controller page goto https://example.com
chrome-controller page snapshot
chrome-controller element click @e3
chrome-controller network start
```

## Global options

These work everywhere:

- `--json`: return machine-readable JSON
- `--session <id>`: run the command against a specific session
- `--help` or `-h`: show help for the command

When you use `--json`, the response includes:

- `success`
- `sessionId`
- `data`

## The three defaults that matter most

### 1. Session default

If you do not pass `--session`, the CLI uses the current session.

If there is no current session yet, the first browser command creates one automatically.

That means these both work even on a clean machine:

```bash
chrome-controller tabs list
chrome-controller page goto https://example.com
```

Important:

- sessions do not isolate browser state
- they only isolate CLI bookkeeping and current-session selection
- if you think “new session means clean browser,” treat that as false

### 2. Window default

Window-scoped commands act on the active session's managed window.

Examples:

- `tabs list` lists tabs in the managed window
- `tabs new` opens into the managed window

### 3. Tab default

Page commands act on the session's current tab, and most element, keyboard, mouse, debugger, console, network, screenshot, storage, cookies, upload, and `find` commands use the session's current tab when `--tab` is omitted.

If the session does not have a current tab remembered yet, they fall back to the active tab in the managed window.

That means commands like `page goto`, `page snapshot`, `element click`, `page text`, and `network start` can act on whatever tab is currently active in the managed window unless you choose a working tab first. Use `tabs use <tabId>` when you want page commands to switch to another managed tab.

## Safer starting pattern

If you are about to do real work in a browser that already has personal or unrelated tabs open, use this pattern instead of jumping straight to `page goto`:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page url
chrome-controller page title
```

This is safer because:

- `open` defaults to `--active=false`
- it remembers the opened or reused tab as the session's current tab
- `--ready` waits for stable page readiness before returning
- later page-level commands follow that current tab by default

Manual fallback:

```bash
chrome-controller tabs list --json
chrome-controller tabs use <tabId>
chrome-controller page url
chrome-controller page title
```

Or start fresh:

```bash
chrome-controller tabs new https://example.com
chrome-controller page snapshot
chrome-controller element click @e3
```

## How to interact with a page

For most tasks, the best loop is:

1. use `open --ready` to open the page or reuse an already-open exact URL match and remember it as the session's current tab
2. verify the tab with `page url` or `page title`
3. navigate if needed
4. run `find` when you want a semantic shortlist first
5. run `page snapshot` when you want the raw interactive structure
6. act on `@eN` refs with `element ...`
7. wait for the page to settle with `wait ...`
8. run `page snapshot` again if the page changed

Safer example:

```bash
chrome-controller open https://example.com/login --ready --json
chrome-controller page url
chrome-controller page title
chrome-controller page snapshot
chrome-controller element fill @e1 alice@example.com
chrome-controller element fill @e2 supersecret
chrome-controller element click @e3
chrome-controller wait stable
chrome-controller page snapshot
```

Fast loop when you are already sure about the target tab:

1. navigate to the page
2. run `find` if you want likely candidates instead of the whole page
3. run `page snapshot`
4. act on `@eN` refs with `element ...`
5. wait for the page to settle with `wait ...`
6. run `page snapshot` again if the page changed

Example:

```bash
chrome-controller page goto https://example.com/login
chrome-controller page snapshot
chrome-controller element fill @e1 alice@example.com
chrome-controller element fill @e2 supersecret
chrome-controller element click @e3
chrome-controller wait load
chrome-controller page snapshot
```

## When to use selectors vs `@eN` refs

Use snapshot refs when possible:

- `@e1`, `@e2`, `@e3`

They are easier for agents to reuse after reading `page snapshot`.

But snapshot refs are ephemeral:

- they describe the page at the moment you captured the snapshot
- SPAs can rerender and invalidate them quickly
- after big UI changes, rerun `page snapshot` and use the new refs

Use CSS selectors when:

- you already know the selector
- the element is not in the snapshot
- you need direct targeting for `upload files` or a custom workflow

## When to use mouse commands

Use `mouse` when element-level actions are not enough:

- drag and drop
- sliders and scrubbers
- canvas-based UIs
- map widgets
- custom controls that do not respond to a normal element click

To get reliable coordinates, use:

```bash
chrome-controller element box @e4 --json
```

Then feed the returned center or edges into `mouse move`, `mouse click`, or `mouse drag`.

## Read References As Needed

- [references/01-sessions-windows-tabs.md](references/01-sessions-windows-tabs.md)
  Read for sessions, windows, tabs, the current session tab, and safe browser entry with `open`.
- [references/02-pages-snapshots-and-interaction.md](references/02-pages-snapshots-and-interaction.md)
  Read for `page`, `find`, `element`, `keyboard`, `mouse`, and `wait`.
- [references/03-debugging-network-console-and-capture.md](references/03-debugging-network-console-and-capture.md)
  Read for debugger commands, console, network capture, screenshots, and PDFs.
- [references/04-state-cookies-uploads-and-downloads.md](references/04-state-cookies-uploads-and-downloads.md)
  Read for storage, cookies, uploads, and downloads.
- [references/05-recipes.md](references/05-recipes.md)
  Read for full workflow examples and reliability patterns.
- [references/06-sdk-automation-workflows.md](references/06-sdk-automation-workflows.md)
  Read when converting a discovered browser task into a reusable script with `connectChromeController`.
