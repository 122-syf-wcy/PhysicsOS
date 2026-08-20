import { PhysicsOSError } from '@physicsos/shared'

import type { PhysicalDimension } from './dimension.ts'
import { UNIT_DEFINITIONS, type UnitDefinition, type UnitKey } from './unit-definition.ts'

/**
 * Unicode NFC normalization is applied before every registration and lookup so
 * that visually identical inputs (OHM SIGN U+2126 vs GREEK CAPITAL OMEGA
 * U+03A9, MICRO SIGN U+00B5 vs GREEK SMALL MU U+03BC) collapse onto one unit
 * definition instead of silently becoming two distinct units.
 */
export const normalizeUnitSymbol = (raw: string): string => raw.normalize('NFC').trim()

export class UnknownUnitError extends PhysicsOSError {
  constructor(unit: string) {
    super('UNKNOWN_UNIT', `Unit "${unit}" is not registered in the PhysicsOS unit registry.`, {
      details: { unit },
    })
    this.name = 'UnknownUnitError'
  }
}

export class DimensionMismatchError extends PhysicsOSError {
  constructor(expected: PhysicalDimension, actual: PhysicalDimension, unit: string) {
    super(
      'DIMENSION_MISMATCH',
      `Unit "${unit}" has dimension "${actual}" but "${expected}" was required.`,
      { details: { expected, actual, unit } },
    )
    this.name = 'DimensionMismatchError'
  }
}

const bySymbol = new Map<string, UnitDefinition>()
const byKey = new Map<UnitKey, UnitDefinition>()
const canonicalByDimension = new Map<PhysicalDimension, UnitDefinition>()

const register = (definition: UnitDefinition): void => {
  if (byKey.has(definition.key)) {
    throw new PhysicsOSError('DUPLICATE_UNIT_KEY', `Unit key "${definition.key}" registered twice.`)
  }
  byKey.set(definition.key, definition)

  const lookups = [definition.symbol, definition.key, ...definition.aliases]
  for (const lookup of lookups) {
    const normalized = normalizeUnitSymbol(lookup)
    const existing = bySymbol.get(normalized)
    if (existing !== undefined && existing.key !== definition.key) {
      throw new PhysicsOSError(
        'AMBIGUOUS_UNIT_SYMBOL',
        `Unit symbol "${normalized}" maps to both "${existing.key}" and "${definition.key}".`,
      )
    }
    bySymbol.set(normalized, definition)
  }

  if (definition.canonical) {
    const existing = canonicalByDimension.get(definition.dimension)
    if (existing !== undefined) {
      throw new PhysicsOSError(
        'DUPLICATE_CANONICAL_UNIT',
        `Dimension "${definition.dimension}" already has canonical unit "${existing.key}".`,
      )
    }
    canonicalByDimension.set(definition.dimension, definition)
  }
}

for (const definition of UNIT_DEFINITIONS) register(definition)

export const findUnit = (unit: string): UnitDefinition | undefined =>
  bySymbol.get(normalizeUnitSymbol(unit))

export const resolveUnit = (unit: string): UnitDefinition => {
  const found = findUnit(unit)
  if (found === undefined) throw new UnknownUnitError(unit)
  return found
}

export const unitByKey = (key: UnitKey): UnitDefinition => {
  const found = byKey.get(key)
  if (found === undefined) throw new UnknownUnitError(key)
  return found
}

export const isKnownUnit = (unit: string): boolean => findUnit(unit) !== undefined

export const canonicalUnitFor = (dimension: PhysicalDimension): UnitDefinition => {
  const found = canonicalByDimension.get(dimension)
  if (found === undefined) {
    throw new PhysicsOSError(
      'MISSING_CANONICAL_UNIT',
      `Dimension "${dimension}" has no canonical SI unit registered.`,
      { details: { dimension } },
    )
  }
  return found
}

export const canonicalSymbolFor = (dimension: PhysicalDimension): string =>
  canonicalUnitFor(dimension).symbol

export const dimensionOf = (unit: string): PhysicalDimension => resolveUnit(unit).dimension

export const assertDimension = (unit: string, expected: PhysicalDimension): UnitDefinition => {
  const definition = resolveUnit(unit)
  if (definition.dimension !== expected) {
    throw new DimensionMismatchError(expected, definition.dimension, unit)
  }
  return definition
}

export const registeredUnits = (): readonly UnitDefinition[] => UNIT_DEFINITIONS
