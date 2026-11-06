import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { InFlight, Semaphore, singleFlight } from '../src/concurrency.ts'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { QuestionCodeArtifactService } from '../src/question-code-service.ts'
import { host } from './support.ts'
import { PROMPT_SEED } from '../src/prompt-seed.ts'
import { contributor, other } from './fixtures.ts'

const tick = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

describe('concurrency primitives', () => {
  it('Semaphore bounds concurrent holders, serves waiters in order and survives throwing jobs', async () => {
    const gate = new Semaphore(2)
    const order: string[] = []
    let peak = 0
    const releases: (() => void)[] = []
    const job = (name: string, fail = false) => gate.run(async () => {
      peak = Math.max(peak, gate.held)
      order.push(`start ${name}`)
      await new Promise<void>((resolve) => { releases.push(resolve) })
      order.push(`end ${name}`)
      if (fail) throw new Error(name)
    })
    const a = job('a', true), b = job('b'), c = job('c'), d = job('d')
    await tick()
    expect(gate.held).toBe(2)
    expect(gate.queued).toBe(2)
    expect(order).toEqual(['start a', 'start b'])
    releases.shift()?.()
    await expect(a).rejects.toThrow('a')
    await tick()
    expect(order).toEqual(['start a', 'start b', 'end a', 'start c'])
    expect(gate.held).toBe(2)
    while (releases.length > 0) { releases.shift()?.(); await tick() }
    await Promise.all([b, c, d])
    expect(peak).toBe(2)
    expect(gate.held).toBe(0)
    expect(gate.queued).toBe(0)
    expect(() => new Semaphore(0)).toThrow(RangeError)
  })

  it('InFlight drains settled and rejected operations alike', async () => {
    const tracker = new InFlight()
    let release!: () => void
    const slow = tracker.track(new Promise<string>((resolve) => { release = () => { resolve('slow') } }))
    const failed = tracker.track(Promise.reject(new Error('failed')))
    await expect(failed).rejects.toThrow('failed')
    expect(tracker.size).toBe(1)
    let drained = false
    const drain = tracker.drain().then(() => { drained = true })
    await tick()
    expect(drained).toBe(false)
    release()
    await drain
    expect(await slow).toBe('slow')
    expect(tracker.size).toBe(0)
  })

  it('singleFlight coalesces concurrent work per key and frees the slot afterwards', async () => {
    const slots = new Map<string, Promise<number>>()
    let runs = 0
    const work = async (): Promise<number> => { const mine = ++runs; await tick(); return mine }
    const [first, second, otherKey] = await Promise.all([
      singleFlight(slots, 'k', work),
      singleFlight(slots, 'k', work),
      singleFlight(slots, 'j', work),
    ])
    expect(first).toBe(second)
    expect(runs).toBe(2)
    expect(otherKey).not.toBe(first)
    expect(slots.size).toBe(0)
    await expect(singleFlight(slots, 'k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(slots.size).toBe(0)
    expect(await singleFlight(slots, 'k', work)).toBe(3)
  })
})

describe('private artifact creation runs concurrently', () => {
  let root: string | undefined
  let loaded: Awaited<ReturnType<typeof host>> | undefined
  let domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> | undefined
  let codes: QuestionCodeArtifactService | undefined
  const owners: Record<string, string | undefined> = {
    'session-a': contributor.userKey,
    'session-b': other.userKey,
  }
  const identity = {
    actorOf: () => null,
    sessionOwnerKey: (id: string) => owners[id],
    record: async () => {},
  }
  afterEach(async () => {
    await codes?.close()
    await domain?.close()
    await loaded?.close()
    codes = undefined
    domain = undefined
    loaded = undefined
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })
  async function setup(validationParallelism: number) {
    root = await mkdtemp(join(tmpdir(), 'question-code-concurrency-'))
    loaded = await host(root)
    domain = await openQuestionCodeDomain(loaded.ctx)
    codes = new QuestionCodeArtifactService(domain, {
      root: join(root, 'private'),
      identity: () => identity,
      validationParallelism,
      prompts: { current: () => ({ ...PROMPT_SEED, id: 'published-style', version: '3.7.2', body: '风格', sha256: '1'.repeat(64), publishedAt: '2026-11-04T00:00:00Z' }) },
    })
    await codes.initialize()
    return codes
  }
  const renderer = (marker: string) => `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
  canvas.width = root.clientWidth; canvas.height = root.clientHeight;
  const ctx = canvas.getContext('2d'); // ${marker}
  ctx.beginPath(); ctx.moveTo(view.origin.x, view.origin.y);
  ctx.lineTo(view.origin.x + view.extent.width, view.origin.y); ctx.stroke();
  for (const item of view.opticalObjects ?? []) {
    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}`
  const create = (service: QuestionCodeArtifactService, session: string, marker: string, objectDistance = 62) =>
    service.create({
      ownerSessionId: session,
      childSessionId: `child-${marker}`,
      scene: createConvexLensScene({ sceneId: `scene-${marker}`, focalLength: 23, objectDistance, now: '2026-11-04T00:00:00.000Z' }),
      experimentId: 'convex-lens',
      source: { title: `题目 ${marker}`, summary: marker, rendererJs: renderer(marker), stylesheet: 'canvas { display: block; }' },
    })

  it('validates independent owners in parallel up to the configured limit and shares template blobs once', async () => {
    const service = await setup(2)
    let peakValidating = 0
    let peakInFlight = 0
    const sample = (): void => {
      const stats = service.stats()
      peakValidating = Math.max(peakValidating, stats.validating)
      peakInFlight = Math.max(peakInFlight, stats.inFlight)
    }
    const pending = Promise.all([
      create(service, 'session-a', 'alpha'),
      create(service, 'session-b', 'beta', 40),
      create(service, 'session-a', 'gamma', 50),
    ])
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    while (!settled) { sample(); await tick() }
    const refs = await pending
    expect(peakInFlight).toBe(3)
    // Validation ran in parallel (the old global chain would never exceed 1)
    // yet never beyond the configured limit.
    expect(peakValidating).toBe(2)
    expect(new Set(refs.map(ref => ref.artifactId)).size).toBe(3)
    expect(refs.map(ref => ref.ownerSessionId)).toEqual(['session-a', 'session-b', 'session-a'])
    // Shared template files landed exactly once; only per-artifact files differ
    // (renderer, scene, manifest-derived files), so the blob store holds far
    // fewer entries than 3 × files.
    const blobs = await readdir(join(root!, 'private', 'blobs'))
    const digests = new Set(refs.flatMap(ref => domain!.table('artifacts').get(ref.artifactId)!.files.map(file => file.sha256)))
    expect(blobs.length).toBe(digests.size)
    const perArtifactFiles = domain!.table('artifacts').get(refs[0].artifactId)!.files.length
    expect(blobs.length).toBeLessThan(perArtifactFiles * 2)
    expect(service.stats()).toEqual({ inFlight: 0, validating: 0, queued: 0 })
    for (const ref of refs) {
      const session = ref.ownerSessionId
      expect(service.describe(session, ref.artifactId, ref.sha256)).toEqual(ref)
    }
  })

  it('a refused create does not block or fail its concurrent neighbours, and close() drains them', async () => {
    const service = await setup(1)
    const refused = service.create({
      ownerSessionId: 'session-a',
      childSessionId: 'child-bad',
      scene: createConvexLensScene({ sceneId: 'scene-bad', focalLength: 23, objectDistance: 62, now: '2026-11-04T00:00:00.000Z' }),
      experimentId: 'convex-lens',
      source: { title: '坏代码', summary: 'x', rendererJs: 'export function renderFrame(snapshot) { return 1 }', stylesheet: '' },
    })
    const good = create(service, 'session-b', 'delta')
    const closing = service.close()
    await expect(refused).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    const ref = await good
    await closing
    expect(ref.ownerSessionId).toBe('session-b')
    expect(service.stats().inFlight).toBe(0)
  })

  it('concurrent creates of byte-identical content write each blob once', async () => {
    const service = await setup(4)
    const refs = await Promise.all([
      create(service, 'session-a', 'same'),
      create(service, 'session-a', 'same'),
      create(service, 'session-b', 'same'),
    ])
    const files = domain!.table('artifacts').get(refs[0].artifactId)!.files
    const blobs = await readdir(join(root!, 'private', 'blobs'))
    // Three artifacts, one distinct file set: the blob store holds exactly the
    // unique digests of that set, so coalesced writers never produced a
    // duplicate or a half-written file.
    expect(blobs.length).toBe(new Set(files.map(file => file.sha256)).size)
    expect(new Set(refs.map(ref => ref.artifactId)).size).toBe(3)
  })
})
