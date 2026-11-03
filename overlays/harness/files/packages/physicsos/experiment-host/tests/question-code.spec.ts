import { createServer } from 'node:http'
import { mkdtemp, rm, readdir, unlink, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { QuestionCodeArtifactService, questionSceneSha256 } from '../src/question-code-service.ts'
import { questionCodeRoutes } from '../src/question-code-routes.ts'
import { experimentAssets } from '../src/routes.ts'
import { host } from './support.ts'
import { PROMPT_SEED } from '../src/prompt-seed.ts'
import { admin, contributor, other } from './fixtures.ts'
let root: string
let loaded: Awaited<ReturnType<typeof host>> | undefined
let domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> | undefined
let codes: QuestionCodeArtifactService | undefined
let server: ReturnType<typeof createServer> | undefined
let owner: string | undefined
const identity = {
  actorOf: (req: { headers: Record<string, unknown> }) =>
    ({ contributor, other, admin })[req.headers['x-test-account'] as 'contributor'] ?? null,
  sessionOwnerKey: (id: string) => (id === 'parent-session' ? owner : undefined),
  record: async () => {},
}
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'question-code-'))
  loaded = await host(root)
  domain = await openQuestionCodeDomain(loaded.ctx)
  owner = contributor.userKey
  codes = new QuestionCodeArtifactService(domain, {
    root: join(root, 'private'),
    identity: () => identity,
    previewTtlMs: 1000,
    prompts: {
      current: () => ({
        ...PROMPT_SEED,
        id: 'published-style',
        version: '3.7.2',
        body: '已发布最新风格要求',
        sha256: '1'.repeat(64),
        publishedAt: '2026-11-04T00:00:00Z',
      }),
    },
  })
  await codes.initialize()
  return codes
}
const scene = () =>
  createConvexLensScene({
    sceneId: 'question-exact',
    focalLength: 23,
    objectDistance: 62,
    now: '2026-11-04T00:00:00.000Z',
  })
async function create(service: QuestionCodeArtifactService) {
  const context = await service.context('convex-lens')
  return service.create({
    ownerSessionId: 'parent-session',
    childSessionId: 'child-session',
    scene: scene(),
    experimentId: 'convex-lens',
    source: {
      title: '题目透镜',
      summary: '精确绘制题目快照',
      rendererJs: context.baseRenderer,
      stylesheet: context.baseStylesheet,
    },
  })
}
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server!.closeAllConnections()
      server!.close(() => { resolve() })
    })
  server = undefined
  await codes?.close()
  await domain?.close()
  await loaded?.close()
  codes = undefined
  domain = undefined
  loaded = undefined
  if (root) await rm(root, { recursive: true, force: true })
})
describe('private question code artifacts', () => {
  it('freezes exact question identity and creates no community release', async () => {
    const service = await setup(),
      before = loaded!.service.list(contributor, 'convex-lens')
    const ref = await create(service)
    const count = (await readdir(join(root, 'private', 'blobs'))).length
    await create(service)
    expect((await readdir(join(root, 'private', 'blobs'))).length).toBe(count)
    expect(ref).toMatchObject({
      status: 'ready',
      ownerSessionId: 'parent-session',
      sceneId: 'question-exact',
      sceneRevision: scene().revision,
      sceneSha256: questionSceneSha256(scene()),
      experimentId: 'convex-lens',
    })
    expect(ref).not.toHaveProperty('entryUrl')
    expect(loaded!.service.list(contributor, 'convex-lens')).toEqual(before)
    expect(service.describe('parent-session', ref.artifactId, ref.sha256)).toEqual(ref)
    expect(() => service.describe('other-session', ref.artifactId, ref.sha256)).toThrow()
    expect(() => service.describe('parent-session', ref.artifactId, '0'.repeat(64))).toThrow()
  })
  it('uses V3 style context, closed assets and published editable body', async () => {
    const service = await setup(),
      context = await service.context('convex-lens')
    expect(context.developerPrompt).toContain('schemaVersion')
    expect(context.developerPrompt).toContain('协议 3')
    expect(context.allowedAssetPaths).toContain('dist/runtime/protocol.js')
    expect(context.baseRenderer).toContain('renderFrame')
    expect(context.publishedBody).toBe('已发布最新风格要求')
    expect(context.styleVersion).toBe('3.7.2')
    expect(context.developerPrompt).not.toContain('physicsos-convex-lens-template-v2')
    expect(context.styleVersion).toBeTruthy()
  })
  it('fails closed for missing session owner, wrong domain, oversized or external source', async () => {
    const service = await setup(),
      context = await service.context('convex-lens')
    const input = {
      ownerSessionId: 'parent-session',
      childSessionId: 'child-session',
      scene: scene(),
      experimentId: 'convex-lens',
      source: {
        title: 'test',
        summary: '',
        rendererJs: context.baseRenderer,
        stylesheet: context.baseStylesheet,
      },
    }
    owner = undefined
    await expect(service.create(input)).rejects.toMatchObject({ code: 'SESSION_OWNER_UNAVAILABLE' })
    owner = contributor.userKey
    await expect(service.create({ ...input, experimentId: 'free-fall' })).rejects.toMatchObject({
      code: 'SCENE_PROFILE_MISMATCH',
    })
    await expect(
      service.create({ ...input, source: { ...input.source, rendererJs: 'x'.repeat(129 * 1024) } }),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
    await expect(
      service.create({
        ...input,
        source: { ...input.source, rendererJs: "import 'https://bad.example/code.js'" },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    await expect(
      service.create({ ...input, source: { ...input.source, rendererJs: 'export const =' } }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
  })
  it('reauthorizes owner cookie, refuses other accounts including admins, and signed assets expire', async () => {
    const service = await setup(),
      ref = await create(service)
    const api = questionCodeRoutes({ service, identity: () => identity }),
      assets = experimentAssets({ service: loaded!.service, questionCodes: service })
    server = createServer((req, res) => {
      void (req.url?.startsWith('/physicsos/experiment-assets') ? assets(req, res) : api(req, res))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      path = `/physicsos/question-code/artifacts/${ref.artifactId}/preview`
    expect((await fetch(base + path)).status).toBe(401)
    expect((await fetch(base + path, { headers: { 'x-test-account': 'other' } })).status).toBe(404)
    expect((await fetch(base + path, { headers: { 'x-test-account': 'admin' } })).status).toBe(404)
    const sourcePath = path.replace('/preview', '/source')
    expect(
      (await fetch(base + sourcePath, { headers: { 'x-test-account': 'other' } })).status,
    ).toBe(404)
    expect(
      (
        await fetch(base + sourcePath + '?sha256=' + '0'.repeat(64), {
          headers: { 'x-test-account': 'contributor' },
        })
      ).status,
    ).toBe(409)
    const sourceResponse = await fetch(base + sourcePath + '?sha256=' + ref.sha256, {
      headers: { 'x-test-account': 'contributor' },
    })
    expect(sourceResponse.status).toBe(200)
    expect(await sourceResponse.json()).toMatchObject({
      ref,
      source: { title: ref.title, summary: '精确绘制题目快照' },
    })
    const response = await fetch(base + path, { headers: { 'x-test-account': 'contributor' } })
    expect(response.status).toBe(200)
    const preview = (await response.json()) as { entryUrl: string; expiresAt: number }
    const embedded = await fetch(new URL(preview.entryUrl, base))
    expect(embedded.status).toBe(200)
    expect(embedded.headers.get('cache-control')).toBe('no-store')
    expect(embedded.headers.get('content-security-policy')).toContain(
      'sandbox allow-scripts allow-same-origin',
    )
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), base)
    expect((await fetch(raw)).status).toBe(403)
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(200)
    const bad = new URL(raw)
    bad.pathname = bad.pathname.replace(/question\/(.)/, 'question/x$1')
    expect((await fetch(bad)).status).toBe(404)
    owner = other.userKey
    expect(
      (await fetch(base + path, { headers: { 'x-test-account': 'contributor' } })).status,
    ).toBe(404)
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(404)
    owner = contributor.userKey
    await new Promise(resolve => setTimeout(resolve, 1050))
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(404)
  })
  it('keeps signed capabilities and immutable descriptors valid across restart', async () => {
    const service = await setup(),
      ref = await create(service),
      preview = service.preview(contributor, ref.artifactId)
    await service.close()
    await domain!.close()
    await loaded!.close()
    loaded = await host(root)
    domain = await openQuestionCodeDomain(loaded.ctx)
    codes = new QuestionCodeArtifactService(domain, {
      root: join(root, 'private'),
      identity: () => identity,
      previewTtlMs: 1000,
    })
    await codes.initialize()
    expect(codes.describe('parent-session', ref.artifactId, ref.sha256)).toEqual(ref)
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), 'http://local')
    expect((await codes.asset(raw))?.protocolVersion).toBe(3)
  })
  it('refuses modified blob content and symlink substitutions', async () => {
    const service = await setup(),
      ref = await create(service)
    const row = domain!.table('artifacts').get(ref.artifactId)!
    const renderer = row.files.find(file => file.name === 'src/renderer.js')!
    const css = row.files.find(file => file.name === 'public/assets/experiment.css')!
    await unlink(join(root, 'private', 'blobs', renderer.sha256))
    await symlink(
      join(root, 'private', 'blobs', css.sha256),
      join(root, 'private', 'blobs', renderer.sha256),
    )
    await expect(service.source(contributor, ref.artifactId)).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    })
    const mutated = { ...row, sceneSha256: '0'.repeat(64) }
    await domain!.table('artifacts').put(row.id, mutated)
    expect(() => service.preview(contributor, row.id)).toThrow()
  })
})
