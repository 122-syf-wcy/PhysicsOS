/**
 * Optics Engine — geometric imaging on a single-axis optical bench.
 *
 * The engine resolves the scene's optical bench (one luminous object, one
 * imaging element, an optional screen) into canonical SI numbers, then images
 * with closed-form geometry: the thin lens equation 1/u + 1/v = 1/f for
 * lenses, the same equation folded back (real image in front, f = R/2) for
 * curved mirrors, and mirror symmetry (v = u, m = 1, virtual) for plane
 * mirrors. Imaging is static, so the timeline is zero-length and every state
 * is the configuration itself.
 *
 * Verification never trusts the formula alone: two principal-ray lines built
 * only from the lens rule / law of reflection are intersected and compared
 * against the computed image point, and the u = f case must leave those rays
 * parallel. It implements the same `PhysicsEngine<PhysicsScene>` interface as
 * the other engines and is mutually exclusive with them via `canHandle`
 * (pure single-bench scenes only).
 */
export {
  CURVED_MIRROR_MODEL,
  OPTICS_ENGINE_ID,
  OPTICS_ENGINE_VERSION,
  PLANE_MIRROR_MODEL,
  THIN_LENS_MODEL,
  OpticsEngine,
  opticsEngine,
  createOpticsSimulationRequest,
  resolveOpticalImaging,
} from './optics-engine.ts'
export {
  DEFAULT_APERTURE_RADIUS_METERS,
  resolveOpticalModel,
  type ResolvedOpticalModel,
} from './optics-model.ts'
export {
  LENS_ZONE_RELATIVE_TOLERANCE,
  SCREEN_SHARP_TOLERANCE_METERS,
  curvedMirrorOutcome,
  imagingResultOf,
  lensZoneOf,
  planeMirrorOutcome,
  thinLensOutcome,
  type ImageNature,
  type ImageOrientation,
  type ImagingOutcome,
  type LensZone,
  type OpticalImage,
  type OpticalImagingResult,
} from './imaging.ts'
export {
  constructedImageTopOf,
  lineIntersection,
  principalRaysOf,
  type OpticalRay,
  type PrincipalRayOptions,
  type RayPoint,
} from './principal-rays.ts'
