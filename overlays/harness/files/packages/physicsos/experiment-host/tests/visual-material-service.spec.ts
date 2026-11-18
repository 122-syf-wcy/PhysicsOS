import { chmod, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import {
  VisualMaterialError, type StoreGeneratedVisualMaterial, type VisualMaterialBlobStore,
  type VisualMaterialLimits,
} from '../src/visual-material-contracts.ts'
import { FileVisualMaterialBlobStore } from '../src/visual-material-blobs.ts'
import { DefaultVisualMaterialService } from '../src/visual-material-service.ts'
import { TestVisualMaterialRepository } from './visual-material-memory.spec.ts'

export function visualMaterialTestPng(width = 256, height = 256, shade = 0): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])))
    return Buffer.concat([length, tag, data, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const pixels = Buffer.alloc(height * (width * 4 + 1), shade)
  for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
export const visualMaterialTestActor = { userKey: 'owner-one', schoolId: 'school-one' }
export const visualMaterialTestInput = (operationId = 'generate-one'): StoreGeneratedVisualMaterial => ({
  operationId, bytes: visualMaterialTestPng(), mediaType: 'image/png', width: 256, height: 256,
  model: 'test-image-model', theme: '牛顿实验室 Newton Lab', purpose: 'appearance environment', kind: 'environment',
  tags: ['实验室', 'wood'], style: 'warm lab', prompt: 'raw private question: secret-account', sourceJobId: 'job-private',
  generationChannelId: 'private-channel', generationConfigRevision: 'private-config-revision',
  generationUsage: { inputTokens: 42, outputTokens: 100, totalTokens: 142, textInputTokens: 40, imageInputTokens: 2 },
})
const homes: string[] = []
export async function visualMaterialTestHome(): Promise<string> {
  const home = await mkdtemp(path.join(await realpath(tmpdir()), 'physicsos-vmat-')); homes.push(home); await chmod(home, 0o700); return home
}
async function fixture(limits: Partial<VisualMaterialLimits> = {}, blobTransform?: (blobs: FileVisualMaterialBlobStore) => VisualMaterialBlobStore) {
  const home = await visualMaterialTestHome(), repository = new TestVisualMaterialRepository(limits)
  const files = new FileVisualMaterialBlobStore({ dshHome: home, limits }), blobs = blobTransform?.(files) ?? files
  const clock = { at: 1000 }
  const service = new DefaultVisualMaterialService({ repository, blobs, limits, testOnly: true, now: () => clock.at })
  await service.initialize(); return { home, repository, files, service, clock }
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

it('retains validated originals privately with complete metadata and per-operation idempotence', async () => {
  const { service, repository } = await fixture(), input = visualMaterialTestInput()
  const material = await service.storeGenerated(visualMaterialTestActor, input)
  expect(material).toMatchObject({ revision: 2, width: 256, height: 256, kind: 'environment', theme: input.theme, purpose: input.purpose,
    tags: input.tags, model: input.model, lifecycle: 'ready', visibility: 'private', metadataTrust: 'untrusted' })
  expect(JSON.stringify(material)).not.toMatch(/raw private|secret-account|owner-one|school-one|job-private|operationId|private-channel|private-config-revision|generationUsage|inputTokens/)
  const privateRow = repository.rows.get(material.id)
  expect(privateRow).toMatchObject({ privatePrompt: input.prompt, sourceJobId: input.sourceJobId, ownerKey: visualMaterialTestActor.userKey,
    generationChannelId: input.generationChannelId, generationConfigRevision: input.generationConfigRevision, generationUsage: input.generationUsage })
  expect(await service.storeGenerated(visualMaterialTestActor, input)).toEqual(material)
  expect((await service.quota(visualMaterialTestActor)).account).toMatchObject({ bytes: input.bytes.byteLength, count: 1, operations: 1, activeCount: 0, stageBytes: 0 })
  const selected = await service.select(visualMaterialTestActor, material.id, material.sha256)
  expect(selected.bytes).toEqual(Buffer.from(input.bytes))
  selected.bytes[20] = 0
  expect((await service.readBytes(visualMaterialTestActor, material.id)).bytes).toEqual(Buffer.from(input.bytes))
  await expect(service.storeGenerated(visualMaterialTestActor, { ...input, theme: 'different' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
  await expect(service.storeGenerated(visualMaterialTestActor, { ...input, generationChannelId: 'other-channel' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
  await expect(service.storeGenerated(visualMaterialTestActor, { ...input, bytes: visualMaterialTestPng(256, 256, 4) })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
})

it('enforces personal/school/foreign boundaries without superadmin ownership bypass', async () => {
  const { service } = await fixture(), actor = visualMaterialTestActor
  const peer = { userKey: 'peer', schoolId: actor.schoolId, role: 'STUDENT' }, foreign = { userKey: 'foreign', schoolId: 'school-other', role: 'SUPER_ADMIN' }
  let material = await service.storeGenerated(actor, visualMaterialTestInput())
  expect((await service.search(peer)).items).toHaveLength(0)
  await expect(service.readBytes(peer, material.id, material.sha256)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(service.describe(foreign, material.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(service.manage(foreign, material.id, { expectedRevision: material.revision, operationId: 'steal', visibility: 'school' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  material = await service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'share', visibility: 'school' })
  expect((await service.search(peer, { query: '实验室' })).items[0]?.id).toBe(material.id)
  expect((await service.select(peer, material.id)).bytes).toEqual(visualMaterialTestPng())
  expect((await service.list(peer)).items).toHaveLength(0)
  await expect(service.select(foreign, material.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  material = await service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'unshare', visibility: 'private' })
  expect(material.visibility).toBe('private')
  await expect(service.select(peer, material.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'public', visibility: 'public' } as never)).rejects.toMatchObject({ code: 'INPUT_INVALID' })
})

it('owner sharing binds the authentic current school, not stale generation school or role claims', async () => {
  const { service } = await fixture(), actor = visualMaterialTestActor
  const material = await service.storeGenerated(actor, visualMaterialTestInput())
  const ownerMoved = { userKey: actor.userKey, schoolId: 'school-two' }
  await service.manage(ownerMoved, material.id, { operationId: 'share-current', expectedRevision: material.revision, visibility: 'school' })
  expect((await service.search({ userKey: 'old-peer', schoolId: actor.schoolId })).items).toHaveLength(0)
  expect((await service.search({ userKey: 'new-peer', schoolId: ownerMoved.schoolId })).items).toHaveLength(1)
})

it('relevance, exact dimension filters and cursor pages avoid duplicates/new entries/filter mixing', async () => {
  const { service, clock } = await fixture(), actor = visualMaterialTestActor
  const first = await service.storeGenerated(actor, visualMaterialTestInput('one'))
  clock.at++
  await service.storeGenerated(actor, { ...visualMaterialTestInput('two'), theme: 'other', tags: ['wood'] })
  clock.at++
  await service.storeGenerated(actor, { ...visualMaterialTestInput('three'), kind: 'material', style: 'cold', tags: ['wood'], theme: 'wood' })
  const result = await service.search(actor, { query: '实验室' })
  expect(result.items[0]?.id).toBe(first.id)
  expect(result.items[0]?.match.fields.tags).toBeGreaterThan(result.items[0]?.match.fields.theme ?? 0)
  expect((await service.search(actor, { theme: '牛顿实验室 NEWTON LAB', purpose: 'APPEARANCE ENVIRONMENT', style: 'WARM LAB', tags: ['WOOD'], kind: 'environment', minWidth: 256, minHeight: 256 })).items).toHaveLength(1)
  expect((await service.search(actor, { minWidth: 257 })).items).toHaveLength(0)
  const pageOne = await service.search(actor, { query: 'wood', limit: 1 })
  expect(pageOne.nextCursor).toBeDefined()
  clock.at++
  await service.storeGenerated(actor, visualMaterialTestInput('new-after-page'))
  const pageTwo = await service.search(actor, { query: 'wood', limit: 2, cursor: pageOne.nextCursor! })
  expect(pageTwo.items).toHaveLength(2)
  expect(new Set([...pageOne.items, ...pageTwo.items].map(item => item.id)).size).toBe(3)
  await expect(service.search(actor, { query: 'other', cursor: pageOne.nextCursor! })).rejects.toMatchObject({ code: 'CURSOR_INVALID' })
})

it('tombstones/revisions/idempotent management retain original bytes and never break artifact copies', async () => {
  const { service } = await fixture(), actor = visualMaterialTestActor, input = visualMaterialTestInput()
  let material = await service.storeGenerated(actor, input)
  const embeddedCopy = Buffer.from((await service.select(actor, material.id)).bytes)
  const update = { expectedRevision: material.revision, operationId: 'retag', updateTags: ['glass', '玻璃'] }
  material = await service.manage(actor, material.id, update)
  expect(await service.manage(actor, material.id, update)).toEqual(material)
  expect((await service.search(actor, { tags: ['glass'] })).items).toHaveLength(1)
  expect((await service.search(actor, { tags: ['wood'] })).items).toHaveLength(0)
  await expect(service.manage(actor, material.id, { ...update, operationId: 'stale' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  material = await service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'delete', softdelete: true })
  expect(material.lifecycle).toBe('deleted')
  expect((await service.search(actor)).items).toHaveLength(0)
  expect((await service.list(actor, { lifecycle: 'deleted' })).items[0]?.id).toBe(material.id)
  await expect(service.select(actor, material.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(await service.storeGenerated(actor, input)).toEqual(material)
  expect((await service.quota(actor)).account.count).toBe(1)
  expect(embeddedCopy).toEqual(visualMaterialTestPng())
  material = await service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'restore', restore: true })
  expect(material.lifecycle).toBe('ready')
  expect((await service.select(actor, material.id)).bytes).toEqual(embeddedCopy)
})

it('explicit byte/count/operation quotas never evict existing images, and owner accounting is separate', async () => {
  const imageSize = visualMaterialTestPng().length
  const { service } = await fixture({ maxAccountCount: 1, maxGlobalCount: 2, maxAccountBytes: imageSize, maxGlobalBytes: imageSize * 2 })
  const actor = visualMaterialTestActor, material = await service.storeGenerated(actor, visualMaterialTestInput())
  await expect(service.storeGenerated(actor, visualMaterialTestInput('over-count'))).rejects.toMatchObject({ code: 'RETENTION_QUOTA' })
  await service.manage(actor, material.id, { expectedRevision: material.revision, operationId: 'delete', softdelete: true })
  await expect(service.storeGenerated(actor, visualMaterialTestInput('after-delete'))).rejects.toMatchObject({ code: 'RETENTION_QUOTA' })
  const other = { userKey: 'other', schoolId: actor.schoolId }
  await service.storeGenerated(other, visualMaterialTestInput()) // same source op id is owner scoped
  await expect(service.storeGenerated({ userKey: 'third', schoolId: actor.schoolId }, visualMaterialTestInput())).rejects.toMatchObject({ code: 'RETENTION_QUOTA' })
  expect((await service.quota(actor)).global).toMatchObject({ count: 2, bytes: imageSize * 2 })
})

it('validates dimensions, digest binding and path/id representation before private reads', async () => {
  const { service } = await fixture(), actor = visualMaterialTestActor
  await expect(service.storeGenerated(actor, { ...visualMaterialTestInput(), width: 512 })).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS' })
  await expect(service.storeGenerated(actor, { ...visualMaterialTestInput(), bytes: Buffer.from('<svg/>') })).rejects.toMatchObject({ code: 'IMAGE_INVALID' })
  const material = await service.storeGenerated(actor, visualMaterialTestInput())
  await expect(service.readBytes(actor, material.id, 'f'.repeat(64))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(service.readBytes(actor, '../owners/a.png')).rejects.toMatchObject({ code: 'INPUT_INVALID' })
})

it('journals cancellation before results arrive and refuses canceled late results without ready metadata', async () => {
  const { service } = await fixture(), actor = visualMaterialTestActor
  await service.cancelGeneratedOperation(actor, 'pre-cancel')
  await expect(service.storeGenerated(actor, visualMaterialTestInput('pre-cancel'))).rejects.toMatchObject({ code: 'OPERATION_CANCELED' })
  const controller = new AbortController(); controller.abort()
  await expect(service.storeGenerated(actor, visualMaterialTestInput('signal-cancel'), controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELED' })
  await expect(service.storeGenerated(actor, visualMaterialTestInput('signal-cancel'))).rejects.toMatchObject({ code: 'OPERATION_CANCELED' })
  expect((await service.search(actor)).items).toHaveLength(0)
})

it('a canceled publication that already renamed remains private/unselectable and does not leak staging quota', async () => {
  const controller = new AbortController()
  const { service } = await fixture({}, files => ({
    initialize: () => files.initialize(), cursorKey: () => files.cursorKey(), read: (row, fence) => files.read(row, fence), recover: (row, budget, fence) => files.recover(row, budget, fence),
    publish: async (row, bytes, budget, fence) => { await files.publish(row, bytes, budget, fence); controller.abort(); fence() },
  }))
  const actor = visualMaterialTestActor
  await expect(service.storeGenerated(actor, visualMaterialTestInput(), controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELED' })
  const row = (await service.list(actor)).items[0]!
  expect(row.lifecycle).toBe('canceled')
  expect((await service.search(actor)).items).toHaveLength(0)
  await expect(service.readBytes(actor, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect((await service.quota(actor)).account).toMatchObject({ activeCount: 0, stageBytes: 0, count: 1 })
})

it('failed metadata commit retains durable bytes and restart recovery finishes exactly once', async () => {
  const { service, repository, files, clock } = await fixture(), actor = visualMaterialTestActor
  const original = repository.completePublication.bind(repository)
  const spy = vi.spyOn(repository, 'completePublication').mockRejectedValueOnce(new Error('simulated SQL commit failure'))
  await expect(service.storeGenerated(actor, visualMaterialTestInput())).rejects.toMatchObject({ code: 'RETENTION_PENDING', detail: { retryable: true } })
  expect((await service.search(actor)).items).toHaveLength(0)
  expect((await service.list(actor)).items[0]?.lifecycle).toBe('pending')
  spy.mockImplementation(original)
  const restarted = new DefaultVisualMaterialService({ repository, blobs: files, testOnly: true, now: () => clock.at })
  await restarted.initialize()
  expect(await restarted.recoverPending()).toMatchObject({ recovered: 1, pending: 0 })
  expect(await restarted.recoverPending()).toMatchObject({ recovered: 0, pending: 0 })
  expect((await restarted.search(actor)).items).toHaveLength(1)
  expect((await restarted.quota(actor)).account).toMatchObject({ count: 1, activeCount: 0, stageBytes: 0 })
})

it('failed blob publication leaves searchable management metadata and can retry identical bytes without quota duplication', async () => {
  const { service, repository } = await fixture({}, files => ({
    initialize: () => files.initialize(), cursorKey: () => files.cursorKey(), read: (row, fence) => files.read(row, fence), recover: (row, budget, fence) => files.recover(row, budget, fence),
    publish: vi.fn(files.publish.bind(files)).mockRejectedValueOnce(new VisualMaterialError(507, 'DISK_RESERVE', 'Disk reserve preserved.')),
  }))
  const actor = visualMaterialTestActor
  await expect(service.storeGenerated(actor, visualMaterialTestInput())).rejects.toMatchObject({ code: 'RETENTION_PENDING', status: 507 })
  const pending = (await service.list(actor)).items[0]!
  expect(pending.lifecycle).toBe('pending')
  expect(await service.recoverPending()).toMatchObject({ pending: 1, issues: [{ id: pending.id, code: 'BYTES_PENDING' }] })
  const item = await service.storeGenerated(actor, visualMaterialTestInput())
  expect(item.id).toBe(pending.id)
  expect(repository.rows.size).toBe(1)
  expect((await service.quota(actor)).account).toMatchObject({ count: 1, activeCount: 0, stageBytes: 0 })
})

it('refuses school reads revoked while disk I/O was in flight', async () => {
  let revoke: (() => Promise<void>) | undefined
  const { service } = await fixture({}, files => ({
    initialize: () => files.initialize(), cursorKey: () => files.cursorKey(), publish: (row, bytes, budget, fence) => files.publish(row, bytes, budget, fence),
    recover: (row, budget, fence) => files.recover(row, budget, fence),
    read: async (row, fence) => { const bytes = await files.read(row, fence); const action = revoke; revoke = undefined; await action?.(); return bytes },
  }))
  const actor = visualMaterialTestActor, peer = { userKey: 'peer', schoolId: actor.schoolId }
  let item = await service.storeGenerated(actor, visualMaterialTestInput())
  item = await service.manage(actor, item.id, { operationId: 'share', expectedRevision: item.revision, visibility: 'school' })
  revoke = async () => { await service.manage(actor, item.id, { operationId: 'revoke', expectedRevision: item.revision, visibility: 'private' }) }
  await expect(service.readBytes(peer, item.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('enforces local account/global concurrency without starting a second stage', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const reached = new Promise<void>(resolve => { started = resolve })
  const { service } = await fixture({ maxAccountConcurrent: 1 }, files => ({
    initialize: () => files.initialize(), cursorKey: () => files.cursorKey(), read: (row, fence) => files.read(row, fence), recover: (row, budget, fence) => files.recover(row, budget, fence),
    publish: async (row, bytes, budget, fence) => { started(); await waiting; await files.publish(row, bytes, budget, fence) },
  }))
  const first = service.storeGenerated(visualMaterialTestActor, visualMaterialTestInput('first'))
  await reached
  try { await expect(service.storeGenerated(visualMaterialTestActor, visualMaterialTestInput('second'))).rejects.toMatchObject({ code: 'CONCURRENCY_QUOTA' }) }
  finally { release() }
  await first
})

it('has no implicit test-memory production mode and preserves cursor signing key across filesystem restarts', async () => {
  const { repository, files, home } = await fixture()
  expect(() => new DefaultVisualMaterialService({ repository, blobs: files })).toThrow('PostgreSQL')
  const before = await files.cursorKey(), restarted = new FileVisualMaterialBlobStore({ dshHome: home })
  await restarted.initialize()
  expect(await restarted.cursorKey()).toEqual(before)
  expect((await stat(path.join(home, 'visual-materials', '_cursor-key'))).mode & 0o077).toBe(0)
})
