import { describe, expect, it } from 'vitest'

import { createMagneticSimulationRequest, MagneticEngine } from '@physicsos/engine-magnetic'
import { derivedScalar, derivedVector, findDerived } from '@physicsos/physics-core'
import { observeMagneticScene } from '@physicsos/physics-observation'
import {
  createMagneticScene,
  createSceneCommand,
  SceneRuntime,
  type PhysicsScene,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { verifyMagneticScene } from '@physicsos/physics-verifier'

const engine = new MagneticEngine()

const pipeline = (scene: PhysicsScene) => {
  const simulation = engine.simulate(
    scene,
    createMagneticSimulationRequest(
      scene,
      `simulation-${scene.revision}`,
      `pipeline-${scene.revision}`,
    ),
  )
  const verification = verifyMagneticScene(scene, simulation)
  const verifiedSimulation = { ...simulation, verification }
  const observations = observeMagneticScene({ scene, simulation: verifiedSimulation })
  return { simulation: verifiedSimulation, verification, observations }
}

const scalar = (result: ReturnType<typeof pipeline>, key: string): number =>
  derivedScalar(result.simulation.derivedQuantities, key).value

const vector = (result: ReturnType<typeof pipeline>, key: string) =>
  derivedVector(result.simulation.derivedQuantities, key).vector

const command = <TType extends SceneCommandType>(
  scene: PhysicsScene,
  type: TType,
  payload: Parameters<typeof createSceneCommand<TType>>[0]['payload'],
  expectedRevision = scene.revision,
) =>
  createSceneCommand({
    commandId: `command-${type}-${expectedRevision}`,
    sceneId: String(scene.id),
    expectedRevision,
    type,
    payload,
    traceId: `trace-${type}-${expectedRevision}`,
    issuedAt: '2026-08-17T00:00:00.000Z',
  })

describe('Magnetic Runtime vertical slice', () => {
  it('runs B 0.50 -> 1.00 through command, event, revision, engine, verifier and observation', () => {
    const runtime = new SceneRuntime(createMagneticScene({ magneticFieldStrength: 0.5 }))
    const beforeScene = runtime.getScene()
    const before = pipeline(beforeScene)
    const field = beforeScene.fields.find((candidate) => candidate.type === 'uniform_magnetic')
    if (field === undefined) throw new Error('Magnetic field missing.')

    const result = runtime.execute(
      command(beforeScene, 'SetMagneticFieldStrength', {
        fieldId: field.id,
        strength: { value: 1, unit: 'T', dimension: 'magnetic_flux_density' },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.newRevision).toBe(beforeScene.revision + 1)
    expect(runtime.getEvents().at(-1)?.type).toBe('MagneticFieldStrengthChanged')

    const after = pipeline(runtime.getScene())
    expect(after.verification.status).toBe('passed')
    expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(
      scalar(before, 'cyclotron_radius') / 2,
      12,
    )
    expect(scalar(after, 'cyclotron_period')).toBeCloseTo(
      scalar(before, 'cyclotron_period') / 2,
      12,
    )
    expect(scalar(after, 'angular_velocity')).toBeCloseTo(
      scalar(before, 'angular_velocity') * 2,
      12,
    )
    expect(scalar(after, 'lorentz_force_magnitude')).toBeCloseTo(
      scalar(before, 'lorentz_force_magnitude') * 2,
      12,
    )
    expect(after.observations.observations.some((entry) => entry.type === 'trajectory')).toBe(true)
  })

  it('reverses charge sign while preserving radius/period and reversing force/trajectory direction', () => {
    const runtime = new SceneRuntime(createMagneticScene({ charge: Math.abs(1.6e-19) }))
    const beforeScene = runtime.getScene()
    const before = pipeline(beforeScene)
    const particle = beforeScene.particles[0]
    if (particle === undefined) throw new Error('Particle missing.')

    const result = runtime.execute(
      command(beforeScene, 'SetParticleCharge', {
        particleId: particle.id,
        charge: { value: -Math.abs(1.6e-19), unit: 'C', dimension: 'electric_charge' },
      }),
    )
    expect(result.ok).toBe(true)

    const after = pipeline(runtime.getScene())
    expect(after.verification.status).toBe('passed')
    expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(scalar(before, 'cyclotron_radius'), 12)
    expect(scalar(after, 'cyclotron_period')).toBeCloseTo(scalar(before, 'cyclotron_period'), 12)
    expect(scalar(after, 'rotation_direction')).toBe(-scalar(before, 'rotation_direction'))
    const forceBefore = vector(before, 'lorentz_force_vector')
    const forceAfter = vector(after, 'lorentz_force_vector')
    expect(forceAfter.x).toBeCloseTo(-forceBefore.x, 12)
    expect(forceAfter.y).toBeCloseTo(-forceBefore.y, 12)
    expect(forceAfter.z).toBeCloseTo(-forceBefore.z, 12)
    const beforeTrajectory = before.observations.observations.find(
      (entry) => entry.type === 'trajectory',
    )
    const afterTrajectory = after.observations.observations.find(
      (entry) => entry.type === 'trajectory',
    )
    expect(beforeTrajectory?.direction).not.toBe(afterTrajectory?.direction)
  })

  it('reverses magnetic-field direction while preserving radius and passing verification', () => {
    const runtime = new SceneRuntime(createMagneticScene({ magneticFieldDirection: 'into_page' }))
    const beforeScene = runtime.getScene()
    const before = pipeline(beforeScene)
    const field = beforeScene.fields.find((candidate) => candidate.type === 'uniform_magnetic')
    if (field === undefined) throw new Error('Magnetic field missing.')

    const result = runtime.execute(
      command(beforeScene, 'SetMagneticFieldDirection', {
        fieldId: field.id,
        direction: 'out_of_page',
      }),
    )
    expect(result.ok).toBe(true)

    const after = pipeline(runtime.getScene())
    expect(after.verification.status).toBe('passed')
    expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(scalar(before, 'cyclotron_radius'), 12)
    expect(scalar(after, 'rotation_direction')).toBe(-scalar(before, 'rotation_direction'))
    const forceBefore = vector(before, 'lorentz_force_vector')
    const forceAfter = vector(after, 'lorentz_force_vector')
    expect(forceAfter.x).toBeCloseTo(-forceBefore.x, 12)
    expect(forceAfter.y).toBeCloseTo(-forceBefore.y, 12)
    expect(forceAfter.z).toBeCloseTo(-forceBefore.z, 12)
  })

  it('disables Force Observation without removing the Engine force fact and restores it', () => {
    const runtime = new SceneRuntime(createMagneticScene())
    const initial = runtime.getScene()
    const forceDefinition = initial.observableDefinitions.find((entry) => entry.type === 'force')
    if (forceDefinition === undefined) throw new Error('Force observable missing.')

    const disabled = runtime.execute(
      command(initial, 'SetObservableEnabled', {
        observableId: forceDefinition.id,
        enabled: false,
      }),
    )
    expect(disabled.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('ObservableDisabled')
    const withoutForce = pipeline(runtime.getScene())
    expect(
      findDerived(withoutForce.simulation.derivedQuantities, 'lorentz_force_vector'),
    ).toBeDefined()
    expect(
      withoutForce.observations.observations.some((entry) => entry.type === 'lorentz_force'),
    ).toBe(false)

    const current = runtime.getScene()
    const enabled = runtime.execute(
      command(current, 'SetObservableEnabled', {
        observableId: forceDefinition.id,
        enabled: true,
      }),
    )
    expect(enabled.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('ObservableEnabled')
    expect(
      pipeline(runtime.getScene()).observations.observations.some(
        (entry) => entry.type === 'lorentz_force',
      ),
    ).toBe(true)
  })

  it('rejects a stale expectedRevision atomically', () => {
    const runtime = new SceneRuntime(createMagneticScene({ revision: 5 }))
    const scene = runtime.getScene()
    const field = scene.fields.find((candidate) => candidate.type === 'uniform_magnetic')
    if (field === undefined) throw new Error('Magnetic field missing.')
    const beforeStrength = field.magneticFluxDensity.vector.z

    const result = runtime.execute(
      command(
        scene,
        'SetMagneticFieldStrength',
        {
          fieldId: field.id,
          strength: { value: 1, unit: 'T', dimension: 'magnetic_flux_density' },
        },
        4,
      ),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SCENE_REVISION_CONFLICT')
    expect(runtime.getScene().revision).toBe(5)
    const unchangedField = runtime
      .getScene()
      .fields.find((candidate) => candidate.type === 'uniform_magnetic')
    expect(unchangedField?.magneticFluxDensity.vector.z).toBe(beforeStrength)
    expect(runtime.getEvents()).toHaveLength(0)
  })
})
