import { runInNewContext } from 'node:vm';

import {
  buildDomOperationCode,
  isDetachedEvaluationError,
  isRetryableStaleDomError,
  retryDetachedOperation,
  retryStaleDomOperation,
} from '../../../src/native-cli/interaction-support.js';

class FakeElement {
  nodeType = 1;
  tagName: string;
  attributes = new Map<string, string>();
  clicks = 0;
  events: Array<{ type: string }> = [];
  children: FakeElement[] = [];
  isContentEditable = false;
  parentElement: FakeElement | null;
  form: FakeFormElement | null = null;
  ownerDocument: any;
  rect: {
    x: number;
    y: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  constructor(
    tagName: string,
    rect: Partial<{
      x: number;
      y: number;
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    }> = {},
    options: {
      parentElement?: FakeElement | null;
      ownerDocument?: any;
    } = {}
  ) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = options.parentElement ?? null;
    this.ownerDocument = options.ownerDocument ?? options.parentElement?.ownerDocument ?? null;
    const left = rect.left ?? rect.x ?? 0;
    const top = rect.top ?? rect.y ?? 0;
    const width = rect.width ?? 120;
    const height = rect.height ?? 32;
    const right = rect.right ?? left + width;
    const bottom = rect.bottom ?? top + height;

    this.rect = {
      x: rect.x ?? left,
      y: rect.y ?? top,
      left,
      top,
      right,
      bottom,
      width,
      height,
    };

    if (this.parentElement) {
      this.parentElement.children.push(this);
    }
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getClientRects() {
    return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : [];
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector: string) {
    if (selector === ':disabled') {
      return false;
    }

    const normalized = selector.trim().toLowerCase();
    if (normalized === this.tagName.toLowerCase()) {
      return true;
    }

    return false;
  }

  querySelectorAll(selector: string) {
    if (selector !== '*') {
      return [];
    }

    const descendants: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    return descendants;
  }

  closest(selector: string) {
    const normalized = selector.trim().toLowerCase();
    let current: FakeElement | null = this;

    while (current) {
      if (current.matches(normalized)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  scrollIntoView() {}

  focus() {}

  click() {
    this.clicks += 1;
    this.events.push({ type: 'click' });
  }

  dispatchEvent(event: { type: string }) {
    this.events.push(event);
    return true;
  }
}

class FakeInputElement extends FakeElement {
  type = 'text';
  checked = false;
}
class FakeTextAreaElement extends FakeElement {}
class FakeButtonElement extends FakeElement {}
class FakeFormElement extends FakeElement {
  requestSubmitCalls = 0;
  submitCalls = 0;

  requestSubmit() {
    this.requestSubmitCalls += 1;
  }

  submit() {
    this.submitCalls += 1;
  }
}
class FakeSelectElement extends FakeElement {
  options: Array<{ value: string; label?: string; textContent?: string }> = [];
  value = '';
}

class FakeEvent {
  type: string;

  constructor(type: string) {
    this.type = type;
  }
}

class FakeMouseEvent extends FakeEvent {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type);
    Object.assign(this, init);
  }
}

function executeDomOperation(
  request: Record<string, unknown>,
  selectorMap: Record<string, FakeElement[]>
) {
  const documentObject = {
    querySelectorAll: (selector: string) => selectorMap[selector] ?? [],
    createRange: () => ({
      selectNodeContents() {},
      collapse() {},
    }),
  };
  documentObject.querySelectorAll = (selector: string) => selectorMap[selector] ?? [];
  const windowObject = {
    innerWidth: 1280,
    innerHeight: 720,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLButtonElement: FakeButtonElement,
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {},
    }),
  };

  for (const matches of Object.values(selectorMap)) {
    for (const element of matches) {
      if (!element.ownerDocument) {
        element.ownerDocument = documentObject;
      }
    }
  }

  documentObject.defaultView = windowObject;

  return runInNewContext(buildDomOperationCode(request), {
    document: documentObject,
    window: windowObject,
    Element: FakeElement,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLButtonElement: FakeButtonElement,
    HTMLSelectElement: FakeSelectElement,
    Event: FakeEvent,
    MouseEvent: FakeMouseEvent,
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
    }),
  });
}

function executeFrameDomOperation(
  request: Record<string, unknown>,
  options: {
    topSelectorMap: Record<string, FakeElement[]>;
    frameSelectorMap: Record<string, FakeElement[]>;
  }
) {
  const frameDocument: any = {
    querySelectorAll: (selector: string) => options.frameSelectorMap[selector] ?? [],
    createRange: () => ({
      selectNodeContents() {},
      collapse() {},
    }),
  };
  const frameWindow = {
    innerWidth: 1200,
    innerHeight: 784,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLButtonElement: FakeButtonElement,
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {},
    }),
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
    }),
  };
  frameDocument.defaultView = frameWindow;

  const topDocument: any = {
    querySelectorAll: (selector: string) => options.topSelectorMap[selector] ?? [],
    createRange: () => ({
      selectNodeContents() {},
      collapse() {},
    }),
  };
  const topWindow = {
    innerWidth: 1280,
    innerHeight: 720,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLButtonElement: FakeButtonElement,
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {},
    }),
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
    }),
  };
  topDocument.defaultView = topWindow;

  for (const matches of Object.values(options.topSelectorMap)) {
    for (const element of matches) {
      if (!element.ownerDocument) {
        element.ownerDocument = topDocument;
      }
    }
  }
  for (const matches of Object.values(options.frameSelectorMap)) {
    for (const element of matches) {
      if (!element.ownerDocument) {
        element.ownerDocument = frameDocument;
      }
    }
  }

  return runInNewContext(buildDomOperationCode(request), {
    document: topDocument,
    window: topWindow,
    Element: FakeElement,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLButtonElement: FakeButtonElement,
    HTMLSelectElement: FakeSelectElement,
    Event: FakeEvent,
    MouseEvent: FakeMouseEvent,
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
    }),
  });
}

describe('native CLI interaction support DOM runtime', () => {
  it('skips ambiguous selectors and uses a later unique selector for box reads', () => {
    const wrongA = new FakeElement('div', { left: 5, top: 10, width: 40, height: 20 });
    const wrongB = new FakeElement('div', { left: 55, top: 10, width: 40, height: 20 });
    const target = new FakeElement('button', { left: 240, top: 120, width: 180, height: 36 });

    const result = executeDomOperation(
      {
        selectors: ['.duplicate', '#target'],
        operation: 'box',
      },
      {
        '.duplicate': [wrongA, wrongB],
        '#target': [target],
      }
    ) as {
      matchedSelector: string;
      box: { left: number; top: number; width: number; height: number };
    };

    expect(result).toEqual({
      matchedSelector: '#target',
      box: {
        x: 240,
        y: 120,
        left: 240,
        top: 120,
        right: 420,
        bottom: 156,
        width: 180,
        height: 36,
        centerX: 330,
        centerY: 138,
        inViewport: true,
      },
    });
  });

  it('skips ambiguous selectors and only clicks the unique resolved element', () => {
    const wrongA = new FakeElement('div');
    const wrongB = new FakeElement('div');
    const target = new FakeElement('button');

    const result = executeDomOperation(
      {
        selectors: ['.duplicate', '#target'],
        operation: 'click',
      },
      {
        '.duplicate': [wrongA, wrongB],
        '#target': [target],
      }
    ) as {
      matchedSelector: string;
    };

    expect(result.matchedSelector).toBe('#target');
    expect(target.clicks).toBe(1);
    expect(target.events.filter((event) => event.type === 'click')).toHaveLength(1);
    expect(wrongA.clicks).toBe(0);
    expect(wrongB.clicks).toBe(0);
  });

  it('throws instead of acting on an ambiguous selector set', () => {
    const wrongA = new FakeElement('div');
    const wrongB = new FakeElement('div');
    const wrongC = new FakeElement('div');
    const wrongD = new FakeElement('div');

    expect(() =>
      executeDomOperation(
        {
          selectors: ['.duplicate', '.also-duplicate'],
          operation: 'click',
        },
        {
          '.duplicate': [wrongA, wrongB],
          '.also-duplicate': [wrongC, wrongD],
        }
      )
    ).toThrow('Could not uniquely resolve element');
    expect(wrongA.clicks).toBe(0);
    expect(wrongB.clicks).toBe(0);
    expect(wrongC.clicks).toBe(0);
    expect(wrongD.clicks).toBe(0);
  });

  it('prefers a single visible candidate when a selector also matches hidden elements', () => {
    const hidden = new FakeElement('div', { width: 0, height: 0 });
    const visible = new FakeElement('button', { left: 120, top: 80, width: 96, height: 32 });

    const result = executeDomOperation(
      {
        selectors: ['div[aria-label^="Send"]'],
        operation: 'click',
      },
      {
        'div[aria-label^="Send"]': [hidden, visible],
      }
    ) as {
      matchedSelector: string;
    };

    expect(result.matchedSelector).toBe('div[aria-label^="Send"]');
    expect(hidden.clicks).toBe(0);
    expect(visible.clicks).toBe(1);
  });

  it('returns the nearest visible box when the resolved click target has zero-size geometry', () => {
    const visibleWrapper = new FakeElement('div', { left: 120, top: 80, width: 96, height: 32 });
    const hiddenTarget = new FakeElement(
      'div',
      { left: 120, top: 80, width: 0, height: 0 },
      { parentElement: visibleWrapper }
    );

    const result = executeDomOperation(
      {
        selectors: ['div[aria-label^="Send"]'],
        operation: 'click',
      },
      {
        'div[aria-label^="Send"]': [hiddenTarget],
      }
    ) as {
      matchedSelector: string;
      box: { width: number; height: number; left: number; top: number; inViewport: boolean };
    };

    expect(result.matchedSelector).toBe('div[aria-label^="Send"]');
    expect(result.box).toEqual({
      left: 120,
      top: 80,
      width: 96,
      height: 32,
      x: 120,
      y: 80,
      right: 216,
      bottom: 112,
      centerX: 168,
      centerY: 96,
      inViewport: true,
    });
  });

  it('treats text inputs inside visible containers as visible for wait operations', () => {
    const container = new FakeElement('div', { left: 40, top: 40, width: 320, height: 48 });
    const input = new FakeInputElement('input', { width: 0, height: 0 }, { parentElement: container });
    input.type = 'text';

    const result = executeDomOperation(
      {
        selectors: ['input.compose-to'],
        operation: 'exists',
      },
      {
        'input.compose-to': [input],
      }
    ) as {
      exists: boolean;
      visible: boolean;
      enabled: boolean;
      matchedSelector: string;
    };

    expect(result).toEqual({
      exists: true,
      visible: true,
      enabled: true,
      matchedSelector: 'input.compose-to',
      checked: null,
    });
  });

  it('submits a single-line input through its associated form', () => {
    const form = new FakeFormElement('form');
    const input = new FakeInputElement('input', { left: 20, top: 20, width: 240, height: 32 }, { parentElement: form });
    input.type = 'search';
    input.form = form;

    const result = executeDomOperation(
      {
        selectors: ['input[name="q"]'],
        operation: 'submit',
      },
      {
        'input[name="q"]': [input],
      }
    ) as {
      matchedSelector: string;
      submitted: boolean;
      strategy: string;
    };

    expect(result).toEqual({
      matchedSelector: 'input[name="q"]',
      ok: true,
      submitted: true,
      strategy: 'requestSubmit',
    });
    expect(form.requestSubmitCalls).toBe(1);
    expect(form.submitCalls).toBe(0);
  });

  it('resolves frame-scoped selectors against same-origin iframes', () => {
    const frame = new FakeElement('iframe', { left: 0, top: 0, width: 1200, height: 784 });
    const button = new FakeElement('button', { left: 760, top: 60, width: 40, height: 40 });
    const frameDocument = {
      querySelectorAll: (selector: string) =>
        selector === 'button[aria-label="Compose a new message"]' ? [button] : [],
      documentElement: {},
      defaultView: {
        innerWidth: 1200,
        innerHeight: 784,
        getComputedStyle: () => ({
          display: 'block',
          visibility: 'visible',
        }),
      },
    };
    (frame as FakeElement & { contentDocument?: any; contentWindow?: any }).contentDocument =
      frameDocument;
    (frame as FakeElement & { contentWindow?: any }).contentWindow = {
      document: frameDocument,
    };

    const result = executeFrameDomOperation(
      {
        selectors: ['iframe[title="Messaging preload"] >>> button[aria-label="Compose a new message"]'],
        operation: 'box',
      },
      {
        topSelectorMap: {
          'iframe[title="Messaging preload"]': [frame],
        },
        frameSelectorMap: {
          'button[aria-label="Compose a new message"]': [button],
        },
      }
    ) as {
      matchedSelector: string;
      box: { left: number; top: number; width: number; height: number };
    };

    expect(result).toEqual({
      matchedSelector: 'iframe[title="Messaging preload"] >>> button[aria-label="Compose a new message"]',
      box: {
        x: 760,
        y: 60,
        left: 760,
        top: 60,
        right: 800,
        bottom: 100,
        width: 40,
        height: 40,
        centerX: 780,
        centerY: 80,
        inViewport: true,
      },
    });
  });
});

describe('native CLI stale DOM retries', () => {
  it('recognizes transient detached and stale selector errors as retryable', () => {
    expect(isRetryableStaleDomError(new Error('Detached while handling command.'))).toBe(true);
    expect(isRetryableStaleDomError(new Error('Cannot find default execution context'))).toBe(
      true
    );
    expect(
      isRetryableStaleDomError(
        new Error('Could not find element for selectors: button.submit')
      )
    ).toBe(true);
    expect(
      isRetryableStaleDomError(
        new Error('Could not uniquely resolve @e2. The page may have changed.')
      )
    ).toBe(true);
    expect(isRetryableStaleDomError(new Error('Target element is not a select element'))).toBe(
      false
    );
  });

  it('retries a transient stale error and returns the later success', async () => {
    let attempts = 0;

    const result = await retryStaleDomOperation('element click @e2', async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Could not find element for selectors: button.submit');
      }

      return 'ok';
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('recognizes transient execution-context errors as detached evaluation errors', () => {
    expect(isDetachedEvaluationError(new Error('Cannot find default execution context'))).toBe(
      true
    );
    expect(
      isDetachedEvaluationError(new Error('Execution context was destroyed, most likely because of a navigation.'))
    ).toBe(true);
    expect(isDetachedEvaluationError(new Error('Target element is not a select element'))).toBe(
      false
    );
  });

  it('retries a transient execution-context error and returns the later success', async () => {
    let attempts = 0;

    const result = await retryDetachedOperation('page snapshot', async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Cannot find default execution context');
      }

      return 'ok';
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
