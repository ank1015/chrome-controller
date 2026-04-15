import { getText, llm, userMessage } from '@ank1015/llm-sdk';

import type { PageTextCaptureResult } from './page-markdown.js';
import type { CliPageSnapshot, CliSnapshotElementInfo } from './types.js';

const DEFAULT_FIND_PAGE_MODEL_ELEMENT_LIMIT = 150;
const DEFAULT_FIND_PAGE_MODEL_TEXT_CHAR_LIMIT = 12_000;

export interface FindPageTextSource extends Pick<PageTextCaptureResult, 'title' | 'url'> {
  markdown: string;
}

export interface FindPageSnapshotLlmInput {
  query: string;
  snapshotMarkdown: string;
  limit: number;
}

export interface FindPageTextLlmInput {
  query: string;
  pageTextMarkdown: string;
  limit: number;
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

export function createFindPageSnapshotMarkdown(options: {
  snapshot: CliPageSnapshot;
  elementLimit?: number;
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
  const lines = [
    '# Interactive snapshot',
    '',
    `Title: ${options.snapshot.title ?? 'Untitled page'}`,
    `URL: ${options.snapshot.url ?? 'Unknown URL'}`,
    `Elements included: ${displayElements.length} of ${options.snapshot.count}`,
    '',
    '## Elements',
  ];

  if (displayElements.length === 0) {
    lines.push('No interactive elements found.');
  } else {
    for (const element of displayElements) {
      lines.push(formatFilteredSnapshotElementLine(element));
    }
  }

  return lines.join('\n');
}

export function createFindPageTextMarkdown(options: {
  pageText: FindPageTextSource;
  textCharacterLimit?: number;
}): string {
  const lines = [
    '# Page text',
    '',
    `Title: ${options.pageText.title ?? 'Untitled page'}`,
    `URL: ${options.pageText.url ?? 'Unknown URL'}`,
    '',
    '## Visible text',
  ];

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

function formatFilteredSnapshotElementLine(element: CliSnapshotElementInfo): string {
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

export async function runFindPageSnapshotLlm(
  input: FindPageSnapshotLlmInput
): Promise<string> {
  const message = await llm({
    modelId: 'codex/gpt-5.4-mini',
    reasoningEffort: 'low',
    system: buildFindPageSnapshotSystemPrompt(input),
    messages: [userMessage(input.snapshotMarkdown)],
  });
  const text = getText(message).trim();

  return text || FIND_PAGE_MODEL_LLM_FALLBACK;
}

export async function runFindPageTextLlm(input: FindPageTextLlmInput): Promise<string> {
  const message = await llm({
    modelId: 'codex/gpt-5.4-mini',
    reasoningEffort: 'low',
    system: buildFindPageTextSystemPrompt(input),
    messages: [userMessage(input.pageTextMarkdown)],
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

export function buildFindPageSnapshotSystemPrompt(
  input: FindPageSnapshotLlmInput
): string {
  return [
    'You are the semantic retrieval layer for interactive page snapshots in a Chrome control CLI.',
    `User intent: ${JSON.stringify(input.query)}`,
    `Maximum results to return: ${input.limit}`,
    '',
    'You will receive a markdown list of interactive snapshot elements from the current page.',
    'Return a filtered shortlist of the most relevant exact element lines for the intent.',
    '',
    'Rules:',
    '- Use only information present in the provided snapshot markdown.',
    '- Preserve every returned element line exactly as it appears in the snapshot.',
    '- Keep refs like @e1 exactly.',
    '- Prefer main-content matches over header, nav, footer, or repeated chrome unless the intent suggests otherwise.',
    '- Prefer over-inclusion to under-inclusion when the query implies a workflow, dialog, draft, or multi-step task.',
    '- When the intent includes action words like send, attach, submit, save, continue, search, or next, prioritize actionable controls alongside matching fields.',
    '- When the intent suggests an open composer, modal, or dialog, prefer controls that belong to that active workflow, including adjacent footer or toolbar actions.',
    '- When the intent contains multiple related targets, you may group matches into short markdown sections.',
    '- Return at most the requested number of element lines.',
    '- Output markdown only.',
    `- If nothing is relevant, return exactly: ${FIND_PAGE_MODEL_LLM_FALLBACK}`,
  ].join('\n');
}

export function buildFindPageTextSystemPrompt(input: FindPageTextLlmInput): string {
  return [
    'You are the semantic retrieval layer for visible page text in a Chrome control CLI.',
    `User intent: ${JSON.stringify(input.query)}`,
    `Maximum results to return: ${input.limit}`,
    '',
    'You will receive markdown extracted from the visible page text.',
    'Return the most relevant exact text statements, headings, or tight excerpts for the intent.',
    '',
    'Rules:',
    '- Use only information present in the provided page text.',
    '- Preserve the exact wording from the page text. Do not paraphrase, summarize, or normalize wording.',
    '- Prefer exact heading lines or tight exact excerpts over broad summaries.',
    '- It is okay to return slightly longer exact excerpts when surrounding details are needed to keep the result useful.',
    '- Keep related details together when the query is about items like emails, jobs, dates, compensation, locations, status, or other multi-field records.',
    '- Prefer main-content matches over header, nav, footer, or repeated chrome unless the intent suggests otherwise.',
    '- When the intent contains multiple related targets, you may group matches into short markdown sections.',
    '- Return at most the requested number of text items.',
    '- Output markdown only.',
    `- If nothing is relevant, return exactly: ${FIND_PAGE_MODEL_LLM_FALLBACK}`,
  ].join('\n');
}

function getPreferredMinimumCandidateCount(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    return 8;
  }

  return Math.min(limit, 10);
}
