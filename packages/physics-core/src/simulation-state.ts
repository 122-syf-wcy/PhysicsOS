import type { Quantity } from '@physicsos/physics-units'

import type { QuantityVector } from './quantity-vector.ts'

/** docs/03 §81 — a traceable formula behind a derived quantity. */
export interface FormulaRef {
  id?: string
  expression: string
  latex?: string
  variables?: Record<string, string>
  conditions?: string[]
}

/** docs/03 §80 — engine-produced derived value with provenance. */
export interface DerivedQuantity {
  key: string
  targetId?: string
  value: Quantity | QuantityVector
  formula?: FormulaRef
  assumptions?: string[]
  confidence?: number
}

/** docs/03 §78 */
export interface ObjectState {
  id: string
  position?: QuantityVector<'length'>
  velocity?: QuantityVector<'velocity'>
  acceleration?: QuantityVector<'acceleration'>
  values?: Record<string, Quantity | QuantityVector>
}

/** docs/03 §79 */
export interface SimulationState {
  time: Quantity<'time'>
  objects: ObjectState[]
  derived: DerivedQuantity[]
}

/** docs/03 §82 */
export interface Measurement {
  id: string
  definitionId?: string
  time?: Quantity<'time'>
  targetId?: string
  value: Quantity | QuantityVector
  source: 'simulation' | 'derived' | 'instrument' | 'user'
  metadata?: Record<string, unknown>
}

export const isQuantityVector = (
  value: Quantity | QuantityVector,
): value is QuantityVector => 'vector' in value

export const isScalarQuantity = (value: Quantity | QuantityVector): value is Quantity =>
  'value' in value

export const findDerived = (
  derived: readonly DerivedQuantity[],
  key: string,
): DerivedQuantity | undefined => derived.find((entry) => entry.key === key)

/** Reads a derived scalar by key, throwing when it is missing or vector-valued. */
export const derivedScalar = (
  derived: readonly DerivedQuantity[],
  key: string,
): Quantity => {
  const found = findDerived(derived, key)
  if (found === undefined) throw new Error(`Derived quantity "${key}" is absent.`)
  if (!isScalarQuantity(found.value)) {
    throw new Error(`Derived quantity "${key}" is a vector, not a scalar.`)
  }
  return found.value
}

/** Reads a derived vector by key, throwing when it is missing or scalar-valued. */
export const derivedVector = (
  derived: readonly DerivedQuantity[],
  key: string,
): QuantityVector => {
  const found = findDerived(derived, key)
  if (found === undefined) throw new Error(`Derived quantity "${key}" is absent.`)
  if (!isQuantityVector(found.value)) {
    throw new Error(`Derived quantity "${key}" is a scalar, not a vector.`)
  }
  return found.value
}
