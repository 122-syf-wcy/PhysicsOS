import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { PhysicsScene, ThermalBench } from '../scene.ts'

/**
 * Constant-power heating scenes carry a real timeline: the sample starts cold
 * at t = 0 and the heater delivers the same power every second, so the
 * temperature climbs, holds at the melting point while the crystal melts, and
 * climbs again. The scene does NOT store the current temperature — mass, power
 * and the material constants are all editable facts, so the reading comes from
 * the engine at the current time rather than a persisted number that goes
 * stale on the next edit.
 *
 * Temperatures cross the contract in kelvin because that is the SI unit the
 * registry can convert honestly (°C is an offset, not a factor). The factory
 * accepts °C, which is what the thermometer in the lab is marked in, and the
 * UI converts back for display.
 */
export type ThermalObservableKey = 'thermometer' | 'phase'

/** Absolute zero in °C; the single place the °C ⇄ K offset is written down. */
export const CELSIUS_ZERO_IN_KELVIN = 273.15

export interface ThermalSampleSpec {
  readonly id?: string
  readonly name?: string
  /** Mass in grams (> 0). */
  readonly mass: number
  /** Specific heat while solid, in J/(kg·K) (> 0). */
  readonly solidSpecificHeat: number
  /** Specific heat once melted, in J/(kg·K) (> 0). */
  readonly liquidSpecificHeat: number
  /** Latent heat of fusion in J/kg (≥ 0); 0 marks an amorphous substance. */
  readonly latentHeat: number
  /** Melting point in °C. */
  readonly meltingPoint: number
  /**
   * Starting temperature in °C. At or above the melting point the sample is
   * already liquid and the run is a single warming segment.
   */
  readonly initialTemperature: number
}

export interface ThermalBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  readonly sample: ThermalSampleSpec
  /** A second sample heated by an identical heater alongside the first. */
  readonly comparisonSample?: ThermalSampleSpec
  /** Heater power in watts delivered to EACH sample (> 0). */
  readonly heaterPower?: number
  /** How long the heater is left on, in seconds (> 0); derived when omitted. */
  readonly runDuration?: number
  readonly observableVisibility?: Partial<Record<ThermalObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const kelvin = (celsius: number) => quantity(celsius + CELSIUS_ZERO_IN_KELVIN, 'K', 'temperature')

const observableId = (key: ThermalObservableKey) => asObservableId(`observable-thermal-${key}`)

/** Create a single-sample heating scene (one substance, one steady heater). */
export const createThermalBenchScene = (input: ThermalBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'thermal-runtime-scene'
  const benchId = input.benchId ?? 'thermal-bench-1'
  const visibility = input.observableVisibility ?? {}

  const sampleOf = (spec: ThermalSampleSpec, fallbackId: string) => ({
    id: spec.id ?? fallbackId,
    ...(spec.name === undefined ? {} : { name: spec.name }),
    mass: quantity(spec.mass, 'g', 'mass'),
    solidSpecificHeat: quantity(spec.solidSpecificHeat, 'J/(kg*K)', 'specific_heat'),
    liquidSpecificHeat: quantity(spec.liquidSpecificHeat, 'J/(kg*K)', 'specific_heat'),
    latentHeat: quantity(spec.latentHeat, 'J/kg', 'specific_latent_heat'),
    meltingPoint: kelvin(spec.meltingPoint),
    initialTemperature: kelvin(spec.initialTemperature),
  })

  const bench: ThermalBench = {
    id: benchId,
    type: 'thermal_bench',
    sample: sampleOf(input.sample, 'sample-1'),
    ...(input.comparisonSample === undefined
      ? {}
      : { comparisonSample: sampleOf(input.comparisonSample, 'sample-2') }),
    heaterPower: quantity(input.heaterPower ?? 50, 'W', 'power'),
    ...(input.runDuration === undefined
      ? {}
      : { runDuration: quantity(input.runDuration, 's', 'time') }),
  }

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
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
    thermalBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('thermometer'),
        type: 'geometry',
        targetId: bench.sample.id,
        visible: visibility.thermometer ?? true,
      },
      {
        id: observableId('phase'),
        type: 'geometry',
        targetId: bench.id,
        visible: visibility.phase ?? true,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '加热实验台',
      description: input.description ?? 'Thermal Engine · 恒功率加热与熔化曲线',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Thermal benches of a scene. Legacy-safe: scenes persisted before the thermal
 * slice have no `thermalBenches` collection, so readers fall back to `[]`.
 */
export const thermalBenchesOf = (scene: PhysicsScene): ThermalBench[] =>
  scene.thermalBenches ?? []

/** The single bench of a thermal scene, if present. */
export const thermalBenchOf = (scene: PhysicsScene): ThermalBench | undefined =>
  thermalBenchesOf(scene)[0]

/** True when the scene is a pure single-sample heating scene. */
export const isThermalScene = (scene: PhysicsScene): boolean =>
  thermalBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0
