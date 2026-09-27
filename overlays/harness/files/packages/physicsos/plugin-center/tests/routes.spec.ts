import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  PINNED_HARNESS_VERSION,
  PluginCenter,
  type PluginCenterEntry,
  type PluginEnablementRecord,
  type PluginStateTable,
} from '../src/catalog.ts'
import { pluginCenterRoutes } from '../src/routes.ts'
import type { PhysicsosIdentity } from '../src/identity.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>(resolve => server.close(() => { resolve() }))))
})

const stateTable = (): PluginStateTable => {
  const records = new Map<string, PluginEnablementRecord>()
  return {
    get: id => records.get(id),
    entries: () => records.entries(),
    put: async (id, record) => {
      records.set(id, record)
    },
  }
}

const entry = (overrides: Partial<PluginCenterEntry> = {}): PluginCenterEntry => ({
  id: 'official.example',
  name: 'Example',
  version: PINNED_HARNESS_VERSION,
  source: 'official',
  compatibility: 'compatible',
  status: 'enabled',
  capabilities: ['storage.read'],
  publisher: 'DeepSeek',
  harnessRange: `=${PINNED_HARNESS_VERSION}`,
  integrity: 'verified',
  ...overrides,
})

const identity = (role: 'SCHOOL_ADMIN' | 'SUPER_ADMIN' | null): PhysicsosIdentity => ({
  actorOf: () => role === null
    ? null
    : {
      userKey: `PHYSICSOS-OPEN:${role}`,
      schoolId: 'PHYSICSOS-OPEN',
      username: role,
      role,
    },
  record: async () => {},
})

const mount = async (role: 'SCHOOL_ADMIN' | 'SUPER_ADMIN' | null, entries: PluginCenterEntry[]) => {
  const center = new PluginCenter({
    catalog: async () => entries,
    states: stateTable(),
    now: () => new Date('2026-09-27T00:00:00.000Z'),
  })
  const handler = pluginCenterRoutes({ center, identity: () => identity(role) })
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('plugin center routes', () => {
  it('serves the exact state contract to a super admin', async () => {
    const base = await mount('SUPER_ADMIN', [entry()])
    const response = await fetch(`${base}/physicsos/plugins/state`, {
      headers: { cookie: 'physicsos_session=test' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      pinnedHarnessVersion: PINNED_HARNESS_VERSION,
      entries: [entry()],
      updatedAt: '2026-09-27T00:00:00.000Z',
    })
  })

  it('refuses anonymous and non-super-admin callers', async () => {
    const anonymous = await mount(null, [entry()])
    expect((await fetch(`${anonymous}/physicsos/plugins/state`)).status).toBe(401)

    const schoolAdmin = await mount('SCHOOL_ADMIN', [entry()])
    expect((await fetch(`${schoolAdmin}/physicsos/plugins/state`, {
      headers: { cookie: 'physicsos_session=test' },
    })).status).toBe(403)
  })

  it('patches enablement and refuses an incompatible entry', async () => {
    const base = await mount('SUPER_ADMIN', [
      entry(),
      entry({
        id: 'official.old',
        name: 'Old',
        compatibility: 'incompatible',
        status: 'disabled',
        harnessRange: '^0.1.6',
      }),
    ])

    const disabled = await fetch(`${base}/physicsos/plugins/entries/official.example`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'physicsos_session=test' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({
      entry: { id: 'official.example', status: 'disabled' },
    })

    const refused = await fetch(`${base}/physicsos/plugins/entries/official.old`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'physicsos_session=test' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(refused.status).toBe(409)
  })
})
