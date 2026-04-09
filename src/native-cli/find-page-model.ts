import { getText, llm, userMessage } from '@ank1015/llm-sdk';

import type { PageTextCaptureResult } from './page-markdown.js';
import type { CliPageSnapshot, CliSnapshotElementInfo } from './types.js';

const DEFAULT_FIND_PAGE_MODEL_ELEMENT_LIMIT = 150;
const DEFAULT_FIND_PAGE_MODEL_TEXT_CHAR_LIMIT = 12_000;

export interface FindPageTextSource extends Pick<PageTextCaptureResult, 'title' | 'url'> {
  markdown: string;
}

export interface FindPageModelLlmInput {
  query: string;
  pageModelMarkdown: string;
  limit: number;
}

const FIND_PAGE_MODEL_LLM_FALLBACK = 'No relevant items found.';

export function createFindPageModelMarkdown(options: {
  snapshot: CliPageSnapshot;
  pageText: FindPageTextSource;
  elementLimit?: number;
  textCharacterLimit?: number;
}): string {
  const requestedElementLimit = options.elementLimit;
  const safeElementLimit =
    Number.isInteger(requestedElementLimit) && requestedElementLimit > 0
      ? requestedElementLimit
      : DEFAULT_FIND_PAGE_MODEL_ELEMENT_LIMIT;
  const displayElements = options.snapshot.elements.slice(
    0,
    Math.min(options.snapshot.elements.length, safeElementLimit)
  );
  const title = options.snapshot.title ?? options.pageText.title ?? 'Untitled page';
  const url = options.snapshot.url ?? options.pageText.url ?? 'Unknown URL';
  const lines = [
    '# Page model',
    '',
    `Title: ${title}`,
    `URL: ${url}`,
    `Interactive elements included: ${displayElements.length} of ${options.snapshot.count}`,
    '',
    '## Interactive elements',
  ];

  if (displayElements.length === 0) {
    lines.push('No interactive elements found.');
  } else {
    for (const element of displayElements) {
      lines.push(formatFindSnapshotElementLine(element));
    }
  }

  lines.push('', '## Visible page text');

  const textBlock = normalizeFindTextBlock(
    options.pageText.markdown,
    options.textCharacterLimit ?? DEFAULT_FIND_PAGE_MODEL_TEXT_CHAR_LIMIT
  );
  if (textBlock.note) {
    lines.push(textBlock.note, '');
  }
  lines.push(textBlock.markdown || 'No visible page text captured.');

  return lines.join('\n');
}

function normalizeFindTextBlock(
  markdown: string,
  characterLimit: number
): { markdown: string; note: string | null } {
  const normalized = normalizeWhitespace(markdown);
  if (!normalized) {
    return {
      markdown: '',
      note: null,
    };
  }

  const safeLimit =
    Number.isInteger(characterLimit) && characterLimit > 0
      ? characterLimit
      : DEFAULT_FIND_PAGE_MODEL_TEXT_CHAR_LIMIT;
  if (normalized.length <= safeLimit) {
    return {
      markdown: normalized,
      note: null,
    };
  }

  const trimmed = normalized.slice(0, safeLimit).trimEnd();
  return {
    markdown: `${trimmed}\n\n[Page text truncated to ${safeLimit} characters.]`,
    note: `Note: page text exceeded ${safeLimit} characters and was truncated.`,
  };
}

function formatFindSnapshotElementLine(element: CliSnapshotElementInfo): string {
  const headerParts = [element.role];

  if (element.inputType) {
    headerParts.push(`type=${JSON.stringify(element.inputType)}`);
  }

  const parts = [`- ${element.ref} [${headerParts.join(' ')}]`];

  if (element.name) {
    parts.push(JSON.stringify(element.name));
  }
  if (element.placeholder && element.placeholder !== element.name) {
    parts.push(`placeholder=${JSON.stringify(element.placeholder)}`);
  }
  if (element.selector) {
    parts.push(`selector=${JSON.stringify(element.selector)}`);
  }
  if (element.alternativeSelectors.length > 0) {
    parts.push(
      `alt=${element.alternativeSelectors
        .slice(0, 2)
        .map((value) => JSON.stringify(value))
        .join(', ')}`
    );
  }
  if (element.checked === true) {
    parts.push('checked');
  }
  if (element.disabled) {
    parts.push('disabled');
  }

  return parts.join(' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export async function runFindPageModelLlm(input: FindPageModelLlmInput): Promise<string> {
  const message = await llm({
    modelId: 'codex/gpt-5.4-mini',
    reasoningEffort: 'low',
    system: buildFindPageModelSystemPrompt(input),
    messages: [userMessage(input.pageModelMarkdown)],
  });
  const text = getText(message).trim();

  return text || FIND_PAGE_MODEL_LLM_FALLBACK;
}

export function buildFindPageModelSystemPrompt(input: FindPageModelLlmInput): string {
  const preferredMinimumCandidates = getPreferredMinimumCandidateCount(input.limit);

  return [
    'You are the semantic retrieval layer for a Chrome control CLI used by coding agents.',
    `User intent: ${JSON.stringify(input.query)}`,
    `Maximum results to return: ${input.limit}`,
    `Preferred minimum total candidates to return when available: ${preferredMinimumCandidates}`,
    '',
    'You will receive a markdown page model containing interactive elements and visible page text.',
    '',
    'Return a filtered and reranked markdown response that is immediately useful to an agent.',
    'Treat the user intent as potentially containing multiple distinct requested targets.',
    'Cover every distinct requested target you can find support for in the page model.',
    'Do not stop after the single best answer when there are additional plausible matches.',
    'Prefer over-inclusion to under-inclusion. The goal is to narrow a large page down to a workable shortlist, not to pick one final answer.',
    '',
    'Rules:',
    '- Use only information present in the provided page model.',
    '- Prefer the most relevant elements and text for the stated intent.',
    '- Break the request into distinct targets when appropriate, such as "heading" plus "button" or "input" plus "submit action".',
    '- Keep element refs like @e1 exactly when you include them.',
    '- Do not invent refs, selectors, labels, or text that are not in the page model.',
    '- Prefer main-content matches over header, nav, footer, or repeated chrome unless the intent suggests otherwise.',
    '- Return at most the requested number of results.',
    '- Return multiple ranked candidates when more than one plausible match exists.',
    `- When the page model supports it, return at least ${preferredMinimumCandidates} total candidates across all target sections instead of stopping early.`,
    `- If there are fewer than ${preferredMinimumCandidates} strong candidates, include weaker or noisier but still plausible candidates until you reach that minimum or exhaust the page model.`,
    '- When one target has only one obvious match, include adjacent alternatives, nearby controls, partial matches, or noisier plausible options if available.',
    '- Output markdown only.',
    '- When returning element matches, preserve the original element line exactly as it appears in the page model.',
    '- When returning text matches, preserve exact heading lines or short exact snippets when possible instead of paraphrasing.',
    '- Order results best-first within each target section.',
    `- If nothing is relevant, return exactly: ${FIND_PAGE_MODEL_LLM_FALLBACK}`,
    '',
    'Suggested output shape:',
    '## Target: <target name>',
    '### Element candidates',
    '- exact element lines, ordered best-first',
    '### Text candidates',
    '- exact heading lines or short exact snippets, ordered best-first',
    '',
    'Create one target section for each distinct requested target you identify.',
    'If a target has no useful element or text candidates, omit that subsection but still include the target if you found something for it.',
  ].join('\n');
}

function getPreferredMinimumCandidateCount(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    return 8;
  }

  return Math.min(limit, 10);
}
