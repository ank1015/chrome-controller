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

If you need safety, start by choosing an explicit tab, not by assuming a new session gave you a clean browser.

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

## Windows

Use window commands when you need to inspect or arrange Chrome windows.

Because sessions are not browser-isolated, `windows` and `tabs` are often the safest place to start. Inspect the real browser state first, then choose exactly which tab to control.

### `windows list`

List all windows.

Typical use:

- see how many windows are open
- get a `windowId` before moving tabs or focusing a window

Example:

```bash
chrome-controller windows list --json
```

### `windows current`

Return the current window.

Example:

```bash
chrome-controller windows current --json
```

### `windows get <id>`

Return details for one window.

Example:

```bash
chrome-controller windows get 123 --json
```

### `windows create`

Open a new Chrome window.

Options:

- `--url <url>`: open the window with a specific page
- `--focused`: focus the new window
- `--incognito`: open it in incognito mode
- `--type <type>`: set the window type
- `--state <state>`: set the window state like `normal`, `maximized`, `minimized`, or `fullscreen`
- `--left <n>`: left screen position
- `--top <n>`: top screen position
- `--width <n>`: width in pixels
- `--height <n>`: height in pixels

Examples:

```bash
chrome-controller windows create --url https://example.com --focused
chrome-controller windows create --state maximized
chrome-controller windows create --left 0 --top 0 --width 1400 --height 900
```

### `windows focus <id>`

Focus a window.

Example:

```bash
chrome-controller windows focus 123
```

### `windows close <id>`

Close a window.

Example:

```bash
chrome-controller windows close 123
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
chrome-controller tabs list --json
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page url --tab 456
chrome-controller page title --tab 456
```

Then continue with `--tab 456` on later commands.

Why this is safer:

- `page goto` without `--tab` will navigate the active tab
- the active tab may not be the tab you intended
- `tabs open` without `--active=false` may open as the active tab depending on Chrome behavior
- an explicit tab id removes ambiguity

### `tabs list [--window <id>] [--all]`

List tabs.

Options:

- `--window <id>`: list tabs from a specific window
- `--all`: list tabs from all windows

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
chrome-controller windows current --json
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

### Split work across windows

```bash
chrome-controller windows create --url https://news.ycombinator.com --focused
chrome-controller windows list --json
chrome-controller tabs move 456 --window 123 --index 0
```
