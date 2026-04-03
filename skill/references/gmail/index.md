# Gmail Command Index

Use this reference when the task is specifically about Gmail and may match one of the built-in
website commands.

## When To Use

Read this file before using the generic Gmail browser flow when the user asks for a common Gmail
task that we already support with a built-in command.

Use the built-in Gmail command when:

- the user wants a quick overview of the top visible inbox messages
- the user wants to search the inbox for words and get matching messages back
- the user wants to open a Gmail thread URL and read the email content or download its attachments
- the user wants to compose a new Gmail draft, optionally attach local files, or send a well-scoped email
- the user wants to reply to a Gmail thread URL, optionally attach local files, or send the reply
- the task matches a supported Gmail action exactly

Use the generic web workflow instead when:

- the task is not listed below
- the task needs a custom label, filter, or page flow that the built-in action does not support yet
- the built-in action fails because Gmail changed enough that you need to re-explore the page

## Available Actions

- Top N mail overview
  - read [fetchNPosts.md](fetchNPosts.md)
  - command: `npx @ank1015/llm-extension gmail fetch-n-mails`
  - behavior: prints Markdown, saves raw JSON to temp, and paginates with Gmail's `Older` button when needed
- Search inbox
  - read [searchInbox.md](searchInbox.md)
  - command: `npx @ank1015/llm-extension gmail search-inbox`
  - behavior: searches Gmail with an inbox-scoped query, prints Markdown, saves raw JSON to temp, and paginates with Gmail's `Next results` control when needed
- Get email
  - read [getEmail.md](getEmail.md)
  - command: `npx @ank1015/llm-extension gmail get-email`
  - behavior: opens a Gmail thread URL, extracts thread content, optionally downloads attachments to a local directory, and saves raw JSON to temp
- Compose email
  - read [composeEmail.md](composeEmail.md)
  - command: `npx @ank1015/llm-extension gmail compose-email`
  - behavior: creates a Gmail draft by default, can send with `--send`, accepts local attachment paths, and saves raw JSON to temp
- Reply to email
  - read [replyToEmail.md](replyToEmail.md)
  - command: `npx @ank1015/llm-extension gmail reply-to-email`
  - behavior: opens a Gmail thread URL, drafts a reply by default, can attach local files, can send with `--send`, and saves raw JSON to temp

## How To Choose

- If the user says things like "show me the top 5 mails", "summarize the first few Gmail
  messages", "get an inbox overview", or "show me the top 80 Gmail mails", use the built-in
  mail-overview command first.
- If the user says things like "search Gmail for digitalocean", "find inbox mails about invoices",
  "show the top 10 Gmail results for support", or "search my inbox for <words>", use the inbox
  search command first.
- If the user says things like "open this Gmail thread", "read this email", "summarize this Gmail
  message", "get the contents of this thread", or "download this email's attachments", use the
  get-email command first.
- If the user says things like "draft an email to...", "compose a Gmail message", "attach this file
  and prepare an email", or "send this Gmail message", use the compose email command first.
- If the user says things like "reply to this email", "respond to this Gmail thread", "attach this
  file and reply", or "send this reply now", use the reply-to-email command first.
- If the user asks to label or archive a thread, use the generic browser workflow for now.
- If the command returns `login-required` or another `*-unavailable` status, fall back to direct
  browser inspection and verify the current Gmail state.
