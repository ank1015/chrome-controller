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
interface GetEmailCliOptions extends ResolvedGetEmailOptions {
}
export declare function getEmail(options: GetEmailOptions): Promise<GetEmailResult>;
export declare function normalizeGmailThreadUrl(url: string): string;
export declare function normalizeAttachmentDownloadPath(path: string): string;
export declare function normalizeGmailAttachmentDownloadUrl(downloadUrl: string): string;
export declare function parseGetEmailCliArgs(argv: string[]): GetEmailCliOptions;
export declare function buildThreadContentText(messages: GmailEmailMessage[]): string;
export declare function runGetEmailCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=get-email.d.ts.map