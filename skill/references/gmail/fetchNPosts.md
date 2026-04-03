# Gmail Top N Mail Overview

Use this reference for the built-in Gmail inbox overview command.

## What It Does

This action fetches the top `N` Gmail inbox mails and can continue across older inbox pages when
`N` is greater than the 50 rows Gmail shows on one page.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

It is useful for requests like:

- "show me the top 5 emails"
- "summarize the first few Gmail messages"
- "get a quick inbox overview"
- "show me the top 75 inbox mails"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension gmail fetch-n-mails --count 5
```

## Options

- `--count <n>`
  - number of inbox mails to collect
  - default: `5`
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the temp file path where the raw JSON was saved
- Gmail page title and URL
- how many rows were visible on the current page
- the top collected mails
- a direct Gmail `Open:` link for each mail when a legacy thread id is available

The saved JSON file has this high-level shape:

```json
{
  "status": "ok",
  "page": {
    "title": "Inbox (...) - ... - Gmail",
    "url": "https://mail.google.com/mail/u/0/#inbox",
    "route": "inbox"
  },
  "rowSelector": "tr.zA",
  "visibleRowCount": 50,
  "mails": [
    {
      "index": 0,
      "rowId": ":2d",
      "legacyThreadId": "19d06c3e16dfc2fe",
      "threadId": "#thread-f:1860105660031550206",
      "openUrl": "https://mail.google.com/mail/u/0/#inbox/19d06c3e16dfc2fe",
      "sender": "bigbasket",
      "senderEmail": "alert@info.bigbasket.com",
      "subject": "Eid's Menu Recipe Contest & More",
      "snippet": "...",
      "time": "9:13 PM",
      "unread": true,
      "selected": false,
      "starred": true,
      "textSnippet": "..."
    }
  ]
}
```

## Thread Links

- Gmail inbox rows do not expose a normal anchor for opening a thread.
- The script reads Gmail's legacy thread id from the row DOM and builds an inbox thread URL like
  `https://mail.google.com/mail/u/0/#inbox/<legacyThreadId>`.
- That URL can be used as a direct "open this mail thread" link in the returned summary and JSON.

## Status Values

- `ok`
  - inbox rows were found and returned
- `login-required`
  - Gmail appears to be at a sign-in gate instead of an inbox view
- `inbox-unavailable`
  - Gmail loaded, but the expected inbox rows were not found

## Behavior Notes

- The script reuses an existing Gmail tab when possible.
- If no Gmail tab exists, it opens `https://mail.google.com/mail/u/0/#inbox`.
- It waits for browser load, waits for Gmail to expose either inbox content or a login gate, then
  extracts inbox rows from the current page.
- If `--count` is greater than the current page size, it clicks Gmail's `Older` button and
  continues collecting mails from older pages until it reaches `N` or Gmail has no older page.
- For multi-page collection, the script uses a temporary inbox tab so it does not leave the user's
  main inbox tab stranded on an older page after the script finishes.
- The current observed inbox row selector is `tr.zA`, but the script also tries a few Gmail-specific
  fallbacks before giving up.
- The JSON result is saved to a temp directory so the caller can still inspect or parse the raw
  structured output.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a simple inbox overview.

Fall back to the generic browser flow when:

- the user needs a different Gmail view
- the user needs thread-level reading
- the user needs exact Gmail paging control beyond "keep going older until N mails are collected"
- the inbox DOM changed enough that the returned data is clearly wrong
- the task becomes interactive or mutating
