export interface GmailComposeDraftOptions {
    to?: string | readonly string[];
    cc?: string | readonly string[];
    bcc?: string | readonly string[];
    subject?: string;
    body?: string;
    attachmentPaths?: string | readonly string[];
    send?: boolean;
    launch?: boolean;
}
export interface GmailComposeDraftResult {
    status: 'draft-created' | 'sent' | 'login-required' | 'compose-unavailable' | 'send-failed';
    composeUrl: string;
    page: {
        title: string;
        url: string;
        route: string;
    };
    recipients: {
        to: string[];
        cc: string[];
        bcc: string[];
    };
    subject: string;
    bodyPreview: string;
    attachmentPaths: string[];
    attachedFileNames: string[];
    sendRequested: boolean;
    message: string | null;
}
interface ResolvedComposeOptions {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    attachmentPaths: string[];
    send: boolean;
    launch: boolean;
}
interface GmailComposeDraftCliOptions extends ResolvedComposeOptions {
}
export declare function composeDraft(options: GmailComposeDraftOptions): Promise<GmailComposeDraftResult>;
export declare function normalizeGmailAddressList(value: string | readonly string[] | undefined): string[];
export declare function buildGmailComposeUrl(options: Pick<ResolvedComposeOptions, 'to' | 'cc' | 'bcc' | 'subject' | 'body'>): string;
export declare function parseComposeDraftCliArgs(argv: string[]): GmailComposeDraftCliOptions;
export declare function runComposeDraftCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=compose-draft.d.ts.map