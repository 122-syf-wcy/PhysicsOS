/**
 * Composite field engine — a charged particle under E, B and gravity at once.
 *
 * The motion law is `F = qE + qv×B + mg`. With uniform fields this has a closed
 * form, so the engine stays analytic like every other PhysicsOS engine: decompose
 * the velocity into a drift that balances the forces and a gyration around it
 * (`@physicsos/physics-composite-core` owns that algebra and is checked against an
 * RK4 reference to ~1e-14).
 *
 * What this engine adds on top of the single-phase algebra is **phase
 * decomposition**. A composite apparatus binds different fields to different
 * regions — a selector region carrying E and B, a deflection region carrying only
 * B, field-free space between them — so one trajectory crosses several uniform
 * environments. Each crossing starts a new phase whose initial state is the exact
 * exit state of the previous one, which is what keeps a mass spectrometer's
 * "straight then circular" path from needing a numeric integrator.
 *
 * This mirrors `engine-electric-region`'s internal phase split: the outside world
 * still calls `simulate` once, and the segmentation is entirely an engine concern.
 */
import {
  add,
  dot,
  isFiniteVector,
  magnitude,
  scale,
  subtract,
  vec3,
  type Vector3,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import {
  DEFAULT_TOLERANCE,
  check,
  invalidModelCondition,
  quantityVector,
  summarizeVerification,
  supported,
  toCanonicalVector,
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
import {
  hasUnsampleableRegion,
  isCompositeFieldScene,
  sameFieldEnvironment,
  sampleFieldsAt,
  validateScene,
  type FieldSample,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import {
  compositeForce,
  compositeMotionAt,
  cyclotronPeriod,
  driftVelocity,
  gyroRadius,
  selectorSpeed,
} from '@physicsos/physics-composite-core'

export const COMPOSITE_ENGINE_ID = 'engine-composite'
export const COMPOSITE_ENGINE_VERSION = '1.0.0'
export const COMPOSITE_FIELD_MODEL = 'charged_particle_composite_field'

const DEFAULT_DURATION_SECONDS = 1e-6
const TRAJECTORY_SAMPLES = 240
/** A cyclotron crosses the gap twice per turn, so a long run is many phases. */
const MAX_PHASES = 512
/** Coarse steps per phase while hunting for the next environment change. */
const PHASE_SCAN_STEPS = 400
/** Bisection rounds once a change is bracketed; 40 halvings resolve to ~1e-12 of dt. */
const BISECTION_ROUNDS = 40

const ASSUMPTIONS = [
  'uniform fields within each region',
  'analytic drift-plus-gyration solution',
  '2D motion with B along z',
  'no radiation reaction',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

/* ------------------------------------------------------------------ model -- */

export interface CompositeModel {
  readonly modelId: typeof COMPOSITE_FIELD_MODEL
  readonly particleId: string
  readonly mass: number
  readonly charge: number
  readonly position: Vector3
  readonly velocity: Vector3
}

export const resolveCompositeModel = (scene: PhysicsScene): CompositeModel => {
  const particle = scene.particles[0]
  if (particle === undefined || particle.charge === undefined) {
    throw new PhysicsOSError(
      'COMPOSITE_MODEL_INCOMPLETE',
      'Composite model needs one particle carrying a charge.',
    )
  }
  return {
    modelId: COMPOSITE_FIELD_MODEL,
    particleId: particle.id,
    mass: canonicalValue(particle.mass),
    charge: canonicalValue(particle.charge),
    position: toCanonicalVector(particle.position).vectorSI,
    velocity: toCanonicalVector(particle.velocity).vectorSI,
  }
}

/* ------------------------------------------------------- phase decomposition -- */

/** Why a phase ended, which is also what the timeline event reports. */
export type PhaseBoundaryKind = 'enter_region' | 'exit_region' | 'switch_field' | 'end_of_run'

export interface CompositePhase {
  readonly index: number
  readonly startTime: number
  readonly endTime: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly sample: FieldSample
  /** How this phase ended, and which regions changed. */
  readonly boundary: PhaseBoundaryKind
  readonly entered: readonly string[]
  readonly exited: readonly string[]
}

const regionDelta = (before: FieldSample, after: FieldSample) => ({
  entered: after.regionIds.filter((id) => !before.regionIds.includes(id)),
  exited: before.regionIds.filter((id) => !after.regionIds.includes(id)),
})

const boundaryKindOf = (entered: readonly string[], exited: readonly string[]): PhaseBoundaryKind => {
  if (entered.length > 0) return 'enter_region'
  if (exited.length > 0) return 'exit_region'
  /* Fields changed without any region membership changing — two regions sharing a
     face, or a field switching inside one region. */
  return 'switch_field'
}

/**
 * Split the run into uniform-field phases.
 *
 * The scan is a root find, not an integration: within a phase the motion is the
 * closed form, and stepping only asks "has the environment changed yet". A coarse
 * sweep brackets the change, then bisection pins it. Resolving the boundary this
 * precisely matters because the next phase's initial state is read from it — an
 * imprecise crossing would put the particle slightly inside the wrong field and
 * that error compounds across every later phase.
 */
export const decomposePhases = (
  scene: PhysicsScene,
  model: CompositeModel,
  endTime: number,
): { phases: readonly CompositePhase[]; truncated: boolean } => {
  const phases: CompositePhase[] = []
  let time = 0
  let position = model.position
  let velocity = model.velocity
  let truncated = false

  while (time < endTime) {
    if (phases.length >= MAX_PHASES) {
      truncated = true
      break
    }
    const sample = sampleFieldsAt(scene, position)
    const remaining = endTime - time
    const step = remaining / PHASE_SCAN_STEPS

    let crossedAt: number | undefined
    let crossedSample: FieldSample | undefined
    for (let i = 1; i <= PHASE_SCAN_STEPS; i += 1) {
      const dt = step * i
      const probe = compositeMotionAt(model.charge, model.mass, position, velocity, sample, dt)
      const probeSample = sampleFieldsAt(scene, probe.position)
      if (
        !sameFieldEnvironment(sample, probeSample) ||
        probeSample.regionIds.length !== sample.regionIds.length ||
        probeSample.regionIds.some((id) => !sample.regionIds.includes(id))
      ) {
        /* Bracketed between (i-1) and i. Bisect on "is the environment still the
           starting one" — a monotone predicate over this bracket. */
        let low = step * (i - 1)
        let high = dt
        for (let round = 0; round < BISECTION_ROUNDS; round += 1) {
          const mid = (low + high) / 2
          const midMotion = compositeMotionAt(model.charge, model.mass, position, velocity, sample, mid)
          const midSample = sampleFieldsAt(scene, midMotion.position)
          const unchanged =
            sameFieldEnvironment(sample, midSample) &&
            midSample.regionIds.length === sample.regionIds.length &&
            midSample.regionIds.every((id) => sample.regionIds.includes(id))
          if (unchanged) low = mid
          else high = mid
        }
        crossedAt = high
        crossedSample = sampleFieldsAt(
          scene,
          compositeMotionAt(model.charge, model.mass, position, velocity, sample, high).position,
        )
        break
      }
    }

    if (crossedAt === undefined || crossedSample === undefined) {
      phases.push({
        index: phases.length,
        startTime: time,
        endTime,
        position,
        velocity,
        sample,
        boundary: 'end_of_run',
        entered: [],
        exited: [],
      })
      break
    }

    const { entered, exited } = regionDelta(sample, crossedSample)
    phases.push({
      index: phases.length,
      startTime: time,
      endTime: time + crossedAt,
      position,
      velocity,
      sample,
      boundary: boundaryKindOf(entered, exited),
      entered,
      exited,
    })

    const exit = compositeMotionAt(model.charge, model.mass, position, velocity, sample, crossedAt)
    time += crossedAt
    position = exit.position
    velocity = exit.velocity
    /* A zero-length step would spin forever at a boundary the scan keeps
       re-detecting; nudge past it by the smallest resolvable amount. */
    if (crossedAt <= 0) {
      truncated = true
      break
    }
  }

  return { phases, truncated }
}

const phaseAt = (phases: readonly CompositePhase[], time: number): CompositePhase | undefined => {
  for (const phase of phases) {
    if (time >= phase.startTime && time <= phase.endTime) return phase
  }
  return phases[phases.length - 1]
}

/* ------------------------------------------------------------------ state -- */

const motionAtTime = (
  scene: PhysicsScene,
  model: CompositeModel,
  phases: readonly CompositePhase[],
  time: number,
) => {
  const phase = phaseAt(phases, time)
  if (phase === undefined) {
    return {
      position: model.position,
      velocity: model.velocity,
      acceleration: vec3(0, 0, 0),
      sample: sampleFieldsAt(scene, model.position),
    }
  }
  const motion = compositeMotionAt(
    model.charge,
    model.mass,
    phase.position,
    phase.velocity,
    phase.sample,
    Math.max(0, time - phase.startTime),
  )
  return { ...motion, sample: phase.sample }
}

const stateAtForModel = (
  scene: PhysicsScene,
  model: CompositeModel,
  phases: readonly CompositePhase[],
  time: number,
): SimulationState => {
  const motion = motionAtTime(scene, model, phases, time)
  const force = compositeForce(model.charge, model.mass, motion.velocity, motion.sample)
  return {
    time: quantity(time, 's', 'time'),
    objects: [
      {
        id: model.particleId,
        position: quantityVector(motion.position, 'm', 'length'),
        velocity: quantityVector(motion.velocity, 'm/s', 'velocity'),
        acceleration: quantityVector(motion.acceleration, 'm/s^2', 'acceleration'),
        values: {
          electricField: quantityVector(motion.sample.electricField, 'V/m', 'electric_field'),
          magneticFluxDensity: quantityVector(
            motion.sample.magneticFluxDensity,
            'T',
            'magnetic_flux_density',
          ),
          electricForce: quantityVector(force.electricForce, 'N', 'force'),
          magneticForce: quantityVector(force.magneticForce, 'N', 'force'),
          gravityForce: quantityVector(force.gravityForce, 'N', 'force'),
          netForce: quantityVector(force.totalForce, 'N', 'force'),
        },
      },
    ],
    derived: derivedAt(scene, model, phases, time),
  }
}

/* -------------------------------------------------------------- derived -- */

const derivedAt = (
  scene: PhysicsScene,
  model: CompositeModel,
  phases: readonly CompositePhase[],
  time: number,
): DerivedQuantity[] => {
  const motion = motionAtTime(scene, model, phases, time)
  const sample = motion.sample
  const force = compositeForce(model.charge, model.mass, motion.velocity, sample)
  const speed = magnitude(motion.velocity)
  const kineticEnergy = 0.5 * model.mass * speed * speed
  const initialKinetic = 0.5 * model.mass * magnitude(model.velocity) ** 2
  const assumptions = [...ASSUMPTIONS]

  const derived: DerivedQuantity[] = [
    {
      key: 'electric_force_vector',
      targetId: model.particleId,
      value: quantityVector(force.electricForce, 'N', 'force'),
      formula: { expression: 'F_E = qE' },
      assumptions,
    },
    {
      key: 'electric_force_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(force.electricForce), 'N', 'force'),
      formula: { expression: '|qE|' },
      assumptions,
    },
    {
      key: 'magnetic_force_vector',
      targetId: model.particleId,
      value: quantityVector(force.magneticForce, 'N', 'force'),
      formula: { expression: 'F_B = qv×B' },
      assumptions,
    },
    {
      key: 'magnetic_force_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(force.magneticForce), 'N', 'force'),
      formula: { expression: '|qv×B|' },
      assumptions,
    },
    {
      key: 'gravity_force_vector',
      targetId: model.particleId,
      value: quantityVector(force.gravityForce, 'N', 'force'),
      formula: { expression: 'F_g = mg' },
      assumptions,
    },
    {
      key: 'gravity_force_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(force.gravityForce), 'N', 'force'),
      formula: { expression: '|mg|' },
      assumptions,
    },
    {
      key: 'net_force_vector',
      targetId: model.particleId,
      value: quantityVector(force.totalForce, 'N', 'force'),
      formula: { expression: 'ΣF = qE + qv×B + mg' },
      assumptions,
    },
    {
      key: 'net_force_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(force.totalForce), 'N', 'force'),
      formula: { expression: '|ΣF|' },
      assumptions,
    },
    {
      key: 'acceleration_vector',
      targetId: model.particleId,
      value: quantityVector(motion.acceleration, 'm/s^2', 'acceleration'),
      formula: { expression: 'a = ΣF / m' },
      assumptions,
    },
    {
      key: 'acceleration_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(motion.acceleration), 'm/s^2', 'acceleration'),
      formula: { expression: '|ΣF| / m' },
      assumptions,
    },
    {
      key: 'velocity_vector',
      targetId: model.particleId,
      value: quantityVector(motion.velocity, 'm/s', 'velocity'),
      formula: { expression: 'v(t)' },
      assumptions,
    },
    {
      key: 'speed',
      targetId: model.particleId,
      value: quantity(speed, 'm/s', 'velocity'),
      formula: { expression: '|v(t)|' },
      assumptions,
    },
    {
      key: 'kinetic_energy',
      targetId: model.particleId,
      value: quantity(kineticEnergy, 'J', 'energy'),
      formula: { expression: 'K = ½m|v|²' },
      assumptions,
    },
    {
      key: 'kinetic_energy_change',
      targetId: model.particleId,
      value: quantity(kineticEnergy - initialKinetic, 'J', 'energy'),
      formula: { expression: 'ΔK = W_E + W_g' },
      assumptions,
    },
  ]

  const drift = driftVelocity(model.charge, model.mass, sample)
  if (drift !== undefined) {
    derived.push({
      key: 'drift_velocity',
      targetId: model.particleId,
      value: quantityVector(drift, 'm/s', 'velocity'),
      formula: { expression: 'qE + q(v_d×B) + mg = 0' },
      assumptions,
    })
  }
  const radius = gyroRadius(model.charge, model.mass, motion.velocity, sample)
  if (radius !== undefined) {
    derived.push({
      key: 'gyro_radius',
      targetId: model.particleId,
      /* The gyration radius uses the drift-subtracted velocity, so in crossed
         fields it describes the cycloid loop rather than a circle the particle
         never traces. It reduces to mv/(qB) when B acts alone. */
      value: quantity(radius, 'm', 'length'),
      formula: { expression: 'r = m|v - v_d| / |qB|' },
      assumptions,
    })
  }
  const period = cyclotronPeriod(model.charge, model.mass, sample)
  if (period !== undefined) {
    derived.push({
      key: 'cyclotron_period',
      targetId: model.particleId,
      value: quantity(period, 's', 'time'),
      formula: { expression: 'T = 2πm / |qB|' },
      assumptions,
    })
  }
  const selected = selectorSpeed(sample)
  if (selected !== undefined && selected > 0) {
    derived.push({
      key: 'selected_velocity',
      targetId: model.particleId,
      value: quantity(selected, 'm/s', 'velocity'),
      formula: { expression: 'v = E / B' },
      assumptions,
    })
  }

  return derived
}

/* -------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  model: CompositeModel,
  phases: readonly CompositePhase[],
  states: readonly SimulationState[],
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const tol = DEFAULT_TOLERANCE

  /* Superposition is the defining claim of a composite field: the net force the
     engine integrates must be exactly the sum of the three named parts, or the
     Agent would be citing components that do not add up to the motion shown. */
  let worstSuperposition = 0
  for (const phase of phases) {
    const force = compositeForce(model.charge, model.mass, phase.velocity, phase.sample)
    const summed = add(add(force.electricForce, force.magneticForce), force.gravityForce)
    const residual = magnitude(subtract(summed, force.totalForce))
    const scaleOf = magnitude(force.totalForce) + tol.absolute
    worstSuperposition = Math.max(worstSuperposition, residual / scaleOf)
  }
  checks.push(
    check('composite_force_superposition', 'constraint', worstSuperposition < tol.relative, {
      message: 'ΣF equals the vector sum of the electric, magnetic and gravitational forces.',
      details: { worstRelativeResidual: worstSuperposition },
    }),
  )

  /* qv×B is perpendicular to v by construction, so its power must vanish. A
     non-zero value here would mean the magnetic term had leaked energy into the
     trajectory. */
  let worstPower = 0
  for (const state of states) {
    const object = state.objects[0]
    if (object?.velocity === undefined) continue
    const velocity = toCanonicalVector(object.velocity).vectorSI
    const sample = sampleFieldsAt(scene, toCanonicalVector(object.position!).vectorSI)
    const force = compositeForce(model.charge, model.mass, velocity, sample)
    const denominator = magnitude(force.magneticForce) * magnitude(velocity)
    if (denominator <= 0) continue
    worstPower = Math.max(worstPower, Math.abs(dot(force.magneticForce, velocity)) / denominator)
  }
  checks.push(
    check('magnetic_force_does_no_work', 'conservation', worstPower < tol.angular, {
      message: 'The magnetic force stays perpendicular to the velocity, so it does no work.',
      details: { worstNormalisedPower: worstPower },
    }),
  )

  /* Where B acts alone the speed is a constant of the motion. Checked per phase
     because a composite run may have only some phases like that. */
  const pureMagneticPhases = phases.filter(
    (phase) =>
      magnitude(phase.sample.magneticFluxDensity) > 0 &&
      magnitude(phase.sample.electricField) === 0 &&
      magnitude(phase.sample.gravity) === 0,
  )
  if (pureMagneticPhases.length > 0) {
    let worstSpeedDrift = 0
    for (const phase of pureMagneticPhases) {
      const span = phase.endTime - phase.startTime
      const initial = magnitude(phase.velocity)
      if (initial <= 0) continue
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        const probe = compositeMotionAt(
          model.charge,
          model.mass,
          phase.position,
          phase.velocity,
          phase.sample,
          span * fraction,
        )
        worstSpeedDrift = Math.max(
          worstSpeedDrift,
          Math.abs(magnitude(probe.velocity) - initial) / initial,
        )
      }
    }
    checks.push(
      check('speed_conserved_in_pure_magnetic', 'conservation', worstSpeedDrift < 1e-6, {
        message: 'Speed is unchanged across every phase where only a magnetic field acts.',
        details: { worstRelativeDrift: worstSpeedDrift },
      }),
    )
  }

  /* The work-energy theorem, restricted to the forces that can do work. Summed
     phase by phase because E and g differ between regions. */
  let work = 0
  for (const phase of phases) {
    const span = phase.endTime - phase.startTime
    if (span <= 0) continue
    const exit = compositeMotionAt(
      model.charge,
      model.mass,
      phase.position,
      phase.velocity,
      phase.sample,
      span,
    )
    const displacement = subtract(exit.position, phase.position)
    const workingForce = add(
      scale(phase.sample.electricField, model.charge),
      scale(phase.sample.gravity, model.mass),
    )
    work += dot(workingForce, displacement)
  }
  const lastState = states[states.length - 1]
  const finalVelocity =
    lastState?.objects[0]?.velocity === undefined
      ? model.velocity
      : toCanonicalVector(lastState.objects[0].velocity).vectorSI
  const deltaKinetic =
    0.5 * model.mass * (magnitude(finalVelocity) ** 2 - magnitude(model.velocity) ** 2)
  /* Normalising by the CHANGE alone made this check unusable for the classic
     balanced case: when qE, qv×B and mg cancel, the true work is exactly zero and
     ΔK is pure float noise (ΔK is a difference of two ~equal kinetic energies, so
     it carries a few ulps of the energy itself), making
     |work − ΔK| / max(|work|, |ΔK|) ≈ 1 for a perfectly correct simulation.
     The scale therefore carries a floor tied to the kinetic energy present: with
     the 1e-6 threshold below, the floor admits discrepancies up to 1e-14 of the
     kinetic energy — dozens of ulps, and eight orders of magnitude below any
     physical violation, which would be ≥1e-6 of it. */
  const kineticScale = 0.5 * model.mass * magnitude(model.velocity) ** 2
  const energyScale = Math.max(
    Math.abs(work),
    Math.abs(deltaKinetic),
    kineticScale * 1e-8,
    tol.absolute,
  )
  checks.push(
    check('energy_consistency', 'conservation', Math.abs(work - deltaKinetic) / energyScale < 1e-6, {
      message: 'Work done by the electric and gravitational forces equals the kinetic-energy change.',
      details: { work, deltaKinetic, energyScale },
    }),
  )

  /* Cyclotron period depends only on q/m and B, never on speed — the fact that
     makes a cyclotron work at a fixed driving frequency. The analytic period
     function has no velocity parameter, so "comparing two periods" would be a
     value compared with itself; instead the property is exercised on the real
     trajectory: after exactly one period the gyration phase closes (v(T) = v0),
     at two very different launch speeds. */
  const firstMagnetic = phases.find((phase) => magnitude(phase.sample.magneticFluxDensity) > 0)
  if (firstMagnetic !== undefined) {
    const period = cyclotronPeriod(model.charge, model.mass, firstMagnetic.sample)
    if (period !== undefined) {
      const speedBase = Math.max(1e-6, magnitude(model.velocity))
      const launchSpeeds = [speedBase, speedBase * 3]
      const direction = magnitude(model.velocity) > 0
        ? scale(model.velocity, 1 / magnitude(model.velocity))
        : vec3(1, 0, 0)
      const phaseClosesAtBothSpeeds = launchSpeeds.every((speed) => {
        const v0 = scale(direction, speed)
        const after = compositeMotionAt(
          model.charge,
          model.mass,
          model.position,
          v0,
          firstMagnetic.sample,
          period,
        )
        const residual = magnitude(subtract(after.velocity, v0))
        return residual < tol.absolute + 1e-9 * speed
      })
      checks.push(
        check(
          'cyclotron_period_independent_of_speed',
          'constraint',
          phaseClosesAtBothSpeeds,
          {
            message: 'The cyclotron period is set by q/m and B alone, independent of speed.',
            details: { period },
          },
        ),
      )
    }
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation request -- */

export function createCompositeSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'composite',
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

/* ------------------------------------------------------------- the engine -- */

export class CompositeEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = COMPOSITE_ENGINE_ID
  readonly engineVersion = COMPOSITE_ENGINE_VERSION
  readonly domain = 'composite' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (!isCompositeFieldScene(scene)) {
      return unsupportedModel(
        [
          failure(
            'composite_field_scene',
            'Composite engine requires at least two of electric, magnetic and gravitational uniform fields.',
          ),
        ],
        COMPOSITE_ENGINE_ID,
      )
    }
    /* A region whose containment test does not exist cannot be sampled, and
       guessing "outside" would place the particle beyond a field that acts on it.
       Refusing the scene is the only honest option. */
    if (hasUnsampleableRegion(scene)) {
      return unsupportedModel(
        [
          failure(
            'sampleable_regions',
            'Composite engine supports rectangular and unbounded regions only.',
          ),
        ],
        COMPOSITE_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(COMPOSITE_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        COMPOSITE_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [failure('scene_is_2d', 'Composite engine supports 2D scenes only.')],
        COMPOSITE_ENGINE_ID,
      )
    }
    if (scene.particles.length !== 1 || scene.bodies.length > 0) {
      return unsupportedModel(
        [failure('single_particle', 'Composite engine requires exactly one particle and no bodies.')],
        COMPOSITE_ENGINE_ID,
      )
    }
    if (scene.constraints.length > 0 || scene.forces.length > 0) {
      return unsupportedModel(
        [
          failure(
            'fields_only',
            'Composite engine derives every force from fields; explicit forces and constraints are not combined.',
          ),
        ],
        COMPOSITE_ENGINE_ID,
      )
    }

    const particle = scene.particles[0]
    if (particle === undefined || particle.charge === undefined) {
      return invalidModelCondition(COMPOSITE_ENGINE_ID, [
        failure('charge_defined', 'The particle charge must be defined.'),
      ])
    }
    const mass = canonicalValue(particle.mass)
    if (!Number.isFinite(mass) || mass <= 0) {
      return invalidModelCondition(COMPOSITE_ENGINE_ID, [
        failure('mass_positive', 'Particle mass must be greater than zero.'),
      ])
    }
    const position = toCanonicalVector(particle.position).vectorSI
    const velocity = toCanonicalVector(particle.velocity).vectorSI
    if (!isFiniteVector(position) || !isFiniteVector(velocity)) {
      return invalidModelCondition(COMPOSITE_ENGINE_ID, [
        failure('finite_initial_state', 'Initial position and velocity must be finite.'),
      ])
    }

    /* Sampling now surfaces an off-axis B (the core throws rather than projecting)
       as an unsupported model instead of an exception mid-simulate. */
    try {
      const sample = sampleFieldsAt(scene, position)
      compositeForce(canonicalValue(particle.charge), mass, velocity, sample)
    } catch (error: unknown) {
      return invalidModelCondition(COMPOSITE_ENGINE_ID, [
        failure(
          'field_geometry',
          error instanceof Error ? error.message : 'Composite field geometry is unsupported.',
        ),
      ])
    }

    return supported(COMPOSITE_FIELD_MODEL, this.domain)
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
    const seconds = canonicalValue(time)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    const model = resolveCompositeModel(scene)
    const endTime =
      scene.timeline.endTime === undefined
        ? DEFAULT_DURATION_SECONDS
        : canonicalValue(scene.timeline.endTime)
    const { phases } = decomposePhases(scene, model, Math.max(seconds, endTime))
    return stateAtForModel(scene, model, phases, seconds)
  }

  stateAtSeconds(scene: PhysicsScene, seconds: number): SimulationState {
    return this.stateAt(scene, quantity(seconds, 's', 'time'))
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

    const model = resolveCompositeModel(scene)
    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const sceneDuration =
      scene.timeline.endTime === undefined
        ? DEFAULT_DURATION_SECONDS
        : canonicalValue(scene.timeline.endTime)
    const endTime =
      request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }

    const { phases, truncated } = decomposePhases(scene, model, endTime)

    /* Uniform sampling plus every phase boundary. Without the boundaries a
       gyration arc that starts and ends between two samples would be drawn as a
       straight chord, and the region-crossing instant — which the timeline marks —
       would be off by up to one sample interval. */
    const times = new Set<number>()
    for (let i = 0; i <= TRAJECTORY_SAMPLES; i += 1) {
      times.add(startTime + ((endTime - startTime) * i) / TRAJECTORY_SAMPLES)
    }
    for (const phase of phases) {
      if (phase.startTime >= startTime && phase.startTime <= endTime) times.add(phase.startTime)
      if (phase.endTime >= startTime && phase.endTime <= endTime) times.add(phase.endTime)
    }
    const sortedTimes = [...times].sort((a, b) => a - b)
    const states = sortedTimes.map((time) => stateAtForModel(scene, model, phases, time))

    const events: PhysicsEventLike[] = []
    for (const phase of phases) {
      if (phase.boundary === 'end_of_run') continue
      if (phase.endTime < startTime || phase.endTime > endTime) continue
      for (const regionId of phase.entered) {
        events.push({
          eventId: asPhysicsEventId(`event-enter-region-${regionId}-p${phase.index}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'EnterRegion',
          time: phase.endTime,
        })
      }
      for (const regionId of phase.exited) {
        events.push({
          eventId: asPhysicsEventId(`event-exit-region-${regionId}-p${phase.index}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'ExitRegion',
          time: phase.endTime,
        })
      }
      if (phase.entered.length === 0 && phase.exited.length === 0) {
        events.push({
          eventId: asPhysicsEventId(`event-switch-field-p${phase.index}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'SwitchField',
          time: phase.endTime,
        })
      }
    }

    const verification = buildVerification(scene, model, phases, states)
    const startedAt = new Date().toISOString()

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities: derivedAt(scene, model, phases, endTime),
      verification,
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'analytic-drift-gyration',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
        ...(truncated ? { notes: `phase decomposition truncated at ${MAX_PHASES} phases` } : {}),
      },
      trace: request.trace,
    }
  }
}

export const compositeEngine = new CompositeEngine()
