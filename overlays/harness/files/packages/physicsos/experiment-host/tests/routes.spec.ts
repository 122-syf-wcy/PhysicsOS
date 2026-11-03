import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { experimentRoutes, experimentAssets } from '../src/routes.ts'
import { admin, contributor, other, schoolAdmin, uploadBody, zip, files } from './fixtures.ts'
import { host } from './support.ts'
let loaded: Awaited<ReturnType<typeof host>> | undefined
let root: string
let server: ReturnType<typeof createServer> | undefined
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'experiment-routes-')); loaded = await host(root)
  let identityAvailable = true
  const actors = { contributor, other, schoolAdmin, admin }
  const identity = { actorOf: (req: { headers: Record<string, unknown> }) => actors[req.headers['x-test-account'] as keyof typeof actors] ?? null, record: async () => {} }
  const api = experimentRoutes({ service: loaded.service, identity: () => identityAvailable ? identity : undefined })
  const assets = experimentAssets({ service: loaded.service })
  server = createServer((req, res) => { void (req.url?.startsWith('/physicsos/experiment-assets') ? assets(req, res) : api(req, res)) })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`
  return { base, identityUnavailable: () => { identityAvailable = false }, call: (path: string, body?: unknown, actor = 'contributor', headers = {}) => fetch(`${base}/physicsos/experiments${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-test-account': actor, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
}
afterEach(async () => { if (server) await new Promise<void>(resolve => { server!.closeAllConnections(); server!.close(() => resolve()) }); server = undefined; await loaded?.close(); loaded = undefined; if (root) await rm(root, { recursive: true, force: true }) })

describe('experiment REST and credential-free asset boundary', () => {
  it('arms the identity gate, accepts upload and enforces SUPER_ADMIN review', async () => {
    const { call, identityUnavailable } = await setup()
    expect((await call('/convex-lens', undefined, 'anonymous')).status).toBe(401)
    const upload = await call('/convex-lens/packages', uploadBody())
    expect(upload.status).toBe(201)
    const { item } = await upload.json() as { item: { id: string; sha256: string } }
    expect((await call(`/packages/${item.id}/preview`, undefined, 'other')).status).toBe(403)
    expect((await call(`/packages/${item.id}/review`, { action: 'approve', expectedSha256: item.sha256 }, 'schoolAdmin')).status).toBe(403)
    expect((await call(`/packages/${item.id}/review`, { action: 'approve', expectedSha256: item.sha256 }, 'admin')).status).toBe(200)
    expect((await (await call('/convex-lens', undefined, 'other')).json()).active.id).toBe(item.id)
    identityUnavailable()
    const refused = await call('/convex-lens')
    expect(refused.status).toBe(503)
    expect(await refused.json()).toMatchObject({ error: { code: 'IDENTITY_UNAVAILABLE' } })
  })
  it('rejects cross-site and non-json requests before any upload and caps streamed JSON', async () => {
    const { base, call } = await setup()
    expect((await call('/convex-lens/packages', uploadBody(), 'contributor', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/convex-lens/packages', uploadBody(), 'contributor', { origin: base.replace('http:', 'https:') })).status).toBe(403)
    expect((await call('/convex-lens/packages', uploadBody(), 'contributor', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await call('/convex-lens/packages', uploadBody(), 'contributor', { 'content-type': 'text/plain' })).status).toBe(415)
    const large = await fetch(`${base}/physicsos/experiments/convex-lens/packages`, { method: 'POST', headers: { 'x-test-account': 'contributor', 'content-type': 'application/json' }, body: JSON.stringify({ zipBase64: 'A'.repeat(29 * 1024 * 1024) }) })
    expect(large.status).toBe(413)
    expect(loaded!.service.list(admin).items).toHaveLength(0)
  })
  it('protects direct HTML and module loads with mandatory sandbox, scoped CSP and no credentials', async () => {
    const { base, call } = await setup()
    const { item } = await (await call('/convex-lens/packages', uploadBody())).json()
    const { entryUrl } = await (await call(`/packages/${item.id}/preview`)).json()
    const response = await fetch(new URL(`${entryUrl}?hostOrigin=${encodeURIComponent(base)}&channel=handshake-test`, base))
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
    const module = await fetch(new URL('runtime/main.js', new URL(entryUrl, base)))
    expect(module.status).toBe(200)
    expect(module.headers.get('access-control-allow-origin')).toBe('*')
    expect(module.headers.get('cache-control')).toBe('no-store')
    expect((await fetch(new URL('../src/main.ts', new URL(entryUrl, base)))).status).toBe(404)
    const published = await (await call(`/packages/${item.id}/review`, { action: 'approve', expectedSha256: item.sha256 }, 'admin')).json()
    const publicHtml = await fetch(new URL(published.item.entryUrl, base))
    expect(publicHtml.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(publicHtml.headers.get('cache-control')).toContain('immutable')
  })
  it('permits only the exact frozen importmap as an inline script', async () => {
    const { base, call } = await setup()
    const map = '{"imports":{"three":"./runtime/protocol.js"}}'
    const archive = zip(Object.entries(files()).map(([name, data]) => ({ name, data: name === 'dist/index.html' ? `<script type="importmap">${map}</script>${data}` : data })))
    const { item } = await (await call('/convex-lens/packages', uploadBody(archive))).json()
    const { entryUrl } = await (await call(`/packages/${item.id}/preview`)).json()
    const response = await fetch(new URL(entryUrl, base))
    expect(response.status).toBe(200)
    const csp = response.headers.get('content-security-policy')!
    expect(csp.includes(`'sha256-${createHash('sha256').update(map).digest('base64')}'`)).toBe(true)
    expect(csp.split(';').find(part => part.trim().startsWith('script-src '))).not.toContain('unsafe-inline')
  })
  it('returns a sanitized 404 for unsupported paths and malformed JSON', async () => {
    const { base, call } = await setup()
    expect((await call('/packages/not-a-real-id/preview')).status).toBe(404)
    expect((await call('/convex-lens/extra')).status).toBe(404)
    const bad = await fetch(`${base}/physicsos/experiments/convex-lens/packages`, { method: 'POST', headers: { 'x-test-account': 'contributor', 'content-type': 'application/json' }, body: '{bad' })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe('BAD_REQUEST')
  })
})
