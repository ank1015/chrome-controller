# Web Recipes

Use these recipes together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for the default task loop.

## When To Read

Read this reference when you want a compact end-to-end template for a common browser task, or when the current task combines multiple modes.

## Recipe: Survey An Unfamiliar Website

```ts
import { withWebBrowser } from '@ank1015/llm-agents';

const result = await withWebBrowser(async (browser) => {
  const tab = await browser.openTab('https://docs.polymarket.com/', { active: false });
  await tab.waitForLoad();
  await tab.waitFor({ selector: 'main' });
  await tab.waitForIdle(750);

  return await tab.evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    return {
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1, h2'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
        .slice(0, 12),
      links: Array.from(document.querySelectorAll('a[href]'))
        .map((node) => ({ text: normalize(node.textContent), href: node.href }))
        .filter((item) => item.text)
        .slice(0, 20),
    };
  })()`);
});
```

This is the default pattern for "what can I do on this site?" questions.

## Recipe: Extract The First Few Visible Items

```ts
const topItems = await tab.evaluate(`(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  return Array.from(document.querySelectorAll('article'))
    .slice(0, 2)
    .map((article) => normalize(article.innerText));
})()`);
```

This is the same family of approach we used for the Gmail inbox summary and the first posts on X.

## Recipe: Keep The Tab Open For Verification

```ts
const browser = await connectWeb({ launch: true });
const tab = await browser.openTab('https://x.com/home', { active: true });

await tab.waitForLoad();
await tab.waitFor({ selector: 'article' });

const posts = await tab.evaluate(`(() => {
  return Array.from(document.querySelectorAll('article')).slice(0, 2).map((node) => node.innerText);
})()`);

await browser.close();
```

Closing the helper session leaves the browser tab open for the user to inspect manually.

## Recipe: Capture Network Activity Around A Navigation

```ts
const capture = await withWebBrowser(async (browser) => {
  const tab = await browser.openTab('about:blank', { active: false });

  return await tab.captureNetwork(
    async (activeTab, debuggerSession) => {
      await debuggerSession.cdp('Page.enable');
      await debuggerSession.cdp('Page.navigate', { url: 'https://github.com/' });
      await activeTab.waitForLoad();
      await activeTab.waitForIdle(1_500);
      return activeTab.info();
    },
    {
      disableCache: true,
    }
  );
});
```

Use this when the user asks what network activity happens on page load or during a specific flow.

## Recipe: Clean Up Tabs Except One

```ts
await withWebBrowser(async (browser) => {
  const notionTabs = await browser.findTabs((info) => info.title?.includes('Notion') === true);
  if (!notionTabs[0]) {
    throw new Error('Could not find the Notion tab');
  }

  await browser.closeOtherTabs(notionTabs[0].id);
});
```

Use this for browser-state cleanup tasks where preserving one known tab matters more than reading page content.
