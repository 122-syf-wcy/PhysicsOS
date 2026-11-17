import { learningDomain, type LearningDomain } from '../src/domain.ts'
import { personalProductStateDomain, type PersonalProductStateDomain } from '../src/personal-product-state-domain.ts'
import { PersonalProductStateService, type PersonalWorkspaces } from '../src/personal-product-state-service.ts'
import { LearningService } from '../src/service.ts'
import type { IdentityActor } from '../src/identity.ts'

export const owner: IdentityActor = { userKey: 'GZU:alice', schoolId: 'GZU', username: 'alice', role: 'STUDENT' }
export const peer: IdentityActor = { userKey: 'GZU:bob', schoolId: 'GZU', username: 'bob', role: 'STUDENT' }
export const otherSchool: IdentityActor = { userKey: 'GZNU:alice', schoolId: 'GZNU', username: 'alice', role: 'TEACHER' }
export const admin: IdentityActor = { userKey: 'GZU:admin', schoolId: 'GZU', username: 'admin', role: 'SUPER_ADMIN' }
export const sceneEntry = (id = 'motion', revision = 0, at = '2026-11-17T01:00:00.000Z') => ({
  sceneId: id, title: `实验 ${id}`, domain: 'mechanics', kind: 'experiment' as const, updatedAt: at,
  scene: { schemaVersion: 'physics-scene/1.0' as const, id, revision, dimension: '2d' as const, metadata: { title: `实验 ${id}` } },
})
export function memoryDomain(spec: { tables: Record<string, { valueSchema: unknown }> }) {
  const createTable = (value: { valueSchema: unknown }) => {
    const rows = new Map<string, unknown>()
    const schema = value.valueSchema as { parse(value: unknown): unknown }
    return {
      rows, get: (key: string) => rows.get(key), entries: () => [...rows.entries()][Symbol.iterator](),
      get size() { return rows.size },
      put: async (key: string, value: unknown) => { rows.set(key, structuredClone(schema.parse(value))) },
      update: async (key: string, fn: (value: any) => unknown) => {
        if (!rows.has(key)) throw new Error('missing-key')
        const next = schema.parse(fn(rows.get(key)))
        rows.set(key, structuredClone(next)); return next
      },
      delete: async (key: string) => rows.delete(key),
    }
  }
  const tables = new Map<string, ReturnType<typeof createTable>>(Object.entries(spec.tables).map(([name, value]) => [name, createTable(value)]))
  return { tables, table: (name: string) => {
    const table = tables.get(name)
    if (table === undefined) throw new Error(`unknown table ${name}`)
    return table
  } }
}
export function personalFixture(options: { enabled?: boolean; maxRows?: number; maxRowsPerAccount?: number } = {}) {
  const learning = memoryDomain(learningDomain)
  const state = memoryDomain(personalProductStateDomain)
  const projects = new Map([
    ['momentum', { id: 'momentum', title: '动量', sessionIds: ['s1', 's2'] }],
    ['energy', { id: 'energy', title: '能量', sessionIds: ['s3'] }],
  ])
  const workspaces: PersonalWorkspaces = {
    get: (actor, id) => actor.userKey === owner.userKey && actor.schoolId === owner.schoolId ? projects.get(id) : undefined,
    list: actor => actor.userKey === owner.userKey && actor.schoolId === owner.schoolId ? [...projects.values()] : [],
    ownsSession: (actor, id) => actor.userKey === owner.userKey && actor.schoolId === owner.schoolId && ['s1', 's2', 's3'].includes(id),
    sessions: actor => actor.userKey === owner.userKey && actor.schoolId === owner.schoolId ? ['s1', 's2', 's3'] : [],
  }
  let enabled = options.enabled ?? true
  const make = () => {
    const personal = new PersonalProductStateService(state as unknown as PersonalProductStateDomain, {
      learning: learning as unknown as LearningDomain, workspaces: () => workspaces, writesEnabled: () => enabled,
      now: () => new Date('2026-11-17T02:00:00.000Z'),
      ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
      ...(options.maxRowsPerAccount === undefined ? {} : { maxRowsPerAccount: options.maxRowsPerAccount }),
    })
    return { personal, service: new LearningService(learning as unknown as LearningDomain, personal) }
  }
  return { learning, state, projects, workspaces, ...make(), restart: make, setEnabled: (value: boolean) => { enabled = value } }
}
