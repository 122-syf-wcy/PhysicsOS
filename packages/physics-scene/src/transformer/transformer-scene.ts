import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { ObservableDefinition, PhysicsScene, TransformerBench } from '../scene.ts'

/**
 * A transformer is static apparatus in the same sense the pressure rigs are: the
 * ratios hold at every instant of the AC cycle, so there is no timeline to scrub
 * and nothing to integrate. The scene stores the primary voltage, the primary
 * current and the two turn counts; the secondary's voltage and current follow.
 *
 * Authoring units follow the classroom: volts, amperes and plain turn counts.
 */
export type TransformerObservableKey = 'readings' | 'windings'

export interface TransformerBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  /** Voltage across the driven winding, in volts (> 0). */
  readonly primaryVoltage?: number
  /** Current into the driven winding, in amperes (≥ 0). */
  readonly primaryCurrent?: number
  /** Turns on the driven winding (> 0). */
  readonly primaryTurns?: number
  /** Turns on the output winding (> 0). */
  readonly secondaryTurns?: number
  readonly observableVisibility?: Partial<Record<TransformerObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: TransformerObservableKey) =>
  asObservableId(`observable-transformer-${key}`)

/** Create a single-bench transformer scene (one core, two windings). */
export const createTransformerBenchScene = (
  input: TransformerBenchSceneInput = {},
): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const benchId = input.benchId ?? 'transformer-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: TransformerBench = {
    id: benchId,
    type: 'transformer',
    primaryVoltage: quantity(input.primaryVoltage ?? 220, 'V', 'electric_potential'),
    primaryCurrent: quantity(input.primaryCurrent ?? 0.1, 'A', 'electric_current'),
    primaryTurns: quantity(input.primaryTurns ?? 1000, '', 'dimensionless'),
    secondaryTurns: quantity(input.secondaryTurns ?? 200, '', 'dimensionless'),
  }

  const observables: ObservableDefinition[] = [
    {
      id: observableId('readings'),
      type: 'measurement',
      targetId: bench.id,
      visible: visibility.readings ?? true,
    },
    {
      id: observableId('windings'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.windings ?? true,
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'transformer-runtime-scene'),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'paused',
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
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    pressureBenches: [],
    currentBenches: [],
    energyBenches: [],
    lightBenches: [],
    inductionBenches: [],
    transformerBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observables,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '变压器实验台',
      description:
        input.description ?? 'Transformer · U₁/U₂ = N₁/N₂ · U₁I₁ = U₂I₂',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Transformer benches of a scene. Legacy-safe: scenes persisted before this
 * slice have no `transformerBenches` collection, so readers fall back to `[]`.
 */
export const transformerBenchesOf = (scene: PhysicsScene): TransformerBench[] =>
  scene.transformerBenches ?? []

/** The single bench of a transformer scene, if present. */
export const transformerBenchOf = (scene: PhysicsScene): TransformerBench | undefined =>
  transformerBenchesOf(scene)[0]

/** True when the scene is a pure single-bench transformer scene. */
export const isTransformerScene = (scene: PhysicsScene): boolean =>
  transformerBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0 &&
  (scene.leverBenches ?? []).length === 0 &&
  (scene.inductionBenches ?? []).length === 0 &&
  (scene.waveBenches ?? []).length === 0 &&
  (scene.pressureBenches ?? []).length === 0 &&
  (scene.currentBenches ?? []).length === 0 &&
  (scene.energyBenches ?? []).length === 0 &&
  (scene.lightBenches ?? []).length === 0
