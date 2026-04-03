import { access, copyFile, mkdir, mkdtemp, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse, resolve } from 'node:path';

import { withWebBrowser } from '../../web.js';
import {
  GOOGLE_HUMAN_VERIFICATION_PREDICATE,
  waitForGoogleHumanVerificationIfNeeded,
} from '../shared/human-verification.js';

import type { WebBrowser, WebDownloadInfo, WebTab } from '../../web.js';

export interface GetEmailOptions {
  url: string;
  launch?: boolean;
  downloadAttachmentsToPath?: string;
}

export interface GmailEmailParticipant {
  name: string;
  email: string | null;
}

export interface GmailEmailAttachment {
  index: number;
  name: string;
  downloadUrl: string | null;
  hasDownloadButton: boolean;
}

export interface GmailDownloadedAttachment {
  messageIndex: number;
  attachmentIndex: number;
  name: string;
  sourceDownloadPath: string | null;
  savedPath: string;
}

export interface GmailEmailMessage {
  index: number;
  messageId: string | null;
  legacyMessageId: string | null;
  expanded: boolean;
  from: GmailEmailParticipant;
  toText: string;
  timeText: string;
  attachmentNames: string[];
  attachments: GmailEmailAttachment[];
  bodyText: string;
  bodyTextPreview: string;
  textSnippet: string;
}

export interface GetEmailResult {
  status: 'ok' | 'login-required' | 'email-unavailable';
  requestedUrl: string;
  page: {
    title: string;
    url: string;
    route: string;
  };
  subject: string;
  legacyThreadId: string | null;
  threadPermId: string | null;
  messageSelector: string | null;
  messageCount: number;
  expandedMessageCount: number;
  attachmentsDownloadPath: string | null;
  downloadedAttachments: GmailDownloadedAttachment[];
  attachmentDownloadErrors: string[];
  contentText: string;
  messages: GmailEmailMessage[];
}

interface ResolvedGetEmailOptions {
  url: string;
  launch: boolean;
  downloadAttachmentsToPath: string | null;
}

interface GetEmailCliOptions extends ResolvedGetEmailOptions {}

interface GmailThreadSnapshot {
  page: GetEmailResult['page'];
  subject: string;
  legacyThreadId: string | null;
  threadPermId: string | null;
  messageSelector: string | null;
  isLoginGate: boolean;
  messages: GmailEmailMessage[];
}

const THREAD_MESSAGE_SELECTORS = ['.adn.ads', '[data-message-id]', '.h7', '[role="listitem"]'];

const ATTACHMENT_ROOT_SELECTORS = [
  '.aQH',
  '[download_url]',
  'button[aria-label*="Download attachment"]',
];

const SHOW_TRIMMED_CONTENT_SELECTORS = [
  '[aria-label="Show trimmed content"]',
  '[aria-label*="Show trimmed content"]',
  '[data-tooltip="Show trimmed content"]',
  '[data-tooltip*="Show trimmed content"]',
  'span[role="link"][data-tooltip*="View entire message"]',
  'span[role="link"][aria-label*="View entire message"]',
];
const GMAIL_THREAD_READY_PREDICATE = `Boolean(
  document.querySelector('h2.hP') ||
  document.querySelector('.adn.ads') ||
  document.querySelector('[data-message-id]') ||
  document.querySelector('input[type="email"]') ||
  document.querySelector('input[type="password"]')
)`;

const DOWNLOAD_WAIT_TIMEOUT_MS = 60_000;
const DOWNLOAD_WAIT_POLL_MS = 250;

type GmailThreadTab = Pick<
  WebTab,
  'waitForLoad' | 'waitFor' | 'waitForIdle' | 'evaluate' | 'close'
>;
type GmailThreadBrowser = Pick<WebBrowser, 'chrome' | 'listDownloads' | 'waitForDownload'>;

export async function getEmail(options: GetEmailOptions): Promise<GetEmailResult> {
  const resolvedOptions = resolveOptions(options);

  const { snapshot, downloadedAttachments, attachmentDownloadErrors } = await withWebBrowser(
    async (browser) => {
      const tab = await browser.openTab(resolvedOptions.url, { active: true });

      try {
        await waitForThreadReady(tab);
        await expandTrimmedContent(tab);
        await tab.waitForIdle(1_000);

        const snapshot = await readThreadSnapshot(tab);
        const downloadResult =
          resolvedOptions.downloadAttachmentsToPath &&
          !snapshot.isLoginGate &&
          snapshot.messages.some((message) => message.attachments.length > 0)
            ? await downloadThreadAttachments(
                browser,
                tab,
                snapshot,
                resolvedOptions.downloadAttachmentsToPath
              )
            : { downloadedAttachments: [], attachmentDownloadErrors: [] };

        return {
          snapshot,
          downloadedAttachments: downloadResult.downloadedAttachments,
          attachmentDownloadErrors: downloadResult.attachmentDownloadErrors,
        };
      } finally {
        await tab.close().catch(() => undefined);
      }
    },
    {
      launch: resolvedOptions.launch,
    }
  );

  const status = snapshot.isLoginGate
    ? 'login-required'
    : snapshot.subject || snapshot.messages.length > 0
      ? 'ok'
      : 'email-unavailable';

  return {
    status,
    requestedUrl: resolvedOptions.url,
    page: snapshot.page,
    subject: snapshot.subject,
    legacyThreadId: snapshot.legacyThreadId,
    threadPermId: snapshot.threadPermId,
    messageSelector: snapshot.messageSelector,
    messageCount: snapshot.messages.length,
    expandedMessageCount: snapshot.messages.filter((message) => message.expanded).length,
    attachmentsDownloadPath: resolvedOptions.downloadAttachmentsToPath,
    downloadedAttachments,
    attachmentDownloadErrors,
    contentText: buildThreadContentText(snapshot.messages),
    messages: snapshot.messages,
  };
}

export function normalizeGmailThreadUrl(url: string): string {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error('Gmail thread URL must not be empty.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`Invalid Gmail thread URL: ${url}`);
  }

  if (parsedUrl.hostname !== 'mail.google.com') {
    throw new Error(`Expected a Gmail thread URL on mail.google.com. Received: ${url}`);
  }

  if (!parsedUrl.pathname.startsWith('/mail/')) {
    throw new Error(`Expected a Gmail thread URL under /mail/. Received: ${url}`);
  }

  return parsedUrl.toString();
}

export function normalizeAttachmentDownloadPath(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new Error('Attachment download path must not be empty.');
  }

  return resolve(trimmedPath);
}

export function normalizeGmailAttachmentDownloadUrl(downloadUrl: string): string {
  const trimmedValue = downloadUrl.trim();
  if (!trimmedValue) {
    throw new Error('Gmail attachment download URL must not be empty.');
  }

  const firstColonIndex = trimmedValue.indexOf(':');
  const secondColonIndex =
    firstColonIndex >= 0 ? trimmedValue.indexOf(':', firstColonIndex + 1) : -1;
  const rawUrl = secondColonIndex >= 0 ? trimmedValue.slice(secondColonIndex + 1) : trimmedValue;

  return rawUrl.replace(
    'https://mail.google.com/mail/u/0/https://mail.google.com/mail/u/0?',
    'https://mail.google.com/mail/u/0?'
  );
}

export function parseGetEmailCliArgs(argv: string[]): GetEmailCliOptions {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new Error(createGetEmailUsage());
  }

  let url = '';
  let launch = true;
  let downloadAttachmentsToPath: string | null = null;

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

    if (arg === '--download-attachments-to' || arg === '--download-dir') {
      const rawValue = argv[index + 1];
      if (!rawValue) {
        throw new Error(`Missing value for ${arg}`);
      }
      downloadAttachmentsToPath = rawValue.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--download-attachments-to=')) {
      downloadAttachmentsToPath = arg.slice('--download-attachments-to='.length).trim();
      continue;
    }

    if (arg.startsWith('--download-dir=')) {
      downloadAttachmentsToPath = arg.slice('--download-dir='.length).trim();
      continue;
    }

    if (arg === '--no-launch') {
      launch = false;
      continue;
    }
  }

  if (!url) {
    throw new Error('Missing required Gmail thread URL. Use --url "<gmail-thread-url>".');
  }

  return {
    url: normalizeGmailThreadUrl(url),
    launch,
    downloadAttachmentsToPath: downloadAttachmentsToPath
      ? normalizeAttachmentDownloadPath(downloadAttachmentsToPath)
      : null,
  };
}

export function buildThreadContentText(messages: GmailEmailMessage[]): string {
  const sections = messages
    .filter((message) => message.bodyText)
    .map((message, index) => {
      const lines = [`Message ${index + 1}`];

      if (message.from.name || message.from.email) {
        lines.push(
          `From: ${message.from.name || 'Unknown sender'}${
            message.from.email ? ` <${message.from.email}>` : ''
          }`
        );
      }

      if (message.toText) {
        lines.push(`To: ${message.toText}`);
      }

      if (message.timeText) {
        lines.push(`Time: ${message.timeText}`);
      }

      if (message.attachmentNames.length > 0) {
        lines.push(`Attachments: ${message.attachmentNames.join(', ')}`);
      }

      lines.push('', message.bodyText);
      return lines.join('\n');
    });

  return sections.join('\n\n---\n\n');
}

async function saveGetEmailResultToTemp(result: GetEmailResult): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-gmail-get-email-'));
  const outputPath = join(outputDir, 'get-email.json');
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  return outputPath;
}

function renderGetEmailMarkdown(result: GetEmailResult, outputPath: string): string {
  const lines = [
    '# Gmail email',
    '',
    `Status: \`${result.status}\``,
    `Saved raw JSON: \`${outputPath}\``,
    `Requested URL: ${result.requestedUrl}`,
    `Page title: ${result.page.title}`,
    `Subject: ${result.subject || '(no subject)'}`,
    `Messages found: ${result.messageCount}`,
    `Expanded messages: ${result.expandedMessageCount}`,
  ];

  if (result.attachmentsDownloadPath) {
    lines.push(`Attachment download path: ${result.attachmentsDownloadPath}`);
  }

  if (result.status === 'login-required') {
    lines.push('', 'Gmail appears to be showing a login gate instead of the requested thread.');
    return `${lines.join('\n')}\n`;
  }

  if (result.status === 'email-unavailable') {
    lines.push('', 'The Gmail thread view did not become available.');
    return `${lines.join('\n')}\n`;
  }

  if (result.downloadedAttachments.length > 0) {
    lines.push('', 'Downloaded attachments:', '');
    for (const attachment of result.downloadedAttachments) {
      lines.push(`- ${attachment.name} -> ${attachment.savedPath}`);
    }
  }

  if (result.attachmentDownloadErrors.length > 0) {
    lines.push('', 'Attachment download errors:', '');
    for (const error of result.attachmentDownloadErrors) {
      lines.push(`- ${error}`);
    }
  }

  if (result.messages.length === 0) {
    lines.push('', 'No Gmail messages were extracted from the thread.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('', 'Messages:', '');

  for (const message of result.messages) {
    const sender = message.from.name || message.from.email || 'Unknown sender';
    lines.push(
      `${message.index + 1}. **${sender}**${message.from.email ? ` <${message.from.email}>` : ''}`
    );
    if (message.timeText) {
      lines.push(`   Time: ${message.timeText}`);
    }
    if (message.toText) {
      lines.push(`   To: ${message.toText}`);
    }
    if (message.attachmentNames.length > 0) {
      lines.push(`   Attachments: ${message.attachmentNames.join(', ')}`);
    }
    if (message.bodyTextPreview) {
      lines.push(`   Preview: ${message.bodyTextPreview}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function createGetEmailUsage(): string {
  return `Usage:
  npx @ank1015/llm-extension gmail get-email --url <gmail-thread-url> [options]

Options:
  --url <url>                      Gmail thread URL to open
  --download-attachments-to <dir>  Download attachments into the given directory
  --download-dir <dir>             Alias for --download-attachments-to
  --no-launch                      Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension gmail get-email --url "https://mail.google.com/mail/u/0/#inbox/19d09010e9d7747f"
  npx @ank1015/llm-extension gmail get-email --url "https://mail.google.com/mail/u/0/#inbox/..." --download-attachments-to ./downloads`;
}

async function waitForThreadReady(tab: GmailThreadTab): Promise<void> {
  await tab.waitForLoad();
  await tab.waitFor({ selector: 'body' });
  await tab.waitFor({
    predicate: `Boolean(
      ${GMAIL_THREAD_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
    timeoutMs: 30_000,
  });
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_THREAD_READY_PREDICATE,
    label: 'Gmail verification',
  });
  await tab.waitForIdle(1_500);
}

async function expandTrimmedContent(tab: GmailThreadTab): Promise<void> {
  await tab.evaluate(
    `(() => {
      const selectors = ${JSON.stringify(SHOW_TRIMMED_CONTENT_SELECTORS)};
      const buttons = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const uniqueButtons = Array.from(new Set(buttons));

      for (const button of uniqueButtons) {
        if (!(button instanceof HTMLElement)) {
          continue;
        }

        button.click();
      }

      return uniqueButtons.length;
    })()`,
    {
      returnByValue: true,
      userGesture: true,
    }
  );
}

async function readThreadSnapshot(tab: GmailThreadTab): Promise<GmailThreadSnapshot> {
  await waitForGoogleHumanVerificationIfNeeded(tab, {
    readyPredicate: GMAIL_THREAD_READY_PREDICATE,
    label: 'Gmail verification',
  });

  const script = [
    '(() => {',
    `const threadMessageSelectors = ${JSON.stringify(THREAD_MESSAGE_SELECTORS)};`,
    `const attachmentRootSelectors = ${JSON.stringify(ATTACHMENT_ROOT_SELECTORS)};`,
    "const normalize = (value) => (value || '').replace(/\\\\s+/g, ' ').trim();",
    'const truncate = (value, max = 240) => {',
    '  const text = normalize(value);',
    "  return text.length > max ? text.slice(0, max - 1) + '…' : text;",
    '};',
    "const subjectElement = document.querySelector('h2.hP') || document.querySelector('.ha h2');",
    'const activeMessageSelector = threadMessageSelectors.find((selector) => document.querySelector(selector)) || null;',
    'const rawMessageRoots = activeMessageSelector ? Array.from(document.querySelectorAll(activeMessageSelector)) : [];',
    "const messageRoots = Array.from(new Set(rawMessageRoots.map((root) => { if (!(root instanceof Element)) return null; return root.closest('.adn.ads, .h7, [data-message-id]') || root; }).filter((root) => root instanceof Element)));",
    'const messages = messageRoots.map((root, index) => {',
    '  if (!(root instanceof HTMLElement)) return null;',
    "  const dataMessageElement = root.matches('[data-message-id]') ? root : root.querySelector('[data-message-id]');",
    "  const fromElement = root.querySelector('.gD') || root.querySelector('[email]');",
    "  const toElement = root.querySelector('.g2') || root.querySelector('.go');",
    "  const timeElement = root.querySelector('.g3') || root.querySelector('span[title]');",
    "  const bodyElement = root.querySelector('.a3s') || root.querySelector('.ii.gt');",
    '  const rawAttachmentRoots = attachmentRootSelectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));',
    "  const attachmentRoots = Array.from(new Set(rawAttachmentRoots.map((attachmentRoot) => { if (!(attachmentRoot instanceof Element)) return null; return attachmentRoot.closest('.aQH') || attachmentRoot.closest('.aZo, .aQy, [download_url]') || attachmentRoot; }).filter((attachmentRoot) => attachmentRoot instanceof Element)));",
    '  const attachments = attachmentRoots.map((attachmentRoot, attachmentIndex) => {',
    '    if (!(attachmentRoot instanceof Element)) return null;',
    "    const nameElement = attachmentRoot.querySelector('.aV3') || attachmentRoot;",
    "    const downloadUrlElement = attachmentRoot.querySelector('[download_url]') || (attachmentRoot.matches('[download_url]') ? attachmentRoot : null);",
    '    const downloadButton = attachmentRoot.querySelector(\'button[aria-label*="Download attachment"]\') || (attachmentRoot.matches(\'button[aria-label*="Download attachment"]\') ? attachmentRoot : null);',
    "    const derivedName = normalize(nameElement?.textContent || '') || normalize(downloadButton?.getAttribute('aria-label') || '').replace(/^Download attachment\\s*/i, '').trim() || ('Attachment ' + (attachmentIndex + 1));",
    '    return {',
    '      index: attachmentIndex,',
    '      name: derivedName,',
    "      downloadUrl: downloadUrlElement instanceof Element ? downloadUrlElement.getAttribute('download_url') : null,",
    '      hasDownloadButton: downloadButton instanceof Element,',
    '    };',
    '  }).filter(Boolean);',
    "  const bodyText = bodyElement instanceof HTMLElement ? normalize(bodyElement.innerText || bodyElement.textContent || '') : '';",
    '  return {',
    '    index,',
    "    messageId: dataMessageElement instanceof Element ? dataMessageElement.getAttribute('data-message-id') : null,",
    "    legacyMessageId: dataMessageElement instanceof Element ? dataMessageElement.getAttribute('data-legacy-message-id') : null,",
    '    expanded: Boolean(bodyText),',
    '    from: {',
    "      name: normalize(fromElement?.textContent || ''),",
    "      email: fromElement instanceof Element ? fromElement.getAttribute('email') || fromElement.getAttribute('data-hovercard-id') : null,",
    '    },',
    "    toText: normalize(toElement?.textContent || ''),",
    "    timeText: normalize(timeElement?.getAttribute('title') || timeElement?.getAttribute('aria-label') || timeElement?.textContent || ''),",
    '    attachmentNames: attachments.map((attachment) => attachment.name),',
    '    attachments,',
    '    bodyText,',
    '    bodyTextPreview: truncate(bodyText, 240),',
    "    textSnippet: truncate(root.innerText || root.textContent || '', 240),",
    '  };',
    '}).filter(Boolean);',
    'return {',
    '  page: {',
    '    title: document.title,',
    '    url: window.location.href,',
    '    route: window.location.hash || window.location.pathname || window.location.href,',
    '  },',
    "  subject: normalize(subjectElement?.textContent || ''),",
    "  legacyThreadId: subjectElement instanceof Element ? subjectElement.getAttribute('data-legacy-thread-id') : null,",
    "  threadPermId: subjectElement instanceof Element ? subjectElement.getAttribute('data-thread-perm-id') : null,",
    '  messageSelector: activeMessageSelector,',
    "  isLoginGate: Boolean(document.querySelector('input[type=\"email\"]') || document.querySelector('input[type=\"password\"]') || normalize(document.body?.innerText || '').includes('Sign in')),",
    '  messages,',
    '};',
    '})()',
  ].join('\n');

  return await tab.evaluate<GmailThreadSnapshot>(script, {
    returnByValue: true,
  });
}

async function downloadThreadAttachments(
  browser: GmailThreadBrowser,
  tab: GmailThreadTab,
  snapshot: GmailThreadSnapshot,
  targetDir: string
): Promise<{
  downloadedAttachments: GmailDownloadedAttachment[];
  attachmentDownloadErrors: string[];
}> {
  await mkdir(targetDir, { recursive: true });

  const downloadedAttachments: GmailDownloadedAttachment[] = [];
  const attachmentDownloadErrors: string[] = [];

  for (const message of snapshot.messages) {
    for (const attachment of message.attachments) {
      try {
        const beforeDownloads = await browser.listDownloads();
        const beforeIds = new Set(
          beforeDownloads
            .map((download) => (typeof download.id === 'number' ? download.id : null))
            .filter((downloadId): downloadId is number => downloadId !== null)
        );

        const download = attachment.downloadUrl
          ? await downloadAttachmentViaChrome(browser, attachment.downloadUrl)
          : await downloadAttachmentViaPageClick(
              browser,
              tab,
              message.index,
              attachment.index,
              beforeIds,
              attachment.name
            );

        if (!download.filename) {
          throw new Error(`Browser did not report a download file path for "${attachment.name}".`);
        }

        const savedPath = await moveDownloadedFile(download.filename, targetDir, attachment.name);

        downloadedAttachments.push({
          messageIndex: message.index,
          attachmentIndex: attachment.index,
          name: attachment.name,
          sourceDownloadPath: download.filename ?? null,
          savedPath,
        });
      } catch (error) {
        attachmentDownloadErrors.push(
          error instanceof Error
            ? error.message
            : `Failed to download attachment "${attachment.name}".`
        );
      }
    }
  }

  return {
    downloadedAttachments,
    attachmentDownloadErrors,
  };
}

async function triggerAttachmentDownload(
  tab: GmailThreadTab,
  messageIndex: number,
  attachmentIndex: number
): Promise<boolean> {
  return await tab.evaluate<boolean>(
    `(() => {
      const threadMessageSelectors = ${JSON.stringify(THREAD_MESSAGE_SELECTORS)};
      const attachmentRootSelectors = ${JSON.stringify(ATTACHMENT_ROOT_SELECTORS)};

      const rawMessageRoots = threadMessageSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector))
      );
      const messageRoots = Array.from(
        new Set(
          rawMessageRoots
            .map((root) => {
              if (!(root instanceof Element)) {
                return null;
              }

              return root.closest('.adn.ads, .h7, [data-message-id]') || root;
            })
            .filter((root) => root instanceof Element)
        )
      );

      const messageRoot = messageRoots[${JSON.stringify(messageIndex)}];
      if (!(messageRoot instanceof Element)) {
        return false;
      }

      const rawAttachmentRoots = attachmentRootSelectors.flatMap((selector) =>
        Array.from(messageRoot.querySelectorAll(selector))
      );
      const attachmentRoots = Array.from(
        new Set(
          rawAttachmentRoots
            .map((attachmentRoot) => {
              if (!(attachmentRoot instanceof Element)) {
                return null;
              }

              return (
                attachmentRoot.closest('.aQH') ||
                attachmentRoot.closest('.aZo, .aQy, [download_url]') ||
                attachmentRoot
              );
            })
            .filter((attachmentRoot) => attachmentRoot instanceof Element)
        )
      );

      const attachmentRoot = attachmentRoots[${JSON.stringify(attachmentIndex)}];
      if (!(attachmentRoot instanceof Element)) {
        return false;
      }

      const button =
        attachmentRoot.querySelector('button[aria-label*="Download attachment"]') ||
        (attachmentRoot.matches('button[aria-label*="Download attachment"]')
          ? attachmentRoot
          : null) ||
        attachmentRoot.querySelector('[download_url]') ||
        (attachmentRoot.matches('[download_url]') ? attachmentRoot : null);

      if (!(button instanceof HTMLElement)) {
        return false;
      }

      button.click();
      return true;
    })()`,
    {
      returnByValue: true,
      userGesture: true,
    }
  );
}

async function downloadAttachmentViaChrome(
  browser: GmailThreadBrowser,
  rawDownloadUrl: string
): Promise<WebDownloadInfo> {
  const normalizedDownloadUrl = normalizeGmailAttachmentDownloadUrl(rawDownloadUrl);
  const downloadId = await browser.chrome<number>('downloads.download', {
    url: normalizedDownloadUrl,
  });

  if (typeof downloadId !== 'number') {
    throw new Error('Chrome did not return a download ID for the Gmail attachment.');
  }

  return await browser.waitForDownload(
    { id: downloadId },
    {
      requireComplete: true,
      timeoutMs: DOWNLOAD_WAIT_TIMEOUT_MS,
    }
  );
}

async function downloadAttachmentViaPageClick(
  browser: GmailThreadBrowser,
  tab: GmailThreadTab,
  messageIndex: number,
  attachmentIndex: number,
  previousDownloadIds: ReadonlySet<number>,
  attachmentName: string
): Promise<WebDownloadInfo> {
  const triggered = await triggerAttachmentDownload(tab, messageIndex, attachmentIndex);
  if (!triggered) {
    throw new Error(`Could not trigger download for attachment "${attachmentName}".`);
  }

  return await waitForFreshDownload(browser, previousDownloadIds);
}

async function waitForFreshDownload(
  browser: GmailThreadBrowser,
  previousDownloadIds: ReadonlySet<number>
): Promise<WebDownloadInfo> {
  const deadline = Date.now() + DOWNLOAD_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const downloads = await browser.listDownloads();
    const freshDownload = downloads.find(
      (download) =>
        download.state === 'complete' &&
        typeof download.id === 'number' &&
        !previousDownloadIds.has(download.id)
    );

    if (freshDownload) {
      return freshDownload;
    }

    await sleep(DOWNLOAD_WAIT_POLL_MS);
  }

  throw new Error(
    `Timed out waiting for attachment download within ${DOWNLOAD_WAIT_TIMEOUT_MS}ms.`
  );
}

async function moveDownloadedFile(
  sourcePath: string,
  targetDir: string,
  attachmentName: string
): Promise<string> {
  const safeName = sanitizeAttachmentFileName(
    attachmentName || basename(sourcePath) || 'attachment'
  );
  const targetPath = await getAvailableTargetPath(targetDir, safeName);

  try {
    await rename(sourcePath, targetPath);
  } catch {
    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath).catch(() => undefined);
  }

  return targetPath;
}

async function getAvailableTargetPath(targetDir: string, fileName: string): Promise<string> {
  const parsed = parse(fileName);
  let candidatePath = join(targetDir, fileName);
  let suffix = 1;

  while (await pathExists(candidatePath)) {
    const nextName = `${parsed.name || 'attachment'}-${suffix}${parsed.ext}`;
    candidatePath = join(targetDir, nextName);
    suffix += 1;
  }

  return candidatePath;
}

function sanitizeAttachmentFileName(fileName: string): string {
  const sanitized = replaceControlCharacters(fileName)
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\\s+/g, ' ')
    .trim()
    .replace(/^\\.+|\\.+$/g, '');

  return sanitized || 'attachment';
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f ? '_' : character;
  }).join('');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveOptions(options: GetEmailOptions): ResolvedGetEmailOptions {
  return {
    url: normalizeGmailThreadUrl(options.url),
    launch: options.launch ?? true,
    downloadAttachmentsToPath: options.downloadAttachmentsToPath
      ? normalizeAttachmentDownloadPath(options.downloadAttachmentsToPath)
      : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export async function runGetEmailCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseGetEmailCliArgs(argv);
  const result = await getEmail({
    url: options.url,
    launch: options.launch,
    ...(options.downloadAttachmentsToPath
      ? { downloadAttachmentsToPath: options.downloadAttachmentsToPath }
      : {}),
  });
  const outputPath = await saveGetEmailResultToTemp(result);
  process.stdout.write(renderGetEmailMarkdown(result, outputPath));
}
