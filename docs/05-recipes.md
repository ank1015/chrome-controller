# 05. Recipes

This page gives practical command sequences for common browser tasks.

Use these when you want a safe starting point instead of building the flow from scratch.

## Safe navigation

Use this when you want to open a page without risking an unrelated active tab.

```bash
chrome-controller tabs list --json
chrome-controller tabs open https://example.com --active=false --json
chrome-controller page url --tab 456
chrome-controller page title --tab 456
chrome-controller page snapshot --tab 456
```

Why this pattern is safe:

- it avoids `page goto` on an unknown active tab
- it gets you a concrete `tabId`
- it verifies the tab before you start interacting

## Login flow

Use this for a typical username/password login flow.

```bash
chrome-controller tabs open https://example.com/login --active=false --json
chrome-controller page snapshot --tab 456
chrome-controller element fill @e1 "alice@example.com" --tab 456
chrome-controller element fill @e2 "supersecret" --tab 456
chrome-controller element click @e3 --tab 456
chrome-controller wait load --tab 456
chrome-controller wait idle 1000
chrome-controller page url --tab 456
chrome-controller page title --tab 456
chrome-controller page snapshot --tab 456
```

For reactive apps:

- add `wait idle` after submit
- rerun `page snapshot` after the page settles

## Inbox scraping

Use this when you need to open an inbox page and read visible message content.

```bash
chrome-controller tabs open https://mail.google.com --active=false --json
chrome-controller wait load --tab 456
chrome-controller wait idle 1500
chrome-controller page snapshot --tab 456
chrome-controller page text --tab 456
```

If the inbox is highly dynamic:

- use `page snapshot` to identify the visible rows or controls
- click into one item
- use `page text` again on the opened message view

## Prompt submission

Use this for chat or composer-style apps.

```bash
chrome-controller tabs open https://chatgpt.com --active=false --json
chrome-controller wait load --tab 456
chrome-controller wait idle 1500
chrome-controller page snapshot --tab 456
chrome-controller element focus @e1 --tab 456
chrome-controller element fill @e1 "Summarize the latest README changes." --tab 456
chrome-controller keyboard press Enter --tab 456
chrome-controller wait idle 1000
chrome-controller page snapshot --tab 456
```

Important:

- on rich editors, `keyboard press Enter` means the key event was sent
- it does not guarantee the app submitted the prompt
- if nothing happened, use the snapshot again and click the explicit send button

## Network inspection

Use this to inspect requests triggered by one action.

```bash
chrome-controller network start --disable-cache --tab 456
chrome-controller element click @e8 --tab 456
chrome-controller wait idle 1500
chrome-controller network summary --tab 456 --json
chrome-controller network list --tab 456 --json
chrome-controller network get req-123 --tab 456 --json
```

Tips:

- start with `network summary`
- then use `network list`
- only use `network get` for deep inspection of one request

## File upload

Use this when the page has a file input.

```bash
chrome-controller page snapshot --tab 456
chrome-controller upload files 'input[type=file]' ./resume.pdf --tab 456
chrome-controller wait idle 1000
chrome-controller page snapshot --tab 456
```

If the upload button is hidden behind a custom control:

- click the control first
- then target the underlying file input with `upload files`

## Download handling

Use this when a page action should create a download.

```bash
chrome-controller element click @e8 --tab 456
chrome-controller wait download --filename-includes report --timeout-ms 20000 --json
chrome-controller downloads list --state complete --json
```

Useful follow-up commands:

- `downloads wait` when you want to block until the file is finished
- `downloads list` when you want to inspect what Chrome recorded
- `downloads cancel` or `downloads erase` for cleanup

## SPA reliability pattern

Use this whenever the page keeps rerendering.

```bash
chrome-controller page url --tab 456
chrome-controller page title --tab 456
chrome-controller wait load --tab 456
chrome-controller wait idle 1000
chrome-controller page snapshot --tab 456
```

After each important action:

- use `wait idle` if the UI is still changing
- rerun `page snapshot`
- avoid reusing old refs longer than necessary
