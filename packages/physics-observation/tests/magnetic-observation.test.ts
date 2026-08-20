import { describe, expect, it } from 'vitest'

import { findDerived, isScalarQuantity } from '@physicsos/physics-core'
import { createMagneticScene, createSceneCommand, SceneRuntime } from '@physicsos/physics-scene'

import { createMagneticSimulationRequest, MagneticEngine } from '../../engine-magnetic/src/index.ts'
import { observeMagneticScene } from '../src/index.ts'

const run = (scene: ReturnType<typeof createMagneticScene>) => {
  const engine = new MagneticEngine()
  const simulation = engine.simulate(
    scene,
    createMagneticSimulationRequest(
      scene,
      `simulation-${scene.revision}`,
      `trace-${scene.revision}`,
    ),
  )
  return { engine, simulation }
}

describe('observeMagneticScene', () => {
  it('maps verified Engine facts into the five renderer-neutral observation types', () => {
    const scene = createMagneticScene({
      observableVisibility: {
        velocity: true,
        force: true,
        trajectory: true,
        center: true,
        radius: true,
      },
    })
    const { engine, simulation } = run(scene)
    const state = engine.stateAtSeconds(scene, simulation.states[1]?.time.value ?? 0)
    const observed = observeMagneticScene({ scene, simulation, state })

    expect(observed.sceneRevision).toBe(scene.revision)
    expect(observed.observations.map((entry) => entry.type).sort()).toEqual([
      'lorentz_force',
      'orbit_center',
      'radius',
      'trajectory',
      'velocity',
    ])
    expect(observed.observations.every((entry) => entry.time.value === state.time.value)).toBe(true)
    const trajectory = observed.observations.find((entry) => entry.type === 'trajectory')
    expect(trajectory?.points.length).toBeGreaterThanOrEqual(65)
  })

  it('removes a disabled force observation without removing the Engine force fact', () => {
    const initial = createMagneticScene()
    const runtime = new SceneRuntime(initial)
    const forceDefinition = initial.observableDefinitions.find((entry) => entry.type === 'force')
    if (forceDefinition === undefined) throw new Error('Magnetic fixture has no force observable.')
    const result = runtime.execute(
      createSceneCommand({
        commandId: 'disable-force',
        sceneId: String(initial.id),
        expectedRevision: initial.revision,
        type: 'SetObservableEnabled',
        payload: { observableId: forceDefinition.id, enabled: false },
        traceId: 'disable-force-trace',
        issuedAt: '2026-08-17T00:00:00.000Z',
      }),
    )
    expect(result.ok).toBe(true)

    const scene = runtime.getScene()
    const { simulation } = run(scene)
    const observed = observeMagneticScene({ scene, simulation })

    expect(observed.observations.some((entry) => entry.type === 'lorentz_force')).toBe(false)
    expect(findDerived(simulation.derivedQuantities, 'lorentz_force_vector')).toBeDefined()
  })

  it('rejects a scene/result revision mismatch', () => {
    const scene = createMagneticScene()
    const { simulation } = run(scene)
    const mismatched = structuredClone(simulation)
    mismatched.sceneRevision += 1

    expect(() => observeMagneticScene({ scene, simulation: mismatched })).toThrow(
      /same scene revision/,
    )
  })

  it('validates derived dimensions at the Observation boundary', () => {
    const scene = createMagneticScene({ observableVisibility: { radius: true } })
    const { simulation } = run(scene)
    const broken = structuredClone(simulation)
    const radius = findDerived(broken.derivedQuantities, 'cyclotron_radius')
    if (radius === undefined || !isScalarQuantity(radius.value)) {
      throw new Error('Magnetic result has no scalar radius.')
    }
    radius.value.dimension = 'time'
    radius.value.unit = 's'

    expect(() => observeMagneticScene({ scene, simulation: broken })).toThrow(
      /dimension "time" but "length" was required/,
    )
  })
})
