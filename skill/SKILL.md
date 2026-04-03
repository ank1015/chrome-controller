---
name: web
description: 'Use a managed browser helper to read websites, interact with web apps, inspect network activity, manage tabs, and handle downloads or uploads.'
---

# Web

## When To Use

Use this skill when the user wants to:

- read information from websites or authenticated web apps
- navigate pages, survey an unfamiliar site, or extract structured content
- perform reversible web actions such as creating drafts, filling forms, or clicking through flows
- inspect network activity, debugger events, screenshots, or page state during debugging
- manage tabs, keep a verification tab open, or clean up browser state
- monitor downloads or upload local files through a web app

## Required Reading Order

1. Read this file first.
2. Read [references/api.md](references/api.md) for the helper exports, method signatures, option types, return types, and behavior notes.
3. Read [references/workflow.md](references/workflow.md) for the general algorithm, helper-selection rules, and verification strategy.
4. If the task matches a common built-in website command for a supported site, read that site's index first:
   - Gmail: [references/gmail/index.md](references/gmail/index.md)
   - Google: [references/google/index.md](references/google/index.md)
5. If the task is mostly about reading or extracting information from a page, read [references/read.md](references/read.md).
6. If the task needs page interactions or user-like actions inside a web app, read [references/interact.md](references/interact.md).
7. If the task needs network inspection, screenshots, or Chrome DevTools Protocol access, read [references/debug.md](references/debug.md).
8. If the task is mostly about tabs, windows, navigation state, or browser cleanup, read [references/browser-state.md](references/browser-state.md).
9. If the task involves downloads or file uploads, read [references/downloads.md](references/downloads.md).
10. Read [references/recipes.md](references/recipes.md) only when you need a copyable end-to-end pattern or the task combines multiple modes.
11. Use only the references that match the current task.

## Main Helpers

Import from the package root:

```ts
import {
  WebBrowser,
  WebDebuggerSession,
  WebTab,
  connectWeb,
  withWebBrowser,
} from '@ank1015/llm-agents';
```

The helper surface is organized into three layers:

- top-level session helpers
  - `connectWeb(...)`
  - `withWebBrowser(...)`
- browser and tab helpers
  - browser lifecycle, tab management, raw Chrome access, downloads
  - page readiness, evaluation, markdown, screenshots, uploads
- debugger helpers
  - raw CDP commands
  - captured debugger events
  - network summaries through `captureNetwork(...)`

Use [references/api.md](references/api.md) as the full reference for signatures and return types.

## Common Website Commands

Many repeated tasks on common websites can be handled through ready-to-run CLI commands instead of
rebuilding the page understanding flow from scratch each time.

Use these website-specific references when the task exactly matches one of the built-in actions. If
the built-in action does not fit, fall back to the generic browser workflow and use the helper
primitives directly.

Currently available website references:

- Gmail
  - read [references/gmail/index.md](references/gmail/index.md)
- Google
  - read [references/google/index.md](references/google/index.md)

## Important Constraints

- Prefer `evaluate(...)` plus verification over brittle one-size-fits-all DOM helpers.
- Prefer a built-in website command when it exactly matches the task. Prefer the generic browser
  flow when the task is new, unusual, or the built-in command is too narrow.
- Treat `web.chrome(...)` and `WebDebuggerSession.cdp(...)` as escape hatches when the higher-level helpers are not enough.
- `WebBrowser.close()` closes the helper session. It does not close Chrome itself, so verification tabs can stay open after the command exits.
- The agent should use this skill through `@ank1015/llm-agents` only. Do not import `@ank1015/llm-extension` directly from task code.

## Choose The Next Reference

- Read [references/api.md](references/api.md) for the full helper API surface.
- Read [references/workflow.md](references/workflow.md) for the default algorithm and helper-selection rules.
- Read [references/read.md](references/read.md) for surveys, extraction, feed reading, and markdown capture.
- Read [references/interact.md](references/interact.md) for filling forms, composing drafts, and verifying page actions.
- Read [references/debug.md](references/debug.md) for network capture, screenshots, debugger events, and raw CDP work.
- Read [references/browser-state.md](references/browser-state.md) for tab reuse, cleanup, navigation, and raw Chrome API access.
- Read [references/downloads.md](references/downloads.md) for waiting on downloads and pushing local files into file inputs.
- Read [references/gmail/index.md](references/gmail/index.md) for Gmail-specific built-in actions and their dedicated references.
- Read [references/google/index.md](references/google/index.md) for Google-specific built-in actions and their dedicated references.
- Read [references/recipes.md](references/recipes.md) for compact end-to-end templates that combine several helpers.
