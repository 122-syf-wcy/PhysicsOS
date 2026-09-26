import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createInductionScene } from './induction-scene.ts'

/**
 * Induction experiment templates (初中/高中电磁感应).
 *
 * Same shape as the optics / acoustics / lever templates: each creator returns
 * a complete PhysicsScene through the induction bench factory with
 * textbook-friendly defaults, so the Lab, tests and the agent all start from
 * identical worlds.
 */

export interface BarMotionSceneInput {
  readonly sceneId?: string
  /** Magnetic flux density in tesla (> 0); 0.5 T is a strong lab magnet. */
  readonly magneticFluxDensity?: number
  /** Rod length in centimetres (> 0). */
  readonly barLength?: number
  /** Rod velocity in m/s; sign encodes cutting direction. */
  readonly barVelocity?: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance?: number
  readonly now?: IsoDateTime
  readonly title?: string
}

/**
 * 导体棒切割磁感线 — a 0.5 T field, a 20 cm rod sweeping at 2 m/s through a
 * 5 Ω loop. The motional EMF is E = BLv = 0.5 × 0.20 × 2 = 0.20 V, and the
 * induced current is I = E / R = 0.20 / 5 = 0.040 A — the numbers every 高中
 * textbook uses.
 */
export const createBarMotionScene = (input: BarMotionSceneInput = {}): PhysicsScene =>
  createInductionScene({
    sceneId: input.sceneId ?? 'lab-induction-bar-motion',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'bar_motion',
      magneticFluxDensity: input.magneticFluxDensity ?? 0.5,
      barLength: input.barLength ?? 20,
      barVelocity: input.barVelocity ?? 2,
      resistance: input.resistance ?? 5,
    },
    title: input.title ?? '导体棒切割磁感线',
    description: 'Induction Engine · 导体棒切割磁感线 E = BLv',
  })

export interface FluxChangeSceneInput {
  readonly sceneId?: string
  /** Magnetic flux density in tesla (> 0). */
  readonly magneticFluxDensity?: number
  /** Coil area in cm² (> 0). */
  readonly coilArea?: number
  /** Angle between B and the coil normal in degrees (0 = perpendicular). */
  readonly coilAngle?: number
  /** Rate of change of flux dΦ/dt in Wb/s; sign sets the Lenz direction. */
  readonly fluxRate?: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance?: number
  readonly now?: IsoDateTime
  readonly title?: string
}

/**
 * 磁通量变化产生感应电动势 — a 0.4 T field through a 50 cm² coil whose flux
 * changes at 0.05 Wb/s through a 2 Ω loop. Faraday's law gives E = -dΦ/dt =
 * 0.05 V, and the induced current I = E / R = 0.025 A. The minus sign (Lenz's
 * law) sets the current direction to oppose the flux change.
 */
export const createFluxChangeScene = (input: FluxChangeSceneInput = {}): PhysicsScene =>
  createInductionScene({
    sceneId: input.sceneId ?? 'lab-induction-flux-change',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'flux_change',
      magneticFluxDensity: input.magneticFluxDensity ?? 0.4,
      coilArea: input.coilArea ?? 50,
      coilAngle: input.coilAngle ?? 0,
      fluxRate: input.fluxRate ?? 0.05,
      resistance: input.resistance ?? 2,
    },
    title: input.title ?? '磁通量变化产生感应电动势',
    description: 'Induction Engine · 法拉第电磁感应定律 E = -dΦ/dt（楞次定律）',
  })

export interface DoubleBarRailSceneInput {
  readonly sceneId?: string
  /** Magnetic flux density in tesla (> 0). */
  readonly magneticFluxDensity?: number
  /** Rail spacing = bar length in centimetres (> 0). */
  readonly barLength?: number
  /** Loop resistance in ohms (> 0). */
  readonly resistance?: number
  /** Bar masses in grams, positional [bar1, bar2] (each > 0). */
  readonly barMasses?: readonly [number, number]
  /** Bar velocities in m/s, positional [bar1, bar2]; sign = direction. */
  readonly barVelocities?: readonly [number, number]
  /** Initial x positions in centimetres, positional [bar1, bar2]; signed. */
  readonly barPositions?: readonly [number, number]
  /** Constant external force on bar 1 in newtons (≥ 0; 0 = free pair). */
  readonly externalForce?: number
  readonly now?: IsoDateTime
  readonly title?: string
}

/**
 * 导轨双棒 — two 50 g bars on rails 20 cm apart in a 0.5 T field through a
 * 0.1 Ω loop, bar 1 AHEAD of bar 2 and moving away at 2 m/s.
 *
 * Geometry is load-bearing physics: the magnetic coupling brakes the leading
 * bar and drags the trailing one, so the gap only ever GROWS (by τ·u₀ in the
 * limit) — a leading bar never meets the trailing one. Put the moving bar
 * behind instead and, with a relative displacement of τ·u₀, it would run
 * straight through the bar in front, which the engine does not model.
 *
 * The numbers are chosen so the exchange is visible inside one run: coupling
 * α = B²L²/R = 0.1 kg/s, τ = R·m₁m₂/(B²L²(m₁+m₂)) = 0.25 s, so within a
 * second the relative velocity has died away and the pair drifts together at
 * v共同 = m₁v₀/M = 1 m/s while the gap settles from 40 cm to ≈ 90 cm. The
 * opening EMF E = BLv₀ = 0.2 V is the same as the single-rod rig's, I₀ = 2 A,
 * F磁₀ = BIL = 0.2 N. With a constant F on bar 1 the terminal relative velocity
 * is u∞ = F·R·m₂/(B²L²(m₁+m₂)) = 5F m/s and I∞ = F·m₂/(BL·M) = 5F A.
 */
export const createDoubleBarRailScene = (input: DoubleBarRailSceneInput = {}): PhysicsScene =>
  createInductionScene({
    sceneId: input.sceneId ?? 'lab-induction-double-bar-rail',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'double_bar_rail',
      magneticFluxDensity: input.magneticFluxDensity ?? 0.5,
      barLength: input.barLength ?? 20,
      resistance: input.resistance ?? 0.1,
      barMasses: input.barMasses ?? [50, 50],
      barVelocities: input.barVelocities ?? [2, 0],
      barPositions: input.barPositions ?? [20, -20],
      ...(input.externalForce === undefined ? {} : { externalForce: input.externalForce }),
    },
    title: input.title ?? '导轨双棒电磁感应',
    description: 'Induction Engine · 双棒导轨 E = BL(v₁−v₂) · 磁力耦合动量交换',
  })
