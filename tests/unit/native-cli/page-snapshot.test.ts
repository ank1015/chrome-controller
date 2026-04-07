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
    const anchor = { kind: 'anchor' };
    const textbox = { kind: 'textbox' };
    const wrapper = {
      querySelector: (selector: string) =>
        selector.includes('contenteditable') ? textbox : null,
      closest: (selector: string) => (selector === 'a[href]' ? anchor : null),
    };

    expect(selectActionableSnapshotTarget(wrapper, 'link')).toBe(anchor);
    expect(selectActionableSnapshotTarget(wrapper, 'textbox')).toBe(textbox);
    expect(selectActionableSnapshotTarget(wrapper, 'button')).toBe(wrapper);
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
});
