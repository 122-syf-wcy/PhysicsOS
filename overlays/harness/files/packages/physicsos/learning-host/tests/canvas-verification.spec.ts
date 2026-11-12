import { describe, expect, it, vi } from 'vitest'
import type { SimulationOptions, SimulationRequest, SimulationResult, SimulationState } from '@physicsos/physics-core'
import { ENGINES, getSimulationPlan, pickEngine, simulateScene, type EngineEntry } from '@physicsos/physics-runtime'
import { createCollisionScene, createMagneticScene, createMechanicsScene, createSeriesCircuitScene, MAX_TRAJECTORY_STORAGE_SAMPLES, type PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { createSceneObject, parseObject } from '@physicsos/physics-workbench/codec'
import { conditionsFromScene, createSnapshotObject, datasetFromSimulationResult } from '@physicsos/physics-workbench/data'
import { canonicalBytes, freezeData, jsonObject, unwrap, WorkbenchDataError } from '@physicsos/physics-workbench/json'
import type { SceneObject, SnapshotObject } from '@physicsos/physics-workbench/types'
import { canvasHash } from '../src/canvas-blob-store.ts'
import { resolveCanvasConfig, type CanvasLimits } from '../src/canvas-config.ts'
import { verifyCanvasCapture, type CanvasVerificationInput, type CanvasVerificationOutcome } from '../src/canvas-verification.ts'

const capturedAt = '2026-11-08T00:00:00.000Z'
const checkedAt = '2026-11-08T00:05:00.000Z'
const limits: CanvasLimits = freezeData(resolveCanvasConfig({
  canvasDshHome: '/opt/physicsos/canvas-verification-unit-test',
  canvasLimits: { maxSimulationSamples: 8192, maxSimulationDurationSeconds: 60, maxSimulationIterations: 1_000_000 },
}).limits)

interface Fixture {
  readonly source: SceneObject
  readonly capture: SnapshotObject
}

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected retained real-engine fixture evidence.')
  return value
}

function entryOf(scene: PhysicsScene): EngineEntry {
  const entry = pickEngine(scene).entry
  if (entry === undefined) throw new Error('No actual engine accepted the fixture scene.')
  return entry
}

function mechanicsSource(sceneId = 'test'): SceneObject {
  return createSceneObject(createMechanicsScene({
    sceneId, model: 'newton_second_law', mass: 1,
    velocity: { x: 2, y: 0, z: 0 }, appliedForce: { x: 1, y: 0, z: 0 }, endTime: 1, now: capturedAt,
  }))
}

function captureSimulation(
  source: SceneObject,
  request: SimulationRequest,
  result: SimulationResult,
  state: SimulationState = present(result.states.at(-1)),
  cursorTime = canonicalValue(state.time),
): SnapshotObject {
  return createSnapshotObject({
    scene: source.scene, sceneRef: { kind: 'scene', digest: canvasHash(canonicalBytes(source)) },
    instanceId: 'instance-one', instanceEditRevision: 3, capturedAt, source: 'client-engine',
    engineInfo: { id: result.metadata.engineId, version: result.metadata.engineVersion },
    request, result, state, rawState: jsonObject({ phase: 'paused' }),
    clock: { time: cursorTime, total: canonicalValue(present(result.states.at(-1)).time), running: false, rate: 1 },
    cursor: { kind: 'time', time: quantity(cursorTime, 's', 'time') }, datasets: [],
  })
}

function fixture(source = mechanicsSource(), options: SimulationOptions = { outputSampleRate: 7 }): Fixture {
  const replay = simulateScene(source.scene, entryOf(source.scene), 'sim', 'trace', options)
  return { source, capture: captureSimulation(source, replay.request, replay.simulation) }
}

function readSnapshot(input: unknown): SnapshotObject {
  const object = unwrap(parseObject(input))
  if (object.kind !== 'snapshot') throw new Error('Expected a parsed snapshot object.')
  return object
}

function inputFor(source: SceneObject, capture: SnapshotObject): CanvasVerificationInput {
  return freezeData({
    id: 'verify-one', canvasId: 'canvas-one', checkedAt,
    sceneDigest: canvasHash(canonicalBytes(source)), captureDigest: canvasHash(canonicalBytes(capture)),
  })
}

function verify(
  value: Fixture,
  capture = value.capture,
  bounds: CanvasLimits = limits,
  signal: AbortSignal = new AbortController().signal,
): CanvasVerificationOutcome {
  return verifyCanvasCapture(value.source, capture, inputFor(value.source, capture), bounds, signal)
}

function shiftedPosition(state: SimulationState, amount = 17): SimulationState {
  return {
    ...state,
    objects: state.objects.map((object, index) => {
      if (index !== 0) return object
      const position = present(object.position)
      return { ...object, position: { ...position, vector: { ...position.vector, x: position.vector.x + amount } } }
    }),
  }
}

function deeplyFrozen(value: unknown): boolean {
  return value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
}

function emptyOptionsMechanicsFixture(): Fixture {
  const source = mechanicsSource()
  const entry = entryOf(source.scene)
  const request = entry.createRequest(source.scene, 'empty-options-sim', 'empty-options-trace')
  expect(request.options.endTime).toEqual(quantity(1, 's', 'time'))
  request.options = {}
  freezeData(request)
  const replay = simulateScene(source.scene, entry, request)
  return { source, capture: captureSimulation(source, replay.request, replay.simulation) }
}

function nearestCollisionFixture(): Fixture {
  const source = createSceneObject(createCollisionScene({
    sceneId: 'nearest-collision', now: capturedAt,
    bodies: [
      { id: 'a', mass: 1, position: [-0.75, 0], velocity: [1, 0], radius: 0.25 },
      { id: 'b', mass: 1, position: [0.75, 0], velocity: [-1, 0], radius: 0.25 },
    ],
  }))
  const original = fixture(source, { endTime: quantity(1, 's', 'time'), outputSampleRate: 9 })
  const result = present(original.capture.result)
  const requested = 0.237
  const nearest = result.states.reduce((held, sample) =>
    Math.abs(canonicalValue(sample.time) - requested) < Math.abs(canonicalValue(held.time) - requested) ? sample : held,
  present(result.states[0]))
  return { source, capture: captureSimulation(source, present(original.capture.request), result, nearest, requested) }
}

describe('verifyCanvasCapture with actual selected engines and retained requests', () => {
  it('verifies mechanics and creates independent complete server evidence without changing frozen capture or scene bytes', () => {
    const value = fixture(mechanicsSource(), { outputSampleRate: MAX_TRAJECTORY_STORAGE_SAMPLES })
    const original = present(value.capture.result)
    const input = inputFor(value.source, value.capture)
    const sourceBytes = canonicalBytes(value.source)
    const sceneBytes = canonicalBytes(value.source.scene)
    const captureBytes = canonicalBytes(value.capture)
    expect(deeplyFrozen(value.source)).toBe(true)
    expect(deeplyFrozen(value.capture)).toBe(true)
    expect(original.verification.status).toBe('passed')
    expect(original.states).toHaveLength(MAX_TRAJECTORY_STORAGE_SAMPLES)

    const outcome = verifyCanvasCapture(value.source, value.capture, input, limits, new AbortController().signal)
    expect(outcome.receipt).toMatchObject({
      ...input, status: 'verified', engineId: 'engine-mechanics', engineVersion: value.capture.engine.version,
      details: { subject: 'complete-simulation-raw-evidence', comparedStates: original.states.length },
    })
    expect(outcome.receipt.details.mismatch).toBeUndefined()
    const snapshot = present(outcome.snapshot)
    const result = present(snapshot.result)
    expect(snapshot).not.toBe(value.capture)
    expect(result).not.toBe(original)
    expect(result.states).not.toBe(original.states)
    expect(result.states[0]).not.toBe(original.states[0])
    expect(snapshot).toMatchObject({
      source: 'server-engine', capturedAt: checkedAt, scene: value.capture.scene,
      sceneRevision: value.source.scene.revision, instanceId: value.capture.instanceId,
      instanceEditRevision: value.capture.instanceEditRevision, clock: value.capture.clock, cursor: value.capture.cursor,
      metadata: { originalCaptureDigest: input.captureDigest, verificationReceiptId: input.id },
    })
    expect(snapshot.diagnostics).toContainEqual({ originalCaptureDigest: input.captureDigest, receiptId: input.id, receiptStatus: 'verified' })
    expect(snapshot.request).toEqual(value.capture.request)
    expect(snapshot.capturedState).toEqual(value.capture.capturedState)
    expect(snapshot.rawState).toBeUndefined()
    expect(snapshot.datasets).toEqual([])
    expect(result.simulationId).toBe(present(value.capture.request).simulationId)
    expect(result.trace).toEqual(present(value.capture.request).trace)
    expect(result.states).toEqual(original.states)
    expect(result.events).toEqual(original.events)
    expect(result.measurements).toEqual(original.measurements)
    expect(result.derivedQuantities).toEqual(original.derivedQuantities)
    expect(result.verification.status).toBe('passed')
    expect(result.verification.checks).toContainEqual(expect.objectContaining({ id: 'mechanics_kinematic_consistency', type: 'numerical', passed: true }))

    expect(outcome.datasets).toEqual(datasetFromSimulationResult(original, { sourceScene: value.capture.scene, conditions: conditionsFromScene(value.source.scene) }))
    const states = present(outcome.datasets.find(dataset => dataset.origin.collection === 'states'))
    const derived = present(outcome.datasets.find(dataset => dataset.origin.collection === 'derived'))
    expect(states.rows).toHaveLength(original.states.length)
    expect(states.rows.length).toBeGreaterThan(512)
    expect(states.rows.map(row => row.axes.time)).toEqual(original.states.map(state => canonicalValue(state.time)))
    for (const key of ['position', 'velocity', 'acceleration'] as const) {
      for (const component of ['x', 'y', 'z'] as const) {
        const metric = present(states.metrics.find(metric => metric.semanticKey === key && metric.component === component && metric.targetId === 'body-1'))
        expect(states.rows.map(row => row.values[metric.id])).toEqual(original.states.map(state => present(present(state.objects[0])[key]).vector[component]))
      }
    }
    expect(states.rows[1]?.evidence?.rawTime).toEqual(original.states[1]?.time)
    expect(derived.rows).toHaveLength(1)
    expect(derived.rows[0]?.evidence?.timeMeaning).toBe('not-inferred-from-states')
    expect(present(result.states.at(-1)).objects[0]?.position?.vector.x).toBe(2.5)
    expect(present(result.states.at(-1)).objects[0]?.velocity?.vector.x).toBe(3)
    expect(deeplyFrozen(snapshot)).toBe(true)
    expect(deeplyFrozen(outcome.datasets)).toBe(true)
    expect(canvasHash(canonicalBytes(snapshot))).not.toBe(input.captureDigest)
    expect(canonicalBytes(value.source)).toEqual(sourceBytes)
    expect(canonicalBytes(value.source.scene)).toEqual(sceneBytes)
    expect(canonicalBytes(value.capture)).toEqual(captureBytes)
    expect(deeplyFrozen(value.source)).toBe(true)
    expect(deeplyFrozen(value.capture)).toBe(true)
  })

  it('rejects a forged numerical state inside an otherwise genuine full result and retains the actual server value', () => {
    const value = fixture()
    const original = present(value.capture.result)
    const index = 3
    const forged = shiftedPosition(present(original.states[index]))
    const capture = readSnapshot({
      ...value.capture,
      result: { ...original, states: original.states.map((state, at) => at === index ? forged : state) },
    })
    const captureBytes = canonicalBytes(capture)
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'rejected', details: { mismatch: {
      path: `/states/${index}/objects/0/position/vector/x`, reason: 'numeric-value',
      expected: present(present(forged.objects[0]).position).vector.x,
      actual: present(present(present(original.states[index]).objects[0]).position).vector.x,
    } } })
    const result = present(present(outcome.snapshot).result)
    expect(result.states).toEqual(original.states)
    expect(result.verification.status).toBe('passed')
    expect(outcome.datasets).toEqual(datasetFromSimulationResult(original, { sourceScene: value.capture.scene, conditions: conditionsFromScene(value.source.scene) }))
    expect(canonicalBytes(capture)).toEqual(captureBytes)
  })

  it('rejects a forged capturedState even when every field of the full result is legitimate', () => {
    const value = fixture()
    const original = present(value.capture.capturedState)
    const forged = shiftedPosition(original)
    const capture = readSnapshot({ ...value.capture, capturedState: forged })
    expect(capture.result).toEqual(value.capture.result)
    expect(capture.capturedState?.time).toEqual(original.time)
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'rejected', details: { mismatch: {
      path: '/capturedState/objects/0/position/vector/x', reason: 'numeric-value',
      expected: present(present(forged.objects[0]).position).vector.x,
      actual: present(present(original.objects[0]).position).vector.x,
    } } })
    expect(outcome.snapshot?.capturedState).toEqual(original)
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
  })

  it('does not trust fabricated passed client verification or claimed strong provenance over a numerical mismatch', () => {
    const value = fixture()
    const original = present(value.capture.result)
    const forged = shiftedPosition(present(original.states[2]), 1000)
    const capture = readSnapshot({ ...value.capture, result: {
      ...original, states: original.states.map((state, index) => index === 2 ? forged : state),
      verification: {
        status: 'passed', level: 'STRONGLY_VERIFIED', warnings: [], errors: [],
        checks: [{ id: 'client-certifies-everything', type: 'numerical', passed: true }],
      },
    } })
    expect(capture.result?.verification.status).toBe('passed')
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'rejected', details: {
      mismatch: { path: '/states/2/objects/0/position/vector/x', reason: 'numeric-value' },
    } })
    expect(outcome.snapshot?.result?.verification.checks.some(check => check.id === 'client-certifies-everything')).toBe(false)
    expect(outcome.snapshot?.result?.states).toEqual(original.states)
  })

  it.each(['id', 'version'] as const)('reports an unsupported saved engine %s rather than certifying against another engine release', field => {
    const value = fixture()
    const original = present(value.capture.result)
    const engine = field === 'id' ? { ...value.capture.engine, id: 'client-only-engine' } : { ...value.capture.engine, version: '999.0.0' }
    const capture = readSnapshot({ ...value.capture, engine,
      result: { ...original, metadata: { ...original.metadata, engineId: engine.id, engineVersion: engine.version } },
    })
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({
      status: 'unsupported', engineId: field === 'id' ? engine.id : value.capture.engine.id, engineVersion: value.capture.engine.version,
      details: { capturedEngineId: engine.id, capturedEngineVersion: engine.version },
    })
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
  })

  it('refuses an over-budget circuit before any legacy canHandle solver or simulation runs', () => {
    const source = createSceneObject(createSeriesCircuitScene({ sceneId: 'preflight-circuit', now: capturedAt }))
    const selected = present(ENGINES.find(entry => entry.engine.engineId === 'engine-circuit'))
    const request = selected.createRequest(source.scene, 'circuit-sim', 'circuit-trace')
    const replay = simulateScene(source.scene, selected, request)
    const capture = captureSimulation(source, replay.request, replay.simulation)
    const plan = getSimulationPlan(source.scene, selected, request)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(0)
    const canHandle = vi.spyOn(selected.engine, 'canHandle')
    const simulation = vi.spyOn(selected.engine, 'simulate')
    try {
      const outcome = verify({ source, capture }, capture, { ...limits, maxSimulationIterations: plan.numericalIterationCountBound - 1 })
      expect(outcome.receipt).toMatchObject({ status: 'unsupported', details: { plan } })
      expect(canHandle).not.toHaveBeenCalled()
      expect(simulation).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
    } finally {
      canHandle.mockRestore()
      simulation.mockRestore()
    }
  })

  it('reports a missing accepted request as unsupported instead of rerunning default options', () => {
    const value = fixture()
    const wire = { ...value.capture }
    delete wire.request
    const capture = readSnapshot(wire)
    expect(capture.result?.states).toHaveLength(7)
    expect(capture.request).toBeUndefined()
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'unsupported' })
    expect(outcome.receipt.details.reason).toMatch(/no retained accepted SimulationRequest.*default options/i)
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
  })

  it('replays a retained empty options object as-is instead of regenerating the scene factory request', () => {
    const value = emptyOptionsMechanicsFixture()
    const request = present(value.capture.request)
    const plan = getSimulationPlan(value.source.scene, entryOf(value.source.scene), request)
    expect(request.options).toEqual({})
    expect(canonicalValue(present(value.capture.result?.states.at(-1)).time)).toBe(10)
    expect(plan).toMatchObject({ startTime: 0, endTime: 10, storageSampleCountBound: 65, numericalIterationCountBound: 0 })
    const outcome = verify(value)
    expect(outcome.receipt.status).toBe('verified')
    expect(outcome.receipt.details.plan).toEqual(plan)
    expect(outcome.snapshot?.request).toEqual(request)
    expect(outcome.snapshot?.request?.options).toEqual({})
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
  })

  it('refuses the actual default mechanics duration before simulation even though the retained request omits endTime', () => {
    const value = emptyOptionsMechanicsFixture()
    const request = present(value.capture.request)
    const entry = entryOf(value.source.scene)
    const plan = getSimulationPlan(value.source.scene, entry, request)
    const bounds: CanvasLimits = { ...limits, maxSimulationDurationSeconds: 1 }
    const bytes = canonicalBytes(value.capture)
    expect(request.options).toEqual({})
    expect(plan.endTime - plan.startTime).toBe(10)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    try {
      const outcome = verify(value, value.capture, bounds)
      expect(outcome.receipt).toMatchObject({ status: 'unsupported', details: {
        plan, maxDurationSeconds: bounds.maxSimulationDurationSeconds,
      } })
      expect(simulate).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
      expect(outcome.datasets).toEqual([])
      expect(canonicalBytes(value.capture)).toEqual(bytes)
    } finally {
      simulate.mockRestore()
    }
  })

  it('refuses the actual default mechanics storage bound before simulation when no output sample hint is retained', () => {
    const value = emptyOptionsMechanicsFixture()
    const entry = entryOf(value.source.scene)
    const plan = getSimulationPlan(value.source.scene, entry, present(value.capture.request))
    const bounds: CanvasLimits = { ...limits, maxSimulationSamples: 64 }
    expect(value.capture.request?.options.outputSampleRate).toBeUndefined()
    expect(plan.storageSampleCountBound).toBe(65)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    try {
      const outcome = verify(value, value.capture, bounds)
      expect(outcome.receipt).toMatchObject({ status: 'unsupported', details: { plan, maxSamples: bounds.maxSimulationSamples } })
      expect(simulate).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
      expect(outcome.datasets).toEqual([])
    } finally {
      simulate.mockRestore()
    }
  })

  it('refuses the actual magnetic default period before simulation rather than assuming a missing endTime is unbounded or zero', () => {
    const source = createSceneObject(createMagneticScene({
      sceneId: 'magnetic-default-period', mass: 1, charge: 1, magneticFieldStrength: 1,
      magneticFieldDirection: 'out_of_page', position: { x: 0, y: 0, z: 0 }, velocity: { x: 2, y: 0, z: 0 }, now: capturedAt,
    }))
    const value = fixture(source, {})
    const entry = entryOf(source.scene)
    const plan = getSimulationPlan(source.scene, entry, present(value.capture.request))
    const bounds: CanvasLimits = { ...limits, maxSimulationDurationSeconds: 1 }
    expect(value.capture.request?.options.endTime).toBeUndefined()
    expect(value.capture.result?.verification.status).not.toBe('failed')
    expect(plan.kind).toBe('analytic')
    expect(plan.endTime).toBeCloseTo(2 * Math.PI, 12)
    expect(canonicalValue(present(value.capture.result?.states.at(-1)).time)).toBe(plan.endTime)
    expect(plan.numericalIterationCountBound).toBe(0)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    try {
      const outcome = verify(value, value.capture, bounds)
      expect(outcome.receipt).toMatchObject({ status: 'unsupported', engineId: 'engine-magnetic', details: {
        plan, maxDurationSeconds: bounds.maxSimulationDurationSeconds,
      } })
      expect(simulate).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
      expect(outcome.datasets).toEqual([])
    } finally {
      simulate.mockRestore()
    }
  })

  it('refuses an excessive engine-planned collision iteration bound before simulation even when sample and duration limits fit', () => {
    const value = nearestCollisionFixture()
    const entry = entryOf(value.source.scene)
    const request = present(value.capture.request)
    const plan = getSimulationPlan(value.source.scene, entry, request)
    const bounds: CanvasLimits = { ...limits, maxSimulationIterations: plan.numericalIterationCountBound - 1 }
    expect(request.options.maxIterations).toBeUndefined()
    expect(plan.kind).toBe('iterative')
    expect(plan.numericalIterationCountBound).toBeGreaterThan(1)
    expect(plan.storageSampleCountBound).toBeLessThan(bounds.maxSimulationSamples)
    expect(plan.endTime - plan.startTime).toBeLessThan(bounds.maxSimulationDurationSeconds)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    try {
      const outcome = verify(value, value.capture, bounds)
      expect(outcome.receipt).toMatchObject({ status: 'unsupported', details: { plan, maxIterations: bounds.maxSimulationIterations } })
      expect(simulate).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
      expect(outcome.datasets).toEqual([])
    } finally {
      simulate.mockRestore()
    }
  })

  it('replays every retained option and the exact requested window, storing all actual samples without substituting defaults', () => {
    const options: SimulationOptions = {
      startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time'),
      timeStep: quantity(1, 'ms', 'time'), outputSampleRate: 7,
      solver: 'recorded-analytic-hint', tolerance: { absolute: 0, relative: 1e-9 }, maxIterations: 100, randomSeed: 0,
    }
    const value = fixture(mechanicsSource(), options)
    const request = present(value.capture.request)
    expect(request.options).toEqual(options)
    const outcome = verify(value)
    expect(outcome.receipt.status).toBe('verified')
    const snapshot = present(outcome.snapshot)
    const result = present(snapshot.result)
    expect(snapshot.request).toEqual(request)
    expect(snapshot.request?.options).toEqual(options)
    expect(result.trace).toEqual(request.trace)
    expect(result.states).toHaveLength(7)
    expect(result.states).toEqual(value.capture.result?.states)
    expect(canonicalValue(present(result.states[0]).time)).toBe(0.1)
    expect(canonicalValue(present(result.states.at(-1)).time)).toBe(0.2)
    for (const state of result.states) {
      const time = canonicalValue(state.time)
      expect(state.objects[0]?.position?.vector.x).toBeCloseTo(2 * time + 0.5 * time ** 2, 12)
      expect(state.objects[0]?.velocity?.vector.x).toBeCloseTo(2 + time, 12)
    }
    const states = present(outcome.datasets.find(dataset => dataset.origin.collection === 'states'))
    expect(states.rows).toHaveLength(result.states.length)
    expect(states.rows.map(row => row.axes.time)).toEqual(result.states.map(state => canonicalValue(state.time)))
  })

  it.each([
    ['scene', 'SIMULATION_SCENE_MISMATCH'],
    ['trace', 'SIMULATION_TRACE_MISMATCH'],
  ] as const)('keeps a mismatched request %s identity and returns the actual runtime diagnostic, not success', (field, code) => {
    const value = fixture()
    const foreign = fixture(mechanicsSource('foreign-scene'))
    const request = present(value.capture.request)
    const capture = field === 'scene'
      ? readSnapshot({ ...foreign.capture, scene: value.capture.scene })
      : readSnapshot({ ...value.capture, request: { ...request, trace: { ...request.trace, sceneId: foreign.source.scene.id } } })
    const bytes = canonicalBytes(capture)
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'error', details: { code } })
    expect(outcome.receipt.details.message).toMatch(/SimulationRequest/)
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
    expect(canonicalBytes(capture)).toEqual(bytes)
  })

  it('rejects genuine failed engine evidence even when the entire numerical replay matches', () => {
    const source = createSceneObject(createMechanicsScene({
      sceneId: 'spring-out-of-equilibrium', model: 'spring_statics', mass: 1, now: capturedAt,
      position: { x: 0, y: 0, z: 0 }, springAnchor: { x: 0, y: 3, z: 0 },
      springNaturalLength: 1, springConstant: 10, endTime: 1,
    }))
    const value = fixture(source)
    const verification = present(value.capture.result).verification
    expect(verification.status).toBe('failed')
    expect(verification.checks).toContainEqual(expect.objectContaining({ id: 'equilibrium_position', type: 'constraint', passed: false }))
    const outcome = verify(value)
    expect(outcome.receipt).toMatchObject({ status: 'rejected', details: {
      subject: 'complete-simulation-raw-evidence', engineVerification: { status: 'failed' },
    } })
    expect(outcome.receipt.details.mismatch).toBeUndefined()
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
    expect(outcome.snapshot?.result?.verification.checks).toContainEqual(expect.objectContaining({ id: 'equilibrium_position', passed: false }))
    expect(outcome.snapshot?.result?.verification.checks).toContainEqual(expect.objectContaining({ id: 'engine_verification', passed: false }))
  })

  it('returns the real solver model-resolution failure from preflight without inventing a successful server result', () => {
    const source = createSceneObject(createMechanicsScene({
      sceneId: 'zero-stiffness', model: 'spring_oscillator', mass: 1, springConstant: 0, endTime: 1, now: capturedAt,
    }))
    const entry = entryOf(source.scene)
    const capture = createSnapshotObject({
      scene: source.scene, sceneRef: { kind: 'scene', digest: canvasHash(canonicalBytes(source)) },
      instanceId: 'instance-one', instanceEditRevision: 0, capturedAt, source: 'client-engine',
      engineInfo: { id: entry.engine.engineId, version: entry.engine.engineVersion },
      request: entry.createRequest(source.scene, 'failed-sim', 'failed-trace'), rawState: jsonObject({ phase: 'not-solved' }),
      clock: { time: 0, total: 1, running: false, rate: 1 }, cursor: { kind: 'time', time: quantity(0, 's', 'time') }, datasets: [],
    })
    const simulate = vi.spyOn(entry.engine, 'simulate')
    try {
      const outcome = verify({ source, capture })
      expect(outcome.receipt).toMatchObject({ status: 'error', details: {
        code: 'ENGINE_PLAN_FAILED', message: 'spring_oscillator requires a spring constraint with stiffness > 0',
      } })
      expect(simulate).not.toHaveBeenCalled()
      expect(outcome.snapshot).toBeUndefined()
      expect(outcome.datasets).toEqual([])
    } finally {
      simulate.mockRestore()
    }
  })

  it('does not treat presentation-only rawState as a raw SimulationResult or sampled SimulationState', () => {
    const value = fixture()
    const wire = { ...value.capture }
    delete wire.result
    delete wire.capturedState
    const capture = readSnapshot(wire)
    expect(capture.request).toEqual(value.capture.request)
    expect(capture.rawState).toEqual({ phase: 'paused' })
    const outcome = verify(value, capture)
    expect(outcome.receipt.status).toBe('unsupported')
    expect(outcome.receipt.details.reason).toMatch(/no replay-comparable raw result or exact sampled state/i)
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
  })

  it('verifies an exact retained state without falsely describing the client capture as a complete result', () => {
    const value = fixture()
    const wire = { ...value.capture }
    delete wire.result
    const capture = readSnapshot(wire)
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'verified', details: { subject: 'exact-captured-state-only', comparedStates: 1 } })
    expect(outcome.snapshot?.capturedState).toEqual(value.capture.capturedState)
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
    expect(outcome.datasets).toEqual(datasetFromSimulationResult(present(value.capture.result), { sourceScene: value.capture.scene, conditions: conditionsFromScene(value.source.scene) }))
  })

  it('throws the actual cancellation reason synchronously without changing the original frozen evidence', () => {
    const value = fixture()
    const sourceBytes = canonicalBytes(value.source)
    const captureBytes = canonicalBytes(value.capture)
    const controller = new AbortController()
    const reason = new Error('Canvas verification cancelled.')
    controller.abort(reason)
    expect(() => verify(value, value.capture, limits, controller.signal)).toThrow(reason)
    expect(canonicalBytes(value.source)).toEqual(sourceBytes)
    expect(canonicalBytes(value.capture)).toEqual(captureBytes)
  })

  it('refuses an excessive requested sample count even over a short window when the actual engine clamps its stored result', () => {
    const value = fixture(mechanicsSource(), { endTime: quantity(100, 'ms', 'time'), outputSampleRate: 4096 })
    const result = present(value.capture.result)
    const bounds: CanvasLimits = { ...limits, maxSimulationSamples: 2048 }
    expect(value.capture.request?.options.outputSampleRate).toBe(4096)
    expect(result.states).toHaveLength(MAX_TRAJECTORY_STORAGE_SAMPLES)
    expect(result.states.length + result.measurements.length + result.derivedQuantities.length).toBeLessThan(bounds.maxSimulationSamples)
    const outcome = verify(value, value.capture, bounds)
    expect(outcome.receipt.status).toBe('unsupported')
    expect(outcome.receipt.details.reason).toMatch(/sample.*limit/i)
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
  })

  it('treats outputSampleRate as the actual requested storage count, not a rate multiplied by the duration', () => {
    const value = fixture(mechanicsSource(), { endTime: quantity(3, 's', 'time'), outputSampleRate: 7 })
    const bounds: CanvasLimits = { ...limits, maxSimulationSamples: 20 }
    const result = present(value.capture.result)
    expect(result.states).toHaveLength(7)
    expect(result.states.length + result.measurements.length + result.derivedQuantities.length).toBeLessThan(bounds.maxSimulationSamples)
    const outcome = verify(value, value.capture, bounds)
    expect(outcome.receipt.status).toBe('verified')
    expect(outcome.snapshot?.result?.states).toEqual(result.states)
  })

  it('accepts the actual bounded analytical output without inventing a time-step grid that this engine does not run', () => {
    const value = fixture(mechanicsSource(), { timeStep: quantity(1, 'ms', 'time'), outputSampleRate: 7 })
    const bounds: CanvasLimits = { ...limits, maxSimulationSamples: 20 }
    expect(value.capture.result?.states).toHaveLength(7)
    const outcome = verify(value, value.capture, bounds)
    expect(outcome.receipt.status).toBe('verified')
    expect(outcome.snapshot?.request?.options.timeStep).toEqual(quantity(1, 'ms', 'time'))
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
  })

  it('uses the actual zero-iteration analytical plan rather than refusing a large retained maxIterations hint', () => {
    const value = fixture(mechanicsSource(), { outputSampleRate: 7, maxIterations: 1_000_000 })
    const request = present(value.capture.request)
    const plan = getSimulationPlan(value.source.scene, entryOf(value.source.scene), request)
    const bounds: CanvasLimits = { ...limits, maxSimulationIterations: 1 }
    expect(request.options.maxIterations).toBeGreaterThan(bounds.maxSimulationIterations)
    expect(plan.numericalIterationCountBound).toBe(0)
    const outcome = verify(value, value.capture, bounds)
    expect(outcome.receipt.status).toBe('verified')
    expect(outcome.receipt.details.plan).toEqual(plan)
    expect(outcome.snapshot?.request?.options).toEqual(request.options)
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
  })

  it('accepts a long sparse mechanics capture under the default limits while refusing its requested count under a smaller limit', () => {
    const defaultLimits = resolveCanvasConfig({ canvasDshHome: '/opt/physicsos/canvas-verification-unit-test' }).limits
    const value = fixture(mechanicsSource(), { endTime: quantity(1000, 's', 'time'), timeStep: quantity(1e-6, 's', 'time'), outputSampleRate: 65 })
    const result = present(value.capture.result)
    const plan = getSimulationPlan(value.source.scene, entryOf(value.source.scene), present(value.capture.request))
    expect(result.states).toHaveLength(65)
    expect(canonicalValue(present(result.states.at(-1)).time)).toBe(1000)
    expect(plan).toMatchObject({ kind: 'analytic', endTime: 1000, storageSampleCountBound: 65, numericalIterationCountBound: 0 })
    const accepted = verify(value, value.capture, defaultLimits)
    expect(accepted.receipt.status).toBe('verified')
    expect(accepted.receipt.details.plan).toEqual(plan)
    expect(accepted.snapshot?.request?.options.timeStep).toEqual(quantity(1e-6, 's', 'time'))
    expect(accepted.snapshot?.result?.states).toEqual(result.states)
    const rejected = verify(value, value.capture, { ...defaultLimits, maxSimulationSamples: 64 })
    expect(rejected.receipt.status).toBe('unsupported')
    expect(rejected.receipt.details.reason).toMatch(/sample.*limit/i)
    expect(rejected.snapshot).toBeUndefined()
    expect(rejected.datasets).toEqual([])
  })

  it('refuses the complete actual replay count instead of dropping derived evidence to fit a limit', () => {
    const value = fixture()
    const result = present(value.capture.result)
    const actualCount = result.states.length + result.measurements.length + result.derivedQuantities.length
    const bounds: CanvasLimits = { ...limits, maxSimulationSamples: actualCount - 1 }
    expect(present(value.capture.request).options.outputSampleRate).toBeLessThan(bounds.maxSimulationSamples)
    const outcome = verify(value, value.capture, bounds)
    expect(outcome.receipt.status).toBe('rejected')
    expect(outcome.receipt.details.reason).toMatch(/actual server replay.*complete sample limit/i)
    expect(outcome.snapshot).toBeUndefined()
    expect(outcome.datasets).toEqual([])
  })

  it('verifies the original full collision samples and records the nearest held sample time separately from the requested cursor', () => {
    const value = nearestCollisionFixture()
    const original = present(value.capture.result)
    const held = present(value.capture.capturedState)
    const actualTime = canonicalValue(held.time)
    const cursor = value.capture.cursor
    if (cursor.kind !== 'time') throw new Error('Expected the real collision time cursor.')
    const requestedTime = canonicalValue(cursor.time)
    const diagnostic = {
      code: 'SAMPLED_STATE_CURSOR_OFFSET', requestedTimeSI: requestedTime, evaluatedTimeSI: actualTime,
      offsetSI: actualTime - requestedTime, selection: 'held-result-sample',
    }
    const bytes = canonicalBytes(value.capture)
    expect(value.capture.engine.id).toBe('engine-collision')
    expect(original.verification.status).toBe('passed')
    expect(original.events.some(event => event.type === 'CollisionOccurred')).toBe(true)
    expect(actualTime).not.toBe(requestedTime)
    expect(original.states.some(state => canonicalValue(state.time) === requestedTime)).toBe(false)
    expect(original.states).toContainEqual(held)
    expect(value.capture.diagnostics).toContainEqual(diagnostic)
    const outcome = verify(value)
    expect(outcome.receipt).toMatchObject({ status: 'verified', details: {
      subject: 'complete-simulation-raw-evidence', comparedStates: original.states.length,
      sampling: { requestedCursor: cursor, actualStoredStateTime: held.time, replayStoredStateTime: held.time },
    } })
    expect(outcome.snapshot?.result?.states).toEqual(original.states)
    expect(outcome.snapshot?.result?.events).toEqual(original.events)
    expect(outcome.snapshot?.capturedState).toEqual(held)
    expect(outcome.snapshot?.capturedState?.time).not.toEqual(cursor.time)
    expect(outcome.snapshot?.cursor).toEqual(cursor)
    expect(outcome.snapshot?.diagnostics).toContainEqual(diagnostic)
    expect(outcome.datasets).toEqual(datasetFromSimulationResult(original, { sourceScene: value.capture.scene, conditions: conditionsFromScene(value.source.scene) }))
    expect(canonicalBytes(value.capture)).toEqual(bytes)

    const unrelated = shiftedPosition(held)
    expect(() => createSnapshotObject({
      scene: value.source.scene, sceneRef: value.capture.scene,
      instanceId: value.capture.instanceId, instanceEditRevision: value.capture.instanceEditRevision, capturedAt, source: 'client-engine',
      engineInfo: value.capture.engine, ...(value.capture.request === undefined ? {} : { request: value.capture.request }), result: original, state: unrelated,
      clock: value.capture.clock, cursor, datasets: [],
    })).toThrow(WorkbenchDataError)
  })

  it('rejects a fabricated cursor-time collision state rather than interpolating or certifying an instant absent from the actual samples', () => {
    const value = nearestCollisionFixture()
    const held = present(value.capture.capturedState)
    const cursor = value.capture.cursor
    if (cursor.kind !== 'time') throw new Error('Expected the real collision time cursor.')
    const capture = readSnapshot({ ...value.capture, capturedState: { ...held, time: cursor.time } })
    expect(capture.result?.states).toEqual(value.capture.result?.states)
    const outcome = verify(value, capture)
    expect(outcome.receipt).toMatchObject({ status: 'rejected', details: {
      mismatch: { path: '/capturedState/time', reason: 'exact-captured-instant-missing', expected: cursor.time, actual: null },
      sampling: { requestedCursor: cursor, actualStoredStateTime: cursor.time, replayStoredStateTime: null },
    } })
    expect(outcome.snapshot?.result?.states).toEqual(value.capture.result?.states)
    expect(outcome.snapshot?.capturedState).toBeUndefined()
  })
})
