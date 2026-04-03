export interface FetchNMailsOptions {
    count?: number;
    launch?: boolean;
}
export interface GmailMailOverview {
    index: number;
    rowId: string | null;
    legacyThreadId: string | null;
    threadId: string | null;
    openUrl: string | null;
    sender: string;
    senderEmail: string | null;
    subject: string;
    snippet: string;
    time: string;
    unread: boolean;
    selected: boolean;
    starred: boolean;
    textSnippet: string;
}
export interface FetchNMailsResult {
    status: 'ok' | 'login-required' | 'inbox-unavailable';
    page: {
        title: string;
        url: string;
        route: string;
    };
    rowSelector: string | null;
    visibleRowCount: number;
    mails: GmailMailOverview[];
}
interface FetchNMailsCliOptions extends Required<FetchNMailsOptions> {
}
export declare function fetchNMails(options?: FetchNMailsOptions): Promise<FetchNMailsResult>;
export declare function parseFetchNMailsCliArgs(argv: string[]): FetchNMailsCliOptions;
export declare function buildGmailThreadOpenUrl(pageUrl: string, legacyThreadId: string | null): string | null;
export declare function saveFetchNMailsResultToTemp(result: FetchNMailsResult): Promise<string>;
export declare function renderFetchNMailsMarkdown(result: FetchNMailsResult, outputPath: string): string;
export declare function runFetchNMailsCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=fetch-n-mails.d.ts.map