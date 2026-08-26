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
import { opticalBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { imagingResultOf, type OpticalImagingResult } from './imaging.ts'
import { resolveOpticalModel } from './optics-model.ts'
import { constructedImageTopOf } from './principal-rays.ts'

export const OPTICS_ENGINE_ID = 'engine-optics'
export const OPTICS_ENGINE_VERSION = '1.0.0'
export const THIN_LENS_MODEL = 'thin_lens_imaging'
export const PLANE_MIRROR_MODEL = 'plane_mirror_imaging'
export const CURVED_MIRROR_MODEL = 'curved_mirror_imaging'

/** Metres of disagreement tolerated between formula and ray construction. */
const RAY_CONSTRUCTION_TOLERANCE_METERS = 1e-9

const LENS_ASSUMPTIONS = [
  'ideal thin lens (paraxial rays, no aberrations)',
  'single principal axis; the object stands upright on the axis',
  'geometric optics (diffraction ignored)',
] as const

const MIRROR_ASSUMPTIONS = [
  'plane mirror imaging by the law of reflection',
  'single principal axis; the object stands upright on the axis',
  'geometric optics (diffraction ignored)',
] as const

const CURVED_MIRROR_ASSUMPTIONS = [
  'ideal spherical mirror in the paraxial approximation (f = R/2)',
  'single principal axis; the object stands upright on the axis',
  'geometric optics (diffraction ignored)',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

/** Solve the scene's optical bench; the single entry point UI layers reuse. */
export const resolveOpticalImaging = (scene: PhysicsScene): OpticalImagingResult =>
  imagingResultOf(resolveOpticalModel(scene))

/* ------------------------------------------------------------- state/dqs -- */

const centimetres = (metres: number): Quantity<'length'> =>
  quantity(metres * 100, 'cm', 'length')

const assumptionsOf = (result: OpticalImagingResult): string[] =>
  result.model.elementType === 'thin_lens'
    ? [...LENS_ASSUMPTIONS]
    : result.model.elementType === 'curved_mirror'
      ? [...CURVED_MIRROR_ASSUMPTIONS]
      : [...MIRROR_ASSUMPTIONS]

const derivedOf = (result: OpticalImagingResult): DerivedQuantity[] => {
  const { model, outcome } = result
  const assumptions = assumptionsOf(result)
  const derived: DerivedQuantity[] = [
    {
      key: 'object_distance',
      targetId: model.objectId,
      value: centimetres(model.objectDistance),
      formula: { expression: 'u = x_镜 − x_物' },
      assumptions,
    },
    {
      key: 'object_height',
      targetId: model.objectId,
      value: centimetres(model.objectHeight),
      formula: { expression: 'h' },
      assumptions,
    },
  ]
  if (model.focalLength !== undefined) {
    derived.push({
      key: 'focal_length',
      targetId: model.elementId,
      value: centimetres(model.focalLength),
      formula: { expression: 'f' },
      assumptions,
    })
  }
  if (outcome.kind === 'image') {
    const imageFormula =
      model.elementType === 'thin_lens'
        ? '1/u + 1/v = 1/f'
        : model.elementType === 'curved_mirror'
          ? '1/u + 1/v = 1/f（球面镜，f = R/2）'
          : 'v = u（平面镜对称）'
    derived.push(
      {
        key: 'image_distance',
        targetId: model.elementId,
        value: centimetres(outcome.image.distance),
        formula: { expression: imageFormula },
        assumptions,
      },
      {
        key: 'image_height',
        targetId: model.elementId,
        value: centimetres(outcome.image.height),
        formula: { expression: "h' = m·h" },
        assumptions,
      },
      {
        key: 'magnification',
        targetId: model.elementId,
        value: quantity(outcome.image.magnification, '', 'dimensionless'),
        formula: {
          expression: model.elementType === 'plane_mirror' ? 'm = 1' : 'm = v/u',
        },
        assumptions,
      },
    )
  }
  if (result.screenOffset !== undefined && model.screenId !== undefined) {
    derived.push({
      key: 'screen_offset',
      targetId: model.screenId,
      value: centimetres(result.screenOffset),
      formula: { expression: 'Δ = x_屏 − x_像' },
      assumptions,
    })
  }
  return derived
}

const stateOf = (scene: PhysicsScene, timeSeconds: number): SimulationState => {
  const result = resolveOpticalImaging(scene)
  const { model, outcome } = result
  const objects: SimulationState['objects'] = [
    {
      id: model.objectId,
      values: {
        position_x: centimetres(model.objectX),
        height: centimetres(model.objectHeight),
      },
    },
    {
      id: model.elementId,
      values: {
        position_x: centimetres(model.elementX),
        ...(model.focalLength === undefined
          ? {}
          : { focal_length: centimetres(model.focalLength) }),
      },
    },
  ]
  if (model.screenId !== undefined && model.screenX !== undefined) {
    objects.push({
      id: model.screenId,
      values: { position_x: centimetres(model.screenX) },
    })
  }
  if (outcome.kind === 'image') {
    objects.push({
      id: model.benchId,
      values: {
        image_position_x: centimetres(outcome.image.x),
        image_height: centimetres(outcome.image.height),
      },
    })
  }
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects,
    derived: derivedOf(result),
  }
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  result: OpticalImagingResult,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const { model, outcome } = result

  const constructedTop = constructedImageTopOf(model)

  if (outcome.kind === 'image') {
    if (
      (model.elementType === 'thin_lens' || model.elementType === 'curved_mirror') &&
      model.focalLength !== undefined
    ) {
      /* Both laws share 1/u + 1/v = 1/f with v > 0 for a real image; only the
         side the real image lands on differs (mirror folds it back). */
      const signedImageDistance =
        outcome.image.nature === 'real' ? outcome.image.distance : -outcome.image.distance
      const residual = Math.abs(
        1 / model.objectDistance + 1 / signedImageDistance - 1 / model.focalLength,
      )
      const tolerance =
        1e-9 *
        Math.max(
          Math.abs(1 / model.objectDistance),
          Math.abs(1 / signedImageDistance),
          Math.abs(1 / model.focalLength),
        )
      const lens = model.elementType === 'thin_lens'
      checks.push(
        check(lens ? 'thin_lens_equation' : 'curved_mirror_equation', 'constraint', residual <= tolerance, {
          message: lens
            ? '成像满足薄透镜公式 1/u + 1/v = 1/f。'
            : '成像满足球面镜公式 1/u + 1/v = 1/f（f = R/2）。',
          targetId: model.elementId,
          details: { residual, objectDistance: model.objectDistance, signedImageDistance },
        }),
      )
    }

    if (model.elementType === 'plane_mirror') {
      const symmetric =
        Math.abs(outcome.image.distance - model.objectDistance) <=
          RAY_CONSTRUCTION_TOLERANCE_METERS &&
        outcome.image.magnification === 1 &&
        outcome.image.nature === 'virtual' &&
        outcome.image.orientation === 'upright'
      checks.push(
        check('mirror_image_symmetry', 'constraint', symmetric, {
          message: '平面镜成像：像与物到镜面距离相等、等大、正立虚像。',
          targetId: model.elementId,
          details: {
            objectDistance: model.objectDistance,
            imageDistance: outcome.image.distance,
          },
        }),
      )
    }

    /* Independent geometry: two principal-ray lines built from the lens rule /
       law of reflection must intersect exactly at the formula's image top. */
    const expectedTopY =
      (outcome.image.orientation === 'inverted' ? -1 : 1) * outcome.image.height
    const raysConverge =
      constructedTop !== undefined &&
      Math.hypot(constructedTop.x - outcome.image.x, constructedTop.y - expectedTopY) <=
        RAY_CONSTRUCTION_TOLERANCE_METERS *
          Math.max(1, Math.abs(outcome.image.x), Math.abs(expectedTopY))
    checks.push(
      check('principal_rays_converge', 'constraint', raysConverge, {
        message: '主光线（或其反向延长线）交汇于计算出的像点。',
        targetId: model.elementId,
        details: { constructedTop, imageX: outcome.image.x, imageTopY: expectedTopY },
      }),
    )
  } else {
    checks.push(
      check('rays_parallel_at_focus', 'constraint', constructedTop === undefined, {
        message:
          model.elementType === 'curved_mirror'
            ? '物距等于焦距时反射光线平行，不成像。'
            : '物距等于焦距时折射光线平行，不成像。',
        targetId: model.elementId,
      }),
    )
  }

  if (result.imageOnScreen !== undefined) {
    const virtualUncatchable =
      outcome.kind === 'image' && outcome.image.nature === 'real'
        ? true
        : result.imageOnScreen === false
    checks.push(
      check('virtual_image_uncatchable', 'constraint', virtualUncatchable, {
        message: '虚像（或不成像）无法呈现在光屏上，只有实像能被光屏承接。',
        targetId: model.screenId ?? model.elementId,
      }),
    )
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createOpticsSimulationRequest(
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

/* ----------------------------------------------------------- the engine -- */

export class OpticsEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = OPTICS_ENGINE_ID
  readonly engineVersion = OPTICS_ENGINE_VERSION
  readonly domain = 'optics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (opticalBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Optics Engine requires exactly one optical bench.')],
        OPTICS_ENGINE_ID,
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
      scene.circuits.length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_optics_scene',
            'Optics Engine models pure bench scenes without motion objects, fields or circuits.',
          ),
        ],
        OPTICS_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(OPTICS_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        OPTICS_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const result = resolveOpticalImaging(scene)
      return supported(
        result.model.elementType === 'thin_lens'
          ? THIN_LENS_MODEL
          : result.model.elementType === 'curved_mirror'
            ? CURVED_MIRROR_MODEL
            : PLANE_MIRROR_MODEL,
        this.domain,
      )
    } catch (error: unknown) {
      return invalidModelCondition(OPTICS_ENGINE_ID, [
        failure(
          'imaging_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for imaging.',
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
    const seconds = canonicalValue(time)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(scene, seconds)
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
    /* Imaging is static: the single state at t = 0 is the whole run. */
    const result = resolveOpticalImaging(scene)
    const states = [stateOf(scene, 0)]
    const verification = buildVerification(scene, result)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements: [],
      derivedQuantities: derivedOf(result),
      verification,
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'geometric-imaging-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const opticsEngine = new OpticsEngine()
