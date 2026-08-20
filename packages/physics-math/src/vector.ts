import { PhysicsOSError } from '@physicsos/shared'

/** docs/03 §14 — plain numeric pair, no unit or dimension semantics. */
export interface Vector2 {
  x: number
  y: number
}

/** docs/03 §15 — plain numeric triple. 2D worlds set `z = 0`. */
export interface Vector3 {
  x: number
  y: number
  z: number
}

export class ZeroVectorError extends PhysicsOSError {
  constructor(operation: string) {
    super('ZERO_VECTOR', `Operation "${operation}" is undefined for the zero vector.`, {
      details: { operation },
    })
    this.name = 'ZeroVectorError'
  }
}

export const ZERO: Vector3 = Object.freeze({ x: 0, y: 0, z: 0 })
export const UNIT_X: Vector3 = Object.freeze({ x: 1, y: 0, z: 0 })
export const UNIT_Y: Vector3 = Object.freeze({ x: 0, y: 1, z: 0 })
export const UNIT_Z: Vector3 = Object.freeze({ x: 0, y: 0, z: 1 })

export const vec3 = (x: number, y: number, z = 0): Vector3 => ({ x, y, z })

export const vec2 = (x: number, y: number): Vector2 => ({ x, y })

export const toVector2 = (v: Vector3): Vector2 => ({ x: v.x, y: v.y })

export const fromVector2 = (v: Vector2, z = 0): Vector3 => ({ x: v.x, y: v.y, z })

export const add = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const subtract = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

export const scale = (v: Vector3, factor: number): Vector3 => ({
  x: v.x * factor,
  y: v.y * factor,
  z: v.z * factor,
})

export const negate = (v: Vector3): Vector3 => scale(v, -1)

export const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * Right-handed cross product. This single definition fixes the rotation
 * semantics of the whole runtime: with x to the right, y up and z out of the
 * page, `cross(UNIT_X, UNIT_Z)` is `-UNIT_Y`.
 */
export const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const magnitudeSquared = (v: Vector3): number => dot(v, v)

export const magnitude = (v: Vector3): number => Math.hypot(v.x, v.y, v.z)

export const isZero = (v: Vector3, epsilon = 0): boolean => magnitude(v) <= epsilon

export const normalize = (v: Vector3): Vector3 => {
  const length = magnitude(v)
  if (length === 0) throw new ZeroVectorError('normalize')
  return scale(v, 1 / length)
}

/** Returns the unit vector, or `undefined` for the zero vector. */
export const tryNormalize = (v: Vector3): Vector3 | undefined => {
  const length = magnitude(v)
  if (length === 0) return undefined
  return scale(v, 1 / length)
}

export const distance = (a: Vector3, b: Vector3): number => magnitude(subtract(a, b))

export const equals = (a: Vector3, b: Vector3, epsilon = 0): boolean =>
  Math.abs(a.x - b.x) <= epsilon &&
  Math.abs(a.y - b.y) <= epsilon &&
  Math.abs(a.z - b.z) <= epsilon

export const isFiniteVector = (v: Vector3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

/** Angle between two vectors in radians. Undefined for zero vectors. */
export const angleBetween = (a: Vector3, b: Vector3): number => {
  const lengths = magnitude(a) * magnitude(b)
  if (lengths === 0) throw new ZeroVectorError('angleBetween')
  const cosine = Math.min(1, Math.max(-1, dot(a, b) / lengths))
  return Math.acos(cosine)
}

/** True when both vectors are non-zero and their dot product is within tolerance of zero. */
export const isOrthogonal = (a: Vector3, b: Vector3, epsilon = 1e-12): boolean => {
  const lengths = magnitude(a) * magnitude(b)
  if (lengths === 0) return false
  return Math.abs(dot(a, b)) / lengths <= epsilon
}

/** Component of `v` along `axis`. */
export const projectOnto = (v: Vector3, axis: Vector3): Vector3 => {
  const axisLengthSquared = magnitudeSquared(axis)
  if (axisLengthSquared === 0) throw new ZeroVectorError('projectOnto')
  return scale(axis, dot(v, axis) / axisLengthSquared)
}

/** Component of `v` perpendicular to `axis`. */
export const rejectFrom = (v: Vector3, axis: Vector3): Vector3 =>
  subtract(v, projectOnto(v, axis))

/** Rotates a vector about the +z axis by `radians` (counter-clockwise). */
export const rotateAboutZ = (v: Vector3, radians: number): Vector3 => {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos, z: v.z }
}
