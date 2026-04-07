# Chrome Controller CLI Guide

This folder explains how to drive Chrome entirely through the `chrome-controller` CLI.

The docs are written for an agent or user who starts with no project context and just needs to control the browser by running commands.

## What this CLI gives you

You can use the CLI to:

- manage browser sessions
- inspect and rearrange windows and tabs
- navigate pages
- turn pages into markdown
- snapshot interactive elements and act on them with refs like `@e1`
- type, click, wait, drag, and upload files
- capture console output, network traffic, screenshots, and PDFs
- manage cookies, storage, and downloads
- drop down to raw Chrome DevTools Protocol commands when needed

## Safety model

Sessions are not isolated browser contexts.

The safest mental model is:

- a session is a CLI workspace label
- it is not a browser container
- it does not protect you from acting on the wrong real tab if you rely on defaults

A session only tracks CLI state such as:

- the current `sessionId`
- snapshot caches and `@eN` refs
- command routing when you omit `--session`

A session does not create:

- a separate Chrome profile
- a separate cookie jar
- a separate tab sandbox
- a separate browser window unless you create one yourself

So a brand new session can still control your already-open Chrome windows and tabs.

If you want safety, get an explicit `tabId` early and keep using `--tab`.

## Command shape

Every command starts with:

```bash
chrome-controller <group> <command> [options]
```

Examples:

```bash
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

Window-scoped commands usually default to the current window.

Examples:

- `tabs list` defaults to the current window
- `tabs open` opens into the current window

### 3. Tab default

Most page, element, keyboard, mouse, debugger, console, network, screenshot, storage, cookies, and upload commands default to the active tab in the current window when `--tab` is omitted.

That means commands like `page goto`, `page snapshot`, `element click`, `page text`, and `network start` can act on whatever tab is currently active unless you pin them to a tab id with `--tab`.

## Safer starting pattern

If you are about to do real work in a browser that already has personal or unrelated tabs open, use this pattern instead of jumping straight to `page goto`:

```bash
chrome-controller tabs list --json
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page url --tab <tabId>
chrome-controller page title --tab <tabId>
```

Then keep using that explicit tab id:

```bash
chrome-controller page snapshot --tab <tabId>
chrome-controller element click @e3 --tab <tabId>
```

This is safer because:

- `page goto` without `--tab` can replace the active tab
- `tabs open` may still become the active tab depending on Chrome behavior unless you pass `--active=false`
- once you have a `tabId`, later commands can target it explicitly

## How to interact with a page

For most tasks, the best loop is:

1. open or choose the right tab
2. verify the tab with `page url` or `page title`
3. navigate if needed
4. run `page snapshot`
5. act on `@eN` refs with `element ...`
6. wait for the page to settle with `wait ...`
7. run `page snapshot` again if the page changed

Safer example:

```bash
chrome-controller tabs open https://example.com/login --active=false --json
chrome-controller page url --tab 456
chrome-controller page title --tab 456
chrome-controller page snapshot --tab 456
chrome-controller element fill @e1 alice@example.com --tab 456
chrome-controller element fill @e2 supersecret --tab 456
chrome-controller element click @e3 --tab 456
chrome-controller wait load --tab 456
chrome-controller page snapshot --tab 456
```

Fast loop when you are already sure about the target tab:

1. navigate to the page
2. run `page snapshot`
3. act on `@eN` refs with `element ...`
4. wait for the page to settle with `wait ...`
5. run `page snapshot` again if the page changed

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

## Document map

- [01 - Sessions, Windows, and Tabs](./01-sessions-windows-tabs.md)
  What sessions are, how defaults work, and how to inspect or rearrange browser state.
- [02 - Pages, Snapshots, and Interaction](./02-pages-snapshots-and-interaction.md)
  How to navigate, read page content, create snapshots, act on elements, type, click, drag, and wait.
- [03 - Debugging, Network, Console, and Capture](./03-debugging-network-console-and-capture.md)
  How to attach the debugger, inspect events, capture network requests, read console logs, and take screenshots or PDFs.
- [04 - State, Cookies, Uploads, and Downloads](./04-state-cookies-uploads-and-downloads.md)
  How to save state, restore state, manage cookies, upload files, and wait for downloads.
- [05 - Recipes](./05-recipes.md)
  Step-by-step patterns for common tasks like safe navigation, login flows, inbox scraping, prompt submission, network inspection, uploads, and downloads.

## Quick recipes

### Open a site and inspect its page

```bash
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page title --tab 456
chrome-controller page text --tab 456
chrome-controller page snapshot --tab 456
```

### Click a button found by snapshot

```bash
chrome-controller page snapshot
chrome-controller element click @e7
```

### Fill a form and submit it

```bash
chrome-controller page snapshot
chrome-controller element fill @e1 "alice@example.com"
chrome-controller element fill @e2 "hunter2"
chrome-controller element click @e3
chrome-controller wait load
```

### Investigate a failing request

```bash
chrome-controller network start --disable-cache
chrome-controller page goto https://example.com
chrome-controller wait load
chrome-controller network summary --json
chrome-controller network list --failed --json
```

### Save and reuse a login state

```bash
chrome-controller storage state-save ./state.json
chrome-controller storage state-load ./state.json --reload
```
