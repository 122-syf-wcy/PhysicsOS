import { createServer, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createSafeReader, htmlToText } from '../src/index.ts'

const servers: Server[] = []
const launch = async (handler: Parameters<typeof createServer>[1]): Promise<string> => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => { resolve() }) })))
})

/**
 * The reader still refuses loopback by default. These fixtures opt in to
 * "127.0.0.1" only, to reach the local HTTP server; the DNS result is still
 * checked against the same policy and the redirect tests re-apply it.
 */
const loopbackAllowed = { lookup: async () => ['127.0.0.1'] as const, addressPolicy: (address: string) => address === '127.0.0.1' }

describe('htmlToText', () => {
  it('extracts readable text, drops scripts and keeps paragraph breaks', () => {
    const { title, text } = htmlToText('<html><head><title> 牛顿定律 </title><style>.x{}</style></head><body><script>alert(1)</script><nav>菜单</nav><main><h1>第一定律</h1><p>物体保持静止 &amp; 匀速直线运动。</p><p>第二段&nbsp;文字</p></main></body></html>')
    expect(title).toBe('牛顿定律')
    expect(text).toContain('第一定律')
    expect(text).toContain('物体保持静止 & 匀速直线运动。')
    expect(text).toContain('第二段 文字')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('.x{}')
  })

  it('prefers article content over outer chrome', () => {
    const { text } = htmlToText('<body><header>页头</header><article><p>正文内容足够长，可以阅读。</p></article><footer>页脚</footer></body>')
    expect(text).toContain('正文内容足够长')
    expect(text).not.toContain('页头')
  })
})

describe('safe reader', () => {
  it('refuses a loopback URL before any connection', async () => {
    let hit = false
    const base = await launch((_req, res) => { hit = true; res.end('ok') })
    const reader = createSafeReader({ lookup: async () => ['127.0.0.1'] })
    await expect(reader.read(base)).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    expect(hit).toBe(false)
  })

  it('refuses a hostname that resolves to a private address', async () => {
    // A public-looking hostname whose resolver answer is private must not be
    // connected to, even though the name itself passed the literal checks.
    const reader = createSafeReader({ lookup: async () => ['10.0.0.7'] })
    await expect(reader.read('http://example.invalid/')).rejects.toMatchObject({ code: 'FETCH_UNAVAILABLE' })
    const { resolvePublicAddresses } = await import('../src/index.ts')
    await expect(resolvePublicAddresses('localhost')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('reads text/html and records the final URL', async () => {
    const base = await launch((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title>斜面</title></head><body><main><p>斜面倾角为 30 度。</p></main></body></html>')
    })
    const reader = createSafeReader(loopbackAllowed)
    const document = await reader.read(base + '/p?x=1')
    expect(document.title).toBe('斜面')
    expect(document.text).toContain('斜面倾角为 30 度。')
    expect(document.url).toBe(base + '/p?x=1')
  })

  it('decompresses gzip within the cap', async () => {
    const base = await launch((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      res.end(gzipSync('压缩正文可以读取。'))
    })
    const reader = createSafeReader(loopbackAllowed)
    expect((await reader.read(base)).text).toBe('压缩正文可以读取。')
  })

  it('rejects non-text content types', async () => {
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end('not really') })
    await expect(createSafeReader(loopbackAllowed).read(base)).rejects.toMatchObject({ code: 'FETCH_UNSUPPORTED_TYPE' })
  })

  it('stops a body larger than the limit', async () => {
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(20_000)) })
    await expect(createSafeReader({ ...loopbackAllowed, maxBytes: 1_000 }).read(base)).rejects.toMatchObject({ code: 'FETCH_TOO_LARGE' })
  })

  it('follows a redirect after re-checking it', async () => {
    const base = await launch((req, res) => {
      if (req.url === '/start') { res.writeHead(302, { location: '/final' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('最终页面') }
    })
    const reader = createSafeReader(loopbackAllowed)
    expect((await reader.read(base + '/start')).text).toBe('最终页面')
  })

  it('refuses a redirect that targets a private literal', async () => {
    const base = await launch((_req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end() })
    // The fixture policy only admits 127.0.0.1, so the metadata redirect is
    // re-checked (not followed) exactly as the production policy would.
    await expect(createSafeReader(loopbackAllowed).read(base)).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    // And the production policy rejects it even before the first request.
    await expect(createSafeReader({ lookup: async () => ['127.0.0.1'] }).read(base)).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('caps redirect chains', async () => {
    const base = await launch((req, res) => { res.writeHead(302, { location: `/again${Number(req.url?.slice(6) ?? 0) + 1}` }); res.end() })
    await expect(createSafeReader(loopbackAllowed).read(base + '/again0')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('does not send cookies or credentials', async () => {
    let headers: Record<string, unknown> = {}
    const base = await launch((req, res) => { headers = req.headers; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') })
    await createSafeReader(loopbackAllowed).read(base)
    expect(headers.cookie).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
  })
})
