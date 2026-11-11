import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { QuestionCodeArtifactService, type QuestionCodeOptions } from '../src/question-code-service.ts'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { contributor, other } from './fixtures.ts'
import { host } from './support.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const env = { PHYSICSOS_IMAGE_API_KEY: 'test-secret-never-output', PHYSICSOS_IMAGE_API_BASE: 'https://images.example', PHYSICSOS_IMAGE_API_MODEL: 'test-image-model' }
const scope = () => ({ ownerSessionId: 'parent-session', generationId: 'job-1', scene: createConvexLensScene({ sceneId: 'question', focalLength: 23, objectDistance: 62, now: '2026-11-04T00:00:00.000Z' }) })
const request = () => ({ ...scope(), prompt: 'A realistic warm wooden laboratory surface, no text or measurements', kind: 'environment' as const })
const rendererJs = `export function renderFrame(snapshot) {
  const root = document.getElementById('canvas'), canvas = document.createElement('canvas'); root.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  for (const item of snapshot.view.opticalObjects) { ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, 6.28); ctx.fill(); }
}`
const imageResponse = () => Response.json({ data: [{ b64_json: png.toString('base64') }] })
const cleanups: (() => Promise<void>)[] = []
async function setup(fetchImpl: typeof fetch = async () => imageResponse(), imageEnv = env) {
  const root = await mkdtemp(join(tmpdir(), 'question-assets-'))
  const loaded = await host(root), domain = await openQuestionCodeDomain(loaded.ctx)
  let owner = contributor.userKey
  const options: QuestionCodeOptions = { root: join(root, 'private'), identity: () => ({ actorOf: () => contributor, record: async () => {}, sessionOwnerKey: id => id === 'parent-session' ? owner : id === 'other-session' ? other.userKey : undefined }), assetGeneration: { env: imageEnv, fetchImpl } }
  const service = new QuestionCodeArtifactService(domain, options)
  await service.initialize()
  cleanups.push(async () => { await service.close(); await domain.close(); await loaded.close(); await rm(root, { recursive: true, force: true }) })
  return { service, domain, root, options, changeOwner: () => { owner = other.userKey } }
}
afterEach(async () => { vi.useRealTimers(); for (const close of cleanups.splice(0).reverse()) await close() })
function createInput(stylesheet: string) { return { ...scope(), childSessionId: 'child-session', experimentId: 'convex-lens', source: { title: 'Original title', summary: 'Original summary', rendererJs, stylesheet } } }

describe('private runtime question images', () => {
  it('freezes actual owned PNG bytes, provenance and exact source, and serves them after service restart', async () => {
    const { service, domain, root, options } = await setup()
    const asset = await service.generateAsset(request())
    expect(asset).toMatchObject({ path: expect.stringMatching(/^\.\/assets\/generated\/[a-f0-9]{32}\.png$/), cssPath: expect.stringMatching(/^\.\/generated\/[a-f0-9]{32}\.png$/), sha256: createHash('sha256').update(png).digest('hex'), width: 1, height: 1, kind: 'environment', model: 'test-image-model' })
    expect(Object.keys(asset).sort()).toEqual(['cssPath', 'height', 'kind', 'model', 'path', 'sha256', 'width'])
    expect(service.assetManifest(scope())).toEqual([asset])
    const input = createInput(`#canvas { background-image: url('${asset.cssPath}'); }`)
    const ref = await service.create(input)
    expect((await service.source(contributor, ref.artifactId)).source).toEqual(input.source)
    const row = domain.table('artifacts').get(ref.artifactId)!
    for (const prefix of ['public', 'dist']) {
      const stored = row.files.find(file => file.name === `${prefix}/${asset.path.slice(2)}`)!
      expect(stored.sha256).toBe(asset.sha256)
      expect(await readFile(join(root, 'private', 'blobs', stored.sha256))).toEqual(png)
    }
    const licenseFile = row.files.find(file => file.name === 'ASSET-LICENSES.json')!
    const licenses = JSON.parse(await readFile(join(root, 'private', 'blobs', licenseFile.sha256), 'utf8')) as { path: string; notice?: string }[]
    const license = licenses.find(entry => entry.path === `dist/${asset.path.slice(2)}`)!
    expect(license.notice).toBeTruthy()
    const noticeFile = row.files.find(file => file.name === license.notice)!
    const notice = await readFile(join(root, 'private', 'blobs', noticeFile.sha256), 'utf8')
    expect(notice).toContain(request().prompt)
    expect(notice).toContain(asset.sha256)
    expect(notice).toContain(asset.model)
    expect(notice).not.toContain(env.PHYSICSOS_IMAGE_API_KEY)
    await service.close()
    const restarted = new QuestionCodeArtifactService(domain, options)
    await restarted.initialize()
    cleanups.push(() => restarted.close())
    const preview = restarted.preview(contributor, ref.artifactId)
    const url = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), 'https://physics.example')
    const served = await restarted.asset(new URL(asset.path, url))
    expect(served?.bytes).toEqual(png)
    expect(() => restarted.preview(other, ref.artifactId)).toThrow()
  })
  it('reuses images through source repair without another request, rejects unused or unknown generated assets', async () => {
    const { service } = await setup()
    const asset = await service.generateAsset(request())
    await expect(service.create(createInput(''))).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    const input = createInput(`#canvas{background:url('${asset.cssPath}')}`)
    await service.create(input)
    await service.create(input)
    expect(service.assetManifest(scope())).toEqual([asset])
    await expect(service.create(createInput("#canvas{background:url('./generated/00000000000000000000000000000000.png')}"))).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
  })
  it('rejects cross-owner, cross-job and changed-scene references, including a reclaimed owner', async () => {
    const { service, changeOwner } = await setup()
    const asset = await service.generateAsset(request())
    const input = createInput(`#canvas{background:url('${asset.cssPath}')}`)
    for (const changed of [{ generationId: 'job-2' }, { ownerSessionId: 'other-session' }, { scene: { ...scope().scene, revision: 2 } }]) {
      await expect(service.create({ ...input, ...changed })).rejects.toThrow()
      expect(() => service.assetManifest({ ...scope(), ...changed })).not.toThrow()
      expect(service.assetManifest({ ...scope(), ...changed })).toEqual([])
    }
    changeOwner()
    expect(service.assetManifest(scope())).toEqual([])
    await expect(service.create(input)).rejects.toThrow()
  })
  it('reserves a two-request job quota before awaiting and failures do not reset it', async () => {
    let calls = 0
    const { service } = await setup(async () => { calls++; return Response.json({ error: { message: env.PHYSICSOS_IMAGE_API_KEY } }, { status: 500 }) })
    const errors = await Promise.all([1, 2, 3].map(async () => { try { await service.generateAsset(request()) } catch (error) { return error } }))
    expect(calls).toBe(2)
    expect(errors[2]).toMatchObject({ code: 'ASSET_QUOTA_EXCEEDED' })
    expect(errors.map(String).join()).not.toContain(env.PHYSICSOS_IMAGE_API_KEY)
    expect(service.assetManifest(scope())).toEqual([])
  })
  it('cancels pending generation, leaves no usable asset and consumes the attempted request', async () => {
    let started!: () => void
    const beginning = new Promise<void>(resolve => { started = resolve })
    const { service } = await setup(async (_url, init) => { started(); return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('upstream secret detail')), { once: true }) }) })
    const controller = new AbortController()
    const running = service.generateAsset({ ...request(), signal: controller.signal })
    await beginning
    controller.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(service.assetManifest(scope())).toEqual([])
  })
  it.each([
    ['SVG payload', () => Response.json({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] })],
    ['malformed base64', () => Response.json({ data: [{ b64_json: 'not-a-valid+image!!!' }] })],
    ['truncated PNG', () => Response.json({ data: [{ b64_json: png.subarray(0, 24).toString('base64') }] })],
    ['oversized response', () => new Response('{}', { headers: { 'content-length': String(20 * 1024 * 1024) } })],
    ['loopback URL', () => Response.json({ data: [{ url: 'https://127.0.0.1/private' }] })],
    ['external URL', () => Response.json({ data: [{ url: 'https://other.example/image.png' }] })],
    ['credential URL', () => Response.json({ data: [{ url: 'https://user:pass@images.example/image.png' }] })],
  ])('rejects %s without publishing an asset', async (_name, response) => {
    let calls = 0
    const { service } = await setup(async () => { calls++; return response() })
    await expect(service.generateAsset(request())).rejects.toThrow()
    expect(calls).toBe(1)
    expect(service.assetManifest(scope())).toEqual([])
  })
  it('downloads only a same-origin HTTPS image without forwarding authorization or following redirects', async () => {
    let calls = 0
    const { service } = await setup(async (url, init) => {
      calls++
      if (calls === 1) {
        expect(String(url)).toBe('https://images.example/v1/images/generations')
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'test-image-model', n: 1 })
        return Response.json({ data: [{ b64_json: '', url: 'https://images.example/image.png' }] })
      }
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      expect(init?.redirect).toBe('error')
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    })
    expect((await service.generateAsset(request())).sha256).toBe(createHash('sha256').update(png).digest('hex'))
    expect(calls).toBe(2)
  })
  it('reads a trusted mounted key file and does not expose it through descriptors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'question-key-')), keyPath = join(directory, 'image-key')
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(keyPath, 'mounted-test-secret\n', { mode: 0o600 })
    const { service } = await setup(async (_url, init) => { expect(new Headers(init?.headers).get('authorization')).toBe('Bearer mounted-test-secret'); return imageResponse() }, { ...env, PHYSICSOS_IMAGE_API_KEY: '', PHYSICSOS_IMAGE_API_KEY_FILE: keyPath } as typeof env)
    const asset = await service.generateAsset(request())
    expect(JSON.stringify(asset)).not.toContain('mounted-test-secret')
    expect(JSON.stringify(asset)).not.toContain('images.example')
  })
})
