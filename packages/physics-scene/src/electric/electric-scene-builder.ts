/**
 * Point-charge scene builder.
 *
 * Produces a plain `PhysicsScene` describing a world of static source charges and
 * an optional probe. It performs NO physics: no field is evaluated, no force is
 * computed, nothing named `E` is stored. The engine reads this description and the
 * Verifier checks what it produced.
 */

import { asObservableId, asQuestionId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'
import { vec3 } from '@physicsos/physics-math'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { Field, ObservableDefinition, Particle, PhysicsScene } from '../scene.ts'
import {
  pointChargeField,
  pointChargeParticle,
  probeParticle,
  type PointChargeInput,
  type ProbeParticleInput,
} from './point-charge.ts'

export interface PointChargeSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  /** One or more static source charges. Signed values; sign is the physics. */
  readonly charges: readonly PointChargeInput[]
  /**
   * The charge that feels the field. Optional: "what is E at 20 cm from a 5 μC
   * charge" is a complete world with no probe in it.
   */
  readonly probe?: ProbeParticleInput
  /**
   * Where the field is sampled when there is no probe, in metres. The engine
   * reports E here so a question can ask about a bare point in space.
   */
  readonly samplePoint?: { x: number; y: number; z: number }
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
  readonly sourceQuestionId?: string
}

/** Observables a point-charge scene publishes, all on by default. */
const observables = (hasProbe: boolean): ObservableDefinition[] => [
  {
    id: asObservableId('obs-electric-field-vector'),
    type: 'electric_field' as const,
    visible: true,
    parameters: { kind: 'field_vector' },
  },
  {
    id: asObservableId('obs-charge-sign'),
    type: 'annotation' as const,
    visible: true,
    parameters: { kind: 'charge_sign' },
  },
  ...(hasProbe
    ? [
      {
        id: asObservableId('obs-electric-force'),
        type: 'force' as const,
        targetId: 'probe-1',
        visible: true,
      },
      {
        id: asObservableId('obs-electric-velocity'),
        type: 'velocity' as const,
        targetId: 'probe-1',
        visible: true,
      },
      {
        id: asObservableId('obs-electric-trajectory'),
        type: 'trajectory' as const,
        targetId: 'probe-1',
        visible: true,
      },
    ]
    : []),
]

export const createPointChargeScene = (input: PointChargeSceneInput): PhysicsScene => {
  const now = input.now ?? (new Date().toISOString() as IsoDateTime)
  const sources: Particle[] = input.charges.map(pointChargeParticle)
  const fields: Field[] = input.charges.map(pointChargeField)
  const probe = input.probe === undefined ? undefined : probeParticle(input.probe)
  const sample = input.samplePoint ?? probe?.position.vector ?? vec3(0.2, 0, 0)

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'electric-point-charge-scene'),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [],
    particles: probe === undefined ? sources : [...sources, probe],
    fields,
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [
      ...observables(probe !== undefined),
      /* The sample point is part of the world description: it is WHERE the
         question asks about the field, not a computed result. */
      {
        id: asObservableId('obs-field-sample'),
        type: 'geometry' as const,
        visible: probe === undefined,
        parameters: { kind: 'field_sample', x: sample.x, y: sample.y },
      },
      /* Equipotential contours are topology of the combined field. They are only
         meaningful for superposition (a single source's equipotentials are concentric
         circles — already obvious from the streamlines), so the observable is only
         present for two or more sources. The renderer reads this to toggle the
         contour layer; it is never a verified numerical assertion. */
      ...(input.charges.length >= 2
        ? [{
            id: asObservableId('obs-equipotential'),
            type: 'annotation' as const,
            visible: true,
            parameters: { kind: 'equipotential' },
          }]
        : []),
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      ...(input.sourceQuestionId === undefined
        ? {}
        : { sourceQuestionId: asQuestionId(input.sourceQuestionId) }),
      title: input.title ?? '点电荷电场',
      description: input.description ?? '静止点电荷产生的电场与探针受力',
    },
  }
}

/** Where the engine should report E when the scene has no probe. */
export const fieldSamplePointOf = (
  scene: PhysicsScene,
): { x: number; y: number; z: number } | undefined => {
  const definition = scene.observableDefinitions.find(
    (entry) => entry.parameters?.['kind'] === 'field_sample',
  )
  const x = definition?.parameters?.['x']
  const y = definition?.parameters?.['y']
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  return { x, y, z: 0 }
}
