import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  OpticalBench,
  OpticalElement,
  OpticalObject,
  OpticalScreen,
  PhysicsScene,
  ThinLens,
} from '../scene.ts'

/**
 * Optical bench scenes are static: geometric imaging has no time evolution of
 * its own, so the timeline collapses to a zero-length run and every state is
 * the imaging configuration itself. All authoring lengths are centimetres —
 * the natural unit of the junior optics bench — and stay centimetre-denoted
 * quantities in the scene; canonical SI conversion happens in the engine.
 */
export type OpticsObservableKey = 'rays' | 'image'

export interface OpticalObjectSpec {
  readonly id?: string
  readonly name?: string
  /** Signed x position of the object on the axis, in centimetres. */
  readonly position: number
  /** Object height above the axis, in centimetres (> 0). */
  readonly height: number
}

interface OpticalElementSpecBase {
  readonly id?: string
  readonly name?: string
}

export type OpticalElementSpec =
  | (OpticalElementSpecBase & {
      readonly type: 'thin_lens'
      /** Signed x position of the optical centre, in centimetres. */
      readonly position: number
      /** Focal length in centimetres; > 0 converging (convex). */
      readonly focalLength: number
      /** Half-aperture in centimetres. */
      readonly apertureRadius?: number
    })
  | (OpticalElementSpecBase & {
      readonly type: 'plane_mirror'
      /** Signed x position of the mirror plane, in centimetres. */
      readonly position: number
      /** Half-height in centimetres. */
      readonly apertureRadius?: number
    })

export interface OpticalScreenSpec {
  readonly id?: string
  readonly name?: string
  /** Signed x position of the screen plane, in centimetres. */
  readonly position: number
}

export interface OpticalBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  readonly object: OpticalObjectSpec
  readonly element: OpticalElementSpec
  readonly screen?: OpticalScreenSpec
  readonly observableVisibility?: Partial<Record<OpticsObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const cm = (value: number) => quantity(value, 'cm', 'length')

const toObject = (spec: OpticalObjectSpec): OpticalObject => ({
  id: spec.id ?? 'optical-object',
  ...(spec.name === undefined ? {} : { name: spec.name }),
  position: cm(spec.position),
  height: cm(spec.height),
})

const toElement = (spec: OpticalElementSpec): OpticalElement => {
  const base = {
    id: spec.id ?? (spec.type === 'thin_lens' ? 'lens-1' : 'mirror-1'),
    ...(spec.name === undefined ? {} : { name: spec.name }),
  }
  if (spec.type === 'thin_lens') {
    return {
      ...base,
      type: 'thin_lens',
      position: cm(spec.position),
      focalLength: cm(spec.focalLength),
      ...(spec.apertureRadius === undefined
        ? {}
        : { apertureRadius: cm(spec.apertureRadius) }),
    }
  }
  return {
    ...base,
    type: 'plane_mirror',
    position: cm(spec.position),
    ...(spec.apertureRadius === undefined ? {} : { apertureRadius: cm(spec.apertureRadius) }),
  }
}

const toScreen = (spec: OpticalScreenSpec): OpticalScreen => ({
  id: spec.id ?? 'screen-1',
  ...(spec.name === undefined ? {} : { name: spec.name }),
  position: cm(spec.position),
})

const observableId = (key: OpticsObservableKey) => asObservableId(`observable-optics-${key}`)

/** Create a single-bench geometric optics scene (one object, one element). */
export const createOpticalBenchScene = (input: OpticalBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'optics-runtime-scene'
  const benchId = input.benchId ?? 'optical-bench-1'
  const visibility = input.observableVisibility ?? {}

  const element = toElement(input.element)
  const bench: OpticalBench = {
    id: benchId,
    type: 'optical_bench',
    object: toObject(input.object),
    elements: [element],
    ...(input.screen === undefined ? {} : { screen: toScreen(input.screen) }),
  }

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(0, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [],
    particles: [],
    fields: [],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('rays'),
        type: 'geometry',
        targetId: element.id,
        visible: visibility.rays ?? true,
      },
      {
        id: observableId('image'),
        type: 'geometry',
        targetId: bench.object.id,
        visible: visibility.image ?? true,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '几何光学实验台',
      description: input.description ?? 'Optics Engine · 单轴光具座几何成像',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Optical benches of a scene. Legacy-safe: scenes persisted before the optics
 * slice have no `opticalBenches` collection, so readers fall back to `[]`.
 */
export const opticalBenchesOf = (scene: PhysicsScene): OpticalBench[] =>
  scene.opticalBenches ?? []

/** The single optical bench of an optics scene, if present. */
export const opticalBenchOf = (scene: PhysicsScene): OpticalBench | undefined =>
  opticalBenchesOf(scene)[0]

/** True when the scene is a pure single-bench optics scene. */
export const isOpticsScene = (scene: PhysicsScene): boolean =>
  opticalBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0

/** First enabled imaging element of a bench. */
export const opticalElementOf = (bench: OpticalBench): OpticalElement | undefined =>
  bench.elements.find((element) => element.enabled !== false)

/** First enabled thin lens of a bench, if any. */
export const thinLensOf = (bench: OpticalBench): ThinLens | undefined => {
  const element = opticalElementOf(bench)
  return element?.type === 'thin_lens' ? element : undefined
}
