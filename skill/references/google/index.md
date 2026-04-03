# Google Command Index

Use this reference when the task is specifically about Google web search and may match one of the
built-in website commands.

## When To Use

Read this file before using the generic Google browser flow when the user asks for a search task
that we already support with a built-in command.

Use the built-in Google command when:

- the user wants a Google web search rather than an app-specific site search
- the user wants advanced search filters such as exact phrase, excluded words, language, region,
  file type, or usage rights
- the user wants the top `N` organic Google results, not sponsored results
- the task matches a supported Google action exactly

Use the generic web workflow instead when:

- the task is not listed below
- the user needs to interact with a Google property other than the search flow covered here
- the built-in action fails because Google changed enough that you need to re-explore the page

## Available Actions

- Advanced web search
  - read [search.md](search.md)
  - command: `npx @ank1015/llm-extension google search`
  - behavior: opens Google's Advanced Search page, fills the requested filters through the real
    form, submits the search, saves raw JSON to temp, prints Markdown, and skips sponsored results

## How To Choose

- If the user says things like "search Google for...", "find the top 10 results for...", or
  "search Google with these filters", use the built-in Google search command first.
- If the user mentions exact phrase, excluded words, language, region, file type, usage rights, or
  domain restrictions, the built-in search command is a strong match.
- If the user needs only organic search results and does not want ads or sponsored blocks, use the
  built-in search command first.
- If the command returns `captcha` or `search-unavailable`, fall back to direct browser inspection
  and verify Google's current page state.
