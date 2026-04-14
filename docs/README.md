# Chrome Controller Docs

Chrome Controller has two public surfaces:

- the CLI for most one-time browser tasks
- the TypeScript SDK for writing repeatable automations

Use the CLI when you want to inspect a page, click through a flow, debug a site, or complete a task in Chrome right now.

Use the SDK when you already understand the workflow and want to encode it in code that can run again later.

The recommended reading order is:

1. [`cli.md`](./cli.md) for the session model and the full command surface
2. [`sdk.md`](./sdk.md) for the exported SDK methods, types, and connection model
3. [`best-practices.md`](./best-practices.md) for guidance on how to use both well

The CLI is opinionated:

- a session owns one managed Chrome window
- if that managed window disappears, the CLI recreates it automatically
- most commands act on the active session's current tab
- `raw` is the explicit escape hatch

The SDK is intentionally low level:

- no session abstraction
- no remembered current tab
- no snapshot cache or `@eN` refs
- explicit `tabId`-driven automation

If you are unsure which surface to use, start with the CLI. Move to the SDK once the task is stable enough to script.
