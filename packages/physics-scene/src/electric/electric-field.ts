/**
 * Electric field descriptors in a scene.
 *
 * The scene DESCRIBES fields; it never evaluates them. `E = kq/r²` belongs to
 * `@physicsos/physics-electric-core` and is applied by the engine, so a scene can
 * never disagree with a solver about what the field is.
 */

import { quantityVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'

import type { UniformElectricField } from '../scene.ts'

/** Direction of a uniform field, as the scene commands express it. */
export type UniformFieldAxis = 'right' | 'left' | 'up' | 'down'

const AXIS_VECTORS: Readonly<Record<UniformFieldAxis, Vector3>> = {
  right: vec3(1, 0, 0),
  left: vec3(-1, 0, 0),
  up: vec3(0, 1, 0),
  down: vec3(0, -1, 0),
}

/**
 * Uniform field descriptor.
 *
 * Strength is a non-negative magnitude and direction is separate, matching the
 * `SetElectricFieldStrength` / `SetElectricFieldDirection` command split: a
 * strength edit must not silently flip the field.
 */
export const uniformElectricField = (
  id: string,
  strength: number,
  axis: UniformFieldAxis,
): UniformElectricField => {
  const unit = AXIS_VECTORS[axis]
  return {
    id,
    type: 'uniform_electric',
    fieldStrength: quantityVector(
      vec3(unit.x * Math.abs(strength), unit.y * Math.abs(strength), unit.z * Math.abs(strength)),
      'V/m',
      'electric_field',
    ),
  }
}

/** Axis a uniform field points along, read back from its vector. */
export const uniformFieldAxisOf = (field: UniformElectricField): UniformFieldAxis => {
  const { x, y } = field.fieldStrength.vector
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'right' : 'left'
  return y >= 0 ? 'up' : 'down'
}
