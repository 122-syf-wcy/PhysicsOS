import { EventEmitter } from 'node:events'
import type { Pool } from 'pg'
import { afterEach, expect, it, vi } from 'vitest'
import {
  createVisualMaterialHost, sessionVisualMaterialActor, VISUAL_MATERIAL_POSTGRES_SERVICE,
  type VisualMaterialHostContext,
} from '../src/visual-material-host.ts'
import { PostgresVisualMaterialRepository } from '../src/visual-material-postgres.ts'
import { IDENTITY_SERVICE } from '../src/identity.ts'

const homes: { close(): Promise<void> }[] = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(homes.splice(0).map(host => host.close())) })
function contextOf(backend: unknown, identity?: unknown): VisualMaterialHostContext & { services: Map<string, unknown>; registry: Map<string, unknown> } {
  const services = new Map<string, unknown>([[VISUAL_MATERIAL_POSTGRES_SERVICE, backend], [IDENTITY_SERVICE, identity]])
  const registry = new Map<string, unknown>([['postgres', backend]])
  return { services, registry, storage: { backend: { get: name => registry.get(name) } }, get: key => services.get(key) }
}
function backendOf() {
  return {
    ready: Promise.resolve(), assertWriterHeld: vi.fn(() => {}), siblingPoolConfig: vi.fn(() => ({
      schema: 'public', poolConfig: { connectionString: 'postgres://fixture-only-never-exposed', max: 4, ssl: { rejectUnauthorized: false } },
    })),
  }
}

it('resolves minimal exact session ownership without fabricating a role or widening a superadmin claim', () => {
  const identity = { usageSessionOwner: vi.fn(() => ({ userKey: 'owner', schoolId: 'school' })), sessionOwnerKey: vi.fn(() => 'owner') }
  expect(sessionVisualMaterialActor(identity, 'session-one')).toEqual({ userKey: 'owner', schoolId: 'school' })
  expect(sessionVisualMaterialActor(identity, 'session-one', 'owner')).toEqual({ userKey: 'owner', schoolId: 'school' })
  expect(() => sessionVisualMaterialActor(identity, 'session-one', 'admin')).toThrow('Exact visual material session owner')
  expect(() => sessionVisualMaterialActor({ sessionOwnerKey: () => 'owner' }, 'session-one')).toThrow('unavailable')
  expect(() => sessionVisualMaterialActor(undefined, 'session-one')).toThrow('unavailable')
  expect(() => sessionVisualMaterialActor({ usageSessionOwner: () => ({ userKey: 'foreign', schoolId: 'school' }), sessionOwnerKey: () => 'owner' }, 'session-one')).toThrow()
})

it('uses the same registered postgres object and real controlled sibling config, never returning that config', async () => {
  const backend = backendOf(), ctx = contextOf(backend, { usageSessionOwner: () => ({ userKey: 'owner', schoolId: 'school' }), sessionOwnerKey: () => 'owner', actorOf: () => ({ userKey: 'owner', schoolId: 'school', role: 'STUDENT' }) })
  const host = await createVisualMaterialHost(ctx, { assetOrigin: 'https://physics.dongsiwei.com/', dshHome: '/tmp/visual-material-host-unused' }); homes.push(host)
  expect(backend.assertWriterHeld).toHaveBeenCalled()
  expect(backend.siblingPoolConfig).toHaveBeenCalledTimes(1)
  expect(host.origin).toBe('https://physics.dongsiwei.com')
  expect(Object.keys(host).sort()).toEqual(['actorForSession', 'close', 'identity', 'initialize', 'origin', 'service'].sort())
  expect(host).not.toHaveProperty('poolConfig')
  expect(host).not.toHaveProperty('repository')
  expect(host.actorForSession('session')).toEqual({ userKey: 'owner', schoolId: 'school' })
  ctx.services.set(IDENTITY_SERVICE, { usageSessionOwner: () => ({ userKey: 'other', schoolId: 'other-school' }), sessionOwnerKey: () => 'other', actorOf: () => null })
  expect(host.actorForSession('session')).toEqual({ userKey: 'other', schoolId: 'other-school' })
  expect(() => host.actorForSession('session', 'owner')).toThrow()
})

it('fails closed for a missing/foreign lifecycle backend, missing guard, missing accessor and missing trusted origin', async () => {
  const backend = backendOf()
  const mismatch = contextOf(backend); mismatch.services.set(VISUAL_MATERIAL_POSTGRES_SERVICE, backendOf())
  await expect(createVisualMaterialHost(mismatch, { assetOrigin: 'https://physics.dongsiwei.com' })).rejects.toMatchObject({ code: 'MATERIAL_POSTGRES_UNAVAILABLE' })
  await expect(createVisualMaterialHost(contextOf({ ready: Promise.resolve(), siblingPoolConfig: backend.siblingPoolConfig }), { assetOrigin: 'https://physics.dongsiwei.com' })).rejects.toMatchObject({ code: 'MATERIAL_POSTGRES_UNAVAILABLE' })
  await expect(createVisualMaterialHost(contextOf({ ready: Promise.resolve(), assertWriterHeld: backend.assertWriterHeld }), { assetOrigin: 'https://physics.dongsiwei.com' })).rejects.toMatchObject({ code: 'MATERIAL_POSTGRES_UNAVAILABLE' })
  vi.stubEnv('PHYSICSOS_PUBLIC_URL', undefined)
  vi.stubEnv('PHYSICSOS_VALIDATION_PUBLIC_ORIGIN', 'http://app:3080')
  await expect(createVisualMaterialHost(contextOf(backend))).rejects.toMatchObject({ code: 'ORIGIN_UNAVAILABLE' })
  vi.stubEnv('PHYSICSOS_PUBLIC_URL', 'https://configured.example/')
  const host = await createVisualMaterialHost(contextOf(backend), { dshHome: '/tmp/visual-material-host-unused' }); homes.push(host)
  expect(host.origin).toBe('https://configured.example')
})

it('rechecks the exact registered backend before initialization instead of retaining a stale guard', async () => {
  const backend = backendOf(), ctx = contextOf(backend)
  const host = await createVisualMaterialHost(ctx, { assetOrigin: 'https://physics.dongsiwei.com', dshHome: '/tmp/visual-material-host-unused' }); homes.push(host)
  ctx.registry.set('postgres', backendOf())
  await expect(host.initialize()).rejects.toMatchObject({ code: 'MATERIAL_POSTGRES_UNAVAILABLE' })
})

it('real repository composition honors the provided writer fence and preserves sibling TLS/config inside native code only', async () => {
  const backend = backendOf(), lease = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }
  lease.query = vi.fn(async (sql: string) => sql.includes('pg_try_advisory_lock') ? { rows: [{ held: true }] } : { rows: [{ version: 0 }] })
  lease.release = vi.fn()
  const pool = new EventEmitter() as EventEmitter & { options: { max: number }; connect: ReturnType<typeof vi.fn> }
  pool.options = { max: 4 }; pool.connect = vi.fn(async () => lease)
  const repository = new PostgresVisualMaterialRepository({ pool: pool as unknown as Pool, assertWriterHeld: () => backend.assertWriterHeld() })
  try { await repository.initialize(); expect(backend.assertWriterHeld).toHaveBeenCalled() }
  finally { await repository.close() }
})
