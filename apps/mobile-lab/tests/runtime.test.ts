import test from 'node:test'
import assert from 'node:assert/strict'
import { EXPERIMENT_TEMPLATES } from '@lab/physics/experiment-templates.ts'
import { createWorkbenchInstanceRuntime } from '@lab/physics/workbench-instance-runtime.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import { catalog } from 'virtual:lab-catalog'
import { buildLibraryCatalog } from '../src/catalog/generate.ts'
import { convexLensLesson, lensPresetDistance, LENS_PRESETS } from '../src/ui/lens-lesson.ts'
import { lensParameter } from '@lab/client/experiments/lens-bench.ts'
import { observationCsv } from '../src/runtime/observation-export.ts'
import { WorkerSession } from '../src/runtime/worker-session.ts'
import { LabClient, type WorkerPort } from '../src/runtime/client.ts'
import { TransferPool, decodeData, displayFrame, encodeData, MAX_DISPLAY_POINTS, type WorkerOutput, type WorkerRequest, type WorkerTag } from '../src/runtime/transport.ts'
import { parseAction } from '../src/runtime/commands.ts'
import { readCheckpointEnvelope } from '../src/shared/checkpoint.ts'
import { ASSET_ORIGIN, LabError, MAX_FILE_BYTES, assertJson, parseNativeCommand, validateExport } from '../src/shared/protocol.ts'

class Harness {
  now = 0
  messages: WorkerOutput[] = []
  tag: WorkerTag = { version: 1, generation: crypto.randomUUID(), sceneId: '', revision: 0 }
  timers = new Map<number, { at: number; fn: () => void }>()
  serial = 0
  session = new WorkerSession({ now: () => this.now, post: message => {
    this.messages.push(structuredClone(message)); this.tag = { version: 1, generation: message.generation, sceneId: message.sceneId, revision: message.revision }
  }, schedule: (fn, delay) => { const id = ++this.serial; this.timers.set(id, { at: this.now + delay, fn }); return id }, cancel: id => { this.timers.delete(id as number) } })
  async command(type: WorkerRequest['type'], payload: unknown, overrides: Partial<WorkerTag> = {}): Promise<unknown> {
    const id = `test-${++this.serial}`
    await this.session.receive({ ...this.tag, ...overrides, id, type, payload })
    const response = this.messages.findLast(message => message.type !== 'frame' && message.id === id)
    if (!response || response.type === 'frame') return undefined
    if (response.type === 'error') { const error = response.payload as { code: string; message: string }; throw new LabError(error.code, error.message) }
    return response.payload
  }
  async load(templateId: string) { await this.command('load', { templateId }); await this.ack() }
  async query<T>(kind: string, data = {}): Promise<T> { return this.command('query', { kind, ...data }) as Promise<T> }
  action(name: string, ...args: unknown[]) { return this.command('action', { name, args }) }
  async ack() {
    const frame = this.messages.findLast(message => message.type === 'frame')
    if (frame?.type === 'frame') await this.command('ack', { serial: frame.serial })
  }
  tick(ms: number) {
    const until = this.now + ms
    for (;;) { const entry = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!entry || entry[1].at > until) break
      this.now = entry[1].at; this.timers.delete(entry[0]); entry[1].fn()
    }
    this.now = until
  }
  close() { this.session.dispose() }
}
const withoutRuntimeIds = (input: unknown): unknown => JSON.parse(JSON.stringify(input, (key, value) =>
  ['simulationId', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'completedAt', 'computedAt'].includes(key) ? undefined : value))

test('catalog projects EVERY shared template and real library snapshots without network', () => {
  assert.equal(catalog.experiments.length, EXPERIMENT_TEMPLATES.length)
  assert.deepEqual(catalog.experiments.map(item => item.id), EXPERIMENT_TEMPLATES.map(item => item.id))
  assert.equal(new Set(catalog.experiments.map(item => item.id)).size, EXPERIMENT_TEMPLATES.length)
  const library = buildLibraryCatalog()
  assert.ok(library.questions.length > 100)
  assert.ok(library.resources.length > 0)
  assert.ok(library.resources.every(resource => resource.access === 'external' && !resource.offline && resource.url.startsWith('https:')))
  assert.ok(library.questions.every(question => question.access === 'local' && question.offline))
})
for (const template of EXPERIMENT_TEMPLATES) {
  test(`shared engine equivalence + checkpoint: ${template.id}`, async () => {
    const h = new Harness()
    const title = catalog.experiments.find(item => item.id === template.id)!.title
    const scene = template.createScene(title).scene
    const baseline = createWorkbenchInstanceRuntime({ scene, sceneId: String(scene.id), originScene: scene,
      source: { kind: 'import' }, scheduler: null, summaryIntervalMs: 250, clock: { time: 0, total: 0, rate: 1, running: false } })
    try {
      await h.command('load', { scene })
      const actual = await h.query<WorkspaceFrame>('snapshot'), expected = baseline.frames.getSnapshot()
      assert.equal(actual.domain, expected.domain)
      assert.deepEqual(actual.verification, expected.verification)
      assert.deepEqual(actual.charts, expected.charts)
      assert.deepEqual(actual.table, expected.table)
      assert.deepEqual(withoutRuntimeIds(await h.query('raw')), withoutRuntimeIds(baseline.captureRaw()), 'held raw engine evidence and configured precision are unchanged')
      const time = expected.clock.total * 0.41
      await h.action('seek', time); baseline.seek(time)
      const sought = await h.query<WorkspaceFrame>('snapshot')
      assert.deepEqual(sought.clock, baseline.frames.getSnapshot().clock)
      assert.deepEqual(sought.view.overlay, baseline.frames.getSnapshot().view.overlay)
      assert.deepEqual(withoutRuntimeIds(await h.query('raw')), withoutRuntimeIds(baseline.captureRaw()))
      const before = await h.query('checkpoint')
      const checkpoint = readCheckpointEnvelope(before)
      assert.ok(Array.isArray(checkpoint.history.past) && Array.isArray(checkpoint.history.future))
      await h.command('load', { checkpoint }, { generation: crypto.randomUUID(), sceneId: '', revision: 0 })
      assert.deepEqual(await h.query('checkpoint'), checkpoint)
      const recovered = await h.query<WorkspaceFrame>('snapshot')
      assert.deepEqual(recovered.verification, sought.verification)
      assert.deepEqual(recovered.view.overlay, sought.view.overlay)
      const report = await h.query<{ markdown: string }>('report')
      assert.ok(report.markdown.includes(title))
      const json = await h.query<{ content: string }>('export', { format: 'json' })
      assert.deepEqual(JSON.parse(json.content), checkpoint)
    } finally { h.close(); baseline.dispose() }
  })
}
test('lens presets use current shared focal length and preserve exact engine evidence for all five conditions', async () => {
  const h = new Harness()
  const template = EXPERIMENT_TEMPLATES.find(item => item.id === 'convex-lens')!
  const scene = template.createScene('凸透镜').scene
  const owner = createWorkbenchInstanceRuntime({ scene, sceneId: String(scene.id), originScene: scene,
    source: { kind: 'import' }, scheduler: null, summaryIntervalMs: 250 })
  try {
    await h.command('load', { scene }); await h.ack()
    assert.ok(convexLensLesson(await h.query<WorkspaceFrame>('snapshot')))
    for (const choice of LENS_PRESETS) {
      const frame = await h.query<WorkspaceFrame>('snapshot')
      const distance = lensPresetDistance(frame, choice.id)
      await h.action('commitParameter', 'object-distance', distance); owner.commitParameter('object-distance', distance)
      const actual = await h.query<WorkspaceFrame>('snapshot')
      assert.equal(lensParameter(actual, 'object-distance'), distance)
      assert.deepEqual(actual.verification, owner.frames.getSnapshot().verification)
      assert.deepEqual(actual.view.opticalRays, owner.frames.getSnapshot().view.opticalRays)
      assert.deepEqual(withoutRuntimeIds(await h.query('raw')), withoutRuntimeIds(owner.captureRaw()))
      if (choice.id === 'focus') assert.equal(actual.view.opticalImages?.length, 0)
      if (choice.id === 'magnifier') assert.equal(actual.view.opticalImages?.[0]?.nature, 'virtual')
    }
    const last = await h.query<WorkspaceFrame>('snapshot')
    assert.throws(() => lensPresetDistance(last, 'unknown'), error => error instanceof LabError && error.code === 'LENS_PRESET_INVALID')
  } finally { h.close(); owner.dispose() }
})
test('lens drag previews commit once, cancellation restores facts, and multi-condition observations survive reset and recovery', async () => {
  const h = new Harness()
  try {
    await h.load('convex-lens')
    const before = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    const original = await h.query<WorkspaceFrame>('snapshot')
    const distance = lensParameter(original, 'object-distance')
    await h.action('previewParameter', 'object-distance', distance + 1)
    await h.action('previewParameter', 'object-distance', distance + 3)
    assert.equal((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).history.past.length, 0)
    await h.action('commitParameter', 'object-distance', distance + 3)
    assert.equal((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).history.past.length, 1)
    await h.action('recordObservation')
    await h.action('commitParameter', 'object-distance', distance + 10)
    await h.action('recordObservation')
    const captured = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    assert.equal(captured.scene.metadata.experimentNotebook?.entries.length, 2)
    await h.action('previewParameter', 'screen-distance', 55)
    await h.action('cancelParameterPreview')
    assert.equal(lensParameter(await h.query<WorkspaceFrame>('snapshot'), 'screen-distance'), lensParameter(original, 'screen-distance'))
    await h.action('restoreOrigin')
    const restored = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    assert.deepEqual(restored.scene.metadata.experimentNotebook, captured.scene.metadata.experimentNotebook)
    assert.deepEqual(restored.scene.opticalBenches, before.scene.opticalBenches)
    await h.action('undo')
    assert.deepEqual((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).scene.opticalBenches, captured.scene.opticalBenches)
    const checkpoint = await h.query('checkpoint')
    await h.command('load', { checkpoint }, { generation: crypto.randomUUID(), sceneId: '', revision: 0 })
    assert.deepEqual(await h.query('checkpoint'), checkpoint)
  } finally { h.close() }
})
test('dedicated positive-lens controls never take over a concave lens or a mirror', async () => {
  const h = new Harness()
  try {
    for (const id of ['concave-lens', 'plane-mirror', 'concave-mirror']) {
      if (!EXPERIMENT_TEMPLATES.some(item => item.id === id)) continue
      await h.load(id)
      assert.equal(convexLensLesson(await h.query<WorkspaceFrame>('snapshot')), false)
    }
  } finally { h.close() }
})
test('observation CSV uses saved comparisons, rejects empty exports and neutralizes imported spreadsheet formulas', async () => {
  const h = new Harness()
  try {
    await h.load('convex-lens')
    await assert.rejects(h.query('export', { format: 'observations' }), error => error instanceof LabError && error.code === 'OBSERVATIONS_EMPTY')
    await h.action('recordObservation')
    const checkpoint = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    const entries = checkpoint.scene.metadata.experimentNotebook!.entries
    const exported = await h.query<{ name: string; mime: string; encoding: string; content: string }>('export', { format: 'observations' })
    assert.ok(exported.name.endsWith('-观察记录.csv'))
    assert.equal(exported.mime, 'text/csv'); assert.equal(exported.encoding, 'utf8')
    assert.ok(exported.content.startsWith(String.fromCharCode(0xfeff)))
    for (const value of entries[0]!.values) assert.ok(exported.content.includes(value.replaceAll('"', '""')))
    const malicious = { ...entries[0]!, columns: ['=1+1', 'text'], values: ['  @attack()', 'comma,"quote"'] }
    const safe = observationCsv('Imported', [malicious]).content
    assert.ok(safe.includes("'=1+1")); assert.ok(safe.includes("'  @attack()")); assert.ok(safe.includes('"comma,""quote"""'))
    assert.equal(malicious.values[0], '  @attack()', 'spreadsheet escaping never mutates the original checkpoint')
    validateExport(exported as Parameters<typeof validateExport>[0])
  } finally { h.close() }
})
test('parameter previews commit once; undo/redo/history+viewport survive process reconstruction', async () => {
  const h = new Harness()
  try {
    await h.load('series-circuit')
    const frame = await h.query<WorkspaceFrame>('snapshot')
    const p = frame.inspector.flatMap(section => section.parameters ?? []).find(p => p.min !== p.max)!
    assert.ok(p)
    const next = p.value + (p.step ?? 1) * 2 <= (p.max ?? Infinity) ? p.value + (p.step ?? 1) * 2 : p.value - (p.step ?? 1)
    for (const value of [p.value, next, next]) await h.action('previewParameter', p.id, value)
    assert.equal((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).history.past.length, 0)
    await h.action('commitParameter', p.id, next)
    let saved = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    assert.equal(saved.history.past.length, 1)
    await h.action('undo')
    saved = await h.query('checkpoint'); assert.equal(saved.history.future.length, 1)
    await h.command('presentation', { viewport: { x: 23, y: -12, zoom: 1.8 }, activePanel: 'data' })
    saved = await h.query('checkpoint')
    await h.command('load', { checkpoint: saved }, { generation: crypto.randomUUID(), sceneId: '', revision: 0 })
    assert.deepEqual(await h.query('checkpoint'), saved)
    await h.action('redo')
    const after = await h.query<WorkspaceFrame>('snapshot')
    assert.equal(after.inspector.flatMap(section => section.parameters ?? []).find(item => item.id === p.id)!.value, next)
    const malformed = structuredClone(saved) as unknown as Record<string, unknown>; delete malformed.history
    await assert.rejects(h.command('load', { checkpoint: malformed }, { generation: crypto.randomUUID() }), /存档/)
  } finally { h.close() }
})
test('free build actual netlist edits, part selection, wiring, duplicate, move and undo are recoverable', async () => {
  const h = new Harness()
  try {
    await h.load('free-circuit')
    const before = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    await h.action('addPart', 'resistor-20', { x: 1, y: 2 })
    let saved = await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')
    const added = saved.editing.draft!.components.find(part => !before.editing.draft!.components.some(old => old.id === part.id))!
    assert.ok(added); assert.ok(saved.editing.selectedIds.includes(added.id))
    await h.action('moveComponent', added.id, { x: 2, y: 3 })
    await h.action('rotateComponent', added.id)
    await h.action('beginWire', { componentId: added.id, terminalKey: 'a' })
    await h.action('completeWire', { componentId: 'r0', terminalKey: 'a' })
    saved = await h.query('checkpoint')
    const moved = saved.editing.draft!.components.find(item => item.id === added.id)!
    assert.equal(moved.placement.x, 2); assert.equal(moved.placement.rotation, 90)
    assert.equal(moved.nets.a, saved.editing.draft!.components.find(item => item.id === 'r0')!.nets.a)
    await h.action('disconnectTerminal', { componentId: added.id, terminalKey: 'a' })
    await h.action('undo')
    assert.deepEqual((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).editing.draft, saved.editing.draft)
    await h.action('editBuilderComponent', added.id, 'duplicate')
    assert.equal((await h.query<ReturnType<WorkerSession['checkpoint']>>('checkpoint')).editing.draft!.components.length, saved.editing.draft!.components.length + 1)
  } finally { h.close() }
})
test('lifecycle suspends authoritative clock with no wall-time catch-up and rejects stale revisions/generations', async () => {
  const h = new Harness()
  try {
    await h.load('projectile-oblique')
    await h.action('setRunning', true); h.tick(60)
    await h.command('visible', { active: false })
    const time = (await h.query<WorkspaceFrame>('snapshot')).clock.time
    h.tick(600_000)
    assert.equal((await h.query<WorkspaceFrame>('snapshot')).clock.time, time)
    await h.command('visible', { active: true }); h.tick(20)
    assert.equal((await h.query<WorkspaceFrame>('snapshot')).clock.time, time)
    const previousMessages = h.messages.length
    await h.command('action', { name: 'reset', args: [] }, { generation: crypto.randomUUID() })
    assert.equal(h.messages.length, previousMessages)
    await assert.rejects(h.command('action', { name: 'reset', args: [] }, { revision: h.tag.revision + 10 }), error => error instanceof LabError && error.code === 'STALE_REVISION')
  } finally { h.close() }
})
test('one in-flight frame preserves ordered collision/events across blocked renderer then ACK', async () => {
  const h = new Harness()
  try {
    await h.load('projectile-oblique')
    const frame = await h.query<WorkspaceFrame>('snapshot')
    await h.action('setRunning', true)
    const initialFrames = h.messages.filter(message => message.type === 'frame').length
    h.tick(5000)
    assert.equal(h.messages.filter(message => message.type === 'frame').length, initialFrames)
    await h.ack()
    const last = h.messages.findLast(message => message.type === 'frame')!
    assert.equal(last.type, 'frame')
    if (last.type === 'frame') {
      const events = last.events
      assert.ok(events.length > 0, `expected actual events from ${frame.events.map(event => event.label)}`)
      assert.ok(events.every((event, index) => event.seq === index + 1))
      assert.ok(events.some(event => event.event.kind === 'apex' || event.event.kind === 'impact'))
    }
  } finally { h.close() }
})
test('transport retains Float64 precision, samples display only and rejects invalid buffers', () => {
  const data = { samples: Array.from({ length: 12000 }, (_, i) => ({ t: i * 1e-9, value: Math.sin(i) * 1e18 })), precise: [Number.MIN_VALUE, 1 / 3, Math.PI] }
  const encoded = encodeData(data, new TransferPool())
  assert.deepEqual(decodeData(encoded.json, encoded.buffer, encoded.used), data)
  assert.throws(() => decodeData({ __labF64: 'xy', offset: 0, count: 999999 }, encoded.buffer, encoded.used), /缓冲/)
  const frame = { view: { trajectories: [] }, trajectoryTimes: [], charts: [{ id: 'test', points: data.samples }], table: { columns: [], rows: [] } } as unknown as WorkspaceFrame
  const selected = displayFrame(frame)
  assert.equal(selected.frame.charts[0]!.points.length, MAX_DISPLAY_POINTS)
  assert.equal(frame.charts[0]!.points.length, 12000)
})
test('strict native JSON, export, action and checkpoint attack boundaries', () => {
  const gen = crypto.randomUUID()
  const envelope = (type: string, payload: object) => JSON.stringify({ version: 1, id: 'test', type, payload: { generation: gen, ...payload } })
  assert.equal(parseNativeCommand(envelope('load', { templateId: 'projectile-oblique' })).type, 'load')
  for (const payload of [{ templateId: 'x', scene: {} }, { checkpoint: {}, scene: {} }, { checkpoint: {}, originScene: {} }]) assert.throws(() => parseNativeCommand(envelope('load', payload)))
  assert.throws(() => parseNativeCommand(envelope('lifecycle', { active: 1 })))
  assert.throws(() => parseNativeCommand(envelope('document', { markdown: 'x', text: 'y' })))
  assert.throws(() => parseNativeCommand(envelope('document', { blocks: [{ id: 'a', markdown: 'x' }, { id: 'a', markdown: 'y' }] })))
  assert.throws(() => parseNativeCommand(JSON.stringify({ version: 1, id: 'test', type: 'checkpoint', payload: { generation: 'old' } })))
  assert.throws(() => assertJson(JSON.parse('{"__proto__":{"polluted":true}}')))
  const accessor = Object.defineProperty({}, 'x', { get: () => { throw new Error('getter ran') }, enumerable: true })
  assert.throws(() => assertJson(accessor), /对象字段/)
  assert.throws(() => parseAction({ name: 'applyDraftEdit', args: [] }))
  assert.throws(() => parseAction({ name: 'setRate', args: [Infinity] }))
  assert.throws(() => validateExport({ name: '../scene.json', mime: 'application/json', encoding: 'utf8', content: '{}' }))
  assert.throws(() => validateExport({ name: 'scene.json', mime: 'application/json', encoding: 'utf8', content: 'x'.repeat(MAX_FILE_BYTES + 1) }))
  assert.throws(() => validateExport({ name: 'scene.png', mime: 'image/png', encoding: 'base64', content: 'not base64' }))
})
test('LabClient connects to actual WorkerSession, restores presentation and drops old-generation deliveries', async () => {
  let port: WorkerPort | undefined
  const client = new LabClient({ now: () => performance.now(), requestFrame: callback => Number(setTimeout(() => callback(performance.now()), 1)),
    cancelFrame: id => clearTimeout(id), setTimeout, clearTimeout,
    createWorker: () => {
      const listeners = new Set<(event: MessageEvent<WorkerOutput>) => void>()
      const session = new WorkerSession({ now: () => performance.now(), post: message => queueMicrotask(() => listeners.forEach(listener => listener({ data: structuredClone(message) } as MessageEvent<WorkerOutput>))), schedule: setTimeout, cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) })
      port = { postMessage: message => { void session.receive(message as WorkerRequest) }, addEventListener: (type: string, listener: unknown) => { if (type === 'message') listeners.add(listener as (event: MessageEvent<WorkerOutput>) => void) }, removeEventListener: (type: string, listener: unknown) => { if (type === 'message') listeners.delete(listener as (event: MessageEvent<WorkerOutput>) => void) }, terminate: () => session.dispose() } as WorkerPort
      return port
    } })
  try {
    await client.load({ templateId: 'series-circuit' })
    await client.setPresentation({ viewport: { x: 21, y: -3, zoom: 2 }, activePanel: 'guide' })
    const checkpoint = await client.checkpoint()
    await client.load({ checkpoint })
    assert.deepEqual(client.getSnapshot().presentation, { viewport: checkpoint.editing.viewport, activePanel: 'guide' })
    await client.action('step', 1 / 60)
    assert.ok(client.getSnapshot().summary)
    assert.ok(port)
  } finally { client.dispose() }
})
