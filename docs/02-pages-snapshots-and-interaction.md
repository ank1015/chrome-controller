# 02. Pages, Snapshots, and Interaction

This page explains how to:

- navigate pages
- extract page content as markdown
- create interactive snapshots
- act on elements
- type with keyboard commands
- move and click with the mouse
- wait for the browser to reach the next state

This is the page most agents will use the most.

## The standard interaction loop

Page and element commands default to the active tab in the current window.

That is convenient, but it also means `page goto` without `--tab` can replace the currently active tab.

If you are not fully sure which tab is active, first pin the work to a tab id:

```bash
chrome-controller tabs list --json
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page url --tab 456
chrome-controller page title --tab 456
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

1. navigate to the page
2. run `page snapshot`
3. interact with `element ...`
4. use `wait ...` to confirm the next state
5. run `page snapshot` again if the page changed

Example:

```bash
chrome-controller page goto https://example.com/login
chrome-controller wait load
chrome-controller page snapshot
chrome-controller element fill @e1 alice@example.com
chrome-controller element fill @e2 secret
chrome-controller element click @e3
chrome-controller wait load
chrome-controller page snapshot
```

## Page commands

Page commands use the active tab in the current window by default.

Pass `--tab <id>` when you want a specific tab.

### `page goto <url> [--tab <id>]`

Navigate a tab to a URL.

Important:

- without `--tab`, this navigates the active tab in the current window
- use `--tab` when you want safe, explicit targeting
- after important navigations, verify with `page url` or `page title`, especially on sites that redirect or update state after load

Examples:

```bash
chrome-controller page goto https://example.com
chrome-controller page goto https://example.com --tab 456
chrome-controller page goto https://mail.google.com --tab 456
chrome-controller page url --tab 456
chrome-controller page title --tab 456
```

### `page url [--tab <id>]`

Return the current page URL.

Example:

```bash
chrome-controller page url --json
```

### `page title [--tab <id>]`

Return the current page title.

Example:

```bash
chrome-controller page title --json
```

### `page text [--tab <id>]`

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

### `page snapshot [--tab <id>]`

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

### `page eval <code> [--await-promise] [--user-gesture] [--tab <id>]`

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

### `page pdf [path] [--format <letter|a4|legal|tabloid>] [--landscape] [--background] [--scale <number>] [--css-page-size] [--tab <id>]`

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

## Element commands

Element commands accept either:

- a CSS selector
- a snapshot ref like `@e1`

Use snapshot refs when possible.

### Action commands

### `element click <selector|@ref> [--tab <id>]`

Normal click.

### `element dblclick <selector|@ref> [--tab <id>]`

Double click.

### `element rightclick <selector|@ref> [--tab <id>]`

Context click.

### `element hover <selector|@ref> [--tab <id>]`

Move pointer over an element.

Useful for:

- menus
- tooltips
- hover-revealed controls

### `element focus <selector|@ref> [--tab <id>]`

Focus an element without typing into it yet.

### `element scroll-into-view <selector|@ref> [--tab <id>]`

Scroll the target into view.

Examples:

```bash
chrome-controller element click @e3
chrome-controller element dblclick '#row-4'
chrome-controller element hover @e9
chrome-controller element focus 'input[name="email"]'
chrome-controller element scroll-into-view @e15
```

### Value and form commands

### `element fill <selector|@ref> <value> [--tab <id>]`

Replace the current value with `<value>`.

Best for:

- text inputs
- textareas
- content-editable fields

### `element type <selector|@ref> <value> [--delay-ms <n>] [--tab <id>]`

Type text into the target gradually.

Options:

- `--delay-ms <n>`: delay between characters

### `element clear <selector|@ref> [--tab <id>]`

Clear an input or editable target.

### `element select <selector|@ref> <value> [--tab <id>]`

Select an option in a `<select>` element.

You can usually pass either:

- the option value
- the visible label

### `element check <selector|@ref> [--tab <id>]`

Turn a checkbox or similar control on.

### `element uncheck <selector|@ref> [--tab <id>]`

Turn a checkbox or similar control off.

Examples:

```bash
chrome-controller element fill @e1 "alice@example.com"
chrome-controller element type @e2 "hello world" --delay-ms 25
chrome-controller element clear '#search'
chrome-controller element select '@e4' "United States"
chrome-controller element check '@e9'
```

### Read commands

Use these when you need information about one element.

### `element text <selector|@ref> [--tab <id>]`

Return the visible text content.

### `element html <selector|@ref> [--tab <id>]`

Return the element HTML.

### `element attr <selector|@ref> <name> [--tab <id>]`

Return one attribute value.

### `element value <selector|@ref> [--tab <id>]`

Return the current form value.

### `element visible <selector|@ref> [--tab <id>]`

Return whether the element is visible.

### `element enabled <selector|@ref> [--tab <id>]`

Return whether the element is enabled.

### `element checked <selector|@ref> [--tab <id>]`

Return whether the target is checked.

### `element box <selector|@ref> [--tab <id>]`

Return the live element bounding box.

Use this before mouse commands when you need coordinates.

Example:

```bash
chrome-controller element box @e12 --json
```

The JSON result includes positions such as:

- `left`
- `top`
- `width`
- `height`
- `centerX`
- `centerY`

## Keyboard commands

Keyboard commands act on the active tab by default.

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

### `keyboard press <key> [--count <n>] [--tab <id>]`

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

### `keyboard type <text> [--delay-ms <n>] [--tab <id>]`

Type freeform text.

Options:

- `--delay-ms <n>`: delay between characters

Examples:

```bash
chrome-controller keyboard type "hello world"
chrome-controller keyboard type "123456" --delay-ms 20
```

### `keyboard down <key> [--tab <id>]`

Hold a key down.

### `keyboard up <key> [--tab <id>]`

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

### `mouse move <x> <y> [--tab <id>]`

Move the pointer.

### `mouse click <x> <y> [--button <left|middle|right>] [--count <n>] [--tab <id>]`

Click at coordinates.

Options:

- `--button`: choose `left`, `middle`, or `right`
- `--count <n>`: single, double, or repeated clicks

### `mouse down <x> <y> [--button <left|middle|right>] [--tab <id>]`

Press a mouse button and keep it down.

### `mouse up <x> <y> [--button <left|middle|right>] [--tab <id>]`

Release a mouse button.

### `mouse wheel <deltaX> <deltaY> [--x <x>] [--y <y>] [--tab <id>]`

Scroll by wheel delta.

Options:

- `deltaX`: horizontal scroll delta
- `deltaY`: vertical scroll delta
- `--x <x>`: pointer x position while wheeling
- `--y <y>`: pointer y position while wheeling

### `mouse drag <fromX> <fromY> <toX> <toY> [--steps <n>] [--tab <id>]`

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

Defaults:

- `wait element`, `wait text`, `wait url`, `wait load`, and `wait fn` default to a 30 second timeout
- they poll every 250 ms unless you override `--poll-ms`

### `wait element <selector|@ref> [--state <visible|attached|hidden|enabled>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

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

### `wait text <text> [--target <selector|@ref>] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

Wait for text to appear.

Behavior:

- with `--target`, only checks that element
- without `--target`, checks the whole page text

Examples:

```bash
chrome-controller wait text "Welcome back"
chrome-controller wait text "Done" --target @e12
```

### `wait url <text> [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

Wait for the tab URL to contain a string.

Example:

```bash
chrome-controller wait url "/dashboard"
```

### `wait load [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

Wait until the tab reports that loading is complete.

Use this for traditional navigations.

On SPAs, `wait load` often means only that the route shell finished loading. The UI may still be rerendering or streaming content.

Example:

```bash
chrome-controller wait load
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

### `wait fn <expression> [--await-promise] [--timeout-ms <n>] [--poll-ms <n>] [--tab <id>]`

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
