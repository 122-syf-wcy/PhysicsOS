/** Real DomainImpl + atomic JSON medium. Faults wrap backend writes, not fake KvTable methods. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage, { type KvUnit, type StorageBackend } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { defineDomain, domainTable, DomainFacility, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { activitySuccessCapsuleSchema, type ActivityReplaySource } from '../src/activity-contract.ts'
import { onTestFinished } from 'vitest'
import { openActivityDomain, type ActivityDomain } from '../src/activity-domain.ts'
import { ACTIVITY_AVATARS, ActivityService, type ActivityServiceOptions } from '../src/activity-service.ts'
import type { ActivityClientEvent, ActivityRoster } from '../src/activity-types.ts'
import type { ActivitySuccessCapsule } from '../src/activity-contract.ts'
import type { IdentityActor } from '../src/identity.ts'

export const alice: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:alice', username: 'alice', role: 'STUDENT' }
export const bob: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:bob', username: 'bob', role: 'TEACHER' }
export const other: IdentityActor = { schoolId: 'school-b', userKey: 'school-b:alice', username: 'alice', role: 'STUDENT' }
export const admin: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:admin', username: 'admin', role: 'SCHOOL_ADMIN' }
export const root: IdentityActor = { schoolId: 'PHYSICSOS-OPEN', userKey: 'PHYSICSOS-OPEN:root', username: 'root', role: 'SUPER_ADMIN' }
export const rosterFixture = (): ActivityRoster => ({
  version: 'roster-v1', schools: [{ id: 'school-a', name: '学校甲', status: 'active' }, { id: 'school-b', name: '学校乙', status: 'active' }],
  users: [alice, bob, other, admin, root].map((actor, index) => ({ schoolId: actor.schoolId, userKey: actor.userKey, username: actor.username, role: actor.role, status: 'active' as const, ...(ACTIVITY_AVATARS[index] === undefined ? {} : { avatarUrl: ACTIVITY_AVATARS[index]!.path }) })),
})
export const clientEvent = (kind: 'visit' | 'open', at: string, module: ActivityClientEvent['module'] = kind === 'visit' ? 'app' : 'lab'): ActivityClientEvent => {
  const id = `${Date.parse(at)}_${randomUUID()}`
  return { kind, id, pageInstanceId: id, module }
}
export const capsule = (id: string, at: string, owner: IdentityActor = alice, source: ActivitySuccessCapsule['source'] = 'canvas-edit'): ActivitySuccessCapsule => ({ version: 1, source, operationId: id, occurredAt: at, owner: { schoolId: owner.schoolId, userKey: owner.userKey } })
export interface ActivityWrite { readonly table: string; readonly key: string; readonly value: unknown }
export async function activityFixture(options: Partial<ActivityServiceOptions> = {}) {
  const businessSpec = defineDomain({ name: 'activity_test_business', version: 0, tables: { capsules: domainTable<string, ActivitySuccessCapsule>(activitySuccessCapsuleSchema) } })
  let business: Domain<typeof businessSpec> | undefined
  const directory = await mkdtemp(join(tmpdir(), 'physicsos-activity-v1-'))
  let clock = new Date('2026-11-16T00:00:00.000Z'), roster = rosterFixture()
  let ctx: Context | undefined, backend: JsonStorageBackend | undefined, domain: ActivityDomain | undefined, service: ActivityService | undefined, unit: KvUnit | undefined
  const faults: { before?: ((write: ActivityWrite) => void | Promise<void>) | undefined; after?: ((write: ActivityWrite) => void | Promise<void>) | undefined } = {}
  const alerts: string[] = []
  const open = async (next: Partial<ActivityServiceOptions> = {}) => {
    ctx = new Context(); await ctx.plugin(Storage)
    backend = new JsonStorageBackend(directory)
    const json = backend
    const wrapped: StorageBackend = { kv: { open: async descriptor => {
      const actual = await json.kv.open(descriptor)
      if (descriptor.name === 'physicsos_activity_v1') unit = actual
      return { loadAll: () => actual.loadAll(), putRecord: async (table, key, value) => {
        const write = { table, key, value }; await faults.before?.(write); await actual.putRecord(table, key, value); await faults.after?.(write)
      }, deleteRecord: (table, key) => actual.deleteRecord(table, key), setGlobal: value => actual.setGlobal(value), close: () => actual.close() }
    } }, close: () => json.close() }
    ctx.storage.backend.register('json', wrapped); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    domain = await openActivityDomain(ctx)
    business = await ctx.storageDomain.open(businessSpec)
    service = new ActivityService(domain, { mode: 'enabled', now: () => clock, roster: () => roster, queryCapacityVerified: true, onAlert: warning => { alerts.push(warning.code) }, ...options, ...next })
    await service.initialize()
  }
  const close = async () => { await service?.dispose(); await domain?.close(); await business?.close(); await backend?.close(); await ctx?.fiber.dispose(); service = undefined; domain = undefined; business = undefined; backend = undefined; ctx = undefined }
  onTestFinished(async () => { faults.before = undefined; faults.after = undefined; await close(); await rm(directory, { recursive: true, force: true }) })
  await open()
  return {
    get service() { if (service === undefined) throw new Error('Fixture not open'); return service },
    get domain() { if (domain === undefined) throw new Error('Fixture not open'); return domain },
    get unit() { if (unit === undefined) throw new Error('Fixture not open'); return unit },
    get now() { return clock.toISOString() }, get roster() { return roster },
    setNow: (value: string) => { clock = new Date(value) }, setRoster: (value: ActivityRoster) => { roster = value }, faults, alerts,
    persistBusiness: (value: ActivitySuccessCapsule) => {
      if (business === undefined) throw new Error('Business fixture not open')
      return business.table('capsules').put(JSON.stringify([value.owner.schoolId, value.owner.userKey, value.source, value.operationId]), value)
    },
    businessSource: (source: ActivitySuccessCapsule['source']): ActivityReplaySource => ({ source, read: async query => {
      if (business === undefined) throw new Error('Business fixture not open')
      query.signal.throwIfAborted()
      const rows = [...business.table('capsules').entries()].map(([key, value]) => ({ key: `${value.occurredAt}|${key}`, value })).filter(row => row.value.source === source && row.value.occurredAt >= query.from && row.value.occurredAt <= query.to && (query.cursor === undefined || row.key > query.cursor)).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      const page = rows.slice(0, query.limit)
      return { capsules: page.map(row => row.value), ...(rows.length <= query.limit ? {} : { nextCursor: page.at(-1)!.key }) }
    } }),
    restart: async (next: Partial<ActivityServiceOptions> = {}) => { await close(); await open(next) },
  }
}
