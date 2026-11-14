/**
 * Public web research contract.
 *
 * The tool level (`physics_search_web`) stays a thin model-facing surface; the
 * retrieval logic lives here and owns no harness types. Every failure has a
 * stable code so the UI and the model can tell "no results" from "the network
 * is down" instead of receiving one generic sentence.
 */
export type ResearchErrorCode = 'INVALID_QUERY' | 'NO_RESULTS' | 'SEARCH_TIMEOUT' | 'SEARCH_RATE_LIMITED' | 'SEARCH_UNAVAILABLE' | 'SEARCH_PARSE_FAILED' | 'FETCH_BLOCKED' | 'FETCH_TIMEOUT' | 'FETCH_TOO_LARGE' | 'FETCH_UNSUPPORTED_TYPE' | 'FETCH_UNAVAILABLE' | 'FETCH_PARSE_FAILED';
export declare class ResearchError extends Error {
    readonly code: ResearchErrorCode;
    constructor(code: ResearchErrorCode, message: string);
}
/** One ranked search hit before any body is read. */
export interface SearchHit {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
    readonly siteName?: string;
    readonly publishedAt?: string;
}
export interface SearchResponse {
    readonly query: string;
    readonly provider: string;
    readonly hits: readonly SearchHit[];
}
/** What a provider adapter must implement. Free/SearXNG and paid/official adapters share this. */
export interface SearchProvider {
    readonly name: string;
    /** True only when the provider returns page content with the hit; otherwise a reader is needed. */
    readonly providesContent: boolean;
    search(query: string, options: {
        readonly limit: number;
        readonly signal?: AbortSignal;
    }): Promise<readonly SearchHit[]>;
}
/** A publicly readable page after extraction. Body is plain text, never executed. */
export interface ReadDocument {
    readonly url: string;
    readonly title: string;
    readonly text: string;
    readonly fetchedAt: string;
    readonly contentType: string;
}
export interface ReadOptions {
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
    readonly maxRedirects?: number;
    readonly signal?: AbortSignal;
}
/** Evidence passed to the model and the UI; source ids are stable within one research result. */
export interface ResearchSource {
    readonly sourceId: string;
    readonly title: string;
    readonly url: string;
    readonly provider: string;
    readonly fetchedAt: string;
    /** `snippet` when only search metadata was read; `full-text` after a successful read. */
    readonly depth: 'snippet' | 'full-text';
    readonly snippet: string;
    /** Bounded quoted passage used for the citation; absent when only a snippet exists. */
    readonly excerpt?: string;
    readonly contentSha256?: string;
}
export interface ResearchResult {
    readonly query: string;
    readonly provider: string;
    readonly searchedAt: string;
    readonly sources: readonly ResearchSource[];
    readonly readCount: number;
    readonly notes: readonly string[];
}
export interface ResearchOptions {
    readonly providers: readonly SearchProvider[];
    readonly reader: PageReader;
    readonly limit?: number;
    readonly readLimit?: number;
    readonly timeoutMs?: number;
    readonly now?: () => Date;
    readonly signal?: AbortSignal;
}
export interface PageReader {
    read(url: string, options?: ReadOptions): Promise<ReadDocument>;
}
//# sourceMappingURL=types.d.ts.map