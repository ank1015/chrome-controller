# Chrome Controller Docs

Chrome Controller has two public surfaces:

- the CLI for most one-time browser tasks
- the TypeScript SDK for writing repeatable automations

Use the CLI when you want to inspect a page, click through a flow, debug a site, or complete a task in Chrome right now.

Use the SDK when you already understand the workflow and want to encode it in code that can run again later.

The SDK stays npm-only. The standalone release artifacts are for the CLI and native host only.

The recommended reading order is:

1. [`cli.md`](./cli.md) for setup, the session model, and the full command surface
2. [`sdk.md`](./sdk.md) for the exported SDK methods, types, and connection model
3. [`best-practices.md`](./best-practices.md) for guidance on how to use both well

The CLI is opinionated:

- a session owns one managed Chrome window
- if that managed window disappears, the CLI recreates it automatically
- `session create` and `session use` set the active session for later commands
- most commands act on the active session's current tab
- `--session <id>` is mainly for multi-session work when you want to target another session without switching the active one
- `raw` is the explicit escape hatch

The SDK is intentionally low level:

- no session abstraction
- no remembered current tab
- no snapshot cache or `@eN` refs
- explicit `tabId`-driven automation

If you are unsure which surface to use, start with the CLI. Move to the SDK once the task is stable enough to script.

Before using the CLI for the first time, run `chrome-controller setup` to choose the Chrome profile that should host the extension and native messaging bridge. Setup currently supports macOS and Windows.

CLI distribution options:

- npm package: install with `npm` or run with `npx`
- standalone release zip: unzip the platform release and run `chrome-controller setup` from that folder
