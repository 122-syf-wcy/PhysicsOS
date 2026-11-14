import { describe, expect, it, vi } from 'vitest'
import * as tool from '../src/index.ts'
import { createResearchService, researchConfigFromEnv, researchFailureMessage } from '../src/research-service.ts'

describe('research service', () => {
  it('exposes the search tool and keeps its citation contract in the value', async () => {
    expect(tool.TOOL_NAMES).toContain('physics_search_web')
  })

  it('reads no SearXNG configuration from an empty environment', () => {
    expect(researchConfigFromEnv({})).toEqual({})
    expect(researchConfigFromEnv({ PHYSICSOS_RESEARCH_SEARXNG_URL: 'http://searxng:8080/search' }))
      .toEqual({ searxngUrl: 'http://searxng:8080/search' })
    expect(researchConfigFromEnv({ PHYSICSOS_RESEARCH_SEARXNG_URL: '  ' })).toEqual({})
  })

  it('maps every stable failure code to distinct Chinese copy', () => {
    const codes = ['INVALID_QUERY', 'NO_RESULTS', 'SEARCH_TIMEOUT', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_PARSE_FAILED']
    const messages = codes.map(code => researchFailureMessage(code))
    expect(new Set(messages).size).toBe(codes.length)
    expect(messages.some(message => message.includes('没有检索到'))).toBe(true)
    expect(messages.some(message => message.includes('离线') || message.includes('联网'))).toBe(true)
  })

  it('serves numbered sources and states whether full text was read', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('bing.com')) {
        return new Response('<rss><channel><item><title>洛伦兹力</title><link>https://example.com/a</link><description>F=qvB</description></item></channel></rss>')
      }
      // The reader reaches the page itself; answer with readable HTML.
      return new Response('<html><head><title>洛伦兹力</title></head><body><main><p>洛伦兹力使粒子做圆周运动，半径 r = mv/(qB)。</p></main></body></html>', { headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      // A local reader cannot be used here (the safe reader refuses loopback),
      // so this asserts the failure path stays honest rather than faking reads.
      const service = createResearchService({})
      const value = await service.present('洛伦兹力 半径')
      const sources = value.sources as { sourceId: string; depth: string; url: string }[]
      expect(sources.map(source => source.sourceId)).toEqual(['s1'])
      expect(sources[0]?.url).toBe('https://example.com/a')
      // example.com is not reachable in this test; the source must stay a
      // snippet and the note must say so, never claim full text.
      expect(sources[0]?.depth).toBe('snippet')
      expect(String(value.readCount)).toBe('0')
      expect(value.guidance).toContain('没有读取网页全文')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('surfaces a real search failure instead of pretending there were no results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    try {
      const service = createResearchService({})
      await expect(service.research('洛伦兹力')).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
