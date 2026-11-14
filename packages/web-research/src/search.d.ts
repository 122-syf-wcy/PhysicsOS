import { type SearchHit, type SearchProvider, type SearchResponse } from './types.ts';
/** Strip tags and decode the handful of entities that appear in search metadata. */
export declare function plainText(value: string): string;
export interface SearxOptions {
    readonly endpoint: string;
    /** Sent only server-side; never reaches the browser or the model. */
    readonly apiKey?: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
}
/**
 * Self-hosted SearXNG JSON adapter.
 *
 * It aggregates upstream engines; it does not own a web index. The endpoint
 * is ours, the upstream availability is not, so a generic failure is reported
 * as `SEARCH_UNAVAILABLE` instead of being disguised as "no results".
 */
export declare function searxngProvider(options: SearxOptions): SearchProvider;
interface BingRssOptions {
    readonly endpoint?: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
}
/** Parse Bing RSS items. Exported so the adapter has a pure, testable parser. */
export declare function bingRssHits(text: string): SearchHit[];
/**
 * Last-resort fallback source: Bing's public RSS endpoint. It needs no key but
 * is not an owned index; it is selected explicitly, never silently after a
 * paid/provider failure.
 */
export declare function bingRssProvider(options?: BingRssOptions): SearchProvider;
export interface SearchWithFallbackOptions {
    readonly providers: readonly SearchProvider[];
    readonly limit: number;
    readonly signal?: AbortSignal;
}
/**
 * Query the configured sources in order and return the first non-empty
 * answer. A source that answers with zero results lets the next source try;
 * a source that fails (timeout, rate limit, outage) also lets the next one
 * try, but if every source failed the first real failure is surfaced instead
 * of pretending the query had no matches. Nothing silently switches to a
 * paid service.
 */
export declare function searchWeb(query: string, options: SearchWithFallbackOptions): Promise<SearchResponse>;
export {};
//# sourceMappingURL=search.d.ts.map