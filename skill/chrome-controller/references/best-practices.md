# Best Practices

## Prefer Filtered Page Retrieval

- `page snapshot` gives you the interactive page elements up to the snapshot limit. Use it when you need `@eN` refs for clicking, filling, selecting, or checking.
- `page text` gives you the visible page text as markdown. Use it when you need readable content, summaries, headings, or exact page copy.
- When either output is too broad, add `--find "<query>"` to get a filtered relevant view directly.
- `--find` is a semantic narrowing tool, not an exact query language. It tries to return the most useful relevant candidates for the task.
- Write the find query in the language of the task, not in DOM terms. It can combine related intents, for example `compose related or send related`.

Examples:

```bash
chrome-controller page text --find "top 3 inbox messages or unread mail summaries"
chrome-controller page snapshot --find "compose related or send related"
```

## Prefer Default Waits First

- `wait stable` already includes built-in defaults for timeout, polling, and quiet-window detection.
- Start with plain `chrome-controller wait stable` or `chrome-controller open <url> --ready`.
- Add `--timeout-ms`, `--poll-ms`, or `--quiet-ms` only when the app is unusually slow, unusually noisy, or you are actively debugging readiness behavior.

Examples:

```bash
chrome-controller open https://mail.google.com --ready
chrome-controller wait stable
chrome-controller wait stable --timeout-ms 45000 --quiet-ms 1000
```

## Prefer Native Navigation Commands

- Use `page back` when you want to return to the previous page in the current tab.
- Use `element click --new-tab` when you want to open a link in a background tab without losing your place on the current page.
- After opening a link in a new tab, use `tabs list` and `tabs use <tabId>` if you want to switch into it intentionally.
- When Enter should submit a specific form or search field, prefer `element press <field> Enter` instead of a global `keyboard press Enter`.

Examples:

```bash
chrome-controller element click @e12 --new-tab
chrome-controller element press 'input[name=\"q\"]' Enter
chrome-controller tabs list
chrome-controller page back
```
