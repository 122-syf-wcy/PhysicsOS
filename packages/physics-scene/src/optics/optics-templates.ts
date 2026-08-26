import type { IsoDateTime } from '@physicsos/shared'

import { createOpticalBenchScene } from './optics-scene.ts'
import type { PhysicsScene } from '../scene.ts'

/**
 * Junior optics experiment templates. Both put the imaging element at x = 0 so
 * object distance and image distance read directly off the axis (in cm).
 */

export interface PlaneMirrorSceneInput {
  readonly sceneId?: string
  /** Object distance to the mirror plane in centimetres (> 0). */
  readonly objectDistance?: number
  /** Candle height in centimetres (> 0). */
  readonly objectHeight?: number
  readonly now?: IsoDateTime
}

/**
 * 平面镜成像 — a candle in front of a vertical glass plate. The screen starts
 * exactly where the image appears to be, so "the screen catches nothing there"
 * is observable from the first frame (the image is virtual).
 */
export const createPlaneMirrorScene = (input: PlaneMirrorSceneInput = {}): PhysicsScene => {
  const objectDistance = input.objectDistance ?? 10
  const objectHeight = input.objectHeight ?? 6
  return createOpticalBenchScene({
    sceneId: input.sceneId ?? 'lab-plane-mirror',
    ...(input.now === undefined ? {} : { now: input.now }),
    object: {
      id: 'candle-object',
      name: '蜡烛 A',
      position: -objectDistance,
      height: objectHeight,
    },
    element: {
      id: 'mirror-1',
      name: '玻璃板（平面镜）',
      type: 'plane_mirror',
      position: 0,
      apertureRadius: 9,
    },
    screen: { id: 'screen-1', name: '光屏', position: objectDistance },
    title: '平面镜成像',
    description: '探究平面镜成像特点：像与物到镜面的距离相等、大小相等、虚像。',
  })
}

export interface ConvexLensSceneInput {
  readonly sceneId?: string
  /** Focal length in centimetres (> 0, convex). */
  readonly focalLength?: number
  /** Object distance to the lens in centimetres (> 0). */
  readonly objectDistance?: number
  /** Candle height in centimetres (> 0). */
  readonly objectHeight?: number
  /** Screen x position in centimetres; defaults to the sharp-image plane. */
  readonly screenPosition?: number
  readonly now?: IsoDateTime
}

/**
 * 凸透镜成像 — candle, convex lens and screen on an optical bench. The default
 * screen position is the sharp-image plane for the starting object distance
 * (a template convenience only: the engine still computes and verifies the
 * image; the student moves either piece afterwards). When the start has no
 * real image (u ≤ f) the screen parks at 2f.
 */
export const createConvexLensScene = (input: ConvexLensSceneInput = {}): PhysicsScene => {
  const focalLength = input.focalLength ?? 10
  const objectDistance = input.objectDistance ?? 30
  const objectHeight = input.objectHeight ?? 6
  const sharpImagePlane =
    objectDistance > focalLength
      ? (objectDistance * focalLength) / (objectDistance - focalLength)
      : 2 * focalLength
  return createOpticalBenchScene({
    sceneId: input.sceneId ?? 'lab-convex-lens',
    ...(input.now === undefined ? {} : { now: input.now }),
    object: {
      id: 'candle-object',
      name: '蜡烛',
      position: -objectDistance,
      height: objectHeight,
    },
    element: {
      id: 'lens-1',
      name: '凸透镜',
      type: 'thin_lens',
      position: 0,
      focalLength,
      apertureRadius: 7,
    },
    screen: { id: 'screen-1', name: '光屏', position: input.screenPosition ?? sharpImagePlane },
    title: '凸透镜成像规律',
    description: '探究凸透镜成像规律：物距跨越 f 与 2f 时像的大小、倒正与虚实如何变化。',
  })
}
