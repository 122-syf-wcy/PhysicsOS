/**
 * Point-charge field solver.
 *
 * Evaluates the field a set of static source charges produces, using the one
 * definition of E = kq/r² in `@physicsos/physics-electric-core`. It reads the
 * scene and returns numbers; it does not decide what to display.
 */

import { toCanonicalVector } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import type { Vector3 } from '@physicsos/physics-math'
import { magnitude } from '@physicsos/physics-math'
import {
  chargeSignOf,
  fieldAt,
  pointChargePotential,
  type ChargeSign,
  type ElectricFieldSample,
  type PointCharge,
} from '@physicsos/physics-electric-core'
import { sourceChargesOf, type Particle, type PhysicsScene } from '@physicsos/physics-scene'

/** A source charge in SI units, as the solver consumes it. */
export interface ResolvedSourceCharge extends PointCharge {
  readonly sign: ChargeSign
}

/** Read the scene's source charges into SI vectors. */
export const resolveSourceCharges = (scene: PhysicsScene): readonly ResolvedSourceCharge[] =>
  sourceChargesOf(scene.particles, scene.fields).map((particle: Particle) => {
    const charge = particle.charge === undefined ? 0 : canonicalValue(particle.charge)
    return {
      id: particle.id,
      charge,
      position: toCanonicalVector(particle.position).vectorSI,
      fixed: true,
      sign: chargeSignOf(charge),
    }
  })

/** Field of every source at one point. */
export const solveFieldAt = (
  charges: readonly ResolvedSourceCharge[],
  at: Vector3,
): ElectricFieldSample => fieldAt(charges, at)

/** Superposed potential at one point. */
export const solvePotentialAt = (
  charges: readonly ResolvedSourceCharge[],
  at: Vector3,
): number =>
  charges.reduce(
    (total, charge) => total + pointChargePotential(charge.charge, charge.position, at),
    0,
  )

/**
 * A lattice of field samples for display.
 *
 * Points closer to a source than `minRadius` are dropped rather than clamped: near
 * a singularity the arrow length stops meaning anything, and drawing a clamped
 * arrow would imply a field strength the model never asserted.
 */
export const sampleFieldLattice = (
  charges: readonly ResolvedSourceCharge[],
  options: {
    readonly origin: { x: number; y: number }
    readonly width: number
    readonly height: number
    readonly columns: number
    readonly rows: number
    readonly minRadius: number
  },
): readonly ElectricFieldSample[] => {
  const samples: ElectricFieldSample[] = []
  const stepX = options.width / options.columns
  const stepY = options.height / options.rows
  for (let column = 0; column < options.columns; column += 1) {
    for (let row = 0; row < options.rows; row += 1) {
      const at = {
        x: options.origin.x + stepX * (column + 0.5),
        y: options.origin.y + stepY * (row + 0.5),
        z: 0,
      }
      const tooClose = charges.some(
        (charge) => magnitude({
          x: at.x - charge.position.x,
          y: at.y - charge.position.y,
          z: at.z - charge.position.z,
        }) < options.minRadius,
      )
      if (tooClose) continue
      samples.push(fieldAt(charges, at))
    }
  }
  return samples
}

/**
 * A grid of potential samples for equipotential contour rendering.
 *
 * Each cell holds the superposed potential V = Σ kqᵢ/rᵢ at its center. Cells whose
 * center sits closer to a source than `minRadius` are filled with `NaN` rather than
 * a clamped value: the equipotential topology near a singularity is not something
 * the model asserts, and a clamped contour would imply a potential the field never
 * produced. The renderer's marching-squares pass treats `NaN` as "no data here".
 */
export interface PotentialGrid {
  readonly columns: number
  readonly rows: number
  readonly values: Float64Array
  readonly origin: { x: number; y: number }
  readonly cellSize: { x: number; y: number }
}

export const samplePotentialGrid = (
  charges: readonly ResolvedSourceCharge[],
  options: {
    readonly origin: { x: number; y: number }
    readonly width: number
    readonly height: number
    readonly columns: number
    readonly rows: number
    readonly minRadius: number
  },
): PotentialGrid => {
  const values = new Float64Array(options.columns * options.rows)
  const cellX = options.width / options.columns
  const cellY = options.height / options.rows
  for (let column = 0; column < options.columns; column += 1) {
    for (let row = 0; row < options.rows; row += 1) {
      const at = {
        x: options.origin.x + cellX * (column + 0.5),
        y: options.origin.y + cellY * (row + 0.5),
        z: 0,
      }
      const tooClose = charges.some(
        (charge) => magnitude({
          x: at.x - charge.position.x,
          y: at.y - charge.position.y,
          z: at.z - charge.position.z,
        }) < options.minRadius,
      )
      const index = row * options.columns + column
      values[index] = tooClose ? Number.NaN : solvePotentialAt(charges, at)
    }
  }
  return {
    columns: options.columns,
    rows: options.rows,
    values,
    origin: { x: options.origin.x, y: options.origin.y },
    cellSize: { x: cellX, y: cellY },
  }
}
