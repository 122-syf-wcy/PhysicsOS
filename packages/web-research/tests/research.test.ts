import { describe, expect, it } from 'vitest'
import { excerptOf, researchQuestion, resolveCitation, type PageReader, type SearchHit, type SearchProvider } from '../src/index.ts'

const hits: SearchHit[] = [
  { title: '洛伦兹力', url: 'https://example.com/lorentz', snippet: 'F = qvB' },
  { title: '磁场', url: 'https://example.com/magnetic', snippet: '磁场方向' },
  { title: '圆周运动', url: 'https://example.com/circle', snippet: '半径 r' },
]
const provider: SearchProvider = { name: 'test', providesContent: false, async search() { return hits } }
const reader = (failOn: string | undefined = undefined): PageReader => ({
  async read(url) {
    if (failOn !== undefined && url.includes(failOn)) throw new Error('offline')
    return { url, title: '页面 ' + url, text: '第一段无关内容。\n\n洛伦兹力使带电粒子做圆周运动，半径 r = mv/(qB)。\n\n第三段。', fetchedAt: '2026-11-14T00:00:00Z', contentType: 'text/html' }
  },
})

describe('researchQuestion', () => {
  it('reads the top pages and keeps the rest as snippets', async () => {
    const result = await researchQuestion('洛伦兹力 半径', { providers: [provider], reader: reader() }, { limit: 3, readLimit: 2, now: () => new Date('2026-11-14T00:00:00Z') })
    expect(result.sources.map(source => source.depth)).toEqual(['full-text', 'full-text', 'snippet'])
    expect(result.readCount).toBe(2)
    expect(result.sources[0]?.excerpt).toContain('r = mv/(qB)')
    expect(result.sources[2]?.excerpt).toBeUndefined()
    expect(result.sources[2]?.contentSha256).toBeUndefined()
  })

  it('keeps a snippet source and notes the reason when a page cannot be read', async () => {
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: reader('lorentz') }, { limit: 1, readLimit: 1 })
    expect(result.sources[0]?.depth).toBe('snippet')
    expect(result.notes[0]).toContain('未读取全文')
  })

  it('never invents a full-text depth without a successful read', async () => {
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: reader('example.com') }, { limit: 2, readLimit: 2 })
    expect(result.sources.every(source => source.depth === 'snippet')).toBe(true)
    expect(result.readCount).toBe(0)
  })
})

describe('citations', () => {
  it('resolves a known source id and rejects a fabricated one', async () => {
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: reader() }, { limit: 1, readLimit: 0 })
    expect(resolveCitation(result, 's1').url).toBe('https://example.com/lorentz')
    expect(() => resolveCitation(result, 's99')).toThrow('不存在')
    expect(() => resolveCitation(result, { url: 'https://evil.example' })).toThrow('来源编号')
  })
})

describe('excerptOf', () => {
  it('prefers the paragraph containing query terms', () => {
    expect(excerptOf('无关段落。\n\n斜面倾角越大，滑块的加速度越大。', '斜面 加速度', 40)).toBe('斜面倾角越大，滑块的加速度越大。')
  })
  it('falls back to the first paragraph and bounds length', () => {
    expect(excerptOf('只有一段文字。', '不存在', 4)).toBe('只有一段')
  })
})
