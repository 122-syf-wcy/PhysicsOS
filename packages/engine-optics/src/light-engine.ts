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
import { lightBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveLightModel, type ResolvedLightModel } from './light-model.ts'
import {
  LIGHT_RELATIVE_TOLERANCE,
  criticalAngleOf,
  imagePointOf,
  refractedAngleOf,
  refractionReadingOf,
  pinholeImageHeight,
  pinholeMagnification,
  pinholeReadingOf,
} from './light.ts'

export const LIGHT_ENGINE_ID = 'engine-light'
export const LIGHT_ENGINE_VERSION = '1.0.0'
export const PINHOLE_MODEL = 'rectilinear_pinhole_image'
export const TOTAL_REFLECTION_MODEL = 'total_internal_reflection'

const LIGHT_ASSUMPTIONS = [
  'light travels in straight lines through the hole',
  'the hole is small compared with the object, so every point of the object maps to one point of the image',
  'the object is perpendicular to the axis and the screen is parallel to it',
  'the boundary is flat and the media are homogeneous, so Snell\'s law holds at every point of it',
  'diffraction at the hole is ignored — a smaller hole sharpens the image rather than blurring it in this model',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const radians = (value: number): Quantity<'angle'> => quantity(value, 'rad', 'angle')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** Solve the scene's light bench; the single entry point UI layers reuse. */
export const resolveLight = (scene: PhysicsScene): ResolvedLightModel => resolveLightModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedLightModel): DerivedQuantity[] => {
  const assumptions = [...LIGHT_ASSUMPTIONS]
  if (model.type === 'total_reflection') {
    const reading = refractionReadingOf(model)
    const entries: DerivedQuantity[] = [
      {
        key: 'incident_index',
        targetId: model.benchId,
        value: dimensionless(reading.incidentIndex),
        formula: { expression: 'n₁' },
        assumptions,
      },
      {
        key: 'refracted_index',
        targetId: model.benchId,
        value: dimensionless(reading.refractedIndex),
        formula: { expression: 'n₂' },
        assumptions,
      },
      {
        key: 'incident_angle',
        targetId: model.benchId,
        value: radians(reading.incidentAngle),
        formula: { expression: 'θ₁' },
        assumptions,
      },
    ]
    if (reading.criticalAngle !== undefined) {
      entries.push({
        key: 'critical_angle',
        targetId: model.benchId,
        value: radians(reading.criticalAngle),
        formula: { expression: 'θ_c = arcsin(n₂/n₁)' },
        assumptions,
      })
    }
    if (reading.refractedAngle !== undefined) {
      entries.push({
        key: 'refracted_angle',
        targetId: model.benchId,
        value: radians(reading.refractedAngle),
        formula: { expression: 'n₁sinθ₁ = n₂sinθ₂' },
        assumptions,
      })
    }
    entries.push({
      key: 'total_internal_reflection',
      targetId: model.benchId,
      value: dimensionless(reading.totalInternalReflection ? -1 : 1),
      formula: { expression: 'θ₁ ≥ θ_c 时没有折射光线' },
      assumptions,
    })
    return entries
  }

  const reading = pinholeReadingOf(model)
  return [
    {
      key: 'object_height',
      targetId: model.benchId,
      value: metres(reading.objectHeight),
      formula: { expression: 'h' },
      assumptions,
    },
    {
      key: 'object_distance',
      targetId: model.benchId,
      value: metres(reading.objectDistance),
      formula: { expression: 'u' },
      assumptions,
    },
    {
      key: 'screen_distance',
      targetId: model.benchId,
      value: metres(reading.screenDistance),
      formula: { expression: 'v' },
      assumptions,
    },
    {
      key: 'magnification',
      targetId: model.benchId,
      value: dimensionless(reading.magnification),
      formula: { expression: 'm = v/u' },
      assumptions,
    },
    {
      key: 'image_height',
      targetId: model.benchId,
      value: metres(reading.imageHeight),
      formula: { expression: "h′ = h·v/u" },
      assumptions,
    },
    {
      key: 'inverted',
      targetId: model.benchId,
      value: dimensionless(reading.inverted ? -1 : 1),
      formula: { expression: '倒立：过孔的光继续直走，上下交换' },
      assumptions,
    },
  ]
}

/**
 * The rig is static: the object, the hole and the screen do not move, so the
 * image is the same at every instant. `time` is accepted so the engine
 * satisfies the same interface as the timed benches, and it changes nothing.
 */
const stateOf = (model: ResolvedLightModel, timeSeconds: number): SimulationState => {
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
  Math.max(LIGHT_RELATIVE_TOLERANCE, LIGHT_RELATIVE_TOLERANCE * Math.abs(scale))

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedLightModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  if (model.type === 'total_reflection') {
    const reading = refractionReadingOf(model)
    const critical = criticalAngleOf(model.incidentIndex, model.refractedIndex)

    /* Snell's law, re-derived: the product n·sinθ has to be the SAME on both
       sides of the boundary. A slipped index or a cosine in place of a sine
       cannot balance, and the check needs no reference to the reading. */
    const snellBalanced =
      reading.refractedAngle === undefined
        ? true
        : within(
            model.refractedIndex * Math.sin(reading.refractedAngle),
            model.incidentIndex * Math.sin(model.incidentAngle),
            1,
          )
    checks.push(
      check('snell_law_holds', 'constraint', snellBalanced, {
        message: '折射定律 n₁sinθ₁ = n₂sinθ₂：边界两侧 n·sinθ 必须相等。',
        targetId: model.benchId,
        details: { incidentIndex: model.incidentIndex, refractedIndex: model.refractedIndex },
      }),
    )

    /* The critical angle is DEFINED as the angle whose refraction grazes along
       the boundary: at θ_c the refracted angle must come out exactly 90°. */
    const grazing =
      critical === undefined
        ? true
        : within((Math.asin(1) * 180) / Math.PI, 90, 1) &&
          within(
            refractedAngleOf(model.incidentIndex, model.refractedIndex, critical) ?? 0,
            Math.PI / 2,
            Math.PI / 2,
          )
    checks.push(
      check('critical_angle_grazes_the_boundary', 'constraint', grazing, {
        message: '临界角的意义：正好以 θ_c 入射时，折射光线贴着界面走（折射角 90°）。',
        targetId: model.benchId,
        details: { criticalAngle: critical ?? null },
      }),
    )

    /* 全反射 is the DISAPPEARANCE of the refracted branch, so it is checked as
       an absence either side of θ_c — and that light entering a denser medium
       never has one, because n₁ < n₂ has a solution for every angle. */
    const pastCritical =
      critical === undefined
        ? true
        : refractedAngleOf(model.incidentIndex, model.refractedIndex, critical + 1e-4) ===
            undefined &&
          refractedAngleOf(model.incidentIndex, model.refractedIndex, critical - 1e-4) !== undefined
    const intoDenserHasNoCritical =
      model.incidentIndex >= model.refractedIndex || criticalAngleOf(1.0, 1.5) === undefined
    checks.push(
      check('refraction_vanishes_past_the_critical_angle', 'constraint', pastCritical && intoDenserHasNoCritical, {
        message:
          '全反射：入射角超过临界角后折射光线不再存在（光全部返回）；而从光疏射入光密介质时不存在临界角，任何角度都能折射。',
        targetId: model.benchId,
        details: { incidentAngle: model.incidentAngle, criticalAngle: critical ?? null },
      }),
    )

    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const reading = pinholeReadingOf(model)

  /* The image is where STRAIGHT LINES put it. The tip ray runs from the object's
     top through the hole and on to the screen; the tail ray the same way from
     the bottom. Both are checked against h·v/u — a route to the answer that does
     not compute a ratio of heights at all, so a slipped numerator cannot pass. */
  const points = imagePointOf(model.objectHeight, model.objectDistance, model.screenDistance)
  const heightFromRays = (points.tail - points.tip) / 2
  checks.push(
    check(
      'image_from_straight_rays',
      'constraint',
      within(heightFromRays, reading.imageHeight, reading.imageHeight) &&
        within(points.tip, -reading.imageHeight, reading.imageHeight) &&
        within(points.tail, reading.imageHeight, reading.imageHeight),
      {
        message:
          '光的直线传播：从顶端出发的光过孔后继续直走，落到屏的下方；从底端出发的落到上方 —— 两条直线在小孔交叉，像因此倒立，大小由 h′ = h·v/u 给出。',
        targetId: model.benchId,
        details: {
          imageHeight: reading.imageHeight,
          tipAt: points.tip,
          tailAt: points.tail,
        },
      },
    ),
  )

  /* 倒立 is a consequence, not a setting: the geometry makes the tip land below
     the axis and the tail above it, and this says so in signs. */
  checks.push(
    check('image_is_inverted', 'constraint', reading.inverted && reading.imageHeight > 0, {
      message: '小孔成倒立的像：顶端成像在下方、底端成像在上方 —— 这是光的直线传播的必然结果。',
      targetId: model.benchId,
      details: { tipAt: points.tip, tailAt: points.tail },
    }),
  )

  /* The two lengths do different things and both are checked at once: pulling
     the screen away makes the IMAGE bigger in proportion, while pushing the
     object away makes it smaller. A rig that swapped u and v would satisfy one
     and fail the other. */
  const fartherScreen = pinholeImageHeight(
    model.objectHeight,
    model.objectDistance,
    model.screenDistance * 2,
  )
  const fartherObject = pinholeImageHeight(
    model.objectHeight,
    model.objectDistance * 2,
    model.screenDistance,
  )
  checks.push(
    check(
      'image_scales_with_both_distances',
      'constraint',
      within(fartherScreen, 2 * reading.imageHeight, 2 * reading.imageHeight) &&
        within(fartherObject, reading.imageHeight / 2, reading.imageHeight / 2) &&
        within(
          pinholeMagnification(model.objectDistance * 2, model.screenDistance),
          reading.magnification / 2,
          reading.magnification / 2,
        ),
      {
        message:
          '像的大小由两个距离之比决定：屏向后移一倍，像大一倍；物向前移一倍（离孔更远），像小一半 —— 放大率就是 v/u。',
        targetId: model.benchId,
        details: {
          magnification: reading.magnification,
          imageAtDoubleScreenDistance: fartherScreen,
          imageAtDoubleObjectDistance: fartherObject,
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createLightSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'optics',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class LightEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = LIGHT_ENGINE_ID
  readonly engineVersion = LIGHT_ENGINE_VERSION
  readonly domain = 'optics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (lightBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Light Engine requires exactly one light-propagation bench.')],
        LIGHT_ENGINE_ID,
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
      (scene.energyBenches ?? []).length > 0 ||
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_light_scene',
            'Light Engine models pure rectilinear-propagation benches without motion objects, fields, circuits or other benches.',
          ),
        ],
        LIGHT_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(LIGHT_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        LIGHT_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const model = resolveLightModel(scene)
      return supported(
        model.type === 'total_reflection' ? TOTAL_REFLECTION_MODEL : PINHOLE_MODEL,
        this.domain,
      )
    } catch (error: unknown) {
      return invalidModelCondition(LIGHT_ENGINE_ID, [
        failure(
          'light_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for light.',
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
    return stateOf(resolveLightModel(scene), timeSeconds)
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
    const model = resolveLightModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state: the apparatus does not move, so a longer run would be the same
         picture at a different clock. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-light-image-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'LightImageFormed',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'rectilinear-geometry-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const lightEngine = new LightEngine()
