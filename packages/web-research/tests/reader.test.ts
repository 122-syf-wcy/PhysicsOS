import { createServer, type RequestOptions, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSafeReader, htmlToText, type AddressLookup } from '../src/index.ts'
import { pinnedLookup } from '../src/reader.ts'

const servers: Server[] = []
const launch = async (handler: Parameters<typeof createServer>[1]): Promise<string> => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no fixture port')
  return `http://127.0.0.1:${address.port}`
}
const namedUrl = (base: string, hostname = 'reader.fixture.invalid'): string => { const url = new URL(base); url.hostname = hostname; return url.toString().replace(/\/$/, '') }
const tick = async (): Promise<void> => { for (let index = 0; index < 8; index++) await Promise.resolve() }
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeAllConnections()
  })))
})

const loopbackAllowed = { lookup: async () => ['127.0.0.1'] as const, addressPolicy: (address: string) => address === '127.0.0.1' }
const namedAllowed = { lookup: async () => ['127.0.0.1'] as const, addressPolicy: (address: string) => address === '127.0.0.1' || address.endsWith('.fixture.invalid') }

describe('htmlToText', () => {
  it('drops scripts and extracts readable main text', () => {
    const { title, text } = htmlToText('<html><head><title> 牛顿定律 </title><style>.x{}</style></head><body><script>alert(1)</script><nav>菜单</nav><main><h1>第一定律</h1><p>物体保持静止 &amp; 匀速直线运动。</p><p>第二段&nbsp;文字</p></main></body></html>')
    expect(title).toBe('牛顿定律')
    expect(text).toContain('物体保持静止 & 匀速直线运动。')
    expect(text).toContain('第二段 文字')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('.x{}')
  })
  it('prefers article to page chrome', () => {
    const { text } = htmlToText('<body><header>页头</header><article><p>正文内容足够长，可以阅读。</p></article><footer>页脚</footer></body>')
    expect(text).toContain('正文内容足够长')
    expect(text).not.toContain('页头')
  })
})

describe('pinned Node lookup signatures (pure)', () => {
  const invoke = (lookup: NonNullable<RequestOptions['lookup']>, all: boolean): unknown[] => {
    const callback = vi.fn()
    lookup('reader.fixture.invalid', { all, family: 0, hints: 0 }, callback as never)
    return callback.mock.calls[0]!
  }
  it('returns an address array for all:true and the classic address/family otherwise', () => {
    const lookup = pinnedLookup('127.0.0.1')
    expect(invoke(lookup, true)).toEqual([null, [{ address: '127.0.0.1', family: 4 }]])
    expect(invoke(lookup, false)).toEqual([null, '127.0.0.1', 4])
    expect(invoke(pinnedLookup('::1'), true)).toEqual([null, [{ address: '::1', family: 6 }]])
  })
})

describe('safe reader using local fixtures only', () => {
  it('refuses a loopback URL before DNS or a connection', async () => {
    const hit = vi.fn()
    const base = await launch((_req, res) => { hit(); res.end('ok') })
    const lookup = vi.fn(async () => ['127.0.0.1'])
    await expect(createSafeReader({ lookup }).read(base)).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    expect(hit).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(['10.0.0.7', '::ffff:7f00:1', 'fe80::1', '224.0.0.1'])('rejects mixed injected DNS containing %s before any connection', async address => {
    const reader = createSafeReader({ lookup: async () => ['8.8.8.8', address] })
    await expect(reader.read('http://science.example.invalid/')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('uses the checked DNS answer for a named host, preserving Host and path', async () => {
    let host: string | undefined
    let path: string | undefined
    const base = await launch((req, res) => {
      host = req.headers.host
      path = req.url
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title>斜面</title></head><body><main><p>斜面倾角为 30 度。</p></main></body></html>')
    })
    const lookup = vi.fn(namedAllowed.lookup)
    const url = namedUrl(base) + '/p?x=1'
    const reader = createSafeReader({ ...namedAllowed, lookup })
    const document = await reader.read(url)
    expect(document.title).toBe('斜面')
    expect(document.text).toContain('斜面倾角为 30 度。')
    expect(document.url).toBe(url)
    expect(lookup).toHaveBeenCalledWith('reader.fixture.invalid', expect.objectContaining({ signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) }))
    // This hostname is .invalid: the success proves Node ran the pinned custom
    // lookup instead of skipping it (literal URL) or using the system resolver.
    expect(host).toBe(new URL(url).host)
    expect(path).toBe('/p?x=1')
  })

  it('tries a failed local address then the next checked address for a named host', async () => {
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('第二个地址可用。') })
    const reader = createSafeReader({
      lookup: async () => ['127.0.0.2', '127.0.0.1'],
      addressPolicy: address => address === '127.0.0.1' || address === '127.0.0.2' || address.endsWith('.fixture.invalid'),
      timeoutMs: 1_000,
    })
    expect((await reader.read(namedUrl(base))).text).toBe('第二个地址可用。')
  })

  it('decompresses gzip and caps the decoded output, not only wire bytes', async () => {
    const base = await launch((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      res.end(gzipSync(req.url === '/bomb' ? 'x'.repeat(50_000) : '压缩正文可以读取。'))
    })
    const reader = createSafeReader({ ...loopbackAllowed, maxBytes: 1_000 })
    expect((await reader.read(base)).text).toBe('压缩正文可以读取。')
    await expect(reader.read(base + '/bomb')).rejects.toMatchObject({ code: 'FETCH_TOO_LARGE' })
  })

  it.each([
    ['image/png', '', 'not really an image', 'FETCH_UNSUPPORTED_TYPE'],
    ['text/plain', 'unknown', 'body', 'FETCH_UNSUPPORTED_TYPE'],
    ['text/plain', 'gzip', 'malformed gzip', 'FETCH_PARSE_FAILED'],
    ['text/plain', '', '', 'FETCH_PARSE_FAILED'],
  ])('rejects a faulty/type response %s/%s', async (type, encoding, text, code) => {
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': type, 'content-encoding': encoding }); res.end(text) })
    await expect(createSafeReader(loopbackAllowed).read(base)).rejects.toMatchObject({ code })
  })

  it('stops oversized identity and wire bodies', async () => {
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(20_000)) })
    await expect(createSafeReader({ ...loopbackAllowed, maxBytes: 1_000 }).read(base)).rejects.toMatchObject({ code: 'FETCH_TOO_LARGE' })
  })

  it('revalidates every redirect hostname/address', async () => {
    const base = await launch((req, res) => {
      if (req.url === '/start') { res.writeHead(302, { location: '/final' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('最终页面') }
    })
    const lookup = vi.fn(namedAllowed.lookup)
    expect((await createSafeReader({ ...namedAllowed, lookup }).read(namedUrl(base) + '/start')).text).toBe('最终页面')
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('blocks literal and DNS-private redirect targets without requesting them', async () => {
    let requests = 0
    const base = await launch((_req, res) => { requests++; res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end() })
    await expect(createSafeReader(loopbackAllowed).read(base)).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    expect(requests).toBe(1)
    const redirect = await launch((_req, res) => { res.writeHead(302, { location: namedUrl(base, 'private.fixture.invalid') }); res.end() })
    const lookup = vi.fn(async (hostname: string) => hostname === 'private.fixture.invalid' ? ['::ffff:7f00:1'] : ['127.0.0.1'])
    await expect(createSafeReader({ ...namedAllowed, lookup }).read(namedUrl(redirect))).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    expect(requests).toBe(1)
  })

  it('caps redirect chains and rejects malformed Location safely', async () => {
    const base = await launch((req, res) => { res.writeHead(302, { location: req.url === '/malformed' ? 'http://[' : '/again' }); res.end() })
    await expect(createSafeReader(loopbackAllowed).read(base + '/again')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
    await expect(createSafeReader(loopbackAllowed).read(base + '/malformed')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('does not retry another address to evade a 429', async () => {
    let requests = 0
    const base = await launch((_req, res) => { requests++; res.writeHead(429); res.end('rate limited') })
    const reader = createSafeReader({ ...loopbackAllowed, lookup: async () => ['127.0.0.1', '127.0.0.2'], addressPolicy: address => address === '127.0.0.1' || address === '127.0.0.2' })
    await expect(reader.read(base)).rejects.toMatchObject({ code: 'FETCH_RATE_LIMITED' })
    expect(requests).toBe(1)
  })

  it('does not forward cookies/credentials or reuse a cookie from an earlier hop', async () => {
    const received: Array<Record<string, unknown>> = []
    const base = await launch((req, res) => {
      received.push(req.headers)
      if (req.url === '/start') { res.writeHead(302, { location: '/final', 'set-cookie': 'fixture=secret' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') }
    })
    await createSafeReader(namedAllowed).read(namedUrl(base) + '/start')
    for (const headers of received) { expect(headers.cookie).toBeUndefined(); expect(headers.authorization).toBeUndefined() }
  })

  it('bounds a slow DNS wait and ignores late DNS without opening a socket', async () => {
    let complete!: (addresses: readonly string[]) => void
    let requests = 0
    const base = await launch((_req, res) => { requests++; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('late') })
    const lookup: AddressLookup = () => new Promise(resolve => { complete = resolve })
    const reader = createSafeReader({ ...namedAllowed, lookup, timeoutMs: 200 })
    vi.useFakeTimers()
    const pending = reader.read(namedUrl(base), { deadlineAt: Date.now() + 20 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(21)
    expect((await pending).code).toBe('FETCH_TIMEOUT')
    complete(['127.0.0.1'])
    await tick()
    expect(requests).toBe(0)
  })

  it('honours a pre-aborted caller before DNS and removes caller listeners after success', async () => {
    const lookup = vi.fn(namedAllowed.lookup)
    const reader = createSafeReader({ ...namedAllowed, lookup })
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(reader.read('http://unused.fixture.invalid/', { signal: preAborted.signal })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(lookup).not.toHaveBeenCalled()
    const base = await launch((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') })
    const caller = new AbortController()
    const add = vi.spyOn(caller.signal, 'addEventListener')
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    await reader.read(namedUrl(base), { signal: caller.signal })
    expect(add.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(1)
    expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(1)
  })

  it('aborts an in-flight response and does not try the next address', async () => {
    let started!: () => void
    let closed!: () => void
    const requestStarted = new Promise<void>(resolve => { started = resolve })
    const responseClosed = new Promise<void>(resolve => { closed = resolve })
    let requests = 0
    const base = await launch((_req, res) => {
      requests++
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('partial')
      res.on('close', closed)
      started()
    })
    const caller = new AbortController()
    const reader = createSafeReader({ ...namedAllowed, lookup: async () => ['127.0.0.1', '127.0.0.2'], addressPolicy: address => namedAllowed.addressPolicy(address) || address === '127.0.0.2' })
    const pending = reader.read(namedUrl(base), { signal: caller.signal }).catch(error => error)
    await requestStarted
    caller.abort()
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    await responseClosed
    expect(requests).toBe(1)
  })

  it('cuts off an actively slow-dripping body at the absolute deadline', async () => {
    let started!: () => void
    let closed!: () => void
    let bytes = 0
    const requestStarted = new Promise<void>(resolve => { started = resolve })
    const responseClosed = new Promise<void>(resolve => { closed = resolve })
    const base = await launch((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('x')
      const timer = setInterval(() => { bytes++; res.write('x') }, 5)
      res.on('close', () => { clearInterval(timer); closed() })
      started()
    })
    const pending = createSafeReader({ ...namedAllowed, timeoutMs: 120 }).read(namedUrl(base)).catch(error => error)
    await requestStarted
    expect((await pending).code).toBe('FETCH_TIMEOUT')
    await responseClosed
    expect(bytes).toBeGreaterThan(0)
  })
})
