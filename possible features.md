# Possible Features

This file tracks useful follow-up features for the `chrome-controller` CLI.

## Isolation

- `session create --fresh-window`
- `session create --new-window`
- `session create --new-tab`
- `session create --incognito-context`
- `session create --profile temp`

## Safer Defaults

- safe mode that requires explicit `--tab` once multiple tabs exist
- consider a less misleading product term or alias for `session`

## Text-Based Targeting

- `element click --text "Profile"`
- `element find "Show more activity"`

## Filtered And Compact Snapshots

- `page snapshot --find "Profile"`
- `page snapshot --role button`
- `page snapshot --region main`
- `page snapshot --search "Send prompt"`
- `page snapshot --compact`
- `page snapshot --interactive-only`
- `page snapshot --visible-only`
- `page snapshot --omit-repeated`

## Stability And Dynamic Pages

- `wait stable` that combines DOM quietness, network quietness, and mutation settling
- a “what changed” mode for reactive pages
- auto-retry-on-stale mode for actions on dynamic pages

## Stable Element Handles

- `element alias composer @e1`
- lightweight named aliases that survive rediscovery better than raw `@eN` refs

## Structured Extraction

- `page query <selector> --fields text,href,value,visible`

This would reduce the need to reach for `page eval` in common cases.

## Section-Aware Text Extraction

- `page text --heading "Contribution activity"`
- `page text --selector main`

## Combined Commands

- `page goto <url> --wait load`
- `tabs open <url> --wait load`

## Higher-Level Actions

- `element submit`
- `page prompt`
- `chat send`
- `wait stream-complete`
- `wait response-done`

## Current Context Summary

- Add a command that shows the current session, window, active tab, title, and URL together.

## Focus Introspection

- `page active-element`
- `element focused`

## More Agent-Native Helpers

- list links by text
- extract tables
- summarize visible lists
- fill forms by label
- expose clickable ancestors explicitly

## Output And Reporting

- richer success reporting for state-changing commands across the board, even after the `page goto` fix

## Network Investigation

- friendlier views over raw `network get`
- `network latest --path /backend-api/f/conversation`
- `network headers <id>`
- `network cookies <id>`
- `network auth <id>`
- `network body <id>`
- timestamps and ordering metadata directly in `network list`
