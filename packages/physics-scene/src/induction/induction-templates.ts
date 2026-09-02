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
    description: "Induction Engine · 法拉第电磁感应定律 E = -dΦ/dt（楞次定律）",
  })
