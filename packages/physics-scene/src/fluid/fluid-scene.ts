import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { FluidTank, PhysicsScene } from '../scene.ts'

/**
 * Spring-scale buoyancy scenes carry a real timeline: the block hangs above the
 * surface at t = 0 and is lowered at a steady rate until it is fully submerged
 * and then some, so the scale reading falls and flattens as the student
 * watches. The scene does NOT store the current depth — mass, volume and
 * liquid density are all editable facts, so depth and everything derived from
 * it come from the engine at the current time instead of a persisted number
 * that goes stale on the next edit.
 *
 * Authoring units are the ones a junior lab actually reads off its equipment:
 * grams and cubic centimetres for the block, kg/m³ for the liquid.
 */
export type FluidObservableKey = 'forces' | 'displaced'

export interface SubmergedBlockSpec {
  readonly id?: string
  readonly name?: string
  /** Mass of the block in grams (> 0). */
  readonly mass: number
  /** Total volume of the block in cubic centimetres (> 0). */
  readonly volume: number
  /** Vertical extent of the block in centimetres (> 0). */
  readonly height: number
}

export interface TankLiquidSpec {
  readonly id?: string
  readonly name?: string
  /** Density of the liquid in kg/m³ (> 0); 1000 is fresh water. */
  readonly density: number
}

export interface FluidTankSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly tankId?: string
  readonly block: SubmergedBlockSpec
  readonly liquid: TankLiquidSpec
  /** Descent speed of the block in cm/s (> 0). */
  readonly lowerRate?: number
  /** Gravitational field strength in m/s² (> 0). */
  readonly gravity?: number
  readonly observableVisibility?: Partial<Record<FluidObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: FluidObservableKey) => asObservableId(`observable-fluid-${key}`)

/** Create a single-tank buoyancy scene (one block, one liquid, one scale). */
export const createFluidTankScene = (input: FluidTankSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'fluid-runtime-scene'
  const tankId = input.tankId ?? 'fluid-tank-1'
  const visibility = input.observableVisibility ?? {}

  const tank: FluidTank = {
    id: tankId,
    type: 'fluid_tank',
    block: {
      id: input.block.id ?? 'block-1',
      ...(input.block.name === undefined ? {} : { name: input.block.name }),
      mass: quantity(input.block.mass, 'g', 'mass'),
      volume: quantity(input.block.volume, 'cm^3', 'volume'),
      height: quantity(input.block.height, 'cm', 'length'),
    },
    liquid: {
      id: input.liquid.id ?? 'liquid-1',
      ...(input.liquid.name === undefined ? {} : { name: input.liquid.name }),
      density: quantity(input.liquid.density, 'kg/m^3', 'density'),
    },
    lowerRate: quantity((input.lowerRate ?? 2) / 100, 'm/s', 'velocity'),
    gravity: quantity(input.gravity ?? 9.8, 'm/s^2', 'acceleration'),
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
    fluidTanks: [tank],
    thermalBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('forces'),
        type: 'force',
        targetId: tank.block.id,
        visible: visibility.forces ?? true,
      },
      {
        id: observableId('displaced'),
        type: 'geometry',
        targetId: tank.liquid.id,
        visible: visibility.displaced ?? true,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '浮力实验台',
      description: input.description ?? 'Fluid Engine · 弹簧测力计称重法测浮力',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Fluid tanks of a scene. Legacy-safe: scenes persisted before the fluid slice
 * have no `fluidTanks` collection, so readers fall back to `[]`.
 */
export const fluidTanksOf = (scene: PhysicsScene): FluidTank[] => scene.fluidTanks ?? []

/** The single tank of a fluid-statics scene, if present. */
export const fluidTankOf = (scene: PhysicsScene): FluidTank | undefined => fluidTanksOf(scene)[0]

/** True when the scene is a pure single-tank buoyancy scene. */
export const isFluidScene = (scene: PhysicsScene): boolean =>
  fluidTanksOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0
