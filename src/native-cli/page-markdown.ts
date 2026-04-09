import TurndownService from 'turndown';

declare const document: any;
declare const location: any;
declare const Element: any;
declare const getComputedStyle: (element: any) => any;

export const PAGE_TEXT_EVAL_MARKER = '__chrome_controller_page_text_v1__';

export interface PageTextCaptureResult {
  title: string | null;
  url: string | null;
  html: string;
}

export function buildPageTextEvaluationCode(): string {
  return `(${pageTextRuntime.toString()})(${JSON.stringify(PAGE_TEXT_EVAL_MARKER)})`;
}

export function createPageMarkdown(raw: unknown): PageTextCaptureResult & {
  markdown: string;
} {
  const payload = asObject(raw);
  if (!payload || payload[PAGE_TEXT_EVAL_MARKER] !== true) {
    throw new Error('Failed to capture page text');
  }

  const html = typeof payload.html === 'string' ? payload.html : '';

  return {
    title: asNullableString(payload.title),
    url: asNullableString(payload.url),
    html,
    markdown: convertHtmlToMarkdown(html),
  };
}

export function convertHtmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  turndownService.remove([
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'canvas',
    'iframe',
  ]);

  const markdown = turndownService.turndown(html);

  return normalizeMarkdown(markdown);
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pageTextRuntime(marker: string): Record<string, unknown> {
  const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  const isVisible = (element: any): boolean => {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  };

  const getVisibleTextLength = (element: any): number => {
    if (!isVisible(element)) {
      return 0;
    }

    return normalizeText(element.innerText || element.textContent || '').length;
  };

  const uniqueElements = (elements: any[]): any[] => {
    const seen = new Set<any>();
    const result: any[] = [];

    for (const element of elements) {
      if (!(element instanceof Element) || seen.has(element)) {
        continue;
      }

      seen.add(element);
      result.push(element);
    }

    return result;
  };

  const getPrimaryRoot = (): any => {
    const candidates = uniqueElements([
      ...Array.from(document.querySelectorAll('main, article, [role="main"]')),
      document.body,
      document.documentElement,
    ]).filter((candidate) => candidate && getVisibleTextLength(candidate) > 0);

    if (candidates.length === 0) {
      return document.body ?? document.documentElement;
    }

    return candidates.sort(
      (left, right) => getVisibleTextLength(right) - getVisibleTextLength(left)
    )[0];
  };

  const getSupplementalRoots = (primaryRoot: any): any[] =>
    uniqueElements(
      Array.from(
        document.querySelectorAll(
          '[data-message-author-role="assistant"], [aria-live="polite"], [aria-live="assertive"], [role="log"]'
        )
      )
    ).filter(
      (candidate) =>
        candidate &&
        candidate !== primaryRoot &&
        !primaryRoot?.contains(candidate) &&
        getVisibleTextLength(candidate) > 0
    );

  const shouldRemove = (element: any): boolean => {
    if (!(element instanceof Element)) {
      return false;
    }

    const tagName = String(element.tagName || '').toLowerCase();
    if (
      tagName === 'script' ||
      tagName === 'style' ||
      tagName === 'noscript' ||
      tagName === 'template' ||
      tagName === 'svg' ||
      tagName === 'canvas' ||
      tagName === 'iframe'
    ) {
      return true;
    }

    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    const style = getComputedStyle(element);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    );
  };

  const sanitizeClone = (root: any): string => {
    const clone = root.cloneNode(true);
    const originalElements = [root, ...Array.from(root.querySelectorAll('*'))];
    const cloneElements = [clone, ...Array.from(clone.querySelectorAll('*'))];

    for (let index = cloneElements.length - 1; index >= 0; index -= 1) {
      const original = originalElements[index];
      const cloned = cloneElements[index];
      if (original && cloned && shouldRemove(original)) {
        cloned.remove();
      }
    }

    return typeof clone.innerHTML === 'string'
      ? clone.innerHTML
      : typeof clone.outerHTML === 'string'
        ? clone.outerHTML
        : '';
  };

  const primaryRoot = getPrimaryRoot();
  const roots = [primaryRoot, ...getSupplementalRoots(primaryRoot)].filter(Boolean);
  const html = roots
    .map((root) => sanitizeClone(root))
    .filter((fragment) => normalizeText(fragment).length > 0)
    .join('\n');

  return {
    [marker]: true,
    title: typeof document.title === 'string' ? document.title : null,
    url: typeof location?.href === 'string' ? location.href : null,
    html,
  };
}
