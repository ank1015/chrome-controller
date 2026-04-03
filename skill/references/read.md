# Read Pages

Use this reference together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for the general task flow.

## When To Read

Read this reference when the task is primarily about understanding what is on a website or web app:

- surveying an unfamiliar site
- extracting the top visible items from a page
- reading docs or articles
- gathering structured page data without mutating user state

## Primary Helpers

Import from `@ank1015/llm-agents`:

```ts
import { withWebBrowser } from '@ank1015/llm-agents';
```

The most important helpers for read-only tasks are:

- `browser.openTab(url, options?)`
- `tab.waitForLoad()`
- `tab.waitFor(...)`
- `tab.waitForIdle(ms)`
- `tab.evaluate(code, options?)`
- `tab.getMarkdown(options?)`

## Default Sequence

1. Open a new tab for the target page.
2. Call `waitForLoad()` first.
3. Call `waitFor(...)` for a page-specific readiness signal such as a selector, visible text, or URL fragment.
4. Use a small `evaluate(...)` probe to confirm the page you think you are on is actually the page you loaded.
5. Extract only the data you need.
6. Return a high-level summary plus any important uncertainty.

## Recommended Patterns

### Survey An Unknown Site

Use `evaluate(...)` to inspect purpose-built signals instead of trying to dump the whole DOM:

```ts
const survey = await tab.evaluate<{
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
}>(
  `(() => {
    const text = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .map((node) => text(node.textContent))
      .filter(Boolean)
      .slice(0, 12);
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((node) => ({
        text: text(node.textContent),
        href: node.href,
      }))
      .filter((item) => item.text)
      .slice(0, 20);
    return {
      title: document.title,
      headings,
      links,
    };
  })()`
);
```

This is the pattern we used when surveying `docs.polymarket.com`: small targeted probes first, then deeper extraction only on relevant pages.

### Extract Top Visible Items

For inboxes, feeds, and timelines, identify the smallest stable container and extract the first few visible rows:

```ts
const items = await tab.evaluate<Array<{ title: string; summary: string }>>(
  `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[data-row]'))
      .slice(0, 3)
      .map((row) => ({
        title: normalize(row.querySelector('.title')?.textContent),
        summary: normalize(row.querySelector('.summary')?.textContent),
      }));
  })()`
);
```

This is the same general technique we used for Gmail inbox rows and the first visible posts on X.

## Markdown Capture

Use `tab.getMarkdown(...)` when the page is documentation, long-form content, or an article and you want a cleaner text representation than raw DOM scraping.

```ts
const markdown = await tab.getMarkdown({
  maxChars: 20_000,
});
```

Use markdown capture selectively. For dynamic apps or feeds, targeted `evaluate(...)` probes are usually better.

## Verification Tips

- Verify the `title` and `url` before trusting extracted data.
- When the page is a single-page app, add `waitForIdle(...)` after `waitForLoad()` to let hydration finish.
- If a page might be behind a login gate, use a quick probe to check for login prompts before assuming the real app content is present.
