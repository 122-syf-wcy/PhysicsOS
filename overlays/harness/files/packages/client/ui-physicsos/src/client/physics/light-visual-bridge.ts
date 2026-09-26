/**
 * Pinhole rig → SceneVisualModel bridge.
 *
 * Projects the engine's rectilinear geometry onto the shared visual contract.
 * Every drawn fact — where the object stands, how tall the image is, which way
 * it points — comes from the Light Engine's closed form; this module only
 * frames it and formats strings.
 *
 * Scene units are CENTIMETRES on BOTH axes, which is what makes this figure
 * honest: the object and the image are drawn at their real sizes, so the ratio
 * the student sees IS h′/h = v/u. A drawing that rescaled either arrow would be
 * the one place the experiment could lie about its own result.
 */

import {
  pinholeReadingOf,
  refractionReadingOf,
  type ResolvedLightModel,
} from '@physicsos/engine-optics'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  LightRefractionVisual,
  LightRigVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit this rig is drawn in. */
const cm = (metres: number): number => metres * 100

/** Drawn half-height of the card the hole is punched in; ink, not a size. */
const CARD_HALF_HEIGHT = 9
/** How much taller than the object the screen is drawn; ink, not a size. */
const SCREEN_SLACK = 5
const LIGHT_MARGIN = 8

const lengthText = (value: number): string => `${fmtFluidValue(value, 4)} cm`

/**
 * The light visual input shape used by the light scene visuals module.
 */
export interface LightVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedLightModel
}

/**
 * Student-facing name of the rig.
 * @returns the formatted string.
 */
export const lightRigText = (): string => '小孔成像'

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-light-rays` / `observable-light-image`.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const lightObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-rays')) return 'lightRays'
  if (id.endsWith('-image')) return 'image'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = lightObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/**
 * The light scene visuals helper `lightSceneVisual`.
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const lightSceneVisual = (input: LightVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
  } = input

  const visible = visibilityOf(scene)
  if (model.type === 'total_reflection') return refractionVisual(model, visible)
  const reading = pinholeReadingOf(model)

  const u = cm(reading.objectDistance)
  const v = cm(reading.screenDistance)
  const halfObject = cm(reading.objectHeight) / 2
  const halfImage = cm(reading.imageHeight) / 2

  const hole: ScenePoint = { x: 0, y: 0 }
  const objectTip: ScenePoint = { x: -u, y: halfObject }
  const objectTail: ScenePoint = { x: -u, y: -halfObject }
  /* Straight lines through the hole: the tip's ray lands BELOW the axis, the
     tail's above it. The inversion is drawn, not annotated. */
  const imageOfTip: ScenePoint = { x: v, y: -halfImage }
  const imageOfTail: ScenePoint = { x: v, y: halfImage }

  const rig: LightRigVisual = {
    id: 'light-rig',
    at: hole,
    objectAt: { x: -u, y: 0 },
    objectHalfHeight: halfObject,
    screenAt: { x: v, y: 0 },
    screenHalfHeight: Math.max(halfObject, halfImage) + SCREEN_SLACK,
    cardHalfHeight: CARD_HALF_HEIGHT,
    imageFrom: imageOfTip,
    imageTo: imageOfTail,
    rays: [
      { id: 'ray-tip', points: [objectTip, hole, imageOfTip] },
      { id: 'ray-tail', points: [objectTail, hole, imageOfTail] },
    ],
    objectText: `h = ${lengthText(cm(reading.objectHeight))}`,
    imageText: `h′ = ${lengthText(cm(reading.imageHeight))}`,
    magnificationText: `v/u = ${fmtFluidValue(reading.magnification, 4)}`,
    distanceText: `u = ${lengthText(u)}`,
    screenText: `v = ${lengthText(v)}`,
    label: '小孔成像',
  }

  const dimensions: DimensionVisual[] = [
    {
      id: 'object-distance',
      from: { x: -u, y: -Math.max(halfObject, CARD_HALF_HEIGHT) - 4 },
      to: { x: 0, y: -Math.max(halfObject, CARD_HALF_HEIGHT) - 4 },
      label: rig.distanceText,
    },
    {
      id: 'screen-distance',
      from: { x: 0, y: -Math.max(halfObject, CARD_HALF_HEIGHT) - 4 },
      to: { x: v, y: -Math.max(halfObject, CARD_HALF_HEIGHT) - 4 },
      label: rig.screenText,
    },
    {
      id: 'object-height',
      from: { x: -u, y: -halfObject },
      to: objectTip,
      side: 'right',
      label: rig.objectText,
    },
    {
      id: 'image-height',
      from: imageOfTip,
      to: imageOfTail,
      label: rig.imageText,
    },
  ]

  return emptyVisualModel('optics', {
    extent: {
      width: u + v + 2 * LIGHT_MARGIN,
      height: 2 * Math.max(halfObject, CARD_HALF_HEIGHT) + 2 * LIGHT_MARGIN,
    },
    origin: { x: -(u + LIGHT_MARGIN), y: -(Math.max(halfObject, CARD_HALF_HEIGHT) + LIGHT_MARGIN) },
    grid: { minor: 5, major: 25 },
    axes: { x: '', y: '' },
    tickStep: 25,
    lightRig: rig,
    dimensions,
    overlay: {
      readout: [
        '小孔成像 h′ = h·v/u（光的直线传播）',
        `物 h = ${lengthText(cm(reading.objectHeight))} 在孔前 u = ${lengthText(u)}`,
        `屏在孔后 v = ${lengthText(v)} → 放大率 v/u = ${fmtFluidValue(reading.magnification, 4)}`,
        `像高 h′ = ${lengthText(cm(reading.imageHeight))}，且**一定是倒立的**`,
        '从箭头顶端出发的光过孔后继续直走，落到屏的下方；从底端出发的落到上方 —— 两条直线在小孔交叉，上下就颠倒了',
      ],
      scale: { label: '10 cm', length: 10 },
    },
    visible,
  })
}

/* ------------------------------------------------------------ refraction -- */

/** Drawn length of every ray in the refraction figure, in scene centimetres. */
const RAY_LENGTH = 26
/** How far the boundary and the normal run either side of the point. */
const BOUNDARY_HALF = 30
const NORMAL_HALF = 22

/**
 * The refraction figure: light arriving at a boundary from the upper left, the
 * normal it is measured against, and what leaves the point of incidence.
 *
 * The incoming and reflected rays are drawn at their true angles; the refracted
 * one exists only below the critical angle, and past it the figure says so
 * instead of drawing a grazing line.
 */
const refractionVisual = (
  model: ResolvedLightModel & { type: 'total_reflection' },
  visible: ObservableVisibility,
): SceneVisualModel => {
  const reading = refractionReadingOf(model)
  const θ1 = reading.incidentAngle
  /* Light comes from the upper left and strikes a horizontal boundary at the
     origin, so the normal is the vertical through that point. */
  const incidentFrom: ScenePoint = {
    x: -RAY_LENGTH * Math.sin(θ1),
    y: RAY_LENGTH * Math.cos(θ1),
  }
  const reflectedTo: ScenePoint = {
    x: RAY_LENGTH * Math.sin(θ1),
    y: RAY_LENGTH * Math.cos(θ1),
  }
  const refractedTo: ScenePoint | undefined =
    reading.refractedAngle === undefined
      ? undefined
      : {
        x: RAY_LENGTH * Math.sin(reading.refractedAngle),
        y: -RAY_LENGTH * Math.cos(reading.refractedAngle),
      }
  const criticalTo: ScenePoint | undefined =
    reading.criticalAngle === undefined
      ? undefined
      : {
        x: RAY_LENGTH * Math.sin(reading.criticalAngle),
        y: -RAY_LENGTH * Math.cos(reading.criticalAngle),
      }
  const degrees = (radians: number) => fmtFluidValue((radians * 180) / Math.PI, 4)

  const rig: LightRefractionVisual = {
    id: 'light-refraction',
    at: { x: 0, y: 0 },
    boundaryFrom: { x: -BOUNDARY_HALF, y: 0 },
    boundaryTo: { x: BOUNDARY_HALF, y: 0 },
    normalFrom: { x: 0, y: -NORMAL_HALF },
    normalTo: { x: 0, y: NORMAL_HALF },
    incidentFrom,
    reflectedTo,
    ...(refractedTo === undefined ? {} : { refractedTo }),
    ...(criticalTo === undefined ? {} : { criticalTo }),
    total: reading.totalInternalReflection,
    incidentText: `θ₁ = ${degrees(θ1)}°`,
    refractedText:
      reading.refractedAngle === undefined
        ? '没有折射光线（全反射）'
        : `θ₂ = ${degrees(reading.refractedAngle)}°`,
    criticalText:
      reading.criticalAngle === undefined
        ? '光疏→光密：没有临界角'
        : `θ_c = ${degrees(reading.criticalAngle)}°`,
    indicesText: `n₁ = ${fmtFluidValue(reading.incidentIndex, 4)} → n₂ = ${fmtFluidValue(reading.refractedIndex, 4)}`,
    label: '折射与全反射',
  }

  return emptyVisualModel('optics', {
    extent: { width: 2 * BOUNDARY_HALF, height: 2 * (NORMAL_HALF + 6) },
    origin: { x: -BOUNDARY_HALF, y: -(NORMAL_HALF + 6) },
    grid: { minor: 5, major: 25 },
    axes: { x: '', y: '' },
    tickStep: 25,
    lightRefraction: rig,
    overlay: {
      readout: [
        '全反射 n₁sinθ₁ = n₂sinθ₂ · θ_c = arcsin(n₂/n₁)',
        rig.indicesText,
        `${rig.incidentText} · ${rig.criticalText}`,
        rig.total
          ? '入射角已超过临界角：折射光线不存在，光被全部反射回原介质'
          : `折射光线以 ${rig.refractedText} 进入第二介质`,
        '临界角是一个门槛而不是渐变：超过它，折射光线整条消失',
      ],
      scale: { label: '10 cm', length: 10 },
    },
    visible,
  })
}
