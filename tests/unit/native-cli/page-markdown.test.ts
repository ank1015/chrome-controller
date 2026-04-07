import { convertHtmlToMarkdown, createPageMarkdown, PAGE_TEXT_EVAL_MARKER } from '../../../src/native-cli/page-markdown.js';

describe('page markdown helpers', () => {
  it('converts HTML into trimmed markdown', () => {
    expect(
      convertHtmlToMarkdown('<h1>Hello world</h1><p>Visit <a href="https://example.com">Example</a>.</p>')
    ).toBe('# Hello world\n\nVisit [Example](https://example.com).');
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
});
