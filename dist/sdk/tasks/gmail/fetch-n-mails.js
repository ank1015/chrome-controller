import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withWebBrowser } from '../../web.js';
import { GOOGLE_HUMAN_VERIFICATION_PREDICATE, waitForGoogleHumanVerificationIfNeeded, } from '../shared/human-verification.js';
const DEFAULT_COUNT = 5;
const GMAIL_URL_PREFIX = 'https://mail.google.com/';
const GMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';
const GMAIL_OLDER_BUTTON_SELECTOR = '[data-tooltip="Older"][role="button"]';
const INBOX_ROW_SELECTORS = [
    'tr.zA',
    '[role="main"] tr.zA',
    '.UI table tr.zA',
    '[role="main"] [role="row"]',
];
const GMAIL_INBOX_READY_PREDICATE = `Boolean(
  document.querySelector('tr.zA') ||
  document.querySelector('[role="main"]') ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;
export async function fetchNMails(options = {}) {
    const resolvedOptions = resolveOptions(options);
    const rawResult = await withWebBrowser(async (browser) => {
        const existingTabs = await browser.findTabs((info) => typeof info.url === 'string' ? info.url.startsWith(GMAIL_URL_PREFIX) : false);
        const useTemporaryTab = resolvedOptions.count > 50;
        const existingInboxTab = useTemporaryTab
            ? undefined
            : existingTabs.find((tab) => tab.peekInfo().url === GMAIL_INBOX_URL);
        const tab = existingInboxTab ??
            (await browser.openTab(GMAIL_INBOX_URL, {
                active: true,
            }));
        try {
            if (existingInboxTab) {
                await tab.focus();
            }
            await waitForInboxReady(tab);
            const pagesToScan = Math.max(1, Math.ceil(resolvedOptions.count / 50) + 2);
            const seenMailKeys = new Set();
            const collectedMails = [];
            let snapshot = await readInboxPageSnapshot(tab);
            const firstSnapshot = snapshot;
            if (snapshot.status !== 'ok') {
                return firstSnapshot;
            }
            for (let pageIndex = 0; pageIndex < pagesToScan; pageIndex += 1) {
                appendUniqueMails(collectedMails, seenMailKeys, snapshot.mails, resolvedOptions.count);
                if (collectedMails.length >= resolvedOptions.count) {
                    break;
                }
                if (!snapshot.canGoOlder || !snapshot.firstMailSignature) {
                    break;
                }
                const previousFirstMailSignature = snapshot.firstMailSignature;
                const movedToOlderPage = await goToOlderInboxPage(tab, snapshot.firstMailSignature);
                if (!movedToOlderPage) {
                    const verificationWait = await waitForGoogleHumanVerificationIfNeeded(tab, {
                        readyPredicate: GMAIL_INBOX_READY_PREDICATE,
                        label: 'Gmail verification',
                    });
                    if (!verificationWait.required) {
                        break;
                    }
                }
                await tab.waitForIdle(1_000);
                snapshot = await readInboxPageSnapshot(tab);
                if (snapshot.firstMailSignature === previousFirstMailSignature) {
                    break;
                }
                if (snapshot.status !== 'ok') {
                    break;
                }
            }
            return {
                ...firstSnapshot,
                mails: collectedMails.slice(0, resolvedOptions.count),
            };
        }
        finally {
            if (useTemporaryTab) {
                await tab.close().catch(() => undefined);
            }
        }
    }, {
        launch: resolvedOptions.launch,
    });
    return {
        ...rawResult,
        mails: rawResult.mails.map((mail) => ({
            ...mail,
            openUrl: buildGmailThreadOpenUrl(rawResult.page.url, mail.legacyThreadId),
        })),
    };
}
export function parseFetchNMailsCliArgs(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        throw new Error(createFetchNMailsUsage());
    }
    let count = DEFAULT_COUNT;
    let launch = true;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
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
    return { count, launch };
}
async function waitForInboxReady(tab) {
    await tab.waitForLoad();
    await tab.waitFor({ selector: 'body' });
    await tab.waitFor({
        predicate: `Boolean(
      ${GMAIL_INBOX_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
        timeoutMs: 30_000,
    });
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GMAIL_INBOX_READY_PREDICATE,
        label: 'Gmail verification',
    });
    await tab.waitForIdle(1_500);
}
async function readInboxPageSnapshot(tab) {
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GMAIL_INBOX_READY_PREDICATE,
        label: 'Gmail verification',
    });
    return await tab.evaluate(`(() => {
      const inboxRowSelectors = ${JSON.stringify(INBOX_ROW_SELECTORS)};
      const olderButtonSelector = ${JSON.stringify(GMAIL_OLDER_BUTTON_SELECTOR)};

      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const truncate = (value, max = 220) => {
        const text = normalize(value);
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
      };

      const route = (() => {
        const hash = window.location.hash || '';
        if (hash.includes('#inbox')) return 'inbox';
        if (hash.includes('#sent')) return 'sent';
        if (hash.includes('#drafts')) return 'drafts';
        if (hash.includes('#spam')) return 'spam';
        return hash || window.location.pathname;
      })();

      const activeRowSelector =
        inboxRowSelectors.find((selector) => document.querySelector(selector)) || null;
      const rows = activeRowSelector
        ? Array.from(document.querySelectorAll(activeRowSelector))
        : [];

      const isLoginGate = Boolean(
        document.querySelector('input[type="email"]') ||
          document.querySelector('input[type="password"]') ||
          normalize(document.body?.innerText || '').includes('Sign in')
      );

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

      const olderButton = document.querySelector(olderButtonSelector);
      const olderButtonDisabled = Boolean(
        olderButton &&
          (olderButton.getAttribute('aria-disabled') === 'true' ||
            olderButton.getAttribute('disabled') !== null)
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
        status: isLoginGate
          ? 'login-required'
          : rows.length > 0
            ? 'ok'
            : 'inbox-unavailable',
        page: {
          title: document.title,
          url: window.location.href,
          route,
        },
        rowSelector: activeRowSelector,
        visibleRowCount: rows.length,
        mails,
        firstMailSignature,
        canGoOlder: Boolean(olderButton) && !olderButtonDisabled,
      };
    })()`, {
        returnByValue: true,
    });
}
async function goToOlderInboxPage(tab, previousFirstMailSignature) {
    return await tab.evaluate(`(async () => {
      const olderButtonSelector = ${JSON.stringify(GMAIL_OLDER_BUTTON_SELECTOR)};
      const button = document.querySelector(olderButtonSelector);
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
        const row = document.querySelector('tr.zA');
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
    })()`, {
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
    });
}
function appendUniqueMails(target, seenMailKeys, pageMails, count) {
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
function getMailDedupeKey(mail) {
    return [
        mail.legacyThreadId || '',
        mail.threadId || '',
        mail.sender || '',
        mail.subject || '',
        mail.time || '',
    ].join('|');
}
export function buildGmailThreadOpenUrl(pageUrl, legacyThreadId) {
    if (!legacyThreadId) {
        return null;
    }
    try {
        const url = new URL(pageUrl);
        url.hash = `#inbox/${legacyThreadId}`;
        return url.toString();
    }
    catch {
        return null;
    }
}
export async function saveFetchNMailsResultToTemp(result) {
    const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-gmail-'));
    const outputPath = join(outputDir, 'fetch-n-mails.json');
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
    return outputPath;
}
export function renderFetchNMailsMarkdown(result, outputPath) {
    const lines = [
        '# Gmail Inbox Overview',
        '',
        `Raw JSON saved to: \`${outputPath}\``,
        `Status: \`${result.status}\``,
        `Page: ${result.page.title}`,
        `URL: ${result.page.url}`,
        `Visible rows detected on the current page: ${result.visibleRowCount}`,
    ];
    if (result.status === 'login-required') {
        lines.push('', 'Gmail appears to be showing a login gate instead of the inbox.');
        return `${lines.join('\n')}\n`;
    }
    if (result.status === 'inbox-unavailable') {
        lines.push('', 'The inbox view was not available, so no message overview could be built.');
        return `${lines.join('\n')}\n`;
    }
    if (result.mails.length === 0) {
        lines.push('', 'No visible inbox rows were found.');
        return `${lines.join('\n')}\n`;
    }
    lines.push('', `Top ${result.mails.length} collected mails:`, '');
    for (const mail of result.mails) {
        lines.push(`${mail.index + 1}. **${mail.sender || 'Unknown sender'}** — ${mail.subject || '(no subject)'}`);
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
function resolveOptions(options) {
    return {
        count: typeof options.count === 'number' && Number.isFinite(options.count) && options.count > 0
            ? Math.floor(options.count)
            : DEFAULT_COUNT,
        launch: options.launch ?? true,
    };
}
function parsePositiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer for ${flag}. Received: ${value}`);
    }
    return parsed;
}
export async function runFetchNMailsCli(argv = process.argv.slice(2)) {
    const options = parseFetchNMailsCliArgs(argv);
    const result = await fetchNMails(options);
    const outputPath = await saveFetchNMailsResultToTemp(result);
    process.stdout.write(renderFetchNMailsMarkdown(result, outputPath));
}
function createFetchNMailsUsage() {
    return `Usage:
  npx @ank1015/llm-extension gmail fetch-n-mails [options]

Options:
  --count, -n <number>  Number of inbox mails to collect
  --no-launch           Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension gmail fetch-n-mails --count 5
  npx @ank1015/llm-extension gmail fetch-n-mails`;
}
function formatMailState(mail) {
    const states = [mail.unread ? 'unread' : 'read'];
    if (mail.starred) {
        states.push('starred');
    }
    if (mail.selected) {
        states.push('selected');
    }
    return states.join(', ');
}
//# sourceMappingURL=fetch-n-mails.js.map