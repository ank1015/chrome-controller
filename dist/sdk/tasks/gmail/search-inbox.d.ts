import { type GmailMailOverview } from './fetch-n-mails.js';
export interface SearchInboxOptions {
    query: string;
    count?: number;
    launch?: boolean;
}
export interface SearchInboxResult {
    status: 'ok' | 'login-required' | 'search-unavailable';
    query: string;
    inboxQuery: string;
    page: {
        title: string;
        url: string;
        route: string;
    };
    rowSelector: string | null;
    visibleRowCount: number;
    resultText: string | null;
    noResults: boolean;
    mails: GmailMailOverview[];
}
interface SearchInboxCliOptions extends Required<Omit<SearchInboxOptions, 'query'>> {
    query: string;
}
export declare function searchInbox(options: SearchInboxOptions): Promise<SearchInboxResult>;
export declare function parseSearchInboxCliArgs(argv: string[]): SearchInboxCliOptions;
export declare function buildInboxSearchQuery(query: string): string;
export declare function buildGmailInboxSearchUrl(query: string): string;
export declare function runSearchInboxCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=search-inbox.d.ts.map