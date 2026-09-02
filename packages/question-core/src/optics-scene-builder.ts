import type { IsoDateTime } from '@physicsos/shared'
import {
  createOpticalBenchScene,
  createPlaneMirrorScene,
  createConvexLensScene,
  createConcaveMirrorScene,
  createConvexMirrorScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface OpticsSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((known) => known.key === key)?.value

/** Metres → centimetres, the unit the bench templates use for positions. */
const toCm = (metres: number): number => metres * 100

/**
 * Build an optics Scene from a question IR.
 *
 * The IR stores all lengths as SI metres; the bench templates take centimetres
 * (the natural unit of the junior optics bench). The element kind and focal-
 * length sign come from the parser, which already applied the converging/
 * diverging convention: f > 0 for a convex lens or concave mirror, f < 0 for a
 * concave lens or convex mirror. A plane mirror has no focal length.
 *
 * Each template places the element at x = 0 so object distance and image
 * distance read directly off the axis, exactly as the engine expects.
 */
export function buildOpticsSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): OpticsSceneBuildResult {
  const focalLengthSI = knownValue(ir, 'focal_length')
  const objectDistanceSI = knownValue(ir, 'object_distance') ?? 0.3
  const objectHeightSI = knownValue(ir, 'object_height') ?? 0.06

  const focalLengthCm = focalLengthSI === undefined ? undefined : toCm(focalLengthSI)
  const objectDistanceCm = toCm(objectDistanceSI)
  const objectHeightCm = toCm(objectHeightSI)

  const questionId = options.questionId
  const description =
    questionId === undefined
      ? '由 Optics Question IR 生成'
      : `由试题 ${questionId} 的 Optics Question IR 生成`

  let scene: PhysicsScene

  if (ir.model === 'plane_mirror_imaging') {
    scene = createPlaneMirrorScene({
      sceneId: options.sceneId ?? 'question-optics-plane-mirror-scene',
      objectDistance: objectDistanceCm,
      objectHeight: objectHeightCm,
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    scene.metadata.title = '试题场景：平面镜成像'
    scene.metadata.description = description
  } else if (ir.model === 'curved_mirror_imaging') {
    if (focalLengthCm !== undefined && focalLengthCm < 0) {
      /* Convex (diverging) mirror. */
      scene = createConvexMirrorScene({
        sceneId: options.sceneId ?? 'question-optics-convex-mirror-scene',
        focalLength: focalLengthCm,
        objectDistance: objectDistanceCm,
        objectHeight: objectHeightCm,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
    } else {
      /* Concave (converging) mirror. */
      scene = createConcaveMirrorScene({
        sceneId: options.sceneId ?? 'question-optics-concave-mirror-scene',
        focalLength: focalLengthCm ?? 10,
        objectDistance: objectDistanceCm,
        objectHeight: objectHeightCm,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
    }
    scene.metadata.title = '试题场景：球面镜成像'
    scene.metadata.description = description
  } else {
    /* Thin lens. */
    if (focalLengthCm !== undefined && focalLengthCm < 0) {
      /* Concave (diverging) lens — no dedicated template, build directly. */
      scene = createOpticalBenchScene({
        sceneId: options.sceneId ?? 'question-optics-concave-lens-scene',
        object: {
          id: 'candle-object',
          name: '蜡烛',
          position: -objectDistanceCm,
          height: objectHeightCm,
        },
        element: {
          id: 'lens-1',
          name: '凹透镜',
          type: 'thin_lens',
          position: 0,
          focalLength: focalLengthCm,
          apertureRadius: 7,
        },
        ...(options.now === undefined ? {} : { now: options.now }),
        title: '试题场景：凹透镜成像',
        description,
      })
    } else {
      /* Convex (converging) lens. */
      scene = createConvexLensScene({
        sceneId: options.sceneId ?? 'question-optics-convex-lens-scene',
        focalLength: focalLengthCm ?? 10,
        objectDistance: objectDistanceCm,
        objectHeight: objectHeightCm,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
      scene.metadata.title = '试题场景：凸透镜成像'
      scene.metadata.description = description
    }
  }

  return {
    scene,
    irToSceneMapping: {
      optical_object: 'candle-object',
      element: scene.opticalBenches?.[0]?.elements[0]?.id ?? 'lens-1',
    },
  }
}
