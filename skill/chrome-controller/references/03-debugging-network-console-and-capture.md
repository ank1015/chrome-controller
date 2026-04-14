# 03. Debugging, Network, Console, and Capture

This page explains how to inspect what the browser is doing while a task runs.

Use these commands when you need to:

- send raw Chrome DevTools Protocol commands
- call raw browser APIs through the bridge
- read console output
- capture network traffic
- take screenshots and PDFs

## Raw commands

`raw` is the explicit advanced escape hatch.

Use it when the opinionated CLI surface does not expose the browser or CDP capability you need.

### `raw browser <method> [argsJson]`

Call any browser/bridge method directly.

Notes:

- `argsJson` is optional
- if `argsJson` is a JSON array, its values are passed as positional arguments
- if `argsJson` is any other JSON value, it is passed as one argument

Examples:

```bash
chrome-controller raw browser windows.getAll '[{"populate":true}]'
chrome-controller raw browser tabs.query '[{"active":true}]'
```

### `raw cdp <method> [paramsJson]`

Send any CDP command to the active session tab.

Notes:

- the command auto-attaches the debugger for the call if needed
- it detaches afterwards if it attached the debugger itself
- `paramsJson` must be a JSON object when provided

Examples:

```bash
chrome-controller raw cdp Runtime.evaluate '{"expression":"document.title","returnByValue":true}'
chrome-controller raw cdp Page.captureScreenshot '{}'
```

## Observe commands

Use `observe` as the preferred top-level surface for runtime signals:

- `chrome-controller observe console ...`
- `chrome-controller observe network ...`
- `chrome-controller observe downloads ...`

## Console commands

Console commands read console entries from the page.

They act on the active session's current tab.

Use them when:

- you want browser errors and warnings
- you want `console.log` output from the app
- you want to tail logs while interacting with a page

### `observe console list [--limit <n>] [--clear]`

Read console entries.

Options:

- `--limit <n>`: return only the most recent entries
- `--clear`: clear them after reading

Examples:

```bash
chrome-controller observe console list
chrome-controller observe console list --limit 100 --json
chrome-controller observe console list --clear --json
```

### `observe console tail [--limit <n>] [--timeout-ms <n>] [--poll-ms <n>]`

Wait for new console entries.

Defaults:

- timeout: 5000 ms
- poll interval: 250 ms

Options:

- `--limit <n>`: how many new entries to return
- `--timeout-ms <n>`: how long to wait
- `--poll-ms <n>`: how often to check

Example:

```bash
chrome-controller observe console tail --timeout-ms 15000 --json
```

### `observe console clear`

Clear stored console entries.

Example:

```bash
chrome-controller observe console clear
```

## Network commands

Use network commands to inspect requests and responses.

They act on the active session's current tab.

Typical workflow:

1. start capture
2. do the page action
3. read a summary or request list
4. fetch one request or export HAR

### `observe network start [--no-clear] [--disable-cache]`

Start capturing network traffic.

Options:

- `--no-clear`: keep old captured events instead of clearing them first
- `--disable-cache`: disable browser cache for cleaner debugging

Example:

```bash
chrome-controller observe network start --disable-cache
```

### `observe network stop`

Stop network capture for the tab.

Example:

```bash
chrome-controller observe network stop
```

### `observe network list [--limit <n>] [--url-includes <text>] [--status <code>] [--failed]`

List captured requests.

Options:

- `--limit <n>`: cap the number of returned requests
- `--url-includes <text>`: only requests whose URL contains text
- `--status <code>`: only requests with a specific response status
- `--failed`: only failed requests

Examples:

```bash
chrome-controller observe network list --json
chrome-controller observe network list --failed --json
chrome-controller observe network list --url-includes /api/ --status 500 --json
```

### `observe network get <requestId>`

Return full details for one request.

Use this after getting a request id from `network list`.

Important:

- this is a raw, forensic view of the captured debugger events for one request
- it can be large and noisy
- it is better for deep inspection than for quick summaries
- if you only need a high-level view, start with `observe network summary` or `observe network list`
- sensitive values are redacted by default, but the payload is still intentionally low-level

Example:

```bash
chrome-controller observe network get req-123 --json
```

### `observe network summary`

Return an aggregate summary of captured traffic.

Example:

```bash
chrome-controller observe network summary --json
```

### `observe network clear`

Clear stored network events.

Example:

```bash
chrome-controller observe network clear
```

### `observe network export-har <path>`

Export captured traffic as HAR.

Example:

```bash
chrome-controller observe network export-har ./capture.har
```

### `observe network block <pattern...>`

Block one or more URL patterns.

Examples:

```bash
chrome-controller observe network block '*://*.doubleclick.net/*'
chrome-controller observe network block '*://*.ads.com/*' '*://tracker.example/*'
```

### `observe network unblock`

Clear network blocking rules.

Example:

```bash
chrome-controller observe network unblock
```

### `observe network offline <on|off>`

Toggle offline mode.

Examples:

```bash
chrome-controller observe network offline on
chrome-controller observe network offline off
```

### `observe network throttle <slow-3g|fast-3g|slow-4g|off>`

Apply a built-in network throttling profile.

Examples:

```bash
chrome-controller observe network throttle slow-3g
chrome-controller observe network throttle off
```

## Screenshot capture

Use `page screenshot` when you need visual confirmation or an artifact to inspect later.

### `page screenshot [path] [--format <png|jpeg|webp>] [--quality <0-100>] [--full-page]`

Capture the active session tab.

Options:

- `path`: output file path
- `--format <png|jpeg|webp>`: screenshot format
- `--quality <0-100>`: quality for JPEG output
- `--full-page`: capture beyond the viewport

Notes:

- if `path` is omitted, the screenshot is saved under `CHROME_CONTROLLER_HOME/artifacts/screenshots`
- `--quality` only matters for JPEG

Examples:

```bash
chrome-controller page screenshot
chrome-controller page screenshot ./page.png
chrome-controller page screenshot ./page.jpg --format jpeg --quality 85
chrome-controller page screenshot ./full.png --full-page
```

## PDF capture

PDF is covered by `page pdf`, not `screenshot`.

Examples:

```bash
chrome-controller page pdf ./report.pdf
chrome-controller page pdf ./report.pdf --format a4 --background
```

## Practical debugging playbooks

### Find a failing XHR

```bash
chrome-controller observe network start --disable-cache
chrome-controller page goto https://example.com
chrome-controller wait load
chrome-controller observe network list --failed --json
```

### Read recent browser warnings

```bash
chrome-controller observe console list --limit 100 --json
```

### Inspect a page with raw CDP

```bash
chrome-controller raw cdp DOM.getDocument '{"depth":1,"pierce":false}' --json
chrome-controller raw cdp Runtime.evaluate '{"expression":"document.title","returnByValue":true}' --json
```

### Capture a reproducible artifact bundle

```bash
chrome-controller page screenshot ./page.png
chrome-controller page pdf ./page.pdf
chrome-controller observe network export-har ./page.har
chrome-controller observe console list --json
```
