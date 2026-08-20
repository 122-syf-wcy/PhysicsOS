import { describe, expect, it } from 'vitest'

import { type ActorRef, type TraceContext, quantityVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { asCommandId, asObservableId, asSceneId, asTraceId } from '@physicsos/shared'
import { quantity, type Quantity } from '@physicsos/physics-units'

import {
  SCENE_COMMAND_SCHEMA,
  SCENE_REVISION_CONFLICT,
  SceneRuntime,
  defaultCoordinateSystem,
  type PhysicsEvent,
  type PhysicsScene,
  type SceneCommand,
} from '../src/index.ts'

const ISSUED_AT = '2026-08-17T02:00:00.000Z'
const OCCURRED_AT = '2026-08-17T02:00:01.000Z'
const ACTOR = { type: 'user', id: 'user-1' } satisfies ActorRef
const TRACE = { traceId: asTraceId('trace-1') } satisfies TraceContext
const OBSERVABLE_ID = asObservableId('observable-force')

const magneticScene = (): PhysicsScene => ({
  schemaVersion: 'physics-scene/1.0',
  id: asSceneId('scene-magnetic-runtime'),
  revision: 5,
  dimension: '2d',
  coordinateSystem: defaultCoordinateSystem(),
  timeline: {
    currentTime: quantity(0, 's', 'time'),
    startTime: quantity(0, 's', 'time'),
    state: 'idle',
    playbackRate: 1,
  },
  bodies: [],
  particles: [
    {
      id: 'particle-1',
      type: 'particle',
      mass: quantity(2, 'kg', 'mass'),
      charge: quantity(1, 'C', 'electric_charge'),
      position: quantityVector(vec3(0, 0, 0), 'm', 'length'),
      velocity: quantityVector(vec3(3, 0, 0), 'm/s', 'velocity'),
    },
  ],
  fields: [
    {
      id: 'field-1',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, 0.5), 'T', 'magnetic_flux_density'),
    },
  ],
  forces: [],
  regions: [],
  boundaries: [],
  constraints: [],
  circuits: [],
  measurementDefinitions: [],
  observableDefinitions: [
    {
      id: OBSERVABLE_ID,
      type: 'force',
      targetId: 'particle-1',
      visible: true,
    },
  ],
  annotations: [],
  metadata: {
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  },
})

const runtimeFor = (scene = magneticScene()) => new SceneRuntime(scene, { now: () => OCCURRED_AT })

const commandMetadata = (
  scene: PhysicsScene,
  commandId: string,
  expectedRevision = scene.revision,
) => ({
  schemaVersion: SCENE_COMMAND_SCHEMA,
  commandId: asCommandId(commandId),
  sceneId: scene.id,
  expectedRevision,
  actor: ACTOR,
  trace: TRACE,
  issuedAt: ISSUED_AT,
})

const executeSingleEvent = (runtime: SceneRuntime, command: SceneCommand): PhysicsEvent => {
  const previousRevision = runtime.getScene().revision
  const previousEventCount = runtime.getEvents().length
  const result = runtime.execute(command)

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(result.previousRevision).toBe(previousRevision)
  expect(result.newRevision).toBe(previousRevision + 1)
  expect(result.eventIds).toHaveLength(1)
  expect(runtime.getScene().revision).toBe(previousRevision + 1)
  expect(runtime.getEvents()).toHaveLength(previousEventCount + 1)

  const event = runtime.getEvents()[previousEventCount]
  if (event === undefined) throw new Error('Expected one appended event.')
  expect(event.eventId).toBe(result.eventIds[0])
  expect(event.schemaVersion).toBe('physics-event/1.0')
  expect(event.sceneId).toBe(command.sceneId)
  expect(event.revision).toBe(previousRevision + 1)
  expect(event.commandId).toBe(command.commandId)
  expect(event.actor).toEqual(command.actor)
  expect(event.trace).toEqual(command.trace)
  expect(event.occurredAt).toBe(OCCURRED_AT)
  return event
}

const expectRejectedWithoutWrites = (
  runtime: SceneRuntime,
  command: SceneCommand,
  errorCode: string,
): void => {
  const beforeScene = runtime.getScene()
  const beforeEvents = runtime.getEvents()
  const result = runtime.execute(command)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected command rejection.')
  expect(result.error.code).toBe(errorCode)
  expect(runtime.getScene()).toEqual(beforeScene)
  expect(runtime.getEvents()).toEqual(beforeEvents)
}

describe('Scene Runtime commands, events and revisions', () => {
  it('executes SetParticleCharge and emits ParticleChargeChanged', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-charge'),
      type: 'SetParticleCharge',
      payload: {
        particleId: 'particle-1',
        charge: quantity(-2, 'C', 'electric_charge'),
      },
    } satisfies SceneCommand<'SetParticleCharge'>

    const event = executeSingleEvent(runtime, command)
    expect(runtime.getScene().particles[0]?.charge).toEqual(command.payload.charge)
    expect(event.type).toBe('ParticleChargeChanged')
    if (event.type !== 'ParticleChargeChanged') throw new Error('Unexpected event type.')
    expect(event.payload).toEqual(command.payload)
  })

  it('executes SetParticleMass and emits ParticleMassChanged', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-mass'),
      type: 'SetParticleMass',
      payload: { particleId: 'particle-1', mass: quantity(4, 'kg', 'mass') },
    } satisfies SceneCommand<'SetParticleMass'>

    const event = executeSingleEvent(runtime, command)
    expect(runtime.getScene().particles[0]?.mass).toEqual(command.payload.mass)
    expect(event.type).toBe('ParticleMassChanged')
    if (event.type !== 'ParticleMassChanged') throw new Error('Unexpected event type.')
    expect(event.payload).toEqual(command.payload)
  })

  it('executes SetParticleVelocity and emits ParticleVelocityChanged', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-velocity'),
      type: 'SetParticleVelocity',
      payload: {
        particleId: 'particle-1',
        velocity: quantityVector(vec3(0, 6, 0), 'm/s', 'velocity'),
      },
    } satisfies SceneCommand<'SetParticleVelocity'>

    const event = executeSingleEvent(runtime, command)
    expect(runtime.getScene().particles[0]?.velocity).toEqual(command.payload.velocity)
    expect(event.type).toBe('ParticleVelocityChanged')
    if (event.type !== 'ParticleVelocityChanged') throw new Error('Unexpected event type.')
    expect(event.payload).toEqual(command.payload)
  })

  it('executes SetMagneticFieldStrength while preserving field direction', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-field-strength'),
      type: 'SetMagneticFieldStrength',
      payload: {
        fieldId: 'field-1',
        strength: quantity(1, 'T', 'magnetic_flux_density'),
      },
    } satisfies SceneCommand<'SetMagneticFieldStrength'>

    const event = executeSingleEvent(runtime, command)
    const field = runtime.getScene().fields[0]
    expect(field?.type).toBe('uniform_magnetic')
    if (field?.type !== 'uniform_magnetic') throw new Error('Expected a uniform magnetic field.')
    expect(field.magneticFluxDensity).toEqual(
      quantityVector(vec3(0, 0, 1), 'T', 'magnetic_flux_density'),
    )
    expect(event.type).toBe('MagneticFieldStrengthChanged')
    if (event.type !== 'MagneticFieldStrengthChanged') throw new Error('Unexpected event type.')
    expect(event.payload).toEqual(command.payload)
  })

  it('executes SetMagneticFieldDirection while preserving field magnitude', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-field-direction'),
      type: 'SetMagneticFieldDirection',
      payload: { fieldId: 'field-1', direction: 'into_page' },
    } satisfies SceneCommand<'SetMagneticFieldDirection'>

    const event = executeSingleEvent(runtime, command)
    const field = runtime.getScene().fields[0]
    expect(field?.type).toBe('uniform_magnetic')
    if (field?.type !== 'uniform_magnetic') throw new Error('Expected a uniform magnetic field.')
    expect(field.magneticFluxDensity.vector).toEqual(vec3(0, 0, -0.5))
    expect(event.type).toBe('MagneticFieldDirectionChanged')
    if (event.type !== 'MagneticFieldDirectionChanged') throw new Error('Unexpected event type.')
    expect(event.payload).toEqual(command.payload)
  })

  it('executes SetObservableEnabled and emits the exact disabled/enabled event', () => {
    const runtime = runtimeFor()
    const initial = runtime.getScene()
    const disable = {
      ...commandMetadata(initial, 'command-observable-disable'),
      type: 'SetObservableEnabled',
      payload: { observableId: OBSERVABLE_ID, enabled: false },
    } satisfies SceneCommand<'SetObservableEnabled'>

    const disabledEvent = executeSingleEvent(runtime, disable)
    expect(runtime.getScene().observableDefinitions[0]?.visible).toBe(false)
    expect(disabledEvent.type).toBe('ObservableDisabled')
    if (disabledEvent.type !== 'ObservableDisabled') throw new Error('Unexpected event type.')
    expect(disabledEvent.payload).toEqual({ observableId: OBSERVABLE_ID, enabled: false })

    const afterDisable = runtime.getScene()
    const enable = {
      ...commandMetadata(afterDisable, 'command-observable-enable'),
      type: 'SetObservableEnabled',
      payload: { observableId: OBSERVABLE_ID, enabled: true },
    } satisfies SceneCommand<'SetObservableEnabled'>

    const enabledEvent = executeSingleEvent(runtime, enable)
    expect(runtime.getScene().observableDefinitions[0]?.visible).toBe(true)
    expect(enabledEvent.type).toBe('ObservableEnabled')
    if (enabledEvent.type !== 'ObservableEnabled') throw new Error('Unexpected event type.')
    expect(enabledEvent.payload).toEqual({ observableId: OBSERVABLE_ID, enabled: true })
  })
})

describe('Scene Runtime rejection is atomic', () => {
  it('returns SCENE_REVISION_CONFLICT without changing scene, revision or events', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-conflict', scene.revision - 1),
      type: 'SetMagneticFieldStrength',
      payload: {
        fieldId: 'field-1',
        strength: quantity(1, 'T', 'magnetic_flux_density'),
      },
    } satisfies SceneCommand<'SetMagneticFieldStrength'>

    expectRejectedWithoutWrites(runtime, command, SCENE_REVISION_CONFLICT)
  })

  it('rejects missing particle, magnetic field and observable targets without writes', () => {
    const particleRuntime = runtimeFor()
    const particleScene = particleRuntime.getScene()
    const particleCommand = {
      ...commandMetadata(particleScene, 'command-missing-particle'),
      type: 'SetParticleMass',
      payload: { particleId: 'missing-particle', mass: quantity(1, 'kg', 'mass') },
    } satisfies SceneCommand<'SetParticleMass'>
    expectRejectedWithoutWrites(particleRuntime, particleCommand, 'PARTICLE_NOT_FOUND')

    const fieldRuntime = runtimeFor()
    const fieldScene = fieldRuntime.getScene()
    const fieldCommand = {
      ...commandMetadata(fieldScene, 'command-missing-field'),
      type: 'SetMagneticFieldDirection',
      payload: { fieldId: 'missing-field', direction: 'out_of_page' },
    } satisfies SceneCommand<'SetMagneticFieldDirection'>
    expectRejectedWithoutWrites(fieldRuntime, fieldCommand, 'MAGNETIC_FIELD_NOT_FOUND')

    const observableRuntime = runtimeFor()
    const observableScene = observableRuntime.getScene()
    const observableCommand = {
      ...commandMetadata(observableScene, 'command-missing-observable'),
      type: 'SetObservableEnabled',
      payload: { observableId: asObservableId('missing-observable'), enabled: false },
    } satisfies SceneCommand<'SetObservableEnabled'>
    expectRejectedWithoutWrites(observableRuntime, observableCommand, 'OBSERVABLE_NOT_FOUND')
  })

  it('rejects a sceneId mismatch without writes', () => {
    const runtime = runtimeFor()
    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-wrong-scene'),
      sceneId: asSceneId('other-scene'),
      type: 'SetParticleCharge',
      payload: {
        particleId: 'particle-1',
        charge: quantity(2, 'C', 'electric_charge'),
      },
    } satisfies SceneCommand<'SetParticleCharge'>

    expectRejectedWithoutWrites(runtime, command, 'SCENE_ID_MISMATCH')
  })

  it('uses the unit registry and domain rules before committing a command', () => {
    const wrongUnitMass = {
      value: 1,
      unit: 'm',
      dimension: 'mass',
    } satisfies Quantity<'mass'>
    const unitRuntime = runtimeFor()
    const unitScene = unitRuntime.getScene()
    const wrongUnitCommand = {
      ...commandMetadata(unitScene, 'command-wrong-unit'),
      type: 'SetParticleMass',
      payload: { particleId: 'particle-1', mass: wrongUnitMass },
    } satisfies SceneCommand<'SetParticleMass'>
    expectRejectedWithoutWrites(unitRuntime, wrongUnitCommand, 'DIMENSION_MISMATCH')

    const massRuntime = runtimeFor()
    const massScene = massRuntime.getScene()
    const zeroMassCommand = {
      ...commandMetadata(massScene, 'command-zero-mass'),
      type: 'SetParticleMass',
      payload: { particleId: 'particle-1', mass: quantity(0, 'kg', 'mass') },
    } satisfies SceneCommand<'SetParticleMass'>
    expectRejectedWithoutWrites(massRuntime, zeroMassCommand, 'INVALID_PARTICLE_MASS')

    const fieldRuntime = runtimeFor()
    const fieldScene = fieldRuntime.getScene()
    const negativeStrengthCommand = {
      ...commandMetadata(fieldScene, 'command-negative-field'),
      type: 'SetMagneticFieldStrength',
      payload: {
        fieldId: 'field-1',
        strength: quantity(-1, 'T', 'magnetic_flux_density'),
      },
    } satisfies SceneCommand<'SetMagneticFieldStrength'>
    expectRejectedWithoutWrites(
      fieldRuntime,
      negativeStrengthCommand,
      'INVALID_MAGNETIC_FIELD_STRENGTH',
    )
  })

  it('does not expose mutable references to the current scene or event store', () => {
    const initial = magneticScene()
    const runtime = runtimeFor(initial)
    initial.revision = 99
    const initialParticle = initial.particles[0]
    if (initialParticle === undefined) throw new Error('Expected initial particle.')
    initialParticle.mass.value = 99
    expect(runtime.getScene().revision).toBe(5)
    expect(runtime.getScene().particles[0]?.mass.value).toBe(2)

    const leakedScene = runtime.getScene()
    leakedScene.revision = 88
    const leakedParticle = leakedScene.particles[0]
    if (leakedParticle === undefined) throw new Error('Expected leaked particle.')
    leakedParticle.mass.value = 88
    expect(runtime.getScene().revision).toBe(5)
    expect(runtime.getScene().particles[0]?.mass.value).toBe(2)

    const scene = runtime.getScene()
    const command = {
      ...commandMetadata(scene, 'command-clone-event'),
      type: 'SetParticleCharge',
      payload: {
        particleId: 'particle-1',
        charge: quantity(3, 'C', 'electric_charge'),
      },
    } satisfies SceneCommand<'SetParticleCharge'>
    executeSingleEvent(runtime, command)

    const returnedEvent = runtime.getEvents()[0]
    if (returnedEvent?.type !== 'ParticleChargeChanged') {
      throw new Error('Expected ParticleChargeChanged event.')
    }
    returnedEvent.payload.charge.value = 77
    const storedEvent = runtime.getEvents()[0]
    if (storedEvent?.type !== 'ParticleChargeChanged') {
      throw new Error('Expected ParticleChargeChanged event.')
    }
    expect(storedEvent.payload.charge.value).toBe(3)

    const velocityScene = runtime.getScene()
    const velocityCommand = {
      ...commandMetadata(velocityScene, 'command-clone-velocity'),
      type: 'SetParticleVelocity',
      payload: {
        particleId: 'particle-1',
        velocity: quantityVector(vec3(0, 4, 0), 'm/s', 'velocity'),
      },
    } satisfies SceneCommand<'SetParticleVelocity'>
    executeSingleEvent(runtime, velocityCommand)
    velocityCommand.payload.velocity.vector.y = 99
    expect(runtime.getScene().particles[0]?.velocity.vector).toEqual(vec3(0, 4, 0))
  })
})
