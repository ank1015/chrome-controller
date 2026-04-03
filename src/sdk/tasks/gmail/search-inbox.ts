import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withWebBrowser } from '../../web.js';
import {
  GOOGLE_HUMAN_VERIFICATION_PREDICATE,
  waitForGoogleHumanVerificationIfNeeded,
} from '../shared/human-verification.js';

import { buildGmailThreadOpenUrl, type GmailMailOverview } from './fetch-n-mails.js';

import type { WebTab } from '../../web.js';

export interface SearchInboxOptions {
  query: string;
  count?: number;
  launch?: boolean;
}

export interface SearchInboxResult {
  status: 'ok' | 'login-required' | 'search-unavailable';
  query: string;
  inboxQuery: string;
  page: {
    title: string;
    url: string;
    route: string;
  };
  rowSelector: string | null;
  visibleRowCount: number;
  resultText: string | null;
  noResults: boolean;
  mails: GmailMailOverview[];
}

interface SearchInboxCliOptions extends Required<Omit<SearchInboxOptions, 'query'>> {
  query: string;
}

interface RawGmailMailOverview extends Omit<GmailMailOverview, 'openUrl'> {}

interface GmailSearchPageSnapshot {
  page: {
    title: string;
    url: string;
    route: string;
  };
  rowSelector: string | null;
  visibleRowCount: number;
  resultText: string | null;
  noResults: boolean;
  queryValue: string | null;
  isLoginGate: boolean;
  canGoNextResultsPage: boolean;
  firstMailSignature: string | null;
  mails: RawGmailMailOverview[];
}

const DEFAULT_COUNT = 5;
const GMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';
const GMAIL_SEARCH_NO_RESULTS_TEXT = 'No messages matched your search';
const GMAIL_SEARCH_NEXT_RESULTS_SELECTORS = [
  '[data-tooltip="Next results"][role="button"]',
  '[aria-label="Next results"][role="button"]',
];
const GMAIL_ROW_SELECTORS = [
  'tr.zA',
  '[role="main"] tr.zA',
  '.UI table tr.zA',
  '[role="main"] [role="row"]',
];
const GMAIL_SEARCH_SURFACE_READY_PREDICATE = `Boolean(
  document.querySelector('input[name="q"]') ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;
const GMAIL_SEARCH_RESULTS_READY_PREDICATE = `Boolean(
  document.querySelector('tr.zA') ||
  (document.body?.innerText || '').includes(${JSON.stringify(GMAIL_SEARCH_NO_RESULTS_TEXT)}) ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;

type GmailSearchTab = Pick<
  WebTab,
  'waitForLoad' | 'waitFor' | 'waitForIdle' | 'evaluate' | 'close'
>;

export async function searchInbox(options: SearchInboxOptions): Promise<SearchInboxResult> {
  const resolvedOptions = resolveOptions(options);
  const searchUrl = buildGmailInboxSearchUrl(resolvedOptions.query);

  const snapshot = await withWebBrowser(
    async (browser) => {
      const tab = await browser.openTab(searchUrl, { active: true });

      try {
        await waitForSearchResultsReady(tab);

        const pagesToScan = Math.max(1, Math.ceil(resolvedOptions.count / 50) + 2);
        const seenMailKeys = new Set<string>();
        const collectedMails: RawGmailMailOverview[] = [];

        let pageSnapshot = await readSearchPageSnapshot(tab);
        const firstSnapshot = pageSnapshot;

        if (pageSnapshot.isLoginGate) {
          return firstSnapshot;
        }

        for (let pageIndex = 0; pageIndex < pagesToScan; pageIndex += 1) {
          appendUniqueMails(
            collectedMails,
            seenMailKeys,
            pageSnapshot.mails,
            resolvedOptions.count
          );

          if (collectedMails.length >= resolvedOptions.count) {
            break;
          }

          if (
            pageSnapshot.noResults ||
            !pageSnapshot.canGoNextResultsPage ||
            !pageSnapshot.firstMailSignature
          ) {
            break;
          }

          const previousFirstMailSignature = pageSnapshot.firstMailSignature;
          const movedToNextPage = await goToNextSearchResultsPage(
            tab,
            pageSnapshot.firstMailSignature
          );
          if (!movedToNextPage) {
            const verificationWait = await waitForGoogleHumanVerificationIfNeeded(tab, {
              readyPredicate: GMAIL_SEARCH_RESULTS_READY_PREDICATE,
              label: 'Gmail verification',
            });
            if (!verificationWait.required) {
              break;
            }
          }

          await tab.waitForIdle(1_000);
          pageSnapshot = await readSearchPageSnapshot(tab);
          if (pageSnapshot.firstMailSignature === previousFirstMailSignature) {
            break;
          }

          if (pageSnapshot.isLoginGate) {
            break;
          }
        }

        return {
          ...firstSnapshot,
          mails: collectedMails.slice(0, resolvedOptions.count),
        };
      } finally {
        await tab.close().catch(() => undefined);
      }
    },
    {
      launch: resolvedOptions.launch,
    }
  );

  return {
    status: snapshot.isLoginGate
      ? 'login-required'
      : snapshot.noResults || snapshot.visibleRowCount > 0 || snapshot.rowSelector
        ? 'ok'
        : 'search-unavailable',
    query: resolvedOptions.query,
    inboxQuery: buildInboxSearchQuery(resolvedOptions.query),
    page: snapshot.page,
    rowSelector: snapshot.rowSelector,
    visibleRowCount: snapshot.visibleRowCount,
    resultText: snapshot.resultText,
    noResults: snapshot.noResults,
    mails: snapshot.mails.map((mail) => ({
      ...mail,
      openUrl: buildGmailThreadOpenUrl(snapshot.page.url, mail.legacyThreadId),
    })),
  };
}

export function parseSearchInboxCliArgs(argv: string[]): SearchInboxCliOptions {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new Error(createSearchInboxUsage());
  }

  let query = '';
  let count = DEFAULT_COUNT;
  let launch = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--query' || arg === '-q') {
      const rawValue = argv[index + 1];
      if (!rawValue) {
        throw new Error(`Missing value for ${arg}`);
      }
      query = rawValue.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--query=')) {
      query = arg.slice('--query='.length).trim();
      continue;
    }

    if (arg === '--count' || arg === '-n') {
      const rawValue = argv[index + 1];
      if (!rawValue) {
        throw new Error(`Missing value for ${arg}`);
      }
      count = parsePositiveInteger(rawValue, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--count=')) {
      count = parsePositiveInteger(arg.slice('--count='.length), '--count');
      continue;
    }

    if (arg === '--no-launch') {
      launch = false;
      continue;
    }
  }

  if (!query) {
    throw new Error('Missing required search query. Use --query "<words>".');
  }

  return { query, count, launch };
}

export function buildInboxSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Search query must not be empty.');
  }

  return /\bin:inbox\b/i.test(trimmed) ? trimmed : `in:inbox ${trimmed}`;
}

export function buildGmailInboxSearchUrl(query: string): string {
  const searchQuery = buildInboxSearchQuery(query);
  const url = new URL(GMAIL_INBOX_URL);
  url.hash = `#search/${encodeGmailSearchHashValue(searchQuery)}`;
  return url.toString();
}

async function waitForSearchResultsReady(tab: GmailSearchTab): Promise<void> {
  await tab.waitForLoad();
  await tab.waitFor({ selector: 'body' });
  await tab.waitFor({
    predicate: `Boolean(
      ${GMAIL_SEARCH_SURFACE_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
    timeoutMs: 30_000,
  });
  await tab.waitFor({
    predicate: `Boolean(
      ${GMAIL_SEARCH_RESULTS_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
    timeoutMs: 30_000,
  });
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_SEARCH_RESULTS_READY_PREDICATE,
    label: 'Gmail verification',
  });
  await tab.waitForIdle(2_500);
}

async function readSearchPageSnapshot(tab: GmailSearchTab): Promise<GmailSearchPageSnapshot> {
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_SEARCH_RESULTS_READY_PREDICATE,
    label: 'Gmail verification',
  });

  return await tab.evaluate<GmailSearchPageSnapshot>(
    `(() => {
      const rowSelectors = ${JSON.stringify(GMAIL_ROW_SELECTORS)};
      const nextResultsSelectors = ${JSON.stringify(GMAIL_SEARCH_NEXT_RESULTS_SELECTORS)};
      const noResultsText = ${JSON.stringify(GMAIL_SEARCH_NO_RESULTS_TEXT)};

      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const truncate = (value, max = 220) => {
        const text = normalize(value);
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
      };
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const route = window.location.hash || window.location.pathname;
      const activeRowSelector =
        rowSelectors.find((selector) =>
          Array.from(document.querySelectorAll(selector)).some((element) => isVisible(element))
        ) || null;
      const rows = activeRowSelector
        ? Array.from(document.querySelectorAll(activeRowSelector)).filter((element) => isVisible(element))
        : [];
      const searchInput =
        document.querySelector('input[name="q"]') instanceof HTMLInputElement
          ? document.querySelector('input[name="q"]')
          : null;
      const isLoginGate = Boolean(
        document.querySelector('input[type="email"]') ||
          document.querySelector('input[type="password"]') ||
          normalize(document.body?.innerText || '').includes('Sign in')
      );
      const noResults = normalize(document.body?.innerText || '').includes(noResultsText);

      const mails = rows
        .map((row, index) => {
          if (!(row instanceof HTMLElement)) {
            return null;
          }

          const senderElement =
            row.querySelector('.yP') ||
            row.querySelector('.yW span[email]') ||
            row.querySelector('span[email]') ||
            row.querySelector('[email]');
          const threadDataElement =
            row.querySelector('[data-legacy-thread-id], [data-thread-id]') ||
            row.querySelector('[data-legacy-last-message-id]');
          const subjectElement = row.querySelector('.bog') || row.querySelector('.y6');
          const snippetElement = row.querySelector('.y2');
          const timeElement = row.querySelector('.xW span') || row.querySelector('.xW');

          return {
            index,
            rowId: row.getAttribute('id'),
            legacyThreadId:
              threadDataElement instanceof Element
                ? threadDataElement.getAttribute('data-legacy-thread-id')
                : null,
            threadId:
              threadDataElement instanceof Element
                ? threadDataElement.getAttribute('data-thread-id')
                : null,
            sender: normalize(senderElement?.textContent || ''),
            senderEmail:
              senderElement instanceof Element
                ? senderElement.getAttribute('email') || senderElement.getAttribute('data-hovercard-id')
                : null,
            subject: normalize(subjectElement?.textContent || ''),
            snippet: normalize(snippetElement?.textContent || ''),
            time: normalize(timeElement?.textContent || ''),
            unread:
              row.classList.contains('zE') ||
              row.getAttribute('aria-label')?.includes('Unread') === true,
            selected: row.getAttribute('aria-selected') === 'true',
            starred: Boolean(
              row.querySelector('[aria-label*="Starred"]') ||
                row.querySelector('[aria-label*="Not starred"]') ||
                row.querySelector('.aXw')
            ),
            textSnippet: truncate(row.innerText),
          };
        })
        .filter(Boolean);

      const nextResultsButton =
        nextResultsSelectors
          .map((selector) => document.querySelector(selector))
          .find((element) => element instanceof HTMLElement) || null;
      const nextResultsButtonDisabled = Boolean(
        nextResultsButton &&
          (nextResultsButton.getAttribute('aria-disabled') === 'true' ||
            nextResultsButton.getAttribute('disabled') !== null)
      );

      const firstMail = mails[0] || null;
      const firstMailSignature = firstMail
        ? [
            firstMail.legacyThreadId || '',
            firstMail.threadId || '',
            firstMail.sender || '',
            firstMail.subject || '',
            firstMail.time || '',
          ].join('|')
        : null;

      return {
        page: {
          title: document.title,
          url: window.location.href,
          route,
        },
        rowSelector: activeRowSelector,
        visibleRowCount: rows.length,
        resultText: normalize(document.querySelector('.Dj')?.textContent || '') || null,
        noResults,
        queryValue: searchInput ? normalize(searchInput.value) : null,
        isLoginGate,
        canGoNextResultsPage: Boolean(nextResultsButton) && !nextResultsButtonDisabled,
        firstMailSignature,
        mails,
      };
    })()`,
    {
      returnByValue: true,
    }
  );
}

async function goToNextSearchResultsPage(
  tab: GmailSearchTab,
  previousFirstMailSignature: string
): Promise<boolean> {
  return await tab.evaluate<boolean>(
    `(async () => {
      const nextResultsSelectors = ${JSON.stringify(GMAIL_SEARCH_NEXT_RESULTS_SELECTORS)};
      const rowSelectors = ${JSON.stringify(GMAIL_ROW_SELECTORS)};
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const button =
        nextResultsSelectors
          .map((selector) => document.querySelector(selector))
          .find((element) => element instanceof HTMLElement) || null;
      if (!(button instanceof HTMLElement)) {
        return false;
      }

      if (
        button.getAttribute('aria-disabled') === 'true' ||
        button.getAttribute('disabled') !== null
      ) {
        return false;
      }

      const readFirstSignature = () => {
        const rowSelector =
          rowSelectors.find((selector) =>
            Array.from(document.querySelectorAll(selector)).some((element) => isVisible(element))
          ) || null;
        if (!rowSelector) {
          return null;
        }
        const row = Array.from(document.querySelectorAll(rowSelector)).find((element) =>
          isVisible(element)
        );
        if (!(row instanceof HTMLElement)) {
          return null;
        }

        const threadDataElement =
          row.querySelector('[data-legacy-thread-id], [data-thread-id]') ||
          row.querySelector('[data-legacy-last-message-id]');
        const senderElement =
          row.querySelector('.yP') ||
          row.querySelector('.yW span[email]') ||
          row.querySelector('span[email]') ||
          row.querySelector('[email]');
        const subjectElement = row.querySelector('.bog') || row.querySelector('.y6');
        const timeElement = row.querySelector('.xW span') || row.querySelector('.xW');
        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();

        return [
          threadDataElement instanceof Element
            ? threadDataElement.getAttribute('data-legacy-thread-id') || ''
            : '',
          threadDataElement instanceof Element
            ? threadDataElement.getAttribute('data-thread-id') || ''
            : '',
          normalize(senderElement?.textContent || ''),
          normalize(subjectElement?.textContent || ''),
          normalize(timeElement?.textContent || ''),
        ].join('|');
      };

      const startSignature = readFirstSignature();
      const expectedSignature = ${JSON.stringify(previousFirstMailSignature)};
      const rect = button.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1,
      };

      button.focus();
      button.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...eventInit,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
      button.dispatchEvent(new MouseEvent('mousedown', eventInit));
      button.dispatchEvent(
        new PointerEvent('pointerup', {
          ...eventInit,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
      button.dispatchEvent(new MouseEvent('mouseup', eventInit));
      button.dispatchEvent(new MouseEvent('click', eventInit));

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const currentSignature = readFirstSignature();
        if (
          currentSignature &&
          currentSignature !== startSignature &&
          currentSignature !== expectedSignature
        ) {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return false;
    })()`,
    {
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }
  );
}

function appendUniqueMails(
  target: RawGmailMailOverview[],
  seenMailKeys: Set<string>,
  pageMails: RawGmailMailOverview[],
  count: number
): void {
  for (const mail of pageMails) {
    const key = getMailDedupeKey(mail);
    if (seenMailKeys.has(key)) {
      continue;
    }

    seenMailKeys.add(key);
    target.push({
      ...mail,
      index: target.length,
    });

    if (target.length >= count) {
      return;
    }
  }
}

function getMailDedupeKey(mail: RawGmailMailOverview): string {
  return [
    mail.legacyThreadId || '',
    mail.threadId || '',
    mail.sender || '',
    mail.subject || '',
    mail.time || '',
  ].join('|');
}

function resolveOptions(options: SearchInboxOptions): SearchInboxCliOptions {
  const query = options.query.trim();
  if (!query) {
    throw new Error('Search query must not be empty.');
  }

  return {
    query,
    count:
      typeof options.count === 'number' && Number.isFinite(options.count) && options.count > 0
        ? Math.floor(options.count)
        : DEFAULT_COUNT,
    launch: options.launch ?? true,
  };
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for ${flag}. Received: ${value}`);
  }

  return parsed;
}

function encodeGmailSearchHashValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

async function saveSearchInboxResultToTemp(result: SearchInboxResult): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-gmail-search-'));
  const outputPath = join(outputDir, 'search-inbox.json');
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  return outputPath;
}

function renderSearchInboxMarkdown(result: SearchInboxResult, outputPath: string): string {
  const lines = [
    '# Gmail search inbox',
    '',
    `Search query: \`${result.query}\``,
    `Inbox query: \`${result.inboxQuery}\``,
    `Saved raw JSON: \`${outputPath}\``,
    `Page title: ${result.page.title}`,
    `Search results summary: ${result.resultText ?? 'Unavailable'}`,
    `Visible rows detected on the current page: ${result.visibleRowCount}`,
    `Collected mails: ${result.mails.length}`,
  ];

  if (result.status === 'login-required') {
    lines.push('', 'Gmail appears to require sign-in before search results can be read.');
    return `${lines.join('\n')}\n`;
  }

  if (result.status === 'search-unavailable') {
    lines.push('', 'The Gmail search view was not available or could not be read.');
    return `${lines.join('\n')}\n`;
  }

  if (result.noResults) {
    lines.push('', 'No messages matched the inbox search query.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('', `Top ${result.mails.length} collected mails:`, '');

  for (const mail of result.mails) {
    lines.push(
      `${mail.index + 1}. **${mail.sender || 'Unknown sender'}** — ${mail.subject || '(no subject)'}`
    );
    lines.push(`   Time: ${mail.time || 'Unknown time'}`);
    lines.push(`   State: ${formatMailState(mail)}`);
    if (mail.openUrl) {
      lines.push(`   Open: ${mail.openUrl}`);
    }
    if (mail.senderEmail) {
      lines.push(`   Sender email: ${mail.senderEmail}`);
    }
    if (mail.snippet) {
      lines.push(`   Summary: ${mail.snippet}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export async function runSearchInboxCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseSearchInboxCliArgs(argv);
  const result = await searchInbox(options);
  const outputPath = await saveSearchInboxResultToTemp(result);
  process.stdout.write(renderSearchInboxMarkdown(result, outputPath));
}

function createSearchInboxUsage(): string {
  return `Usage:
  npx @ank1015/llm-extension gmail search-inbox --query <words> [options]

Options:
  --query, -q <words>   Gmail search words
  --count, -n <number>  Number of matching mails to collect
  --no-launch           Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension gmail search-inbox --query "digitalocean" --count 5
  npx @ank1015/llm-extension gmail search-inbox --query "invoices"`;
}

function formatMailState(mail: GmailMailOverview): string {
  const states = [mail.unread ? 'unread' : 'read'];
  if (mail.starred) {
    states.push('starred');
  }
  if (mail.selected) {
    states.push('selected');
  }
  return states.join(', ');
}
