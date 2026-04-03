# Downloads And Uploads

Use this reference together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for choosing between browser-level file helpers and page-specific DOM logic.

## When To Read

Read this reference when the task involves browser-managed files:

- start a download and confirm it completed
- locate the downloaded file
- inspect current download state
- attach local files to a web app through a file input

## Relevant Helpers

- `browser.listDownloads(filter?)`
- `browser.waitForDownload(filter, options?)`
- `browser.chrome(method, ...args)`
- `tab.uploadFiles(selector, paths)`

## Downloads Workflow

1. Trigger the download from the page.
2. Use `waitForDownload(...)` with the narrowest filter you can provide.
3. Require completion unless the task only needs to confirm the download started.
4. Return the filename and state to the user.

```ts
const download = await browser.waitForDownload(
  {
    filenameIncludes: 'report',
  },
  {
    requireComplete: true,
    timeoutMs: 60_000,
  }
);
```

Use `listDownloads(...)` when you need to inspect multiple downloads or poll manually.

## Upload Workflow

`tab.uploadFiles(selector, paths)` is the first-class helper for file inputs:

```ts
await tab.uploadFiles('input[type="file"]', ['/absolute/path/to/report.csv']);
```

The helper validates that the selector points to a file input and uses CDP to set the selected files.

## Important Constraints

- `uploadFiles(...)` works for real file inputs. If the site hides the input behind a custom button, find the actual hidden `<input type="file">`.
- Use absolute local paths when possible so the task is explicit and debuggable.
- If the site uses a nonstandard drag-and-drop upload flow with no file input, you may need raw CDP or a site-specific DOM approach through `evaluate(...)`.

## Verification Tips

- After upload, verify the page acknowledged the file instead of assuming the selection succeeded.
- For downloads, include `state`, `filename`, and any error in the final answer.
