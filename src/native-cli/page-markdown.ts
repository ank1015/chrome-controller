import TurndownService from 'turndown';

declare const document: any;
declare const window: any;
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

  const textFragments = Array.isArray(payload.textFragments)
    ? payload.textFragments.filter((fragment): fragment is string => typeof fragment === 'string')
    : [];
  const plainText =
    textFragments.length > 0
      ? textFragments.join('\n\n')
      : typeof payload.text === 'string'
        ? payload.text
        : '';
  const htmlFragments = Array.isArray(payload.htmlFragments)
    ? payload.htmlFragments.filter((fragment): fragment is string => typeof fragment === 'string')
    : [];
  const html =
    htmlFragments.length > 0
      ? htmlFragments.join('\n')
      : typeof payload.html === 'string'
        ? payload.html
        : '';
  const textMarkdown = normalizeMarkdown(plainText);
  const htmlMarkdown = html ? convertHtmlToMarkdown(html) : '';

  return {
    title: asNullableString(payload.title),
    url: asNullableString(payload.url),
    html,
    markdown: choosePreferredPageMarkdown({
      htmlMarkdown,
      textMarkdown,
    }),
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

  return normalizeMarkdown(scrubMarkdownArtifacts(markdown));
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function choosePreferredPageMarkdown(input: {
  htmlMarkdown: string;
  textMarkdown: string;
}): string {
  const htmlMarkdown = normalizeMarkdown(input.htmlMarkdown);
  const textMarkdown = normalizeMarkdown(input.textMarkdown);

  if (!htmlMarkdown) {
    return textMarkdown;
  }

  if (!textMarkdown) {
    return htmlMarkdown;
  }

  const htmlLineCount = countNonEmptyLines(htmlMarkdown);
  const textLineCount = countNonEmptyLines(textMarkdown);

  if (
    textMarkdown.length > htmlMarkdown.length * 1.5 &&
    textLineCount >= htmlLineCount + 4
  ) {
    return textMarkdown;
  }

  return htmlMarkdown;
}

function countNonEmptyLines(value: string): number {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function scrubMarkdownArtifacts(markdown: string): string {
  let cleaned = markdown.replace(/!\[[^\]]*]\([^)]+\)/g, '');
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) =>
    isNoisyUrl(url) ? label.trim() : `[${label}](${url})`
  );
  cleaned = cleaned.replace(/\b(?:data|blob):\S+/gi, '');
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, (url) => (isNoisyUrl(url) ? '' : url));

  const lines = cleaned
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !isNoisyLine(line));

  return lines.join('\n');
}

function isNoisyUrl(url: string): boolean {
  const normalized = url.trim();
  if (!normalized) {
    return false;
  }

  if (/^(?:data|blob):/i.test(normalized)) {
    return true;
  }

  if (normalized.length >= 180) {
    return true;
  }

  if (/[A-Za-z0-9+/]{80,}={0,2}/.test(normalized)) {
    return true;
  }

  const lower = normalized.toLowerCase();
  return (
    lower.includes('utm_') ||
    lower.includes('tracking') ||
    lower.includes('trk=') ||
    lower.includes('pixel') ||
    lower.includes('open?') ||
    lower.includes('openrate') ||
    lower.includes('mailtrack')
  );
}

function isNoisyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/\b(?:data|blob):\S+/i.test(trimmed)) {
    return true;
  }

  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(trimmed)) {
    return true;
  }

  const letterCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (trimmed.match(/[0-9]/g) ?? []).length;
  const punctuationCount = (trimmed.match(/[^A-Za-z0-9\s]/g) ?? []).length;
  const urlCount = (trimmed.match(/https?:\/\//g) ?? []).length;

  if (urlCount > 0 && letterCount < 12 && trimmed.length > 80) {
    return true;
  }

  return (
    trimmed.length > 120 &&
    letterCount < 24 &&
    punctuationCount + digitCount > letterCount * 2
  );
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
  const MAX_HTML_FRAGMENT_LENGTH = 12000;
  const MAX_HTML_CAPTURE_LENGTH = 24000;

  const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  const normalizePlainText = (value: unknown): string =>
    typeof value === 'string'
      ? value
          .replace(/\r\n/g, '\n')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : '';

  const isElementNode = (element: any): boolean =>
    Boolean(element && typeof element === 'object' && element.nodeType === 1);

  const getElementWindow = (element: any): any =>
    element?.ownerDocument?.defaultView ?? window;

  const queryAll = (queryDocument: any, selector: string): any[] => {
    if (!queryDocument || typeof queryDocument.querySelectorAll !== 'function') {
      return [];
    }

    try {
      return Array.from(queryDocument.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const getAccessibleFrameDocument = (frameElement: any): any | null => {
    const tagName = String(frameElement?.tagName || '').toLowerCase();
    if (tagName !== 'iframe' && tagName !== 'frame') {
      return null;
    }

    try {
      const frameDocument =
        frameElement.contentDocument ?? frameElement.contentWindow?.document ?? null;
      return frameDocument && frameDocument.documentElement ? frameDocument : null;
    } catch {
      return null;
    }
  };

  const getVisibleFrameArea = (frameElement: any): number => {
    if (!isElementNode(frameElement)) {
      return 0;
    }

    const view = getElementWindow(frameElement);
    const style =
      typeof view?.getComputedStyle === 'function'
        ? view.getComputedStyle(frameElement)
        : getComputedStyle(frameElement);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return 0;
    }

    const rect = frameElement.getBoundingClientRect();
    const viewportWidth = Number(view?.innerWidth ?? window.innerWidth) || 0;
    const viewportHeight = Number(view?.innerHeight ?? window.innerHeight) || 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
    );

    return visibleWidth * visibleHeight;
  };

  const getDocumentTextLength = (queryDocument: any): number =>
    normalizeText(
      queryDocument?.body?.innerText ||
        queryDocument?.documentElement?.innerText ||
        queryDocument?.body?.textContent ||
        queryDocument?.documentElement?.textContent ||
        ''
    ).length;

  const resolvePrimaryCaptureDocument = (queryDocument: any): any => {
    let currentDocument = queryDocument;

    while (currentDocument) {
      const view = currentDocument?.defaultView ?? window;
      const viewportArea =
        (Number(view?.innerWidth ?? window.innerWidth) || 0) *
        (Number(view?.innerHeight ?? window.innerHeight) || 0);

      const dominantFrame = queryAll(currentDocument, 'iframe, frame')
        .map((frameElement) => {
          const frameDocument = getAccessibleFrameDocument(frameElement);
          if (!frameDocument) {
            return null;
          }

          const area = getVisibleFrameArea(frameElement);
          if (area <= 0) {
            return null;
          }

          return {
            doc: frameDocument,
            area,
            textLength: getDocumentTextLength(frameDocument),
          };
        })
        .filter((candidate): candidate is { doc: any; area: number; textLength: number } => Boolean(candidate))
        .sort((left, right) => {
          if (left.area !== right.area) {
            return right.area - left.area;
          }
          return right.textLength - left.textLength;
        })
        .find((candidate) => {
          if (viewportArea <= 0) {
            return candidate.textLength > 0;
          }

          return candidate.area / viewportArea >= 0.5 && candidate.textLength > 0;
        });

      if (!dominantFrame) {
        return currentDocument;
      }

      currentDocument = dominantFrame.doc;
    }

    return queryDocument;
  };

  const isVisible = (element: any): boolean => {
    if (!isElementNode(element)) {
      return false;
    }

    const view = getElementWindow(element);
    const style =
      typeof view?.getComputedStyle === 'function'
        ? view.getComputedStyle(element)
        : getComputedStyle(element);
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

  const getVisibleArea = (element: any): number => {
    if (!isVisible(element)) {
      return 0;
    }

    const view = getElementWindow(element);
    const rect = element.getBoundingClientRect();
    const viewportWidth = Number(view?.innerWidth ?? window.innerWidth) || 0;
    const viewportHeight = Number(view?.innerHeight ?? window.innerHeight) || 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
    );

    return visibleWidth * visibleHeight;
  };

  const uniqueElements = (elements: any[]): any[] => {
    const seen = new Set<any>();
    const result: any[] = [];

    for (const element of elements) {
      if (!isElementNode(element) || seen.has(element)) {
        continue;
      }

      seen.add(element);
      result.push(element);
    }

    return result;
  };

  const captureDocument = resolvePrimaryCaptureDocument(document);

  const getPrimaryRoot = (): any => {
    const semanticCandidates = uniqueElements(
      queryAll(captureDocument, 'main, article, [role="main"]')
    ).filter((candidate) => candidate && getVisibleTextLength(candidate) > 0);

    if (semanticCandidates.length > 0) {
      return semanticCandidates.sort(
        (left, right) => getVisibleTextLength(right) - getVisibleTextLength(left)
      )[0];
    }

    const candidates = uniqueElements([
      captureDocument.body,
      captureDocument.documentElement,
    ]).filter((candidate) => candidate && getVisibleTextLength(candidate) > 0);

    if (candidates.length === 0) {
      return captureDocument.body ?? captureDocument.documentElement;
    }

    return candidates.sort(
      (left, right) => getVisibleTextLength(right) - getVisibleTextLength(left)
    )[0];
  };

  const getOverlayRoot = (fallbackRoot: any): any | null => {
    const viewportArea =
      (Number(window.innerWidth) || 0) * (Number(window.innerHeight) || 0);

    const candidates = uniqueElements(
      queryAll(
        captureDocument,
        '[role="dialog"], [aria-modal="true"], [role="grid"], [role="list"], [role="region"], [role="complementary"]'
      )
    )
      .filter((candidate) => candidate && candidate !== fallbackRoot)
      .map((candidate) => {
        const descriptor = normalizeText(
          [
            candidate.getAttribute?.('role') || '',
            candidate.getAttribute?.('aria-label') || '',
            candidate.getAttribute?.('data-testid') || '',
            candidate.getAttribute?.('id') || '',
          ].join(' ')
        ).toLowerCase();
        const style = getComputedStyle(candidate);
        const textLength = getVisibleTextLength(candidate);
        const area = getVisibleArea(candidate);
        let score = 0;

        if (
          candidate.getAttribute?.('role') === 'dialog' ||
          candidate.getAttribute?.('aria-modal') === 'true'
        ) {
          score += 5;
        }
        if (
          /\b(conversation|messages in conversation|conversation with|messages|message thread|chat|chats|inbox|direct messages|dm)\b/i.test(
            descriptor
          )
        ) {
          score += 5;
        }
        if (
          candidate.getAttribute?.('role') === 'grid' ||
          candidate.getAttribute?.('role') === 'list'
        ) {
          score += 2;
        }
        if (
          style.position === 'fixed' ||
          style.position === 'absolute' ||
          style.position === 'sticky'
        ) {
          score += 2;
        }
        if (fallbackRoot && !fallbackRoot.contains?.(candidate)) {
          score += 2;
        }
        if (area > 0 && (!viewportArea || area < viewportArea * 0.9)) {
          score += 1;
        }

        return {
          candidate,
          score,
          textLength,
          area,
        };
      })
      .filter(({ score, textLength, area }) => score >= 5 && textLength >= 80 && area >= 20000)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        if (left.textLength !== right.textLength) {
          return right.textLength - left.textLength;
        }
        return right.area - left.area;
      });

    return candidates[0]?.candidate ?? null;
  };

  const getSupplementalRoots = (primaryRoot: any): any[] =>
    uniqueElements(
      queryAll(
        captureDocument,
        '[data-message-author-role="assistant"], [aria-live="polite"], [aria-live="assertive"], [role="log"]'
      )
    ).filter(
      (candidate) =>
        candidate &&
        candidate !== primaryRoot &&
        !primaryRoot?.contains(candidate) &&
        getVisibleTextLength(candidate) > 0
    );

  const shouldRemove = (element: any): boolean => {
    if (!isElementNode(element)) {
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

  const sanitizeCloneTree = (root: any): any => {
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

    return clone;
  };

  const serializeClone = (clone: any): string => {
    return typeof clone.innerHTML === 'string'
      ? clone.innerHTML
      : typeof clone.outerHTML === 'string'
        ? clone.outerHTML
        : '';
  };

  const collectHtmlFragments = (clone: any, maxLength: number): string[] => {
    const fragments: string[] = [];
    const pending: any[] = [clone];

    while (pending.length > 0) {
      const node = pending.shift();
      if (!isElementNode(node)) {
        continue;
      }

      const serialized = serializeClone(node);
      if (!serialized || normalizeText(serialized).length === 0) {
        continue;
      }

      if (serialized.length <= maxLength) {
        fragments.push(serialized);
        continue;
      }

      const childElements = Array.from(node.children || []).filter((child) => isElementNode(child));
      if (childElements.length === 0) {
        fragments.push(serialized);
        continue;
      }

      pending.unshift(...childElements);
    }

    return fragments;
  };

  const collectTextFragments = (roots: any[]): string[] => {
    const fragments: string[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
      const text = normalizePlainText(root?.innerText || root?.textContent || '');
      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      fragments.push(text);
    }

    return fragments;
  };

  const semanticPrimaryRoot = getPrimaryRoot();
  const primaryRoot = getOverlayRoot(semanticPrimaryRoot) ?? semanticPrimaryRoot;
  const roots = [primaryRoot, ...getSupplementalRoots(primaryRoot)].filter(Boolean);
  const htmlFragments = roots.flatMap((root) =>
    collectHtmlFragments(sanitizeCloneTree(root), MAX_HTML_FRAGMENT_LENGTH)
  );
  const html = htmlFragments.join('\n');
  const textFragments = collectTextFragments(roots);

  return {
    [marker]: true,
    title: typeof document.title === 'string' ? document.title : null,
    url: typeof location?.href === 'string' ? location.href : null,
    html: textFragments.length > 0 ? '' : html,
    htmlFragments: textFragments.length > 0 ? [] : htmlFragments,
    text: textFragments.join('\n\n'),
    textFragments,
  };
}
