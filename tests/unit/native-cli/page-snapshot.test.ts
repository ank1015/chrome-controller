import { runInNewContext } from 'node:vm';

import {
  buildPageSnapshotEvaluationCode,
  buildUniqueFallbackSelector,
  PAGE_SNAPSHOT_EVAL_MARKER,
  createPageSnapshotDisplay,
  createPageSnapshotRecord,
  renderPageSnapshotLines,
  selectActionableSnapshotTarget,
} from '../../../src/native-cli/page-snapshot.js';

function createFakeElement(
  tagName: string,
  options: {
    id?: string;
    parentElement?: any;
  } = {}
): any {
  const element = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id: options.id ?? '',
    parentElement: options.parentElement ?? null,
    children: [] as any[],
  };

  if (options.parentElement) {
    options.parentElement.children.push(element);
  }

  return element;
}

describe('native CLI page snapshot helpers', () => {
  it('normalizes runtime snapshot data into ref-based records', () => {
    const snapshot = createPageSnapshotRecord({
      sessionId: 's1',
      tabId: 101,
      now: new Date('2026-04-06T12:00:00.000Z'),
      raw: {
        [PAGE_SNAPSHOT_EVAL_MARKER]: true,
        title: 'Example Login',
        url: 'https://example.com/login',
        elements: [
          {
            role: 'textbox',
            name: 'Email',
            tagName: 'INPUT',
            inputType: 'EMAIL',
            selector: '#email',
            alternativeSelectors: ['input[name="email"]', '#email'],
            placeholder: 'Email',
            disabled: false,
            checked: null,
            inViewport: true,
            top: 120,
            left: 24,
            distanceFromViewport: 0,
          },
          {
            role: 'checkbox',
            name: 'Remember me',
            tagName: 'input',
            inputType: 'checkbox',
            selector: '#remember',
            alternativeSelectors: [],
            placeholder: null,
            disabled: false,
            checked: true,
            inViewport: true,
            top: 180,
            left: 24,
            distanceFromViewport: 0,
          },
        ],
        count: 2,
        truncated: false,
      },
    });

    expect(snapshot).toEqual({
      version: 1,
      sessionId: 's1',
      source: 'dom-interactive-v1',
      snapshotId: 'snap-101-2026-04-06T12-00-00-000Z',
      capturedAt: '2026-04-06T12:00:00.000Z',
      tabId: 101,
      title: 'Example Login',
      url: 'https://example.com/login',
      elements: [
        {
          ref: '@e1',
          role: 'textbox',
          name: 'Email',
          tagName: 'input',
          inputType: 'email',
          selector: '#email',
          alternativeSelectors: ['input[name="email"]'],
          placeholder: 'Email',
          disabled: false,
          checked: null,
        },
        {
          ref: '@e2',
          role: 'checkbox',
          name: 'Remember me',
          tagName: 'input',
          inputType: 'checkbox',
          selector: '#remember',
          alternativeSelectors: [],
          placeholder: null,
          disabled: false,
          checked: true,
        },
      ],
      count: 2,
      visibleCount: 2,
      truncated: false,
    });
  });

  it('renders compact interactive snapshot lines', () => {
    const lines = renderPageSnapshotLines({
      source: 'dom-interactive-v1',
      snapshotId: 'snap-101-2026-04-06T12-00-00-000Z',
      capturedAt: '2026-04-06T12:00:00.000Z',
      tabId: 101,
      title: 'Example Login',
      url: 'https://example.com/login',
      count: 2,
      visibleCount: 2,
      truncated: false,
      elements: [
        {
          ref: '@e1',
          role: 'textbox',
          name: 'Email',
          tagName: 'input',
          inputType: 'email',
          selector: '#email',
          alternativeSelectors: [],
          placeholder: 'Email',
          disabled: false,
          checked: null,
        },
        {
          ref: '@e2',
          role: 'checkbox',
          name: 'Remember me',
          tagName: 'input',
          inputType: 'checkbox',
          selector: '#remember',
          alternativeSelectors: [],
          placeholder: null,
          disabled: true,
          checked: true,
        },
      ],
    });

    expect(lines).toEqual([
      'Page: Example Login',
      'URL: https://example.com/login',
      '',
      '@e1 [textbox type="email"] "Email"',
      '@e2 [checkbox type="checkbox"] "Remember me" checked disabled',
    ]);
  });

  it('prefers viewport elements for display while keeping the full cache', () => {
    const snapshot = createPageSnapshotRecord({
      sessionId: 's1',
      tabId: 101,
      now: new Date('2026-04-06T12:00:00.000Z'),
      raw: {
        [PAGE_SNAPSHOT_EVAL_MARKER]: true,
        title: 'Dense page',
        url: 'https://example.com/dense',
        elements: [
          {
            role: 'button',
            name: 'Offscreen action',
            tagName: 'button',
            inputType: null,
            selector: '#offscreen-action',
            alternativeSelectors: [],
            placeholder: null,
            disabled: false,
            checked: null,
            inViewport: false,
            top: 1800,
            left: 40,
            distanceFromViewport: 900,
          },
          {
            role: 'clickable',
            name: 'Visible card',
            tagName: 'div',
            inputType: null,
            selector: '.card',
            alternativeSelectors: [],
            placeholder: null,
            disabled: false,
            checked: null,
            inViewport: true,
            top: 260,
            left: 24,
            distanceFromViewport: 0,
          },
          {
            role: 'textbox',
            name: 'Search',
            tagName: 'input',
            inputType: 'text',
            selector: '#search',
            alternativeSelectors: [],
            placeholder: 'Search',
            disabled: false,
            checked: null,
            inViewport: true,
            top: 40,
            left: 24,
            distanceFromViewport: 0,
          },
        ],
        count: 3,
        truncated: false,
      },
    });

    expect(snapshot.elements.map((element) => element.ref)).toEqual(['@e1', '@e2', '@e3']);
    expect(snapshot.elements.map((element) => element.name)).toEqual([
      'Search',
      'Visible card',
      'Offscreen action',
    ]);
    expect(snapshot.visibleCount).toBe(2);

    expect(createPageSnapshotDisplay(snapshot)).toEqual({
      elements: [
        snapshot.elements[0],
        snapshot.elements[1],
      ],
      displayedCount: 2,
      visibleCount: 2,
      count: 3,
      scope: 'viewport',
      truncated: true,
    });
  });

  it('prefers actionable anchor ancestors for link-like snapshot targets', () => {
    const anchor = { kind: 'anchor', nodeType: 1 };
    const textbox = { kind: 'textbox', nodeType: 1 };
    const wrapper = {
      nodeType: 1,
      querySelectorAll: (selector: string) =>
        selector.includes('contenteditable') ? [textbox] : [],
      closest: (selector: string) => (selector === 'a[href]' ? anchor : null),
    };

    expect(selectActionableSnapshotTarget(wrapper, 'link')).toBe(anchor);
    expect(selectActionableSnapshotTarget(wrapper, 'textbox')).toBe(textbox);
    expect(selectActionableSnapshotTarget(wrapper, 'button')).toBe(wrapper);
  });

  it('prefers a visible textbox descendant over hidden matches for snapshot targets', () => {
    class SnapshotElement {
      nodeType = 1;
      parentElement: SnapshotElement | null = null;
      children: SnapshotElement[] = [];
      constructor(
        readonly label: string,
        readonly rect: { width: number; height: number }
      ) {}

      getBoundingClientRect() {
        return {
          top: 20,
          left: 10,
          right: 10 + this.rect.width,
          bottom: 20 + this.rect.height,
          width: this.rect.width,
          height: this.rect.height,
        };
      }

      getClientRects() {
        return this.rect.width > 0 && this.rect.height > 0 ? [this.getBoundingClientRect()] : [];
      }
    }

    const previousElement = (globalThis as Record<string, unknown>).Element;
    const previousComputedStyle = (globalThis as Record<string, unknown>).getComputedStyle;
    (globalThis as Record<string, unknown>).Element = SnapshotElement;
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      display: 'block',
      visibility: 'visible',
    });

    try {
      const hiddenTextbox = new SnapshotElement('hidden', { width: 0, height: 0 });
      const visibleTextbox = new SnapshotElement('visible', { width: 200, height: 32 });
      const wrapper = {
        matches: () => false,
        querySelectorAll: () => [hiddenTextbox, visibleTextbox],
        closest: () => null,
      };

      expect(selectActionableSnapshotTarget(wrapper, 'textbox')).toBe(visibleTextbox);
    } finally {
      (globalThis as Record<string, unknown>).Element = previousElement;
      (globalThis as Record<string, unknown>).getComputedStyle = previousComputedStyle;
    }
  });

  it('deduplicates snapshot records that collapse onto the same actionable selector', () => {
    const snapshot = createPageSnapshotRecord({
      sessionId: 's1',
      tabId: 101,
      raw: {
        [PAGE_SNAPSHOT_EVAL_MARKER]: true,
        title: 'Chat page',
        url: 'https://example.com/chat',
        elements: [
          {
            role: 'textbox',
            name: 'Ask anything',
            tagName: 'div',
            inputType: null,
            selector: '[contenteditable="true"]',
            alternativeSelectors: ['[role="textbox"]'],
            placeholder: 'Ask anything',
            disabled: false,
            checked: null,
            inViewport: true,
            top: 640,
            left: 48,
            distanceFromViewport: 0,
          },
          {
            role: 'textbox',
            name: 'Ask anything',
            tagName: 'div',
            inputType: null,
            selector: '[contenteditable="true"]',
            alternativeSelectors: ['div:nth-of-type(2)'],
            placeholder: 'Ask anything',
            disabled: false,
            checked: null,
            inViewport: true,
            top: 642,
            left: 50,
            distanceFromViewport: 0,
          },
        ],
        count: 2,
        truncated: false,
      },
    });

    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.count).toBe(1);
  });

  it('builds a deep unique fallback selector without truncating at six ancestors', () => {
    const root = createFakeElement('main');
    const level1 = createFakeElement('div', { parentElement: root });
    const level2 = createFakeElement('div', { parentElement: level1 });
    const level3 = createFakeElement('div', { parentElement: level2 });
    const level4 = createFakeElement('div', { parentElement: level3 });
    const level5 = createFakeElement('div', { parentElement: level4 });
    const level6 = createFakeElement('div', { parentElement: level5 });
    const target = createFakeElement('button', { parentElement: level6 });
    const expected =
      'main > div > div > div > div > div > div > button';

    expect(
      buildUniqueFallbackSelector(target, {
        isUniqueSelector: (selector) => selector === expected,
        escapeIdentifier: (value) => String(value),
      })
    ).toBe(expected);
  });

  it('returns null when a deep fallback selector never becomes unique', () => {
    const root = createFakeElement('main');
    const level1 = createFakeElement('div', { parentElement: root });
    const level2 = createFakeElement('div', { parentElement: level1 });
    const level3 = createFakeElement('div', { parentElement: level2 });
    const level4 = createFakeElement('div', { parentElement: level3 });
    const level5 = createFakeElement('div', { parentElement: level4 });
    const level6 = createFakeElement('div', { parentElement: level5 });
    const target = createFakeElement('button', { parentElement: level6 });

    expect(
      buildUniqueFallbackSelector(target, {
        isUniqueSelector: () => false,
        escapeIdentifier: (value) => String(value),
      })
    ).toBeNull();
  });

  it('buildPageSnapshotEvaluationCode executes in an isolated runtime without missing helper references', () => {
    const element = {
      tagName: 'BUTTON',
      id: '',
      parentElement: null,
      children: [],
      matches: () => false,
      querySelector: () => null,
      closest: () => null,
      getAttribute: () => null,
      hasAttribute: () => false,
      getBoundingClientRect: () => ({
        top: 20,
        left: 10,
        right: 110,
        bottom: 60,
        width: 100,
        height: 40,
      }),
      getClientRects: () => [{ top: 20, left: 10, right: 110, bottom: 60, width: 100, height: 40 }],
      innerText: 'Open chat',
      textContent: 'Open chat',
      isContentEditable: false,
    };

    const result = runInNewContext(buildPageSnapshotEvaluationCode(10), {
      document: {
        title: 'Messages',
        querySelectorAll: (selector: string) => {
          if (selector === '*') {
            return [element];
          }
          if (selector === 'button') {
            return [element];
          }
          return [];
        },
      },
      location: {
        href: 'https://example.com/direct',
      },
      Node: {
        ELEMENT_NODE: 1,
      },
      Element: function Element() {},
      HTMLInputElement: function HTMLInputElement() {},
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        cursor: 'default',
      }),
      innerWidth: 1280,
      innerHeight: 720,
      CSS: {
        escape: (value: string) => value,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        [PAGE_SNAPSHOT_EVAL_MARKER]: true,
        title: 'Messages',
        url: 'https://example.com/direct',
        truncated: false,
      })
    );
  });

  it('keeps proxy-backed textbox controls visible in snapshots when they live inside a visible container', () => {
    class RuntimeElement {
      nodeType = 1;
      tagName: string;
      parentElement: RuntimeElement | null;
      children: RuntimeElement[] = [];
      attributes = new Map<string, string>();
      ownerDocument: any = null;
      rect: {
        top: number;
        left: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      };
      isContentEditable = false;

      constructor(
        tagName: string,
        rect: { top: number; left: number; width: number; height: number },
        parentElement: RuntimeElement | null = null
      ) {
        this.tagName = tagName.toUpperCase();
        this.parentElement = parentElement;
        this.ownerDocument = parentElement?.ownerDocument ?? null;
        this.rect = {
          top: rect.top,
          left: rect.left,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          width: rect.width,
          height: rect.height,
        };
        if (parentElement) {
          parentElement.children.push(this);
        }
      }

      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }

      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      }

      hasAttribute(name: string) {
        return this.attributes.has(name);
      }

      matches(selector: string) {
        return selector === 'input[aria-label="Recipients"]';
      }

      querySelectorAll(selector: string) {
        if (selector === 'input:not([type="hidden"]), textarea, [role~="textbox"], [role~="searchbox"], [contenteditable=""], [contenteditable="true"]') {
          return [input];
        }

        return [];
      }

      closest() {
        return null;
      }

      getBoundingClientRect() {
        return this.rect;
      }

      getClientRects() {
        return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : [];
      }

      get innerText() {
        return this.getAttribute('aria-label') ?? '';
      }

      get textContent() {
        return this.getAttribute('aria-label') ?? '';
      }
    }

    class RuntimeInputElement extends RuntimeElement {
      type = 'text';
    }

    const dialog = new RuntimeElement('div', {
      top: 120,
      left: 800,
      width: 420,
      height: 320,
    });
    const input = new RuntimeInputElement(
      'input',
      {
        top: 140,
        left: 820,
        width: 0,
        height: 0,
      },
      dialog
    );
    input.setAttribute('aria-label', 'Recipients');
    input.setAttribute('type', 'text');

    const rawResult = runInNewContext(buildPageSnapshotEvaluationCode(10), {
      document: {
        title: 'Inbox',
        querySelectorAll: (selector: string) => {
          if (selector === '*') {
            return [input];
          }
          if (selector === 'input[aria-label="Recipients"]') {
            return [input];
          }
          return [];
        },
      },
      location: {
        href: 'https://mail.google.com/mail/u/0/#inbox',
      },
      Node: {
        ELEMENT_NODE: 1,
      },
      Element: RuntimeElement,
      HTMLInputElement: RuntimeInputElement,
      HTMLTextAreaElement: function HTMLTextAreaElement() {},
      HTMLSelectElement: function HTMLSelectElement() {},
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        cursor: 'text',
      }),
      innerWidth: 1280,
      innerHeight: 720,
      CSS: {
        escape: (value: string) => value,
      },
    });

    const snapshot = createPageSnapshotRecord({
      sessionId: 's1',
      tabId: 101,
      now: new Date('2026-04-14T00:00:00.000Z'),
      raw: rawResult,
    });

    expect(snapshot.elements).toEqual([
      expect.objectContaining({
        ref: '@e1',
        role: 'textbox',
        name: 'Recipients',
        selector: 'input[aria-label="Recipients"]',
      }),
    ]);
    expect(snapshot.visibleCount).toBe(1);
  });

  it('captures interactive elements from a dominant same-origin iframe with frame-scoped selectors', () => {
    const frameButton = {
      nodeType: 1,
      tagName: 'BUTTON',
      id: '',
      ownerDocument: null as any,
      parentElement: null,
      children: [] as any[],
      isContentEditable: false,
      getAttribute: (name: string) => {
        if (name === 'aria-label') {
          return 'Compose a new message';
        }
        return null;
      },
      hasAttribute: (name: string) => name === 'aria-label',
      matches: () => false,
      querySelectorAll: () => [],
      closest: () => null,
      getBoundingClientRect: () => ({
        top: 60,
        left: 760,
        right: 800,
        bottom: 100,
        width: 40,
        height: 40,
      }),
      getClientRects: () => [
        {
          top: 60,
          left: 760,
          right: 800,
          bottom: 100,
          width: 40,
          height: 40,
        },
      ],
      innerText: 'Compose a new message',
      textContent: 'Compose a new message',
    };

    const frameDocument = {
      title: 'Messaging | LinkedIn',
      body: {
        nodeType: 1,
        tagName: 'BODY',
        ownerDocument: null as any,
        innerText: 'Compose a new message',
        textContent: 'Compose a new message',
        getBoundingClientRect: () => ({
          top: 0,
          left: 0,
          right: 1200,
          bottom: 784,
          width: 1200,
          height: 784,
        }),
        getClientRects: () => [
          {
            top: 0,
            left: 0,
            right: 1200,
            bottom: 784,
            width: 1200,
            height: 784,
          },
        ],
      },
      documentElement: null as any,
      querySelectorAll: (selector: string) => {
        if (selector === '*') {
          return [frameButton];
        }
        if (selector === 'button[aria-label="Compose a new message"]') {
          return [frameButton];
        }
        if (selector === 'iframe, frame') {
          return [];
        }
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 784,
        getComputedStyle: () => ({
          display: 'block',
          visibility: 'visible',
          cursor: 'default',
        }),
      },
    };
    frameButton.ownerDocument = frameDocument;
    frameDocument.body.ownerDocument = frameDocument;
    frameDocument.documentElement = frameDocument.body;

    const frameElement = {
      nodeType: 1,
      tagName: 'IFRAME',
      id: '',
      ownerDocument: null as any,
      parentElement: null,
      children: [] as any[],
      contentDocument: frameDocument,
      contentWindow: { document: frameDocument },
      isContentEditable: false,
      getAttribute: (name: string) => {
        if (name === 'title') {
          return 'Messaging preload';
        }
        return null;
      },
      hasAttribute: (name: string) => name === 'title',
      matches: () => false,
      querySelectorAll: () => [],
      closest: () => null,
      getBoundingClientRect: () => ({
        top: 0,
        left: 0,
        right: 1200,
        bottom: 784,
        width: 1200,
        height: 784,
      }),
      getClientRects: () => [
        {
          top: 0,
          left: 0,
          right: 1200,
          bottom: 784,
          width: 1200,
          height: 784,
        },
      ],
      innerText: '',
      textContent: '',
    };

    const topDocument = {
      title: 'Messaging | LinkedIn',
      querySelectorAll: (selector: string) => {
        if (selector === 'iframe, frame' || selector === 'iframe[title="Messaging preload"]') {
          return [frameElement];
        }
        if (selector === '*') {
          return [];
        }
        return [];
      },
    };
    frameElement.ownerDocument = topDocument;

    const rawResult = runInNewContext(buildPageSnapshotEvaluationCode(10), {
      document: topDocument,
      location: {
        href: 'https://www.linkedin.com/messaging/thread/abc/',
      },
      Node: {
        ELEMENT_NODE: 1,
      },
      Element: function Element() {},
      HTMLInputElement: function HTMLInputElement() {},
      HTMLTextAreaElement: function HTMLTextAreaElement() {},
      HTMLSelectElement: function HTMLSelectElement() {},
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        cursor: 'default',
      }),
      innerWidth: 1200,
      innerHeight: 784,
      CSS: {
        escape: (value: string) => value,
      },
    });

    const snapshot = createPageSnapshotRecord({
      sessionId: 's1',
      tabId: 101,
      now: new Date('2026-04-15T00:00:00.000Z'),
      raw: rawResult,
    });

    expect(snapshot.elements).toEqual([
      expect.objectContaining({
        ref: '@e1',
        role: 'button',
        name: 'Compose a new message',
        selector: 'iframe[title="Messaging preload"] >>> button[aria-label="Compose a new message"]',
      }),
    ]);
  });
});
