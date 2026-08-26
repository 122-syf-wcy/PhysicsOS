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

export interface ConcaveMirrorSceneInput {
  readonly sceneId?: string
  /** Focal length in centimetres (> 0 concave; pass < 0 for a convex mirror). */
  readonly focalLength?: number
  /** Object distance to the mirror vertex in centimetres (> 0). */
  readonly objectDistance?: number
  /** Candle height in centimetres (> 0). */
  readonly objectHeight?: number
  /** Screen x position in centimetres; defaults to the sharp-image plane. */
  readonly screenPosition?: number
  readonly now?: IsoDateTime
}

/**
 * 凹面镜成像 — candle, concave mirror and screen on an optical bench. The
 * mirror folds the light back, so a real image forms IN FRONT of the mirror
 * (on the object side) and the default screen parks on that sharp-image plane
 * (at −v). When the start has no real image (u ≤ f, or a convex mirror) the
 * screen parks at the centre-of-curvature distance in front (x = −2|f|).
 */
export const createConcaveMirrorScene = (input: ConcaveMirrorSceneInput = {}): PhysicsScene => {
  const focalLength = input.focalLength ?? 10
  const objectDistance = input.objectDistance ?? 30
  const objectHeight = input.objectHeight ?? 6
  const sharpImagePlane =
    focalLength > 0 && objectDistance > focalLength
      ? -(objectDistance * focalLength) / (objectDistance - focalLength)
      : -2 * Math.abs(focalLength)
  return createOpticalBenchScene({
    sceneId: input.sceneId ?? 'lab-concave-mirror',
    ...(input.now === undefined ? {} : { now: input.now }),
    object: {
      id: 'candle-object',
      name: '蜡烛',
      position: -objectDistance,
      height: objectHeight,
    },
    element: {
      id: 'mirror-1',
      name: focalLength > 0 ? '凹面镜' : '凸面镜',
      type: 'curved_mirror',
      position: 0,
      focalLength,
      apertureRadius: 8,
    },
    screen: { id: 'screen-1', name: '光屏', position: input.screenPosition ?? sharpImagePlane },
    title: '凹面镜成像',
    description: '探究凹面镜（球面镜）成像规律：物距跨越 f 与 2f 时像的大小、倒正与虚实如何变化。',
  })
}

export interface ConvexMirrorSceneInput {
  readonly sceneId?: string
  /** Focal length in centimetres (< 0, diverging). */
  readonly focalLength?: number
  /** Object distance to the mirror vertex in centimetres (> 0). */
  readonly objectDistance?: number
  /** Object height in centimetres (> 0). */
  readonly objectHeight?: number
  /** Screen x position in centimetres; defaults to |2f| in front of the vertex. */
  readonly screenPosition?: number
  readonly now?: IsoDateTime
}

/**
 * 凸面镜后视镜 — a car approaching a convex (diverging) mirror. Unlike the
 * concave bench there are no zones to sweep: whatever the object distance, the
 * reflected rays diverge and only their backward extensions meet, so the image
 * is always upright, reduced and virtual behind the mirror. That is exactly why
 * this is the mirror on every car and blind corner — a wider field of view, at
 * the cost of everything looking smaller and further away than it is. The
 * screen parks in front and stays dark, which is the lesson rather than a
 * limitation.
 */
export const createConvexMirrorScene = (input: ConvexMirrorSceneInput = {}): PhysicsScene => {
  const focalLength = input.focalLength ?? -10
  const objectDistance = input.objectDistance ?? 30
  const objectHeight = input.objectHeight ?? 6
  return createOpticalBenchScene({
    sceneId: input.sceneId ?? 'lab-convex-mirror',
    ...(input.now === undefined ? {} : { now: input.now }),
    object: {
      id: 'candle-object',
      name: '后车',
      position: -objectDistance,
      height: objectHeight,
    },
    element: {
      id: 'mirror-1',
      name: '凸面镜（后视镜）',
      type: 'curved_mirror',
      position: 0,
      focalLength,
      apertureRadius: 8,
    },
    screen: {
      id: 'screen-1',
      name: '光屏',
      position: input.screenPosition ?? -2 * Math.abs(focalLength),
    },
    title: '凸面镜后视镜',
    description: '探究凸面镜成像：无论物体多远，反射光的反向延长线都在镜后交出正立、缩小的虚像 —— 视野更大，正是汽车后视镜与路口反光镜的原理。',
  })
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
