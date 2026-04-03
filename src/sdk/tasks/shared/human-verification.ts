import type { WebTab } from '../../web.js';

export interface WaitForHumanVerificationOptions {
  blockedPredicate: string;
  readyPredicate?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  settleMs?: number;
  label?: string;
}

export interface WaitForHumanVerificationResult {
  required: boolean;
  resolved: boolean;
}

export interface WaitForGoogleHumanVerificationOptions extends Omit<
  WaitForHumanVerificationOptions,
  'blockedPredicate'
> {}

type HumanVerificationTab = Pick<WebTab, 'waitForLoad' | 'waitForIdle' | 'evaluate'>;

interface HumanVerificationState {
  blocked: boolean;
  ready: boolean;
}

const DEFAULT_HUMAN_VERIFICATION_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_HUMAN_VERIFICATION_POLL_INTERVAL_MS = 1_000;
const DEFAULT_HUMAN_VERIFICATION_SETTLE_MS = 1_000;

export const GOOGLE_HUMAN_VERIFICATION_PREDICATE = `Boolean(
  document.querySelector('form[action*="sorry"]') ||
  document.querySelector('iframe[title*="reCAPTCHA"]') ||
  /unusual traffic|verify you(?:'|’)re human|not a robot|confirm you(?:'|’)re not a robot|security check/i.test(
    (document.body?.innerText || '')
  )
)`;

export async function waitForGoogleHumanVerificationIfNeeded(
  tab: HumanVerificationTab,
  options: WaitForGoogleHumanVerificationOptions = {}
): Promise<WaitForHumanVerificationResult> {
  return await waitForHumanVerificationIfNeeded(tab, {
    ...options,
    blockedPredicate: GOOGLE_HUMAN_VERIFICATION_PREDICATE,
    label: options.label ?? 'Google human verification',
  });
}

export async function waitForHumanVerificationIfNeeded(
  tab: HumanVerificationTab,
  options: WaitForHumanVerificationOptions
): Promise<WaitForHumanVerificationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HUMAN_VERIFICATION_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_HUMAN_VERIFICATION_POLL_INTERVAL_MS;
  const settleMs = options.settleMs ?? DEFAULT_HUMAN_VERIFICATION_SETTLE_MS;
  const deadline = Date.now() + timeoutMs;
  let required = false;
  let noticePrinted = false;

  while (Date.now() < deadline) {
    const state = await readHumanVerificationState(tab, options);
    if (!state) {
      await waitForPotentialNavigation(tab, deadline);
      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }

    if (state.blocked) {
      required = true;
      if (!noticePrinted) {
        const label = options.label ?? 'human verification';
        process.stderr.write(
          `Waiting for ${label} to be completed in the browser before continuing...\n`
        );
        noticePrinted = true;
      }

      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }

    if (options.readyPredicate && !state.ready) {
      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }

    if (required) {
      await waitForPotentialNavigation(tab, deadline);
      await tab.waitForIdle(settleMs);

      const settledState = await readHumanVerificationState(tab, options);
      if (settledState?.blocked) {
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
        continue;
      }
    }

    return {
      required,
      resolved: true,
    };
  }

  return {
    required,
    resolved: false,
  };
}

async function readHumanVerificationState(
  tab: HumanVerificationTab,
  options: WaitForHumanVerificationOptions
): Promise<HumanVerificationState | null> {
  try {
    return await tab.evaluate<HumanVerificationState>(
      `(() => ({
        blocked: Boolean(${options.blockedPredicate}),
        ready: ${options.readyPredicate ? `Boolean(${options.readyPredicate})` : 'true'},
      }))()`,
      {
        returnByValue: true,
      }
    );
  } catch (error) {
    if (isTransientHumanVerificationError(error)) {
      return null;
    }

    throw error;
  }
}

async function waitForPotentialNavigation(
  tab: HumanVerificationTab,
  deadline: number
): Promise<void> {
  const timeoutMs = Math.min(5_000, Math.max(250, deadline - Date.now()));
  if (timeoutMs <= 0) {
    return;
  }

  try {
    await tab.waitForLoad({ timeoutMs });
  } catch (error) {
    if (!isTransientHumanVerificationError(error)) {
      return;
    }
  }
}

function isTransientHumanVerificationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /inspected target navigated or closed|execution context was destroyed|cannot find context with specified id|session closed|target closed/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
