import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getChromeControllerHome } from './session-store.js';

import type {
  CliPageSnapshot,
  CliPageSnapshotCacheRecord,
  CliRunOptions,
  CliSnapshotElementInfo,
} from './types.js';

declare const document: any;
declare const location: any;
declare const Node: any;
declare const Element: any;
declare const HTMLInputElement: any;
declare const HTMLTextAreaElement: any;
declare const HTMLSelectElement: any;
declare function getComputedStyle(element: any): any;

const SNAPSHOT_CACHE_DIRECTORY = 'snapshot-cache';
const DEFAULT_PAGE_SNAPSHOT_CAPTURE_LIMIT = 5_000;
const DEFAULT_PAGE_SNAPSHOT_DISPLAY_LIMIT = 100;

interface RankedSnapshotElement extends Omit<CliSnapshotElementInfo, 'ref'> {
  inViewport: boolean;
  top: number;
  left: number;
  distanceFromViewport: number;
  priority: number;
  originalIndex: number;
}

interface PageSnapshotDisplay {
  elements: CliSnapshotElementInfo[];
  displayedCount: number;
  visibleCount: number;
  count: number;
  scope: 'viewport' | 'ranked';
  truncated: boolean;
}

export const PAGE_SNAPSHOT_EVAL_MARKER = '__chrome_controller_page_snapshot_v1__';

export function selectActionableSnapshotTarget(element: any, role: string): any {
  if (!element) {
    return element;
  }

  const isElementNode = (candidate: any): boolean =>
    Boolean(candidate && typeof candidate === 'object' && candidate.nodeType === 1);

  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (!normalizedRole) {
    return element;
  }

  const isStrictlyVisible = (candidate: any): boolean => {
    if (!isElementNode(candidate)) {
      return false;
    }

    if (
      typeof getComputedStyle !== 'function' ||
      typeof candidate.getBoundingClientRect !== 'function' ||
      typeof candidate.getClientRects !== 'function'
    ) {
      return true;
    }

    const style = getComputedStyle(candidate);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }

    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && candidate.getClientRects().length > 0;
  };

  const supportsAncestorVisibilityFallback = (candidate: any): boolean => {
    if (!isElementNode(candidate)) {
      return false;
    }

    if (normalizedRole === 'textbox' || normalizedRole === 'searchbox') {
      return true;
    }

    return normalizedRole === 'combobox' || normalizedRole === 'listbox';
  };

  const hasVisibleAncestor = (candidate: any): boolean => {
    let current = candidate?.parentElement ?? null;

    while (current) {
      if (isStrictlyVisible(current)) {
        return true;
      }
      current = current.parentElement ?? null;
    }

    return false;
  };

  const isUsableTarget = (candidate: any): boolean => {
    if (isStrictlyVisible(candidate)) {
      return true;
    }

    return supportsAncestorVisibilityFallback(candidate) && hasVisibleAncestor(candidate);
  };

  const matches = (selector: string): boolean => {
    try {
      return typeof element.matches === 'function' && element.matches(selector);
    } catch {
      return false;
    }
  };

  const findCandidate = (selector: string): any => {
    if (matches(selector) && isUsableTarget(element)) {
      return element;
    }

    try {
      if (typeof element.querySelectorAll === 'function') {
        const descendants = Array.from(element.querySelectorAll(selector));
        const visibleDescendant = descendants.find((candidate) => isUsableTarget(candidate));
        if (visibleDescendant) {
          return visibleDescendant;
        }

        if (descendants.length > 0) {
          return descendants[0];
        }
      }
    } catch {
      // ignore invalid selector lookup
    }

    try {
      if (typeof element.closest === 'function') {
        const ancestor = element.closest(selector);
        if (ancestor && isUsableTarget(ancestor)) {
          return ancestor;
        }
      }
    } catch {
      // ignore invalid selector lookup
    }

    return null;
  };

  const selectorByRole: Record<string, string> = {
    link: 'a[href]',
    button: 'button, summary, [role~="button"]',
    checkbox: 'input[type="checkbox"], [role~="checkbox"]',
    radio: 'input[type="radio"], [role~="radio"]',
    switch: '[role~="switch"], input[type="checkbox"]',
    textbox:
      'input:not([type="hidden"]), textarea, [role~="textbox"], [role~="searchbox"], [contenteditable=""], [contenteditable="true"]',
    searchbox:
      'input:not([type="hidden"]), textarea, [role~="textbox"], [role~="searchbox"], [contenteditable=""], [contenteditable="true"]',
    combobox: 'select, [role~="combobox"], [role~="listbox"]',
    listbox: 'select, [role~="combobox"], [role~="listbox"]',
  };

  const selector = selectorByRole[normalizedRole];
  if (!selector) {
    return element;
  }

  return findCandidate(selector) ?? element;
}

export function buildUniqueFallbackSelector(
  element: {
    tagName?: string | null;
    id?: string | null;
    parentElement?: any;
  } | null,
  options: {
    isUniqueSelector: (selector: string) => boolean;
    escapeIdentifier: (value: unknown) => string;
  }
): string | null {
  const parts: string[] = [];
  let node: any = element;

  while (node && typeof node.tagName === 'string' && node.tagName) {
    const tagName = node.tagName.toLowerCase();

    if (node.id) {
      parts.unshift(`#${options.escapeIdentifier(node.id)}`);
      let selector = parts.join(' > ');
      if (options.isUniqueSelector(selector)) {
        return selector;
      }

      parts[0] = `${tagName}#${options.escapeIdentifier(node.id)}`;
      selector = parts.join(' > ');
      if (options.isUniqueSelector(selector)) {
        return selector;
      }
    } else {
      let part = tagName;
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children ?? []).filter(
          (child: any) => child?.tagName === node.tagName
        );
        const siblingIndex = siblings.indexOf(node);
        if (siblings.length > 1 && siblingIndex >= 0) {
          part += `:nth-of-type(${siblingIndex + 1})`;
        }
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (options.isUniqueSelector(selector)) {
        return selector;
      }
    }

    node = node.parentElement;
  }

  return null;
}

export function buildPageSnapshotEvaluationCode(
  limit: number = DEFAULT_PAGE_SNAPSHOT_CAPTURE_LIMIT
): string {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_PAGE_SNAPSHOT_CAPTURE_LIMIT;
  return `(${pageSnapshotRuntime.toString()})(${JSON.stringify(
    safeLimit
  )}, ${JSON.stringify(PAGE_SNAPSHOT_EVAL_MARKER)}, ${selectActionableSnapshotTarget.toString()}, ${buildUniqueFallbackSelector.toString()})`;
}

export function createPageSnapshotRecord(options: {
  sessionId: string;
  tabId: number;
  raw: unknown;
  now?: Date;
}): CliPageSnapshotCacheRecord {
  const payload = asObject(options.raw);
  if (payload?.[PAGE_SNAPSHOT_EVAL_MARKER] !== true) {
    throw new Error('Failed to capture page snapshot');
  }

  const rankedElements = Array.isArray(payload.elements)
    ? payload.elements
        .map((value, index) => normalizeSnapshotElement(value, index))
        .sort(compareSnapshotElements)
        .filter((value, index, elements) => {
          const dedupeKey = getSnapshotDedupKey(value);
          if (!dedupeKey) {
            return true;
          }

          return (
            elements.findIndex((candidate) => getSnapshotDedupKey(candidate) === dedupeKey) === index
          );
        })
    : [];
  const elements = rankedElements.map((value, index) => ({
    ref: `@e${index + 1}`,
    role: value.role,
    name: value.name,
    tagName: value.tagName,
    inputType: value.inputType,
    selector: value.selector,
    alternativeSelectors: value.alternativeSelectors,
    placeholder: value.placeholder,
    disabled: value.disabled,
    checked: value.checked,
  }));
  const count =
    payload.truncated === true &&
    typeof payload.count === 'number' &&
    Number.isFinite(payload.count) &&
    payload.count >= rankedElements.length
      ? Math.trunc(payload.count)
      : rankedElements.length;
  const capturedAt = (options.now ?? new Date()).toISOString();
  const visibleCount = rankedElements.filter((element) => element.inViewport).length;

  return {
    version: 1,
    sessionId: options.sessionId,
    source: 'dom-interactive-v1',
    snapshotId: `snap-${options.tabId}-${capturedAt.replace(/[:.]/g, '-')}`,
    capturedAt,
    tabId: options.tabId,
    title: asNullableString(payload.title),
    url: asNullableString(payload.url),
    elements,
    count,
    visibleCount,
    truncated: payload.truncated === true || count > elements.length,
  };
}

export async function writePageSnapshotCache(
  env: CliRunOptions['env'],
  snapshot: CliPageSnapshotCacheRecord
): Promise<string> {
  const filePath = getPageSnapshotCachePath(env, snapshot.sessionId, snapshot.tabId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function readPageSnapshotCache(
  env: CliRunOptions['env'],
  sessionId: string,
  tabId: number
): Promise<CliPageSnapshotCacheRecord | null> {
  const filePath = getPageSnapshotCachePath(env, sessionId, tabId);

  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as CliPageSnapshotCacheRecord;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

export function getPageSnapshotCachePath(
  env: CliRunOptions['env'],
  sessionId: string,
  tabId: number
): string {
  return join(
    getChromeControllerHome(env),
    SNAPSHOT_CACHE_DIRECTORY,
    sessionId,
    `tab-${tabId}.json`
  );
}

export function renderPageSnapshotLines(
  snapshot: CliPageSnapshot,
  limit: number = DEFAULT_PAGE_SNAPSHOT_DISPLAY_LIMIT
): string[] {
  const display = createPageSnapshotDisplay(snapshot, limit);
  const lines = [
    `Page: ${snapshot.title ?? 'Untitled page'}`,
    `URL: ${snapshot.url ?? 'Unknown URL'}`,
    '',
  ];

  if (display.displayedCount === 0) {
    lines.push('No interactive elements found');
    return lines;
  }

  for (const element of display.elements) {
    lines.push(formatSnapshotElementLine(element));
  }

  if (display.truncated) {
    lines.push('');
    if (display.scope === 'viewport') {
      if (snapshot.visibleCount > display.displayedCount) {
        lines.push(
          `Showing ${display.displayedCount} visible elements out of ${snapshot.visibleCount} in the viewport and ${snapshot.count} interactive elements total`
        );
      } else {
        lines.push(
          `Showing ${display.displayedCount} visible elements out of ${snapshot.count} interactive elements total`
        );
      }
    } else {
      lines.push(
        `Showing ${display.displayedCount} top-ranked elements out of ${snapshot.count} interactive elements`
      );
    }
  }

  return lines;
}

export function createPageSnapshotDisplay(
  snapshot: CliPageSnapshot,
  limit: number = DEFAULT_PAGE_SNAPSHOT_DISPLAY_LIMIT
): PageSnapshotDisplay {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_PAGE_SNAPSHOT_DISPLAY_LIMIT;
  const clampedVisibleCount = Math.max(0, Math.min(snapshot.visibleCount, snapshot.elements.length));
  const hasVisibleElements = clampedVisibleCount > 0;
  const displayElements = hasVisibleElements
    ? snapshot.elements.slice(0, Math.min(clampedVisibleCount, safeLimit))
    : snapshot.elements.slice(0, Math.min(snapshot.elements.length, safeLimit));

  return {
    elements: displayElements,
    displayedCount: displayElements.length,
    visibleCount: snapshot.visibleCount,
    count: snapshot.count,
    scope: hasVisibleElements ? 'viewport' : 'ranked',
    truncated: snapshot.count > displayElements.length,
  };
}

function normalizeSnapshotElement(raw: unknown, index: number): RankedSnapshotElement {
  const payload = asObject(raw) ?? {};
  const selector = asNullableString(payload.selector);
  const alternativeSelectors = Array.isArray(payload.alternativeSelectors)
    ? dedupeStringArray(payload.alternativeSelectors).filter((value) => value !== selector)
    : [];

  return {
    role: asNonEmptyString(payload.role) ?? 'element',
    name: asNullableString(payload.name),
    tagName: normalizeTagName(payload.tagName),
    inputType: normalizeInputType(payload.inputType),
    selector,
    alternativeSelectors,
    placeholder: asNullableString(payload.placeholder),
    disabled: payload.disabled === true,
    checked: typeof payload.checked === 'boolean' ? payload.checked : null,
    inViewport: payload.inViewport === true,
    top: asFiniteNumber(payload.top) ?? Number.POSITIVE_INFINITY,
    left: asFiniteNumber(payload.left) ?? Number.POSITIVE_INFINITY,
    distanceFromViewport: asFiniteNumber(payload.distanceFromViewport) ?? Number.POSITIVE_INFINITY,
    priority: computeSnapshotPriority({
      role: asNonEmptyString(payload.role) ?? 'element',
      name: asNullableString(payload.name),
      placeholder: asNullableString(payload.placeholder),
      selector,
      disabled: payload.disabled === true,
    }),
    originalIndex: index,
  };
}

function formatSnapshotElementLine(element: CliSnapshotElementInfo): string {
  const headerParts = [element.role];

  if (element.inputType) {
    headerParts.push(`type="${element.inputType}"`);
  }

  let line = `${element.ref} [${headerParts.join(' ')}]`;

  if (element.name) {
    line += ` ${JSON.stringify(element.name)}`;
  }

  if (element.placeholder && element.placeholder !== element.name) {
    line += ` placeholder=${JSON.stringify(element.placeholder)}`;
  }

  if (element.checked === true) {
    line += ' checked';
  }

  if (element.disabled) {
    line += ' disabled';
  }

  return line;
}

function dedupeStringArray(values: unknown[]): string[] {
  const unique = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value.trim();
    if (!normalized || unique.has(normalized)) {
      continue;
    }

    unique.add(normalized);
    result.push(normalized);
  }

  return result;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asNonEmptyString(value: unknown): string | null {
  return asNullableString(value);
}

function normalizeTagName(value: unknown): string | null {
  const normalized = asNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeInputType(value: unknown): string | null {
  const normalized = asNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function computeSnapshotPriority(element: {
  role: string;
  name: string | null;
  placeholder: string | null;
  selector: string | null;
  disabled: boolean;
}): number {
  const basePriorityByRole: Record<string, number> = {
    textbox: 120,
    searchbox: 120,
    combobox: 115,
    listbox: 110,
    checkbox: 105,
    radio: 105,
    switch: 105,
    button: 100,
    link: 95,
    slider: 90,
    spinbutton: 90,
    tab: 85,
    treeitem: 82,
    option: 80,
    menuitem: 80,
    menuitemcheckbox: 80,
    menuitemradio: 80,
    clickable: 72,
    focusable: 64,
    generic: 20,
    element: 10,
  };

  let priority = basePriorityByRole[element.role] ?? 50;
  if (element.name) {
    priority += 12;
  }
  if (element.placeholder && element.placeholder !== element.name) {
    priority += 6;
  }
  if (element.selector) {
    priority += 2;
  }
  if (element.disabled) {
    priority -= 20;
  }

  return priority;
}

function compareSnapshotElements(left: RankedSnapshotElement, right: RankedSnapshotElement): number {
  if (left.inViewport !== right.inViewport) {
    return left.inViewport ? -1 : 1;
  }

  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  if (left.inViewport && right.inViewport) {
    if (left.top !== right.top) {
      return left.top - right.top;
    }
    if (left.left !== right.left) {
      return left.left - right.left;
    }
  }

  if (left.distanceFromViewport !== right.distanceFromViewport) {
    return left.distanceFromViewport - right.distanceFromViewport;
  }

  return left.originalIndex - right.originalIndex;
}

function getSnapshotDedupKey(element: RankedSnapshotElement): string | null {
  const selector = element.selector ?? element.alternativeSelectors[0] ?? null;
  if (selector) {
    return `${element.role}|${selector}`;
  }

  if (element.role === 'textbox' || element.role === 'searchbox' || element.role === 'combobox') {
    const name = (element.name ?? element.placeholder ?? '').trim().toLowerCase();
    const topBucket = Number.isFinite(element.top) ? Math.round(element.top / 16) : 'na';
    const leftBucket = Number.isFinite(element.left) ? Math.round(element.left / 16) : 'na';
    if (name) {
      return `${element.role}|${name}|${topBucket}:${leftBucket}`;
    }
  }

  return null;
}

function pageSnapshotRuntime(
  maxElements: number,
  marker: string,
  selectActionableTarget: (element: any, role: string) => any,
  buildUniqueSelector: (
    element: {
      tagName?: string | null;
      id?: string | null;
      parentElement?: any;
    } | null,
    options: {
      isUniqueSelector: (selector: string) => boolean;
      escapeIdentifier: (value: unknown) => string;
    }
  ) => string | null
): Record<string, unknown> {
  const interactiveRoles = new Set([
    'button',
    'link',
    'textbox',
    'checkbox',
    'radio',
    'combobox',
    'listbox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'tab',
    'treeitem',
  ]);

  const escapeIdentifier = (value: unknown): string => {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
      return globalThis.CSS.escape(String(value));
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  const escapeAttributeValue = (value: unknown): string =>
    String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\a ');

  const cleanText = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, 160) : null;
  };

  const isElementNode = (element: any): boolean =>
    Boolean(element && typeof element === 'object' && element.nodeType === 1);

  const getElementDocument = (element: any): any =>
    element?.ownerDocument ?? document;

  const getElementWindow = (element: any): any =>
    getElementDocument(element)?.defaultView ?? globalThis;

  const isInputElement = (element: any): boolean =>
    isElementNode(element) && String(element.tagName || '').toLowerCase() === 'input';

  const isTextAreaElement = (element: any): boolean =>
    isElementNode(element) && String(element.tagName || '').toLowerCase() === 'textarea';

  const isSelectElement = (element: any): boolean =>
    isElementNode(element) && String(element.tagName || '').toLowerCase() === 'select';

  const isFrameElement = (element: any): boolean => {
    const tagName = String(element?.tagName || '').toLowerCase();
    return tagName === 'iframe' || tagName === 'frame';
  };

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
    if (!isFrameElement(frameElement)) {
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
    const viewportWidth = Number(view?.innerWidth ?? globalThis.innerWidth) || 0;
    const viewportHeight = Number(view?.innerHeight ?? globalThis.innerHeight) || 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
    );

    return visibleWidth * visibleHeight;
  };

  const getDocumentTextLength = (queryDocument: any): number =>
    cleanText(
      queryDocument?.body?.innerText ||
        queryDocument?.documentElement?.innerText ||
        queryDocument?.body?.textContent ||
        queryDocument?.documentElement?.textContent ||
        ''
    )?.length ?? 0;

  const isUniqueSelector = (selector: string | null, queryDocument: any = document): boolean => {
    if (!selector) {
      return false;
    }

    return queryAll(queryDocument, selector).length === 1;
  };

  const getLabelText = (element: any): string | null => {
    if (!element) {
      return null;
    }

    const ownerDocument = getElementDocument(element);

    const ariaLabel = cleanText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }

    const labelledBy = cleanText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/g).filter(Boolean);
      const labelText = cleanText(
        ids
          .map((id: string) => ownerDocument?.getElementById?.(id))
          .filter(Boolean)
          .map((node: any) => node.innerText || node.textContent || '')
          .join(' ')
      );
      if (labelText) {
        return labelText;
      }
    }

    if ('labels' in element && element.labels && element.labels.length > 0) {
      const labelText = cleanText(
        Array.from(element.labels)
          .map((label: any) => label.innerText || label.textContent || '')
          .join(' ')
      );
      if (labelText) {
        return labelText;
      }
    }

    if (isInputElement(element)) {
      const type = (element.type || '').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') {
        const inputValue = cleanText(element.value);
        if (inputValue) {
          return inputValue;
        }
      }
    }

    const alt = cleanText(element.getAttribute('alt'));
    if (alt) {
      return alt;
    }

    const placeholder = cleanText(element.getAttribute('placeholder'));
    if (placeholder) {
      return placeholder;
    }

    const title = cleanText(element.getAttribute('title'));
    if (title) {
      return title;
    }

    return cleanText(element.innerText || element.textContent || '');
  };

  const getRole = (element: any): string => {
    const explicitRole = cleanText(element.getAttribute('role'));
    if (explicitRole) {
      return explicitRole.split(/\s+/)[0];
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    if (tagName === 'button' || tagName === 'summary') {
      return 'button';
    }
    if (tagName === 'textarea') {
      return 'textbox';
    }
    if (tagName === 'select') {
      return element.multiple ? 'listbox' : 'combobox';
    }
    if (tagName === 'input') {
      const inputType = (element.getAttribute('type') || 'text').toLowerCase();
      if (inputType === 'checkbox') {
        return 'checkbox';
      }
      if (inputType === 'radio') {
        return 'radio';
      }
      if (inputType === 'range') {
        return 'slider';
      }
      if (inputType === 'search') {
        return 'searchbox';
      }
      if (inputType === 'button' || inputType === 'submit' || inputType === 'reset' || inputType === 'image') {
        return 'button';
      }
      return 'textbox';
    }
    if (element.isContentEditable) {
      return 'textbox';
    }

    return 'generic';
  };

  const getFallbackInteractionRole = (element: any): string => {
    const tabindex = element.getAttribute('tabindex');
    const style = getComputedStyle(element);

    if (
      element.hasAttribute('onclick') ||
      typeof element.onclick === 'function' ||
      style.cursor === 'pointer'
    ) {
      return 'clickable';
    }

    if (tabindex !== null && Number(tabindex) >= 0) {
      return 'focusable';
    }

    return 'generic';
  };

  const isStrictlyVisible = (element: any): boolean => {
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

  const supportsAncestorVisibilityFallback = (element: any): boolean => {
    if (!isElementNode(element)) {
      return false;
    }

    if (isTextAreaElement(element) || isSelectElement(element)) {
      return true;
    }

    if (isInputElement(element)) {
      const type = (element.type || 'text').toLowerCase();
      return ![
        'hidden',
        'checkbox',
        'radio',
        'range',
        'button',
        'submit',
        'reset',
        'image',
        'file',
      ].includes(type);
    }

    if (element.isContentEditable) {
      return true;
    }

    const role = (element.getAttribute('role') || '').toLowerCase();
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  };

  const hasVisibleAncestor = (element: any): boolean => {
    let current = element?.parentElement ?? null;

    while (current) {
      if (isStrictlyVisible(current)) {
        return true;
      }
      current = current.parentElement ?? null;
    }

    return false;
  };

  const isVisible = (element: any): boolean => {
    if (!isElementNode(element)) {
      return false;
    }

    if (isStrictlyVisible(element)) {
      return true;
    }

    return supportsAncestorVisibilityFallback(element) && hasVisibleAncestor(element);
  };

  const prefixFrameScopedSelector = (
    frameSelectors: string[],
    selector: string | null
  ): string | null => {
    if (!selector) {
      return null;
    }

    return frameSelectors.length > 0
      ? `${frameSelectors.join(' >>> ')} >>> ${selector}`
      : selector;
  };

  const resolvePrimaryCaptureContext = (
    queryDocument: any,
    frameSelectors: string[] = []
  ): { doc: any; frameSelectors: string[] } => {
    const view = queryDocument?.defaultView ?? globalThis;
    const viewportArea =
      (Number(view?.innerWidth ?? globalThis.innerWidth) || 0) *
      (Number(view?.innerHeight ?? globalThis.innerHeight) || 0);

    const frameCandidates = queryAll(queryDocument, 'iframe, frame')
      .map((frameElement) => {
        const frameDocument = getAccessibleFrameDocument(frameElement);
        if (!frameDocument) {
          return null;
        }

        const frameArea = getVisibleFrameArea(frameElement);
        if (frameArea <= 0) {
          return null;
        }

        const frameSelector =
          buildSelectorCandidates(frameElement, queryDocument)[0] ||
          buildFallbackSelector(frameElement, queryDocument);
        if (!frameSelector) {
          return null;
        }

        return {
          doc: frameDocument,
          frameSelectors: [...frameSelectors, frameSelector],
          area: frameArea,
          textLength: getDocumentTextLength(frameDocument),
        };
      })
      .filter((candidate): candidate is {
        doc: any;
        frameSelectors: string[];
        area: number;
        textLength: number;
      } => Boolean(candidate))
      .sort((left, right) => {
        if (left.area !== right.area) {
          return right.area - left.area;
        }
        return right.textLength - left.textLength;
      });

    const dominantFrame = frameCandidates.find((candidate) => {
      if (viewportArea <= 0) {
        return candidate.textLength > 0;
      }

      return candidate.area / viewportArea >= 0.5 && candidate.textLength > 0;
    });

    if (!dominantFrame) {
      return {
        doc: queryDocument,
        frameSelectors,
      };
    }

    return resolvePrimaryCaptureContext(dominantFrame.doc, dominantFrame.frameSelectors);
  };

  const isInteractiveElement = (element: any): boolean => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'button' || tagName === 'textarea' || tagName === 'select' || tagName === 'summary') {
      return true;
    }
    if (tagName === 'a' && element.hasAttribute('href')) {
      return true;
    }
    if (tagName === 'input') {
      const inputType = (element.getAttribute('type') || 'text').toLowerCase();
      return inputType !== 'hidden';
    }
    if (element.isContentEditable) {
      return true;
    }

    const role = getRole(element);
    if (interactiveRoles.has(role)) {
      return true;
    }

    return getFallbackInteractionRole(element) !== 'generic';
  };

  const isStandaloneControl = (element: any): boolean => {
    const tagName = element.tagName.toLowerCase();
    if (
      tagName === 'button' ||
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea' ||
      tagName === 'a' ||
      tagName === 'summary'
    ) {
      return true;
    }

    const role = getRole(element);
    return interactiveRoles.has(role);
  };

  const getVisibleGeometryElement = (actionableElement: any, sourceElement: any): any => {
    if (isStrictlyVisible(actionableElement)) {
      return actionableElement;
    }

    if (supportsAncestorVisibilityFallback(actionableElement)) {
      let current = actionableElement?.parentElement ?? null;
      while (current) {
        if (isStrictlyVisible(current)) {
          return current;
        }
        current = current.parentElement ?? null;
      }
    }

    if (isStrictlyVisible(sourceElement)) {
      return sourceElement;
    }

    return actionableElement;
  };

  const buildSelectorCandidates = (element: any, queryDocument: any): string[] => {
    const tagName = element.tagName.toLowerCase();
    const candidates = [];

    if (element.id) {
      candidates.push(`#${escapeIdentifier(element.id)}`);
      candidates.push(`${tagName}#${escapeIdentifier(element.id)}`);
    }

    const testId =
      element.getAttribute('data-testid') ||
      element.getAttribute('data-test-id') ||
      element.getAttribute('data-qa') ||
      element.getAttribute('data-cy');
    if (testId) {
      candidates.push(
        `${tagName}[data-testid="${escapeAttributeValue(testId)}"]`,
        `${tagName}[data-test-id="${escapeAttributeValue(testId)}"]`,
        `${tagName}[data-qa="${escapeAttributeValue(testId)}"]`,
        `${tagName}[data-cy="${escapeAttributeValue(testId)}"]`
      );
    }

    const name = element.getAttribute('name');
    if (name) {
      candidates.push(`${tagName}[name="${escapeAttributeValue(name)}"]`);
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      candidates.push(`${tagName}[aria-label="${escapeAttributeValue(ariaLabel)}"]`);
    }

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) {
      candidates.push(`${tagName}[placeholder="${escapeAttributeValue(placeholder)}"]`);
    }

    if (tagName === 'a' && element.getAttribute('href')) {
      candidates.push(`${tagName}[href="${escapeAttributeValue(element.getAttribute('href'))}"]`);
    }

    if ((tagName === 'iframe' || tagName === 'frame') && element.getAttribute('title')) {
      candidates.push(`${tagName}[title="${escapeAttributeValue(element.getAttribute('title'))}"]`);
    }

    if ((tagName === 'iframe' || tagName === 'frame') && element.getAttribute('src')) {
      candidates.push(`${tagName}[src="${escapeAttributeValue(element.getAttribute('src'))}"]`);
    }

    return candidates.filter((selector) => isUniqueSelector(selector, queryDocument));
  };

  const buildFallbackSelector = (element: any, queryDocument: any): string | null =>
    buildUniqueSelector(element, {
      isUniqueSelector: (selector) => isUniqueSelector(selector, queryDocument),
      escapeIdentifier,
    });

  const buildElementRecord = (
    element: any,
    queryDocument: any,
    frameSelectors: string[]
  ): {
    record: Record<string, unknown>;
    actionableElement: any;
  } => {
    const semanticRole = getRole(element);
    const role = semanticRole === 'generic' ? getFallbackInteractionRole(element) : semanticRole;
    const actionableElement = selectActionableTarget(element, role) ?? element;
    const geometryElement = getVisibleGeometryElement(actionableElement, element);
    const selectorSource =
      actionableElement && actionableElement.tagName ? actionableElement : element;
    const candidates = buildSelectorCandidates(selectorSource, queryDocument);
    const fallbackSelector = buildFallbackSelector(selectorSource, queryDocument);
    const selector =
      prefixFrameScopedSelector(frameSelectors, candidates[0] || fallbackSelector || null) || null;
    const alternatives = candidates
      .map((candidate) => prefixFrameScopedSelector(frameSelectors, candidate))
      .filter((candidate) => candidate && candidate !== selector)
      .concat(
        fallbackSelector && prefixFrameScopedSelector(frameSelectors, fallbackSelector) !== selector
          ? [prefixFrameScopedSelector(frameSelectors, fallbackSelector)]
          : []
      );
    const checked =
      role === 'checkbox' || role === 'radio' || role === 'switch'
        ? isInputElement(actionableElement)
          ? actionableElement.checked
          : actionableElement.getAttribute('aria-checked') === 'true'
        : null;
    const rect = geometryElement.getBoundingClientRect();
    const viewportWidth = Number(globalThis.innerWidth) || 0;
    const viewportHeight = Number(globalThis.innerHeight) || 0;
    const inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < viewportHeight &&
      rect.left < viewportWidth;
    const verticalDistance =
      rect.bottom < 0 ? Math.abs(rect.bottom) : rect.top > viewportHeight ? rect.top - viewportHeight : 0;
    const horizontalDistance =
      rect.right < 0 ? Math.abs(rect.right) : rect.left > viewportWidth ? rect.left - viewportWidth : 0;
    const distanceFromViewport = Math.sqrt(
      verticalDistance * verticalDistance + horizontalDistance * horizontalDistance
    );

    return {
      actionableElement,
      record: {
        role,
        name: getLabelText(element) ?? getLabelText(actionableElement),
        tagName: actionableElement.tagName.toLowerCase(),
        inputType:
          isInputElement(actionableElement)
            ? (actionableElement.type || 'text').toLowerCase()
            : null,
        selector,
        alternativeSelectors: Array.from(new Set(alternatives.filter(Boolean) as string[])),
        placeholder: cleanText(actionableElement.getAttribute('placeholder')),
        disabled:
          actionableElement.hasAttribute('disabled') ||
          actionableElement.getAttribute('aria-disabled') === 'true' ||
          actionableElement.matches(':disabled'),
        checked,
        inViewport,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        distanceFromViewport: Math.round(distanceFromViewport),
      },
    };
  };

  const shouldKeepElementRecord = (record: Record<string, unknown>): boolean => {
    const role = cleanText(record.role) || 'element';
    const name = cleanText(record.name);
    const placeholder = cleanText(record.placeholder);

    if (role === 'generic') {
      return false;
    }

    if ((role === 'clickable' || role === 'focusable') && !name && !placeholder) {
      return false;
    }

    return true;
  };

  const elements: Array<Record<string, unknown>> = [];
  const includedElements = new WeakSet<object>();
  const includedActionTargets = new WeakSet<object>();
  let totalCount = 0;
  const captureContext = resolvePrimaryCaptureContext(document);

  for (const element of Array.from(captureContext.doc.querySelectorAll('*')) as any[]) {
    if (!isInteractiveElement(element) || !isVisible(element)) {
      continue;
    }

    let ancestor: any = element.parentElement;
    let skip = false;
    while (ancestor) {
      if (includedElements.has(ancestor) && !isStandaloneControl(element)) {
        skip = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    if (skip) {
      continue;
    }

    const { record, actionableElement } = buildElementRecord(
      element,
      captureContext.doc,
      captureContext.frameSelectors
    );
    if (includedActionTargets.has(actionableElement)) {
      continue;
    }

    if (!shouldKeepElementRecord(record)) {
      continue;
    }

    totalCount += 1;
    if (elements.length < maxElements) {
      elements.push(record);
      includedElements.add(element);
      includedActionTargets.add(actionableElement);
      if (actionableElement !== element) {
        includedElements.add(actionableElement);
      }
    }
  }

  return {
    [marker]: true,
    title: typeof document.title === 'string' && document.title.trim() ? document.title : null,
    url: typeof location.href === 'string' && location.href.trim() ? location.href : null,
    elements,
    count: totalCount,
    truncated: totalCount > elements.length,
  };
}
