export interface GmailReplyToEmailOptions {
    url: string;
    body?: string;
    attachmentPaths?: string | readonly string[];
    send?: boolean;
    launch?: boolean;
}
export interface GmailReplyToEmailResult {
    status: 'draft-created' | 'sent' | 'login-required' | 'thread-unavailable' | 'reply-unavailable' | 'send-failed';
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
interface GmailReplyToEmailCliOptions extends ResolvedReplyOptions {
}
export declare function replyToEmail(options: GmailReplyToEmailOptions): Promise<GmailReplyToEmailResult>;
export declare function normalizeReplyAttachmentPaths(value: string | readonly string[] | undefined): string[];
export declare function previewReplyBody(value: string, maxLength?: number): string;
export declare function parseReplyToEmailCliArgs(argv: string[]): GmailReplyToEmailCliOptions;
export declare function runReplyToEmailCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=reply-to-email.d.ts.map