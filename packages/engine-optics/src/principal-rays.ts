import type { ImagingOutcome, OpticalImagingResult } from './imaging.ts'
import type { ResolvedOpticalModel } from './optics-model.ts'

export interface RayPoint {
  readonly x: number
  readonly y: number
}

export interface OpticalRay {
  readonly kind: 'parallel' | 'central' | 'focal' | 'incident'
  /** Physical light path vertices (m), in travel order. */
  readonly points: readonly RayPoint[]
  /** Dashed virtual back-extension towards the image point (m). */
  readonly extension?: readonly RayPoint[]
}

const point = (x: number, y: number): RayPoint => ({ x, y })

/**
 * Intersection of two lines given by point + direction; undefined when
 * (anti-)parallel. Used to reconstruct the image point from ray geometry
 * without consulting the imaging formula.
 */
export const lineIntersection = (
  p1: RayPoint,
  d1: RayPoint,
  p2: RayPoint,
  d2: RayPoint,
): RayPoint | undefined => {
  const determinant = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(determinant) < 1e-15) return undefined
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / determinant
  return point(p1.x + t * d1.x, p1.y + t * d1.y)
}

/**
 * Image top reconstructed from first principles (two principal-ray lines),
 * never from the imaging formula — the verifier compares the two.
 *
 * Thin lens: the parallel ray refracts through the far focus; the central ray
 * is undeviated. Plane mirror: reflected rays extend behind the mirror.
 * Returns undefined when the construction rays are parallel (u = f).
 */
export const constructedImageTopOf = (model: ResolvedOpticalModel): RayPoint | undefined => {
  const top = point(model.objectX, model.objectHeight)
  if (model.elementType === 'thin_lens') {
    const focalLength = model.focalLength ?? Number.NaN
    const hitParallel = point(model.elementX, model.objectHeight)
    const farFocus = point(model.elementX + focalLength, 0)
    const refractedDirection = point(farFocus.x - hitParallel.x, farFocus.y - hitParallel.y)
    const centralDirection = point(model.elementX - model.objectX, -model.objectHeight)
    return lineIntersection(hitParallel, refractedDirection, top, centralDirection)
  }
  /* Plane mirror: extension of the normal ray is horizontal through the object
     top; extension of the axis-hit ray leaves (elementX, 0) with the mirrored
     slope. */
  const normalExtensionDirection = point(1, 0)
  const axisHit = point(model.elementX, 0)
  const mirroredDirection = point(model.elementX - model.objectX, model.objectHeight)
  return lineIntersection(
    point(model.elementX, model.objectHeight),
    normalExtensionDirection,
    axisHit,
    mirroredDirection,
  )
}

const imageTopOf = (outcome: ImagingOutcome): RayPoint | undefined => {
  if (outcome.kind !== 'image') return undefined
  const sign = outcome.image.orientation === 'inverted' ? -1 : 1
  return point(outcome.image.x, sign * outcome.image.height)
}

export interface PrincipalRayOptions {
  /** How far past the element diverging/parallel rays are drawn (m). */
  readonly forwardExtent?: number
}

const defaultForwardExtent = (model: ResolvedOpticalModel, outcome: ImagingOutcome): number => {
  const focal = Math.abs(model.focalLength ?? model.objectDistance)
  const imageReach = outcome.kind === 'image' ? outcome.image.distance : 0
  return Math.max(2 * focal, model.objectDistance, imageReach) * 1.25
}

const thinLensRays = (
  model: ResolvedOpticalModel,
  outcome: ImagingOutcome,
  forwardExtent: number,
): OpticalRay[] => {
  const focalLength = model.focalLength ?? Number.NaN
  const top = point(model.objectX, model.objectHeight)
  const hitParallel = point(model.elementX, model.objectHeight)
  const centre = point(model.elementX, 0)
  const imageTop = imageTopOf(outcome)
  const endX = model.elementX + forwardExtent

  if (outcome.kind === 'image' && outcome.image.nature === 'real' && imageTop !== undefined) {
    const rays: OpticalRay[] = [
      { kind: 'parallel', points: [top, hitParallel, imageTop] },
      { kind: 'central', points: [top, centre, imageTop] },
    ]
    /* Focal ray: through the near focus, exits parallel at the image-top height. */
    if (focalLength > 0) {
      const lensHeight =
        (model.objectHeight * focalLength) / (focalLength - model.objectDistance)
      rays.push({
        kind: 'focal',
        points: [top, point(model.elementX, lensHeight), point(imageTop.x, lensHeight)],
      })
    }
    return rays
  }

  if (outcome.kind === 'image' && imageTop !== undefined) {
    /* Virtual image: refracted rays diverge forward; dashed extensions meet at
       the image top behind the object. */
    const refractedFrom = (origin: RayPoint): RayPoint => {
      const directionX = origin.x - imageTop.x
      const directionY = origin.y - imageTop.y
      const scale = (endX - origin.x) / directionX
      return point(endX, origin.y + scale * directionY)
    }
    const rays: OpticalRay[] = [
      {
        kind: 'parallel',
        points: [top, hitParallel, refractedFrom(hitParallel)],
        extension: [hitParallel, imageTop],
      },
      {
        kind: 'central',
        points: [top, centre, refractedFrom(centre)],
        extension: [centre, imageTop],
      },
    ]
    if (focalLength > 0) {
      const lensHeight =
        (model.objectHeight * focalLength) / (focalLength - model.objectDistance)
      rays.push({
        kind: 'focal',
        points: [top, point(model.elementX, lensHeight), point(endX, lensHeight)],
        extension: [point(model.elementX, lensHeight), imageTop],
      })
    }
    return rays
  }

  /* u = f: both principal rays emerge parallel with slope −h/f and never meet. */
  const slope = -model.objectHeight / focalLength
  const emergentY = (origin: RayPoint): RayPoint =>
    point(endX, origin.y + slope * (endX - origin.x))
  return [
    { kind: 'parallel', points: [top, hitParallel, emergentY(hitParallel)] },
    { kind: 'central', points: [top, centre, emergentY(centre)] },
  ]
}

const planeMirrorRays = (model: ResolvedOpticalModel, outcome: ImagingOutcome): OpticalRay[] => {
  const top = point(model.objectX, model.objectHeight)
  const imageTop = imageTopOf(outcome)
  if (imageTop === undefined) return []
  const fanHits = [model.objectHeight, model.objectHeight * 0.4, 0]
  return fanHits.map((hitY, index) => {
    const hit = point(model.elementX, hitY)
    if (index === 0) {
      /* Normal-incidence ray: reflects straight back along itself. */
      return { kind: 'incident' as const, points: [top, hit], extension: [hit, imageTop] }
    }
    /* Reflection flips the x-component; the physical ray returns towards the
       object plane while its extension continues to the image top. */
    const reflectedEnd = point(model.objectX, 2 * hitY - model.objectHeight)
    return {
      kind: 'incident' as const,
      points: [top, hit, reflectedEnd],
      extension: [hit, imageTop],
    }
  })
}

/** Principal rays of an imaging result, for rendering and inspection. */
export const principalRaysOf = (
  result: OpticalImagingResult,
  options: PrincipalRayOptions = {},
): OpticalRay[] => {
  const forwardExtent =
    options.forwardExtent ?? defaultForwardExtent(result.model, result.outcome)
  return result.model.elementType === 'thin_lens'
    ? thinLensRays(result.model, result.outcome, forwardExtent)
    : planeMirrorRays(result.model, result.outcome)
}
