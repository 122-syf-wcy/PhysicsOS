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
import type {
  AcousticBench,
  Circuit,
  CircuitComponent,
  FluidTank,
  OpticalBench,
  PhysicsScene,
  ThermalBench,
  UniformElectricField,
  UniformMagneticField,
} from './scene.ts'

export const SCENE_COMMAND_SCHEMA = 'scene-command/1.0' as const
export const PHYSICS_EVENT_SCHEMA = 'physics-event/1.0' as const
export const SCENE_REVISION_CONFLICT = 'SCENE_REVISION_CONFLICT' as const

export type ElectricFieldDirection = 'right' | 'left' | 'up' | 'down'

/** docs/03 §69 — command names frozen for the Magnetic + Mechanics + Electric + Circuit + Optics + Acoustics Runtime slices. */
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
  | 'SetComponentResistance'
  | 'SetSourceVoltage'
  | 'SetSourceInternalResistance'
  | 'SetSwitchState'
  | 'SetSliderPosition'
  | 'SetOpticalObjectPosition'
  | 'SetOpticalObjectHeight'
  | 'SetLensFocalLength'
  | 'SetMirrorFocalLength'
  | 'SetOpticalScreenPosition'
  | 'SetAcousticReflectorPosition'
  | 'SetAcousticSoundSpeed'
  | 'SetLiquidDensity'
  | 'SetBlockMass'
  | 'SetHeaterPower'
  | 'SetSampleMass'

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
  SetComponentResistance: {
    circuitId: string
    componentId: string
    /** Fixed resistor: its resistance. Variable resistor: its full-scale resistance. */
    resistance: Quantity<'resistance'>
  }
  SetSourceVoltage: {
    circuitId: string
    componentId: string
    voltage: Quantity<'electric_potential'>
  }
  SetSourceInternalResistance: {
    circuitId: string
    componentId: string
    internalResistance: Quantity<'resistance'>
  }
  SetSwitchState: {
    circuitId: string
    componentId: string
    state: 'open' | 'closed'
  }
  SetSliderPosition: {
    circuitId: string
    componentId: string
    /** Rheostat slider position, 0..1 inclusive. */
    position: number
  }
  SetOpticalObjectPosition: {
    benchId: string
    /** Signed x position; must stay on the incoming (−x) side of every element. */
    position: Quantity<'length'>
  }
  SetOpticalObjectHeight: {
    benchId: string
    /** Object height above the axis, > 0. */
    height: Quantity<'length'>
  }
  SetLensFocalLength: {
    benchId: string
    elementId: string
    /** Focal length; non-zero, > 0 converging. */
    focalLength: Quantity<'length'>
  }
  SetMirrorFocalLength: {
    benchId: string
    elementId: string
    /** Focal length; non-zero, > 0 concave (converging), < 0 convex. */
    focalLength: Quantity<'length'>
  }
  SetOpticalScreenPosition: {
    benchId: string
    /** Signed x position of the screen plane. */
    position: Quantity<'length'>
  }
  SetAcousticReflectorPosition: {
    benchId: string
    /** Signed x position of the reflecting face; must stay ahead of the source. */
    position: Quantity<'length'>
  }
  SetAcousticSoundSpeed: {
    benchId: string
    /** Speed of sound in the propagation medium; finite and > 0. */
    soundSpeed: Quantity<'velocity'>
  }
  SetLiquidDensity: {
    tankId: string
    /** Density of the liquid in the tank; finite and > 0. */
    density: Quantity<'density'>
  }
  SetBlockMass: {
    tankId: string
    /** Mass of the hanging block; finite and > 0. */
    mass: Quantity<'mass'>
  }
  SetHeaterPower: {
    benchId: string
    /** Heat delivered per second; finite and > 0. */
    power: Quantity<'power'>
  }
  SetSampleMass: {
    benchId: string
    /** Mass of the heated sample; finite and > 0. */
    mass: Quantity<'mass'>
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
  | 'ComponentResistanceChanged'
  | 'SourceVoltageChanged'
  | 'SourceInternalResistanceChanged'
  | 'SwitchStateChanged'
  | 'SliderPositionChanged'
  | 'OpticalObjectPositionChanged'
  | 'OpticalObjectHeightChanged'
  | 'LensFocalLengthChanged'
  | 'MirrorFocalLengthChanged'
  | 'OpticalScreenPositionChanged'
  | 'AcousticReflectorPositionChanged'
  | 'AcousticSoundSpeedChanged'
  | 'LiquidDensityChanged'
  | 'BlockMassChanged'
  | 'HeaterPowerChanged'
  | 'SampleMassChanged'

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
  ComponentResistanceChanged: SceneCommandPayloadMap['SetComponentResistance']
  SourceVoltageChanged: SceneCommandPayloadMap['SetSourceVoltage']
  SourceInternalResistanceChanged: SceneCommandPayloadMap['SetSourceInternalResistance']
  SwitchStateChanged: SceneCommandPayloadMap['SetSwitchState']
  SliderPositionChanged: SceneCommandPayloadMap['SetSliderPosition']
  OpticalObjectPositionChanged: SceneCommandPayloadMap['SetOpticalObjectPosition']
  OpticalObjectHeightChanged: SceneCommandPayloadMap['SetOpticalObjectHeight']
  LensFocalLengthChanged: SceneCommandPayloadMap['SetLensFocalLength']
  MirrorFocalLengthChanged: SceneCommandPayloadMap['SetMirrorFocalLength']
  OpticalScreenPositionChanged: SceneCommandPayloadMap['SetOpticalScreenPosition']
  AcousticReflectorPositionChanged: SceneCommandPayloadMap['SetAcousticReflectorPosition']
  AcousticSoundSpeedChanged: SceneCommandPayloadMap['SetAcousticSoundSpeed']
  LiquidDensityChanged: SceneCommandPayloadMap['SetLiquidDensity']
  BlockMassChanged: SceneCommandPayloadMap['SetBlockMass']
  HeaterPowerChanged: SceneCommandPayloadMap['SetHeaterPower']
  SampleMassChanged: SceneCommandPayloadMap['SetSampleMass']
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

const NOT_FOUND_CODES = {
  particle: 'PARTICLE_NOT_FOUND',
  magnetic_field: 'MAGNETIC_FIELD_NOT_FOUND',
  electric_field: 'ELECTRIC_FIELD_NOT_FOUND',
  observable: 'OBSERVABLE_NOT_FOUND',
  body: 'BODY_NOT_FOUND',
  gravity_field: 'GRAVITY_FIELD_NOT_FOUND',
  force: 'FORCE_NOT_FOUND',
  circuit: 'CIRCUIT_NOT_FOUND',
  circuit_component: 'CIRCUIT_COMPONENT_NOT_FOUND',
  optical_bench: 'OPTICAL_BENCH_NOT_FOUND',
  optical_element: 'OPTICAL_ELEMENT_NOT_FOUND',
  optical_screen: 'OPTICAL_SCREEN_NOT_FOUND',
  acoustic_bench: 'ACOUSTIC_BENCH_NOT_FOUND',
  fluid_tank: 'FLUID_TANK_NOT_FOUND',
  thermal_bench: 'THERMAL_BENCH_NOT_FOUND',
} as const

const notFound = (targetType: keyof typeof NOT_FOUND_CODES, id: string) =>
  domainError(
    NOT_FOUND_CODES[targetType],
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

type CircuitComponentLookup =
  | { ok: true; circuit: Circuit; component: CircuitComponent }
  | { ok: false; error: DomainError }

const findCircuitComponent = (
  scene: PhysicsScene,
  circuitId: string,
  componentId: string,
): CircuitComponentLookup => {
  if (typeof circuitId !== 'string' || circuitId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_CIRCUIT_ID', 'circuitId must be a non-empty string.'),
    }
  }
  if (typeof componentId !== 'string' || componentId.length === 0) {
    return {
      ok: false,
      error: invalidCommand(
        'INVALID_CIRCUIT_COMPONENT_ID',
        'componentId must be a non-empty string.',
      ),
    }
  }
  const circuit = scene.circuits.find((entry) => entry.id === circuitId)
  if (circuit === undefined) return { ok: false, error: notFound('circuit', circuitId) }
  const component = circuit.components.find((entry) => String(entry.id) === componentId)
  if (component === undefined) {
    return { ok: false, error: notFound('circuit_component', componentId) }
  }
  return { ok: true, circuit, component }
}

type OpticalBenchLookup =
  | { ok: true; bench: OpticalBench }
  | { ok: false; error: DomainError }

const findOpticalBench = (scene: PhysicsScene, benchId: string): OpticalBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_OPTICAL_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.opticalBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('optical_bench', benchId) }
  return { ok: true, bench }
}

type AcousticBenchLookup =
  | { ok: true; bench: AcousticBench }
  | { ok: false; error: DomainError }

const findAcousticBench = (scene: PhysicsScene, benchId: string): AcousticBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_ACOUSTIC_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.acousticBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('acoustic_bench', benchId) }
  return { ok: true, bench }
}

type FluidTankLookup =
  | { ok: true; tank: FluidTank }
  | { ok: false; error: DomainError }

const findFluidTank = (scene: PhysicsScene, tankId: string): FluidTankLookup => {
  if (typeof tankId !== 'string' || tankId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_FLUID_TANK_ID', 'tankId must be a non-empty string.'),
    }
  }
  const tank = scene.fluidTanks.find((entry) => entry.id === tankId)
  if (tank === undefined) return { ok: false, error: notFound('fluid_tank', tankId) }
  return { ok: true, tank }
}

type ThermalBenchLookup =
  | { ok: true; bench: ThermalBench }
  | { ok: false; error: DomainError }

const findThermalBench = (scene: PhysicsScene, benchId: string): ThermalBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_THERMAL_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.thermalBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('thermal_bench', benchId) }
  return { ok: true, bench }
}

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

    /* ------------------------------------------------------------ circuit -- */

    case 'SetComponentResistance': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const resistance = validateQuantity(command.payload.resistance, 'resistance')
      if (!Number.isFinite(canonicalValue(resistance)) || canonicalValue(resistance) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_COMPONENT_RESISTANCE',
            'Resistance must be a positive finite quantity.',
            { componentId: command.payload.componentId, resistance: command.payload.resistance },
          ),
        }
      }
      const component = lookup.component
      if (component.type === 'resistor') {
        component.resistance = clone(resistance)
      } else if (component.type === 'variable_resistor') {
        component.totalResistance = clone(resistance)
      } else {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_RESISTIVE',
            'SetComponentResistance targets a resistor or a variable resistor.',
            { componentId: command.payload.componentId, componentType: component.type },
          ),
        }
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ComponentResistanceChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            resistance: clone(resistance),
          },
        },
      }
    }

    case 'SetSourceVoltage': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'voltage_source') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VOLTAGE_SOURCE',
            'SetSourceVoltage targets a voltage source.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const voltage = validateQuantity(command.payload.voltage, 'electric_potential')
      if (!Number.isFinite(canonicalValue(voltage)) || canonicalValue(voltage) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SOURCE_VOLTAGE',
            'Source voltage must be a non-negative finite quantity.',
            { componentId: command.payload.componentId, voltage: command.payload.voltage },
          ),
        }
      }
      lookup.component.voltage = clone(voltage)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SourceVoltageChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            voltage: clone(voltage),
          },
        },
      }
    }

    case 'SetSourceInternalResistance': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'voltage_source') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VOLTAGE_SOURCE',
            'SetSourceInternalResistance targets a voltage source.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const internalResistance = validateQuantity(
        command.payload.internalResistance,
        'resistance',
      )
      if (
        !Number.isFinite(canonicalValue(internalResistance)) ||
        canonicalValue(internalResistance) < 0
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SOURCE_INTERNAL_RESISTANCE',
            'Source internal resistance must be a non-negative finite quantity.',
            {
              componentId: command.payload.componentId,
              internalResistance: command.payload.internalResistance,
            },
          ),
        }
      }
      lookup.component.internalResistance = clone(internalResistance)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SourceInternalResistanceChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            internalResistance: clone(internalResistance),
          },
        },
      }
    }

    case 'SetSwitchState': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'switch') {
        return {
          ok: false,
          error: invalidCommand('COMPONENT_NOT_SWITCH', 'SetSwitchState targets a switch.', {
            componentId: command.payload.componentId,
            componentType: lookup.component.type,
          }),
        }
      }
      if (command.payload.state !== 'open' && command.payload.state !== 'closed') {
        return {
          ok: false,
          error: invalidCommand('INVALID_SWITCH_STATE', 'state must be "open" or "closed".'),
        }
      }
      lookup.component.state = command.payload.state
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SwitchStateChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetSliderPosition': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'variable_resistor') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VARIABLE_RESISTOR',
            'SetSliderPosition targets a variable resistor.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const position = command.payload.position
      if (!Number.isFinite(position) || position < 0 || position > 1) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SLIDER_POSITION',
            'Slider position must be a finite number between 0 and 1.',
            { position },
          ),
        }
      }
      lookup.component.sliderPosition = position
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SliderPositionChanged',
          payload: clone(command.payload),
        },
      }
    }

    /* ------------------------------------------------------------- optics -- */

    case 'SetOpticalObjectPosition': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const position = validateQuantity(command.payload.position, 'length')
      const positionSI = canonicalValue(position)
      if (!Number.isFinite(positionSI)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_OBJECT_POSITION',
            'Optical object position must be a finite length.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      /* Light travels towards +x: an object at or past the imaging element has
         left the model, so the gate rejects it instead of letting the engine
         report a broken scene later. */
      const blockingElement = lookup.bench.elements.find(
        (element) => element.enabled !== false && positionSI >= canonicalValue(element.position),
      )
      if (blockingElement !== undefined) {
        return {
          ok: false,
          error: invalidCommand(
            'OPTICAL_OBJECT_BEHIND_ELEMENT',
            'The object must stay on the incoming side of the imaging element.',
            { benchId: command.payload.benchId, elementId: blockingElement.id },
          ),
        }
      }
      lookup.bench.object.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalObjectPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    case 'SetOpticalObjectHeight': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const height = validateQuantity(command.payload.height, 'length')
      if (!Number.isFinite(canonicalValue(height)) || canonicalValue(height) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_OBJECT_HEIGHT',
            'Optical object height must be a positive finite length.',
            { benchId: command.payload.benchId, height: command.payload.height },
          ),
        }
      }
      lookup.bench.object.height = clone(height)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalObjectHeightChanged',
          payload: { benchId: command.payload.benchId, height: clone(height) },
        },
      }
    }

    case 'SetLensFocalLength': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (typeof command.payload.elementId !== 'string' || command.payload.elementId.length === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_ELEMENT_ID',
            'elementId must be a non-empty string.',
          ),
        }
      }
      const element = lookup.bench.elements.find(
        (entry) => entry.id === command.payload.elementId,
      )
      if (element === undefined) {
        return { ok: false, error: notFound('optical_element', command.payload.elementId) }
      }
      if (element.type !== 'thin_lens') {
        return {
          ok: false,
          error: invalidCommand(
            'ELEMENT_NOT_THIN_LENS',
            'SetLensFocalLength targets a thin lens.',
            { elementId: command.payload.elementId, elementType: element.type },
          ),
        }
      }
      const focalLength = validateQuantity(command.payload.focalLength, 'length')
      if (!Number.isFinite(canonicalValue(focalLength)) || canonicalValue(focalLength) === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_LENS_FOCAL_LENGTH',
            'Focal length must be a non-zero finite length.',
            { elementId: command.payload.elementId, focalLength: command.payload.focalLength },
          ),
        }
      }
      element.focalLength = clone(focalLength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'LensFocalLengthChanged',
          payload: {
            benchId: command.payload.benchId,
            elementId: command.payload.elementId,
            focalLength: clone(focalLength),
          },
        },
      }
    }

    case 'SetMirrorFocalLength': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (typeof command.payload.elementId !== 'string' || command.payload.elementId.length === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_ELEMENT_ID',
            'elementId must be a non-empty string.',
          ),
        }
      }
      const element = lookup.bench.elements.find(
        (entry) => entry.id === command.payload.elementId,
      )
      if (element === undefined) {
        return { ok: false, error: notFound('optical_element', command.payload.elementId) }
      }
      if (element.type !== 'curved_mirror') {
        return {
          ok: false,
          error: invalidCommand(
            'ELEMENT_NOT_CURVED_MIRROR',
            'SetMirrorFocalLength targets a curved mirror.',
            { elementId: command.payload.elementId, elementType: element.type },
          ),
        }
      }
      const focalLength = validateQuantity(command.payload.focalLength, 'length')
      if (!Number.isFinite(canonicalValue(focalLength)) || canonicalValue(focalLength) === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MIRROR_FOCAL_LENGTH',
            'Focal length must be a non-zero finite length.',
            { elementId: command.payload.elementId, focalLength: command.payload.focalLength },
          ),
        }
      }
      element.focalLength = clone(focalLength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MirrorFocalLengthChanged',
          payload: {
            benchId: command.payload.benchId,
            elementId: command.payload.elementId,
            focalLength: clone(focalLength),
          },
        },
      }
    }

    case 'SetOpticalScreenPosition': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.screen === undefined) {
        return {
          ok: false,
          error: notFound('optical_screen', command.payload.benchId),
        }
      }
      const position = validateQuantity(command.payload.position, 'length')
      if (!Number.isFinite(canonicalValue(position))) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_SCREEN_POSITION',
            'Optical screen position must be a finite length.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      lookup.bench.screen.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalScreenPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    /* ---------------------------------------------------------- acoustics -- */

    case 'SetAcousticReflectorPosition': {
      const lookup = findAcousticBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const position = validateQuantity(command.payload.position, 'length')
      const positionSI = canonicalValue(position)
      /* The pulse travels towards +x: a reflector at or behind the source has
         no echo path, so the gate rejects it here rather than letting the
         engine report a broken scene later. */
      if (!Number.isFinite(positionSI) || positionSI <= canonicalValue(lookup.bench.source.position)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ACOUSTIC_REFLECTOR_POSITION',
            'Reflector must sit a finite distance ahead of the sound source.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      lookup.bench.reflector.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AcousticReflectorPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    case 'SetAcousticSoundSpeed': {
      const lookup = findAcousticBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const soundSpeed = validateQuantity(command.payload.soundSpeed, 'velocity')
      if (!Number.isFinite(canonicalValue(soundSpeed)) || canonicalValue(soundSpeed) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ACOUSTIC_SOUND_SPEED',
            'Sound speed must be a positive finite velocity.',
            { benchId: command.payload.benchId, soundSpeed: command.payload.soundSpeed },
          ),
        }
      }
      lookup.bench.soundSpeed = clone(soundSpeed)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AcousticSoundSpeedChanged',
          payload: { benchId: command.payload.benchId, soundSpeed: clone(soundSpeed) },
        },
      }
    }

    /* -------------------------------------------------------- fluid statics -- */

    case 'SetLiquidDensity': {
      const lookup = findFluidTank(scene, command.payload.tankId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const density = validateQuantity(command.payload.density, 'density')
      if (!Number.isFinite(canonicalValue(density)) || canonicalValue(density) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_LIQUID_DENSITY',
            'Liquid density must be a positive finite density.',
            { tankId: command.payload.tankId, density: command.payload.density },
          ),
        }
      }
      lookup.tank.liquid.density = clone(density)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'LiquidDensityChanged',
          payload: { tankId: command.payload.tankId, density: clone(density) },
        },
      }
    }

    case 'SetBlockMass': {
      const lookup = findFluidTank(scene, command.payload.tankId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (!Number.isFinite(canonicalValue(mass)) || canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_BLOCK_MASS',
            'Block mass must be a positive finite mass.',
            { tankId: command.payload.tankId, mass: command.payload.mass },
          ),
        }
      }
      lookup.tank.block.mass = clone(mass)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BlockMassChanged',
          payload: { tankId: command.payload.tankId, mass: clone(mass) },
        },
      }
    }

    /* ------------------------------------------------------------- thermal -- */

    case 'SetHeaterPower': {
      const lookup = findThermalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const power = validateQuantity(command.payload.power, 'power')
      if (!Number.isFinite(canonicalValue(power)) || canonicalValue(power) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_HEATER_POWER',
            'Heater power must be a positive finite power.',
            { benchId: command.payload.benchId, power: command.payload.power },
          ),
        }
      }
      lookup.bench.heaterPower = clone(power)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'HeaterPowerChanged',
          payload: { benchId: command.payload.benchId, power: clone(power) },
        },
      }
    }

    case 'SetSampleMass': {
      const lookup = findThermalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (!Number.isFinite(canonicalValue(mass)) || canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SAMPLE_MASS',
            'Sample mass must be a positive finite mass.',
            { benchId: command.payload.benchId, mass: command.payload.mass },
          ),
        }
      }
      lookup.bench.sample.mass = clone(mass)
      if (lookup.bench.comparisonSample !== undefined) {
        lookup.bench.comparisonSample.mass = clone(mass)
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SampleMassChanged',
          payload: { benchId: command.payload.benchId, mass: clone(mass) },
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
