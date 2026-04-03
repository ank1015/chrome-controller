import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { withWebBrowser } from '../../web.js';
import { GOOGLE_HUMAN_VERIFICATION_PREDICATE, waitForGoogleHumanVerificationIfNeeded, } from '../shared/human-verification.js';
const GMAIL_COMPOSE_URL = 'https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1';
const GMAIL_COMPOSE_READY_TIMEOUT_MS = 30_000;
const GMAIL_DRAFT_AUTOSAVE_WAIT_MS = 8_000;
const GMAIL_SEND_TIMEOUT_MS = 20_000;
const GMAIL_TO_SELECTOR = 'input[aria-label="To recipients"]';
const GMAIL_SUBJECT_SELECTOR = 'input[name="subjectbox"]';
const GMAIL_BODY_SELECTOR = 'div[aria-label="Message Body"]';
const GMAIL_FILE_INPUT_SELECTOR = 'input[type="file"][name="Filedata"]';
const GMAIL_COMPOSE_READY_PREDICATE = `Boolean(
  document.querySelector(${JSON.stringify(GMAIL_TO_SELECTOR)}) ||
  document.querySelector(${JSON.stringify(GMAIL_BODY_SELECTOR)}) ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;
export async function composeDraft(options) {
    const resolvedOptions = resolveComposeOptions(options);
    const composeUrl = buildGmailComposeUrl(resolvedOptions);
    return await withWebBrowser(async (browser) => {
        const tab = await browser.openTab(composeUrl, { active: true });
        try {
            await waitForComposeReady(tab);
            const initialSnapshot = await readComposeSnapshot(tab);
            if (initialSnapshot.isLoginGate) {
                return buildComposeResult({
                    status: 'login-required',
                    composeUrl,
                    snapshot: initialSnapshot,
                    resolvedOptions,
                    attachedFileNames: [],
                    message: 'Gmail appears to require sign-in before compose can be used.',
                });
            }
            if (!initialSnapshot.isComposeVisible) {
                return buildComposeResult({
                    status: 'compose-unavailable',
                    composeUrl,
                    snapshot: initialSnapshot,
                    resolvedOptions,
                    attachedFileNames: [],
                    message: 'Gmail compose view did not become available.',
                });
            }
            const applyResult = await applyComposeContent(tab, resolvedOptions);
            if (!applyResult.ok) {
                return buildComposeResult({
                    status: 'compose-unavailable',
                    composeUrl,
                    snapshot: await readComposeSnapshot(tab),
                    resolvedOptions,
                    attachedFileNames: [],
                    message: applyResult.reason ?? 'Could not populate the Gmail compose form.',
                });
            }
            let attachedFileNames = [];
            if (resolvedOptions.attachmentPaths.length > 0) {
                attachedFileNames = await uploadComposeAttachments(tab, resolvedOptions.attachmentPaths);
            }
            if (resolvedOptions.send) {
                const sendOutcome = await clickSendAndWait(tab);
                const sendSnapshot = await readComposeSnapshot(tab);
                return buildComposeResult({
                    status: sendOutcome.sent ? 'sent' : 'send-failed',
                    composeUrl,
                    snapshot: sendSnapshot,
                    resolvedOptions,
                    attachedFileNames,
                    message: sendOutcome.message ??
                        (sendOutcome.sent
                            ? 'Gmail reported that the message was sent.'
                            : 'The send action did not complete successfully.'),
                });
            }
            await tab.waitForIdle(GMAIL_DRAFT_AUTOSAVE_WAIT_MS);
            const draftSnapshot = await readComposeSnapshot(tab);
            return buildComposeResult({
                status: 'draft-created',
                composeUrl,
                snapshot: draftSnapshot,
                resolvedOptions,
                attachedFileNames,
                message: 'Compose fields were populated and Gmail was given time to autosave the draft.',
            });
        }
        finally {
            await tab.close().catch(() => undefined);
        }
    }, {
        launch: resolvedOptions.launch,
    });
}
export function normalizeGmailAddressList(value) {
    if (value === undefined) {
        return [];
    }
    const parts = typeof value === 'string'
        ? value.split(/[,\n;]/)
        : value.flatMap((entry) => entry.split(/[,\n;]/));
    const seen = new Set();
    const normalized = [];
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}
export function buildGmailComposeUrl(options) {
    const url = new URL(GMAIL_COMPOSE_URL);
    if (options.to.length > 0) {
        url.searchParams.set('to', options.to.join(','));
    }
    if (options.cc.length > 0) {
        url.searchParams.set('cc', options.cc.join(','));
    }
    if (options.bcc.length > 0) {
        url.searchParams.set('bcc', options.bcc.join(','));
    }
    if (options.subject.length > 0) {
        url.searchParams.set('su', options.subject);
    }
    if (options.body.length > 0) {
        url.searchParams.set('body', options.body);
    }
    return url.toString();
}
export function parseComposeDraftCliArgs(argv) {
    let to = [];
    let cc = [];
    let bcc = [];
    let subject = '';
    let body = '';
    let attachmentPaths = [];
    let send = false;
    let launch = true;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            throw new Error(createComposeDraftUsage());
        }
        if (arg === '--to') {
            const rawValue = argv[index + 1];
            if (!rawValue) {
                throw new Error('Missing value for --to');
            }
            to = [...to, ...normalizeGmailAddressList(rawValue)];
            index += 1;
            continue;
        }
        if (arg.startsWith('--to=')) {
            to = [...to, ...normalizeGmailAddressList(arg.slice('--to='.length))];
            continue;
        }
        if (arg === '--cc') {
            const rawValue = argv[index + 1];
            if (!rawValue) {
                throw new Error('Missing value for --cc');
            }
            cc = [...cc, ...normalizeGmailAddressList(rawValue)];
            index += 1;
            continue;
        }
        if (arg.startsWith('--cc=')) {
            cc = [...cc, ...normalizeGmailAddressList(arg.slice('--cc='.length))];
            continue;
        }
        if (arg === '--bcc') {
            const rawValue = argv[index + 1];
            if (!rawValue) {
                throw new Error('Missing value for --bcc');
            }
            bcc = [...bcc, ...normalizeGmailAddressList(rawValue)];
            index += 1;
            continue;
        }
        if (arg.startsWith('--bcc=')) {
            bcc = [...bcc, ...normalizeGmailAddressList(arg.slice('--bcc='.length))];
            continue;
        }
        if (arg === '--subject' || arg === '-s') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error(`Missing value for ${arg}`);
            }
            subject = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--subject=')) {
            subject = arg.slice('--subject='.length);
            continue;
        }
        if (arg === '--body' || arg === '-b') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error(`Missing value for ${arg}`);
            }
            body = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--body=')) {
            body = arg.slice('--body='.length);
            continue;
        }
        if (arg === '--attachment' || arg === '--attach' || arg === '-a') {
            const rawValue = argv[index + 1];
            if (!rawValue) {
                throw new Error(`Missing value for ${arg}`);
            }
            attachmentPaths = [...attachmentPaths, rawValue.trim()].filter((path) => path.length > 0);
            index += 1;
            continue;
        }
        if (arg.startsWith('--attachment=')) {
            attachmentPaths = [...attachmentPaths, arg.slice('--attachment='.length).trim()].filter((path) => path.length > 0);
            continue;
        }
        if (arg.startsWith('--attach=')) {
            attachmentPaths = [...attachmentPaths, arg.slice('--attach='.length).trim()].filter((path) => path.length > 0);
            continue;
        }
        if (arg === '--send') {
            send = true;
            continue;
        }
        if (arg === '--no-launch') {
            launch = false;
            continue;
        }
    }
    return resolveComposeOptions({
        to,
        cc,
        bcc,
        subject,
        body,
        attachmentPaths,
        send,
        launch,
    });
}
async function waitForComposeReady(tab) {
    await tab.waitForLoad();
    await tab.waitFor({ selector: 'body' });
    await tab.waitFor({
        predicate: `Boolean(
      ${GMAIL_COMPOSE_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
        timeoutMs: GMAIL_COMPOSE_READY_TIMEOUT_MS,
    });
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GMAIL_COMPOSE_READY_PREDICATE,
        label: 'Gmail verification',
    });
    await tab.waitForIdle(1_500);
}
async function readComposeSnapshot(tab) {
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GMAIL_COMPOSE_READY_PREDICATE,
        label: 'Gmail verification',
    });
    return await tab.evaluate(`(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const toInput = document.querySelector(${JSON.stringify(GMAIL_TO_SELECTOR)});
      const subjectInput = document.querySelector(${JSON.stringify(GMAIL_SUBJECT_SELECTOR)});
      const bodyElement = document.querySelector(${JSON.stringify(GMAIL_BODY_SELECTOR)});
      const route = window.location.hash || window.location.search || window.location.pathname;
      const attachmentNames = Array.from(
        document.querySelectorAll('[download_url], .dL, .vI, [aria-label*="Attachment"]')
      )
        .map((element) => normalize(element.textContent || element.getAttribute('aria-label') || ''))
        .filter(Boolean);
      const statusCandidates = Array.from(document.querySelectorAll('span, div'))
        .map((element) => normalize(element.textContent || ''))
        .filter((text) =>
          /saved to drafts|saving|message sent|sending|send failed|couldn't send|could not be sent|invalid email|recipient/i.test(
            text
          )
        )
        .slice(0, 30);

      return {
        page: {
          title: document.title,
          url: window.location.href,
          route,
        },
        isComposeVisible: toInput instanceof HTMLInputElement && bodyElement instanceof HTMLDivElement,
        isLoginGate: Boolean(
          document.querySelector('input[type="email"]') ||
            document.querySelector('input[type="password"]') ||
            normalize(document.body?.innerText || '').includes('Sign in')
        ),
        subject: subjectInput instanceof HTMLInputElement ? subjectInput.value : '',
        bodyText: bodyElement instanceof HTMLElement ? bodyElement.innerText : '',
        attachmentNames,
        statusCandidates,
      };
    })()`, {
        returnByValue: true,
    });
}
async function applyComposeContent(tab, options) {
    return await tab.evaluate(`(() => {
      const subjectInput = document.querySelector(${JSON.stringify(GMAIL_SUBJECT_SELECTOR)});
      const bodyElement = document.querySelector(${JSON.stringify(GMAIL_BODY_SELECTOR)});
      if (!(subjectInput instanceof HTMLInputElement)) {
        return {
          ok: false,
          reason: 'Could not find the Gmail subject input.',
          subject: '',
          bodyText: '',
        };
      }
      if (!(bodyElement instanceof HTMLDivElement)) {
        return {
          ok: false,
          reason: 'Could not find the Gmail message body.',
          subject: subjectInput.value,
          bodyText: '',
        };
      }

      const desiredSubject = ${JSON.stringify(options.subject)};
      const desiredBody = ${JSON.stringify(options.body)};
      const shouldNudgeDirtyState = ${JSON.stringify(options.subject.length === 0 &&
        options.body.length === 0 &&
        options.attachmentPaths.length === 0)};

      const setSubject = (value) => {
        subjectInput.focus();
        subjectInput.value = value;
        subjectInput.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value,
          })
        );
        subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const buildBodyChildren = (value) => {
        if (value.length === 0) {
          return [];
        }

        return value.split(/\\n/).map((line) => {
          const div = document.createElement('div');
          div.textContent = line.length > 0 ? line : '\\u00A0';
          return div;
        });
      };

      const setBody = (value) => {
        bodyElement.focus();
        bodyElement.replaceChildren(...buildBodyChildren(value));
        bodyElement.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value,
          })
        );
        bodyElement.dispatchEvent(new Event('change', { bubbles: true }));
      };

      setSubject(desiredSubject);
      setBody(desiredBody);

      if (shouldNudgeDirtyState) {
        setSubject(' ');
        setSubject('');
      }

      return {
        ok: true,
        reason: null,
        subject: subjectInput.value,
        bodyText: bodyElement.innerText,
      };
    })()`, {
        returnByValue: true,
        userGesture: true,
    });
}
async function uploadComposeAttachments(tab, attachmentPaths) {
    const absolutePaths = attachmentPaths.map((path) => resolve(path));
    const attachmentNames = absolutePaths.map((path) => basename(path));
    await tab.waitFor({
        predicate: `Boolean(document.querySelector(${JSON.stringify(GMAIL_FILE_INPUT_SELECTOR)}))`,
        timeoutMs: GMAIL_COMPOSE_READY_TIMEOUT_MS,
    });
    await tab.withDebugger(async (debuggerSession) => {
        await debuggerSession.cdp('DOM.enable');
        const documentNode = await debuggerSession.cdp('DOM.getDocument', {
            depth: -1,
            pierce: true,
        });
        const rootNodeId = documentNode.root?.nodeId;
        if (typeof rootNodeId !== 'number') {
            throw new Error('Could not resolve the Gmail compose document root.');
        }
        const queryResult = await debuggerSession.cdp('DOM.querySelector', {
            nodeId: rootNodeId,
            selector: GMAIL_FILE_INPUT_SELECTOR,
        });
        if (typeof queryResult.nodeId !== 'number' || queryResult.nodeId <= 0) {
            throw new Error('Could not find the Gmail compose attachment input.');
        }
        await debuggerSession.cdp('DOM.setFileInputFiles', {
            nodeId: queryResult.nodeId,
            files: absolutePaths,
        });
    });
    const predicateSource = attachmentNames
        .map((fileName) => `Array.from(document.querySelectorAll('[download_url], .dL, .vI, [aria-label*="Attachment"]')).some((element) => {
          const text = (element.textContent || '') + ' ' + (element.getAttribute('aria-label') || '');
          return text.includes(${JSON.stringify(fileName)});
        })`)
        .join(' && ');
    await tab.waitFor({
        predicate: `Boolean(${predicateSource || 'true'})`,
        timeoutMs: GMAIL_COMPOSE_READY_TIMEOUT_MS,
    });
    await tab.waitForIdle(1_500);
    const snapshot = await readComposeSnapshot(tab);
    return attachmentNames.filter((fileName) => snapshot.attachmentNames.some((attachmentName) => attachmentName.includes(fileName)));
}
async function clickSendAndWait(tab) {
    return await tab.evaluate(`(async () => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sendButton = Array.from(
        document.querySelectorAll('[data-tooltip], [aria-label], div[role="button"]')
      ).find((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const combined = [
          element.getAttribute('data-tooltip') || '',
          element.getAttribute('aria-label') || '',
          element.textContent || '',
        ]
          .map(normalize)
          .join(' ');
        return /^send\\b/i.test(combined);
      });

      if (!(sendButton instanceof HTMLElement)) {
        return {
          sent: false,
          message: 'Could not find the Gmail Send button.',
        };
      }

      const rect = sendButton.getBoundingClientRect();
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

      sendButton.focus();
      sendButton.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...eventInit,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
      sendButton.dispatchEvent(new MouseEvent('mousedown', eventInit));
      sendButton.dispatchEvent(
        new PointerEvent('pointerup', {
          ...eventInit,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
      sendButton.dispatchEvent(new MouseEvent('mouseup', eventInit));
      sendButton.dispatchEvent(new MouseEvent('click', eventInit));

      const readMessage = () => {
        const text = normalize(document.body?.innerText || '');
        const sentMatch = text.match(/Message sent\\.?/i);
        if (sentMatch?.[0]) {
          return {
            sent: true,
            message: sentMatch[0],
          };
        }

        const failureMatch = text.match(
          /Please specify at least one recipient|Address not found|Invalid email|couldn't send|could not be sent|message not sent/i
        );
        if (failureMatch?.[0]) {
          return {
            sent: false,
            message: failureMatch[0],
          };
        }

        return null;
      };

      const deadline = Date.now() + ${GMAIL_SEND_TIMEOUT_MS};
      while (Date.now() < deadline) {
        const outcome = readMessage();
        if (outcome) {
          return outcome;
        }

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      }

      return {
        sent: false,
        message: 'Timed out waiting for Gmail to confirm that the message was sent.',
      };
    })()`, {
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
    });
}
function buildComposeResult({ status, composeUrl, snapshot, resolvedOptions, attachedFileNames, message, }) {
    return {
        status,
        composeUrl,
        page: snapshot.page,
        recipients: {
            to: resolvedOptions.to,
            cc: resolvedOptions.cc,
            bcc: resolvedOptions.bcc,
        },
        subject: snapshot.subject || resolvedOptions.subject,
        bodyPreview: previewBody(snapshot.bodyText || resolvedOptions.body),
        attachmentPaths: resolvedOptions.attachmentPaths,
        attachedFileNames,
        sendRequested: resolvedOptions.send,
        message,
    };
}
function resolveComposeOptions(options) {
    const to = normalizeGmailAddressList(options.to);
    const cc = normalizeGmailAddressList(options.cc);
    const bcc = normalizeGmailAddressList(options.bcc);
    const attachmentPaths = normalizeAttachmentPaths(options.attachmentPaths);
    if (options.send && to.length === 0 && cc.length === 0 && bcc.length === 0) {
        throw new Error('Sending a Gmail draft requires at least one recipient in to, cc, or bcc.');
    }
    return {
        to,
        cc,
        bcc,
        subject: options.subject?.trim() ?? '',
        body: options.body ?? '',
        attachmentPaths,
        send: options.send ?? false,
        launch: options.launch ?? true,
    };
}
function normalizeAttachmentPaths(value) {
    if (value === undefined) {
        return [];
    }
    const rawPaths = Array.isArray(value) ? value : [value];
    return rawPaths.map((path) => path.trim()).filter((path) => path.length > 0);
}
function previewBody(value, maxLength = 220) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
}
async function saveComposeDraftResultToTemp(result) {
    const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-gmail-compose-'));
    const outputPath = join(outputDir, 'compose-draft.json');
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
    return outputPath;
}
function renderComposeDraftMarkdown(result, outputPath) {
    const lines = [
        '# Gmail compose',
        '',
        `Status: \`${result.status}\``,
        `Saved raw JSON: \`${outputPath}\``,
        `Compose URL: ${result.composeUrl}`,
        `Page title: ${result.page.title}`,
        `Send requested: ${result.sendRequested ? 'yes' : 'no'}`,
    ];
    if (result.recipients.to.length > 0) {
        lines.push(`To: ${result.recipients.to.join(', ')}`);
    }
    if (result.recipients.cc.length > 0) {
        lines.push(`Cc: ${result.recipients.cc.join(', ')}`);
    }
    if (result.recipients.bcc.length > 0) {
        lines.push(`Bcc: ${result.recipients.bcc.join(', ')}`);
    }
    lines.push(`Subject: ${result.subject || '(empty subject)'}`);
    lines.push(`Body preview: ${result.bodyPreview || '(empty body)'}`);
    if (result.attachmentPaths.length > 0) {
        lines.push(`Attachment paths: ${result.attachmentPaths.join(', ')}`);
    }
    if (result.attachedFileNames.length > 0) {
        lines.push(`Attached files: ${result.attachedFileNames.join(', ')}`);
    }
    if (result.message) {
        lines.push(`Message: ${result.message}`);
    }
    return `${lines.join('\n')}\n`;
}
function createComposeDraftUsage() {
    return `Usage:
  npx @ank1015/llm-extension gmail compose-email [options]

Options:
  --to <emails>          Comma-separated To recipients
  --cc <emails>          Comma-separated Cc recipients
  --bcc <emails>         Comma-separated Bcc recipients
  --subject, -s <text>   Subject text
  --body, -b <text>      Plain text message body
  --attachment, -a <path>
                         Local attachment path; may be repeated
  --send                 Send the message instead of only creating a draft
  --no-launch            Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension gmail compose-email --to "person@example.com" --subject "Hello" --body "Draft body"
  npx @ank1015/llm-extension gmail compose-email --to "person@example.com" --attachment ./note.txt --send`;
}
export async function runComposeDraftCli(argv = process.argv.slice(2)) {
    const options = parseComposeDraftCliArgs(argv);
    const result = await composeDraft(options);
    const outputPath = await saveComposeDraftResultToTemp(result);
    process.stdout.write(renderComposeDraftMarkdown(result, outputPath));
}
//# sourceMappingURL=compose-draft.js.map