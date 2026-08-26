import type { ResolvedOpticalModel } from './optics-model.ts'

/**
 * Geometric imaging in the junior-textbook convention: distances u (object)
 * and v (image) are positive magnitudes measured from the element; the thin
 * lens equation is 1/u + 1/v = 1/f with v > 0 for a real image on the far
 * side and v < 0 for a virtual image on the object side. A curved mirror
 * obeys the same equation with the sides folded back: a real image forms in
 * FRONT of the mirror (object side), a virtual one behind it.
 */

export type ImageNature = 'real' | 'virtual'
export type ImageOrientation = 'upright' | 'inverted'

/**
 * Object-distance zone of a converging element (u against f and 2f), the axis
 * of the imaging law. A concave mirror shares the classification with the
 * convex lens — same equation, same boundaries.
 */
export type LensZone = 'beyond_2f' | 'at_2f' | 'between_f_2f' | 'at_f' | 'within_f'

/** Relative tolerance for the u = f and u = 2f boundary classifications. */
export const LENS_ZONE_RELATIVE_TOLERANCE = 1e-9

/** |screenX − imageX| below this counts as a sharp image on the screen (m). */
export const SCREEN_SHARP_TOLERANCE_METERS = 5e-3

export interface OpticalImage {
  readonly nature: ImageNature
  readonly orientation: ImageOrientation
  /** Image distance to the element, positive magnitude (m). */
  readonly distance: number
  /** Signed axis position of the image plane (m). */
  readonly x: number
  /** Image height magnitude (m). */
  readonly height: number
  /** Lateral magnification magnitude |v|/u (mirror: exactly 1). */
  readonly magnification: number
}

export type ImagingOutcome =
  | { readonly kind: 'image'; readonly image: OpticalImage }
  /** u = f: refracted rays emerge parallel and never (anti-)converge. */
  | { readonly kind: 'no_image' }

export interface OpticalImagingResult {
  readonly model: ResolvedOpticalModel
  readonly outcome: ImagingOutcome
  /** Present for thin lenses with f > 0 (the junior convex-lens law). */
  readonly lensZone?: LensZone
  /** Present for concave mirrors (f > 0): the same u-vs-f/2f classification. */
  readonly mirrorZone?: LensZone
  /** screenX − imageX (m); present when a screen and a real image exist. */
  readonly screenOffset?: number
  /** Present when the bench has a screen: sharp real image on the screen? */
  readonly imageOnScreen?: boolean
}

const nearlyEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= LENS_ZONE_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1e-12)

/** Zone of the object distance for a converging lens (f > 0). */
export const lensZoneOf = (objectDistance: number, focalLength: number): LensZone => {
  if (nearlyEqual(objectDistance, focalLength)) return 'at_f'
  if (nearlyEqual(objectDistance, 2 * focalLength)) return 'at_2f'
  if (objectDistance < focalLength) return 'within_f'
  if (objectDistance < 2 * focalLength) return 'between_f_2f'
  return 'beyond_2f'
}

/** Thin lens imaging of an upright object of height h at distance u > 0. */
export const thinLensOutcome = (
  objectDistance: number,
  focalLength: number,
  objectHeight: number,
  elementX: number,
): ImagingOutcome => {
  if (nearlyEqual(objectDistance, focalLength)) return { kind: 'no_image' }
  /* 1/u + 1/v = 1/f ⇒ v = uf/(u−f); v < 0 is a virtual image on the object side. */
  const signedImageDistance =
    (objectDistance * focalLength) / (objectDistance - focalLength)
  const real = signedImageDistance > 0
  const distance = Math.abs(signedImageDistance)
  const magnification = distance / objectDistance
  return {
    kind: 'image',
    image: {
      nature: real ? 'real' : 'virtual',
      orientation: real ? 'inverted' : 'upright',
      distance,
      x: real ? elementX + distance : elementX - distance,
      height: magnification * objectHeight,
      magnification,
    },
  }
}

/** Plane mirror imaging: virtual, upright, unit magnification, v = u. */
export const planeMirrorOutcome = (
  objectDistance: number,
  objectHeight: number,
  elementX: number,
): ImagingOutcome => ({
  kind: 'image',
  image: {
    nature: 'virtual',
    orientation: 'upright',
    distance: objectDistance,
    x: elementX + objectDistance,
    height: objectHeight,
    magnification: 1,
  },
})

/**
 * Curved (spherical) mirror imaging of an upright object at distance u > 0,
 * paraxial: 1/u + 1/v = 1/f with f > 0 concave, f < 0 convex. Reflection
 * folds the image back — a real image (v > 0) forms in front of the mirror at
 * x = elementX − v, a virtual one (v < 0) behind it at x = elementX + |v|.
 */
export const curvedMirrorOutcome = (
  objectDistance: number,
  focalLength: number,
  objectHeight: number,
  elementX: number,
): ImagingOutcome => {
  if (focalLength > 0 && nearlyEqual(objectDistance, focalLength)) return { kind: 'no_image' }
  const signedImageDistance =
    (objectDistance * focalLength) / (objectDistance - focalLength)
  const real = signedImageDistance > 0
  const distance = Math.abs(signedImageDistance)
  const magnification = distance / objectDistance
  return {
    kind: 'image',
    image: {
      nature: real ? 'real' : 'virtual',
      orientation: real ? 'inverted' : 'upright',
      distance,
      x: real ? elementX - distance : elementX + distance,
      height: magnification * objectHeight,
      magnification,
    },
  }
}

/** Full imaging result for a resolved model, including screen bookkeeping. */
export const imagingResultOf = (model: ResolvedOpticalModel): OpticalImagingResult => {
  const outcome =
    model.elementType === 'thin_lens'
      ? thinLensOutcome(
          model.objectDistance,
          model.focalLength ?? Number.NaN,
          model.objectHeight,
          model.elementX,
        )
      : model.elementType === 'curved_mirror'
        ? curvedMirrorOutcome(
            model.objectDistance,
            model.focalLength ?? Number.NaN,
            model.objectHeight,
            model.elementX,
          )
        : planeMirrorOutcome(model.objectDistance, model.objectHeight, model.elementX)

  const lensZone =
    model.elementType === 'thin_lens' && model.focalLength !== undefined && model.focalLength > 0
      ? lensZoneOf(model.objectDistance, model.focalLength)
      : undefined

  const mirrorZone =
    model.elementType === 'curved_mirror' &&
    model.focalLength !== undefined &&
    model.focalLength > 0
      ? lensZoneOf(model.objectDistance, model.focalLength)
      : undefined

  let screenOffset: number | undefined
  let imageOnScreen: boolean | undefined
  if (model.screenX !== undefined) {
    /* Only a real image is catchable: virtual images and the u = f case leave
       the screen dark no matter where it stands. */
    if (outcome.kind === 'image' && outcome.image.nature === 'real') {
      screenOffset = model.screenX - outcome.image.x
      imageOnScreen = Math.abs(screenOffset) <= SCREEN_SHARP_TOLERANCE_METERS
    } else {
      imageOnScreen = false
    }
  }

  return {
    model,
    outcome,
    ...(lensZone === undefined ? {} : { lensZone }),
    ...(mirrorZone === undefined ? {} : { mirrorZone }),
    ...(screenOffset === undefined ? {} : { screenOffset }),
    ...(imageOnScreen === undefined ? {} : { imageOnScreen }),
  }
}
