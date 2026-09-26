import {
  check,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import {
  trajectorySampleTimes,
  trajectoryStorageSampleCount,
  validateScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import {
  ELECTRON_CHARGE,
  PLANCK_CONSTANT,
  resolvePhotoelectricModel,
  type PhotoelectricModel,
} from './photoelectric-model.ts'

export const MODERN_ENGINE_ID = 'engine-modern'
export const MODERN_ENGINE_VERSION = '1.0.0'

const ASSUMPTIONS = [
  'monochromatic plane light',
  'one-photon, one-electron photoemission',
  'constant collector work function',
  'all emitted electrons are collected and counted',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const joules = (value: number): Quantity<'energy'> => quantity(value, 'J', 'energy')
const hertz = (value: number): Quantity<'frequency'> => quantity(value, 'Hz', 'frequency')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const volts = (value: number): Quantity<'electric_potential'> =>
  quantity(value, 'V', 'electric_potential')
const amperes = (value: number): Quantity<'electric_current'> =>
  quantity(value, 'A', 'electric_current')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

const derivedOf = (model: PhotoelectricModel): DerivedQuantity[] => {
  const assumptions = [...ASSUMPTIONS]
  return [
    {
      key: 'photon_energy',
      targetId: model.benchId,
      value: joules(model.photonEnergy),
      formula: { expression: 'E = hf = hc/λ' },
      assumptions,
    },
    {
      key: 'threshold_frequency',
      targetId: model.benchId,
      value: hertz(model.thresholdFrequency),
      formula: { expression: 'f₀ = W/h' },
      assumptions,
    },
    {
      key: 'threshold_wavelength',
      targetId: model.benchId,
      value: metres(model.thresholdWavelength),
      formula: { expression: 'λ₀ = hc/W' },
      assumptions,
    },
    {
      key: 'max_kinetic_energy',
      targetId: model.benchId,
      value: joules(model.maxKineticEnergy),
      formula: { expression: 'Kmax = hf − W' },
      assumptions,
    },
    {
      key: 'stopping_potential',
      targetId: model.benchId,
      value: volts(model.stoppingPotential),
      formula: { expression: 'eVs = Kmax' },
      assumptions,
    },
    {
      key: 'photon_flux',
      targetId: model.benchId,
      value: quantity(model.photonFlux, 's^-1', 'frequency'),
      formula: { expression: 'Φ = IA/hf' },
      assumptions,
    },
    {
      key: 'photocurrent',
      targetId: model.benchId,
      value: amperes(model.photocurrent),
      formula: { expression: 'I = ηeΦ' },
      assumptions,
    },
    {
      key: 'emits_photoelectrons',
      targetId: model.benchId,
      value: dimensionless(model.emits ? 1 : 0),
      formula: { expression: 'hf >= W' },
      assumptions,
    },
  ]
}

const stateOf = (model: PhotoelectricModel, timeSeconds: number): SimulationState => ({
  time: quantity(timeSeconds, 's', 'time'),
  objects: [
    {
      id: model.benchId,
      values: {
        work_function: joules(model.workFunction),
        photon_wavelength: metres(model.photonWavelength),
        photon_frequency: hertz(model.photonFrequency),
        photon_energy: joules(model.photonEnergy),
        threshold_frequency: hertz(model.thresholdFrequency),
        threshold_wavelength: metres(model.thresholdWavelength),
        max_kinetic_energy: joules(model.maxKineticEnergy),
        stopping_potential: volts(model.stoppingPotential),
        photocurrent: amperes(model.photocurrent),
        emits_photoelectrons: dimensionless(model.emits ? 1 : 0),
      },
    },
  ],
  derived: derivedOf(model),
})

const relativeClose = (a: number, b: number, scale = 1): boolean =>
  Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b), scale, Number.EPSILON)

const buildVerification = (scene: PhysicsScene, model: PhotoelectricModel): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const equationHolds = model.emits
    ? relativeClose(
        model.photonEnergy,
        model.workFunction + model.maxKineticEnergy,
        model.photonEnergy,
      )
    : model.maxKineticEnergy === 0 && model.photonEnergy < model.workFunction
  checks.push(
    check('photoelectric_equation', 'constraint', equationHolds, {
      message: 'hf = W + Kmax, with Kmax exactly zero below threshold.',
      targetId: model.benchId,
      details: {
        photonEnergy: model.photonEnergy,
        workFunction: model.workFunction,
        maxKineticEnergy: model.maxKineticEnergy,
      },
    }),
    check(
      'threshold_frequency_relation',
      'constraint',
      relativeClose(
        model.thresholdFrequency,
        model.workFunction / PLANCK_CONSTANT,
        model.thresholdFrequency,
      ) &&
        relativeClose(
          model.thresholdWavelength,
          (PLANCK_CONSTANT * model.photonWavelength * model.photonFrequency) / model.workFunction,
          model.thresholdWavelength,
        ),
      {
        message: 'Threshold frequency and wavelength satisfy W = hf₀ = hc/λ₀.',
        targetId: model.benchId,
        details: {
          thresholdFrequency: model.thresholdFrequency,
          thresholdWavelength: model.thresholdWavelength,
        },
      },
    ),
    check(
      'stopping_potential_relation',
      'constraint',
      relativeClose(
        model.maxKineticEnergy,
        ELECTRON_CHARGE * model.stoppingPotential,
        model.maxKineticEnergy,
      ),
      {
        message: 'The stopping potential satisfies eVs = Kmax.',
        targetId: model.benchId,
        details: {
          maxKineticEnergy: model.maxKineticEnergy,
          stoppingPotential: model.stoppingPotential,
        },
      },
    ),
    check('intensity_does_not_change_kmax', 'constraint', true, {
      message: 'Kmax depends on photon frequency and work function only, never on intensity.',
      targetId: model.benchId,
      details: { lightIntensity: model.lightIntensity, maxKineticEnergy: model.maxKineticEnergy },
    }),
    check(
      'photocurrent_extinction_below_threshold',
      'constraint',
      model.emits || model.photocurrent === 0,
      {
        message: 'No photocurrent is emitted below the threshold frequency.',
        targetId: model.benchId,
        details: { emits: model.emits, photocurrent: model.photocurrent },
      },
    ),
  )
  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export function createModernSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'modern_physics',
    options: {
      ...(scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime }),
    },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

export class ModernPhysicsEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = MODERN_ENGINE_ID
  readonly engineVersion = MODERN_ENGINE_VERSION
  readonly domain = 'modern_physics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let model: PhotoelectricModel
    try {
      model = resolvePhotoelectricModel(scene)
    } catch (error: unknown) {
      return unsupportedModel(
        [
          failure(
            'supported_modern_model',
            error instanceof Error ? error.message : 'The modern-physics model is unsupported.',
          ),
        ],
        MODERN_ENGINE_ID,
      )
    }
    if (
      scene.dimension !== '2d' ||
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_modern_physics_scene',
            'Modern physics engine requires a bench-only scene without particles, bodies or fields.',
          ),
        ],
        MODERN_ENGINE_ID,
      )
    }
    const sceneVerification = validateScene(scene)
    if (sceneVerification.status === 'failed') {
      return unsupportedModel(
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
        MODERN_ENGINE_ID,
      )
    }
    return supported(model.modelId, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) return { status: 'passed', checks: [], warnings: [], errors: [] }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const seconds = canonicalValue(time)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolvePhotoelectricModel(scene), seconds)
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
      )
    }
    const model = resolvePhotoelectricModel(scene)
    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const sceneDuration =
      scene.timeline.endTime === undefined ? 1 : canonicalValue(scene.timeline.endTime)
    const endTime =
      request.options.endTime === undefined
        ? sceneDuration
        : canonicalValue(request.options.endTime)
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime < startTime
    ) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Modern-physics simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }
    const startedAt = new Date().toISOString()
    const states = trajectorySampleTimes(
      startTime,
      endTime,
      trajectoryStorageSampleCount(request.options, 2),
    ).map((time) => stateOf(model, time))
    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'photoelectric-one-photon',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const modernPhysicsEngine = new ModernPhysicsEngine()
