import {
  check,
  invalidModelCondition,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type QuantityVector,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { energyBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveEnergyModel, type ResolvedEnergyModel } from './energy-model.ts'
import {
  ENERGY_RELATIVE_TOLERANCE,
  energyLedgerOf,
  frictionWorkOnRamp,
  kineticEnergy,
  rampLengthOf,
  speedFromHeight,
} from './energy.ts'

export const ENERGY_ENGINE_ID = 'engine-energy'
export const ENERGY_ENGINE_VERSION = '1.0.0'
export const MECHANICAL_ENERGY_MODEL = 'mechanical_energy_ledger'

const ENERGY_ASSUMPTIONS = [
  'the cart is a point mass: no rotational energy in its wheels',
  'kinetic friction is constant along the ramp and does no work on the way up a frictionless track',
  'the ramp is rigid, so no energy is stored in it',
  'the ledger is taken between the release point and the bottom, at rest at both ends',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const joules = (value: number): Quantity<'energy'> => quantity(value, 'J', 'energy')
const kilograms = (value: number): Quantity<'mass'> => quantity(value, 'kg', 'mass')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const metresPerSecond = (value: number): Quantity<'velocity'> =>
  quantity(value, 'm/s', 'velocity')
const radians = (value: number): Quantity<'angle'> => quantity(value, 'rad', 'angle')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** Solve the scene's energy bench; the single entry point UI layers reuse. */
export const resolveEnergy = (scene: PhysicsScene): ResolvedEnergyModel =>
  resolveEnergyModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedEnergyModel): DerivedQuantity[] => {
  const assumptions = [...ENERGY_ASSUMPTIONS]
  const ledger = energyLedgerOf(model)
  return [
    {
      key: 'cart_mass',
      targetId: model.benchId,
      value: kilograms(ledger.mass),
      formula: { expression: 'm' },
      assumptions,
    },
    {
      key: 'release_height',
      targetId: model.benchId,
      value: metres(ledger.releaseHeight),
      formula: { expression: 'h' },
      assumptions,
    },
    {
      key: 'incline_angle',
      targetId: model.benchId,
      value: radians(ledger.inclineAngle),
      formula: { expression: 'θ' },
      assumptions,
    },
    {
      key: 'ramp_length',
      targetId: model.benchId,
      value: metres(ledger.rampLength),
      formula: { expression: 'L = h/sinθ' },
      assumptions,
    },
    {
      key: 'friction_coefficient',
      targetId: model.benchId,
      value: dimensionless(ledger.frictionCoefficient),
      formula: { expression: 'μ' },
      assumptions,
    },
    {
      key: 'potential_energy',
      targetId: model.benchId,
      value: joules(ledger.potentialAtRelease),
      formula: { expression: 'Ep = mgh' },
      assumptions,
    },
    {
      key: 'friction_work',
      targetId: model.benchId,
      value: joules(ledger.frictionWork),
      formula: { expression: 'W_摩擦 = μmg·cosθ·L' },
      assumptions,
    },
    {
      key: 'kinetic_energy',
      targetId: model.benchId,
      value: joules(ledger.kineticAtBottom),
      formula: { expression: 'Ek = mgh − W_摩擦' },
      assumptions,
    },
    {
      key: 'speed_at_bottom',
      targetId: model.benchId,
      value: metresPerSecond(ledger.speedAtBottom),
      formula: { expression: 'v = √(2Ek/m)' },
      assumptions,
    },
  ]
}

/**
 * The cart really does move, but the ledger does not need the clock: where the
 * cart is is a position on the ramp, and the energies follow from the height.
 * `time` is accepted so the engine satisfies the same interface as the timed
 * benches, and it does not change a single value.
 */
const stateOf = (model: ResolvedEnergyModel, timeSeconds: number): SimulationState => {
  const values: Record<string, Quantity | QuantityVector> = {}
  for (const entry of derivedOf(model)) values[entry.key] = entry.value
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects: [{ id: model.benchId, values }],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const within = (actual: number, expected: number, scale: number): boolean =>
  Math.abs(actual - expected) <=
  Math.max(ENERGY_RELATIVE_TOLERANCE, ENERGY_RELATIVE_TOLERANCE * Math.abs(scale))

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedEnergyModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const ledger = energyLedgerOf(model)

  /* The ledger has to ADD UP: what the cart started with is what it has at the
     bottom plus what friction took. A rig that dropped the friction term, or
     double-counted it, cannot balance — which is the whole claim of 能量守恒. */
  checks.push(
    check(
      'ledger_sums_to_release_height',
      'conservation',
      within(ledger.energyAccounted, ledger.potentialAtRelease, ledger.potentialAtRelease),
      {
        message:
          '能量守恒：出发时的重力势能 mgh 等于到底端的动能加上摩擦生的热 —— 账本两边必须相等。',
        targetId: model.benchId,
        details: {
          potentialAtRelease: ledger.potentialAtRelease,
          kineticAtBottom: ledger.kineticAtBottom,
          frictionWork: ledger.frictionWork,
          accounted: ledger.energyAccounted,
        },
      },
    ),
  )

  /* The speed is checked against KINEMATICS, not against the ledger: √(2gh) is
     what free fall gives for the same drop, and it must be what the frictionless
     ramp gives too. Then the kinetic energy is re-derived from the speed, so a
     speed and an energy that disagree cannot both pass. */
  const kinematicSpeed = speedFromHeight(model.gravity, model.releaseHeight)
  const speedMatchesLedger = within(
    kineticEnergy(model.mass, ledger.speedAtBottom),
    ledger.kineticAtBottom,
    ledger.kineticAtBottom,
  )
  checks.push(
    check(
      'speed_from_height',
      'constraint',
      speedMatchesLedger &&
        (model.frictionCoefficient > 0
          ? ledger.speedAtBottom < kinematicSpeed
          : within(ledger.speedAtBottom, kinematicSpeed, kinematicSpeed)),
      {
        message:
          '速度与高度：光滑斜面上到底端的速度就是 √(2gh)（与自由落体一样），粗糙斜面上则更慢 —— 慢掉的那部分正是被摩擦带走的那部分。',
        targetId: model.benchId,
        details: {
          speedAtBottom: ledger.speedAtBottom,
          kinematicSpeed,
          frictionCoefficient: model.frictionCoefficient,
        },
      },
    ),
  )

  /* Friction's work, three ways: as μmg·cosθ·L, as μmg·h·cotθ, and at half the
     height where it must be exactly half. The last of those is the one that
     catches a slipped cosine — and the ANGLED comparison that follows states the
     result that surprises everyone: a shallower ramp takes MORE, not less. */
  const viaCotangent =
    model.frictionCoefficient *
    model.mass *
    model.gravity *
    model.releaseHeight *
    (Math.cos(model.inclineAngle) / Math.sin(model.inclineAngle))
  const atHalfHeight = frictionWorkOnRamp(
    model.frictionCoefficient,
    model.mass,
    model.gravity,
    model.inclineAngle,
    rampLengthOf(model.releaseHeight / 2, model.inclineAngle),
  )
  const atShallowerAngle = frictionWorkOnRamp(
    model.frictionCoefficient,
    model.mass,
    model.gravity,
    model.inclineAngle / 2,
    rampLengthOf(model.releaseHeight, model.inclineAngle / 2),
  )
  checks.push(
    check(
      'friction_work_from_ramp_length',
      'constraint',
      within(viaCotangent, ledger.frictionWork, ledger.frictionWork) &&
        within(atHalfHeight, ledger.frictionWork / 2, ledger.frictionWork / 2) &&
        atShallowerAngle >= ledger.frictionWork,
      {
        message:
          '摩擦力做的功 W = μmg·cosθ·L，也就是 μmg·h·cotθ：高度减半它就减半，但**斜面越缓它越大** —— 路程按 cotθ 变长，正压力只按 cosθ 变小。',
        targetId: model.benchId,
        details: {
          frictionWork: ledger.frictionWork,
          viaCotangent,
          atHalfHeight,
          atShallowerAngle,
          inclineAngle: model.inclineAngle,
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createEnergySimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'mechanics',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class EnergyEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = ENERGY_ENGINE_ID
  readonly engineVersion = ENERGY_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (energyBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Energy Engine requires exactly one mechanical-energy bench.')],
        ENERGY_ENGINE_ID,
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
      (scene.leverBenches ?? []).length > 0 ||
      (scene.pressureBenches ?? []).length > 0 ||
      (scene.currentBenches ?? []).length > 0 ||
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_energy_scene',
            'Energy Engine models pure mechanical-energy benches without motion objects, fields, circuits or other benches.',
          ),
        ],
        ENERGY_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(ENERGY_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        ENERGY_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveEnergyModel(scene)
      return supported(MECHANICAL_ENERGY_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(ENERGY_ENGINE_ID, [
        failure(
          'energy_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for energy.',
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
    return stateOf(resolveEnergyModel(scene), timeSeconds)
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
    const model = resolveEnergyModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state: the ledger is a function of the geometry, so a run of states
         would be the same numbers repeated at different clocks. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-energy-ledger-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'EnergyLedgerSettled',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'energy-ledger-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const energyEngine = new EnergyEngine()
