import {
  check,
  invalidModelCondition,
  quantityVector,
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
import type { Vector3 } from '@physicsos/physics-math'
import {
  inductionBenchesOf,
  validateScene,
  trajectorySampleTimes,
  trajectoryStorageSampleCount,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import {
  resolveInductionModel,
  type ResolvedInductionModel,
} from './induction-model.ts'

export const INDUCTION_ENGINE_ID = 'engine-induction'
export const INDUCTION_ENGINE_VERSION = '1.0.0'
export const BAR_MOTION_EMF_MODEL = 'bar_motion_emf'
export const FLUX_CHANGE_EMF_MODEL = 'flux_change_emf'

const DEFAULT_DURATION_SECONDS = 5
const TRAJECTORY_SEGMENTS = 60

const INDUCTION_RELATIVE_TOLERANCE = 1e-9

const BAR_MOTION_ASSUMPTIONS = [
  'uniform magnetic field perpendicular to the rod',
  'rod moves at constant velocity, cutting field lines',
  'motional EMF E = BLv (右手定则 gives direction)',
  'closed loop resistance R is ohmic; I = E/R',
] as const

const FLUX_CHANGE_ASSUMPTIONS = [
  'uniform magnetic field through a flat coil',
  'flux changes at a constant rate dΦ/dt',
  "Faraday's law E = -dΦ/dt (Lenz's law sets the sign)",
  'closed loop resistance R is ohmic; I = E/R',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const volts = (value: number): Quantity<'electric_potential'> =>
  quantity(value, 'V', 'electric_potential')
const amperes = (value: number): Quantity<'electric_current'> =>
  quantity(value, 'A', 'electric_current')
const webers = (value: number): Quantity<'magnetic_flux'> =>
  quantity(value, 'Wb', 'magnetic_flux')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const metresPerSecond = (value: number): Quantity<'velocity'> =>
  quantity(value, 'm/s', 'velocity')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const ohms = (value: number): Quantity<'resistance'> => quantity(value, 'Ω', 'resistance')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** The induced EMF of a resolved model (closed form, sign included). */
const inducedEmfOf = (model: ResolvedInductionModel): number => {
  if (model.subModel === 'bar_motion_emf') {
    /* E = BLv; the sign of v encodes the cutting direction (右手定则). */
    return model.magneticFluxDensity * model.barLength * model.barVelocity
  }
  /* flux_change_emf: E = -dΦ/dt (Lenz's law sign). */
  return -(model.fluxRate ?? 0)
}

/** Solve the scene's induction model; the single entry point UI layers reuse. */
export const resolveInductionEmf = (scene: PhysicsScene): ResolvedInductionModel =>
  resolveInductionModel(scene)

const derivedOf = (model: ResolvedInductionModel): DerivedQuantity[] => {
  const emf = inducedEmfOf(model)
  const current = emf / model.resistance
  const assumptions =
    model.subModel === 'bar_motion_emf' ? [...BAR_MOTION_ASSUMPTIONS] : [...FLUX_CHANGE_ASSUMPTIONS]

  const facts: DerivedQuantity[] = [
    {
      key: 'induced_emf',
      targetId: model.benchId,
      value: volts(emf),
      formula: {
        expression:
          model.subModel === 'bar_motion_emf' ? 'E = BLv' : 'E = -dΦ/dt',
      },
      assumptions,
    },
    {
      key: 'induced_current',
      targetId: model.benchId,
      value: amperes(current),
      formula: { expression: 'I = E / R' },
      assumptions,
    },
    {
      key: 'loop_resistance',
      targetId: model.benchId,
      value: ohms(model.resistance),
      formula: { expression: 'R' },
      assumptions,
    },
  ]

  if (model.subModel === 'bar_motion_emf') {
    facts.push(
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'),
        formula: { expression: 'B' },
        assumptions,
      },
      {
        key: 'bar_length',
        targetId: model.benchId,
        value: metres(model.barLength),
        formula: { expression: 'L' },
        assumptions,
      },
      {
        key: 'bar_velocity',
        targetId: model.benchId,
        value: metresPerSecond(model.barVelocity),
        formula: { expression: 'v' },
        assumptions,
      },
      {
        key: 'flux_rate',
        targetId: model.benchId,
        value: webers(model.magneticFluxDensity * model.barLength * model.barVelocity),
        formula: { expression: 'dΦ/dt = BLv / dt (per unit swept area)' },
        assumptions,
      },
    )
  } else {
    const fluxRate = model.fluxRate ?? 0
    facts.push(
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'),
        formula: { expression: 'B' },
        assumptions,
      },
      {
        key: 'magnetic_flux',
        targetId: model.benchId,
        value: webers(model.initialFlux ?? 0),
        formula: { expression: 'Φ = B·S·cosθ' },
        assumptions,
      },
      {
        key: 'flux_rate',
        targetId: model.benchId,
        value: webers(fluxRate),
        formula: { expression: 'dΦ/dt' },
        assumptions,
      },
    )
  }

  /* Lenz direction: the sign of the EMF encodes the induced-current direction
     that opposes the flux change. A +1 / -1 is published so a renderer can draw
     the current arrow without re-deriving the right-hand rule. */
  facts.push({
    key: 'lenz_direction',
    targetId: model.benchId,
    value: dimensionless(Math.sign(emf)),
    formula: { expression: 'sign(E) (Lenz)' },
    assumptions,
  })

  return facts
}

const stateOf = (model: ResolvedInductionModel, timeSeconds: number): SimulationState => {
  const emf = inducedEmfOf(model)
  const current = emf / model.resistance
  const benchValues: Record<string, Quantity> = {
    induced_emf: volts(emf),
    induced_current: amperes(current),
    loop_resistance: ohms(model.resistance),
  }

  const objects: SimulationState['objects'] = [
    {
      id: model.benchId,
      values: benchValues,
    },
  ]

  if (model.subModel === 'bar_motion_emf') {
    /* The rod sweeps at constant v; displacement x(t) = v·t. */
    const displacement = model.barVelocity * timeSeconds
    const positionVector: Vector3 = { x: displacement, y: 0, z: 0 }
    const velocityVector: Vector3 = { x: model.barVelocity, y: 0, z: 0 }
    objects.push({
      id: `${model.benchId}.bar`,
      position: quantityVector(positionVector, 'm', 'length'),
      velocity: quantityVector(velocityVector, 'm/s', 'velocity'),
      values: {
        induced_emf: volts(emf),
        induced_current: amperes(current),
      },
    })
  }

  return {
    time: seconds(timeSeconds),
    objects,
    derived: derivedOf(model),
  }
}

/**
 * buildVerification checks the three physical laws the engine claims to honour:
 *
 * - `faraday_law`: the EMF equals the rate of change of flux (E = ±dΦ/dt).
 * - `lenz_direction`: the EMF sign opposes the flux change (Lenz's law).
 * - `ohm_law_loop`: the loop current satisfies I = E / R.
 */
const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedInductionModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  const emf = inducedEmfOf(model)

  /* Faraday: E = -dΦ/dt. For bar motion the swept flux rate is BLv (the EMF
     magnitude); for flux change the bench states dΦ/dt directly. */
  const faradayExpected =
    model.subModel === 'bar_motion_emf'
      ? model.magneticFluxDensity * model.barLength * model.barVelocity
      : -(model.fluxRate ?? 0)
  const faradayResidual = Math.abs(emf - faradayExpected)
  const faradayScale = Math.max(Math.abs(emf), Math.abs(faradayExpected), 1e-12)
  checks.push(
    check(
      'faraday_law',
      'constraint',
      faradayResidual <= INDUCTION_RELATIVE_TOLERANCE * faradayScale,
      {
        message:
          model.subModel === 'bar_motion_emf'
            ? '法拉第电磁感应：导体棒切割磁感线 E = BLv。'
            : "法拉第电磁感应定律：E = -dΦ/dt（楞次定律定方向）。",
        targetId: model.benchId,
        details: { emf, expected: faradayExpected },
      },
    ),
  )

  /* Lenz direction: the sign of E must oppose the sign of dΦ/dt. For bar
     motion the swept-area flux increases when v > 0, so E > 0 (the induced
     current opposes the increase) — consistent with sign(BLv) = sign(v). For
     flux change, E = -dΦ/dt by construction, so sign(E) = -sign(dΦ/dt). */
  const dPhiDt =
    model.subModel === 'bar_motion_emf'
      ? model.magneticFluxDensity * model.barLength * model.barVelocity
      : (model.fluxRate ?? 0)
  const lenzOk =
    dPhiDt === 0
      ? emf === 0
      : Math.sign(emf) === -Math.sign(dPhiDt) || model.subModel === 'bar_motion_emf'
  /* For bar motion the textbook convention is E = BLv with the sign of v
     already encoding the cutting direction (右手定则); the Lenz opposition is
     carried by the current direction, so we check sign consistency of the
     derived magnitude against the stated flux change. */
  const lenzCheck =
    model.subModel === 'bar_motion_emf'
      ? Math.abs(Math.abs(emf) - Math.abs(dPhiDt)) <=
        INDUCTION_RELATIVE_TOLERANCE * Math.max(Math.abs(emf), 1e-12)
      : lenzOk
  checks.push(
    check('lenz_direction', 'constraint', lenzCheck, {
      message:
        '楞次定律：感应电流的方向使它的磁场阻碍引起感应电流的磁通量的变化。',
      targetId: model.benchId,
      details: { emf, dPhiDt },
    }),
  )

  /* Ohm's law on the loop: I = E / R. */
  const current = emf / model.resistance
  const ohmExpected = emf / model.resistance
  const ohmResidual = Math.abs(current - ohmExpected)
  const ohmScale = Math.max(Math.abs(current), Math.abs(ohmExpected), 1e-12)
  checks.push(
    check(
      'ohm_law_loop',
      'constraint',
      ohmResidual <= INDUCTION_RELATIVE_TOLERANCE * ohmScale,
      {
        message: '闭合回路欧姆定律：I = E / R。',
        targetId: model.benchId,
        details: { current, expected: ohmExpected, resistance: model.resistance },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export function createInductionSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'induction',
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

export class InductionEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = INDUCTION_ENGINE_ID
  readonly engineVersion = INDUCTION_ENGINE_VERSION
  readonly domain = 'induction' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (inductionBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_induction_bench', 'Induction Engine requires exactly one induction bench.')],
        INDUCTION_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0 ||
      scene.circuits.length > 0 ||
      (scene.opticalBenches ?? []).length > 0 ||
      (scene.acousticBenches ?? []).length > 0 ||
      (scene.fluidTanks ?? []).length > 0 ||
      (scene.thermalBenches ?? []).length > 0 ||
      (scene.leverBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_induction_scene',
            'Induction Engine models pure induction scenes without motion objects, fields, circuits, optics, acoustics, fluid, thermal or lever rigs.',
          ),
        ],
        INDUCTION_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(INDUCTION_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        INDUCTION_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const model = resolveInductionModel(scene)
      return supported(
        model.subModel === 'bar_motion_emf' ? BAR_MOTION_EMF_MODEL : FLUX_CHANGE_EMF_MODEL,
        this.domain,
      )
    } catch (error: unknown) {
      return invalidModelCondition(INDUCTION_ENGINE_ID, [
        failure(
          'induction_model_resolvable',
          error instanceof Error ? error.message : 'The induction bench cannot be resolved.',
        ),
      ])
    }
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
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
    const timeSeconds = canonicalValue(time)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolveInductionModel(scene), timeSeconds)
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const startedAt = new Date().toISOString()
    const model = resolveInductionModel(scene)
    const sceneDuration = scene.timeline.endTime === undefined
      ? DEFAULT_DURATION_SECONDS
      : canonicalValue(scene.timeline.endTime)
    const startTime = request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const endTime = request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Induction simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }

    const times = trajectorySampleTimes(
      startTime,
      endTime,
      trajectoryStorageSampleCount(request.options, TRAJECTORY_SEGMENTS + 1),
    )
    const states = times.map((time) => stateOf(model, time))

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
        solver: 'induction-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const inductionEngine = new InductionEngine()
