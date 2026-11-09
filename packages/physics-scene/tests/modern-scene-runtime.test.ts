import { describe, expect, it } from 'vitest'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'

import {
  createPhotoelectricEffectScene,
  createSceneCommand,
  forkExperimentalScene,
  SceneRuntime,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const now = '2026-11-08T00:00:00.000Z'

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.peekScene()
  return runtime.execute(
    createSceneCommand({
      commandId: `modern-${type}-${scene.revision}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `modern-${type}`,
      issuedAt: now,
    }) as SceneCommand,
  )
}

const benchIdOf = (runtime: SceneRuntime) => runtime.peekScene().modernPhysicsBenches![0]!.id

const mutations = [
  {
    type: 'SetPhotoelectricWorkFunction',
    payload: { workFunction: quantity(3.2e-19, 'J', 'energy') },
    field: 'workFunction',
    event: 'PhotoelectricWorkFunctionChanged',
  },
  {
    type: 'SetPhotonWavelength',
    payload: { wavelength: quantity(0.00004, 'cm', 'length') },
    field: 'photonWavelength',
    event: 'PhotonWavelengthChanged',
  },
  {
    type: 'SetLightIntensity',
    payload: { intensity: quantity(30, 'W/m²', 'intensity') },
    field: 'lightIntensity',
    event: 'LightIntensityChanged',
  },
  {
    type: 'SetCathodeArea',
    payload: { area: quantity(0.0002, 'm²', 'area') },
    field: 'cathodeArea',
    event: 'CathodeAreaChanged',
  },
  {
    type: 'SetQuantumEfficiency',
    payload: { efficiency: 0.25 },
    field: 'quantumEfficiency',
    event: 'QuantumEfficiencyChanged',
  },
] as const

describe('photoelectric scene commands', () => {
  it.each(mutations)('$type edits a physical field and records its own event', (mutation) => {
    const source = createPhotoelectricEffectScene()
    const before = structuredClone(source)
    const runtime = new SceneRuntime(source, { now: () => now })
    const benchId = benchIdOf(runtime)
    const payload = { benchId, ...mutation.payload }
    const result = execute(runtime, mutation.type, payload)

    expect(result.ok).toBe(true)
    expect(runtime.peekScene().revision).toBe(source.revision + 1)
    expect(runtime.peekScene().metadata.updatedAt).toBe(now)
    expect(runtime.getEvents()[0]).toMatchObject({
      type: mutation.event,
      payload,
      sceneId: source.id,
      revision: source.revision + 1,
    })
    const value = Object.values(mutation.payload)[0]
    expect(runtime.peekScene().modernPhysicsBenches![0]![mutation.field]).toEqual(value)
    expect(source).toEqual(before)
  })

  it('preserves a non-SI wavelength and detaches scene and event payloads from the command', () => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
    const wavelength = quantity(0.00004, 'cm', 'length')
    expect(execute(runtime, 'SetPhotonWavelength', { benchId: benchIdOf(runtime), wavelength }).ok).toBe(true)
    wavelength.value = 999

    const held = runtime.peekScene()
    expect(held.modernPhysicsBenches![0]!.photonWavelength.unit).toBe('cm')
    expect(canonicalValue(held.modernPhysicsBenches![0]!.photonWavelength)).toBeCloseTo(4e-7, 15)
    expect(Object.isFrozen(held.modernPhysicsBenches![0]!.photonWavelength)).toBe(true)
    const events = runtime.getEvents()
    expect(events[0]).toMatchObject({
      type: 'PhotonWavelengthChanged',
      payload: { wavelength: { value: 0.00004, unit: 'cm', dimension: 'length' } },
    })
  })

  it.each([0, 1])('accepts quantum efficiency %s without substituting a cathode material', (efficiency) => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
    const workFunction = structuredClone(runtime.peekScene().modernPhysicsBenches![0]!.workFunction)
    expect(execute(runtime, 'SetQuantumEfficiency', { benchId: benchIdOf(runtime), efficiency }).ok).toBe(true)
    expect(runtime.peekScene().modernPhysicsBenches![0]!.quantumEfficiency).toBe(efficiency)
    expect(runtime.peekScene().modernPhysicsBenches![0]!.workFunction).toEqual(workFunction)
  })

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1, '0.5', null])(
    'rejects invalid quantum efficiency %s atomically',
    (efficiency) => {
      const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
      const before = runtime.peekScene()
      const result = execute(runtime, 'SetQuantumEfficiency', {
        benchId: benchIdOf(runtime),
        efficiency: efficiency as number,
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected invalid quantum efficiency to be rejected.')
      expect(result.error.code).toBe('INVALID_QUANTUM_EFFICIENCY')
      expect(runtime.peekScene()).toBe(before)
      expect(runtime.getEvents()).toEqual([])
    },
  )

  it.each([
    ['SetPhotoelectricWorkFunction', 'workFunction', 'J', 'energy'],
    ['SetPhotonWavelength', 'wavelength', 'm', 'length'],
    ['SetLightIntensity', 'intensity', 'W/m²', 'intensity'],
    ['SetCathodeArea', 'area', 'm²', 'area'],
  ] as const)('rejects zero, negative and non-finite %s quantities without committing', (type, key, unit, dimension) => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
    const before = runtime.peekScene()
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      const payload = { benchId: benchIdOf(runtime), [key]: { value, unit, dimension } }
      const result = execute(runtime, type, payload as SceneCommandPayloadMap[typeof type])
      expect(result.ok, `${type} value ${String(value)}`).toBe(false)
      expect(runtime.peekScene()).toBe(before)
      expect(runtime.getEvents()).toEqual([])
    }
  })

  it.each([null, 1, '400 nm', { value: 400, unit: 'nm' }, { value: '400', unit: 'nm', dimension: 'length' }])(
    'rejects malformed wavelength %s instead of coercing it',
    (wavelength) => {
      const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
      const before = runtime.peekScene()
      expect(execute(runtime, 'SetPhotonWavelength', {
        benchId: benchIdOf(runtime),
        wavelength: wavelength as unknown as Quantity<'length'>,
      }).ok).toBe(false)
      expect(runtime.peekScene()).toBe(before)
      expect(runtime.getEvents()).toEqual([])
    },
  )

  it.each(['', '   ', 'missing-modern-bench'])('rejects invalid or missing bench id %j without mutating any scene', (benchId) => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
    const before = runtime.peekScene()
    const result = execute(runtime, 'SetQuantumEfficiency', { benchId, efficiency: 0.2 })
    expect(result.ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it('rejects an unsupported modern submodel before changing its physical fields', () => {
    const scene = createPhotoelectricEffectScene()
    Reflect.set(scene.modernPhysicsBenches![0]!, 'type', 'atomic_energy_level')
    const runtime = new SceneRuntime(scene, { now: () => now })
    const before = runtime.peekScene()
    const result = execute(runtime, 'SetQuantumEfficiency', { benchId: benchIdOf(runtime), efficiency: 0.2 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected unsupported modern submodel.')
    expect(result.error.code).toBe('MODERN_PHYSICS_WRONG_SUBMODEL')
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it('rejects the wrong quantity dimension, a missing bench and a stale scene revision', () => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene(), { now: () => now })
    const before = runtime.peekScene()
    const benchId = benchIdOf(runtime)
    const wrongDimension = execute(runtime, 'SetPhotonWavelength', {
      benchId,
      wavelength: quantity(400, 'J', 'energy') as unknown as Quantity<'length'>,
    })
    expect(wrongDimension.ok).toBe(false)
    if (wrongDimension.ok) throw new Error('Expected a dimension mismatch.')
    expect(wrongDimension.error.code).toBe('DIMENSION_MISMATCH')
    const missing = execute(runtime, 'SetCathodeArea', {
      benchId: 'missing-modern-bench',
      area: quantity(1, 'm²', 'area'),
    })
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('Expected a missing bench.')
    expect(missing.error.code).toBe('MODERN_PHYSICS_BENCH_NOT_FOUND')
    const stale = runtime.execute(createSceneCommand({
      commandId: 'stale-modern',
      sceneId: String(before.id),
      expectedRevision: before.revision + 1,
      type: 'SetQuantumEfficiency',
      payload: { benchId, efficiency: 0.2 },
      traceId: 'stale-modern',
      issuedAt: now,
    }))
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('Expected a revision conflict.')
    expect(stale.error.code).toBe('SCENE_REVISION_CONFLICT')
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it('edits a fork without changing the question scene or its original work function', () => {
    const source = createPhotoelectricEffectScene()
    const original = structuredClone(source)
    const fork = forkExperimentalScene({ scene: source, sceneId: 'modern-command-fork', now })
    const runtime = new SceneRuntime(fork, { now: () => now })
    expect(execute(runtime, 'SetPhotoelectricWorkFunction', {
      benchId: benchIdOf(runtime),
      workFunction: quantity(4e-19, 'J', 'energy'),
    }).ok).toBe(true)
    expect(runtime.peekScene().metadata.lineage).toMatchObject({
      branchType: 'experimental',
      originSceneId: source.id,
      parentRevision: source.revision,
    })
    expect(runtime.peekScene().id).not.toBe(source.id)
    expect(runtime.peekScene().revision).toBe(1)
    expect(source).toEqual(original)
  })
})
