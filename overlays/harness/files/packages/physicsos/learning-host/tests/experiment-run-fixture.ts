/** Real DomainFacility + atomic JSON persistence. No production URL, environment fallback or simulated KvTable. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage, { type StorageBackend } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { onTestFinished } from 'vitest'
import { createExperimentCatalogService } from '../../experiment-host/src/catalog-service.ts'
import { openExperimentRunDomain, type ExperimentRunDomain } from '../src/experiment-run-domain.ts'
import { ExperimentRunService, type ExperimentRunServiceOptions } from '../src/experiment-run-service.ts'
import type { IdentityActor } from '../src/identity.ts'
import type { ExperimentRunPrepare } from '../src/experiment-run-types.ts'

export const runAlice: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:alice', username: 'alice', role: 'STUDENT' }
export const runBob: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:bob', username: 'bob', role: 'TEACHER' }
export const runForeign: IdentityActor = { schoolId: 'school-b', userKey: 'school-b:alice', username: 'alice', role: 'SCHOOL_ADMIN' }
export const runAdmin: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:admin', username: 'admin', role: 'SCHOOL_ADMIN' }
export const runBody = (service: ExperimentRunService, experimentId = 'incline', runId = randomUUID()): ExperimentRunPrepare => ({ runId, experimentId, expectedCapabilityGeneration: service.capabilityGeneration })
export interface RunWrite { readonly table: string; readonly key: string; readonly value: unknown }
export async function experimentRunFixture(input: ExperimentRunServiceOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'physicsos-experiment-run-'))
  const writes: RunWrite[] = [], units: string[] = [], issues: string[] = []
  const faults: { before?: ((write: RunWrite) => void | Promise<void>) | undefined; after?: ((write: RunWrite) => void | Promise<void>) | undefined } = {}
  let at = new Date('2026-11-17T02:00:00.000Z'), settings = input
  let ctx: Context | undefined, backend: JsonStorageBackend | undefined, domain: ExperimentRunDomain | undefined, service: ExperimentRunService | undefined
  const open = async (): Promise<void> => {
    ctx = new Context(); await ctx.plugin(Storage)
    backend = new JsonStorageBackend(directory)
    const json = backend
    const wrapper: StorageBackend = { kv: { open: async descriptor => {
      units.push(descriptor.name)
      const actual = await json.kv.open(descriptor)
      return { loadAll: () => actual.loadAll(), putRecord: async (table, key, value) => {
        const write = { table, key, value }; await faults.before?.(write); await actual.putRecord(table, key, value)
        writes.push(structuredClone(write)); await faults.after?.(write)
      }, deleteRecord: (table, key) => actual.deleteRecord(table, key), setGlobal: value => actual.setGlobal(value), close: () => actual.close() }
    } }, close: () => json.close() }
    ctx.storage.backend.register('json', wrapper); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    domain = await openExperimentRunDomain(ctx)
    const catalog = createExperimentCatalogService()
    service = new ExperimentRunService(domain, { mode: 'enabled', resolveExperiment: id => catalog.has(id), now: () => at, onIssue: code => { issues.push(code) }, ...settings })
    await service.initialize()
  }
  const close = async (): Promise<void> => {
    await service?.dispose(); await domain?.close(); await backend?.close(); await ctx?.fiber.dispose()
    service = undefined; domain = undefined; backend = undefined; ctx = undefined
  }
  onTestFinished(async () => { faults.before = undefined; faults.after = undefined; await close(); await rm(directory, { recursive: true, force: true }) })
  await open()
  return {
    get service() { if (service === undefined) throw new Error('Run fixture is closed'); return service },
    get domain() { if (domain === undefined) throw new Error('Run fixture is closed'); return domain },
    get now() { return at.toISOString() }, setNow: (value: string) => { at = new Date(value) },
    writes, units, issues, faults, close,
    restart: async (next?: ExperimentRunServiceOptions) => { await close(); if (next !== undefined) settings = next; await open() },
  }
}
