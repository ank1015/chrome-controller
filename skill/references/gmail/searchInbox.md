# Gmail Search Inbox

Use this reference for the built-in Gmail inbox search command.

## What It Does

This action searches Gmail with the given words, scopes the search to the inbox, and returns the
matching mails in the same overview structure used by the inbox overview script.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

It is useful for requests like:

- "search Gmail for digitalocean"
- "find inbox mails about invoices"
- "show the top 10 Gmail results for support"
- "search my inbox for npm publish emails"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension gmail search-inbox --query "digitalocean" --count 5
```

## Options

- `--query <words>`
  - required Gmail search words
  - the script automatically scopes the query to the inbox by prepending `in:inbox` when needed
- `--count <n>`
  - number of matching mails to collect
  - default: `5`
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the search query and the inbox-scoped query that was actually used
- the temp file path where the raw JSON was saved
- Gmail page title and search result summary
- how many rows were visible on the current page
- the top collected matching mails
- a direct Gmail `Open:` link for each mail when a legacy thread id is available

The saved JSON file has this high-level shape:

```json
{
  "status": "ok",
  "query": "digitalocean",
  "inboxQuery": "in:inbox digitalocean",
  "page": {
    "title": "Search results - ... - Gmail",
    "url": "https://mail.google.com/mail/u/0/#search/in%3Ainbox+digitalocean",
    "route": "#search/in%3Ainbox+digitalocean"
  },
  "rowSelector": "tr.zA",
  "visibleRowCount": 27,
  "resultText": "1–27 of 27",
  "noResults": false,
  "mails": [
    {
      "index": 0,
      "rowId": ":2d",
      "legacyThreadId": "19d06c3e16dfc2fe",
      "threadId": "#thread-f:1860105660031550206",
      "openUrl": "https://mail.google.com/mail/u/0/#inbox/19d06c3e16dfc2fe",
      "sender": "DigitalOcean Support",
      "senderEmail": "support@digitalocean.com",
      "subject": "Droplet Increase Request",
      "snippet": "...",
      "time": "Mar 19",
      "unread": true,
      "selected": false,
      "starred": true,
      "textSnippet": "..."
    }
  ]
}
```

## Status Values

- `ok`
  - search results were found, or Gmail clearly returned an empty result set
- `login-required`
  - Gmail appears to be at a sign-in gate instead of a search results view
- `search-unavailable`
  - Gmail loaded, but the expected search results view was not available

## Behavior Notes

- The script opens a Gmail search route directly using an inbox-scoped query.
- If the query does not already contain `in:inbox`, the script adds it automatically.
- It waits for browser load, waits for Gmail to expose either search results, a no-results state,
  or a login gate, and then extracts the matching rows from the current page.
- If `--count` is greater than the current page size, it clicks Gmail's `Next results` control and
  continues collecting mails from later result pages until it reaches `N` or Gmail has no next
  page.
- The script uses a temporary search tab and closes it after finishing so it does not leave the
  user's main Gmail tab stranded on a different search page.
- The current observed search row selector is `tr.zA`, but the script also tries a few Gmail-specific
  fallbacks before giving up.
- The JSON result is saved to a temp directory so the caller can still inspect or parse the raw
  structured output.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a simple inbox search.

Fall back to the generic browser flow when:

- the user needs Gmail search operators or flows that are more complex than a straightforward inbox
  search
- the user needs thread-level reading after the search
- the user needs to act on the search results interactively
- the Gmail search DOM changed enough that the returned data is clearly wrong
