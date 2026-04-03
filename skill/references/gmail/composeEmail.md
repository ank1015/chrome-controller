# Gmail Compose Email

Use this reference for the built-in Gmail compose command.

## What It Does

This action opens Gmail compose in a dedicated tab, fills recipients, subject, body, and optional
local file attachments, and creates a draft by default.

If `--send` is passed, it attempts to click Gmail's Send button and waits for a send confirmation
or a visible send failure message.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

It is useful for requests like:

- "draft an email to Alice about tomorrow's meeting"
- "compose a Gmail message with this subject and body"
- "attach this local file and prepare an email"
- "send this Gmail message now"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension gmail compose-email --to "person@example.com" --subject "Hello" --body "Draft body"
```

## Options

- `--to <emails>`
  - comma-separated `To` recipients
- `--cc <emails>`
  - comma-separated `Cc` recipients
- `--bcc <emails>`
  - comma-separated `Bcc` recipients
- `--subject <text>`
  - subject text
- `--body <text>`
  - plain-text body content
- `--attachment <path>`
  - local attachment path
  - may be repeated for multiple files
- `--send`
  - send the message instead of only creating a draft
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the compose status
- the temp file path where the raw JSON was saved
- the compose URL and page title
- recipients, subject, and a body preview
- local attachment paths and attached file names when present
- whether send was requested and any Gmail confirmation or failure message

The saved JSON file has this high-level shape:

```json
{
  "status": "draft-created",
  "composeUrl": "https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1&to=person%40example.com&su=Hello&body=Draft+body",
  "page": {
    "title": "Compose Mail - ... - Gmail",
    "url": "https://mail.google.com/mail/u/0/?fs=1&tf=cm&to=person@example.com&su=Hello&body=Draft+body",
    "route": "?fs=1&tf=cm&to=person@example.com&su=Hello&body=Draft+body"
  },
  "recipients": {
    "to": ["person@example.com"],
    "cc": [],
    "bcc": []
  },
  "subject": "Hello",
  "bodyPreview": "Draft body",
  "attachmentPaths": ["/absolute/path/note.txt"],
  "attachedFileNames": ["note.txt"],
  "sendRequested": false,
  "message": "Compose fields were populated and Gmail was given time to autosave the draft."
}
```

## Status Values

- `draft-created`
  - Gmail compose was filled successfully and given time to autosave a draft
- `sent`
  - `--send` was used and Gmail reported that the message was sent
- `login-required`
  - Gmail appears to be at a sign-in gate instead of compose
- `compose-unavailable`
  - Gmail loaded, but the expected compose view did not become available
- `send-failed`
  - `--send` was used, but Gmail did not confirm a successful send

## Behavior Notes

- The script opens Gmail's dedicated compose route in a temporary tab.
- It prefills `to`, `cc`, `bcc`, `subject`, and `body` through the compose URL, then applies real
  compose-field edit events so Gmail treats the message as a real draft instead of a passive
  prefilled form.
- Local attachments are uploaded from filesystem paths through Gmail's hidden compose file input.
- By default, the script creates a draft and closes the temporary compose tab after waiting for
  Gmail's autosave cycle.
- If `--send` is passed, the script clicks Gmail's Send button and waits for either a visible send
  confirmation or a visible send failure message.
- This action is for brand-new composed messages, not replying inside an existing thread.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a straightforward compose flow.

Fall back to the generic browser flow when:

- the user needs to reply in an existing thread
- the user needs rich formatting, inline images, or custom compose UI options beyond simple fields
- the user needs Gmail-specific send scheduling, labels, or other advanced compose features
- the Gmail compose DOM changed enough that the returned result is clearly wrong
