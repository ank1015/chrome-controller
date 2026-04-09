import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildFindPageModelSystemPrompt } from '../../../src/native-cli/find-page-model.js';

const execFileAsync = promisify(execFile);
const runLiveFindTests = process.env.CHROME_CONTROLLER_RUN_LIVE_FIND_TESTS === '1';
const describeLive = runLiveFindTests ? describe : describe.skip;
const cliPath = resolve(process.cwd(), 'dist/native-cli/cli.js');
const artifactsRoot = resolve(process.cwd(), 'artifacts', 'find-live-evals');

interface LiveFindCase {
  id: string;
  url: string;
  query: string;
  limit: number;
  timeoutMs?: number;
}

interface CliJsonResult {
  success: boolean;
  sessionId?: string | null;
  error?: string;
  data?: Record<string, unknown>;
}

const LIVE_FIND_CASES: LiveFindCase[] = [
  {
    id: 'wikipedia-search-controls',
    url: 'https://www.wikipedia.org/',
    query: 'search box and search button',
    limit: 8,
    timeoutMs: 20_000,
  },
  {
    id: 'hn-first-story-comments',
    url: 'https://news.ycombinator.com/',
    query: 'the first story link and the comments link for that story',
    limit: 8,
    timeoutMs: 20_000,
  },
  {
    id: 'mdn-heading-intro',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    query: 'main article heading and the first paragraph explaining JavaScript',
    limit: 8,
    timeoutMs: 25_000,
  },
  {
    id: 'github-repo-heading-star',
    url: 'https://github.com/openai/openai-python',
    query: 'repository heading and star button',
    limit: 8,
    timeoutMs: 25_000,
  },
  {
    id: 'pypi-heading-install',
    url: 'https://pypi.org/project/openai/',
    query: 'package heading and the pip install command',
    limit: 8,
    timeoutMs: 25_000,
  },
];

describeLive('live native CLI find traces', () => {
  let tempHome: string;
  let runDirectory: string;

  beforeAll(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'chrome-controller-find-live-'));
    runDirectory = join(artifactsRoot, createRunId());
    await mkdir(runDirectory, { recursive: true });
    await runCliJson(['session', 'create', 'find-live-trace', '--json'], tempHome);
  }, 60_000);

  afterAll(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  for (const testCase of LIVE_FIND_CASES) {
    it(
      `captures LLM trace artifacts for ${testCase.id}`,
      async () => {
        const openedTabId = await openLiveCaseTab(testCase, tempHome);

        try {
          const waitResult = await runCliJson(
            [
              'wait',
              'stable',
              '--tab',
              String(openedTabId),
              '--timeout-ms',
              String(testCase.timeoutMs ?? 20_000),
              '--json',
            ],
            tempHome
          );
          expect(waitResult.success).toBe(true);

          const findResult = await runCliJson(
            [
              'find',
              testCase.query,
              '--tab',
              String(openedTabId),
              '--limit',
              String(testCase.limit),
              '--json',
            ],
            tempHome
          );
          expect(findResult.success).toBe(true);

          const pageModelMarkdown = asRequiredString(
            findResult.data?.pageModelMarkdown,
            'pageModelMarkdown'
          );
          const resultMarkdown = asRequiredString(
            findResult.data?.resultMarkdown,
            'resultMarkdown'
          );
          const systemPrompt = buildFindPageModelSystemPrompt({
            query: testCase.query,
            limit: testCase.limit,
            pageModelMarkdown,
          });

          expect(pageModelMarkdown.length).toBeGreaterThan(0);
          expect(resultMarkdown.length).toBeGreaterThan(0);

          await writeTraceArtifacts(runDirectory, testCase, {
            sessionId: findResult.sessionId ?? null,
            waitResult,
            findResult,
            systemPrompt,
            pageModelMarkdown,
            resultMarkdown,
          });
        } finally {
          await runCliJson(['tabs', 'close', String(openedTabId), '--json'], tempHome).catch(
            () => undefined
          );
        }
      },
      90_000
    );
  }
});

async function openLiveCaseTab(testCase: LiveFindCase, homeDir: string): Promise<number> {
  const openResult = await runCliJson(['tabs', 'open', testCase.url, '--json'], homeDir);
  expect(openResult.success).toBe(true);

  const tab = openResult.data?.tab;
  if (typeof tab !== 'object' || tab === null || !('id' in tab)) {
    throw new Error(`Missing tab id for case ${testCase.id}`);
  }

  const tabId = (tab as { id?: unknown }).id;
  if (!Number.isInteger(tabId)) {
    throw new Error(`Invalid tab id for case ${testCase.id}: ${String(tabId)}`);
  }

  return tabId as number;
}

async function writeTraceArtifacts(
  runDirectory: string,
  testCase: LiveFindCase,
  trace: {
    sessionId: string | null;
    waitResult: CliJsonResult;
    findResult: CliJsonResult;
    systemPrompt: string;
    pageModelMarkdown: string;
    resultMarkdown: string;
  }
): Promise<void> {
  const caseDirectory = join(runDirectory, testCase.id);
  await mkdir(caseDirectory, { recursive: true });

  const metadata = {
    caseId: testCase.id,
    url: testCase.url,
    query: testCase.query,
    limit: testCase.limit,
    sessionId: trace.sessionId,
    capturedAt: new Date().toISOString(),
    title: trace.findResult.data?.title ?? null,
    pageUrl: trace.findResult.data?.url ?? null,
    snapshotId: trace.findResult.data?.snapshotId ?? null,
    elementCount: trace.findResult.data?.elementCount ?? null,
    visibleElementCount: trace.findResult.data?.visibleElementCount ?? null,
    waitResult: trace.waitResult,
  };

  await writeFile(
    join(caseDirectory, 'meta.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  );
  await writeFile(join(caseDirectory, 'system-prompt.md'), `${trace.systemPrompt}\n`, 'utf8');
  await writeFile(join(caseDirectory, 'llm-input.md'), `${trace.pageModelMarkdown}\n`, 'utf8');
  await writeFile(join(caseDirectory, 'llm-output.md'), `${trace.resultMarkdown}\n`, 'utf8');
}

async function runCliJson(args: string[], homeDir: string): Promise<CliJsonResult> {
  const { stdout, stderr } = await execFileAsync('node', [cliPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, CHROME_CONTROLLER_HOME: homeDir },
    maxBuffer: 10 * 1024 * 1024,
  });

  const rawOutput = stdout.trim();
  if (!rawOutput) {
    throw new Error(`CLI produced no stdout for args: ${args.join(' ')}\nstderr: ${stderr}`);
  }

  try {
    return JSON.parse(rawOutput) as CliJsonResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse CLI JSON for args: ${args.join(' ')}\n${message}\nstdout:\n${rawOutput}\nstderr:\n${stderr}`
    );
  }
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${fieldName} in live find trace`);
  }

  return value;
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
