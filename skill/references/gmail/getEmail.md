# Gmail Get Email

Use this reference for the built-in Gmail thread-reading command.

## What It Does

This action opens a Gmail thread URL, reads the thread content, and returns structured message
data for the visible messages in that thread.

It is designed to work with the `Open:` Gmail URLs returned by the inbox overview and inbox search
scripts.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

If asked, it can also download the thread's attachments into a local directory.

It is useful for requests like:

- "open this Gmail thread and summarize it"
- "read this email from the inbox results"
- "get the full content of this Gmail message"
- "download the attachments from this Gmail thread to this folder"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension gmail get-email --url "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f"
```

## Options

- `--url <gmail-thread-url>`
  - required Gmail thread URL to open
  - this should usually be the `Open:` URL returned by another Gmail script
- `--download-attachments-to <dir>`
  - optional local directory where the script should save downloaded attachments
- `--download-dir <dir>`
  - alias for `--download-attachments-to`
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the thread status
- the temp file path where the raw JSON was saved
- the requested Gmail URL and current page title
- the thread subject
- how many messages were found and expanded
- downloaded attachment paths when attachment download was requested
- per-message sender, timestamp, recipient summary, attachment names, and body preview

The saved JSON file has this high-level shape:

```json
{
  "status": "ok",
  "requestedUrl": "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f",
  "page": {
    "title": "OYO is hiring - be an early applicant! - ... - Gmail",
    "url": "https://mail.google.com/mail/u/0/#inbox/FMfcgzQgKvDbzLKgCkTqSNhSSfbkNnPC",
    "route": "#inbox/FMfcgzQgKvDbzLKgCkTqSNhSSfbkNnPC"
  },
  "subject": "OYO is hiring - be an early applicant!",
  "legacyThreadId": "19d09010e9d7747f",
  "threadPermId": null,
  "messageSelector": ".adn.ads",
  "messageCount": 1,
  "expandedMessageCount": 1,
  "attachmentsDownloadPath": null,
  "downloadedAttachments": [],
  "attachmentDownloadErrors": [],
  "contentText": "Message 1\nFrom: Naukri <jobalert@naukri.com>\n...",
  "messages": [
    {
      "index": 0,
      "messageId": "#msg-f:1860145048421102719",
      "legacyMessageId": "19d09010e9d7747f",
      "expanded": true,
      "from": {
        "name": "Naukri",
        "email": "jobalert@naukri.com"
      },
      "toText": "me",
      "timeText": "Mar 20, 2026, 7:39 AM",
      "attachmentNames": [],
      "attachments": [],
      "bodyText": "Hi Ananya khandelwal, ...",
      "bodyTextPreview": "Hi Ananya khandelwal, ...",
      "textSnippet": "Naukri <jobalert@naukri.com> ..."
    }
  ]
}
```

## Status Values

- `ok`
  - the Gmail thread was opened and message content was extracted
- `login-required`
  - Gmail appears to be at a sign-in gate instead of the requested thread
- `email-unavailable`
  - Gmail loaded, but the expected thread view did not become available

## Behavior Notes

- The script opens the requested Gmail thread in a temporary tab and closes that tab after reading
  the content.
- It expands common Gmail "show trimmed content" controls before extracting message bodies.
- It extracts thread-level subject information plus per-message sender, recipient summary, time,
  attachment names, and body text.
- If attachment download is requested, the script creates the target directory when needed and
  saves downloaded files there.
- For Gmail attachments, the script prefers Gmail's attachment download metadata when available and
  falls back to the visible download control only if needed.
- The JSON result is saved to a temp directory so the caller can still inspect or parse the raw
  structured output.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a straightforward thread-read.

Fall back to the generic browser flow when:

- the user needs to reply inside the thread
- the user needs to label, archive, forward, or otherwise act on the thread interactively
- the user needs rich rendered HTML fidelity rather than extracted text
- the Gmail thread DOM changed enough that the returned message content is clearly wrong
