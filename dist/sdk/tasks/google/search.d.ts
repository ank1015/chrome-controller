export interface GoogleSearchOptions {
    query?: string | readonly string[];
    allWords?: string | readonly string[];
    exactPhrase?: string;
    anyWords?: string | readonly string[];
    noneWords?: string | readonly string[];
    minNumber?: string | number;
    maxNumber?: string | number;
    language?: string;
    region?: string;
    lastUpdate?: string;
    siteOrDomain?: string;
    termsAppearing?: string;
    fileType?: string;
    usageRights?: string;
    count?: number;
    launch?: boolean;
}
export interface GoogleSearchResolvedOption {
    requested: string;
    value: string;
    label: string;
}
export interface GoogleSearchResultItem {
    index: number;
    title: string;
    url: string;
    siteName: string | null;
    displayUrl: string | null;
    snippet: string;
    textSnippet: string;
}
export interface GoogleSearchResult {
    status: 'ok' | 'no-results' | 'captcha' | 'search-unavailable';
    page: {
        title: string;
        url: string;
        route: string;
    };
    query: {
        allWords: string;
        exactPhrase: string;
        anyWords: string;
        noneWords: string;
        minNumber: string;
        maxNumber: string;
        siteOrDomain: string;
    };
    selectedOptions: {
        language?: GoogleSearchResolvedOption;
        region?: GoogleSearchResolvedOption;
        lastUpdate?: GoogleSearchResolvedOption;
        termsAppearing?: GoogleSearchResolvedOption;
        fileType?: GoogleSearchResolvedOption;
        usageRights?: GoogleSearchResolvedOption;
    };
    requestedCount: number;
    collectedCount: number;
    pagesVisited: number;
    resultStats: string | null;
    results: GoogleSearchResultItem[];
}
export interface GoogleSearchCandidateBlock {
    index: number;
    title: string;
    rawHref: string | null;
    resolvedHref: string | null;
    siteName: string | null;
    displayUrl: string | null;
    snippet: string | null;
    text: string;
}
export interface GoogleSelectOption {
    value: string;
    label: string;
}
export interface GoogleSearchNextPageCandidate {
    id: string | null;
    text: string;
    ariaLabel: string | null;
    href: string | null;
    inResultsFooter: boolean;
    inNavigationRegion: boolean;
    inPaginationTable: boolean;
}
interface ResolvedGoogleSearchOptions {
    allWords: string;
    exactPhrase: string;
    anyWords: string;
    noneWords: string;
    minNumber: string;
    maxNumber: string;
    language?: string;
    region?: string;
    lastUpdate?: string;
    siteOrDomain: string;
    termsAppearing?: string;
    fileType?: string;
    usageRights?: string;
    count: number;
    launch: boolean;
}
interface GoogleSearchCliOptions extends ResolvedGoogleSearchOptions {
}
export declare function searchGoogle(options: GoogleSearchOptions): Promise<GoogleSearchResult>;
export declare function resolveGoogleSearchOptions(options: GoogleSearchOptions): ResolvedGoogleSearchOptions;
export declare function findGoogleSelectOptionMatch(options: readonly GoogleSelectOption[], requested: string): GoogleSelectOption | undefined;
export declare function parseGoogleSearchCliArgs(argv: string[]): GoogleSearchCliOptions;
export declare function selectOrganicGoogleSearchResults(candidates: readonly GoogleSearchCandidateBlock[]): GoogleSearchResultItem[];
export declare function isGoogleSearchPaginationUrl(rawUrl: string | null | undefined, pageUrl: string): boolean;
export declare function pickGoogleSearchNextPageCandidate(candidates: readonly GoogleSearchNextPageCandidate[], pageUrl: string): GoogleSearchNextPageCandidate | undefined;
export declare function saveGoogleSearchResultToTemp(result: GoogleSearchResult): Promise<string>;
export declare function renderGoogleSearchMarkdown(result: GoogleSearchResult, outputPath: string): string;
export declare function runGoogleSearchCli(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=search.d.ts.map