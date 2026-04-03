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
export interface WaitForGoogleHumanVerificationOptions extends Omit<WaitForHumanVerificationOptions, 'blockedPredicate'> {
}
type HumanVerificationTab = Pick<WebTab, 'waitForLoad' | 'waitForIdle' | 'evaluate'>;
export declare const GOOGLE_HUMAN_VERIFICATION_PREDICATE = "Boolean(\n  document.querySelector('form[action*=\"sorry\"]') ||\n  document.querySelector('iframe[title*=\"reCAPTCHA\"]') ||\n  /unusual traffic|verify you(?:'|\u2019)re human|not a robot|confirm you(?:'|\u2019)re not a robot|security check/i.test(\n    (document.body?.innerText || '')\n  )\n)";
export declare function waitForGoogleHumanVerificationIfNeeded(tab: HumanVerificationTab, options?: WaitForGoogleHumanVerificationOptions): Promise<WaitForHumanVerificationResult>;
export declare function waitForHumanVerificationIfNeeded(tab: HumanVerificationTab, options: WaitForHumanVerificationOptions): Promise<WaitForHumanVerificationResult>;
export {};
//# sourceMappingURL=human-verification.d.ts.map