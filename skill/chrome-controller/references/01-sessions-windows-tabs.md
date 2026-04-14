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
- the current tab for later page-level commands
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

## Current session tab

Sessions also remember one current tab inside the managed window.

When a session has a current tab:

- page, element, wait, keyboard, mouse, find, screenshot, upload, storage, cookies, console, network, and debugger commands use that tab by default
- you do not need to keep passing `--tab <id>` on every follow-up command
- `--tab <id>` still wins when you want to override it for one command

Important:

- this is a convenience and safety feature, not browser isolation
- if the remembered tab is closed or disappears, the CLI falls back to the active tab in the managed window

The easiest way to choose a current tab is with `open`:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page title
chrome-controller page snapshot
```

You can also choose it directly with `tabs use`:

```bash
chrome-controller tabs list --json
chrome-controller tabs use 456
chrome-controller tabs current
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

- inspect the managed session window
- open fresh tabs
- switch tabs
- close clutter
- keep one current working tab

## Defaults for tab commands

- all `tabs` commands stay inside the active session's managed window
- `tabs new` always opens a fresh tab in that managed window
- `tabs use` chooses which existing tab becomes the session's current tab
- `tabs close`, `tabs close-others`, `tabs reload`, and `tabs duplicate` act on the current session tab

## Safe workflow for choosing a URL

If the browser already has important tabs open, prefer this pattern:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page url
chrome-controller page title
```

Why this is safer:

- `open` defaults to `--active=false`, so it does not need to steal the currently active tab
- it remembers the opened or reused tab as the session's current tab
- later page-level commands follow that current tab by default
- `--ready` waits for a stable page state before returning

If you want the lower-level manual flow instead, use:

```bash
chrome-controller tabs list --json
chrome-controller tabs use 456
chrome-controller page url
chrome-controller page title
```

If you want a fresh tab instead of reusing an existing one, use:

```bash
chrome-controller tabs new https://example.com
chrome-controller page url
chrome-controller page title
```

Why this is safer:

- `page goto` without `--tab` will navigate the session's current tab when one is remembered, otherwise the active tab in the managed window
- `tabs use` removes ambiguity when you want to keep working in an already-open tab
- `tabs new` removes ambiguity when you want a completely fresh tab

### `tabs list`

List tabs in the managed session window.

### `open <url> [--ready]`

Open a tab, or reuse an already-open exact URL match in the managed session window, and remember it as the session's current tab.

This is the high-level safe entrypoint for most agent workflows.

Behavior:

- opens a new tab in the managed session window, or reuses an existing exact URL match there
- defaults to `--active=false`
- remembers the resulting tab as the session's current tab
- with `--ready`, waits for stable readiness before returning

Useful options:

- `--ready`: wait for stable readiness
- `--active[=<bool>]`: override the default background-open behavior
- `--pinned[=<bool>]`: open the browser tab as pinned or unpinned
- `--timeout-ms <n>`: max wait when `--ready` is used
- `--poll-ms <n>`: wait polling interval when `--ready` is used
- `--quiet-ms <n>`: required DOM and network quiet window when `--ready` is used

Examples:

```bash
chrome-controller open https://example.com --json
chrome-controller open https://example.com/login --ready --json
```

Examples:

```bash
chrome-controller tabs list
chrome-controller tabs list --json
```

### `tabs current`

Show the current tab for the session.

Example:

```bash
chrome-controller tabs current --json
```

### `tabs new [url]`

Open a fresh tab in the managed session window and make it the current tab.

Example:

```bash
chrome-controller tabs new
chrome-controller tabs new https://example.com
```

### `tabs use <tabId>`

Switch to an existing tab in the managed session window and make it the current tab.

Example:

```bash
chrome-controller tabs use 456
```

### `tabs close`

Close the current tab.

Examples:

```bash
chrome-controller tabs close
```

### `tabs close-others`

Close every other tab in the managed session window and keep the current tab.

Examples:

```bash
chrome-controller tabs close-others
```

### `tabs reload`

Reload the current tab.

Example:

```bash
chrome-controller tabs reload
```

### `tabs duplicate`

Duplicate the current tab, activate the duplicate, and make it the current tab.

Example:

```bash
chrome-controller tabs duplicate
```

## Common workflows

### Start a clean task from scratch

```bash
chrome-controller session create --id research
chrome-controller windows info --json
chrome-controller tabs new https://example.com
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
