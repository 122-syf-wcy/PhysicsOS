import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, derivedScalar, type SimulationOptions } from '@physicsos/physics-core'
import { createTransformerBenchScene, type PhysicsScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import {
  IDEAL_TRANSFORMER_MODEL,
  TRANSFORMER_ENGINE_ID,
  TRANSFORMER_ENGINE_VERSION,
  TransformerEngine,
  createTransformerSimulationRequest,
} from '../src/transformer-engine.ts'
import * as transformer from '../src/transformer.ts'

const requestFor = (scene: PhysicsScene, options?: SimulationOptions) => ({
  ...createTransformerSimulationRequest(scene, 'sim-transformer-plan', 'trace-transformer-plan'),
  ...(options === undefined ? {} : { options }),
})

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

afterEach(() => vi.restoreAllMocks())

describe('TransformerEngine.prepareSimulationPlan', () => {
  it('plans exactly one static settled reading with options={}', () => {
    const scene = createTransformerBenchScene()
    const request = requestFor(scene, {})
    const engine = new TransformerEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: TRANSFORMER_ENGINE_ID,
      engineVersion: TRANSFORMER_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId: IDEAL_TRANSFORMER_MODEL,
      kind: 'static',
      metadata: {
        numericalIterationAccounting: expect.stringContaining('One settled static transformer reading'),
      },
      startTime: 0,
      endTime: 0,
      storageSampleCountBound: 1,
      numericalIterationCountBound: 0,
    })
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(1)
    expect(result.states[0]?.time.value).toBe(0)
    expect(result.events).toHaveLength(1)
  })

  it('does not manufacture a timeline end for a static bench', () => {
    const built = createTransformerBenchScene()
    const scene: PhysicsScene = {
      ...built,
      timeline: { ...built.timeline, endTime: quantity(1e9, 's', 'time') },
    }
    const request = requestFor(scene, { startTime: quantity(500, 'ms', 'time') })
    const engine = new TransformerEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 0.5, endTime: 0.5, storageSampleCountBound: 1,
    })
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(1)
    expect(result.states[0]?.time.value).toBe(0.5)
    expect(result.events).toHaveLength(0)
  })

  it('preserves the explicit non-SI window while sampling only its start', () => {
    const built = createTransformerBenchScene({
      sceneId: 'custom-transformer-plan', revision: 4,
      primaryVoltage: 120, primaryCurrent: 0.2, primaryTurns: 600, secondaryTurns: 100,
    })
    const scene = freeze(built)
    const request = freeze(requestFor(scene, {
      startTime: quantity(250, 'ms', 'time'), endTime: quantity(2, 'min', 'time'),
      outputSampleRate: 1024,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new TransformerEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      sceneRevision: 4, startTime: 0.25, endTime: 120,
      kind: 'static', storageSampleCountBound: 1, numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(1)
    expect(result.states[0]?.time.value).toBe(0.25)
    expect(result.events).toHaveLength(0)
    expect(derivedScalar(result.derivedQuantities, 'secondary_voltage').value).toBeCloseTo(20, 12)
    expect(derivedScalar(result.derivedQuantities, 'flux_rate')).toMatchObject({
      value: 0.2, unit: 'Wb/s', dimension: 'magnetic_flux_rate',
    })
    expect({ scene, request }).toEqual(snapshot)
  })

  it('preserves a sparse long window without computing transformer readings during planning', () => {
    const scene = freeze(createTransformerBenchScene())
    const request = freeze(requestFor(scene, {
      endTime: quantity(1e9, 's', 'time'), outputSampleRate: 2,
      timeStep: quantity(1, 'ms', 'time'), maxIterations: 1,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new TransformerEngine()
    const forbidden = () => { throw new Error('Planning must not calculate or allocate states.') }
    const reading = vi.spyOn(transformer, 'transformerReadingOf').mockImplementation(forbidden)
    const canHandle = vi.spyOn(engine, 'canHandle').mockImplementation(forbidden)
    const state = vi.spyOn(engine, 'stateAt').mockImplementation(forbidden)
    const simulate = vi.spyOn(engine, 'simulate').mockImplementation(forbidden)
    const arrays = vi.spyOn(Array, 'from').mockImplementation(forbidden)
    const plan = engine.prepareSimulationPlan(scene, request)
    const arrayAllocations = arrays.mock.calls.length
    arrays.mockRestore()
    expect(plan).toMatchObject({ endTime: 1e9, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
    expect(arrayAllocations).toBe(0)
    for (const spy of [reading, canHandle, state, simulate]) expect(spy).not.toHaveBeenCalled()
    expect({ scene, request }).toEqual(snapshot)
  })

  it('simulates a sparse long static window as one unchanged reading', () => {
    const scene = createTransformerBenchScene()
    const request = requestFor(scene, { endTime: quantity(1e6, 's', 'time'), outputSampleRate: 2 })
    const engine = new TransformerEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      endTime: 1e6, storageSampleCountBound: 1, numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(1)
    expect(result.states[0]?.time.value).toBe(0)
    expect(result.events).toHaveLength(1)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 100000])('does not turn ignored storage hint %s into extra static samples', outputSampleRate => {
    const scene = createTransformerBenchScene()
    const request = requestFor(scene, { endTime: quantity(10, 's', 'time'), outputSampleRate })
    const engine = new TransformerEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 0, endTime: 10, storageSampleCountBound: 1, numericalIterationCountBound: 0,
    })
    expect(engine.simulate(scene, request).states).toHaveLength(1)
  })

  it.each([
    { startTime: quantity(-1, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
  ])('rejects invalid ranges consistently with the static simulation', options => {
    const scene = createTransformerBenchScene()
    const request = requestFor(scene, options)
    const engine = new TransformerEngine()
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrowError(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, request)).toThrowError(/0 <= startTime <= endTime/)
  })

  it('rejects nonfinite time quantities before preparing or simulating a reading', () => {
    const scene = createTransformerBenchScene()
    const engine = new TransformerEngine()
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const request = requestFor(scene, { endTime: { ...quantity(1, 's', 'time'), value } })
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
      expect(() => engine.simulate(scene, request)).toThrow()
    }
  })

  it.each(['sceneId', 'sceneRevision'] as const)('guards the requested %s before resolving a transformer', key => {
    const scene = createTransformerBenchScene()
    const request = requestFor(scene)
    const mismatch = key === 'sceneId'
      ? { ...request, sceneId: asSceneId('another-transformer-scene') }
      : { ...request, sceneRevision: scene.revision + 1 }
    expect(() => new TransformerEngine().prepareSimulationPlan({ ...scene, transformerBenches: [] }, mismatch))
      .toThrowError(/SimulationRequest must reference/)
  })
})
