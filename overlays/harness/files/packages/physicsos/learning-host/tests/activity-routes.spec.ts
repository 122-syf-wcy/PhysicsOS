import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { activityRoutes } from '../src/activity-routes.ts'
import type { IdentityActor } from '../src/identity.ts'
import { activityFixture, admin, alice, bob, capsule, clientEvent, other, root, rosterFixture } from './activity-fixture.ts'

const actors: Record<string, IdentityActor> = { alice, bob, admin, other, root }
async function httpFixture(options: { readonly readBarrier?: Promise<void>; readonly onRead?: () => void; readonly actor?: () => IdentityActor | null } = {}) {
  const f = await activityFixture({ ...(options.readBarrier === undefined ? {} : { roster: async () => { options.onRead?.(); await options.readBarrier; return rosterFixture() } }) })
  const handler = activityRoutes({ service: f.service, identity: () => ({ actorOf: req => options.actor === undefined ? actors[String(req.headers['x-test-account'])] ?? null : options.actor(), record: async () => {} }) })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => { resolve() })) })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { ...f, call: (path: string, account?: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(account === undefined ? {} : { cookie: `account=${account}`, 'x-test-account': account }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
}
describe('activity v1 actual HTTP authority', () => {
  it('refuses anonymous/teacher/student admin reads, cross-tenant school-admin queries and public effective use', async () => {
    const f = await httpFixture()
    expect((await f.call('/physicsos/admin/activity/v1/schools')).status).toBe(401)
    for (const account of ['alice', 'bob']) expect((await f.call('/physicsos/admin/activity/v1/schools', account)).status).toBe(403)
    expect((await f.call('/physicsos/admin/activity/v1/schools?schoolId=school-b', 'admin')).status).toBe(403)
    expect((await f.call('/physicsos/admin/activity/v1/users?schoolId=school-b&username=alice', 'admin')).status).toBe(403)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', { ...clientEvent('open', f.now), kind: 'use' })).status).toBe(400)
    expect((await f.call('/physicsos/activity/v1/success', 'alice', capsule('forged', f.now))).status).toBe(404)
  })
  it('does not elevate a bearer token, even alongside an unrelated cookie, to browser activity authority', async () => {
    const f = await httpFixture()
    expect((await f.call('/physicsos/activity/v1/events', 'alice', clientEvent('visit', f.now), { authorization: 'Bearer read-only-fixture' })).status).toBe(403)
    expect((await f.call('/physicsos/admin/activity/v1/schools', 'root', undefined, { authorization: 'Bearer read-only-fixture' })).status).toBe(403)
  })
  it('returns private authenticated capabilities without authorizing a public use endpoint', async () => {
    const f = await httpFixture()
    expect((await f.call('/physicsos/activity/v1/capabilities')).status).toBe(401)
    const response = await f.call('/physicsos/activity/v1/capabilities', 'alice')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ schemaVersion: 1, mode: 'enabled', collectionEnabled: true, queryCapacityVerified: true })
  })
  it('records visit/open only in the actual cookie account, never user/time fields or cross-origin mutations', async () => {
    const f = await httpFixture(), event = clientEvent('visit', f.now)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', event)).status).toBe(200)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', event)).status).toBe(200)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', { ...clientEvent('open', f.now), owner: { userKey: other.userKey } })).status).toBe(400)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', clientEvent('open', f.now), { origin: 'https://wrong.example' })).status).toBe(403)
    const own = await f.call('/physicsos/admin/activity/v1/users?schoolId=school-a&username=alice', 'admin')
    expect(await own.json()).toMatchObject({ schoolId: 'school-a', username: 'alice', visits: 1, uses: 0 })
    expect(own.headers.get('cache-control')).toBe('private, no-store')
    expect(await (await f.call('/physicsos/admin/activity/v1/users?schoolId=school-b&username=alice', 'root')).json()).toMatchObject({ visits: 0 })
  })
  it('rejects stale expected owners, repeated/unknown filters, request-byte excess and invalid dates', async () => {
    const f = await httpFixture()
    expect((await f.call('/physicsos/admin/activity/v1/schools', 'admin', undefined, { 'x-physicsos-activity-owner': encodeURIComponent(JSON.stringify({ schoolId: 'school-b', username: 'admin' })) })).status).toBe(401)
    for (const query of ['days=7&days=30', 'unknown=1', 'days=8', 'to=2026-02-30', 'page=-1']) expect((await f.call(`/physicsos/admin/activity/v1/schools?${query}`, 'root')).status).toBe(400)
    expect((await f.call('/physicsos/activity/v1/events', 'alice', { ...clientEvent('open', f.now), content: 'x'.repeat(4096) })).status).toBe(413)
  })
  it('rechecks identity AND role before exposing a response after a concurrent account or privilege switch', async () => {
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    let actor: IdentityActor = root
    const f = await httpFixture({ readBarrier: barrier, onRead: entered, actor: () => actor })
    onTestFinished(() => { release() })
    const response = f.call('/physicsos/admin/activity/v1/schools', 'root')
    await reading
    actor = { ...root, role: 'TEACHER' }; release()
    expect((await response).status).toBe(401)
  })
})
