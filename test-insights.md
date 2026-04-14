
## 2026-04-15 Task 1: LinkedIn latest DM summary
- CLI errors: None observed during this task.
- CLI response issues: `page snapshot --find` returned long accessibility-heavy, concatenated snippets. It exposed useful ordering, but it was harder than necessary to quickly confirm sender, thread state, and the exact latest received message.
- UX gaps: There is no higher-level workflow for common inbox tasks like "open latest conversation" or "summarize latest received DM," so the operator has to manually infer intent from `page snapshot` and `page text` outputs.

## 2026-04-15 Task 2: Instagram latest DM summary
- CLI errors: Running `chrome-controller wait stable` and `chrome-controller page text ...` in parallel on the same tab caused the error `Another debugger is already attached to the tab with id: 1415401330.` The commands appear to contend for a single debugger attachment.
- CLI response issues: `page snapshot --find` on the Instagram inbox made the top conversation list hard to interpret. The first result looked like an unread thread but the label was ambiguous and did not clearly expose the actual sender/thread identity.
- UX gaps: Common inbox workflows are still very manual. It would be much easier if the CLI had a higher-level way to list recent threads with normalized fields like sender, unread state, preview, and timestamp, then open one deterministically.

## 2026-04-15 Task 3: X latest received DM summary
- CLI errors: `chrome-controller page snapshot --limit 200` failed with `--limit can only be used with --find for page snapshot`, which conflicts with the docs format that presents `page snapshot [--find <query>] [--limit <n>]` as if `--limit` were independently available.
- CLI response issues: On X DMs, `page snapshot` and `page text` exposed almost none of the inbox/thread content even when the page was clearly loaded. I had to fall back to `page eval` and inspect `data-testid` DOM content directly to identify recent conversations and the active thread.
- UX gaps: There is no ergonomic way to list normalized DM rows on X from the CLI. A purpose-built inbox/thread inspector for common messaging surfaces would make tasks like "latest received DM" much easier and far less brittle than manual DOM extraction.
