import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { InductionBench, InductionBenchType, PhysicsScene } from '../scene.ts'

/**
 * Induction bench scenes carry a real timeline: the rod sweeps through the
 * field at constant v (bar_motion), or the flux changes at a constant rate
 * (flux_change), so the induced EMF and current evolve with time. The scene
 * does NOT store the EMF — B, L, v, R (or dΦ/dt) are the editable facts, so E
 * and I = E/R are derived by the engine instead of a persisted value that goes
 * stale on the next edit.
 *
 * Authoring units follow the junior lab: tesla for B, centimetres for L, m/s
 * for v, ohms for R, cm² for coil area.
 */
export type InductionObservableKey = 'emf' | 'current' | 'flux' | 'bar_motion'

/** Netlist-style authoring input for the motional-EMF (rod-cutting) rig. */
export interface BarMotionSpec {
  readonly benchId?: string
  readonly type?: 'bar_motion'
  /** Magnetic flux density in tesla (> 0). */
  readonly magneticFluxDensity: number
  /** Rod length in centimetres (> 0). */
  readonly barLength: number
  /** Rod velocity in m/s; sign encodes cutting direction. */
  readonly barVelocity: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance: number
}

/** Authoring input for the flux-change (Faraday) rig. */
export interface FluxChangeSpec {
  readonly benchId?: string
  readonly type?: 'flux_change'
  /** Magnetic flux density in tesla (> 0). */
  readonly magneticFluxDensity: number
  /** Coil area in cm² (> 0). */
  readonly coilArea: number
  /** Angle between B and the coil normal in degrees (0 = perpendicular). */
  readonly coilAngle?: number
  /** Rate of change of flux dΦ/dt in Wb/s; sign sets the Lenz direction. */
  readonly fluxRate: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance: number
}

/**
 * Authoring input for the two-bar rail rig: two conducting bars slide on
 * parallel rails a `barLength` apart inside a uniform field. The loop EMF is
 * E = BL(v₁−v₂); the magnetic force couples the bars, so without an external
 * force the pair's momentum is conserved while the relative velocity decays
 * with τ = R·m₁m₂/(B²L²(m₁+m₂)).
 */
export interface DoubleBarRailSpec {
  readonly benchId?: string
  readonly type?: 'double_bar_rail'
  /** Magnetic flux density in tesla (> 0). */
  readonly magneticFluxDensity: number
  /** Rail spacing = bar length in centimetres (> 0). */
  readonly barLength: number
  /** Bar masses in grams, positional [bar1, bar2] (each > 0). */
  readonly barMasses: readonly [number, number]
  /** Bar velocities in m/s, positional [bar1, bar2]; sign = direction. */
  readonly barVelocities: readonly [number, number]
  /** Initial x positions in centimetres, positional [bar1, bar2]; signed. */
  readonly barPositions: readonly [number, number]
  /** Constant external force on bar 1 in newtons (≥ 0; omitted/0 = free pair). */
  readonly externalForce?: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance: number
}

/** Discriminated authoring input: one sub-model per bench. */
export type InductionBenchSpec = BarMotionSpec | FluxChangeSpec | DoubleBarRailSpec

export interface InductionBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bench: InductionBenchSpec
  readonly observableVisibility?: Partial<Record<InductionObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: InductionObservableKey) => asObservableId(`observable-induction-${key}`)

const isBarMotion = (spec: InductionBenchSpec): spec is BarMotionSpec =>
  (spec.type ?? 'bar_motion') === 'bar_motion'

const isDoubleBarRail = (spec: InductionBenchSpec): spec is DoubleBarRailSpec =>
  spec.type === 'double_bar_rail'

const toBench = (spec: InductionBenchSpec): InductionBench => {
  if (isDoubleBarRail(spec)) {
    return {
      id: spec.benchId ?? 'induction-bench-1',
      type: 'double_bar_rail',
      magneticFluxDensity: quantity(spec.magneticFluxDensity, 'T', 'magnetic_flux_density'),
      resistance: quantity(spec.resistance, 'Ω', 'resistance'),
      barLength: quantity(spec.barLength, 'cm', 'length'),
      barMasses: [
        quantity(spec.barMasses[0], 'g', 'mass'),
        quantity(spec.barMasses[1], 'g', 'mass'),
      ],
      barVelocities: [
        quantity(spec.barVelocities[0], 'm/s', 'velocity'),
        quantity(spec.barVelocities[1], 'm/s', 'velocity'),
      ],
      barPositions: [
        quantity(spec.barPositions[0], 'cm', 'length'),
        quantity(spec.barPositions[1], 'cm', 'length'),
      ],
      ...(spec.externalForce === undefined
        ? {}
        : { externalForce: quantity(spec.externalForce, 'N', 'force') }),
    }
  }
  if (isBarMotion(spec)) {
    return {
      id: spec.benchId ?? 'induction-bench-1',
      type: 'bar_motion',
      magneticFluxDensity: quantity(spec.magneticFluxDensity, 'T', 'magnetic_flux_density'),
      resistance: quantity(spec.resistance, 'Ω', 'resistance'),
      barLength: quantity(spec.barLength, 'cm', 'length'),
      barVelocity: quantity(spec.barVelocity, 'm/s', 'velocity'),
    }
  }
  /* flux_change */
  const angleDeg = spec.coilAngle ?? 0
  return {
    id: spec.benchId ?? 'induction-bench-1',
    type: 'flux_change',
    magneticFluxDensity: quantity(spec.magneticFluxDensity, 'T', 'magnetic_flux_density'),
    resistance: quantity(spec.resistance, 'Ω', 'resistance'),
    coilArea: quantity(spec.coilArea, 'cm^2', 'area'),
    coilAngle: quantity(angleDeg, 'deg', 'angle'),
    fluxRate: quantity(spec.fluxRate, 'Wb/s', 'magnetic_flux_rate'),
  }
}

/** Create a single-bench electromagnetic induction scene. */
export const createInductionScene = (input: InductionBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'induction-runtime-scene'
  const visibility = input.observableVisibility ?? {}
  const bench = toBench(input.bench)
  const isBar = bench.type === 'bar_motion'

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      /* The rod sweeps at constant v, so a 5 s window gives a visible
         displacement; flux_change is steady but still benefits from a run to
         show the constant EMF over time. The double-bar rail relaxes with
         τ = R·m₁m₂/(B²L²(m₁+m₂)) = 0.25 s on the template defaults, so 4 s
         (16 τ) shows the whole exchange and then the pair drifting as one;
         the UI run window reads this stamp. */
      endTime: quantity(bench.type === 'double_bar_rail' ? 4 : 5, 's', 'time'),
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
    thermalBenches: [],
    leverBenches: [],
    inductionBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('emf'),
        type: 'voltage',
        targetId: bench.id,
        visible: visibility.emf ?? true,
      },
      {
        id: observableId('current'),
        type: 'current',
        targetId: bench.id,
        visible: visibility.current ?? true,
      },
      /* dΦ/dt is published only by the single-bench rigs; the double-bar
         engine carries no flux quantity, so declaring the toggle there would
         hand the student a switch that changes nothing. */
      ...(bench.type === 'double_bar_rail'
        ? []
        : [
            {
              id: observableId('flux'),
              type: 'magnetic_field' as const,
              targetId: bench.id,
              visible: visibility.flux ?? true,
            },
          ]),
      ...(isBar
        ? [
            {
              id: observableId('bar_motion'),
              type: 'geometry' as const,
              targetId: bench.id,
              visible: visibility.bar_motion ?? true,
            },
          ]
        : []),
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '电磁感应实验台',
      description: input.description ?? 'Induction Engine · 法拉第电磁感应 E = -dΦ/dt',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Induction benches of a scene. Legacy-safe: scenes persisted before the
 * induction slice have no `inductionBenches` collection, so readers fall back
 * to `[]`.
 */
export const inductionBenchesOf = (scene: PhysicsScene): InductionBench[] =>
  scene.inductionBenches ?? []

/** The single induction bench of an induction scene, if present. */
export const inductionBenchOf = (scene: PhysicsScene): InductionBench | undefined =>
  inductionBenchesOf(scene)[0]

/** True when the scene is a pure single-bench induction scene. */
export const isInductionScene = (scene: PhysicsScene): boolean =>
  inductionBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0 &&
  (scene.leverBenches ?? []).length === 0

/** The induction sub-model type of the bench. */
export const inductionTypeOf = (bench: InductionBench): InductionBenchType => bench.type
