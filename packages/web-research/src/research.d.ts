import { type PageReader, type ResearchOptions, type ResearchResult, type ResearchSource, type SearchProvider } from './types.ts';
/** Pick the first sentence-level passage that mentions the query terms; bounded for the UI. */
export declare function excerptOf(text: string, query: string, maxChars?: number): string;
export interface ResearchDependencies {
    readonly providers: readonly SearchProvider[];
    readonly reader: PageReader;
}
/**
 * One bounded research pass: search, optionally read the top public pages,
 * and return numbered sources with the exact fetched text hash.
 *
 * - Never claims full text for a snippet-only source.
 * - A page that fails to read is kept as a snippet source with a note, not
 *   silently dropped; the model can still cite the search metadata.
 * - Page text is untrusted data. It is quoted, never executed or followed as
 *   instructions.
 */
export declare function researchQuestion(query: string, dependencies: ResearchDependencies, options?: Omit<ResearchOptions, 'providers' | 'reader'>): Promise<ResearchResult>;
/**
 * Resolve a model-provided source id to the real URL. A fabricated id is a
 * citation error, not a link the UI should render.
 */
export declare function resolveCitation(result: Pick<ResearchResult, 'sources'>, sourceId: unknown): ResearchSource;
//# sourceMappingURL=research.d.ts.map