# 04. State, Cookies, Uploads, and Downloads

This page explains how to manage browser data and files:

- localStorage and sessionStorage
- reusable login state
- cookies
- file uploads
- downloads

Use these commands when you need to preserve state across runs or interact with file inputs and downloaded files.

Preferred command surface:

- `chrome-controller state local ...`
- `chrome-controller state session ...`
- `chrome-controller state save ...`
- `chrome-controller state load ...`
- `chrome-controller state cookies ...`

## Storage commands

Storage commands use the session's current tab by default, with fallback to the active tab in the managed session window.

They cover:

- `localStorage`
- `sessionStorage`
- full browser state export/import for a tab

## Local storage

### `state local get [key]`

Read one localStorage key or all keys.

Behavior:

- with `key`, returns one value
- without `key`, returns all items

Examples:

```bash
chrome-controller state local get
chrome-controller state local get authToken --json
```

### `state local set <key> <value>`

Set one localStorage key.

Example:

```bash
chrome-controller state local set theme dark
```

### `state local clear [key]`

Clear one localStorage key or all keys.

Examples:

```bash
chrome-controller state local clear authToken
chrome-controller state local clear
```

## Session storage

### `state session get [key]`

Read one sessionStorage key or all keys.

### `state session set <key> <value>`

Set one sessionStorage key.

### `state session clear [key]`

Clear one sessionStorage key or all keys.

Examples:

```bash
chrome-controller state session get
chrome-controller state session set wizardStep 3
chrome-controller state session clear wizardStep
```

## Full state export and import

These commands capture:

- localStorage
- sessionStorage
- cookies

They are the easiest way to save and restore an authenticated browser state.

### `state save <path>`

Save state to a JSON file.

Example:

```bash
chrome-controller state save ./state.json
```

### `state load <path> [--reload]`

Load state from a JSON file.

Options:

- `--reload`: reload the tab after applying the state

Example:

```bash
chrome-controller state load ./state.json --reload
```

## Cookies commands

Cookie commands use the session's current tab URL first when you do not provide a scope, with fallback to the active tab URL in the managed session window.

That means this works:

```bash
chrome-controller state cookies list
```

You can override the scope with:

- `--url <url>`
- `--domain <domain>`
- `--all`

## Cookie listing and lookup

### `state cookies list [--url <url>] [--domain <domain>] [--all] [--limit <n>]`

List cookies in scope.

Options:

- `--url <url>`: use a specific URL scope
- `--domain <domain>`: use a domain scope
- `--all`: ignore tab/url scoping and list everything accessible
- `--limit <n>`: cap the number of returned cookies

Examples:

```bash
chrome-controller state cookies list
chrome-controller state cookies list --domain example.com --json
chrome-controller state cookies list --all --limit 200 --json
```

### `state cookies get <name> [--url <url>]`

Get one cookie by name.

Example:

```bash
chrome-controller state cookies get sessionid --json
chrome-controller state cookies get sessionid --url https://example.com --json
```

## Set and clear cookies

### `state cookies set <name> <value> [--url <url>] [--domain <domain>] [--path <path>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>]`

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
chrome-controller state cookies set session abc123 --url https://example.com
chrome-controller state cookies set consent yes --domain example.com --path / --secure
```

### `state cookies clear [name] [--url <url>] [--domain <domain>] [--all]`

Clear cookies in scope.

Behavior:

- with `name`, clears that cookie
- without `name`, clears all matching cookies

Examples:

```bash
chrome-controller state cookies clear sessionid
chrome-controller state cookies clear --domain example.com
chrome-controller state cookies clear --all
```

## Export and import cookies

### `state cookies export <path> [--url <url>] [--domain <domain>] [--all]`

Export cookies to a JSON file.

Example:

```bash
chrome-controller state cookies export ./cookies.json
```

### `state cookies import <path> [--url <url>]`

Import cookies from a JSON file.

Example:

```bash
chrome-controller state cookies import ./cookies.json
```

## Upload command

Use uploads for file input elements.

### `upload files <selector> <path...>`

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

### `observe downloads list [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--limit <n>]`

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
chrome-controller observe downloads list
chrome-controller observe downloads list --state complete --json
chrome-controller observe downloads list --filename-includes report --mime application/pdf --json
```

## Wait for a download

### `observe downloads wait [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--timeout-ms <n>] [--poll-ms <n>] [--allow-incomplete]`

Wait for a matching download.

By default, this waits for a completed download.

Options:

- `--timeout-ms <n>`: how long to wait
- `--poll-ms <n>`: how often to check
- `--allow-incomplete`: return even if the download is not complete yet

Examples:

```bash
chrome-controller observe downloads wait --filename-includes report --timeout-ms 20000 --json
chrome-controller observe downloads wait --mime application/pdf --allow-incomplete --json
```

You can also call the same behavior through:

```bash
chrome-controller wait download --filename-includes report --timeout-ms 20000
```

## Cancel and erase downloads

### `observe downloads cancel <downloadId...>`

Cancel one or more downloads.

Example:

```bash
chrome-controller observe downloads cancel 11 12
```

### `observe downloads erase <downloadId...>`

Erase one or more downloads from Chrome's download history.

Example:

```bash
chrome-controller observe downloads erase 11 12
```

## Practical state and file workflows

### Save a login session after signing in manually

```bash
chrome-controller state save ./login-state.json
```

### Restore a saved login session

```bash
chrome-controller state load ./login-state.json --reload
```

### Seed a site with cookies before loading it

```bash
chrome-controller state cookies import ./cookies.json
chrome-controller page goto https://example.com
chrome-controller wait load
```

### Upload a file, then wait for the exported report

```bash
chrome-controller page snapshot
chrome-controller upload files 'input[type=file]' ./input.csv
chrome-controller element click @e8
chrome-controller observe downloads wait --filename-includes report --timeout-ms 30000 --json
```
