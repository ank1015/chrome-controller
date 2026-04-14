import { runInNewContext } from 'node:vm';

import {
  buildPageTextEvaluationCode,
  convertHtmlToMarkdown,
  createPageMarkdown,
  PAGE_TEXT_EVAL_MARKER,
} from '../../../src/native-cli/page-markdown.js';

describe('page markdown helpers', () => {
  it('converts HTML into trimmed markdown', () => {
    expect(
      convertHtmlToMarkdown('<h1>Hello world</h1><p>Visit <a href="https://example.com">Example</a>.</p>')
    ).toBe('# Hello world\n\nVisit [Example](https://example.com).');
  });

  it('scrubs noisy tracker, image, and blob artifacts from markdown output', () => {
    const blob = `${'A'.repeat(120)}/`;

    expect(
      convertHtmlToMarkdown(
        `<main><p>Hello</p><p><img src="data:image/png;base64,${blob}" alt="tracker" /></p><p><a href="https://tracker.example.com/open?utm_source=newsletter&sig=${blob}">Open email</a></p><p>${blob}</p><p>Useful details</p></main>`
      )
    ).toBe('Hello\n\nOpen email\n\nUseful details');
  });

  it('creates markdown from a captured page payload', () => {
    expect(
      createPageMarkdown({
        [PAGE_TEXT_EVAL_MARKER]: true,
        title: 'Example',
        url: 'https://example.com',
        html: '<main><h2>Docs</h2><p>Useful text</p></main>',
      })
    ).toEqual({
      title: 'Example',
      url: 'https://example.com',
      html: '<main><h2>Docs</h2><p>Useful text</p></main>',
      markdown: '## Docs\n\nUseful text',
    });
  });

  it('creates markdown from a plain-text fallback payload', () => {
    expect(
      createPageMarkdown({
        [PAGE_TEXT_EVAL_MARKER]: true,
        title: 'Messages',
        url: 'https://example.com/messages',
        textFragments: ['Chat\n\nSearch', 'Yashraj Nayak\n1w\nYou: Havent got the acceptance'],
      })
    ).toEqual({
      title: 'Messages',
      url: 'https://example.com/messages',
      html: '',
      markdown: 'Chat\n\nSearch\n\nYashraj Nayak\n1w\nYou: Havent got the acceptance',
    });
  });

  it('prefers richer visible text when html conversion becomes too sparse', () => {
    expect(
      createPageMarkdown({
        [PAGE_TEXT_EVAL_MARKER]: true,
        title: 'X',
        url: 'https://x.com/i/chat',
        html: '<main><h1>Chat</h1><p>Start Conversation</p><p>New chat</p></main>',
        text:
          'Chat\n\nAll\n\nSearch\n\nYashraj Nayak\n1w\nYou: Havent got the acceptance\n\nAkshat\n1w\nSent a post\n\nStart Conversation\n\nNew chat',
      }).markdown
    ).toContain('Yashraj Nayak');
  });

  it('prefers a visible conversation overlay over the background feed root', () => {
    const feedMain = {
      nodeType: 1,
      tagName: 'MAIN',
      ownerDocument: null as any,
      innerText: 'Feed story Suggested for you money.focus A lot of people stay stuck',
      textContent: 'Feed story Suggested for you money.focus A lot of people stay stuck',
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
      getClientRects: () => [{ top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800 }],
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'MAIN',
        innerHTML: '<main><p>Feed story</p><p>Suggested for you</p><p>money.focus</p></main>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: (candidate: any) => candidate === feedMain,
    };
    const conversationPanel = {
      nodeType: 1,
      tagName: 'DIV',
      ownerDocument: null as any,
      innerText:
        'Rishabh | Fitness & Lifestyle therishabhxp · Instagram Hi there! Appreciate your comment As promised, here’s the prompt for you Message...',
      textContent:
        'Rishabh | Fitness & Lifestyle therishabhxp · Instagram Hi there! Appreciate your comment As promised, here’s the prompt for you Message...',
      getBoundingClientRect: () => ({ top: 360, left: 1120, right: 1480, bottom: 840, width: 360, height: 480 }),
      getClientRects: () => [{ top: 360, left: 1120, right: 1480, bottom: 840, width: 360, height: 480 }],
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'DIV',
        innerHTML:
          '<div><h2>Rishabh | Fitness & Lifestyle</h2><p>therishabhxp · Instagram</p><p>Hi there! Appreciate your comment</p><p>As promised, here’s the prompt for you</p><p>Message...</p></div>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: (name: string) => name === 'aria-label',
      getAttribute: (name: string) => {
        if (name === 'role') {
          return 'grid';
        }
        if (name === 'aria-label') {
          return 'Messages in conversation with Rishabh | Fitness & Lifestyle';
        }
        return null;
      },
      contains: (candidate: any) => candidate === conversationPanel,
    };
    const body = {
      nodeType: 1,
      tagName: 'BODY',
      ownerDocument: null as any,
      innerText: `${feedMain.innerText} ${conversationPanel.innerText}`,
      textContent: `${feedMain.textContent} ${conversationPanel.textContent}`,
      getBoundingClientRect: feedMain.getBoundingClientRect,
      getClientRects: feedMain.getClientRects,
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'BODY',
        innerHTML: '<body></body>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: (candidate: any) => candidate === body || candidate === feedMain || candidate === conversationPanel,
    };
    const topDocument = {
      title: '(1) Instagram',
      body,
      documentElement: body,
      querySelectorAll: (selector: string) => {
        if (selector === 'main, article, [role="main"]') {
          return [feedMain];
        }
        if (
          selector ===
          '[role="dialog"], [aria-modal="true"], [role="grid"], [role="list"], [role="region"], [role="complementary"]'
        ) {
          return [conversationPanel];
        }
        return [];
      },
      defaultView: {
        innerWidth: 1512,
        innerHeight: 949,
        getComputedStyle: (element: any) => {
          if (element === conversationPanel) {
            return { display: 'block', visibility: 'visible', position: 'fixed' };
          }
          return { display: 'block', visibility: 'visible', position: 'static' };
        },
      },
    };
    feedMain.ownerDocument = topDocument;
    conversationPanel.ownerDocument = topDocument;
    body.ownerDocument = topDocument;

    const raw = runInNewContext(buildPageTextEvaluationCode(), {
      document: topDocument,
      location: { href: 'https://www.instagram.com/' },
      window: topDocument.defaultView,
      Element: function Element() {},
      getComputedStyle: (element: any) => topDocument.defaultView.getComputedStyle(element),
    });

    const captured = createPageMarkdown(raw);
    expect(captured.markdown).toContain('Rishabh | Fitness & Lifestyle');
    expect(captured.markdown).toContain('Hi there! Appreciate your comment');
    expect(captured.markdown).not.toContain('Suggested for you');
  });

  it('prefers html fragments when the runtime splits a large capture payload', () => {
    const childCloneOne = {
      nodeType: 1,
      tagName: 'SECTION',
      innerHTML: '<section><h2>Inbox</h2><p>Thread A</p></section>',
      children: [],
      querySelectorAll: () => [],
    };
    const childCloneTwo = {
      nodeType: 1,
      tagName: 'SECTION',
      innerHTML: '<section><h2>Later</h2><p>Thread B</p></section>',
      children: [],
      querySelectorAll: () => [],
    };
    const rootClone = {
      nodeType: 1,
      tagName: 'MAIN',
      innerHTML: 'X'.repeat(13000),
      children: [childCloneOne, childCloneTwo],
      querySelectorAll: () => [],
    };
    const root = {
      nodeType: 1,
      tagName: 'MAIN',
      ownerDocument: null as any,
      innerText: 'Inbox Thread A Later Thread B',
      textContent: 'Inbox Thread A Later Thread B',
      children: [],
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
      getClientRects: () => [{ top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800 }],
      cloneNode: () => rootClone,
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: () => false,
    };
    const body = {
      nodeType: 1,
      tagName: 'BODY',
      ownerDocument: null as any,
      innerText: root.innerText,
      textContent: root.textContent,
      children: [],
      getBoundingClientRect: root.getBoundingClientRect,
      getClientRects: root.getClientRects,
      cloneNode: () => rootClone,
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: () => false,
    };
    const topDocument = {
      title: 'Messages',
      body,
      documentElement: body,
      querySelectorAll: (selector: string) => (selector === 'main, article, [role="main"]' ? [root] : []),
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      },
    };
    root.ownerDocument = topDocument;
    body.ownerDocument = topDocument;

    const raw = runInNewContext(buildPageTextEvaluationCode(), {
      document: topDocument,
      location: { href: 'https://example.com/messages' },
      window: topDocument.defaultView,
      Element: function Element() {},
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    });

    const captured = createPageMarkdown(raw);
    expect(captured.markdown).toContain('Inbox');
    expect(captured.markdown).toContain('Thread A');
    expect(captured.markdown).toContain('Later');
    expect(captured.markdown).toContain('Thread B');
  });

  it('captures visible text from a dominant same-origin iframe surface', () => {
    const topBody = {
      nodeType: 1,
      tagName: 'BODY',
      ownerDocument: null as any,
      innerText: '0 notifications',
      textContent: '0 notifications',
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }),
      getClientRects: () => [{ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }],
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'BODY',
        innerHTML: '<div>0 notifications</div>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    const frameMain = {
      nodeType: 1,
      tagName: 'MAIN',
      ownerDocument: null as any,
      innerText: 'Conversation List ICICI Bank Apr 8 A Premium No Fee Credit Card for you',
      textContent: 'Conversation List ICICI Bank Apr 8 A Premium No Fee Credit Card for you',
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }),
      getClientRects: () => [{ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }],
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'MAIN',
        innerHTML:
          '<main><h2>Conversation List</h2><p>ICICI Bank</p><p>A Premium No Fee Credit Card for you</p></main>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: () => false,
    };
    const frameBody = {
      nodeType: 1,
      tagName: 'BODY',
      ownerDocument: null as any,
      innerText: frameMain.innerText,
      textContent: frameMain.textContent,
      getBoundingClientRect: frameMain.getBoundingClientRect,
      getClientRects: frameMain.getClientRects,
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'BODY',
        innerHTML:
          '<main><h2>Conversation List</h2><p>ICICI Bank</p><p>A Premium No Fee Credit Card for you</p></main>',
        children: [],
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      hasAttribute: () => false,
      getAttribute: () => null,
      contains: () => false,
    };
    const frameDocument = {
      title: 'Messaging | LinkedIn',
      body: frameBody,
      documentElement: frameBody,
      querySelectorAll: (selector: string) => (selector === 'main, article, [role="main"]' ? [frameMain] : []),
      defaultView: {
        innerWidth: 1200,
        innerHeight: 784,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      },
    };
    frameMain.ownerDocument = frameDocument;
    frameBody.ownerDocument = frameDocument;
    const frameElement = {
      nodeType: 1,
      tagName: 'IFRAME',
      ownerDocument: null as any,
      contentDocument: frameDocument,
      contentWindow: { document: frameDocument },
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }),
      getClientRects: () => [{ top: 0, left: 0, right: 1200, bottom: 784, width: 1200, height: 784 }],
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    const topDocument = {
      title: 'Messaging | LinkedIn',
      body: topBody,
      documentElement: topBody,
      querySelectorAll: (selector: string) => (selector === 'iframe, frame' ? [frameElement] : []),
    };
    const topWindow = {
      innerWidth: 1200,
      innerHeight: 784,
    };
    topBody.ownerDocument = topDocument;
    frameElement.ownerDocument = topDocument;

    const raw = runInNewContext(buildPageTextEvaluationCode(), {
      document: topDocument,
      location: { href: 'https://www.linkedin.com/messaging/thread/abc/' },
      window: topWindow,
      Element: function Element() {},
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    });

    const captured = createPageMarkdown(raw);
    expect(captured.title).toBe('Messaging | LinkedIn');
    expect(captured.url).toBe('https://www.linkedin.com/messaging/thread/abc/');
    expect(captured.markdown).toContain('Conversation List');
    expect(captured.markdown).toContain('ICICI Bank');
    expect(captured.markdown).toContain('A Premium No Fee Credit Card for you');
    expect(captured.markdown).not.toBe('0 notifications');
  });
});
