# 04. State, Cookies, Uploads, and Downloads

This page explains how to manage browser data and files:

- localStorage and sessionStorage
- reusable login state
- cookies
- file uploads
- downloads

Use these commands when you need to preserve state across runs or interact with file inputs and downloaded files.

## Storage commands

Storage commands work against the active tab by default.

They cover:

- `localStorage`
- `sessionStorage`
- full browser state export/import for a tab

## Local storage

### `storage local-get [key] [--tab <id>]`

Read one localStorage key or all keys.

Behavior:

- with `key`, returns one value
- without `key`, returns all items

Examples:

```bash
chrome-controller storage local-get
chrome-controller storage local-get authToken --json
```

### `storage local-set <key> <value> [--tab <id>]`

Set one localStorage key.

Example:

```bash
chrome-controller storage local-set theme dark
```

### `storage local-clear [key] [--tab <id>]`

Clear one localStorage key or all keys.

Examples:

```bash
chrome-controller storage local-clear authToken
chrome-controller storage local-clear
```

## Session storage

### `storage session-get [key] [--tab <id>]`

Read one sessionStorage key or all keys.

### `storage session-set <key> <value> [--tab <id>]`

Set one sessionStorage key.

### `storage session-clear [key] [--tab <id>]`

Clear one sessionStorage key or all keys.

Examples:

```bash
chrome-controller storage session-get
chrome-controller storage session-set wizardStep 3
chrome-controller storage session-clear wizardStep
```

## Full state export and import

These commands capture:

- localStorage
- sessionStorage
- cookies

They are the easiest way to save and restore an authenticated browser state.

### `storage state-save <path> [--tab <id>]`

Save state to a JSON file.

Example:

```bash
chrome-controller storage state-save ./state.json
```

### `storage state-load <path> [--reload] [--tab <id>]`

Load state from a JSON file.

Options:

- `--reload`: reload the tab after applying the state

Example:

```bash
chrome-controller storage state-load ./state.json --reload
```

## Cookies commands

Cookie commands default to the current active tab URL when you do not provide a scope.

That means this works:

```bash
chrome-controller cookies list
```

You can override the scope with:

- `--url <url>`
- `--domain <domain>`
- `--all`

## Cookie listing and lookup

### `cookies list [--url <url>] [--domain <domain>] [--all] [--limit <n>] [--tab <id>]`

List cookies in scope.

Options:

- `--url <url>`: use a specific URL scope
- `--domain <domain>`: use a domain scope
- `--all`: ignore tab/url scoping and list everything accessible
- `--limit <n>`: cap the number of returned cookies

Examples:

```bash
chrome-controller cookies list
chrome-controller cookies list --domain example.com --json
chrome-controller cookies list --all --limit 200 --json
```

### `cookies get <name> [--url <url>] [--tab <id>]`

Get one cookie by name.

Example:

```bash
chrome-controller cookies get sessionid --json
chrome-controller cookies get sessionid --url https://example.com --json
```

## Set and clear cookies

### `cookies set <name> <value> [--url <url>] [--domain <domain>] [--path <path>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>] [--tab <id>]`

Set a cookie.

Options:

- `--url <url>`: target URL
- `--domain <domain>`: cookie domain
- `--path <path>`: cookie path
- `--secure`: mark the cookie secure
- `--http-only`: mark the cookie httpOnly
- `--same-site <value>`: sameSite value
- `--expires <unixSeconds>`: Unix timestamp expiration

Examples:

```bash
chrome-controller cookies set session abc123 --url https://example.com
chrome-controller cookies set consent yes --domain example.com --path / --secure
```

### `cookies clear [name] [--url <url>] [--domain <domain>] [--all] [--tab <id>]`

Clear cookies in scope.

Behavior:

- with `name`, clears that cookie
- without `name`, clears all matching cookies

Examples:

```bash
chrome-controller cookies clear sessionid
chrome-controller cookies clear --domain example.com
chrome-controller cookies clear --all
```

## Export and import cookies

### `cookies export <path> [--url <url>] [--domain <domain>] [--all] [--tab <id>]`

Export cookies to a JSON file.

Example:

```bash
chrome-controller cookies export ./cookies.json
```

### `cookies import <path> [--url <url>] [--tab <id>]`

Import cookies from a JSON file.

Example:

```bash
chrome-controller cookies import ./cookies.json
```

## Upload command

Use uploads for file input elements.

### `upload files <selector> <path...> [--tab <id>]`

Attach one or more local files to a file input.

Important note:

- the target should be a file input selector, such as `input[type=file]`

Examples:

```bash
chrome-controller upload files 'input[type=file]' ./resume.pdf
chrome-controller upload files '#attachments' ./a.png ./b.png
```

## Downloads commands

Use download commands to find, wait for, cancel, or erase downloaded items.

## Download listing

### `downloads list [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--limit <n>]`

List downloads with optional filters.

Options:

- `--id <id>`: match one download id
- `--state <state>`: match a state like `complete`, `in_progress`, or `interrupted`
- `--filename-includes <text>`: filter by filename substring
- `--url-includes <text>`: filter by source URL substring
- `--mime <type>`: filter by mime type
- `--limit <n>`: cap the result count

Examples:

```bash
chrome-controller downloads list
chrome-controller downloads list --state complete --json
chrome-controller downloads list --filename-includes report --mime application/pdf --json
```

## Wait for a download

### `downloads wait [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--timeout-ms <n>] [--poll-ms <n>] [--allow-incomplete]`

Wait for a matching download.

By default, this waits for a completed download.

Options:

- `--timeout-ms <n>`: how long to wait
- `--poll-ms <n>`: how often to check
- `--allow-incomplete`: return even if the download is not complete yet

Examples:

```bash
chrome-controller downloads wait --filename-includes report --timeout-ms 20000 --json
chrome-controller downloads wait --mime application/pdf --allow-incomplete --json
```

You can also call the same behavior through:

```bash
chrome-controller wait download --filename-includes report --timeout-ms 20000
```

## Cancel and erase downloads

### `downloads cancel <downloadId...>`

Cancel one or more downloads.

Example:

```bash
chrome-controller downloads cancel 11 12
```

### `downloads erase <downloadId...>`

Erase one or more downloads from Chrome's download history.

Example:

```bash
chrome-controller downloads erase 11 12
```

## Practical state and file workflows

### Save a login session after signing in manually

```bash
chrome-controller storage state-save ./login-state.json
```

### Restore a saved login session

```bash
chrome-controller storage state-load ./login-state.json --reload
```

### Seed a site with cookies before loading it

```bash
chrome-controller cookies import ./cookies.json
chrome-controller page goto https://example.com
chrome-controller wait load
```

### Upload a file, then wait for the exported report

```bash
chrome-controller page snapshot
chrome-controller upload files 'input[type=file]' ./input.csv
chrome-controller element click @e8
chrome-controller downloads wait --filename-includes report --timeout-ms 30000 --json
```
