import type { Vector3 } from '@physicsos/physics-math'
import type { PhysicalDimension, Quantity } from '@physicsos/physics-units'
import { assertDimension, canonicalSymbolFor, resolveUnit } from '@physicsos/physics-units'
import { isFiniteVector, scale } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * docs/03 §16 — a Vector3 carrying unit and dimension semantics. Owned by
 * physics-core rather than physics-math: it combines pure vector structure with
 * unit semantics, so placing it in physics-math would force math -> units.
 */
export interface QuantityVector<D extends PhysicalDimension = PhysicalDimension> {
  vector: Vector3
  unit: string
  dimension: D
}

/** Canonical SI counterpart of {@link QuantityVector} for engine-internal use. */
export interface CanonicalVector<D extends PhysicalDimension = PhysicalDimension> {
  vectorSI: Vector3
  dimension: D
}

export class NonFiniteVectorError extends PhysicsOSError {
  constructor(context: string, vector: Vector3) {
    super('NON_FINITE_VECTOR', `Non-finite vector rejected in ${context}.`, {
      details: { context, x: String(vector.x), y: String(vector.y), z: String(vector.z) },
    })
    this.name = 'NonFiniteVectorError'
  }
}

export const quantityVector = <D extends PhysicalDimension>(
  vector: Vector3,
  unit: string,
  dimension: D,
): QuantityVector<D> => {
  if (!isFiniteVector(vector)) throw new NonFiniteVectorError(`quantityVector(${unit})`, vector)
  assertDimension(unit, dimension)
  return {
    vector: { x: vector.x, y: vector.y, z: vector.z },
    unit,
    dimension,
  }
}

export const toCanonicalVector = <D extends PhysicalDimension>(
  input: QuantityVector<D>,
): CanonicalVector<D> => {
  if (!isFiniteVector(input.vector)) {
    throw new NonFiniteVectorError(`toCanonicalVector(${input.unit})`, input.vector)
  }
  const definition = assertDimension(input.unit, input.dimension)
  return { vectorSI: scale(input.vector, definition.toSI), dimension: input.dimension }
}

export const fromCanonicalVector = <D extends PhysicalDimension>(
  input: CanonicalVector<D>,
): QuantityVector<D> => {
  if (!isFiniteVector(input.vectorSI)) {
    throw new NonFiniteVectorError(`fromCanonicalVector(${input.dimension})`, input.vectorSI)
  }
  return {
    vector: input.vectorSI,
    unit: canonicalSymbolFor(input.dimension),
    dimension: input.dimension,
  }
}

/** Magnitude of a QuantityVector expressed as a scalar Quantity in canonical SI. */
export const vectorMagnitudeQuantity = <D extends PhysicalDimension>(
  input: QuantityVector<D>,
): Quantity<D> => {
  const canonical = toCanonicalVector(input)
  const { x, y, z } = canonical.vectorSI
  return {
    value: Math.hypot(x, y, z),
    unit: canonicalSymbolFor(input.dimension),
    dimension: input.dimension,
  }
}

export const isCanonicalVectorUnit = (input: QuantityVector): boolean =>
  resolveUnit(input.unit).toSI === 1
