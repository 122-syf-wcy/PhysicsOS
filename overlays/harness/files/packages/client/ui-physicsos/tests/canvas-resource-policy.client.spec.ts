import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalStringify, WorkbenchDataError } from '@physicsos/physics-workbench/json'
import { loadCanvasFixture } from '../../../physicsos/learning-host/tests/canvas-fixture.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')

it('enforces the negotiated cumulative graph budget before durable writes and reuses it on offline reopen', async test => {
  const host = await loadCanvasFixture({ test, canvasLimits: { maxDocumentBytes: 65536, maxVerificationAttemptBytes: 65536, maxObjectBytes: 8192,
    maxRequestBytes: 16384, maxGraphJsonNodes: 200000, maxClosureObjects: 128 } })
  const account = await host.register('resource_policy_client')
  const name = `canvas-policy-${randomUUID()}`
  const controllers: ReturnType<typeof createCanvasController>[] = []
  test.onTestFinished(async () => { await Promise.all(controllers.map(controller => controller.dispose())); await deleteDB(name) })
  let network = true
  const api = createCanvasApi(async (input, init) => {
    if (!network) throw new Error('Offline reopen must use its cached negotiated policy.')
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, host.base)
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    return typeof init?.body === 'string' ? host.raw(method, `${url.pathname}${url.search}`, init.body, account, headers)
      : host.call(method, `${url.pathname}${url.search}`, undefined, account, headers)
  })
  let ids = 0
  const browser = () => {
    const persistence = createCanvasPersistence({ name, hash })
    const controller = createCanvasController({ api, persistence,
      getAccount: () => ({ id: account.user.id, schoolId: account.user.schoolId, username: account.user.username }),
      createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
      hash, id: prefix => `${prefix}-${++ids}`, online: () => network,
      schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null })
    controllers.push(controller)
    return { controller, persistence }
  }
  const { controller, persistence } = browser()
  const canvas = await controller.create('Many individually small objects')
  const namespace = controller.documentSource(canvas).getSnapshot().namespace!
  const initial = createMechanicsScene({ sceneId: 'shared-small-origin', model: 'uniform_linear_motion', mass: 1,
    velocity: { x: 1, y: 0, z: 0 }, endTime: 0.1, now: '2026-11-09T00:00:00.000Z' })
  const scene = { ...initial, metadata: { ...initial.metadata, resourceFixturePadding: 'x'.repeat(4096) } }
  let refused: unknown
  let storedBefore = await persistence.read(namespace, canvas)
  for (let index = 0; index < 20; index += 1) {
    storedBefore = await persistence.read(namespace, canvas)
    try { await controller.addExperiment(canvas, { scene, source: { kind: 'template', id: 'small-policy-motion' } }) }
    catch (error) { refused = error; break }
  }
  expect(refused).toBeInstanceOf(WorkbenchDataError)
  expect(refused).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: 'graph-quota' })]) })
  const after = await persistence.read(namespace, canvas)
  expect(after?.working).toEqual(storedBefore?.working)
  const exported = await controller.exportGraph(canvas)
  expect(exported.manifest.instances.length).toBeGreaterThan(1)
  expect(Buffer.byteLength(canonicalStringify(exported))).toBeLessThanOrEqual(65536)
  expect(Object.values(exported.objects).every(object => Buffer.byteLength(canonicalStringify(object)) < 8192)).toBe(true)
  await controller.dispose()
  network = false
  const offline = browser().controller
  const reopened = await offline.open(canvas)
  expect(reopened.manifest?.instances).toEqual(exported.manifest.instances)
  expect((await offline.exportGraph(canvas)).manifest.instances).toEqual(exported.manifest.instances)
}, 120_000)
