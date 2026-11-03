import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { experimentRoutes, experimentAssets } from '../src/routes.ts'
import {
  admin,
  contributor,
  other,
  schoolAdmin,
  uploadBody,
  zip,
  files,
  jsonOf,
  type ItemEnvelope,
  type PreviewEnvelope,
  type ListEnvelope,
  type ErrorEnvelope,
} from './fixtures.ts'
import { host } from './support.ts'
let loaded: Awaited<ReturnType<typeof host>> | undefined
let root: string
let server: ReturnType<typeof createServer> | undefined
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'experiment-routes-'))
  loaded = await host(root)
  let identityAvailable = true
  const actors = { contributor, other, schoolAdmin, admin }
  const identity = {
    actorOf: (req: { headers: Record<string, unknown> }) =>
      actors[req.headers['x-test-account'] as keyof typeof actors] ?? null,
    record: async () => {},
  }
  const api = experimentRoutes({
    service: loaded.service,
    identity: () => (identityAvailable ? identity : undefined),
  })
  const assets = experimentAssets({ service: loaded.service })
  server = createServer((req, res) => {
    void (req.url?.startsWith('/physicsos/experiment-assets') ? assets(req, res) : api(req, res))
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port,
    base = `http://127.0.0.1:${port}`
  return {
    base,
    identityUnavailable: () => {
      identityAvailable = false
    },
    call: (path: string, body?: unknown, actor = 'contributor', headers = {}) =>
      fetch(`${base}/physicsos/experiments${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-test-account': actor, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  }
}
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server!.closeAllConnections()
      server!.close(() => {
        resolve()
      })
    })
  server = undefined
  await loaded?.close()
  loaded = undefined
  if (root) await rm(root, { recursive: true, force: true })
})

describe('experiment REST and credential-free asset boundary', () => {
  it('arms the identity gate, accepts upload and enforces SUPER_ADMIN review', async () => {
    const { call, identityUnavailable } = await setup()
    expect((await call('/convex-lens', undefined, 'anonymous')).status).toBe(401)
    const upload = await call('/convex-lens/packages', uploadBody())
    expect(upload.status).toBe(201)
    const { item } = await jsonOf<ItemEnvelope>(upload)
    expect((await call(`/packages/${item.id}/preview`, undefined, 'other')).status).toBe(403)
    expect(
      (
        await call(
          `/packages/${item.id}/review`,
          { action: 'approve', expectedSha256: item.sha256 },
          'schoolAdmin',
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          `/packages/${item.id}/review`,
          { action: 'approve', expectedSha256: item.sha256 },
          'admin',
        )
      ).status,
    ).toBe(200)
    expect(
      (await jsonOf<ListEnvelope>(await call('/convex-lens', undefined, 'other'))).active?.id,
    ).toBe(item.id)
    identityUnavailable()
    const refused = await call('/convex-lens')
    expect(refused.status).toBe(503)
    expect(await jsonOf<ErrorEnvelope>(refused)).toMatchObject({
      error: { code: 'IDENTITY_UNAVAILABLE' },
    })
  })
  it('rejects cross-site and non-json requests before any upload and caps streamed JSON', async () => {
    const { base, call } = await setup()
    expect(
      (
        await call('/convex-lens/packages', uploadBody(), 'contributor', {
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call('/convex-lens/packages', uploadBody(), 'contributor', {
          origin: base.replace('http:', 'https:'),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call('/convex-lens/packages', uploadBody(), 'contributor', {
          'sec-fetch-site': 'cross-site',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call('/convex-lens/packages', uploadBody(), 'contributor', {
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(415)
    const large = await fetch(`${base}/physicsos/experiments/convex-lens/packages`, {
      method: 'POST',
      headers: { 'x-test-account': 'contributor', 'content-type': 'application/json' },
      body: JSON.stringify({ zipBase64: 'A'.repeat(29 * 1024 * 1024) }),
    })
    expect(large.status).toBe(413)
    expect(loaded!.service.list(admin).items).toHaveLength(0)
  })
  it('protects direct HTML and module loads with mandatory sandbox, scoped CSP and no credentials', async () => {
    const { base, call } = await setup()
    const { item } = await jsonOf<ItemEnvelope>(await call('/convex-lens/packages', uploadBody()))
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    const response = await fetch(
      new URL(
        `${entryUrl.replace('/embed/', '/')}?hostOrigin=${encodeURIComponent(base)}&channel=handshake-test-channel-123`,
        base,
      ),
      { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } },
    )
    expect(response.status).toBe(200)
    const csp = response.headers.get('content-security-policy')!
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain(`script-src ${base}/physicsos/experiment-assets/preview/`)
    expect(csp).not.toContain("script-src 'self'")
    expect(csp).toContain("base-uri 'none'")
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const module = await fetch(
      new URL('runtime/main.js', new URL(entryUrl.replace('/embed/', '/'), base)),
    )
    expect(module.status).toBe(200)
    expect(module.headers.get('access-control-allow-origin')).toBe('*')
    expect(module.headers.get('cache-control')).toBe('no-store')
    expect((await fetch(new URL('../src/main.ts', new URL(entryUrl, base)))).status).toBe(404)
    const published = await jsonOf<ItemEnvelope>(
      await call(
        `/packages/${item.id}/review`,
        { action: 'approve', expectedSha256: item.sha256 },
        'admin',
      ),
    )
    const approvedEntry = published.item.entryUrl
    if (approvedEntry === undefined) throw new Error('Approved entry URL missing')
    const publicHtml = await fetch(new URL(approvedEntry, base))
    expect(publicHtml.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(publicHtml.headers.get('cache-control')).toContain('immutable')
  })
  it('downloads the exact frozen review ZIP only for its owner or SUPER_ADMIN, even after approval', async () => {
    const { base, call } = await setup()
    const bytes = zip(
      Object.entries({
        ...files(),
        'README.md': 'distinct source review notes',
      }).map(([name, data]) => ({ name, data })),
    )
    const { item } = await jsonOf<ItemEnvelope>(
      await call('/convex-lens/packages', uploadBody(bytes)),
    )
    for (const status of ['pending', 'approved']) {
      if (status === 'approved')
        await call(
          `/packages/${item.id}/review`,
          { action: 'approve', expectedSha256: item.sha256 },
          'admin',
        )
      expect((await call(`/packages/${item.id}/archive`, undefined, 'anonymous')).status).toBe(401)
      expect((await call(`/packages/${item.id}/archive`, undefined, 'other')).status).toBe(403)
      expect((await call(`/packages/${item.id}/archive`, undefined, 'schoolAdmin')).status).toBe(
        403,
      )
      for (const actor of ['contributor', 'admin']) {
        const response = await call(`/packages/${item.id}/archive`, undefined, actor)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/zip')
        expect(response.headers.get('content-disposition')).toBe(
          `attachment; filename="convex-lens-${item.id}.zip"`,
        )
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('access-control-allow-origin')).toBeNull()
        const downloaded = Buffer.from(await response.arrayBuffer())
        expect(downloaded.equals(bytes)).toBe(true)
        expect(createHash('sha256').update(downloaded).digest('hex')).toBe(item.sha256)
      }
    }
    expect(
      (
        await fetch(
          `${base}/physicsos/experiment-assets/releases/${item.id}/${item.sha256}/archive.zip`,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await fetch(
          `${base}/physicsos/experiment-assets/releases/${item.id}/${item.sha256}/README.md`,
        )
      ).status,
    ).toBe(404)
    await writeFile(join(root, 'files', item.id, 'archive.zip'), Buffer.from('tampered'))
    const corrupt = await call(`/packages/${item.id}/archive`, undefined, 'admin')
    expect(corrupt.status).toBe(409)
    expect((await jsonOf<ErrorEnvelope>(corrupt)).error.code).toBe('INTEGRITY_MISMATCH')
  })

  it('permits only the exact frozen importmap as an inline script', async () => {
    const { base, call } = await setup()
    const map = '{"imports":{"three":"./runtime/protocol.js"}}'
    const archive = zip(
      Object.entries(files()).map(([name, data]) => ({
        name,
        data: name === 'dist/index.html' ? `<script type="importmap">${map}</script>${data}` : data,
      })),
    )
    const { item } = await jsonOf<ItemEnvelope>(
      await call('/convex-lens/packages', uploadBody(archive)),
    )
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    const response = await fetch(new URL(entryUrl.replace('/embed/', '/'), base), {
      headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
    })
    expect(response.status).toBe(200)
    const csp = response.headers.get('content-security-policy')!
    expect(csp.includes(`'sha256-${createHash('sha256').update(map).digest('base64')}'`)).toBe(true)
    expect(csp.split(';').find(part => part.trim().startsWith('script-src '))).not.toContain(
      'unsafe-inline',
    )
  })
  it('returns trusted wrapper entry URLs and confines its frame-src to the exact raw entry', async () => {
    const { base, call } = await setup()
    const { item } = await jsonOf<ItemEnvelope>(await call('/convex-lens/packages', uploadBody()))
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    expect(entryUrl.startsWith('/physicsos/experiment-assets/embed/preview/')).toBe(true)
    const raw = new URL(entryUrl.replace('/embed/', '/'), base)
    const response = await fetch(new URL(entryUrl, base))
    expect(response.status).toBe(200)
    const csp = response.headers.get('content-security-policy')!
    expect(
      csp
        .split(';')
        .find(part => part.trim().startsWith('frame-src '))
        ?.trim() === `frame-src ${raw.origin}${raw.pathname}`,
    ).toBe(true)
    expect(csp.includes('sandbox allow-scripts allow-same-origin')).toBe(true)
    expect(csp.includes("script-src 'self'")).toBe(false)
    const html = await response.text()
    expect(html.includes('sandbox="allow-scripts"')).toBe(true)
    expect(html.includes('runtime/main.js')).toBe(false)
    const script = trustedScript(html)
    expect(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`)).toBe(
      true,
    )
    const approved = await jsonOf<ItemEnvelope>(
      await call(
        `/packages/${item.id}/review`,
        { action: 'approve', expectedSha256: item.sha256 },
        'admin',
      ),
    )
    expect(approved.item.entryUrl?.startsWith('/physicsos/experiment-assets/embed/releases/')).toBe(
      true,
    )
  })
  it('refuses executable raw HTML outside a same-origin iframe fetch', async () => {
    const { base, call } = await setup()
    const { item } = await jsonOf<ItemEnvelope>(await call('/convex-lens/packages', uploadBody()))
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    const raw = new URL(entryUrl.replace('/embed/', '/'), base)
    for (const headers of [
      {},
      { 'sec-fetch-dest': 'document' },
      { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await fetch(raw, { headers })
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')?.startsWith('application/json')).toBe(true)
      expect((await jsonOf<ErrorEnvelope>(response)).error.code).toBe('RAW_DOCUMENT_REFUSED')
    }
    const framed = await fetch(raw, {
      headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
    })
    expect(framed.status).toBe(200)
    expect(framed.headers.get('vary')).toContain('Sec-Fetch-Dest')
    expect(framed.headers.get('content-security-policy')?.includes('allow-same-origin')).toBe(false)
  })
  it('varies SVG image responses so cached images cannot bypass document refusal', async () => {
    const { base, call } = await setup()
    const { item } = await jsonOf<ItemEnvelope>(await call('/convex-lens/packages', uploadBody()))
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    const image = new URL('assets/icon.svg', new URL(entryUrl.replace('/embed/', '/'), base))
    const response = await fetch(image, {
      headers: { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'cross-site' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toContain('Sec-Fetch-Dest')
    expect((await fetch(image, { headers: { 'sec-fetch-dest': 'document' } })).status).toBe(403)
  })
  it('bridges one ready/connect exchange only for the exact inner and parent sources, origins and channel', async () => {
    const { base, call } = await setup()
    const { item } = await jsonOf<ItemEnvelope>(await call('/convex-lens/packages', uploadBody()))
    const { entryUrl } = await jsonOf<PreviewEnvelope>(await call(`/packages/${item.id}/preview`))
    expect(entryUrl.includes('/embed/')).toBe(true)
    const url = new URL(entryUrl, base),
      channel = 'wrapper-handshake-channel-1234',
      hostOrigin = 'https://physics.example'
    url.searchParams.set('channel', channel)
    url.searchParams.set('hostOrigin', hostOrigin)
    const script = trustedScript(await (await fetch(url)).text())
    const parentMessages: unknown[][] = [],
      innerMessages: unknown[][] = []
    const parent = { postMessage: (...args: unknown[]) => parentMessages.push(args) }
    const innerWindow = { postMessage: (...args: unknown[]) => innerMessages.push(args) }
    const inner = {
      dataset: { rawEntry: new URL(entryUrl.replace('/embed/', '/'), base).href },
      contentWindow: innerWindow,
      src: '',
    }
    let listener: ((event: Record<string, unknown>) => void) | undefined
    runInNewContext(script, {
      location: url,
      parent,
      URL,
      URLSearchParams,
      document: { getElementById: () => inner },
      addEventListener: (_name: string, callback: typeof listener) => {
        listener = callback
      },
      removeEventListener: () => {},
    })
    const raw = new URL(inner.src)
    expect(raw.searchParams.get('hostOrigin')).toBe(base)
    expect(raw.searchParams.get('channel')).toBe(channel)
    const ready = { type: 'experiment/ready', protocolVersion: 1, channel }
    for (const event of [
      { source: {}, origin: 'null', data: ready },
      { source: innerWindow, origin: base, data: ready },
      { source: innerWindow, origin: 'null', data: { ...ready, protocolVersion: 2 } },
      { source: innerWindow, origin: 'null', data: { ...ready, channel: 'wrong' } },
    ])
      listener!(event)
    expect(parentMessages).toEqual([])
    listener!({ source: innerWindow, origin: 'null', data: ready })
    listener!({ source: innerWindow, origin: 'null', data: ready })
    expect(parentMessages).toEqual([[ready, hostOrigin]])
    const connect = { type: 'experiment/connect', protocolVersion: 1, channel },
      port = { testPort: true }
    for (const event of [
      { source: {}, origin: hostOrigin, data: connect, ports: [port] },
      { source: parent, origin: 'https://other.example', data: connect, ports: [port] },
      { source: parent, origin: hostOrigin, data: { ...connect, channel: 'wrong' }, ports: [port] },
      { source: parent, origin: hostOrigin, data: connect, ports: [] },
    ])
      listener!(event)
    expect(innerMessages).toEqual([])
    listener!({ source: parent, origin: hostOrigin, data: connect, ports: [port] })
    listener!({ source: parent, origin: hostOrigin, data: connect, ports: [port] })
    expect(innerMessages).toEqual([[connect, '*', [port]]])
  })
  it('returns a sanitized 404 for unsupported paths and malformed JSON', async () => {
    const { base, call } = await setup()
    expect((await call('/packages/not-a-real-id/preview')).status).toBe(404)
    expect((await call('/convex-lens/extra')).status).toBe(404)
    const bad = await fetch(`${base}/physicsos/experiments/convex-lens/packages`, {
      method: 'POST',
      headers: { 'x-test-account': 'contributor', 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(bad.status).toBe(400)
    expect((await jsonOf<ErrorEnvelope>(bad)).error.code).toBe('BAD_REQUEST')
  })
})

function trustedScript(html: string): string {
  const root = parseFragment(html),
    nodes: DefaultTreeAdapterTypes.Node[] = [root]
  while (nodes.length) {
    const node = nodes.pop()!
    if ('tagName' in node && node.tagName === 'script')
      return node.childNodes
        .filter(child => child.nodeName === '#text')
        .map(child => ('value' in child ? child.value : ''))
        .join('')
    if ('childNodes' in node) nodes.push(...node.childNodes)
  }
  throw new Error('Trusted wrapper script missing')
}

describe('V2 intake diagnostics over REST', () => {
  it('returns safe actionable metadata issues and omits contributor input', async () => {
    const { call } = await setup()
    const entries = Object.entries(files()).map(([name, data]) => ({
      name,
      data: name === 'teaching.json' ? '{private-sensitive-value' : data,
    }))
    const response = await call('/convex-lens/packages', uploadBody(zip(entries)))
    expect(response.status).toBe(400)
    const value: unknown = await response.json()
    expect(value).toMatchObject({
      error: {
        code: 'INVALID_METADATA',
        issues: [
          {
            file: 'teaching.json',
            path: '$',
            message: expect.any(String) as unknown,
            suggestion: expect.any(String) as unknown,
          },
        ],
      },
    })
    expect(JSON.stringify(value)).not.toContain('private-sensitive-value')
  })
})
