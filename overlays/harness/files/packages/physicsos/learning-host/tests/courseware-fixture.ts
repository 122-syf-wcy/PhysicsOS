import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as storagePostgres from '../../../storage/storage-postgres/src/index.ts'
import { onTestFinished } from 'vitest'
import type { ActivitySink } from '../src/activity-contract.ts'
import { CoursewareBlobStore } from '../src/courseware-blob-store.ts'
import { resolveCoursewareConfig, type CoursewareConfigInput } from '../src/courseware-config.ts'
import { openCoursewareDomain } from '../src/courseware-domain.ts'
import { CoursewareService } from '../src/courseware-service.ts'
import type { IdentityActor } from '../src/identity.ts'
export const cwTeacher: IdentityActor = { schoolId: 'school-a', userKey: 'school-a:teacher', username: 'teacher', role: 'TEACHER' }
export const cwOtherTeacher: IdentityActor = { ...cwTeacher, userKey: 'school-a:other', username: 'other' }
export const cwStudent: IdentityActor = { ...cwTeacher, userKey: 'school-a:student', username: 'student', role: 'STUDENT' }
export const cwForeign: IdentityActor = { schoolId: 'school-b', userKey: 'school-b:teacher', username: 'teacher', role: 'TEACHER' }
export const cwAdmin: IdentityActor = { ...cwTeacher, userKey: 'school-a:admin', username: 'admin', role: 'SCHOOL_ADMIN' }
export const cwRoot: IdentityActor = { ...cwForeign, userKey: 'root', username: 'root', role: 'SUPER_ADMIN' }
export const simpleCourseware = (label = '课件'): Uint8Array => Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${label}</title><style>body{background:#fff;color:#243e34}button{padding:12px}</style></head><body><h1>${label}</h1><button id="reveal">揭示</button><p id="answer" hidden>频率决定音调</p><script>document.getElementById('reveal').addEventListener('click',()=>{document.getElementById('answer').hidden=false})</script></body></html>`)
export const importBody = (operationId = 'import_1', bytes = simpleCourseware()) => ({ title: '声音课件', description: '真实自包含HTML', operationId, htmlBase64: Buffer.from(bytes).toString('base64') })
export async function coursewareFixture(input: CoursewareConfigInput = {}, activitySink?: ActivitySink, postgres?: { readonly connectionString: string; readonly schema: string }) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-courseware-'))
  let ctx: Context; let backend: JsonStorageBackend; let service: CoursewareService; let disposal: Promise<void> | undefined
  let settings = input; let at = new Date('2026-11-17T02:00:00Z')
  const open = async (): Promise<void> => {
    disposal = undefined; ctx = new Context(); await ctx.plugin(Storage)
    backend = new JsonStorageBackend(join(root, 'domain')); ctx.storage.backend.register('json', backend)
    if (postgres) await ctx.plugin(storagePostgres, { ...postgres, maxConnections: 2, ssl: false })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: postgres ? 'postgres' : 'json' }))
    const config = resolveCoursewareConfig({ teachingToolsMode: 'enabled', ...settings, coursewareDshHome: root })
    service = new CoursewareService(await openCoursewareDomain(ctx), new CoursewareBlobStore(config.root), { config, now: () => at, ...(activitySink ? { activitySink } : {}) })
    await service.initialize()
  }
  const close = (): Promise<void> => disposal ??= (async () => { await service?.dispose(); await service?.domain.close(); await backend?.close(); await ctx?.fiber.dispose() })()
  onTestFinished(async () => { await close(); await rm(root, { recursive: true, force: true }) })
  await open()
  return { root, close, get ctx() { return ctx }, get service() { return service }, setTime(value: string) { at = new Date(value) }, restart: async (next?: CoursewareConfigInput) => { await close(); if (next) settings = next; await open() } }
}
