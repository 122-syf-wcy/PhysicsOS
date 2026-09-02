import { derivedScalar, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import {
  opticalBenchOf,
  opticalElementOf,
  type OpticalElement,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, type Quantity } from '@physicsos/physics-units'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Imaging observation for a single optical bench. The numeric values
 * (image_distance, magnification, image_height, …) come straight from the
 * engine's derivedQuantities; the image nature (real/virtual) and orientation
 * (upright/inverted) are derived from the element geometry because the engine
 * does not publish them as derived quantities — they live in the imaging
 * result, which the observation layer reconstructs from the scene's bench.
 */
export interface OpticsImageObservation {
  readonly type: 'optics_image'
  readonly observableId: string
  readonly targetId: string
  readonly imageDistance: Quantity<'length'>
  readonly magnification: Quantity<'dimensionless'>
  readonly imageHeight: Quantity<'length'>
  readonly nature: 'real' | 'virtual'
  readonly orientation: 'upright' | 'inverted'
}

export interface OpticsObjectObservation {
  readonly type: 'optics_object'
  readonly observableId: string
  readonly targetId: string
  readonly objectDistance: Quantity<'length'>
  readonly objectHeight: Quantity<'length'>
  readonly focalLength?: Quantity<'length'>
}

export type OpticsObservation = OpticsImageObservation | OpticsObjectObservation

export interface OpticsObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly OpticsObservation[]
}

export interface OpticsObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

/** Read a scalar derived quantity, returning undefined when absent. */
const scalarOrUndefined = (
  derived: SimulationResult['derivedQuantities'] | SimulationState['derived'],
  key: string,
): number | undefined => {
  try {
    return derivedScalar(derived, key).value
  } catch {
    return undefined
  }
}

/**
 * Determine image nature and orientation from the bench geometry.
 *
 * The thin lens / curved mirror equation 1/u + 1/v = 1/f gives a positive v
 * (real, inverted) when u > f for a converging element (f > 0), and a negative v
 * (virtual, upright) when u < f. A diverging element (f < 0) or a plane mirror
 * always produces a virtual, upright image. This mirrors the engine's
 * `thinLensOutcome` / `curvedMirrorOutcome` / `planeMirrorOutcome` logic but is
 * read from the scene rather than re-importing the engine, so the observation
 * layer stays free of an engine dependency.
 */
function imageNatureOrientation(
  element: OpticalElement,
  objectDistance: number,
  focalLength: number | undefined,
): { nature: 'real' | 'virtual'; orientation: 'upright' | 'inverted' } {
  if (element.type === 'plane_mirror') {
    return { nature: 'virtual', orientation: 'upright' }
  }
  if (focalLength === undefined || focalLength === 0) {
    return { nature: 'virtual', orientation: 'upright' }
  }
  /* Diverging element (f < 0): always virtual, upright. */
  if (focalLength < 0) {
    return { nature: 'virtual', orientation: 'upright' }
  }
  /* Converging element (f > 0): real + inverted when u > f, virtual + upright
     when u < f. The u = f case produces no image; treat as virtual. */
  if (objectDistance > focalLength) {
    return { nature: 'real', orientation: 'inverted' }
  }
  return { nature: 'virtual', orientation: 'upright' }
}

export const observeOpticsScene = (input: OpticsObservationInput): OpticsObservationRuntimeState => {
  const { scene, simulation } = input
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Observation input must reference the same scene revision as the simulation.',
      { details: { sceneId: scene.id, simulationSceneId: simulation.sceneId } },
    )
  }

  const bench = opticalBenchOf(scene)
  if (bench === undefined) {
    throw new PhysicsOSError('OBSERVATION_BENCH_MISSING', 'Optics observations require an optical bench.')
  }

  const element = opticalElementOf(bench)
  if (element === undefined) {
    throw new PhysicsOSError('OBSERVATION_ELEMENT_MISSING', 'Optics observations require an imaging element.')
  }

  const objectDistance = canonicalValue(element.position) - canonicalValue(bench.object.position)
  const focalLength =
    element.type === 'thin_lens' || element.type === 'curved_mirror'
      ? canonicalValue(element.focalLength)
      : undefined

  const observations: OpticsObservation[] = []

  /* Object-geometry observation: distances and focal length from the bench. */
  const objectDistanceDq = scalarOrUndefined(simulation.derivedQuantities, 'object_distance')
  const objectHeightDq = scalarOrUndefined(simulation.derivedQuantities, 'object_height')
  const focalLengthDq = scalarOrUndefined(simulation.derivedQuantities, 'focal_length')
  const imageDistanceDq = scalarOrUndefined(simulation.derivedQuantities, 'image_distance')
  const magnificationDq = scalarOrUndefined(simulation.derivedQuantities, 'magnification')
  const imageHeightDq = scalarOrUndefined(simulation.derivedQuantities, 'image_height')

  const benchObjectId = bench.object.id
  const elementId = element.id

  /* Object observation from derived quantities. */
  if (objectDistanceDq !== undefined) {
    observations.push({
      type: 'optics_object',
      observableId: 'observable-optics-image' as unknown as OpticsObjectObservation['observableId'],
      targetId: benchObjectId,
      objectDistance: { value: objectDistanceDq, unit: 'cm', dimension: 'length' },
      ...(objectHeightDq !== undefined
        ? { objectHeight: { value: objectHeightDq, unit: 'cm', dimension: 'length' } }
        : { objectHeight: { value: 0, unit: 'cm', dimension: 'length' } }),
      ...(focalLengthDq !== undefined
        ? { focalLength: { value: focalLengthDq, unit: 'cm', dimension: 'length' } }
        : {}),
    })
  }

  /* Image observation from derived quantities + nature/orientation. */
  if (imageDistanceDq !== undefined && magnificationDq !== undefined) {
    const { nature, orientation } = imageNatureOrientation(element, objectDistance, focalLength)
    observations.push({
      type: 'optics_image',
      observableId: 'observable-optics-image' as unknown as OpticsImageObservation['observableId'],
      targetId: elementId,
      imageDistance: { value: imageDistanceDq, unit: 'cm', dimension: 'length' },
      magnification: { value: magnificationDq, unit: '', dimension: 'dimensionless' },
      ...(imageHeightDq !== undefined
        ? { imageHeight: { value: imageHeightDq, unit: 'cm', dimension: 'length' } }
        : { imageHeight: { value: 0, unit: 'cm', dimension: 'length' } }),
      nature,
      orientation,
    })
  }

  return { sceneRevision: scene.revision, observations }
}

/** Re-export for type narrowing in tests. */
export const isOpticsImageObservation = (
  obs: OpticsObservation,
): obs is OpticsImageObservation => obs.type === 'optics_image'

export const isOpticsObjectObservation = (
  obs: OpticsObservation,
): obs is OpticsObjectObservation => obs.type === 'optics_object'
