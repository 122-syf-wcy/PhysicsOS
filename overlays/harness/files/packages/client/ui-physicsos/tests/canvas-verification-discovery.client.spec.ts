import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { it, expect } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { loadCanvasFixture } from '../../../physicsos/learning-host/tests/canvas-fixture.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')

it('recovers a durably accepted real Host verification in fresh IndexedDB after the original browser loses its response and closes', async test => {
  const fixture = await loadCanvasFixture({ test })
  const account = await fixture.register('canvas_discovery_browser')
  let dropResponse = true
  const api = createCanvasApi(async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, fixture.base)
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const response = typeof init?.body === 'string'
      ? await fixture.raw(method, `${url.pathname}${url.search}`, init.body, account, headers)
      : await fixture.call(method, `${url.pathname}${url.search}`, undefined, account, headers)
    if (method === 'POST' && url.pathname.endsWith('/verify') && dropResponse) {
      expect(response.status).toBe(200)
      await response.json()
      dropResponse = false
      throw new TypeError('Response dropped after real Host durable receipt publication.')
    }
    return response
  })
  const databases: string[] = []
  const browsers: ReturnType<typeof createCanvasController>[] = []
  test.onTestFinished(async () => {
    await Promise.all(browsers.map(browser => browser.dispose()))
    await Promise.all(databases.map(name => deleteDB(name)))
  })
  const browser = () => {
    const name = `canvas-real-host-receipt-${randomUUID()}`
    databases.push(name)
    let identity = 0
    const controller = createCanvasController({ api, persistence: createCanvasPersistence({ name, hash }),
      getAccount: () => ({ id: account.user.id, schoolId: account.user.schoolId, username: account.user.username }),
      createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
      hash, id: prefix => `${prefix}-${name}-${++identity}`, now: () => new Date().toISOString(), online: () => true,
      schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null })
    browsers.push(controller)
    return controller
  }
  const first = browser()
  const canvas = await first.create('Receipt survives a closed browser')
  const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
    velocity: { x: 2, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
  const captured = await first.capture(canvas, instance)
  const original = canonicalStringify(first.documentSource(canvas).getSnapshot().objects[captured.alias.snapshot.digest])
  await expect(first.verifySnapshot(canvas, captured.alias.id)).rejects.toThrow(/Response dropped after real Host/)
  await first.dispose()
  const fresh = browser()
  await fresh.open(canvas)
  const history = await fresh.verificationHistory(canvas, captured.alias.id)
  expect(history).toHaveLength(1)
  expect(history[0]?.receipt).toMatchObject({ canvasId: canvas, captureDigest: captured.alias.snapshot.digest, status: 'verified' })
  expect(history[0]?.resultDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(canonicalStringify(fresh.documentSource(canvas).getSnapshot().objects[captured.alias.snapshot.digest])).toBe(original)
}, 120_000)
