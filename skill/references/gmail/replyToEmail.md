# Gmail Reply To Email

Use this reference for the built-in Gmail thread reply command.

## What It Does

This action opens a Gmail thread URL, starts an inline reply, fills the reply body, and creates a
draft reply by default.

If `--send` is passed, it attempts to click Gmail's Send button and waits for a visible send
confirmation or failure message.

If asked, it can also attach local filesystem paths to the reply before saving or sending it.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

It is useful for requests like:

- "reply to this Gmail thread with this message"
- "draft a response to this email"
- "attach this local file and reply to the thread"
- "send this reply now"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension gmail reply-to-email --url "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f" --body "Thanks for the update."
```

## Options

- `--url <gmail-thread-url>`
  - required Gmail thread URL to reply to
  - this should usually be the `Open:` URL returned by another Gmail script
- `--body <text>`
  - plain-text reply body
- `--attachment <path>`
  - local attachment path
  - may be repeated for multiple files
- `--send`
  - send the reply instead of only creating a draft reply
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

At least one of `--body` or `--attachment` must be provided.

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the reply status
- the temp file path where the raw JSON was saved
- the requested Gmail URL and current page title
- the thread subject
- whether send was requested
- the reply body preview
- local attachment paths and attached file names when present
- any Gmail confirmation or failure message

The saved JSON file has this high-level shape:

```json
{
  "status": "draft-created",
  "requestedUrl": "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f",
  "page": {
    "title": "Subject here - Gmail",
    "url": "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f",
    "route": "#inbox/19d09010e9d7747f"
  },
  "subject": "Subject here",
  "bodyPreview": "Thanks for the update.",
  "attachmentPaths": ["/absolute/path/note.txt"],
  "attachedFileNames": ["note.txt"],
  "sendRequested": false,
  "message": "Reply body was populated and Gmail was given time to autosave the draft reply."
}
```

## Status Values

- `draft-created`
  - Gmail reply was filled successfully and given time to autosave a draft reply
- `sent`
  - `--send` was used and Gmail reported that the reply was sent
- `login-required`
  - Gmail appears to be at a sign-in gate instead of the requested thread
- `thread-unavailable`
  - Gmail loaded, but the requested thread did not become available
- `reply-unavailable`
  - Gmail opened the thread, but the reply composer did not become available or could not be filled
- `send-failed`
  - `--send` was used, but Gmail did not confirm a successful send

## Behavior Notes

- The script opens the requested Gmail thread in a temporary tab and closes that tab after the
  reply is saved or sent.
- It expands common Gmail "show trimmed content" controls before trying to reply.
- It targets Gmail's inline reply composer, not a brand-new compose window.
- Local attachments are uploaded from filesystem paths through Gmail's hidden reply attachment
  input.
- By default, the script creates a draft reply and closes the temporary tab after waiting for
  Gmail's autosave cycle.
- If `--send` is passed, the script clicks Gmail's Send button and waits for either a visible send
  confirmation or a visible send failure message.
- The JSON result is saved to a temp directory so the caller can still inspect or parse the raw
  structured output.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a straightforward reply flow.

Fall back to the generic browser flow when:

- the user needs rich formatting, inline images, or custom reply UI options beyond simple text and
  file attachments
- the user needs Gmail-specific actions like reply-all, forward, scheduling, or labels in the same
  flow
- the user needs to inspect the thread content first because the target reply context is ambiguous
- the Gmail thread or reply DOM changed enough that the returned result is clearly wrong
