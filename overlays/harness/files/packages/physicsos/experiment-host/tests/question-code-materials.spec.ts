import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { QuestionCodeJobs } from '../src/question-code-jobs.ts'
import { QuestionCodeAssets } from '../src/question-code-assets.ts'
import { QuestionCodeArtifactService, questionSceneSha256 } from '../src/question-code-service.ts'
import type { VisualMaterialDescriptor, VisualMaterialSearchPage, VisualMaterialService, VerifiedVisualMaterialBytes } from '../src/visual-material-contracts.ts'
import { contributor } from './fixtures.ts'
import { host } from './support.ts'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })
const chunk = (name: string, body: Buffer): Buffer => {
  const tag = Buffer.from(name), head = Buffer.alloc(4), tail = Buffer.alloc(4)
  head.writeUInt32BE(body.length); tail.writeUInt32BE(crc32(Buffer.concat([tag, body])))
  return Buffer.concat([head, tag, body, tail])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.alloc(64 * (64 * 4 + 1)))), chunk('IEND', Buffer.alloc(0))])
const material: VisualMaterialDescriptor = {
  id: 'authorized-material', revision: 1, sha256: createHash('sha256').update(png).digest('hex'), byteLength: png.length,
  mediaType: 'image/png', width: 64, height: 64, kind: 'material', theme: '薄透镜器材', purpose: '实验器材外观',
  tags: ['玻璃'], model: 'private-image-model', lifecycle: 'ready', visibility: 'private', createdAt: 1, updatedAt: 1, metadataTrust: 'untrusted',
}
const page: VisualMaterialSearchPage = { items: [{ ...material, match: { score: 1, matchedTerms: ['薄透镜'], fields: { theme: 1, purpose: 0, tags: 0, style: 0, kind: 0 } } }] }
const bytes: VerifiedVisualMaterialBytes = { descriptor: material, bytes: png, mediaType: 'image/png' }
const native = `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const board = document.createElement('canvas'); root.replaceChildren(board);
  const ctx = board.getContext('2d');
  for (const item of view.opticalObjects || []) { ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill(); }
}`

async function setup(library?: Pick<VisualMaterialService, 'search' | 'select'>) {
  const root = await mkdtemp(join(tmpdir(), 'question-materials-'))
  disposals.push(() => rm(root, { recursive: true, force: true }))
  const loaded = await host(root)
  disposals.push(() => loaded.close())
  const domain = await openQuestionCodeDomain(loaded.ctx)
  disposals.push(() => domain.close())
  let actor = { userKey: contributor.userKey, schoolId: contributor.schoolId }
  const imageProvider = vi.fn(async () => ({ bytes: png, mediaType: 'image/png' as const, model: 'independent-image-model' }))
  const images = new QuestionCodeAssets({ imageProvider })
  const service = new QuestionCodeArtifactService(domain, {
    root: join(root, 'private'), imageAssets: images, allowNativeAssets: true, requireAssetJob: true,
    identity: () => ({ actorOf: () => contributor, record: async () => {}, sessionOwnerKey: () => actor.userKey }),
    materialActor: (_session, expected) => {
      if (expected !== actor.userKey) throw new Error('owner changed')
      return { ...actor }
    },
    ...(library === undefined ? {} : { visualMaterials: library }),
  })
  disposals.push(() => service.close())
  await service.initialize()
  const scene = createConvexLensScene({ sceneId: 'material-scene', focalLength: 23, objectDistance: 62, now: '2026-11-18T00:00:00.000Z' })
  const scope = { ownerSessionId: 'parent-session', generationId: 'material-job', scene }
  const jobs = new QuestionCodeJobs(domain)
  await jobs.submit({ id: scope.generationId, ownerSessionId: scope.ownerSessionId, ownerKey: actor.userKey,
    sceneId: scene.id, sceneRevision: scene.revision, sceneSha256: questionSceneSha256(scene) })
  await jobs.claim(scope.generationId)
  return { service, images, imageProvider, domain, scope, setActor: (next: typeof actor): void => { actor = next } }
}

it('searches through the indexed library with the real owner and returns only bounded reusable descriptors', async () => {
  const search = vi.fn<VisualMaterialService['search']>(async () => page)
  const select = vi.fn<VisualMaterialService['select']>(async () => bytes)
  const h = await setup({ search, select })
  const found = await h.service.searchMaterials({ ...h.scope, query: '薄透镜', kind: 'material', tags: ['玻璃'], signal: new AbortController().signal })
  expect(search).toHaveBeenCalledWith({ userKey: contributor.userKey, schoolId: contributor.schoolId },
    { query: '薄透镜', kind: 'material', tags: ['玻璃'], limit: 8 }, expect.any(AbortSignal))
  expect(found.items[0]).toMatchObject({ materialId: material.id, sha256: material.sha256, theme: material.theme })
  expect(JSON.stringify(found)).not.toMatch(/private-image-model|ownerKey|https:|prompt|channelId/)
  expect(h.imageProvider).not.toHaveBeenCalled()
})

it('copies verified library bytes into this job without calling the image provider', async () => {
  const select = vi.fn<VisualMaterialService['select']>(async () => bytes)
  const h = await setup({ search: async () => page, select })
  const used = await h.service.useMaterial({ ...h.scope, materialId: material.id, sha256: material.sha256, signal: new AbortController().signal })
  expect(select).toHaveBeenCalledWith({ userKey: contributor.userKey, schoolId: contributor.schoolId }, material.id, material.sha256, expect.any(AbortSignal))
  expect(used).toMatchObject({ sha256: material.sha256, materialId: material.id, width: 64, height: 64 })
  expect(used.path).toMatch(/^\.\/assets\/generated\/[a-f0-9]+\.png$/)
  expect(h.service.assetManifest(h.scope)).toEqual([used])
  expect(h.images.files({ ownerKey: contributor.userKey, ownerSessionId: h.scope.ownerSessionId, generationId: h.scope.generationId,
    sceneSha256: questionSceneSha256(h.scope.scene) }, `image.src = '${used.path}'`).get('dist/' + used.path.slice(2))).toEqual(png)
  expect(h.imageProvider).not.toHaveBeenCalled()
})

it('rejects a school change after asynchronous library IO before any image is staged', async () => {
  let finish!: (result: VerifiedVisualMaterialBytes) => void
  const waiting = new Promise<VerifiedVisualMaterialBytes>(resolve => { finish = resolve })
  // The select callback is the deterministic barrier; no sleep or timer places the race.
  let selected!: () => void
  const selecting = new Promise<void>(resolve => { selected = resolve })
  const h = await setup({ search: async () => page, select: async () => { selected(); return waiting } })
  const pending = h.service.useMaterial({ ...h.scope, materialId: material.id, sha256: material.sha256, signal: new AbortController().signal })
  await selecting
  h.setActor({ userKey: contributor.userKey, schoolId: contributor.schoolId + '-changed' })
  finish(bytes)
  await expect(pending).rejects.toMatchObject({ code: 'MATERIAL_IDENTITY_CHANGED' })
  expect(h.service.assetManifest(h.scope)).toEqual([])
})

it('rejects a superseded job before library IO or a new image request', async () => {
  const search = vi.fn<VisualMaterialService['search']>(async () => page)
  const h = await setup({ search, select: async () => bytes })
  await h.domain.table('jobs').update(h.scope.generationId, row => ({ ...row, status: 'superseded' }))
  await expect(h.service.searchMaterials({ ...h.scope, query: '薄透镜', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'STALE_GENERATION' })
  await expect(h.service.generateAsset({ ...h.scope, prompt: 'glass', kind: 'material', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'STALE_GENERATION' })
  expect(search).not.toHaveBeenCalled()
  expect(h.imageProvider).not.toHaveBeenCalled()
})

it('rejects malformed material metadata before spending the image budget', async () => {
  const h = await setup()
  await expect(h.service.generateAsset({ ...h.scope, prompt: 'glass', kind: 'material', theme: 'x'.repeat(121), signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID' })
  expect(h.imageProvider).not.toHaveBeenCalled()
})

it('creates strictly native code without an image call, but does not claim isolated acceptance', async () => {
  const h = await setup()
  const result = await h.service.create({ ...h.scope, childSessionId: 'child', experimentId: 'convex-lens',
    source: { title: '原生光学', summary: '只读真实引擎几何', rendererJs: native, stylesheet: '' } })
  expect(result).toMatchObject({ status: 'ready', rendererKind: 'independent' })
  expect(h.imageProvider).not.toHaveBeenCalled()
  expect(h.domain.table('jobs').get(h.scope.generationId)?.validation).toBeUndefined()
})
