import { PhysicsOSError } from '@physicsos/shared'

import type { PhysicalDimension } from './dimension.ts'
import {
  assertDimension,
  canonicalSymbolFor,
  canonicalUnitFor,
  resolveUnit,
} from './unit-registry.ts'

/** docs/03 §10 — contract-facing scalar with an explicit unit and dimension. */
export interface Quantity<D extends PhysicalDimension = PhysicalDimension> {
  value: number
  unit: string
  dimension: D
}

/** docs/03 §11 — engine-internal canonical SI scalar. */
export interface CanonicalQuantity<D extends PhysicalDimension = PhysicalDimension> {
  valueSI: number
  dimension: D
}

/**
 * docs/03 §13 — presentation and provenance hints. Deliberately separate from
 * the numeric value: metadata must never round or truncate physics values.
 */
export interface NumericMetadata {
  precision?: number
  absoluteTolerance?: number
  relativeTolerance?: number
}

/** docs/03 §17 — angles are canonically radians inside the runtime. */
export type AngleQuantity = Quantity<'angle'>

export class NonFiniteValueError extends PhysicsOSError {
  constructor(value: number, context: string) {
    super('NON_FINITE_VALUE', `Non-finite value ${String(value)} rejected in ${context}.`, {
      details: { value: String(value), context },
    })
    this.name = 'NonFiniteValueError'
  }
}

const assertFinite = (value: number, context: string): number => {
  if (!Number.isFinite(value)) throw new NonFiniteValueError(value, context)
  return value
}

export const quantity = <D extends PhysicalDimension>(
  value: number,
  unit: string,
  dimension: D,
): Quantity<D> => {
  assertFinite(value, `quantity(${unit})`)
  assertDimension(unit, dimension)
  return { value, unit, dimension }
}

/**
 * Builds a Quantity by inferring the dimension from the registry, so callers
 * cannot pair `0.5` with `T` and claim it is a length.
 */
export const parseQuantity = (value: number, unit: string): Quantity => {
  assertFinite(value, `parseQuantity(${unit})`)
  const definition = resolveUnit(unit)
  return { value, unit, dimension: definition.dimension }
}

/**
 * Unit runtime validation only: is the value finite and is the unit of the
 * expected dimension. Physical plausibility (mass > 0, |q| > 0) belongs to
 * domain validation, not to the unit layer.
 */
export const validateQuantity = <D extends PhysicalDimension>(
  input: Quantity,
  expected: D,
): Quantity<D> => {
  assertFinite(input.value, `validateQuantity(${input.unit})`)
  const definition = assertDimension(input.unit, expected)
  if (input.dimension !== definition.dimension) {
    throw new PhysicsOSError(
      'DIMENSION_MISMATCH',
      `Quantity declares dimension "${input.dimension}" but unit "${input.unit}" is "${definition.dimension}".`,
      { details: { declared: input.dimension, unit: input.unit } },
    )
  }
  return { value: input.value, unit: input.unit, dimension: expected }
}

export const toCanonical = <D extends PhysicalDimension>(
  input: Quantity<D>,
): CanonicalQuantity<D> => {
  assertFinite(input.value, `toCanonical(${input.unit})`)
  const definition = assertDimension(input.unit, input.dimension)
  return {
    valueSI: assertFinite(input.value * definition.toSI, `toCanonical(${input.unit})`),
    dimension: input.dimension,
  }
}

export const canonicalValue = <D extends PhysicalDimension>(input: Quantity<D>): number =>
  toCanonical(input).valueSI

export const fromCanonical = <D extends PhysicalDimension>(
  input: CanonicalQuantity<D>,
): Quantity<D> => {
  assertFinite(input.valueSI, `fromCanonical(${input.dimension})`)
  return {
    value: input.valueSI,
    unit: canonicalSymbolFor(input.dimension),
    dimension: input.dimension,
  }
}

export const canonicalQuantity = <D extends PhysicalDimension>(
  valueSI: number,
  dimension: D,
): CanonicalQuantity<D> => {
  assertFinite(valueSI, `canonicalQuantity(${dimension})`)
  return { valueSI, dimension }
}

/** Converts between two units of the same dimension. */
export const convert = <D extends PhysicalDimension>(
  input: Quantity<D>,
  targetUnit: string,
): Quantity<D> => {
  const source = assertDimension(input.unit, input.dimension)
  const target = assertDimension(targetUnit, input.dimension)
  return {
    value: assertFinite(
      (input.value * source.toSI) / target.toSI,
      `convert(${input.unit}->${targetUnit})`,
    ),
    unit: target.symbol,
    dimension: input.dimension,
  }
}

export const sameDimension = (a: Quantity, b: Quantity): boolean => a.dimension === b.dimension

export const isCanonicalUnit = (input: Quantity): boolean =>
  resolveUnit(input.unit).key === canonicalUnitFor(input.dimension).key
