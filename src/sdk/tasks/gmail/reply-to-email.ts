import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { withWebBrowser } from '../../web.js';
import {
  GOOGLE_HUMAN_VERIFICATION_PREDICATE,
  waitForGoogleHumanVerificationIfNeeded,
} from '../shared/human-verification.js';

import { normalizeGmailThreadUrl } from './get-email.js';

import type { WebTab } from '../../web.js';

export interface GmailReplyToEmailOptions {
  url: string;
  body?: string;
  attachmentPaths?: string | readonly string[];
  send?: boolean;
  launch?: boolean;
}

export interface GmailReplyToEmailResult {
  status:
    | 'draft-created'
    | 'sent'
    | 'login-required'
    | 'thread-unavailable'
    | 'reply-unavailable'
    | 'send-failed';
  requestedUrl: string;
  page: {
    title: string;
    url: string;
    route: string;
  };
  subject: string;
  bodyPreview: string;
  attachmentPaths: string[];
  attachedFileNames: string[];
  sendRequested: boolean;
  message: string | null;
}

interface ResolvedReplyOptions {
  url: string;
  body: string;
  attachmentPaths: string[];
  send: boolean;
  launch: boolean;
}

interface GmailReplyToEmailCliOptions extends ResolvedReplyOptions {}

interface GmailReplySnapshot {
  page: GmailReplyToEmailResult['page'];
  isReplyVisible: boolean;
  isLoginGate: boolean;
  subject: string;
  bodyText: string;
  attachmentNames: string[];
  statusCandidates: string[];
}

interface ReplyContentApplyResult {
  ok: boolean;
  reason: string | null;
  bodyText: string;
}

interface SendOutcome {
  sent: boolean;
  message: string | null;
}

const GMAIL_THREAD_READY_TIMEOUT_MS = 30_000;
const GMAIL_REPLY_READY_TIMEOUT_MS = 20_000;
const GMAIL_DRAFT_AUTOSAVE_WAIT_MS = 8_000;
const GMAIL_SEND_TIMEOUT_MS = 20_000;
const GMAIL_REPLY_BODY_SELECTOR =
  'div[aria-label="Message Body"][role="textbox"], [role="textbox"][aria-label="Message Body"]';
const GMAIL_FILE_INPUT_SELECTOR = 'input[type="file"][name="Filedata"]';
const GMAIL_THREAD_READY_PREDICATE = `Boolean(
  document.querySelector('h2.hP') ||
  document.querySelector('.adn.ads') ||
  document.querySelector('[data-message-id]') ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;
const GMAIL_REPLY_READY_PREDICATE = `Boolean(
  document.querySelector(${JSON.stringify(GMAIL_REPLY_BODY_SELECTOR)}) ||
  document.querySelector(${JSON.stringify(GMAIL_FILE_INPUT_SELECTOR)}) ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;
const GMAIL_REPLY_SNAPSHOT_READY_PREDICATE = `Boolean(
  ${GMAIL_THREAD_READY_PREDICATE} ||
  ${GMAIL_REPLY_READY_PREDICATE}
)`;

const SHOW_TRIMMED_CONTENT_SELECTORS = [
  '[aria-label="Show trimmed content"]',
  '[aria-label*="Show trimmed content"]',
  '[data-tooltip="Show trimmed content"]',
  '[data-tooltip*="Show trimmed content"]',
  'span[role="link"][data-tooltip*="View entire message"]',
  'span[role="link"][aria-label*="View entire message"]',
];

type GmailReplyTab = Pick<
  WebTab,
  'waitForLoad' | 'waitFor' | 'waitForIdle' | 'evaluate' | 'close' | 'uploadFiles'
>;

export async function replyToEmail(
  options: GmailReplyToEmailOptions
): Promise<GmailReplyToEmailResult> {
  const resolvedOptions = resolveReplyOptions(options);

  return await withWebBrowser(
    async (browser) => {
      const tab = await browser.openTab(resolvedOptions.url, { active: true });

      try {
        await waitForThreadReady(tab);
        await expandTrimmedContent(tab);
        await tab.waitForIdle(1_000);

        const initialSnapshot = await readReplySnapshot(tab);
        if (initialSnapshot.isLoginGate) {
          return buildReplyResult({
            status: 'login-required',
            requestedUrl: resolvedOptions.url,
            snapshot: initialSnapshot,
            resolvedOptions,
            attachedFileNames: [],
            message: 'Gmail appears to require sign-in before the thread can be replied to.',
          });
        }

        const replyVisible =
          initialSnapshot.isReplyVisible || (await openReplyComposer(tab, initialSnapshot.subject));
        if (!replyVisible) {
          return buildReplyResult({
            status: initialSnapshot.subject ? 'reply-unavailable' : 'thread-unavailable',
            requestedUrl: resolvedOptions.url,
            snapshot: await readReplySnapshot(tab),
            resolvedOptions,
            attachedFileNames: [],
            message: initialSnapshot.subject
              ? 'Gmail reply composer did not become available.'
              : 'The requested Gmail thread did not become available.',
          });
        }

        const applyResult = await applyReplyBody(tab, resolvedOptions.body);
        if (!applyResult.ok) {
          return buildReplyResult({
            status: 'reply-unavailable',
            requestedUrl: resolvedOptions.url,
            snapshot: await readReplySnapshot(tab),
            resolvedOptions,
            attachedFileNames: [],
            message: applyResult.reason ?? 'Could not populate the Gmail reply body.',
          });
        }

        let attachedFileNames: string[] = [];
        if (resolvedOptions.attachmentPaths.length > 0) {
          attachedFileNames = await uploadReplyAttachments(tab, resolvedOptions.attachmentPaths);
        }

        if (resolvedOptions.send) {
          const sendOutcome = await clickSendAndWait(tab);
          const sendSnapshot = await readReplySnapshot(tab);
          return buildReplyResult({
            status: sendOutcome.sent ? 'sent' : 'send-failed',
            requestedUrl: resolvedOptions.url,
            snapshot: sendSnapshot,
            resolvedOptions,
            attachedFileNames,
            message:
              sendOutcome.message ??
              (sendOutcome.sent
                ? 'Gmail reported that the reply was sent.'
                : 'The reply send action did not complete successfully.'),
          });
        }

        await tab.waitForIdle(GMAIL_DRAFT_AUTOSAVE_WAIT_MS);
        const draftSnapshot = await readReplySnapshot(tab);
        return buildReplyResult({
          status: 'draft-created',
          requestedUrl: resolvedOptions.url,
          snapshot: draftSnapshot,
          resolvedOptions,
          attachedFileNames,
          message: 'Reply body was populated and Gmail was given time to autosave the draft reply.',
        });
      } finally {
        await tab.close().catch(() => undefined);
      }
    },
    {
      launch: resolvedOptions.launch,
    }
  );
}

export function normalizeReplyAttachmentPaths(
  value: string | readonly string[] | undefined
): string[] {
  if (value === undefined) {
    return [];
  }

  const rawPaths = Array.isArray(value) ? value : [value];
  return rawPaths.map((path) => path.trim()).filter((path) => path.length > 0);
}

export function previewReplyBody(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function parseReplyToEmailCliArgs(argv: string[]): GmailReplyToEmailCliOptions {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new Error(createReplyToEmailUsage());
  }

  let url = '';
  let body = '';
  let attachmentPaths: string[] = [];
  let send = false;
  let launch = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--url') {
      const rawValue = argv[index + 1];
      if (!rawValue) {
        throw new Error('Missing value for --url');
      }
      url = rawValue.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length).trim();
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
      attachmentPaths = [...attachmentPaths, arg.slice('--attachment='.length).trim()].filter(
        (path) => path.length > 0
      );
      continue;
    }

    if (arg.startsWith('--attach=')) {
      attachmentPaths = [...attachmentPaths, arg.slice('--attach='.length).trim()].filter(
        (path) => path.length > 0
      );
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

  return resolveReplyOptions({
    url,
    body,
    attachmentPaths,
    send,
    launch,
  });
}

async function waitForThreadReady(tab: GmailReplyTab): Promise<void> {
  await tab.waitForLoad();
  await tab.waitFor({ selector: 'body' });
  await tab.waitFor({
    predicate: `Boolean(
      ${GMAIL_THREAD_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
    timeoutMs: GMAIL_THREAD_READY_TIMEOUT_MS,
  });
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_THREAD_READY_PREDICATE,
    label: 'Gmail verification',
  });
  await tab.waitForIdle(1_500);
}

async function expandTrimmedContent(tab: GmailReplyTab): Promise<void> {
  await tab.evaluate(
    `(() => {
      const selectors = ${JSON.stringify(SHOW_TRIMMED_CONTENT_SELECTORS)};
      const buttons = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const uniqueButtons = Array.from(new Set(buttons));

      for (const button of uniqueButtons) {
        if (button instanceof HTMLElement) {
          button.click();
        }
      }

      return uniqueButtons.length;
    })()`,
    {
      returnByValue: true,
      userGesture: true,
    }
  );
}

async function openReplyComposer(tab: GmailReplyTab, subject: string): Promise<boolean> {
  const clickedReply = await tab.evaluate(
    `(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const candidates = Array.from(
        document.querySelectorAll('div[role="button"], button, span[role="button"]')
      );

      const scored = candidates
        .map((element) => {
          if (!(element instanceof HTMLElement)) {
            return null;
          }

          const combined = [
            element.getAttribute('aria-label') || '',
            element.getAttribute('data-tooltip') || '',
            element.textContent || '',
          ]
            .map(normalize)
            .join(' ');

          if (!/reply/i.test(combined) || /reply all/i.test(combined) || /forward/i.test(combined) || /pop out reply/i.test(combined)) {
            return null;
          }

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden';
          if (!visible) {
            return null;
          }

          return {
            element,
            top: rect.top,
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.top - left.top);

      const target = scored[0]?.element;
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      target.click();
      return true;
    })()`,
    {
      returnByValue: true,
      userGesture: true,
    }
  );

  if (!clickedReply) {
    return false;
  }

  await tab.waitFor({
    predicate: `Boolean(
      ${GMAIL_REPLY_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
    timeoutMs: GMAIL_REPLY_READY_TIMEOUT_MS,
  });
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_REPLY_READY_PREDICATE,
    label: 'Gmail verification',
  });
  await tab.waitForIdle(1_000);

  const snapshot = await readReplySnapshot(tab);
  return !snapshot.isLoginGate && snapshot.isReplyVisible && Boolean(snapshot.subject || subject);
}

async function readReplySnapshot(tab: GmailReplyTab): Promise<GmailReplySnapshot> {
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_REPLY_SNAPSHOT_READY_PREDICATE,
    label: 'Gmail verification',
  });

  return await tab.evaluate<GmailReplySnapshot>(
    `(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const subjectElement = document.querySelector('h2.hP') || document.querySelector('.ha h2');
      const bodyCandidates = Array.from(document.querySelectorAll(${JSON.stringify(GMAIL_REPLY_BODY_SELECTOR)}));
      const bodyElement = bodyCandidates.find((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const attachmentNames = Array.from(
        document.querySelectorAll('[download_url], .dL, .vI, .aV3, [aria-label*="Attachment"]')
      )
        .map((element) => normalize(element.textContent || element.getAttribute('aria-label') || ''))
        .filter(Boolean)
        .slice(0, 50);
      const statusCandidates = Array.from(document.querySelectorAll('span, div'))
        .map((element) => normalize(element.textContent || ''))
        .filter((text) =>
          /saved to drafts|saving|message sent|sending|send failed|couldn't send|could not be sent|invalid email|reply saved/i.test(
            text
          )
        )
        .slice(0, 30);

      return {
        page: {
          title: document.title,
          url: window.location.href,
          route: window.location.hash || window.location.search || window.location.pathname,
        },
        isReplyVisible: bodyElement instanceof HTMLElement,
        isLoginGate: Boolean(
          document.querySelector('input[type="email"]') ||
            document.querySelector('input[type="password"]') ||
            normalize(document.body?.innerText || '').includes('Sign in')
        ),
        subject: normalize(subjectElement?.textContent || ''),
        bodyText: bodyElement instanceof HTMLElement ? bodyElement.innerText : '',
        attachmentNames,
        statusCandidates,
      };
    })()`,
    {
      returnByValue: true,
    }
  );
}

async function applyReplyBody(
  tab: GmailReplyTab,
  desiredBody: string
): Promise<ReplyContentApplyResult> {
  return await tab.evaluate<ReplyContentApplyResult>(
    `(() => {
      const bodyCandidates = Array.from(document.querySelectorAll(${JSON.stringify(GMAIL_REPLY_BODY_SELECTOR)}));
      const bodyElement = bodyCandidates.find((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });

      if (!(bodyElement instanceof HTMLDivElement)) {
        return {
          ok: false,
          reason: 'Could not find the Gmail reply body.',
          bodyText: '',
        };
      }

      const desiredBodyValue = ${JSON.stringify(desiredBody)};
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

      bodyElement.focus();
      bodyElement.replaceChildren(...buildBodyChildren(desiredBodyValue));
      bodyElement.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: desiredBodyValue,
        })
      );
      bodyElement.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        ok: true,
        reason: null,
        bodyText: bodyElement.innerText,
      };
    })()`,
    {
      returnByValue: true,
      userGesture: true,
    }
  );
}

async function uploadReplyAttachments(
  tab: GmailReplyTab,
  attachmentPaths: readonly string[]
): Promise<string[]> {
  const absolutePaths = attachmentPaths.map((path) => resolve(path));
  const attachmentNames = absolutePaths.map((path) => basename(path));

  await tab.waitFor({
    predicate: `Boolean(document.querySelector(${JSON.stringify(GMAIL_FILE_INPUT_SELECTOR)}))`,
    timeoutMs: GMAIL_REPLY_READY_TIMEOUT_MS,
  });

  await tab.uploadFiles(GMAIL_FILE_INPUT_SELECTOR, absolutePaths);

  const predicateSource = attachmentNames
    .map(
      (fileName) =>
        `Array.from(document.querySelectorAll('[download_url], .dL, .vI, .aV3, [aria-label*="Attachment"]')).some((element) => {
          const text = (element.textContent || '') + ' ' + (element.getAttribute('aria-label') || '');
          return text.includes(${JSON.stringify(fileName)});
        })`
    )
    .join(' && ');

  await tab.waitFor({
    predicate: `Boolean(${predicateSource || 'true'})`,
    timeoutMs: GMAIL_REPLY_READY_TIMEOUT_MS,
  });
  await tab.waitForIdle(1_500);

  const snapshot = await readReplySnapshot(tab);
  return attachmentNames.filter((fileName) =>
    snapshot.attachmentNames.some((attachmentName) => attachmentName.includes(fileName))
  );
}

async function clickSendAndWait(tab: GmailReplyTab): Promise<SendOutcome> {
  return await tab.evaluate<SendOutcome>(
    `(async () => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sendButton = Array.from(
        document.querySelectorAll('[data-tooltip], [aria-label], div[role="button"], button')
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
          message: 'Could not find the Gmail Send button for the reply.',
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
        message: 'Timed out waiting for Gmail to confirm that the reply was sent.',
      };
    })()`,
    {
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }
  );
}

function buildReplyResult({
  status,
  requestedUrl,
  snapshot,
  resolvedOptions,
  attachedFileNames,
  message,
}: {
  status: GmailReplyToEmailResult['status'];
  requestedUrl: string;
  snapshot: GmailReplySnapshot;
  resolvedOptions: ResolvedReplyOptions;
  attachedFileNames: string[];
  message: string | null;
}): GmailReplyToEmailResult {
  return {
    status,
    requestedUrl,
    page: snapshot.page,
    subject: snapshot.subject,
    bodyPreview: previewReplyBody(snapshot.bodyText || resolvedOptions.body),
    attachmentPaths: resolvedOptions.attachmentPaths,
    attachedFileNames,
    sendRequested: resolvedOptions.send,
    message,
  };
}

function resolveReplyOptions(options: GmailReplyToEmailOptions): ResolvedReplyOptions {
  const body = options.body ?? '';
  const attachmentPaths = normalizeReplyAttachmentPaths(options.attachmentPaths);

  if (body.trim().length === 0 && attachmentPaths.length === 0) {
    throw new Error('Replying to a Gmail thread requires body text or at least one attachment.');
  }

  return {
    url: normalizeGmailThreadUrl(options.url),
    body,
    attachmentPaths,
    send: options.send ?? false,
    launch: options.launch ?? true,
  };
}

async function saveReplyToEmailResultToTemp(result: GmailReplyToEmailResult): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-gmail-reply-'));
  const outputPath = join(outputDir, 'reply-to-email.json');
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  return outputPath;
}

function renderReplyToEmailMarkdown(result: GmailReplyToEmailResult, outputPath: string): string {
  const lines = [
    '# Gmail reply',
    '',
    `Status: \`${result.status}\``,
    `Saved raw JSON: \`${outputPath}\``,
    `Requested URL: ${result.requestedUrl}`,
    `Page title: ${result.page.title}`,
    `Subject: ${result.subject || '(no subject found)'}`,
    `Send requested: ${result.sendRequested ? 'yes' : 'no'}`,
    `Body preview: ${result.bodyPreview || '(empty body)'}`,
  ];

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

function createReplyToEmailUsage(): string {
  return `Usage:
  npx @ank1015/llm-extension gmail reply-to-email [options]

Options:
  --url <gmail-thread-url>  Gmail thread URL to reply to
  --body, -b <text>         Plain text reply body
  --attachment, -a <path>
                            Local attachment path; may be repeated
  --send                    Send the reply instead of only creating a draft reply
  --no-launch               Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension gmail reply-to-email --url "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f" --body "Thanks for the update."
  npx @ank1015/llm-extension gmail reply-to-email --url "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f" --body "See attached." --attachment ./notes.txt --send`;
}

export async function runReplyToEmailCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseReplyToEmailCliArgs(argv);
  const result = await replyToEmail(options);
  const outputPath = await saveReplyToEmailResultToTemp(result);
  process.stdout.write(renderReplyToEmailMarkdown(result, outputPath));
}
