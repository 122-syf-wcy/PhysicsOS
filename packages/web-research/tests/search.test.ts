import { describe, expect, it } from 'vitest'
import { bingRssHits, ResearchError, searchWeb, searxngProvider, type SearchHit, type SearchProvider } from '../src/index.ts'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const provider = (name: string, hits: SearchHit[] | Error): SearchProvider => ({
  name,
  providesContent: false,
  async search() { if (hits instanceof Error) throw hits; return hits },
})

describe('searchWeb', () => {
  it('returns the first provider with results', async () => {
    const result = await searchWeb('洛伦兹力', {
      providers: [provider('empty', []), provider('second', [{ title: '洛伦兹力', url: 'https://example.com/a', snippet: '' }])],
      limit: 5,
    })
    expect(result.provider).toBe('second')
    expect(result.hits).toHaveLength(1)
  })

  it('surfaces the real failure when every provider failed instead of claiming zero results', async () => {
    await expect(searchWeb('洛伦兹力', {
      providers: [provider('one', new ResearchError('SEARCH_TIMEOUT', '超时')), provider('two', new ResearchError('SEARCH_RATE_LIMITED', '限流'))],
      limit: 5,
    })).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT' })
  })

  it('reports NO_RESULTS only when providers answered and found nothing', async () => {
    await expect(searchWeb('洛伦兹力', { providers: [provider('one', []), provider('two', [])], limit: 5 }))
      .rejects.toMatchObject({ code: 'NO_RESULTS' })
  })

  it('rejects empty and overly long queries', async () => {
    await expect(searchWeb('  ', { providers: [], limit: 5 })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    await expect(searchWeb('x'.repeat(241), { providers: [], limit: 5 })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
  })

  it('drops non-HTTP result URLs', async () => {
    const result = await searchWeb('力', {
      providers: [provider('p', [
        { title: 'ok', url: 'https://example.com/ok', snippet: '' },
        { title: 'bad', url: 'javascript:alert(1)', snippet: '' },
      ])],
      limit: 5,
    })
    expect(result.hits.map(hit => hit.url)).toEqual(['https://example.com/ok'])
  })
})

describe('searxngProvider', () => {
  it('requests JSON from the private endpoint and normalises hits', async () => {
    let requested = ''
    const provider = searxngProvider({
      endpoint: 'http://127.0.0.1:8080/search',
      fetch: (async (input: string | URL | Request) => {
        requested = String(input)
        return json({ results: [
          { title: '<b>安培力</b>', url: 'https://example.com/a', content: 'F = BIL', engine: 'wikipedia' },
          { title: '', url: 'https://example.com/b', content: '' },
        ] })
      }) as typeof fetch,
    })
    const hits = await provider.search('安培力', { limit: 5 })
    expect(requested).toContain('format=json')
    expect(requested).toContain('language=zh-CN')
    expect(hits).toEqual([{ title: '安培力', url: 'https://example.com/a', snippet: 'F = BIL', siteName: 'wikipedia' }])
  })

  it('maps a 429 to a rate-limit error', async () => {
    const provider = searxngProvider({ endpoint: 'http://127.0.0.1:8080/search', fetch: (async () => json({}, 429)) as typeof fetch })
    await expect(provider.search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_RATE_LIMITED' })
  })

  it('maps an unreachable endpoint to unavailable, not no-results', async () => {
    const provider = searxngProvider({ endpoint: 'http://127.0.0.1:8080/search', fetch: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    await expect(provider.search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
  })

  it('rejects a non-JSON response honestly', async () => {
    const provider = searxngProvider({ endpoint: 'http://127.0.0.1:8080/search', fetch: (async () => new Response('<html>captcha</html>')) as typeof fetch })
    await expect(provider.search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_PARSE_FAILED' })
  })
})

describe('Bing RSS fallback parser', () => {
  it('parses titles, links and entities', () => {
    const hits = bingRssHits('<rss><channel><item><title>牛顿 &amp; 第二定律</title><link>https://example.com/n</link><description><![CDATA[<b>F=ma</b>]]></description></item></channel></rss>')
    expect(hits).toEqual([{ title: '牛顿 & 第二定律', url: 'https://example.com/n', snippet: 'F=ma' }])
  })
})
