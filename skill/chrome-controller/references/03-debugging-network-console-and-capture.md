# 03. Debugging, Network, Console, and Capture

This page explains how to inspect what the browser is doing while a task runs.

Use these commands when you need to:

- attach the debugger
- send raw Chrome DevTools Protocol commands
- inspect debugger events
- read console output
- capture network traffic
- take screenshots and PDFs

## Debugger commands

The debugger gives you raw access to Chrome DevTools Protocol domains like `Page`, `Network`, `Runtime`, `DOM`, and more.

Use debugger commands when:

- you need a feature that does not have a dedicated CLI command yet
- you want to inspect low-level CDP events
- you want to enable protocol domains directly

### `debugger attach [--tab <id>]`

Attach the debugger to a tab.

Example:

```bash
chrome-controller debugger attach
chrome-controller debugger attach --tab 456
```

### `debugger detach [--tab <id>]`

Detach the debugger from a tab.

Example:

```bash
chrome-controller debugger detach
```

### `debugger cmd <method> [--params-json <json>] [--tab <id>]`

Send a raw CDP command.

Options:

- `--params-json <json>`: JSON object of method parameters

Examples:

```bash
chrome-controller debugger cmd Runtime.enable
chrome-controller debugger cmd Network.enable --params-json '{}'
chrome-controller debugger cmd Page.navigate --params-json '{"url":"https://example.com"}'
```

### `debugger events [--filter <prefix>] [--limit <n>] [--clear] [--tab <id>]`

Read stored debugger events.

Options:

- `--filter <prefix>`: only include events whose method starts with a prefix like `Network.` or `Runtime.`
- `--limit <n>`: return only the most recent `n` events
- `--clear`: clear the returned events after reading

Examples:

```bash
chrome-controller debugger events --json
chrome-controller debugger events --filter Network. --limit 20 --json
chrome-controller debugger events --filter Runtime. --clear --json
```

### `debugger clear-events [--filter <prefix>] [--tab <id>]`

Clear stored debugger events.

Examples:

```bash
chrome-controller debugger clear-events
chrome-controller debugger clear-events --filter Network.
```

## Console commands

Console commands read console entries from the page.

Use them when:

- you want browser errors and warnings
- you want `console.log` output from the app
- you want to tail logs while interacting with a page

### `console list [--limit <n>] [--clear] [--tab <id>]`

Read console entries.

Options:

- `--limit <n>`: return only the most recent entries
- `--clear`: clear them after reading

Examples:

```bash
chrome-controller console list
chrome-controller console list --limit 100 --json
chrome-controller console list --clear --json
```

### `console tail [--limit <n>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

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
chrome-controller console tail --timeout-ms 15000 --json
```

### `console clear [--tab <id>]`

Clear stored console entries.

Example:

```bash
chrome-controller console clear
```

## Network commands

Use network commands to inspect requests and responses.

Typical workflow:

1. start capture
2. do the page action
3. read a summary or request list
4. fetch one request or export HAR

### `network start [--no-clear] [--disable-cache] [--tab <id>]`

Start capturing network traffic.

Options:

- `--no-clear`: keep old captured events instead of clearing them first
- `--disable-cache`: disable browser cache for cleaner debugging

Example:

```bash
chrome-controller network start --disable-cache
```

### `network stop [--tab <id>]`

Stop network capture for the tab.

Example:

```bash
chrome-controller network stop
```

### `network list [--limit <n>] [--url-includes <text>] [--status <code>] [--failed] [--tab <id>]`

List captured requests.

Options:

- `--limit <n>`: cap the number of returned requests
- `--url-includes <text>`: only requests whose URL contains text
- `--status <code>`: only requests with a specific response status
- `--failed`: only failed requests

Examples:

```bash
chrome-controller network list --json
chrome-controller network list --failed --json
chrome-controller network list --url-includes /api/ --status 500 --json
```

### `network get <requestId> [--tab <id>]`

Return full details for one request.

Use this after getting a request id from `network list`.

Important:

- this is a raw, forensic view of the captured debugger events for one request
- it can be large and noisy
- it is better for deep inspection than for quick summaries
- if you only need a high-level view, start with `network summary` or `network list`
- sensitive values are redacted by default, but the payload is still intentionally low-level

Example:

```bash
chrome-controller network get req-123 --json
```

### `network summary [--tab <id>]`

Return an aggregate summary of captured traffic.

Example:

```bash
chrome-controller network summary --json
```

### `network clear [--tab <id>]`

Clear stored network events.

Example:

```bash
chrome-controller network clear
```

### `network export-har <path> [--tab <id>]`

Export captured traffic as HAR.

Example:

```bash
chrome-controller network export-har ./capture.har
```

### `network block <pattern...> [--tab <id>]`

Block one or more URL patterns.

Examples:

```bash
chrome-controller network block '*://*.doubleclick.net/*'
chrome-controller network block '*://*.ads.com/*' '*://tracker.example/*'
```

### `network unblock [--tab <id>]`

Clear network blocking rules.

Example:

```bash
chrome-controller network unblock
```

### `network offline <on|off> [--tab <id>]`

Toggle offline mode.

Examples:

```bash
chrome-controller network offline on
chrome-controller network offline off
```

### `network throttle <slow-3g|fast-3g|slow-4g|off> [--tab <id>]`

Apply a built-in network throttling profile.

Examples:

```bash
chrome-controller network throttle slow-3g
chrome-controller network throttle off
```

## Screenshot command

Use screenshots when you need visual confirmation or an artifact to inspect later.

### `screenshot take [path] [--format <png|jpeg|webp>] [--quality <0-100>] [--full-page] [--tab <id>]`

Capture the current tab.

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
chrome-controller screenshot take
chrome-controller screenshot take ./page.png
chrome-controller screenshot take ./page.jpg --format jpeg --quality 85
chrome-controller screenshot take ./full.png --full-page
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
chrome-controller network start --disable-cache
chrome-controller page goto https://example.com
chrome-controller wait load
chrome-controller network list --failed --json
```

### Read recent browser warnings

```bash
chrome-controller console list --limit 100 --json
```

### Inspect a page with raw CDP

```bash
chrome-controller debugger attach
chrome-controller debugger cmd DOM.enable
chrome-controller debugger events --limit 50 --json
```

### Capture a reproducible artifact bundle

```bash
chrome-controller screenshot take ./page.png
chrome-controller page pdf ./page.pdf
chrome-controller network export-har ./page.har
chrome-controller console list --json
```
