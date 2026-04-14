import { readPageSnapshotCache } from './page-snapshot.js';

import type { BrowserService, CliRunOptions, CliSessionRecord } from './types.js';

declare const document: any;
declare const window: any;
declare const Element: any;
declare const HTMLInputElement: any;
declare const HTMLTextAreaElement: any;
declare const HTMLSelectElement: any;
declare const Event: any;
declare const MouseEvent: any;
declare const getComputedStyle: (element: any) => any;

export interface ResolvedElementTarget {
  raw: string;
  selectors: string[];
  ref?: string;
  description: string;
  failureMessage?: string;
}

export interface DomOperationResult {
  ok?: boolean;
  exists?: boolean;
  matchedSelector?: string | null;
  text?: string | null;
  html?: string | null;
  value?: string | boolean | number | null;
  attribute?: string;
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean | null;
  box?: {
    x: number;
    y: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    inViewport: boolean;
  };
}

export async function resolveElementTarget(
  env: CliRunOptions['env'],
  session: CliSessionRecord,
  tabId: number,
  raw: string
): Promise<ResolvedElementTarget> {
  const normalized = raw.trim();
  if (!normalized) {
    throw new Error('Element target is required');
  }

  const ref = normalizeElementRef(normalized);
  if (!ref) {
    return {
      raw: normalized,
      selectors: [normalized],
      description: normalized,
    };
  }

  const snapshot = await readPageSnapshotCache(env, session.id, tabId);
  if (!snapshot) {
    throw new Error(
      `No snapshot cache found for tab ${tabId}. Run \`chrome-controller page snapshot\` first.`
    );
  }

  const element = snapshot.elements.find((candidate) => candidate.ref === ref);
  if (!element) {
    throw new Error(`Unknown element ref ${ref} for tab ${tabId}. Run page snapshot again.`);
  }

  const selectors = [element.selector, ...element.alternativeSelectors].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  if (selectors.length === 0) {
    throw new Error(
      `Element ${ref} does not have a usable unique selector. Run \`chrome-controller page snapshot\` again.`
    );
  }

  return {
    raw: normalized,
    selectors,
    ref,
    description: element.name ? `${ref} (${element.name})` : ref,
    failureMessage: `Could not uniquely resolve ${ref}. The page may have changed or the cached selectors are ambiguous. Run \`chrome-controller page snapshot\` again.`,
  };
}

export function normalizeElementRef(input: string): string | null {
  const trimmed = input.trim();
  const normalized = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return /^@e\d+$/.test(normalized) ? normalized : null;
}

export async function runDomOperation(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  target: ResolvedElementTarget,
  operation: string,
  payload: Record<string, unknown> = {},
  evaluateOptions?: {
    awaitPromise?: boolean;
    userGesture?: boolean;
  }
): Promise<DomOperationResult> {
  return (await browserService.evaluateTab(
    session,
    tabId,
    buildDomOperationCode({
      selectors: target.selectors,
      operation,
      ...(target.failureMessage ? { failureMessage: target.failureMessage } : {}),
      ...payload,
    }),
    evaluateOptions
  )) as DomOperationResult;
}

export async function withAttachedDebugger<T>(
  browserService: BrowserService,
  session: CliSessionRecord,
  tabId: number,
  fn: () => Promise<T>
): Promise<T> {
  const attachResult = await browserService.attachDebugger(session, tabId);

  try {
    return await fn();
  } finally {
    if (!attachResult.alreadyAttached) {
      await browserService.detachDebugger(session, tabId);
    }
  }
}

export function buildDomOperationCode(request: Record<string, unknown>): string {
  return `(${domOperationRuntime.toString()})(${JSON.stringify(request)})`;
}

export function parseRequiredFloat(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number value for ${name}: ${value}`);
  }

  return parsed;
}

export function parseOptionalIntegerFlag(
  args: string[],
  flagName: string
): { value?: number; rest: string[] } {
  const rest: string[] = [];
  let value: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      const rawValue = args[index + 1];
      if (!rawValue) {
        throw new Error(`Missing value for ${flagName}`);
      }
      value = parseRequiredInteger(rawValue, flagName);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${flagName}=`)) {
      value = parseRequiredInteger(arg.slice(flagName.length + 1), flagName);
      continue;
    }

    rest.push(arg);
  }

  return {
    ...(value !== undefined ? { value } : {}),
    rest,
  };
}

export function parseRequiredInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value for ${name}: ${value}`);
  }

  return parsed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryDetachedOperation<T>(
  operationName: string,
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 120);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isDetachedEvaluationError(error) || attempt === attempts - 1) {
        break;
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  if (isDetachedEvaluationError(lastError)) {
    throw new Error(
      `${operationName} could not finish because the page was navigating or re-rendering. Wait for the page to settle, then try again.`
    );
  }

  throw lastError;
}

export function isDetachedEvaluationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('detached') ||
    message.includes('debugger is not attached') ||
    message.includes('cannot find default execution context') ||
    message.includes('execution context was destroyed') ||
    message.includes('cannot find context with specified id') ||
    message.includes('inspected target navigated or closed')
  );
}

export async function retryStaleDomOperation<T>(
  operationName: string,
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 120);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableStaleDomError(error) || attempt === attempts - 1) {
        break;
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export function isRetryableStaleDomError(error: unknown): boolean {
  if (isDetachedEvaluationError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.startsWith('Could not find element for selectors:') ||
    error.message.startsWith('Could not uniquely resolve element for selectors:') ||
    error.message.startsWith('Could not uniquely resolve @e')
  );
}

function domOperationRuntime(request: {
  selectors: string[];
  operation: string;
  value?: string;
  attribute?: string;
  delayMs?: number;
  text?: string;
  state?: string;
  failureMessage?: string;
}): Promise<Record<string, unknown>> | Record<string, unknown> {
  const selectors = Array.isArray(request.selectors)
    ? request.selectors.filter((value) => typeof value === 'string' && value.length > 0)
    : [];
  const operation = typeof request.operation === 'string' ? request.operation : '';
  const delayMs =
    typeof request.delayMs === 'number' && Number.isFinite(request.delayMs) && request.delayMs >= 0
      ? request.delayMs
      : 0;

  const normalizeText = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized : null;
  };

  const resolveElement = (): {
    element: any;
    matchedSelector: string | null;
    hadAmbiguousSelector: boolean;
  } => {
    let hadAmbiguousSelector = false;

    for (const selector of selectors) {
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        if (matches.length === 1) {
          return {
            element: matches[0],
            matchedSelector: selector,
            hadAmbiguousSelector,
          };
        }
        if (matches.length > 1) {
          hadAmbiguousSelector = true;
        }
      } catch {
        continue;
      }
    }

    return {
      element: null,
      matchedSelector: null,
      hadAmbiguousSelector,
    };
  };

  const getResolutionErrorMessage = (resolved: {
    hadAmbiguousSelector: boolean;
  }): string => {
    if (typeof request.failureMessage === 'string' && request.failureMessage.trim()) {
      return request.failureMessage;
    }

    if (resolved.hadAmbiguousSelector) {
      return `Could not uniquely resolve element for selectors: ${selectors.join(', ')}`;
    }

    return `Could not find element for selectors: ${selectors.join(', ')}`;
  };

  const isVisible = (element: any): boolean => {
    if (!element || !(element instanceof Element)) {
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

  const isEnabled = (element: any): boolean =>
    !(
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.matches(':disabled')
    );

  const getChecked = (element: any): boolean | null => {
    if (element instanceof HTMLInputElement) {
      const type = (element.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        return element.checked;
      }
    }

    const ariaChecked = element.getAttribute('aria-checked');
    if (ariaChecked === 'true') {
      return true;
    }
    if (ariaChecked === 'false') {
      return false;
    }

    return null;
  };

  const getBox = (element: any) => {
    const rect = element.getBoundingClientRect();
    const viewportWidth = Number(window.innerWidth) || 0;
    const viewportHeight = Number(window.innerHeight) || 0;

    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      centerX: Math.round(rect.left + rect.width / 2),
      centerY: Math.round(rect.top + rect.height / 2),
      inViewport:
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth,
    };
  };

  const scrollIntoView = (element: any): void => {
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({
        block: 'center',
        inline: 'center',
      });
    }
  };

  const focusElement = (element: any): void => {
    if (typeof element.focus === 'function') {
      element.focus({
        preventScroll: true,
      });
    }
  };

  const placeCaretAtEnd = (element: any): void => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const length = typeof element.value === 'string' ? element.value.length : 0;
      if (typeof element.setSelectionRange === 'function') {
        element.setSelectionRange(length, length);
      }
      return;
    }

    if (!element?.isContentEditable) {
      return;
    }

    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!selection || typeof document.createRange !== 'function') {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const dispatchInputEvents = (element: any): void => {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  };

  const setElementValue = (element: any, nextValue: string): void => {
    if (element instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      );
      if (descriptor?.set) {
        descriptor.set.call(element, nextValue);
        return;
      }
    }

    if (element instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      );
      if (descriptor?.set) {
        descriptor.set.call(element, nextValue);
        return;
      }
    }

    if (element.isContentEditable) {
      element.textContent = nextValue;
      return;
    }

    if ('value' in element) {
      element.value = nextValue;
      return;
    }

    element.textContent = nextValue;
  };

  const getElementValue = (element: any): string | null => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return typeof element.value === 'string' ? element.value : null;
    }
    if (element instanceof HTMLSelectElement) {
      return typeof element.value === 'string' ? element.value : null;
    }
    if (element.isContentEditable) {
      return normalizeText(element.textContent);
    }
    if ('value' in element && typeof element.value === 'string') {
      return element.value;
    }

    return normalizeText(element.textContent);
  };

  const dispatchMouse = (
    element: any,
    type: string,
    button: number,
    buttons: number,
    detail: number
  ): void => {
    const box = getBox(element);
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button,
        buttons,
        detail,
        clientX: box.centerX,
        clientY: box.centerY,
      })
    );
  };

  const requireElement = (): { element: any; matchedSelector: string } => {
    const resolved = resolveElement();
    if (!resolved.element || !resolved.matchedSelector) {
      throw new Error(getResolutionErrorMessage(resolved));
    }

    return {
      element: resolved.element,
      matchedSelector: resolved.matchedSelector,
    };
  };

  const runSyncOperation = (): Record<string, unknown> => {
    if (operation === 'page-text-contains') {
      const targetText = normalizeText(request.text) ?? '';
      const bodyText = normalizeText(document.body?.innerText || document.body?.textContent || '') ?? '';
      return {
        value: bodyText.includes(targetText),
      };
    }

    const resolved = resolveElement();
    if (operation === 'exists') {
      return {
        exists: Boolean(resolved.element),
        matchedSelector: resolved.matchedSelector,
        visible: resolved.element ? isVisible(resolved.element) : false,
        enabled: resolved.element ? isEnabled(resolved.element) : false,
        checked: resolved.element ? getChecked(resolved.element) : null,
      };
    }

    if (!resolved.element || !resolved.matchedSelector) {
      throw new Error(getResolutionErrorMessage(resolved));
    }

    const element = resolved.element;
    const matchedSelector = resolved.matchedSelector;

    if (operation === 'scroll-into-view') {
      scrollIntoView(element);
      return {
        ok: true,
        matchedSelector,
        box: getBox(element),
      };
    }

    if (operation === 'focus') {
      scrollIntoView(element);
      focusElement(element);
      placeCaretAtEnd(element);
      return {
        ok: true,
        matchedSelector,
      };
    }

    if (operation === 'clear') {
      scrollIntoView(element);
      focusElement(element);
      setElementValue(element, '');
      placeCaretAtEnd(element);
      dispatchInputEvents(element);
      return {
        ok: true,
        matchedSelector,
        value: getElementValue(element),
      };
    }

    if (operation === 'fill') {
      scrollIntoView(element);
      focusElement(element);
      setElementValue(element, String(request.value ?? ''));
      placeCaretAtEnd(element);
      dispatchInputEvents(element);
      return {
        ok: true,
        matchedSelector,
        value: getElementValue(element),
      };
    }

    if (operation === 'select') {
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error('Target element is not a select element');
      }

      const rawValue = String(request.value ?? '');
      const option =
        Array.from(element.options).find((candidate: any) => candidate.value === rawValue) ??
        Array.from(element.options).find(
          (candidate: any) =>
            normalizeText(candidate.label) === normalizeText(rawValue) ||
            normalizeText(candidate.textContent) === normalizeText(rawValue)
        );

      if (!option) {
        throw new Error(`Could not find option "${rawValue}"`);
      }

      element.value = (option as any).value;
      dispatchInputEvents(element);
      return {
        ok: true,
        matchedSelector,
        value: element.value,
      };
    }

    if (operation === 'check' || operation === 'uncheck') {
      const nextChecked = operation === 'check';
      const currentChecked = getChecked(element);

      if (currentChecked === nextChecked) {
        return {
          ok: true,
          matchedSelector,
          checked: currentChecked,
        };
      }

      if (element instanceof HTMLInputElement) {
        const type = (element.type || '').toLowerCase();
        if (type === 'radio' && !nextChecked) {
          throw new Error('Radio inputs cannot be unchecked directly');
        }

        if (type === 'checkbox' || type === 'radio') {
          element.checked = nextChecked;
          dispatchInputEvents(element);
          return {
            ok: true,
            matchedSelector,
            checked: element.checked,
          };
        }
      }

      if (typeof element.click === 'function') {
        element.click();
      } else {
        dispatchMouse(element, 'click', 0, 1, 1);
      }

      return {
        ok: true,
        matchedSelector,
        checked: getChecked(element),
      };
    }

    if (operation === 'click') {
      scrollIntoView(element);
      focusElement(element);
      const button = 0;
      const buttons = 1;
      const detail = 1;

      dispatchMouse(element, 'mouseover', button, buttons, detail);
      dispatchMouse(element, 'mousemove', button, buttons, detail);
      dispatchMouse(element, 'mousedown', button, buttons, detail);
      dispatchMouse(element, 'mouseup', button, 0, detail);

      if (typeof element.click === 'function') {
        element.click();
      } else {
        dispatchMouse(element, 'click', button, 0, detail);
      }

      return {
        ok: true,
        matchedSelector,
        box: getBox(element),
      };
    }

    if (operation === 'dblclick' || operation === 'rightclick') {
      scrollIntoView(element);
      focusElement(element);
      const button = operation === 'rightclick' ? 2 : 0;
      const buttons = operation === 'rightclick' ? 2 : 1;
      const detail = operation === 'dblclick' ? 2 : 1;

      dispatchMouse(element, 'mouseover', button, buttons, detail);
      dispatchMouse(element, 'mousemove', button, buttons, detail);
      dispatchMouse(element, 'mousedown', button, buttons, detail);
      dispatchMouse(element, 'mouseup', button, 0, detail);
      dispatchMouse(
        element,
        operation === 'rightclick' ? 'contextmenu' : 'dblclick',
        button,
        0,
        detail
      );

      return {
        ok: true,
        matchedSelector,
        box: getBox(element),
      };
    }

    if (operation === 'hover') {
      scrollIntoView(element);
      dispatchMouse(element, 'mouseover', 0, 0, 0);
      dispatchMouse(element, 'mousemove', 0, 0, 0);
      return {
        ok: true,
        matchedSelector,
        box: getBox(element),
      };
    }

    if (operation === 'text') {
      return {
        matchedSelector,
        text: normalizeText(element.innerText || element.textContent || ''),
      };
    }

    if (operation === 'html') {
      return {
        matchedSelector,
        html: typeof element.outerHTML === 'string' ? element.outerHTML : null,
      };
    }

    if (operation === 'attr') {
      const attribute = typeof request.attribute === 'string' ? request.attribute : '';
      if (!attribute) {
        throw new Error('Attribute name is required');
      }

      return {
        matchedSelector,
        attribute,
        value: element.getAttribute(attribute),
      };
    }

    if (operation === 'value') {
      return {
        matchedSelector,
        value: getElementValue(element),
      };
    }

    if (operation === 'visible') {
      return {
        matchedSelector,
        value: isVisible(element),
      };
    }

    if (operation === 'enabled') {
      return {
        matchedSelector,
        value: isEnabled(element),
      };
    }

    if (operation === 'checked') {
      return {
        matchedSelector,
        value: getChecked(element),
      };
    }

    if (operation === 'box') {
      scrollIntoView(element);
      return {
        matchedSelector,
        box: getBox(element),
      };
    }

    if (operation === 'text-contains') {
      const targetText = normalizeText(request.text) ?? '';
      const haystack = normalizeText(element.innerText || element.textContent || '') ?? '';
      return {
        matchedSelector,
        value: haystack.includes(targetText),
      };
    }

    throw new Error(`Unsupported DOM operation: ${operation}`);
  };

  if (operation !== 'type') {
    return runSyncOperation();
  }

  const typedValue = String(request.value ?? '');

  return (async () => {
    const { element, matchedSelector } = requireElement();
    scrollIntoView(element);
    focusElement(element);
    placeCaretAtEnd(element);

    let currentValue = getElementValue(element) ?? '';
    for (const character of typedValue) {
      currentValue += character;
      setElementValue(element, currentValue);
      placeCaretAtEnd(element);
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return {
      ok: true,
      matchedSelector,
      value: getElementValue(element),
    };
  })();
}
