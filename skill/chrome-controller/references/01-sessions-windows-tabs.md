# 01. Sessions, Windows, and Tabs

This page covers the browser control basics:

- sessions
- windows
- tabs

Read this first if you need to understand what browser state the CLI operates on.

## Sessions

A session is the top-level scope for your CLI work.

Important: a session is not a browser sandbox.

Think of a session as a CLI workspace, not a browser container.

Use sessions when:

- you want to keep one task isolated from another
- you want to switch between browser workflows
- you want repeatable JSON output with an explicit `sessionId`

Important behavior:

- browser commands use the current session by default
- if no session exists yet, the first browser command creates one automatically
- you can still create and name sessions manually when you want explicit control
- sessions do not create separate Chrome profiles, windows, tabs, or cookie jars
- a fresh session can still act on your existing Chrome windows and tabs

What sessions do manage:

- which `sessionId` the CLI uses by default
- an optional pinned target tab for later page-level commands
- snapshot caches and `@eN` refs
- CLI bookkeeping for your task

Good mental model:

- “session” means “which CLI state bucket am I using”
- it does not mean “which private browser environment am I using”

What sessions do not manage:

- separate browser state
- separate browsing history
- separate login state
- automatic window or tab isolation

If you need safety, start by choosing and pinning a tab, not by assuming a new session gave you a clean browser.

### `session create [--id <id>]`

Create a new session and make it current.

Options:

- `--id <id>`: give the session a custom name like `research`, `login-flow`, or `lead-gen`

Examples:

```bash
chrome-controller session create
chrome-controller session create --id linkedin
```

### `session current`

Show the current session.

Use this when:

- you are not sure which session later commands will use

Example:

```bash
chrome-controller session current
```

### `session list`

List every session and show which one is current.

Example:

```bash
chrome-controller session list
```

### `session use <id>`

Switch the current session.

Example:

```bash
chrome-controller session use linkedin
```

### `session close [<id>]`

Close a session.

Behavior:

- with `<id>`, closes that session
- without `<id>`, closes the current session
- if you already passed `--session <id>`, the command can also target that session

Examples:

```bash
chrome-controller session close
chrome-controller session close linkedin
```

### `session close-all`

Close every session.

Example:

```bash
chrome-controller session close-all
```

## Pinned target tabs

Sessions can also remember one pinned target tab.

When a session has a pinned target tab:

- page, element, wait, keyboard, mouse, find, screenshot, upload, storage, cookies, console, network, and debugger commands use that tab by default
- you do not need to keep passing `--tab <id>` on every follow-up command
- `--tab <id>` still wins when you want to override it for one command

Important:

- this is a convenience and safety feature, not browser isolation
- if the pinned tab is closed, the CLI errors instead of silently switching to whatever tab is active now

The easiest way to pin a target tab is with `open`:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page title
chrome-controller page snapshot
```

You can also manage the pinned target tab directly:

### `tabs target set <tabId>`

Pin one tab as the session target.

Example:

```bash
chrome-controller tabs target set 456 --session research
```

### `tabs target show`

Show the currently pinned target tab for the session.

Example:

```bash
chrome-controller tabs target show --session research
```

### `tabs target clear`

Clear the pinned target tab for the session.

Example:

```bash
chrome-controller tabs target clear --session research
```

## Windows

Use window commands to inspect or arrange the active session's managed window.

If the managed window is missing because the user closed it or Chrome restarted, the CLI recreates it automatically before running the command.

### `windows info`

Return details for the managed session window.

Example:

```bash
chrome-controller windows info --json
```

### `windows focus`

Focus the managed session window.

Example:

```bash
chrome-controller windows focus
```

### `windows resize <width> <height>`

Resize the managed session window.

If the window is minimized, maximized, or fullscreen, the CLI restores it to the normal state first and then applies the new size.

Example:

```bash
chrome-controller windows resize 1400 900
```

### `windows move <left> <top>`

Move the managed session window.

If the window is minimized, maximized, or fullscreen, the CLI restores it to the normal state first and then applies the new position.

Example:

```bash
chrome-controller windows move 0 32
```

### `windows maximize`

Maximize the managed session window.

Example:

```bash
chrome-controller windows maximize
```

### `windows minimize`

Minimize the managed session window.

Example:

```bash
chrome-controller windows minimize
```

### `windows restore`

Restore the managed session window to the normal state.

Use this after `windows minimize`, `windows maximize`, or when Chrome has the window in fullscreen and you want the normal resizable bounds back.

Example:

```bash
chrome-controller windows restore
```

## Tabs

Tabs are the main unit of browsing work.

Use tab commands to:

- inspect the current window
- open pages
- switch tabs
- close clutter
- regroup or reorder tabs

## Defaults for tab commands

- `tabs list` defaults to the current window
- `tabs open` opens in the current window
- most other tab commands act directly on tab ids

## Safe workflow for choosing a tab

If the browser already has important tabs open, prefer this pattern:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page url
chrome-controller page title
```

Why this is safer:

- `open` defaults to `--active=false`, so it does not need to steal the currently active tab
- it pins the opened or reused tab into the session
- later page-level commands follow that pinned target tab by default
- `--ready` waits for a stable page state before returning

If you want the lower-level manual flow instead, use:

```bash
chrome-controller tabs list --json
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page url --tab 456
chrome-controller page title --tab 456
```

Then continue with `--tab 456` on later commands, or pin it with `tabs target set 456`.

Why this is safer:

- `page goto` without `--tab` will navigate the pinned target tab when one is set, otherwise the active tab
- if nothing is pinned, the active tab may not be the tab you intended
- `tabs open` without `--active=false` may open as the active tab depending on Chrome behavior
- an explicit tab id removes ambiguity

### `tabs list [--window <id>] [--all]`

List tabs.

Options:

- `--window <id>`: list tabs from a specific window
- `--all`: list tabs from all windows

### `open <url> [--ready]`

Open a tab, or reuse an already-open exact URL match, and pin it as the session target tab.

This is the high-level safe entrypoint for most agent workflows.

Behavior:

- opens a new tab, or reuses an existing exact URL match for the URL
- defaults to `--active=false`
- pins the resulting tab as the session target tab
- with `--ready`, waits for stable readiness before returning

Useful options:

- `--ready`: wait for stable readiness
- `--window <id>`: choose the window
- `--active[=<bool>]`: override the default background-open behavior
- `--pinned[=<bool>]`: open the browser tab as pinned or unpinned
- `--timeout-ms <n>`: max wait when `--ready` is used
- `--poll-ms <n>`: wait polling interval when `--ready` is used
- `--quiet-ms <n>`: required DOM and network quiet window when `--ready` is used

Examples:

```bash
chrome-controller open https://example.com --json
chrome-controller open https://example.com/login --ready --json
chrome-controller open https://example.com/docs --window 123 --ready
```

Examples:

```bash
chrome-controller tabs list
chrome-controller tabs list --window 123
chrome-controller tabs list --all --json
```

### `tabs open <url> [--window <id>] [--active=<true|false>] [--pinned=<true|false>]`

Open a new tab.

Options:

- `--window <id>`: open it in a specific window
- `--active=<true|false>`: request whether the new tab should become active
- `--pinned=<true|false>`: request whether the new tab should be pinned

Important notes:

- if you omit `--active`, Chrome may still open the tab as active
- if you want to reduce the risk of stealing focus, pass `--active=false`
- after opening, use the returned `tabId` or verify with `tabs list`, `page url`, or `page title`

Examples:

```bash
chrome-controller tabs open https://example.com
chrome-controller tabs open https://example.com --active=true
chrome-controller tabs open https://example.com --active=false --json
chrome-controller tabs open https://example.com --window 123 --pinned
```

### `tabs get <tabId>`

Get details for one tab.

Example:

```bash
chrome-controller tabs get 456 --json
```

### `tabs activate <tabId>`

Make a tab active.

Example:

```bash
chrome-controller tabs activate 456
```

### `tabs close <tabId...>`

Close one or more tabs.

Example:

```bash
chrome-controller tabs close 456
chrome-controller tabs close 456 457 458
```

### `tabs close-others [--window <id>] [--keep <tabId>]`

Close every other tab in a window.

Options:

- `--window <id>`: choose which window to clean up
- `--keep <tabId>`: keep a specific tab instead of the active tab

Examples:

```bash
chrome-controller tabs close-others
chrome-controller tabs close-others --window 123
chrome-controller tabs close-others --keep 456
```

### `tabs reload <tabId>`

Reload a tab.

Example:

```bash
chrome-controller tabs reload 456
```

### `tabs duplicate <tabId>`

Duplicate a tab.

Example:

```bash
chrome-controller tabs duplicate 456
```

### `tabs move <tabId> [--window <id>] [--index <n>]`

Move a tab inside its window or into another window.

Options:

- `--window <id>`: move the tab into another window
- `--index <n>`: place the tab at a specific index

Examples:

```bash
chrome-controller tabs move 456 --index 0
chrome-controller tabs move 456 --window 123 --index 1
```

### `tabs pin <tabId...>` and `tabs unpin <tabId...>`

Pin or unpin one or more tabs.

Examples:

```bash
chrome-controller tabs pin 456 457
chrome-controller tabs unpin 456
```

### `tabs mute <tabId...>` and `tabs unmute <tabId...>`

Mute or unmute one or more tabs.

Examples:

```bash
chrome-controller tabs mute 456
chrome-controller tabs unmute 456
```

### `tabs group <tabId...>` and `tabs ungroup <tabId...>`

Create or remove a tab group.

Examples:

```bash
chrome-controller tabs group 456 457 458
chrome-controller tabs ungroup 456 457
```

## Common workflows

### Start a clean task from scratch

```bash
chrome-controller session create --id research
chrome-controller windows info --json
chrome-controller tabs open https://example.com --active
chrome-controller tabs list
```

### Reorganize a noisy browser

```bash
chrome-controller tabs list --all --json
chrome-controller tabs close 501 502 503
chrome-controller tabs move 504 --index 0
chrome-controller tabs pin 504
```

### Arrange the managed session window

```bash
chrome-controller session create --id layout-demo
chrome-controller windows move 40 40
chrome-controller windows resize 1440 960
chrome-controller windows focus
```
