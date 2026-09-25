import { quantity } from '@physicsos/physics-units'

import { CELSIUS_ZERO_IN_KELVIN } from './thermal-scene.ts'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { ObservableDefinition, PhysicsScene, ThermometerBench } from '../scene.ts'

/**
 * A thermometer is apparatus, not an event: the column stands where the
 * temperature puts it, so there is no timeline and nothing to integrate. The
 * scene stores what the instrument IS — bulb, bore, filling liquid — and where
 * its lower fixed point sits; the column and the scale follow from those.
 *
 * Authoring units follow the lab: cm³ for the bulb, mm for the bore, °C for the
 * temperature, cm for the column's starting length.
 */
export type ThermometerObservableKey = 'scale' | 'column'

export interface ThermometerBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  /** Bulb volume in cm³ (> 0). */
  readonly bulbVolume?: number
  /** Bore diameter in millimetres (> 0). */
  readonly boreDiameter?: number
  /** Volumetric expansion coefficient in 1/K (> 0); 2×10⁻⁴ is a typical liquid. */
  readonly expansionCoefficient?: number
  /** Temperature the bulb sits in, in °C. */
  readonly temperature?: number
  /** Column length at the lower fixed point, in cm (> 0). */
  readonly icePointLength?: number
  readonly observableVisibility?: Partial<Record<ThermometerObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: ThermometerObservableKey) =>
  asObservableId(`observable-thermometer-${key}`)

/** Create a single-bench thermometer scene (one instrument, one temperature). */
export const createThermometerBenchScene = (
  input: ThermometerBenchSceneInput = {},
): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const benchId = input.benchId ?? 'thermometer-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: ThermometerBench = {
    id: benchId,
    type: 'liquid_in_glass',
    bulbVolume: quantity((input.bulbVolume ?? 0.1) / 1e6, 'm^3', 'volume'),
    boreDiameter: quantity((input.boreDiameter ?? 0.16) / 1000, 'm', 'length'),
    expansionCoefficient: quantity(input.expansionCoefficient ?? 2e-4, '', 'dimensionless'),
    /* The registry has kelvin, not degrees Celsius: the authoring unit is °C
       and the conversion happens here, the way the heating benches do it. */
    temperature: quantity(
      (input.temperature ?? 25) + CELSIUS_ZERO_IN_KELVIN,
      'K',
      'temperature',
    ),
    icePointLength: quantity((input.icePointLength ?? 2) / 100, 'm', 'length'),
  }

  const observables: ObservableDefinition[] = [
    {
      id: observableId('scale'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.scale ?? true,
    },
    {
      id: observableId('column'),
      type: 'measurement',
      targetId: bench.id,
      visible: visibility.column ?? true,
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'thermometer-runtime-scene'),
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
    transformerBenches: [],
    thermometerBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observables,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '温度计实验台',
      description:
        input.description ?? 'Thermometer · 刻度均匀来自膨胀的线性 · 两个固定点定标',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Thermometer benches of a scene. Legacy-safe: scenes persisted before this
 * slice have no `thermometerBenches` collection, so readers fall back to `[]`.
 */
export const thermometerBenchesOf = (scene: PhysicsScene): ThermometerBench[] =>
  scene.thermometerBenches ?? []

/** The single bench of a thermometer scene, if present. */
export const thermometerBenchOf = (scene: PhysicsScene): ThermometerBench | undefined =>
  thermometerBenchesOf(scene)[0]

/** True when the scene is a pure single-bench thermometer scene. */
export const isThermometerScene = (scene: PhysicsScene): boolean =>
  thermometerBenchesOf(scene).length === 1 &&
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
  (scene.lightBenches ?? []).length === 0 &&
  (scene.transformerBenches ?? []).length === 0
