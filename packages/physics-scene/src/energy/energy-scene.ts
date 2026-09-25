import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { EnergyBench, ObservableDefinition, PhysicsScene } from '../scene.ts'

/**
 * The mechanical-energy rig is static apparatus in the same sense the pressure
 * rigs are: mass, release height, ramp angle and friction are the facts, and the
 * ledger at each point of the run is derived from them. There IS a natural
 * timeline here — the cart really does move — but the energies do not need one:
 * where the cart is is a position on the ramp, and the energies follow from the
 * height, so the rig reports the ledger directly rather than integrating.
 *
 * Authoring units follow the junior lab: kilograms for the mass, centimetres for
 * the height, degrees for the angle.
 */
export type EnergyObservableKey = 'ledger' | 'conversion'

export interface EnergyBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  /** Mass of the cart in kilograms (> 0). */
  readonly mass?: number
  /** Gravitational field strength in m/s² (> 0). */
  readonly gravity?: number
  /** Release height in centimetres (> 0). */
  readonly releaseHeight?: number
  /** Incline angle in degrees, strictly between 0 and 90. */
  readonly inclineAngle?: number
  /** Kinetic friction coefficient along the ramp (≥ 0). */
  readonly frictionCoefficient?: number
  readonly observableVisibility?: Partial<Record<EnergyObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: EnergyObservableKey) => asObservableId(`observable-energy-${key}`)

/** Create a single-bench mechanical-energy scene (one cart, one ramp). */
export const createEnergyBenchScene = (input: EnergyBenchSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const benchId = input.benchId ?? 'energy-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: EnergyBench = {
    id: benchId,
    type: 'energy_bench',
    mass: quantity(input.mass ?? 2, 'kg', 'mass'),
    gravity: quantity(input.gravity ?? 9.8, 'm/s^2', 'acceleration'),
    releaseHeight: quantity((input.releaseHeight ?? 90) / 100, 'm', 'length'),
    inclineAngle: quantity(input.inclineAngle ?? 45, 'deg', 'angle'),
    frictionCoefficient: quantity(input.frictionCoefficient ?? 0, '', 'dimensionless'),
  }

  const observables: ObservableDefinition[] = [
    {
      id: observableId('ledger'),
      type: 'energy',
      targetId: bench.id,
      visible: visibility.ledger ?? true,
    },
    {
      id: observableId('conversion'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.conversion ?? true,
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'energy-runtime-scene'),
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
    energyBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observables,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '机械能实验台',
      description:
        input.description ?? 'Mechanical Energy · 动能 Ek = ½mv² · 势能 Ep = mgh',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Mechanical-energy benches of a scene. Legacy-safe: scenes persisted before
 * this slice have no `energyBenches` collection, so readers fall back to `[]`.
 */
export const energyBenchesOf = (scene: PhysicsScene): EnergyBench[] =>
  scene.energyBenches ?? []

/** The single bench of a mechanical-energy scene, if present. */
export const energyBenchOf = (scene: PhysicsScene): EnergyBench | undefined =>
  energyBenchesOf(scene)[0]

/** True when the scene is a pure single-bench mechanical-energy scene. */
export const isEnergyScene = (scene: PhysicsScene): boolean =>
  energyBenchesOf(scene).length === 1 &&
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
  (scene.currentBenches ?? []).length === 0
