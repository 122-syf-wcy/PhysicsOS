/**
 * Optics → SceneVisualModel bridge.
 *
 * Projects a verified geometric-imaging result onto the shared visual contract.
 * Every drawn fact — the image arrow, the principal rays, whether the screen is
 * lit — comes from the Optics Engine's imaging result and ray construction;
 * this module only converts canonical SI metres into the bench's display unit
 * (centimetres), frames the extent and formats strings. It never images
 * anything itself.
 *
 * Scene units on the canvas are CENTIMETRES: the junior optical bench is
 * authored, read and taught in cm, so the axis ticks are the same numbers the
 * student would read off a real bench rail.
 */

import { principalRaysOf, type OpticalImagingResult } from '@physicsos/engine-optics'
import { opticalBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ObservableKey,
  ObservableVisibility,
  OpticalAxisMarkVisual,
  OpticalElementVisual,
  OpticalImageVisual,
  OpticalObjectVisual,
  OpticalRayVisual,
  OpticalScreenVisual,
  ScenePoint,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** Engine model lengths are SI metres; the bench displays centimetres. */
const CM_PER_METRE = 100

export const fmtOpticsValue = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-9) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The optics factory stamps
 * `observable-optics-rays` / `observable-optics-image`, both of type
 * `geometry`, so the key is carried by the id.
 */
export const opticsObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-rays')) return 'rays'
  if (id.endsWith('-image')) return 'image'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = opticsObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

const cmPoint = (point: { readonly x: number; readonly y: number }): ScenePoint => ({
  x: point.x * CM_PER_METRE,
  y: point.y * CM_PER_METRE,
})

/** Student-facing one-liner for the image: 倒立/正立 · 缩小/等大/放大 · 实/虚. */
export const imageNatureText = (result: OpticalImagingResult): string => {
  const { outcome } = result
  if (outcome.kind !== 'image') return '不成像（u = f，折射光平行）'
  const orientation = outcome.image.orientation === 'inverted' ? '倒立' : '正立'
  const magnification = outcome.image.magnification
  const size =
    Math.abs(magnification - 1) <= 1e-9 ? '等大' : magnification > 1 ? '放大' : '缩小'
  const nature = outcome.image.nature === 'real' ? '实像' : '虚像'
  return `${orientation}、${size}的${nature}`
}

export interface OpticsVisualInput {
  readonly scene: PhysicsScene
  readonly result: OpticalImagingResult
}

/** Build one optics frame from the verified imaging result. */
export const opticsSceneVisual = ({ scene, result }: OpticsVisualInput): SceneVisualModel => {
  const bench = opticalBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('optics')

  const { model, outcome } = result
  const objectX = model.objectX * CM_PER_METRE
  const objectHeight = model.objectHeight * CM_PER_METRE
  const elementX = model.elementX * CM_PER_METRE
  const halfAperture = model.apertureRadius * CM_PER_METRE
  const focalLength = model.focalLength === undefined
    ? undefined
    : model.focalLength * CM_PER_METRE
  const screenX = model.screenX === undefined ? undefined : model.screenX * CM_PER_METRE

  const image = outcome.kind === 'image' ? outcome.image : undefined
  const imageX = image === undefined ? undefined : image.x * CM_PER_METRE
  const signedImageHeight = image === undefined
    ? undefined
    : (image.orientation === 'inverted' ? -1 : 1) * image.height * CM_PER_METRE

  /* ---------------------------------------------------------------- extent -- */

  const xs = [objectX, elementX]
  if (imageX !== undefined) xs.push(imageX)
  if (screenX !== undefined) xs.push(screenX)
  if (focalLength !== undefined && focalLength > 0) {
    xs.push(elementX - 2 * focalLength, elementX + 2 * focalLength)
  }
  const spanMargin = Math.max(6, (Math.max(...xs) - Math.min(...xs)) * 0.14)
  const minX = Math.min(...xs) - spanMargin
  const maxX = Math.max(...xs) + spanMargin

  const screenHalfHeight = Math.max(objectHeight * 1.25, halfAperture)
  /* Symmetric about the principal axis so the axis reads as the bench's own
     zero line; an inverted image extends exactly as far below as the tallest
     primitive above. */
  const maxY =
    Math.max(
      objectHeight,
      Math.abs(signedImageHeight ?? 0),
      halfAperture,
      screenHalfHeight,
    ) + 4

  /* ------------------------------------------------------------ primitives -- */

  const opticalObjects: OpticalObjectVisual[] = [
    {
      id: bench.object.id,
      at: { x: objectX, y: 0 },
      height: objectHeight,
      label: bench.object.name ?? '物',
    },
  ]

  const opticalElements: OpticalElementVisual[] = [
    {
      id: model.elementId,
      kind: model.elementType,
      at: { x: elementX, y: 0 },
      halfAperture,
      label: model.elementType === 'thin_lens' ? '凸透镜' : '平面镜',
    },
  ]

  const opticalAxisMarks: OpticalAxisMarkVisual[] = []
  if (focalLength !== undefined && focalLength > 0) {
    opticalAxisMarks.push(
      { id: 'mark-f-left', at: { x: elementX - focalLength, y: 0 }, label: 'F' },
      { id: 'mark-f-right', at: { x: elementX + focalLength, y: 0 }, label: 'F' },
      { id: 'mark-2f-left', at: { x: elementX - 2 * focalLength, y: 0 }, label: '2F' },
      { id: 'mark-2f-right', at: { x: elementX + 2 * focalLength, y: 0 }, label: '2F' },
    )
  }

  const opticalImages: OpticalImageVisual[] = []
  if (image !== undefined && imageX !== undefined && signedImageHeight !== undefined) {
    opticalImages.push({
      id: 'optical-image',
      at: { x: imageX, y: 0 },
      height: signedImageHeight,
      nature: image.nature,
      label: '像',
    })
  }

  /* The engine's principal-ray construction, converted to bench units. The
     same geometry the verifier intersected — never re-derived here. */
  const opticalRays: OpticalRayVisual[] = principalRaysOf(result).map((ray, index) => ({
    id: `ray-${ray.kind}-${index}`,
    kind: ray.kind,
    points: ray.points.map(cmPoint),
    ...(ray.extension === undefined ? {} : { extension: ray.extension.map(cmPoint) }),
  }))

  const opticalScreens: OpticalScreenVisual[] = []
  if (bench.screen !== undefined && screenX !== undefined) {
    opticalScreens.push({
      id: bench.screen.id,
      at: { x: screenX, y: 0 },
      halfHeight: screenHalfHeight,
      lit: result.imageOnScreen === true,
      label: bench.screen.name ?? '光屏',
    })
  }

  /* ---------------------------------------------------------------- readout -- */

  const objectDistanceCm = model.objectDistance * CM_PER_METRE
  const readout: string[] = ['成像读数', `物距 u = ${fmtOpticsValue(objectDistanceCm)} cm`]
  if (image !== undefined) {
    readout.push(`像距 v = ${fmtOpticsValue(image.distance * CM_PER_METRE)} cm`)
    readout.push(imageNatureText(result))
  } else {
    readout.push(imageNatureText(result))
  }

  return emptyVisualModel('optics', {
    extent: { width: maxX - minX, height: 2 * maxY },
    origin: { x: minX, y: -maxY },
    grid: { minor: 2, major: 10 },
    axes: { x: 'x / cm', y: 'y / cm' },
    tickStep: 10,
    opticalObjects,
    opticalElements,
    opticalAxisMarks,
    opticalImages,
    opticalRays,
    opticalScreens,
    overlay: { readout, scale: { label: '10 cm', length: 10 } },
    visible: visibilityOf(scene),
  })
}
