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
export async function waitForGoogleHumanVerificationIfNeeded(tab, options = {}) {
    return await waitForHumanVerificationIfNeeded(tab, {
        ...options,
        blockedPredicate: GOOGLE_HUMAN_VERIFICATION_PREDICATE,
        label: options.label ?? 'Google human verification',
    });
}
export async function waitForHumanVerificationIfNeeded(tab, options) {
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
                process.stderr.write(`Waiting for ${label} to be completed in the browser before continuing...\n`);
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
async function readHumanVerificationState(tab, options) {
    try {
        return await tab.evaluate(`(() => ({
        blocked: Boolean(${options.blockedPredicate}),
        ready: ${options.readyPredicate ? `Boolean(${options.readyPredicate})` : 'true'},
      }))()`, {
            returnByValue: true,
        });
    }
    catch (error) {
        if (isTransientHumanVerificationError(error)) {
            return null;
        }
        throw error;
    }
}
async function waitForPotentialNavigation(tab, deadline) {
    const timeoutMs = Math.min(5_000, Math.max(250, deadline - Date.now()));
    if (timeoutMs <= 0) {
        return;
    }
    try {
        await tab.waitForLoad({ timeoutMs });
    }
    catch (error) {
        if (!isTransientHumanVerificationError(error)) {
            return;
        }
    }
}
function isTransientHumanVerificationError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /inspected target navigated or closed|execution context was destroyed|cannot find context with specified id|session closed|target closed/i.test(message);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=human-verification.js.map