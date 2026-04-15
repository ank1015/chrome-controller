---
name: chrome-controller
description: Control Chrome with the `chrome-controller` CLI and build repeatable browser workflows with the SDK. Exposes almost all chrome extension apis with an opnionated layer for cli to perform most of the browser tasks.
---

# Chrome Controller Guide

This skill explains how to control Chrome with the `chrome-controller` CLI and how to build repeatable scripts with the SDK.

The main workflow is:

- use the CLI to explore and understand the page
- use the SDK to automate the parts that repeat

# Chrome Controller Docs

Chrome Controller has two public surfaces:

- the CLI for most one-time browser tasks
- the TypeScript SDK for writing repeatable automations

Use the CLI when you want to inspect a page, click through a flow, debug a site, or complete a task in Chrome right now.

Use the SDK when you already understand the workflow and want to encode it in code that can run again later.

The recommended reading order is:

1. [`cli.md`](references/cli.md) for setup, the session model, and the full command surface
2. [`sdk.md`](references/sdk.md) for the exported SDK methods, types, and connection model
3. [`best-practices.md`](references/best-practices.md) for guidance on how to use both well

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