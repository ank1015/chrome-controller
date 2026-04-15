import { vi } from 'vitest';

const { getTextMock, llmMock, userMessageMock } = vi.hoisted(() => ({
  llmMock: vi.fn(),
  getTextMock: vi.fn((message: { mockText?: string } | null | undefined) => message?.mockText ?? ''),
  userMessageMock: vi.fn((content: string) => ({
    role: 'user',
    id: 'user-message-1',
    timestamp: 0,
    content: [{ type: 'text', content }],
  })),
}));

vi.mock('@ank1015/llm-sdk', () => ({
  llm: llmMock,
  getText: getTextMock,
  userMessage: userMessageMock,
}));

import {
  buildFindPageSnapshotSystemPrompt,
  buildFindPageTextSystemPrompt,
  buildFindPageModelSystemPrompt,
  createFindPageSnapshotMarkdown,
  createFindPageTextMarkdown,
  createFindPageModelMarkdown,
  runFindPageSnapshotLlm,
  runFindPageTextLlm,
  runFindPageModelLlm,
} from '../../../src/native-cli/find-page-model.js';

describe('find page model helpers', () => {
  beforeEach(() => {
    llmMock.mockReset();
    getTextMock.mockClear();
    userMessageMock.mockClear();
  });

  it('builds a compact markdown page model from snapshot elements and page text', () => {
    expect(
      createFindPageModelMarkdown({
        snapshot: {
          source: 'dom-interactive-v1',
          snapshotId: 'snap-101',
          capturedAt: '2026-04-07T10:00:00.000Z',
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
              alternativeSelectors: ['input[name="email"]'],
              placeholder: 'Email',
              disabled: false,
              checked: null,
            },
            {
              ref: '@e2',
              role: 'button',
              name: 'Sign in',
              tagName: 'button',
              inputType: null,
              selector: 'button[type="submit"]',
              alternativeSelectors: [],
              placeholder: null,
              disabled: false,
              checked: null,
            },
          ],
        },
        pageText: {
          title: 'Example Login',
          url: 'https://example.com/login',
          markdown: '## Welcome back\n\nUse your work email to continue.',
        },
      })
    ).toBe(
      [
        '# Page model',
        '',
        'Title: Example Login',
        'URL: https://example.com/login',
        'Interactive elements included: 2 of 2',
        '',
        '## Interactive elements',
        '- @e1 [textbox type="email"] "Email" selector="#email" alt="input[name=\\"email\\"]"',
        '- @e2 [button] "Sign in" selector="button[type=\\"submit\\"]"',
        '',
        '## Visible page text',
        '## Welcome back',
        '',
        'Use your work email to continue.',
      ].join('\n')
    );
  });

  it('truncates oversized page text and uses the llm sdk with the expected prompt', async () => {
    const pageModelMarkdown = createFindPageModelMarkdown({
      snapshot: {
        source: 'dom-interactive-v1',
        snapshotId: 'snap-101',
        capturedAt: '2026-04-07T10:00:00.000Z',
        tabId: 101,
        title: 'Dense page',
        url: 'https://example.com/dense',
        count: 0,
        visibleCount: 0,
        truncated: false,
        elements: [],
      },
      pageText: {
        title: 'Dense page',
        url: 'https://example.com/dense',
        markdown: 'abcdefghijklmno',
      },
      textCharacterLimit: 10,
    });

    expect(pageModelMarkdown).toContain(
      'Note: page text exceeded 10 characters and was truncated.'
    );
    expect(pageModelMarkdown).toContain('[Page text truncated to 10 characters.]');

    llmMock.mockResolvedValue({
      mockText: '## Relevant elements\n- @e1 [textbox type="text"] "Search"',
    });

    await expect(
      runFindPageModelLlm({
        query: 'search box',
        limit: 20,
        pageModelMarkdown,
      })
    ).resolves.toBe('## Relevant elements\n- @e1 [textbox type="text"] "Search"');

    expect(userMessageMock).toHaveBeenCalledWith(pageModelMarkdown);
    expect(llmMock).toHaveBeenCalledWith({
      modelId: 'codex/gpt-5.4-mini',
      reasoningEffort: 'low',
      system: buildFindPageModelSystemPrompt({
        query: 'search box',
        limit: 20,
        pageModelMarkdown,
      }),
      messages: [
        {
          role: 'user',
          id: 'user-message-1',
          timestamp: 0,
          content: [{ type: 'text', content: pageModelMarkdown }],
        },
      ],
    });
    expect(getTextMock).toHaveBeenCalledWith({
      mockText: '## Relevant elements\n- @e1 [textbox type="text"] "Search"',
    });
  });

  it('builds focused markdown inputs for filtered snapshot and text retrieval', () => {
    expect(
      createFindPageSnapshotMarkdown({
        snapshot: {
          source: 'dom-interactive-v1',
          snapshotId: 'snap-101',
          capturedAt: '2026-04-07T10:00:00.000Z',
          tabId: 101,
          title: 'Inbox',
          url: 'https://mail.google.com',
          count: 2,
          visibleCount: 2,
          truncated: false,
          elements: [
            {
              ref: '@e1',
              role: 'button',
              name: 'Compose',
              tagName: 'button',
              inputType: null,
              selector: 'button',
              alternativeSelectors: [],
              placeholder: null,
              disabled: false,
              checked: null,
            },
            {
              ref: '@e2',
              role: 'link',
              name: 'Sent',
              tagName: 'a',
              inputType: null,
              selector: 'a[href="/sent"]',
              alternativeSelectors: [],
              placeholder: null,
              disabled: false,
              checked: null,
            },
          ],
        },
      })
    ).toContain('@e1 [button] "Compose"');

    expect(
      createFindPageTextMarkdown({
        pageText: {
          title: 'Inbox',
          url: 'https://mail.google.com',
          markdown: '# Inbox\n\nYour account summary is ready.',
        },
      })
    ).toBe(
      [
        '# Page text',
        '',
        'Title: Inbox',
        'URL: https://mail.google.com',
        '',
        '## Visible text',
        '# Inbox',
        '',
        'Your account summary is ready.',
      ].join('\n')
    );
  });

  it('uses specialized prompts for snapshot and text filtering', async () => {
    llmMock.mockResolvedValueOnce({
      mockText: '- @e1 [button] "Compose"',
    });
    llmMock.mockResolvedValueOnce({
      mockText: '- Your account summary is ready.',
    });

    await expect(
      runFindPageSnapshotLlm({
        query: 'compose related',
        limit: 5,
        snapshotMarkdown: '# Interactive snapshot',
      })
    ).resolves.toBe('- @e1 [button] "Compose"');

    await expect(
      runFindPageTextLlm({
        query: 'account summary',
        limit: 5,
        pageTextMarkdown: '# Page text',
      })
    ).resolves.toBe('- Your account summary is ready.');

    expect(llmMock).toHaveBeenNthCalledWith(1, {
      modelId: 'codex/gpt-5.4-mini',
      reasoningEffort: 'low',
      system: buildFindPageSnapshotSystemPrompt({
        query: 'compose related',
        limit: 5,
        snapshotMarkdown: '# Interactive snapshot',
      }),
      messages: [
        {
          role: 'user',
          id: 'user-message-1',
          timestamp: 0,
          content: [{ type: 'text', content: '# Interactive snapshot' }],
        },
      ],
    });
    expect(llmMock).toHaveBeenNthCalledWith(2, {
      modelId: 'codex/gpt-5.4-mini',
      reasoningEffort: 'low',
      system: buildFindPageTextSystemPrompt({
        query: 'account summary',
        limit: 5,
        pageTextMarkdown: '# Page text',
      }),
      messages: [
        {
          role: 'user',
          id: 'user-message-1',
          timestamp: 0,
          content: [{ type: 'text', content: '# Page text' }],
        },
      ],
    });
  });

  it('falls back to a no-results string when the llm returns no text', async () => {
    llmMock.mockResolvedValue({
      mockText: '   ',
    });

    await expect(
      runFindPageModelLlm({
        query: 'missing thing',
        limit: 5,
        pageModelMarkdown: '# Page model',
      })
    ).resolves.toBe('No relevant items found.');
  });

  it('includes the query and result cap in the system prompt', () => {
    const prompt = buildFindPageModelSystemPrompt({
      query: 'search box and search button',
      limit: 30,
      pageModelMarkdown: '# Page model',
    });

    expect(prompt).toContain('User intent: "search box and search button"');
    expect(prompt).toContain('Maximum results to return: 30');
    expect(prompt).toContain('Preferred minimum total candidates to return when available: 10');
    expect(prompt).toContain('Cover every distinct requested target you can find support for in the page model.');
    expect(prompt).toContain('Prefer over-inclusion to under-inclusion.');
    expect(prompt).toContain('Return multiple ranked candidates when more than one plausible match exists.');
    expect(prompt).toContain('include weaker or noisier but still plausible candidates');
    expect(prompt).toContain('## Target: <target name>');
  });

  it('tells text filtering to preserve exact wording and snapshot filtering to preserve exact element lines', () => {
    const snapshotPrompt = buildFindPageSnapshotSystemPrompt({
      query: 'send related or compose related',
      limit: 8,
      snapshotMarkdown: '# Interactive snapshot',
    });
    const textPrompt = buildFindPageTextSystemPrompt({
      query: 'latest inbox messages or unread mail summaries',
      limit: 8,
      pageTextMarkdown: '# Page text',
    });

    expect(snapshotPrompt).toContain('Preserve every returned element line exactly as it appears');
    expect(snapshotPrompt).toContain('prioritize actionable controls alongside matching fields');
    expect(snapshotPrompt).toContain('prefer controls that belong to that active workflow');
    expect(snapshotPrompt).toContain('Return at most the requested number of element lines.');
    expect(textPrompt).toContain('Preserve the exact wording from the page text.');
    expect(textPrompt).toContain('Prefer exact heading lines or tight exact excerpts');
    expect(textPrompt).toContain('It is okay to return slightly longer exact excerpts');
    expect(textPrompt).toContain('Keep related details together');
  });
});
