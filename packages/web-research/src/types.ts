/** Harness-independent public research contracts. Errors never include request data. */
export type ResearchErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_CITATION'
  | 'NO_RESULTS'
  | 'RESEARCH_CANCELLED'
  | 'RESEARCH_TIMEOUT'
  | 'RESEARCH_BUSY'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_RATE_LIMITED'
  | 'SEARCH_UNAVAILABLE'
  | 'SEARCH_PARSE_FAILED'
  | 'FETCH_BLOCKED'
  | 'FETCH_TIMEOUT'
  | 'FETCH_RATE_LIMITED'
  | 'FETCH_TOO_LARGE'
  | 'FETCH_UNSUPPORTED_TYPE'
  | 'FETCH_UNAVAILABLE'
  | 'FETCH_PARSE_FAILED'

/** Diagnostic codes and counts only: no query, response body, headers or raw errors. */
export interface ResearchDiagnostic {
  readonly stage: 'search' | 'read'
  readonly code: ResearchErrorCode
  readonly outcome: 'empty' | 'failed' | 'partial'
  readonly provider?: string
  readonly sourceId?: string
  readonly count?: number
}

export class ResearchError extends Error {
  readonly diagnostics: readonly ResearchDiagnostic[]

  constructor(readonly code: ResearchErrorCode, message: string, diagnostics: readonly ResearchDiagnostic[] = []) {
    super(message)
    this.name = 'ResearchError'
    this.diagnostics = diagnostics
  }
}

export interface SearchHit {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly siteName?: string
  readonly publishedAt?: string
}

export interface SearchResponse {
  readonly query: string
  readonly provider: string
  readonly hits: readonly SearchHit[]
  readonly degraded: boolean
  readonly diagnostics: readonly ResearchDiagnostic[]
}

export interface SearchOptions {
  readonly limit: number
  readonly signal?: AbortSignal
  /** Absolute round deadline, including time spent in earlier providers/pages. */
  readonly deadlineAt?: number
}

export interface SearchProviderResult {
  readonly hits: readonly SearchHit[]
  readonly diagnostics?: readonly ResearchDiagnostic[]
}

export interface SearchProvider {
  readonly name: string
  readonly providesContent: boolean
  search(query: string, options: SearchOptions): Promise<readonly SearchHit[]>
  /** Additive: old adapters and callers can continue using search() returning an array. */
  searchDetailed?(query: string, options: SearchOptions): Promise<SearchProviderResult>
}

export interface ReadDocument {
  readonly url: string
  readonly title: string
  readonly text: string
  readonly fetchedAt: string
  readonly contentType: string
}

export interface ReadOptions {
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly signal?: AbortSignal
  readonly deadlineAt?: number
}

export interface ResearchSource {
  /** Legacy display handle. It is local to this result, not a cross-round citation. */
  readonly sourceId: string
  /** Stable canonical-URL identity, independent of result rank. */
  readonly sourceKey: string
  /** Opaque research-scoped handle. Prefer this to bare s1 when citing. */
  readonly citationId: string
  readonly title: string
  readonly url: string
  readonly provider: string
  readonly fetchedAt: string
  readonly depth: 'snippet' | 'full-text'
  readonly snippet: string
  readonly excerpt?: string
  /** Hash of the fetched plain text, or of the search snippet at snippet depth. */
  readonly contentSha256: string
}

export interface ResearchResult {
  readonly researchId: string
  readonly query: string
  readonly provider: string
  readonly searchedAt: string
  readonly sources: readonly ResearchSource[]
  readonly readCount: number
  readonly notes: readonly string[]
  readonly degraded: boolean
  readonly diagnostics: readonly ResearchDiagnostic[]
}

export interface ResearchOptions {
  readonly providers: readonly SearchProvider[]
  readonly reader: PageReader
  readonly limit?: number
  readonly readLimit?: number
  /** One budget for the entire round, not a new budget per page. */
  readonly timeoutMs?: number
  readonly deadlineAt?: number
  readonly now?: () => Date
  readonly signal?: AbortSignal
}

export interface PageReader {
  read(url: string, options?: ReadOptions): Promise<ReadDocument>
}
