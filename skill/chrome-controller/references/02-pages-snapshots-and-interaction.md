# 02. Pages, Snapshots, and Interaction

This page explains how to:

- navigate pages
- extract page content as markdown
- create interactive snapshots
- semantically narrow the page down with `find`
- act on elements
- type with keyboard commands
- move and click with the mouse
- wait for the browser to reach the next state

This is the page most agents will use the most.

## The standard interaction loop

Page and element commands first use the session's current tab when one is set.

If the session does not have a current tab remembered yet, they fall back to the active tab in the managed session window.

That is convenient, but it also means `page goto` can replace the currently active tab when you have not pinned a target yet.

If you are not fully sure which tab is active, first pin the work to a target tab:

```bash
chrome-controller open https://example.com --ready --json
chrome-controller page url
chrome-controller page title
```

If you need to pin an already-open tab manually, use:

```bash
chrome-controller tabs list --json
chrome-controller tabs use 456
chrome-controller page url
chrome-controller page title
```

## Working on SPAs and reactive apps

Single-page apps often rerender after the initial load event.

That means:

- the UI may keep changing after `wait load`
- focus may move unexpectedly
- snapshot refs may go stale after interactions
- the visible content may stream in over time

For SPA-heavy work, prefer this pattern:

1. verify the tab with `page url` or `page title`
2. use `wait load`
3. if the page is still changing, use `wait idle <ms>`
4. run `page snapshot`
5. interact
6. if the page rerenders, run `page snapshot` again

Practical rules:

- verify focus before keyboard-heavy actions
- expect rerenders after clicks, submits, and route changes
- prefer re-snapshotting over reusing old refs
- use `wait idle` when `wait load` is not enough

For most browser tasks, use this loop:

1. use `open --ready` to pin the working tab, or pin an existing tab first
2. run `page find` when you need semantic narrowing or a fuzzy shortlist
3. run `page snapshot` when you want the raw interactive structure
4. interact with `element ...`
5. use `wait ...` to confirm the next state
6. run `page snapshot` again if the page changed

Example:

```bash
chrome-controller open https://example.com/login --ready
chrome-controller page snapshot
chrome-controller element fill @e1 alice@example.com
chrome-controller element fill @e2 secret
chrome-controller element click @e3
chrome-controller wait stable
chrome-controller page snapshot
```

## Semantic discovery with `page find`

### `page find <query> [--limit <n>]`

Use `page find` when you know what you want in natural language, but do not know the exact selector or exact `@eN` yet.

Examples:

```bash
chrome-controller page find "search box and search button"
chrome-controller tabs use 456
chrome-controller page find "repository heading and star button"
chrome-controller page find "the first story link and the comments link for that story" --limit 20 --json
```

What it does:

- captures a fresh interactive snapshot
- captures visible page text
- builds an LLM-facing page model from both
- returns a reranked shortlist of possible matches

Important mental model:

- `page find` does **not** promise the exact answer
- it is a narrowing command, not a final decision command
- it intentionally returns a list of plausible candidates
- noisy results are acceptable if the right answer is present

Use it when:

- the page is too large or noisy for a raw `page snapshot`
- you want a semantic query like "send button", "main heading", or "comments link for the first story"
- you want likely candidates before deciding what to click or inspect

Typical output shape:

```text
## Target: search box
### Element candidates
- @e1 [searchbox type="search"] "Search Wikipedia" selector="#searchInput"

### Text candidates
- Search Wikipedia

## Target: search button
### Element candidates
- @e5 [button] "Search" selector="fieldset > button"
```

How to use the results:

- treat the first few results as the best guesses
- if one of the returned `@eN` refs is clearly right, use it directly in `element ...`
- if the list is still ambiguous, run `page snapshot` or `element text/html/attr` on the candidates
- if the page changed after `page find`, rerun `page find` or `page snapshot` before acting

Notes:

- returned `@eN` refs come from the latest snapshot captured during `page find`
- the command may split one query into multiple target sections
- `--limit` is a maximum, not a guarantee of exact coverage
- the command prefers over-inclusion to under-inclusion
- `--json` includes both the generated page-model markdown and the LLM-ranked markdown result, which is useful for debugging

## Page commands

Page commands always act on the active session's current tab.

Use `tabs use <tabId>` first when you want page commands to work on a different tab in the managed window.

### `page goto <url>`

Navigate a tab to a URL.

Important:

- this navigates the session's current tab
- use `open --ready`, `tabs use`, or `tabs new` when you want safer default targeting across many later commands
- after important navigations, verify with `page url` or `page title`, especially on sites that redirect or update state after load

Examples:

```bash
chrome-controller page goto https://example.com
chrome-controller tabs use 456
chrome-controller page goto https://mail.google.com
chrome-controller page url
chrome-controller page title
```

### `page url`

Return the current page URL.

Example:

```bash
chrome-controller page url --json
```

### `page title`

Return the current page title.

Example:

```bash
chrome-controller page title --json
```

### `page text`

Extract the page as markdown.

Use this when:

- you want readable page content instead of raw HTML
- you want to summarize the page
- you want text for reasoning before deciding what to click

Notes:

- the command prefers the main content area when the page exposes one
- output is markdown, not raw HTML

Examples:

```bash
chrome-controller page text
chrome-controller page text --json
```

### `page snapshot`

Capture the page's interactive structure and assign refs like `@e1`, `@e2`, `@e3`.

This is the main discovery command for UI automation.

Plain output looks like:

```text
Page: Example Login
URL: https://example.com/login

@e1 [textbox] "Email"
@e2 [textbox] "Password"
@e3 [button] "Sign in"
```

Use snapshot refs in later element commands:

```bash
chrome-controller element fill @e1 alice@example.com
chrome-controller element fill @e2 secret
chrome-controller element click @e3
```

Important rules:

- refs are tied to the current page state
- refs are ephemeral and can go stale quickly on SPAs
- if the page changes a lot, run `page snapshot` again
- if a command says the ref is stale or the page changed, rerun `page snapshot`
- JSON output includes selector hints, which can help with `page eval` or debugging

Examples:

```bash
chrome-controller page snapshot
chrome-controller page snapshot --json
```

### `page eval <code> [--await-promise] [--user-gesture]`

Run JavaScript in the page.

Use this as the escape hatch when no dedicated command exists.

Options:

- `--await-promise`: wait for an async expression to resolve
- `--user-gesture`: run the code as if it came from a user gesture

Examples:

```bash
chrome-controller page eval 'document.title'
chrome-controller page eval 'window.location.href' --json
chrome-controller page eval 'fetch("/api/me").then(r => r.text())' --await-promise --json
```

### `page pdf [path] [--format <letter|a4|legal|tabloid>] [--landscape] [--background] [--scale <number>] [--css-page-size]`

Save the current page as a PDF.

Options:

- `path`: output file path
- `--format`: page size
- `--landscape`: use landscape orientation
- `--background`: include background colors and images
- `--scale <number>`: scale the render
- `--css-page-size`: honor the page's CSS page size settings

If you omit `path`, the file is saved under `CHROME_CONTROLLER_HOME/artifacts/pdfs`.

Examples:

```bash
chrome-controller page pdf
chrome-controller page pdf ./invoice.pdf --format a4 --background
```

### `page screenshot [path] [--format <png|jpeg|webp>] [--quality <0-100>] [--full-page]`

Capture a screenshot of the session's current tab.

Options:

- `path`: output file path
- `--format <png|jpeg|webp>`: screenshot format
- `--quality <0-100>`: quality for JPEG output
- `--full-page`: capture beyond the viewport

If you omit `path`, the screenshot is saved under `CHROME_CONTROLLER_HOME/artifacts/screenshots`.

Examples:

```bash
chrome-controller page screenshot
chrome-controller page screenshot ./page.png
chrome-controller page screenshot ./page.jpg --format jpeg --quality 85
chrome-controller page screenshot ./full.webp --format webp --full-page
```

## Element commands

Element commands always act on the active session's current tab.

Use `tabs use <tabId>` first when you want element commands to operate on a different tab in the managed window.

Targets can be:

- a CSS selector
- a snapshot ref like `@e1`

Use snapshot refs when possible.

### `element click <selector|@ref>`

Click the target element.

### `element fill <selector|@ref> <value>`

Replace the current value with `<value>`.

Best for:

- text inputs
- textareas
- content-editable fields

### `element type <selector|@ref> <value> [--delay-ms <n>]`

Type text into the target gradually.

Options:

- `--delay-ms <n>`: delay between characters

### `element press <selector|@ref> <key> [--count <n>]`

Focus the element, then send one or more key presses to the tab.

Use this for:

- pressing Enter on a focused submit button
- moving through a menu or combobox with arrow keys
- confirming a modal action with keyboard input

### `element select <selector|@ref> <value>`

Select an option in a `<select>` element.

You can usually pass either:

- the option value
- the visible label

### `element check <selector|@ref>`

Turn a checkbox or similar control on.

### `element uncheck <selector|@ref>`

Turn a checkbox or similar control off.

Examples:

```bash
chrome-controller element fill @e1 "alice@example.com"
chrome-controller element type @e1 "hello world" --delay-ms 25
chrome-controller element click @e2
chrome-controller element press @e2 Enter
chrome-controller element select @e4 "United States"
chrome-controller element check @e3
```

- `left`
- `top`
- `width`
- `height`
- `centerX`
- `centerY`

## Keyboard commands

Keyboard commands use the session's current tab by default, with fallback to the active tab in the managed session window.

Important:

- `keyboard press` means a key event was sent to the page
- it does not guarantee that the app performed the higher-level action you wanted
- on contenteditable apps, rich editors, and custom composers, always verify focus first
- if pressing Enter should submit something, confirm the result with page state, a new snapshot, or a wait condition

Useful named keys include:

- `Enter`
- `Tab`
- `Escape`
- `Backspace`
- `Delete`
- `Space`
- `ArrowUp`
- `ArrowDown`
- `ArrowLeft`
- `ArrowRight`
- `Home`
- `End`
- `PageUp`
- `PageDown`
- `Shift`
- `Control` or `Ctrl`
- `Alt`
- `Meta`

Single characters also work.

### `keyboard press <key> [--count <n>]`

Press and release a key.

Options:

- `--count <n>`: repeat the key press

Examples:

```bash
chrome-controller keyboard press Enter
chrome-controller keyboard press Tab --count 3
```

Common pattern for contenteditable editors:

```bash
chrome-controller element focus @e1
chrome-controller keyboard type "hello world"
chrome-controller keyboard press Enter
chrome-controller wait idle 500
chrome-controller page snapshot
```

### `keyboard type <text> [--delay-ms <n>]`

Type freeform text.

Options:

- `--delay-ms <n>`: delay between characters

Examples:

```bash
chrome-controller keyboard type "hello world"
chrome-controller keyboard type "123456" --delay-ms 20
```

### `keyboard down <key>`

Hold a key down.

### `keyboard up <key>`

Release a key.

Use `down` and `up` for modifier-based workflows.

Example:

```bash
chrome-controller keyboard down Shift
chrome-controller keyboard press Tab
chrome-controller keyboard up Shift
```

## Mouse commands

Mouse commands are coordinate-based.

They are most useful for:

- drag and drop
- sliders
- canvas
- map controls
- controls that ignore a normal element click

Use `element box` first when you need reliable coordinates.

### `mouse move <x> <y>`

Move the pointer.

### `mouse click <x> <y> [--button <left|middle|right>] [--count <n>]`

Click at coordinates.

Options:

- `--button`: choose `left`, `middle`, or `right`
- `--count <n>`: single, double, or repeated clicks

### `mouse down <x> <y> [--button <left|middle|right>]`

Press a mouse button and keep it down.

### `mouse up <x> <y> [--button <left|middle|right>]`

Release a mouse button.

### `mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>]`

Scroll by wheel delta.

Options:

- `deltaX`: horizontal scroll delta
- `deltaY`: vertical scroll delta
- `--x <x>`: pointer x position while wheeling
- `--y <y>`: pointer y position while wheeling

### `mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>]`

Drag from one coordinate to another.

Options:

- `--steps <n>`: number of intermediate move steps

Examples:

```bash
chrome-controller mouse click 500 400
chrome-controller mouse click 500 400 --button right
chrome-controller mouse wheel 0 900
chrome-controller mouse drag 400 300 800 300 --steps 20
```

## Wait commands

Wait commands are how you make scripts reliable.

They help you avoid racing the page.

All wait commands except `wait idle` act on the active session's current tab.

Use `tabs use <tabId>` first when you want wait commands to target another tab in the managed session window.

Defaults:

- `wait element`, `wait text`, `wait url`, `wait load`, and `wait fn` default to a 30 second timeout
- they poll every 250 ms unless you override `--poll-ms`

### `wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>]`

Wait for an element state.

States:

- `visible`
- `attached`
- `hidden`
- `enabled`

Examples:

```bash
chrome-controller wait element @e3 --state visible
chrome-controller wait element '#submit' --state enabled --timeout-ms 10000
```

### `wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>]`

Wait for text to appear.

Behavior:

- with `--target`, only checks that element
- without `--target`, checks the whole page text

Examples:

```bash
chrome-controller wait text "Welcome back"
chrome-controller wait text "Done" --target @e12
```

### `wait url <text> [--timeout-ms <n>] [--poll-ms <n>]`

Wait for the tab URL to contain a string.

Example:

```bash
chrome-controller wait url "/dashboard"
```

### `wait load [--timeout-ms <n>] [--poll-ms <n>]`

Wait until the tab reports that loading is complete.

Use this for traditional navigations.

On SPAs, `wait load` often means only that the route shell finished loading. The UI may still be rerendering or streaming content.

Example:

```bash
chrome-controller wait load
```

### `wait stable [--quiet-ms <n>] [--timeout-ms <n>] [--poll-ms <n>]`

Wait until the page is quiet enough to interact with reliably.

Behavior:

- waits for the tab and document to finish their initial load
- waits for the DOM to stay quiet for the requested quiet window
- waits for network activity to go quiet for the requested quiet window
- tolerates long-lived background requests once they stop producing new network activity

Use this after clicks, route changes, or `open --ready` when a page keeps doing background work but the visible UI has settled.

Examples:

```bash
chrome-controller wait stable
chrome-controller wait stable --quiet-ms 1000
```

### `wait idle <ms>`

Sleep for a fixed number of milliseconds.

This is often the simplest way to let a reactive page settle after:

- route changes
- streamed responses
- editor updates
- async panels and menus

Example:

```bash
chrome-controller wait idle 500
```

### `wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>]`

Wait for a JavaScript condition to become truthy.

Options:

- `--await-promise`: wait for an async expression before testing its result

Examples:

```bash
chrome-controller wait fn 'document.readyState === "complete"'
chrome-controller wait fn 'Promise.resolve(window.appReady)' --await-promise
```

### `wait download [downloads wait options]`

Shortcut for `downloads wait`.

Use it when a page action triggers a file download and you want to stay in the interaction flow.

Example:

```bash
chrome-controller element click @e8
chrome-controller wait download --filename-includes report --timeout-ms 20000
```
