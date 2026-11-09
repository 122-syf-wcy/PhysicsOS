import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pickEngine, simulateScene } from '@physicsos/physics-runtime'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { createSceneObject } from '@physicsos/physics-workbench/codec'
import { createSnapshotObject } from '@physicsos/physics-workbench/data'
import { canonicalBytes } from '@physicsos/physics-workbench/json'
import type { CanvasCommitResponse, CanvasOpenResponse, CanvasVerificationReceipt } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, CanvasStoredValue, SceneObject, SnapshotObject } from '@physicsos/physics-workbench/types'
import {
  CANVAS_FIXTURE_TIMEOUT, CANVAS_TEST_ADMIN, loadCanvasFixture, responseJson,
  type CanvasAccount, type CanvasFixture,
} from './canvas-fixture.ts'

const prefix = '/physicsos/learning/canvases'
const capturedAt = '2026-11-09T00:00:00.000Z'
interface ReceiptItem {
  readonly receipt: CanvasVerificationReceipt
  readonly resultDigest?: string
}
interface ReceiptPage {
  readonly items: readonly ReceiptItem[]
  readonly nextCursor?: string
}
interface Capture {
  readonly id: string
  readonly scene: SceneObject
  readonly snapshot: SnapshotObject
  readonly digest: string
}
const digest = (value: CanvasStoredValue): string => createHash('sha256').update(canonicalBytes(value)).digest('hex')

/** Every captured result comes from the selected shipping engine and its accepted request. */
function realCapture(id: string, velocity = 2): Capture {
  const scene = createSceneObject(createMechanicsScene({ sceneId: `scene-${id}`, model: 'uniform_linear_motion', mass: 1,
    velocity: { x: velocity, y: 0, z: 0 }, endTime: 1, now: capturedAt }))
  const engine = pickEngine(scene.scene).entry
  if (engine === undefined) throw new Error('The real discovery fixture needs a supported mechanics engine.')
  const replay = simulateScene(scene.scene, engine, `simulation-${id}`, `trace-${id}`, { outputSampleRate: 7 })
  const state = replay.simulation.states.at(-1)
  if (state === undefined) throw new Error('The selected engine did not retain a real sampled state.')
  const time = canonicalValue(state.time)
  const snapshot = createSnapshotObject({ scene: scene.scene, sceneRef: { kind: 'scene', digest: digest(scene) },
    instanceId: `instance-${id}`, instanceEditRevision: 0, capturedAt, source: 'client-engine',
    engineInfo: { id: replay.simulation.metadata.engineId, version: replay.simulation.metadata.engineVersion },
    request: replay.request, result: replay.simulation, state,
    clock: { time, total: time, running: false, rate: 1 },
    cursor: { kind: 'time', time: quantity(time, 's', 'time') }, datasets: [] })
  return { id, scene, snapshot, digest: digest(snapshot) }
}

async function create(fixture: CanvasFixture, account: CanvasAccount, canvasId: string): Promise<void> {
  await responseJson<CanvasOpenResponse>(await fixture.call('POST', prefix, {
    id: canvasId, title: canvasId, mutationId: `create-${canvasId}`,
  }, account), 201)
}

/** Publish the full authorized immutable capture closure and reference it from a committed head. */
async function publish(fixture: CanvasFixture, account: CanvasAccount, canvasId: string, capture: Capture): Promise<void> {
  const opened = await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/${canvasId}`, undefined, account))
  for (const object of [capture.scene, capture.snapshot]) {
    expect((await fixture.raw('PUT', `${prefix}/${canvasId}/objects/${digest(object)}`, canonicalBytes(object), account)).status).toBe(200)
  }
  const manifest: CanvasManifest = { ...opened.manifest,
    snapshots: [...opened.manifest.snapshots, { id: `alias-${capture.id}`, title: capture.id,
      snapshot: { kind: 'snapshot', digest: capture.digest } }],
    nodes: [...opened.manifest.nodes, { id: `result-${capture.id}`, kind: 'result', snapshotAliasId: `alias-${capture.id}`,
      layout: { x: 0, y: opened.manifest.nodes.length * 360, width: 480, height: 320, zIndex: opened.manifest.nodes.length } }],
  }
  const manifestDigest = digest(manifest)
  expect((await fixture.raw('PUT', `${prefix}/${canvasId}/objects/${manifestDigest}`, canonicalBytes(manifest), account)).status).toBe(200)
  await responseJson<CanvasCommitResponse>(await fixture.call('POST', `${prefix}/${canvasId}/commit`, {
    expectedVersion: opened.head.version, expectedGeneration: opened.head.generation,
    manifestDigest, mutationId: `commit-${canvasId}-${capture.id}`,
  }, account))
}

async function verify(fixture: CanvasFixture, account: CanvasAccount, canvasId: string, capture: Capture, mutationId: string): Promise<ReceiptItem> {
  const response = await responseJson<ReceiptItem & { readonly replayed: boolean }>(await fixture.call('POST', `${prefix}/${canvasId}/verify`, {
    captureDigest: capture.digest, mutationId,
  }, account))
  expect(response.receipt).toMatchObject({ canvasId, captureDigest: capture.digest, sceneDigest: digest(capture.scene), status: 'verified' })
  expect(response.resultDigest).toBeTypeOf('string')
  return { receipt: response.receipt, ...(response.resultDigest === undefined ? {} : { resultDigest: response.resultDigest }) }
}

async function page(fixture: CanvasFixture, account: CanvasAccount | undefined, canvasId: string, captureDigest: string, limit = 1, cursor?: string): Promise<ReceiptPage> {
  const query = new URLSearchParams({ captureDigest, limit: String(limit), ...(cursor === undefined ? {} : { cursor }) })
  const response = await fixture.call('GET', `${prefix}/${canvasId}/verifications?${query}`, undefined, account)
  const result = await responseJson<ReceiptPage>(response)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  return result
}

describe('real Loader HTTP discovery of durable server verification receipts', { timeout: CANVAS_FIXTURE_TIMEOUT }, () => {
  it('paginates every actual replay receipt while filtering the selected canvas and capture', async test => {
    const fixture = await loadCanvasFixture({ test })
    const owner = await fixture.register('discovery_owner')
    const capture = realCapture('selected-capture')
    const otherCapture = realCapture('different-capture', 3)
    await create(fixture, owner, 'selected-board')
    await publish(fixture, owner, 'selected-board', capture)
    await publish(fixture, owner, 'selected-board', otherCapture)
    const expected: ReceiptItem[] = []
    for (const mutation of ['first-replay', 'second-replay', 'third-replay']) expected.push(await verify(fixture, owner, 'selected-board', capture, mutation))
    const excludedCapture = await verify(fixture, owner, 'selected-board', otherCapture, 'other-capture-replay')
    await create(fixture, owner, 'other-board')
    await publish(fixture, owner, 'other-board', capture)
    const excludedCanvas = await verify(fixture, owner, 'other-board', capture, 'other-board-replay')

    const discovered: ReceiptItem[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let turn = 0; turn < 4; turn += 1) {
      const response = await page(fixture, owner, 'selected-board', capture.digest, 1, cursor)
      expect(response.items).toHaveLength(1)
      discovered.push(...response.items)
      if (response.nextCursor === undefined) break
      expect(response.nextCursor).toBeTypeOf('string')
      expect(response.nextCursor.length).toBeGreaterThan(0)
      expect(cursors.has(response.nextCursor)).toBe(false)
      cursors.add(response.nextCursor)
      cursor = response.nextCursor
    }
    expect(discovered).toHaveLength(3)
    expect(new Set(discovered.map(item => item.receipt.id)).size).toBe(3)
    expect(discovered).toEqual(expect.arrayContaining(expected))
    expect(discovered.map(item => item.receipt.id)).not.toContain(excludedCapture.receipt.id)
    expect(discovered.map(item => item.receipt.id)).not.toContain(excludedCanvas.receipt.id)
    expect((await page(fixture, owner, 'selected-board', otherCapture.digest, 10)).items).toEqual([excludedCapture])
    expect((await page(fixture, owner, 'other-board', capture.digest, 10)).items).toEqual([excludedCanvas])
    expect((await page(fixture, owner, 'selected-board', 'f'.repeat(64), 10)).items).toEqual([])
    const firstPage = await page(fixture, owner, 'selected-board', capture.digest, 1)
    if (firstPage.nextCursor === undefined) throw new Error('Three durable receipts must expose another keyset page.')
    const differentCapture = new URLSearchParams({ captureDigest: otherCapture.digest, cursor: firstPage.nextCursor })
    expect((await fixture.call('GET', `${prefix}/selected-board/verifications?${differentCapture}`, undefined, owner)).status).toBe(400)
    const differentCanvas = new URLSearchParams({ captureDigest: capture.digest, cursor: firstPage.nextCursor })
    expect((await fixture.call('GET', `${prefix}/other-board/verifications?${differentCanvas}`, undefined, owner)).status).toBe(400)
    expect((await fixture.call('GET', `${prefix}/selected-board/verifications?captureDigest=${capture.digest}&cursor=invalid`, undefined, owner)).status).toBe(400)
    expect((await fixture.call('GET', `${prefix}/selected-board/verifications?captureDigest=${capture.digest}&limit=0`, undefined, owner)).status).toBe(400)
    expect((await fixture.call('GET', `${prefix}/selected-board/verifications?captureDigest=invalid`, undefined, owner)).status).toBe(400)
    expect((await fixture.call('GET', `${prefix}/selected-board/verifications`, undefined, owner)).status).toBe(400)
  })

  it('keeps identical canvas and capture addresses account-private and denies a school administrator', async test => {
    const fixture = await loadCanvasFixture({ test })
    const owner = await fixture.register('discovery_private_owner')
    const other = await fixture.register('discovery_private_other')
    const admin = await fixture.login(CANVAS_TEST_ADMIN)
    const capture = realCapture('same-immutable-capture')
    await create(fixture, owner, 'same-board')
    await publish(fixture, owner, 'same-board', capture)
    const ownerReceipt = await verify(fixture, owner, 'same-board', capture, 'owner-replay')
    const route = `${prefix}/same-board/verifications?captureDigest=${capture.digest}&limit=10`
    expect((await fixture.call('GET', route)).status).toBe(401)
    expect((await fixture.call('GET', route, undefined, other)).status).toBe(404)
    expect((await fixture.call('GET', route, undefined, admin)).status).toBe(404)

    await create(fixture, other, 'same-board')
    await publish(fixture, other, 'same-board', capture)
    const otherReceipt = await verify(fixture, other, 'same-board', capture, 'other-replay')
    expect((await page(fixture, owner, 'same-board', capture.digest, 10)).items).toEqual([ownerReceipt])
    expect((await page(fixture, other, 'same-board', capture.digest, 10)).items).toEqual([otherReceipt])
    expect((await fixture.call('GET', route, undefined, admin)).status).toBe(404)
  })

  it('discovers prior replay receipts after a new Loader and fresh login without knowing any receipt ID', async test => {
    const fixture = await loadCanvasFixture({ test })
    const owner = await fixture.register('discovery_restart_owner')
    const capture = realCapture('restart-capture')
    await create(fixture, owner, 'restart-board')
    await publish(fixture, owner, 'restart-board', capture)
    const first = await verify(fixture, owner, 'restart-board', capture, 'before-restart-first')
    const second = await verify(fixture, owner, 'restart-board', capture, 'before-restart-second')
    await fixture.restart()
    const freshLogin = await fixture.login(owner.user.username)
    const discovered = await page(fixture, freshLogin, 'restart-board', capture.digest, 10)
    expect(discovered.items).toHaveLength(2)
    expect(discovered.items).toEqual(expect.arrayContaining([first, second]))
    expect(discovered.nextCursor).toBeUndefined()
  })
})
