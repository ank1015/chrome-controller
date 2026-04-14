# CLI

The CLI is the opinionated surface for controlling Chrome through this project.

## Mental Model

- `session` is the unit of CLI state
- every session owns one managed Chrome window
- if that window is missing, the CLI recreates it automatically
- `tabs` commands only work inside that managed window
- the session remembers one current tab
- `page`, `element`, `keyboard`, `mouse`, `upload`, `wait`, `observe`, and `state` act on that current tab or its URL scope
- `raw` is the advanced escape hatch

## Global Flags

These flags work with normal CLI commands:

- `--json`
- `--session <id>` to override the active session for a single command
- `--help`
- `-h`

In most single-session workflows, you do not need `--session`. After `session create` or `session use`, that session is already active.

## Top-Level Commands

```bash
chrome-controller session ...
chrome-controller windows ...
chrome-controller tabs ...
chrome-controller open <url> ...
chrome-controller page ...
chrome-controller element ...
chrome-controller keyboard ...
chrome-controller mouse ...
chrome-controller upload ...
chrome-controller wait ...
chrome-controller observe ...
chrome-controller state ...
chrome-controller raw ...
```

## Session Model

Important defaults:

- `session create` creates a new managed window
- `session create` also makes the new session active immediately
- `session use` switches the current session
- `session close` removes the session and closes its managed window when possible
- `session reset` recreates the managed window and clears the remembered current tab
- commands that need the managed window auto-recreate it if it has been closed manually
- use `--session <id>` when you want to target another session without switching away from the current one

## Session Commands

```bash
chrome-controller session create [--id <id>]
chrome-controller session create --session <id>
chrome-controller session info [<id>]
chrome-controller session list
chrome-controller session use <id>
chrome-controller session close [<id>]
chrome-controller session reset [<id>]
```

Examples:

```bash
chrome-controller session create --id gmail-task
chrome-controller open https://mail.google.com
chrome-controller page text --find "top 3 inbox messages"
```

```bash
chrome-controller session create --id agent-a
chrome-controller session create --id agent-b
chrome-controller page title --session agent-a
chrome-controller page title --session agent-b
```

## Window Commands

All window commands act on the active session's managed window.

```bash
chrome-controller windows info
chrome-controller windows focus
chrome-controller windows resize <width> <height>
chrome-controller windows move <left> <top>
chrome-controller windows maximize
chrome-controller windows minimize
chrome-controller windows restore
```

`restore` returns a minimized, maximized, or fullscreen managed window to the normal state.

## Tab Commands

All tab commands act inside the active session's managed window.

```bash
chrome-controller tabs list
chrome-controller tabs current
chrome-controller tabs new [url]
chrome-controller tabs use <tabId>
chrome-controller tabs close
chrome-controller tabs close-others
chrome-controller tabs reload
chrome-controller tabs duplicate
```

Notes:

- `tabs new` always creates a fresh tab and makes it current
- `tabs use` switches to an existing managed-window tab and makes it current
- use `open` when you want to reuse an exact URL match instead of always creating a new tab

## Open

`open` is the safest high-level way to move work to a URL.

```bash
chrome-controller open <url> [--active[=<bool>]] [--pinned[=<bool>]] [--ready] [--timeout-ms <n>] [--poll-ms <n>] [--quiet-ms <n>]
```

Notes:

- opens a tab or reuses an exact URL match inside the managed window
- pins that tab as the session's current tab
- defaults to `--active=false`
- `--ready` waits for stable page readiness
- when you use `--ready`, the default wait tuning is `--timeout-ms 30000 --poll-ms 250 --quiet-ms 500`
- only override those wait flags for unusually slow pages, very noisy apps, or debugging

## Page Commands

All page commands act on the active session's current tab.

```bash
chrome-controller page goto <url>
chrome-controller page back
chrome-controller page url
chrome-controller page title
chrome-controller page text [--find <query> [--limit <n>]]
chrome-controller page snapshot [--find <query>] [--limit <n>]
chrome-controller page eval <code> [--await-promise] [--user-gesture]
chrome-controller page pdf [path] [--format <letter|a4|legal|tabloid>] [--landscape] [--background] [--scale <number>] [--css-page-size]
chrome-controller page screenshot [path] [--format <png|jpeg|webp>] [--quality <0-100>] [--full-page]
```

Notes:

- `page back` goes to the previous browser history entry for the current tab
- `page snapshot` captures the interactive structure used for `@eN` refs
- add `--find "<query>"` to `page text` when you want filtered relevant text instead of the full page markdown
- add `--find "<query>"` to `page snapshot` when you want a filtered shortlist of relevant `@eN` elements instead of the full interactive snapshot
- on raw `page snapshot`, `--limit` caps how many visible elements are shown
- `--find` is semantic narrowing, not an exact query language. It tries to return the most useful relevant candidates for the task.
- when you need precise interactive targets, prefer `page snapshot --find ...`; when you need readable content, prefer `page text --find ...`
- `page eval` runs JavaScript in the current tab
- when no PDF path is given, output goes under `CHROME_CONTROLLER_HOME/artifacts/pdfs`
- when no screenshot path is given, output goes under `CHROME_CONTROLLER_HOME/artifacts/screenshots`

Examples:

```bash
chrome-controller page text --find "top 3 inbox messages or unread mail summaries"
chrome-controller page snapshot --find "compose related or send related"
chrome-controller page back
```

## Element Commands

All element commands act on the active session's current tab.

Targets can be CSS selectors or snapshot refs like `@e1`.

```bash
chrome-controller element click <selector|@ref> [--new-tab] [--retry-stale]
chrome-controller element fill <selector|@ref> <value>
chrome-controller element type <selector|@ref> <value> [--delay-ms <n>]
chrome-controller element press <selector|@ref> <key> [--count <n>]
chrome-controller element select <selector|@ref> <value>
chrome-controller element check <selector|@ref>
chrome-controller element uncheck <selector|@ref>
```

Note:

- add `--new-tab` to open a link in a background tab. It uses Command-click on macOS and Ctrl-click elsewhere
- add `--retry-stale` to retry transient detached or re-render races on dynamic pages
- for form or search submission, prefer `element press <field> Enter` over a global `keyboard press Enter`

## Keyboard Commands

All keyboard commands act on the active session's current tab.

```bash
chrome-controller keyboard press <key> [--count <n>]
chrome-controller keyboard type <text> [--delay-ms <n>]
chrome-controller keyboard down <key>
chrome-controller keyboard up <key>
```

Note:

- `keyboard press` sends keys to the current page generally
- when Enter should apply to a specific search box or form field, prefer `element press <selector|@ref> Enter`

## Mouse Commands

All mouse commands act on the active session's current tab.

```bash
chrome-controller mouse move <x> <y>
chrome-controller mouse click <x> <y> [--button <left|middle|right>] [--count <n>]
chrome-controller mouse down <x> <y> [--button <left|middle|right>]
chrome-controller mouse up <x> <y> [--button <left|middle|right>]
chrome-controller mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>]
chrome-controller mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>]
```

## Upload Commands

All upload commands act on the active session's current tab.

```bash
chrome-controller upload files <selector> <path...>
```

## Wait Commands

All wait commands except `wait idle` act on the active session's current tab.

```bash
chrome-controller wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait url <text> [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait load [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait stable [--quiet-ms <n>] [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait idle <ms>
chrome-controller wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller wait download [downloads wait options]
```

Notes:

- `wait stable` already defaults to `--timeout-ms 30000 --poll-ms 250 --quiet-ms 500`
- in the common case, start with `chrome-controller wait stable` and only add flags when the app is unusually slow or noisy

## Observe Commands

`observe` is the grouped surface for console, network, and downloads.

### Console

```bash
chrome-controller observe console list [--limit <n>] [--clear]
chrome-controller observe console tail [--limit <n>] [--timeout-ms <n>] [--poll-ms <n>]
chrome-controller observe console clear
```

### Network

```bash
chrome-controller observe network start [--no-clear] [--disable-cache]
chrome-controller observe network stop
chrome-controller observe network list [--limit <n>] [--url-includes <text>] [--status <code>] [--failed]
chrome-controller observe network get <requestId>
chrome-controller observe network summary
chrome-controller observe network clear
chrome-controller observe network export-har <path>
chrome-controller observe network block <pattern...>
chrome-controller observe network unblock
chrome-controller observe network offline <on|off>
chrome-controller observe network throttle <slow-3g|fast-3g|slow-4g|off>
```

### Downloads

```bash
chrome-controller observe downloads list [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--limit <n>]
chrome-controller observe downloads wait [--id <id>] [--state <state>] [--filename-includes <text>] [--url-includes <text>] [--mime <type>] [--timeout-ms <n>] [--poll-ms <n>] [--allow-incomplete]
chrome-controller observe downloads cancel <downloadId...>
chrome-controller observe downloads erase <downloadId...>
```

## State Commands

`state` is the grouped surface for storage and cookies.

### Storage

```bash
chrome-controller state local get [key]
chrome-controller state local set <key> <value>
chrome-controller state local clear [key]
chrome-controller state session get [key]
chrome-controller state session set <key> <value>
chrome-controller state session clear [key]
chrome-controller state save <path>
chrome-controller state load <path> [--reload]
```

### Cookies

```bash
chrome-controller state cookies list [--url <url>] [--domain <domain>] [--all] [--limit <n>]
chrome-controller state cookies get <name> [--url <url>]
chrome-controller state cookies set <name> <value> [--url <url>] [--domain <domain>] [--path <path>] [--secure] [--http-only] [--same-site <value>] [--expires <unixSeconds>]
chrome-controller state cookies clear [name] [--url <url>] [--domain <domain>] [--all]
chrome-controller state cookies export <path> [--url <url>] [--domain <domain>] [--all]
chrome-controller state cookies import <path> [--url <url>]
```

## Raw Commands

`raw` is the explicit advanced escape hatch.

```bash
chrome-controller raw browser <method> [argsJson]
chrome-controller raw cdp <method> [paramsJson]
```

Notes:

- `raw browser` calls bridge/browser methods directly
- `raw cdp` sends a CDP command to the active session tab
- use this only when the opinionated surface does not expose what you need
