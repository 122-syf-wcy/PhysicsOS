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
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { fluidTanksOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { buoyancyFromPressure, equilibriumOf, immersionStateAt } from './buoyancy.ts'
import { resolveFluidModel, type ResolvedFluidModel } from './fluid-model.ts'

export const FLUID_ENGINE_ID = 'engine-fluid'
export const FLUID_ENGINE_VERSION = '1.0.0'
export const BUOYANCY_MODEL = 'spring_scale_buoyancy'

/**
 * Sampled states across the descent. 64 even segments put sample 32 exactly on
 * the full-submersion instant for a sinker (whose run is twice as long as the
 * covering phase), so the kink in the reading curve is exact rather than
 * interpolated.
 */
const TRAJECTORY_SEGMENTS = 64

/** Relative tolerance for closed-form self-consistency checks. */
const FLUID_RELATIVE_TOLERANCE = 1e-9

const FLUID_ASSUMPTIONS = [
  'fluid statics: the liquid is at rest and incompressible, of uniform density',
  'the block is lowered slowly enough that drag and sloshing are negligible',
  'the tank is wide enough that the surface level does not rise appreciably',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const newtons = (value: number): Quantity<'force'> => quantity(value, 'N', 'force')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const cubicMetres = (value: number): Quantity<'volume'> => quantity(value, 'm^3', 'volume')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const density = (value: number): Quantity<'density'> => quantity(value, 'kg/m^3', 'density')

/** Solve the scene's buoyancy rig; the single entry point UI layers reuse. */
export const resolveBuoyancy = (scene: PhysicsScene): ResolvedFluidModel => resolveFluidModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedFluidModel): DerivedQuantity[] => {
  const assumptions = [...FLUID_ASSUMPTIONS]
  const { weight, settleTime } = equilibriumOf(model)
  const settled = immersionStateAt(model, settleTime)
  return [
    {
      key: 'block_weight',
      targetId: model.blockId,
      value: newtons(weight),
      formula: { expression: 'G = mg' },
      assumptions,
    },
    {
      key: 'block_density',
      targetId: model.blockId,
      value: density(model.blockDensity),
      formula: { expression: 'ρ_物 = m/V' },
      assumptions,
    },
    {
      key: 'liquid_density',
      targetId: model.liquidId,
      value: density(model.liquidDensity),
      formula: { expression: 'ρ_液' },
      assumptions,
    },
    {
      key: 'displaced_volume',
      targetId: model.liquidId,
      value: cubicMetres(settled.displacedVolume),
      formula: { expression: 'V_排 = A·s' },
      assumptions,
    },
    {
      /* The weight of the liquid pushed aside — the quantity Archimedes' law
         equates the buoyant force to, and the one the overflow can measures. */
      key: 'displaced_weight',
      targetId: model.liquidId,
      value: newtons(model.liquidDensity * settled.displacedVolume * model.gravity),
      formula: { expression: 'G_排 = ρ_液·g·V_排' },
      assumptions,
    },
    {
      key: 'buoyant_force',
      targetId: model.blockId,
      value: newtons(settled.buoyantForce),
      formula: { expression: 'F_浮 = G − F_示' },
      assumptions,
    },
    {
      key: 'scale_reading',
      targetId: model.blockId,
      value: newtons(settled.scaleReading),
      formula: { expression: 'F_示 = G − F_浮' },
      assumptions,
    },
  ]
}

const stateOf = (model: ResolvedFluidModel, timeSeconds: number): SimulationState => {
  const immersion = immersionStateAt(model, timeSeconds)
  return {
    time: seconds(timeSeconds),
    objects: [
      {
        id: model.tankId,
        values: {
          immersion_depth: metres(immersion.depth),
          submerged_height: metres(immersion.submergedHeight),
          displaced_volume: cubicMetres(immersion.displacedVolume),
          buoyant_force: newtons(immersion.buoyantForce),
          scale_reading: newtons(immersion.scaleReading),
        },
      },
      { id: model.blockId, values: { depth_below_surface: metres(immersion.depth) } },
    ],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedFluidModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const { weight, floats, settledSubmergedHeight, settleTime } = equilibriumOf(model)
  const settled = immersionStateAt(model, settleTime)

  /* Archimedes against the pressure route: buoyancy IS the difference between
     the pressures on the bottom and top faces, so ρ·g·V_排 and (p₂−p₁)·A must
     agree. Two different formulas, one number. */
  const fromPressure = buoyancyFromPressure(model, settled.depth)
  checks.push(
    check(
      'archimedes_principle',
      'constraint',
      Math.abs(fromPressure - settled.buoyantForce) <=
        FLUID_RELATIVE_TOLERANCE * Math.max(settled.buoyantForce, 1),
      {
        message: '阿基米德原理：F_浮 = ρ_液·g·V_排 与上下表面压力差 (p₂−p₁)·S 一致。',
        targetId: model.blockId,
        details: {
          fromDisplacement: settled.buoyantForce,
          fromPressure,
          displacedVolume: settled.displacedVolume,
        },
      },
    ),
  )

  /* Force balance on the hanging block at EVERY sampled instant, not just the
     end: the scale reads exactly what buoyancy takes off the weight. */
  const balanceResidual = Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) => {
    const state = immersionStateAt(model, (index / TRAJECTORY_SEGMENTS) * settleTime)
    return Math.abs(state.scaleReading + state.buoyantForce - weight)
  }).reduce((worst, value) => Math.max(worst, value), 0)
  checks.push(
    check(
      'scale_reading_balance',
      'constraint',
      balanceResidual <= FLUID_RELATIVE_TOLERANCE * weight,
      {
        message: '称重法自洽：整段下放过程中 F_示 + F_浮 = G 始终成立。',
        targetId: model.blockId,
        details: { weight, worstResidual: balanceResidual },
      },
    ),
  )

  if (floats) {
    /* A floater settles where buoyancy exactly carries the weight, and the
       string goes slack — the scale must read zero there. */
    const floatResidual = Math.abs(settled.buoyantForce - weight)
    checks.push(
      check(
        'float_equilibrium',
        'constraint',
        model.blockDensity < model.liquidDensity &&
          floatResidual <= FLUID_RELATIVE_TOLERANCE * weight &&
          settledSubmergedHeight < model.blockHeight,
        {
          message: '漂浮平衡：ρ_物 < ρ_液，物块部分浸入后 F_浮 = G，测力计读数归零。',
          targetId: model.blockId,
          details: {
            blockDensity: model.blockDensity,
            liquidDensity: model.liquidDensity,
            submergedFraction: settledSubmergedHeight / model.blockHeight,
          },
        },
      ),
    )
  } else {
    /* The headline misconception: once the block is covered, going deeper does
       not change the buoyant force. Sampled at two genuinely different depths. */
    const justCovered = immersionStateAt(model, model.blockHeight / model.lowerRate)
    const muchDeeper = immersionStateAt(model, settleTime)
    checks.push(
      check(
        'buoyancy_depth_independent',
        'constraint',
        muchDeeper.depth > justCovered.depth &&
          Math.abs(muchDeeper.buoyantForce - justCovered.buoyantForce) <=
            FLUID_RELATIVE_TOLERANCE * Math.max(justCovered.buoyantForce, 1),
        {
          message: '浮力与深度无关：完全浸没后继续下沉，F_浮 不再变化。',
          targetId: model.blockId,
          details: {
            shallowDepth: justCovered.depth,
            deepDepth: muchDeeper.depth,
            buoyantForce: justCovered.buoyantForce,
          },
        },
      ),
    )
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createFluidSimulationRequest(
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

export class FluidEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = FLUID_ENGINE_ID
  readonly engineVersion = FLUID_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (fluidTanksOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_tank', 'Fluid Engine requires exactly one tank.')],
        FLUID_ENGINE_ID,
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
      (scene.acousticBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_fluid_scene',
            'Fluid Engine models pure buoyancy scenes without motion objects, fields, circuits, optics or acoustics.',
          ),
        ],
        FLUID_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(FLUID_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        FLUID_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveFluidModel(scene)
      return supported(BUOYANCY_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(FLUID_ENGINE_ID, [
        failure(
          'buoyancy_model_resolvable',
          error instanceof Error ? error.message : 'The tank cannot be resolved for buoyancy.',
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
    return stateOf(resolveFluidModel(scene), timeSeconds)
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
    const model = resolveFluidModel(scene)
    const { floats, settleTime } = equilibriumOf(model)

    const states = Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) =>
      stateOf(model, (index / TRAJECTORY_SEGMENTS) * settleTime),
    )

    const events: PhysicsEventLike[] = [
      {
        eventId: asPhysicsEventId(`event-block-enters-${model.tankId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'BlockEntersLiquid',
        time: 0,
      },
      floats
        ? {
          eventId: asPhysicsEventId(`event-block-floats-${model.tankId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'BlockFloats',
          time: settleTime,
        }
        : {
          eventId: asPhysicsEventId(`event-block-submerged-${model.tankId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'BlockFullySubmerged',
          time: model.blockHeight / model.lowerRate,
        },
      {
        eventId: asPhysicsEventId(`event-descent-complete-${model.tankId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'DescentComplete',
        time: settleTime,
      },
    ]

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'buoyancy-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const fluidEngine = new FluidEngine()
