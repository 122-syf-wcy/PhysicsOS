import { createServer, request as httpRequest } from 'node:http'
import { access } from 'node:fs/promises'
import { once } from 'node:events'
import { describe, expect, it, onTestFinished } from 'vitest'
import { coursewareRoutes } from '../src/courseware-routes.ts'
import type { IdentityActor, PhysicsosIdentity } from '../src/identity.ts'
import { coursewareFixture, cwForeign, cwStudent, cwTeacher, importBody } from './courseware-fixture.ts'
async function httpFixture(mode: 'bridge' | 'enabled' = 'enabled') {
  const f = await coursewareFixture({ teachingToolsMode: mode }); let actor: IdentityActor | undefined = cwTeacher
  const identity: PhysicsosIdentity = { actorOf: req => req.headers.cookie === 'cw-session=teacher' ? actor ?? null : req.headers.cookie === 'cw-session=student' ? cwStudent : req.headers.cookie === 'cw-session=foreign' ? cwForeign : null, record: async () => {} }
  const handler = coursewareRoutes({ service: f.service, identity: () => identity })
  const server = createServer((req, res) => { void handler(req, res) }); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test HTTP listener')
  const base = `http://127.0.0.1:${address.port}`
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  const owner = encodeURIComponent(JSON.stringify({ schoolId: cwTeacher.schoolId, username: cwTeacher.username }))
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/physicsos/courseware${path}`, { method, headers: { cookie: 'cw-session=teacher', 'x-physicsos-canvas-owner': owner, 'x-physicsos-courseware-capability': 'courseware-v1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { ...f, base, call, actor: (value: IdentityActor | undefined) => { actor = value } }
}
async function rawNavigation(url: string, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => { const copied: Record<string, string> = {}; for (const [key, value] of Object.entries(response.headers)) if (typeof value === 'string') copied[key] = value; resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: copied })) }); response.on('error', reject) }); req.on('error', reject); req.end()
  })
}
describe('courseware HTTP authority/CSRF/body/capability and opaque delivery', () => {
  it('returns structured 401/404/426 and refuses cross-origin, non-JSON and stale expected-owner writes', async () => {
    const f = await httpFixture()
    expect((await f.call('GET', '', undefined, { cookie: '' })).status).toBe(401)
    expect((await f.call('POST', '', importBody(), { authorization: 'Bearer read-only-fixture' })).status).toBe(403)
    expect((await f.call('GET', '/capabilities', undefined, { authorization: 'Bearer read-only-fixture' })).status).toBe(403)
    expect((await f.call('POST', '', importBody(), { 'x-physicsos-courseware-capability': '' })).status).toBe(426)
    expect((await f.call('POST', '', importBody(), { origin: 'https://outside.invalid' })).status).toBe(403)
    expect((await f.call('POST', '', importBody(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await f.call('POST', '', importBody(), { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await f.call('POST', '', importBody(), { 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify({ schoolId: cwTeacher.schoolId, username: 'other' })) })).status).toBe(401)
    expect((await f.call('GET', '/not/a/route')).status).toBe(404)
    expect((await f.call('GET', '?scope=mine&scope=all')).status).toBe(400)
    const good = await f.call('POST', '', importBody(), { origin: f.base })
    expect(good.status).toBe(200); expect(good.headers.get('cache-control')).toBe('private, no-store')
  })
  it('rejects a response when cookie authority changes during an admitted durable request', async () => {
    const f = await httpFixture()
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve })
    const original = f.service.import.bind(f.service)
    f.service.import = async (...args) => { const record = await original(...args); await barrier; return record }
    const waiting = f.call('POST', '', importBody())
    // Wait for the real metadata commit, not a guessed timer.
    for (let n = 0; n < 100 && f.service.domain.table('catalog').get('catalog') === undefined; n++) await new Promise(resolve => setTimeout(resolve, 5))
    f.actor({ ...cwTeacher, userKey: 'new-account', username: 'new-account' }); release()
    expect((await waiting).status).toBe(401)
  })
  it('issues authenticated tickets but serves only the exact HTML capability without exposing cookies or a general fetch RPC', async () => {
    const f = await httpFixture(); const imported = await (await f.call('POST', '', importBody())).json()
    const ticketResponse = await f.call('POST', `/${imported.deck.id}/tickets`, { versionId: imported.deck.activeVersionId })
    expect(ticketResponse.status).toBe(200); const ticket = await ticketResponse.json()
    const wrapper = await fetch(`${f.base}${ticket.wrapperUrl}`)
    expect(wrapper.status).toBe(200); const wrapperBody = await wrapper.text(); const token = ticket.wrapperUrl.split('/').at(-1)
    expect(wrapperBody).toContain('sandbox="allow-scripts"')
    expect(wrapper.headers.get('content-security-policy')).toContain(`frame-src ${f.base}/physicsos/courseware/content/${token}`)
    expect(wrapperBody).not.toContain('cw-session=teacher'); expect(wrapperBody).not.toContain('physicsos_session')
    const contentUrl = `${f.base}/physicsos/courseware/content/${token}?cwNonce=${ticket.nonce}&parentOrigin=${encodeURIComponent(f.base)}`
    const metadata = { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' }
    const content = await rawNavigation(contentUrl, metadata)
    expect(content.status).toBe(200)
    const csp = content.headers.get('content-security-policy')!
    expect(csp).toContain('sandbox allow-scripts'); expect(csp).not.toContain('allow-same-origin'); expect(csp).toContain("frame-src 'none'"); expect(csp).toContain("form-action 'none'"); expect(csp).toContain("connect-src 'none'")
    expect(content.headers.get('set-cookie')).toBeNull(); expect(content.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await fetch(`${f.base}/physicsos/courseware/content/${token}/other`)).status).toBe(401)
    expect((await rawNavigation(`${f.base}/physicsos/courseware/content/${'x'.repeat(43)}`, metadata)).status).toBe(401)
    for (const headers of [{}, { ...metadata, 'sec-fetch-dest': 'document' }, { ...metadata, 'sec-fetch-site': 'cross-site' }, { ...metadata, 'sec-fetch-mode': 'cors' }]) {
      const denied = await rawNavigation(contentUrl, headers)
      expect(denied.status).toBe(403); expect(denied.headers.get('content-type')).toContain('application/json'); expect(await denied.text()).not.toContain('<script>')
    }
    expect((await rawNavigation(`${f.base}/physicsos/courseware/content/${token}?cwNonce=wrong&parentOrigin=${encodeURIComponent(f.base)}`, metadata)).status).toBe(403)
  })
  it('uses measured full request bytes rather than a tiny declared size and never truncates imports', async () => {
    const f = await httpFixture()
    const tooLarge = { ...importBody(), htmlBase64: 'A'.repeat(f.service.maxRequestBytes + 1) }
    expect((await f.call('POST', '', tooLarge)).status).toBe(413)
    expect(f.service.domain.table('catalog').get('catalog')?.decks ?? {}).toEqual({})
  })
  it('keeps a new bridge root missing and readonly without blocking capabilities or creating any row', async () => {
    const f = await httpFixture('bridge')
    expect((await f.call('GET', '/capabilities')).status).toBe(200)
    expect(await (await f.call('GET', '/capabilities')).json()).toMatchObject({ writesEnabled: false, canImport: false })
    expect(await (await f.call('GET', '')).json()).toEqual({ items: [] })
    expect((await f.call('POST', '', importBody())).status).toBe(423)
    expect(f.service.domain.table('catalog').get('catalog')).toBeUndefined()
    await expect(access(f.service.config.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
