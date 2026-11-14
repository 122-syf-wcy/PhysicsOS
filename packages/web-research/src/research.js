import { createHash } from 'node:crypto';
import { searchWeb } from "./search.js";
import { ResearchError } from "./types.js";
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** Pick the first sentence-level passage that mentions the query terms; bounded for the UI. */
export function excerptOf(text, query, maxChars = 600) {
    const terms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
    const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(part => part.length > 0);
    const scored = paragraphs.map(paragraph => ({
        paragraph,
        score: terms.reduce((sum, term) => sum + (paragraph.toLowerCase().includes(term) ? 1 : 0), 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0]?.paragraph ?? paragraphs[0] ?? text.trim();
    return selected.slice(0, maxChars);
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
export async function researchQuestion(query, dependencies, options = {}) {
    const limit = options.limit ?? 5;
    const readLimit = options.readLimit ?? 3;
    const now = options.now ?? (() => new Date());
    const search = await searchWeb(query, { providers: dependencies.providers, limit, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    const notes = [];
    const sources = [];
    let readCount = 0;
    for (const [index, hit] of search.hits.entries()) {
        const sourceId = `s${index + 1}`;
        let url = hit.url;
        let title = hit.title;
        let depth = 'snippet';
        let excerpt;
        let contentSha256;
        if (index < readLimit) {
            try {
                const document = await dependencies.reader.read(hit.url, {
                    timeoutMs: options.timeoutMs,
                    ...(options.signal === undefined ? {} : { signal: options.signal }),
                });
                url = document.url;
                title = document.title === '' ? hit.title : document.title;
                depth = 'full-text';
                excerpt = excerptOf(document.text, query);
                contentSha256 = sha256(document.text);
                readCount++;
            }
            catch (error) {
                const code = error instanceof ResearchError ? error.code : 'FETCH_UNAVAILABLE';
                notes.push(`${sourceId} 只取得搜索摘要（${code}），未读取全文。`);
            }
        }
        sources.push({
            sourceId,
            title,
            url,
            provider: search.provider,
            fetchedAt: now().toISOString(),
            depth,
            snippet: hit.snippet,
            ...(excerpt === undefined ? {} : { excerpt }),
            ...(contentSha256 === undefined ? {} : { contentSha256 }),
        });
    }
    return { query: search.query, provider: search.provider, searchedAt: now().toISOString(), sources, readCount, notes };
}
/**
 * Resolve a model-provided source id to the real URL. A fabricated id is a
 * citation error, not a link the UI should render.
 */
export function resolveCitation(result, sourceId) {
    if (typeof sourceId !== 'string')
        throw new Error('引用必须使用来源编号，如 s1。');
    const source = result.sources.find(item => item.sourceId === sourceId);
    if (source === undefined)
        throw new Error(`来源编号 ${sourceId} 不存在。`);
    return source;
}
//# sourceMappingURL=research.js.map