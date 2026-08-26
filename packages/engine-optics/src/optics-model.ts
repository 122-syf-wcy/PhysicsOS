import { canonicalValue } from '@physicsos/physics-units'
import { opticalBenchesOf, type OpticalElement, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/** Default half-aperture (m) when the scene omits one; rendering-only. */
export const DEFAULT_APERTURE_RADIUS_METERS = 0.08

/**
 * Canonical (SI metres) view of a single-bench imaging setup. Light travels
 * towards +x; the object stands on the −x side of the element, so the object
 * distance u = elementX − objectX is strictly positive.
 */
export interface ResolvedOpticalModel {
  readonly benchId: string
  readonly objectId: string
  readonly elementId: string
  readonly elementType: OpticalElement['type']
  /** Signed axis position of the object's foot (m). */
  readonly objectX: number
  /** Object height above the axis (m), > 0. */
  readonly objectHeight: number
  /** Signed axis position of the element plane (m). */
  readonly elementX: number
  /** Object distance u = elementX − objectX (m), > 0. */
  readonly objectDistance: number
  /** Focal length (m); thin lens only, non-zero, > 0 converging. */
  readonly focalLength?: number
  /** Half-aperture for ray drawing (m). */
  readonly apertureRadius: number
  readonly screenId?: string
  /** Signed axis position of the screen plane (m). */
  readonly screenX?: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

/**
 * Resolve the scene's optical bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveOpticalModel = (scene: PhysicsScene): ResolvedOpticalModel => {
  const benches = opticalBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('OPTICS_SINGLE_BENCH', 'Optics Engine requires exactly one optical bench.')
  }

  const enabledElements = bench.elements.filter((element) => element.enabled !== false)
  const element = enabledElements[0]
  if (element === undefined || enabledElements.length !== 1) {
    throw modelError(
      'OPTICS_SINGLE_ELEMENT',
      'Optics Engine V1 images through exactly one enabled element.',
    )
  }

  const objectX = canonicalValue(bench.object.position)
  const objectHeight = canonicalValue(bench.object.height)
  const elementX = canonicalValue(element.position)
  const objectDistance = elementX - objectX
  if (!Number.isFinite(objectDistance) || objectDistance <= 0) {
    throw modelError(
      'OPTICS_OBJECT_BEHIND_ELEMENT',
      'The object must stand on the incoming side of the imaging element (u > 0).',
    )
  }
  if (!Number.isFinite(objectHeight) || objectHeight <= 0) {
    throw modelError('OPTICS_OBJECT_HEIGHT', 'Optical object height must be > 0.')
  }

  let focalLength: number | undefined
  if (element.type === 'thin_lens') {
    focalLength = canonicalValue(element.focalLength)
    if (!Number.isFinite(focalLength) || focalLength === 0) {
      throw modelError('OPTICS_FOCAL_LENGTH', 'Thin lens focal length must be non-zero.')
    }
  }

  const apertureRadius =
    element.apertureRadius === undefined
      ? DEFAULT_APERTURE_RADIUS_METERS
      : canonicalValue(element.apertureRadius)

  return {
    benchId: bench.id,
    objectId: bench.object.id,
    elementId: element.id,
    elementType: element.type,
    objectX,
    objectHeight,
    elementX,
    objectDistance,
    ...(focalLength === undefined ? {} : { focalLength }),
    apertureRadius,
    ...(bench.screen === undefined
      ? {}
      : { screenId: bench.screen.id, screenX: canonicalValue(bench.screen.position) }),
  }
}
