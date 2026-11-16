import type { PhysicsSemanticIR, PlanarDirection } from './semantic-ir.ts'

const DIRECTION_ANGLES: Readonly<Record<Exclude<PlanarDirection, 'unknown'>, number>> = {
  right: 0,
  up: 90,
  left: 180,
  down: 270,
}

/** Resolve only a stated direction/angle, never an implicit horizontal launch. */
export function projectileLaunchAngle(ir: Pick<PhysicsSemanticIR, 'initialVelocityDirection' | 'launchAngle'>): number | undefined {
  const direction = ir.initialVelocityDirection
  const fromDirection = direction === undefined || direction === 'unknown'
    ? undefined : DIRECTION_ANGLES[direction]
  if (ir.launchAngle === undefined) return fromDirection
  if (!Number.isFinite(ir.launchAngle)) return undefined
  const angle = ((ir.launchAngle % 360) + 360) % 360
  if (fromDirection !== undefined) {
    const difference = Math.abs(angle - fromDirection)
    if (Math.min(difference, 360 - difference) > 1e-9) return undefined
  }
  return angle
}
