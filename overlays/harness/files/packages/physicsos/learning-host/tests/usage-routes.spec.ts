import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openUsageDomain } from '../src/usage-domain.ts'
import { UsageService } from '../src/usage-service.ts'
import { usageRoutes } from '../src/usage-routes.ts'
import type { IdentityActor } from '../src/identity.ts'
const actors: Record<string, IdentityActor> = {
  a: { userKey: 's:a', schoolId: 's', username: 'a', role: 'STUDENT' },
  b: { userKey: 's:b', schoolId: 's', username: 'b', role: 'STUDENT' },
  admin: { userKey: 's:admin', schoolId: 's', username: 'admin', role: 'SCHOOL_ADMIN' },
}
async function fixture() {
  const ctx = new Context(); await ctx.plugin(Storage)
  const path = await mkdtemp(join(tmpdir(), 'usage-http-')), backend = new JsonStorageBackend(path)
  ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  const service = new UsageService(await openUsageDomain(ctx))
  const handler = usageRoutes({ service, identity: () => ({ actorOf: req => actors[String(req.headers['x-test-account'])] ?? null, record: async () => {} }) })
  const server = createServer((req, res) => { void handler(req, res) }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => { await new Promise<void>(resolve => server.close(() => { resolve() })); await service.dispose(); await service.domain.close(); await backend.close(); await ctx.fiber.dispose(); await rm(path, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { service, call: (path: string, account?: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(account === undefined ? {} : { 'x-test-account': account }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
}
describe('actual usage HTTP authority', () => {
  it('persists one real event and reads it only in the cookie-authorized account', async () => {
    const f = await fixture()
    expect((await f.call('/physicsos/usage/events', 'a', { id: 'entry', kind: 'visit', surface: 'home' })).status).toBe(200)
    const own = await f.call('/physicsos/usage', 'a'), other = await f.call('/physicsos/usage', 'b')
    expect(own.status).toBe(200); expect(await own.json()).toMatchObject({ scope: 'account', visits: 1 })
    expect(await other.json()).toMatchObject({ visits: 0 }); expect(other.headers.get('cache-control')).toBe('private, no-store')
    expect((await f.call('/physicsos/admin/usage', 'a')).status).toBe(403)
    expect(await (await f.call('/physicsos/admin/usage', 'admin')).json()).toMatchObject({ scope: 'school', visits: 1 })
  })
  it('refuses guests, cross-origin writes and stale expected principals', async () => {
    const f = await fixture(), event = { id: 'entry', kind: 'visit', surface: 'home' }
    expect((await f.call('/physicsos/usage')).status).toBe(401)
    expect((await f.call('/physicsos/usage/events', 'a', event, { origin: 'https://other.example' })).status).toBe(403)
    expect((await f.call('/physicsos/usage', 'b', undefined, { 'x-physicsos-usage-owner': encodeURIComponent(JSON.stringify({ schoolId: 's', username: 'a' })) })).status).toBe(401)
    expect((await f.service.summary(actors.a!)).visits).toBe(0)
  })
})
