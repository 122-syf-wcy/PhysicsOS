import {
  DEFAULT_TOLERANCE,
  domainError,
  quantityVector,
  toCanonicalVector,
  withinTolerance,
  type ActorRef,
  type DomainError,
  type PhysicsTolerance,
  type QuantityVector,
  type TraceContext,
} from '@physicsos/physics-core'
import { canonicalValue, validateQuantity, type Quantity } from '@physicsos/physics-units'
import {
  asPhysicsEventId,
  isIsoDateTime,
  PhysicsOSError,
  type CommandId,
  type IsoDateTime,
  type ObservableId,
  type PhysicsEventId,
  type SceneId,
  type TraceId,
} from '@physicsos/shared'

import { validateScene } from './scene-validation.ts'
import type { PhysicsScene, UniformElectricField, UniformMagneticField } from './scene.ts'

export const SCENE_COMMAND_SCHEMA = 'scene-command/1.0' as const
export const PHYSICS_EVENT_SCHEMA = 'physics-event/1.0' as const
export const SCENE_REVISION_CONFLICT = 'SCENE_REVISION_CONFLICT' as const

export type ElectricFieldDirection = 'right' | 'left' | 'up' | 'down'

/** docs/03 §69 — command names frozen for the Magnetic + Mechanics + Electric Runtime slices. */
export type SceneCommandType =
  | 'SetParticleCharge'
  | 'SetParticleMass'
  | 'SetParticleVelocity'
  | 'SetMagneticFieldStrength'
  | 'SetMagneticFieldDirection'
  | 'SetElectricFieldStrength'
  | 'SetElectricFieldDirection'
  | 'SetObservableEnabled'
  | 'SetBodyMass'
  | 'SetBodyPosition'
  | 'SetBodyVelocity'
  | 'SetGravityAcceleration'
  | 'SetInclineAngle'
  | 'SetFrictionCoefficient'
  | 'SetAppliedForce'
  | 'SetGroundLevel'

/** docs/03 §69 — each discriminant has exactly one payload shape. */
export interface SceneCommandPayloadMap {
  SetParticleCharge: {
    particleId: string
    charge: Quantity<'electric_charge'>
  }
  SetParticleMass: {
    particleId: string
    mass: Quantity<'mass'>
  }
  SetParticleVelocity: {
    particleId: string
    velocity: QuantityVector<'velocity'>
  }
  SetMagneticFieldStrength: {
    fieldId: string
    strength: Quantity<'magnetic_flux_density'>
  }
  SetMagneticFieldDirection: {
    fieldId: string
    direction: 'into_page' | 'out_of_page'
  }
  SetElectricFieldStrength: {
    fieldId: string
    strength: Quantity<'electric_field'>
  }
  SetElectricFieldDirection: {
    fieldId: string
    direction: ElectricFieldDirection
  }
  SetObservableEnabled: {
    observableId: ObservableId
    enabled: boolean
  }
  SetBodyMass: {
    bodyId: string
    mass: Quantity<'mass'>
  }
  SetBodyPosition: {
    bodyId: string
    position: QuantityVector<'length'>
  }
  SetBodyVelocity: {
    bodyId: string
    velocity: QuantityVector<'velocity'>
  }
  SetGravityAcceleration: {
    fieldId: string
    acceleration: QuantityVector<'acceleration'>
  }
  SetInclineAngle: {
    observableId: ObservableId
    /** Degrees, strictly between 0 and 90 for a physical slope. */
    angleDegrees: number
  }
  SetFrictionCoefficient: {
    bodyId: string
    /** Dimensionless μ ≥ 0. */
    coefficient: number
  }
  SetAppliedForce: {
    forceId: string
    targetId: string
    vector: QuantityVector<'force'>
  }
  SetGroundLevel: {
    observableId: ObservableId
    /** Ground height in scene length units (SI metres). */
    groundY: number
  }
}

export type SceneCommandPayload<TType extends SceneCommandType> = SceneCommandPayloadMap[TType]

export interface SceneCommandEnvelope<
  TType extends SceneCommandType,
  TPayload extends SceneCommandPayloadMap[TType],
> {
  schemaVersion: typeof SCENE_COMMAND_SCHEMA
  commandId: CommandId
  sceneId: SceneId
  expectedRevision: number
  type: TType
  payload: TPayload
  actor: ActorRef
  trace: TraceContext
  issuedAt: IsoDateTime
}

/**
 * Distributive alias: using `SceneCommand` yields a discriminated union while
 * `SceneCommand<'SetParticleMass'>` selects one precise command.
 */
export type SceneCommand<TType extends SceneCommandType = SceneCommandType> =
  TType extends SceneCommandType
    ? SceneCommandEnvelope<TType, SceneCommandPayloadMap[TType]>
    : never

/** docs/03 §72 — exact events emitted by the supported commands. */
export type PhysicsEventType =
  | 'ParticleChargeChanged'
  | 'ParticleMassChanged'
  | 'ParticleVelocityChanged'
  | 'MagneticFieldStrengthChanged'
  | 'MagneticFieldDirectionChanged'
  | 'ElectricFieldStrengthChanged'
  | 'ElectricFieldDirectionChanged'
  | 'ObservableEnabled'
  | 'ObservableDisabled'
  | 'BodyMassChanged'
  | 'BodyPositionChanged'
  | 'BodyVelocityChanged'
  | 'GravityAccelerationChanged'
  | 'InclineAngleChanged'
  | 'FrictionCoefficientChanged'
  | 'AppliedForceChanged'
  | 'GroundLevelChanged'

export interface PhysicsEventPayloadMap {
  ParticleChargeChanged: SceneCommandPayloadMap['SetParticleCharge']
  ParticleMassChanged: SceneCommandPayloadMap['SetParticleMass']
  ParticleVelocityChanged: SceneCommandPayloadMap['SetParticleVelocity']
  MagneticFieldStrengthChanged: SceneCommandPayloadMap['SetMagneticFieldStrength']
  MagneticFieldDirectionChanged: SceneCommandPayloadMap['SetMagneticFieldDirection']
  ElectricFieldStrengthChanged: SceneCommandPayloadMap['SetElectricFieldStrength']
  ElectricFieldDirectionChanged: SceneCommandPayloadMap['SetElectricFieldDirection']
  ObservableEnabled: {
    observableId: ObservableId
    enabled: true
  }
  ObservableDisabled: {
    observableId: ObservableId
    enabled: false
  }
  BodyMassChanged: SceneCommandPayloadMap['SetBodyMass']
  BodyPositionChanged: SceneCommandPayloadMap['SetBodyPosition']
  BodyVelocityChanged: SceneCommandPayloadMap['SetBodyVelocity']
  GravityAccelerationChanged: SceneCommandPayloadMap['SetGravityAcceleration']
  InclineAngleChanged: SceneCommandPayloadMap['SetInclineAngle']
  FrictionCoefficientChanged: SceneCommandPayloadMap['SetFrictionCoefficient']
  AppliedForceChanged: SceneCommandPayloadMap['SetAppliedForce']
  GroundLevelChanged: SceneCommandPayloadMap['SetGroundLevel']
}

export type PhysicsEventPayload<TType extends PhysicsEventType> = PhysicsEventPayloadMap[TType]

export interface PhysicsEventEnvelope<
  TType extends PhysicsEventType,
  TPayload extends PhysicsEventPayloadMap[TType],
> {
  schemaVersion: typeof PHYSICS_EVENT_SCHEMA
  eventId: PhysicsEventId
  commandId: CommandId
  sceneId: SceneId
  revision: number
  type: TType
  payload: TPayload
  actor: ActorRef
  occurredAt: IsoDateTime
  trace: TraceContext
}

export type PhysicsEvent<TType extends PhysicsEventType = PhysicsEventType> =
  TType extends PhysicsEventType
    ? PhysicsEventEnvelope<TType, PhysicsEventPayloadMap[TType]>
    : never

export interface SceneCommandSuccess {
  ok: true
  sceneId: SceneId
  previousRevision: number
  newRevision: number
  eventIds: PhysicsEventId[]
  traceId: TraceId
}

export interface SceneCommandFailure {
  ok: false
  error: DomainError
  traceId: TraceId
}

/** docs/03 §70 */
export type SceneCommandResult = SceneCommandSuccess | SceneCommandFailure

export interface SceneRuntimeOptions {
  tolerance?: PhysicsTolerance
  now?: () => IsoDateTime
  eventIdFactory?: (sceneId: SceneId, revision: number, commandId: CommandId) => PhysicsEventId
}

interface EventContext {
  eventId: PhysicsEventId
  occurredAt: IsoDateTime
  revision: number
}

type ApplyCommandResult = { ok: true; event: PhysicsEvent } | { ok: false; error: DomainError }

const clone = <T>(value: T): T => structuredClone(value)

const defaultEventIdFactory = (
  sceneId: SceneId,
  revision: number,
  commandId: CommandId,
): PhysicsEventId => asPhysicsEventId(`${String(sceneId)}:event:${revision}:${String(commandId)}`)

const commandFailure = (error: DomainError, traceId: TraceId): SceneCommandFailure => ({
  ok: false,
  error,
  traceId,
})

const notFound = (
  targetType:
    | 'particle'
    | 'magnetic_field'
    | 'electric_field'
    | 'observable'
    | 'body'
    | 'gravity_field'
    | 'force',
  id: string,
) =>
  domainError(
    targetType === 'particle'
      ? 'PARTICLE_NOT_FOUND'
      : targetType === 'magnetic_field'
        ? 'MAGNETIC_FIELD_NOT_FOUND'
        : targetType === 'electric_field'
          ? 'ELECTRIC_FIELD_NOT_FOUND'
        : targetType === 'body'
          ? 'BODY_NOT_FOUND'
          : targetType === 'gravity_field'
            ? 'GRAVITY_FIELD_NOT_FOUND'
            : targetType === 'force'
              ? 'FORCE_NOT_FOUND'
              : 'OBSERVABLE_NOT_FOUND',
    `${targetType} target "${id}" does not exist in the current scene.`,
    'not_found',
    { details: { targetType, targetId: id } },
  )

const invalidCommand = (code: string, message: string, details?: Record<string, unknown>) =>
  domainError(code, message, 'validation', details === undefined ? undefined : { details })

const baseEvent = (command: SceneCommand, context: EventContext) => ({
  schemaVersion: PHYSICS_EVENT_SCHEMA,
  eventId: context.eventId,
  commandId: command.commandId,
  sceneId: command.sceneId,
  revision: context.revision,
  actor: clone(command.actor),
  occurredAt: context.occurredAt,
  trace: clone(command.trace),
})

const findMagneticField = (
  scene: PhysicsScene,
  fieldId: string,
): UniformMagneticField | undefined =>
  scene.fields.find(
    (field): field is UniformMagneticField =>
      field.id === fieldId && field.type === 'uniform_magnetic',
  )

const findElectricField = (
  scene: PhysicsScene,
  fieldId: string,
): UniformElectricField | undefined =>
  scene.fields.find(
    (field): field is UniformElectricField =>
      field.id === fieldId && field.type === 'uniform_electric',
  )

const electricDirectionVector = (direction: ElectricFieldDirection) => {
  switch (direction) {
    case 'right':
      return { x: 1, y: 0, z: 0 }
    case 'left':
      return { x: -1, y: 0, z: 0 }
    case 'up':
      return { x: 0, y: 1, z: 0 }
    case 'down':
      return { x: 0, y: -1, z: 0 }
  }
}

const projectedDirectionIsSupported = (
  field: UniformMagneticField,
  tolerance: PhysicsTolerance,
): boolean => {
  const canonical = toCanonicalVector(field.magneticFluxDensity).vectorSI
  const magnitude = Math.hypot(canonical.x, canonical.y, canonical.z)
  if (withinTolerance(magnitude, 0, tolerance)) return true
  const inPlaneRatio = Math.hypot(canonical.x, canonical.y) / magnitude
  return Number.isFinite(inPlaneRatio) && inPlaneRatio <= tolerance.angular
}

const applyCommand = (
  scene: PhysicsScene,
  command: SceneCommand,
  context: EventContext,
  tolerance: PhysicsTolerance,
): ApplyCommandResult => {
  const eventMetadata = baseEvent(command, context)

  switch (command.type) {
    case 'SetParticleCharge': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const charge = validateQuantity(command.payload.charge, 'electric_charge')
      particle.charge = charge
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleChargeChanged',
          payload: { particleId: command.payload.particleId, charge: clone(charge) },
        },
      }
    }

    case 'SetParticleMass': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_PARTICLE_MASS',
            'Particle mass must be greater than zero.',
            { particleId: command.payload.particleId, mass: command.payload.mass },
          ),
        }
      }
      particle.mass = mass
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleMassChanged',
          payload: { particleId: command.payload.particleId, mass: clone(mass) },
        },
      }
    }

    case 'SetParticleVelocity': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const velocity = quantityVector(
        clone(command.payload.velocity.vector),
        command.payload.velocity.unit,
        'velocity',
      )
      particle.velocity = velocity
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleVelocityChanged',
          payload: { particleId: command.payload.particleId, velocity: clone(velocity) },
        },
      }
    }

    case 'SetMagneticFieldStrength': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const field = findMagneticField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('magnetic_field', command.payload.fieldId) }
      }
      if (!projectedDirectionIsSupported(field, tolerance)) {
        return {
          ok: false,
          error: invalidCommand(
            'UNSUPPORTED_MAGNETIC_FIELD_DIRECTION',
            'The Magnetic Runtime only supports fields perpendicular to the xy plane.',
            { fieldId: command.payload.fieldId },
          ),
        }
      }
      const strength = validateQuantity(command.payload.strength, 'magnetic_flux_density')
      if (canonicalValue(strength) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MAGNETIC_FIELD_STRENGTH',
            'Magnetic field strength must be non-negative.',
            { fieldId: command.payload.fieldId, strength: command.payload.strength },
          ),
        }
      }
      const currentZ = toCanonicalVector(field.magneticFluxDensity).vectorSI.z
      const sign = currentZ < 0 ? -1 : 1
      field.magneticFluxDensity = quantityVector(
        { x: 0, y: 0, z: sign * Math.abs(strength.value) },
        strength.unit,
        'magnetic_flux_density',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MagneticFieldStrengthChanged',
          payload: { fieldId: command.payload.fieldId, strength: clone(strength) },
        },
      }
    }

    case 'SetMagneticFieldDirection': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      if (
        command.payload.direction !== 'into_page' &&
        command.payload.direction !== 'out_of_page'
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MAGNETIC_FIELD_DIRECTION',
            'direction must be "into_page" or "out_of_page".',
          ),
        }
      }
      const field = findMagneticField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('magnetic_field', command.payload.fieldId) }
      }
      if (!projectedDirectionIsSupported(field, tolerance)) {
        return {
          ok: false,
          error: invalidCommand(
            'UNSUPPORTED_MAGNETIC_FIELD_DIRECTION',
            'The Magnetic Runtime only supports fields perpendicular to the xy plane.',
            { fieldId: command.payload.fieldId },
          ),
        }
      }
      const current = field.magneticFluxDensity
      const magnitude = Math.hypot(current.vector.x, current.vector.y, current.vector.z)
      const sign = command.payload.direction === 'into_page' ? -1 : 1
      field.magneticFluxDensity = quantityVector(
        { x: 0, y: 0, z: sign * magnitude },
        current.unit,
        'magnetic_flux_density',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MagneticFieldDirectionChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetElectricFieldStrength': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const field = findElectricField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('electric_field', command.payload.fieldId) }
      }
      const strength = validateQuantity(command.payload.strength, 'electric_field')
      if (canonicalValue(strength) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ELECTRIC_FIELD_STRENGTH',
            'Electric field strength must be non-negative.',
            { fieldId: command.payload.fieldId, strength: command.payload.strength },
          ),
        }
      }
      const current = field.fieldStrength.vector
      const currentMagnitude = Math.hypot(current.x, current.y, current.z)
      const direction =
        currentMagnitude === 0
          ? electricDirectionVector('right')
          : {
              x: current.x / currentMagnitude,
              y: current.y / currentMagnitude,
              z: current.z / currentMagnitude,
            }
      field.fieldStrength = quantityVector(
        {
          x: direction.x * strength.value,
          y: direction.y * strength.value,
          z: direction.z * strength.value,
        },
        strength.unit,
        'electric_field',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ElectricFieldStrengthChanged',
          payload: { fieldId: command.payload.fieldId, strength: clone(strength) },
        },
      }
    }

    case 'SetElectricFieldDirection': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const directions: readonly ElectricFieldDirection[] = ['right', 'left', 'up', 'down']
      if (!directions.includes(command.payload.direction)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ELECTRIC_FIELD_DIRECTION',
            'direction must be right, left, up or down.',
          ),
        }
      }
      const field = findElectricField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('electric_field', command.payload.fieldId) }
      }
      const current = field.fieldStrength
      const fieldMagnitude = Math.hypot(current.vector.x, current.vector.y, current.vector.z)
      const direction = electricDirectionVector(command.payload.direction)
      field.fieldStrength = quantityVector(
        {
          x: direction.x * fieldMagnitude,
          y: direction.y * fieldMagnitude,
          z: 0,
        },
        current.unit,
        'electric_field',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ElectricFieldDirectionChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetObservableEnabled': {
      if (
        typeof command.payload.observableId !== 'string' ||
        command.payload.observableId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OBSERVABLE_ID',
            'observableId must be a non-empty string.',
          ),
        }
      }
      if (typeof command.payload.enabled !== 'boolean') {
        return {
          ok: false,
          error: invalidCommand('INVALID_OBSERVABLE_ENABLED', 'enabled must be a boolean.'),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.visible = command.payload.enabled
      return command.payload.enabled
        ? {
            ok: true,
            event: {
              ...eventMetadata,
              type: 'ObservableEnabled',
              payload: { observableId: command.payload.observableId, enabled: true },
            },
          }
        : {
            ok: true,
            event: {
              ...eventMetadata,
              type: 'ObservableDisabled',
              payload: { observableId: command.payload.observableId, enabled: false },
            },
          }
    }

    /* ---------------------------------------------------------- mechanics -- */

    case 'SetBodyMass': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_BODY_MASS', 'Body mass must be greater than zero.', {
            bodyId: command.payload.bodyId,
            mass: command.payload.mass,
          }),
        }
      }
      body.mass = mass
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyMassChanged',
          payload: { bodyId: command.payload.bodyId, mass: clone(mass) },
        },
      }
    }

    case 'SetBodyPosition': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const position = quantityVector(
        clone(command.payload.position.vector),
        command.payload.position.unit,
        'length',
      )
      body.position = position
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyPositionChanged',
          payload: { bodyId: command.payload.bodyId, position: clone(position) },
        },
      }
    }

    case 'SetBodyVelocity': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const velocity = quantityVector(
        clone(command.payload.velocity.vector),
        command.payload.velocity.unit,
        'velocity',
      )
      body.velocity = velocity
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyVelocityChanged',
          payload: { bodyId: command.payload.bodyId, velocity: clone(velocity) },
        },
      }
    }

    case 'SetGravityAcceleration': {
      const field = scene.fields.find(
        (entry) => entry.id === command.payload.fieldId && entry.type === 'uniform_gravity',
      )
      if (field === undefined || field.type !== 'uniform_gravity') {
        return { ok: false, error: notFound('gravity_field', command.payload.fieldId) }
      }
      const acceleration = quantityVector(
        clone(command.payload.acceleration.vector),
        command.payload.acceleration.unit,
        'acceleration',
      )
      field.acceleration = acceleration
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'GravityAccelerationChanged',
          payload: { fieldId: command.payload.fieldId, acceleration: clone(acceleration) },
        },
      }
    }

    case 'SetInclineAngle': {
      /* A slope at 0° is a floor and at 90° a wall: neither is the inclined-plane
         model, so the gate rejects them instead of letting the solver work on a
         degenerate geometry. */
      const angle = command.payload.angleDegrees
      if (!Number.isFinite(angle) || angle <= 0 || angle >= 90) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INCLINE_ANGLE',
            'Incline angle must be strictly between 0 and 90 degrees.',
            { angleDegrees: angle },
          ),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.parameters = { ...observable.parameters, kind: 'incline', angle }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InclineAngleChanged',
          payload: { observableId: command.payload.observableId, angleDegrees: angle },
        },
      }
    }

    case 'SetFrictionCoefficient': {
      const coefficient = command.payload.coefficient
      if (!Number.isFinite(coefficient) || coefficient < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_FRICTION_COEFFICIENT',
            'Friction coefficient must be a non-negative finite number.',
            { coefficient },
          ),
        }
      }
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      body.material = { ...body.material, frictionCoefficient: coefficient }
      /* μ > 0 must be backed by a friction force in the scene, or the resolver
         would read a coefficient the model never actually applies. */
      const hasFriction = scene.forces.some(
        (entry) => entry.type === 'friction' && entry.targetId === body.id,
      )
      if (coefficient > 0 && !hasFriction) {
        scene.forces.push({
          id: `force-friction-${body.id}`,
          type: 'friction',
          targetId: body.id,
          model: 'kinetic_friction',
        })
      }
      if (coefficient === 0 && hasFriction) {
        scene.forces = scene.forces.filter(
          (entry) => !(entry.type === 'friction' && entry.targetId === body.id),
        )
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'FrictionCoefficientChanged',
          payload: { bodyId: command.payload.bodyId, coefficient },
        },
      }
    }

    case 'SetAppliedForce': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.targetId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.targetId) }
      }
      const vector = quantityVector(
        clone(command.payload.vector.vector),
        command.payload.vector.unit,
        'force',
      )
      const existing = scene.forces.find((entry) => entry.id === command.payload.forceId)
      if (existing === undefined) {
        scene.forces.push({
          id: command.payload.forceId,
          type: 'custom',
          targetId: command.payload.targetId,
          vector,
          model: 'applied',
        })
      } else {
        existing.vector = vector
        existing.targetId = command.payload.targetId
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AppliedForceChanged',
          payload: {
            forceId: command.payload.forceId,
            targetId: command.payload.targetId,
            vector: clone(vector),
          },
        },
      }
    }

    case 'SetGroundLevel': {
      const groundY = command.payload.groundY
      if (!Number.isFinite(groundY)) {
        return {
          ok: false,
          error: invalidCommand('INVALID_GROUND_LEVEL', 'Ground level must be finite.', { groundY }),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.parameters = { ...observable.parameters, kind: 'ground', groundY }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'GroundLevelChanged',
          payload: { observableId: command.payload.observableId, groundY },
        },
      }
    }
  }
}

const errorFromUnknown = (error: unknown): DomainError => {
  if (error instanceof PhysicsOSError) {
    return domainError(error.code, error.message, 'validation', { details: error.details })
  }
  if (error instanceof Error) {
    return domainError('SCENE_COMMAND_EXECUTION_FAILED', error.message, 'internal')
  }
  return domainError(
    'SCENE_COMMAND_EXECUTION_FAILED',
    'Scene command execution failed with an unknown error.',
    'internal',
  )
}

/**
 * Minimal in-memory store for the current scene and its successful mutation
 * events. Public reads are cloned so callers cannot bypass the command gate.
 */
export class SceneStore {
  private currentScene: PhysicsScene
  private readonly events: PhysicsEvent[] = []
  private readonly tolerance: PhysicsTolerance
  private readonly now: () => IsoDateTime
  private readonly eventIdFactory: NonNullable<SceneRuntimeOptions['eventIdFactory']>

  constructor(initialScene: PhysicsScene, options: SceneRuntimeOptions = {}) {
    this.currentScene = clone(initialScene)
    this.tolerance = options.tolerance ?? DEFAULT_TOLERANCE
    this.now = options.now ?? (() => new Date().toISOString())
    this.eventIdFactory = options.eventIdFactory ?? defaultEventIdFactory
  }

  getScene(): PhysicsScene {
    return clone(this.currentScene)
  }

  getEvents(): readonly PhysicsEvent[] {
    return clone(this.events)
  }

  execute(command: SceneCommand): SceneCommandResult {
    const traceId = command.trace.traceId

    if (command.schemaVersion !== SCENE_COMMAND_SCHEMA) {
      return commandFailure(
        invalidCommand(
          'INVALID_SCENE_COMMAND_SCHEMA',
          `Expected command schema "${SCENE_COMMAND_SCHEMA}".`,
          { received: command.schemaVersion },
        ),
        traceId,
      )
    }
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) {
      return commandFailure(
        invalidCommand(
          'INVALID_EXPECTED_REVISION',
          'expectedRevision must be a non-negative integer.',
          { expectedRevision: command.expectedRevision },
        ),
        traceId,
      )
    }
    if (!isIsoDateTime(command.issuedAt)) {
      return commandFailure(
        invalidCommand('INVALID_COMMAND_TIMESTAMP', 'issuedAt must be a valid ISO date-time.'),
        traceId,
      )
    }
    if (command.sceneId !== this.currentScene.id) {
      return commandFailure(
        invalidCommand('SCENE_ID_MISMATCH', 'Command sceneId does not match the current scene.', {
          commandSceneId: command.sceneId,
          currentSceneId: this.currentScene.id,
        }),
        traceId,
      )
    }
    if (command.expectedRevision !== this.currentScene.revision) {
      return commandFailure(
        domainError(
          SCENE_REVISION_CONFLICT,
          `Expected scene revision ${command.expectedRevision}, current revision is ${this.currentScene.revision}.`,
          'conflict',
          {
            retryable: true,
            details: {
              expectedRevision: command.expectedRevision,
              currentRevision: this.currentScene.revision,
            },
          },
        ),
        traceId,
      )
    }

    try {
      const previousRevision = this.currentScene.revision
      const newRevision = previousRevision + 1
      const nextScene = clone(this.currentScene)
      const occurredAt = this.now()
      if (!isIsoDateTime(occurredAt)) {
        return commandFailure(
          domainError(
            'INVALID_EVENT_TIMESTAMP',
            'Scene Runtime clock returned an invalid ISO date-time.',
            'internal',
          ),
          traceId,
        )
      }
      const eventId = this.eventIdFactory(command.sceneId, newRevision, command.commandId)
      const applied = applyCommand(
        nextScene,
        command,
        { eventId, occurredAt, revision: newRevision },
        this.tolerance,
      )
      if (!applied.ok) return commandFailure(applied.error, traceId)

      nextScene.revision = newRevision
      nextScene.metadata.updatedAt = occurredAt
      const verification = validateScene(nextScene)
      if (verification.status === 'failed') {
        return commandFailure(
          domainError(
            'SCENE_VALIDATION_FAILED',
            'Command would produce an invalid PhysicsScene.',
            'validation',
            { details: { errors: verification.errors } },
          ),
          traceId,
        )
      }

      this.currentScene = nextScene
      this.events.push(applied.event)

      return {
        ok: true,
        sceneId: this.currentScene.id,
        previousRevision,
        newRevision,
        eventIds: [applied.event.eventId],
        traceId,
      }
    } catch (error: unknown) {
      return commandFailure(errorFromUnknown(error), traceId)
    }
  }
}

/** Runtime name retained for orchestration consumers; storage semantics live in the base class. */
export class SceneRuntime extends SceneStore {}
