import { createHash, randomUUID } from 'node:crypto'
import { abortFailure, boundedInteger, createOperation, DEFAULT_RESEARCH_TIMEOUT_MS, failure, isCancellation } from './operation.ts'
import { assertPublicUrl } from './safety.ts'
import { searchWeb } from './search.ts'
import { ResearchError, type PageReader, type ResearchDiagnostic, type ResearchOptions, type ResearchResult, type ResearchSource, type SearchProvider } from './types.ts'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const canonicalUrl = (value: string): string => { const url = assertPublicUrl(value); url.hash = ''; return url.toString() }
const sourceKeyOf = (url: string): string => `src_${sha256(canonicalUrl(url)).slice(0, 32)}`

export function excerptOf(text: string, query: string, maxChars = 600): string {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1)
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(part => part.length > 0)
  const scored = paragraphs.map(paragraph => ({ paragraph, score: terms.reduce((sum, term) => sum + (paragraph.toLowerCase().includes(term) ? 1 : 0), 0) }))
  scored.sort((a, b) => b.score - a.score)
  return (scored[0]?.paragraph ?? paragraphs[0] ?? text.trim()).slice(0, maxChars)
}

export interface ResearchDependencies {
  readonly providers: readonly SearchProvider[]
  readonly reader: PageReader
}

/** One round, one deadline: provider(s), DNS, every address, redirects and decode. */
export async function researchQuestion(query: string, dependencies: ResearchDependencies, options: Omit<ResearchOptions, 'providers' | 'reader'> = {}): Promise<ResearchResult> {
  const limit = boundedInteger(options.limit, 5, 1, 10)
  const readLimit = boundedInteger(options.readLimit, 3, 0, limit)
  const now = options.now ?? (() => new Date())
  const operation = createOperation(options, DEFAULT_RESEARCH_TIMEOUT_MS, 'RESEARCH_TIMEOUT')
  try {
    operation.check()
    const search = await operation.wait(() => searchWeb(query, {
      providers: dependencies.providers, limit, signal: operation.signal,
      deadlineAt: operation.deadlineAt, timeoutMs: operation.remaining(),
    }))
    const researchId = `r_${randomUUID()}`
    const searchedAt = now().toISOString()
    const diagnostics: ResearchDiagnostic[] = [...search.diagnostics]
    const notes = search.diagnostics.filter(item => item.outcome !== 'empty').map(item => `${item.provider ?? 'provider'} 检索降级（${item.code}）。`)
    const sources: ResearchSource[] = []
    const seenUrls = new Set<string>()
    let readCount = 0
    for (const [index, hit] of search.hits.entries()) {
      operation.check()
      const sourceId = `s${sources.length + 1}`
      let url = canonicalUrl(hit.url)
      if (seenUrls.has(url)) continue
      let title = hit.title
      let depth: ResearchSource['depth'] = 'snippet'
      let fetchedAt = searchedAt
      let excerpt: string | undefined
      let contentSha256 = sha256(hit.snippet)
      if (index < readLimit) {
        try {
          const document = await operation.wait(() => dependencies.reader.read(hit.url, {
            timeoutMs: operation.remaining(), signal: operation.signal, deadlineAt: operation.deadlineAt,
          }))
          operation.check()
          if (typeof document.text !== 'string' || document.text.trim() === '' || typeof document.title !== 'string' || typeof document.fetchedAt !== 'string' || !Number.isFinite(Date.parse(document.fetchedAt))) throw failure('FETCH_PARSE_FAILED')
          url = canonicalUrl(document.url)
          title = document.title === '' ? hit.title : document.title.slice(0, 240)
          depth = 'full-text'
          // Preserve the actual document timestamp (including a reader cache hit).
          fetchedAt = document.fetchedAt
          excerpt = excerptOf(document.text, search.query)
          contentSha256 = sha256(document.text)
        } catch (error) {
          operation.check()
          if (isCancellation(error)) throw error instanceof ResearchError ? failure(error.code) : failure('RESEARCH_CANCELLED')
          const code = error instanceof ResearchError && error.code.startsWith('FETCH_') ? error.code : 'FETCH_UNAVAILABLE'
          notes.push(`${sourceId} 只取得搜索摘要（${code}），未读取全文。`)
          diagnostics.push({ stage: 'read', sourceId, provider: search.provider, code, outcome: 'failed' })
        }
      }
      operation.check()
      if (seenUrls.has(url)) continue // distinct hits may redirect to the same document
      seenUrls.add(url)
      const sourceKey = sourceKeyOf(url)
      sources.push({
        sourceId, sourceKey, citationId: `${researchId}:${sourceKey}`, title, url,
        provider: search.provider, fetchedAt, depth, snippet: hit.snippet, contentSha256,
        ...(excerpt === undefined ? {} : { excerpt }),
      })
      if (depth === 'full-text') readCount++
    }
    operation.check()
    return { researchId, query: search.query, provider: search.provider, searchedAt, sources, readCount, notes, degraded: diagnostics.some(item => item.outcome !== 'empty'), diagnostics }
  } catch (error) {
    if (operation.signal.aborted) throw abortFailure(operation.signal)
    if (isCancellation(error)) throw error instanceof ResearchError ? failure(error.code) : failure('RESEARCH_CANCELLED')
    if (error instanceof ResearchError) throw error
    throw failure('SEARCH_UNAVAILABLE')
  } finally { operation.dispose() }
}

export interface CitationReference {
  readonly researchId: string
  readonly citationId?: string
  readonly sourceId?: string
}

type CitationResult = Pick<ResearchResult, 'sources'> & Partial<Pick<ResearchResult, 'researchId'>>

/**
 * New consumers pass an opaque citationId or {researchId, citationId/sourceId}.
 * Bare s1 is retained only for legacy result-local callers; it cannot prove a
 * cross-round identity. An explicit scope and all opaque handles are checked.
 */
export function resolveCitation(result: CitationResult, reference: unknown, expectedResearchId?: string): ResearchSource {
  if (expectedResearchId !== undefined && expectedResearchId !== result.researchId) throw failure('INVALID_CITATION')
  let handle: unknown = reference
  if (typeof reference === 'object' && reference !== null && !Array.isArray(reference)) {
    const scoped = reference as Record<string, unknown>
    if (typeof scoped.researchId !== 'string' || scoped.researchId !== result.researchId) throw failure('INVALID_CITATION')
    if (scoped.citationId !== undefined && scoped.sourceId !== undefined) throw failure('INVALID_CITATION')
    handle = scoped.citationId ?? scoped.sourceId
  }
  if (typeof handle !== 'string' || handle.length > 200) throw failure('INVALID_CITATION')
  const source = result.sources.find(item => item.citationId === handle || (/^s[1-9]\d*$/.test(handle) && item.sourceId === handle))
  if (source === undefined) throw failure('INVALID_CITATION')
  return source
}
