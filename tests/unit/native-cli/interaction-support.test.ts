import { runInNewContext } from 'node:vm';

import {
  buildDomOperationCode,
  isDetachedEvaluationError,
  isRetryableStaleDomError,
  retryDetachedOperation,
  retryStaleDomOperation,
} from '../../../src/native-cli/interaction-support.js';

class FakeElement {
  tagName: string;
  attributes = new Map<string, string>();
  clicks = 0;
  events: Array<{ type: string }> = [];
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
    }> = {}
  ) {
    this.tagName = tagName.toUpperCase();
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

    return false;
  }

  scrollIntoView() {}

  focus() {}

  click() {
    this.clicks += 1;
  }

  dispatchEvent(event: { type: string }) {
    this.events.push(event);
    return true;
  }
}

class FakeInputElement extends FakeElement {}
class FakeTextAreaElement extends FakeElement {}
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
  return runInNewContext(buildDomOperationCode(request), {
    document: {
      querySelectorAll: (selector: string) => selectorMap[selector] ?? [],
    },
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      HTMLInputElement: FakeInputElement,
      HTMLTextAreaElement: FakeTextAreaElement,
    },
    Element: FakeElement,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
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
