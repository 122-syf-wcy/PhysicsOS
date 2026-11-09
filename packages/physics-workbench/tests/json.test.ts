import { describe, expect, it } from 'vitest'

import {
  canonicalByteLength, canonicalBytes, canonicalStringify, copyDiagnosticObject, copyJsonObject,
  jsonValue, parseJsonObject, WorkbenchDataError,
} from '../src/json.ts'

describe('canonical JSON and safe plain data', () => {
  it('sorts object keys, preserves arrays and text, and measures UTF-8 bytes', () => {
    const value = { z: ['温度', 0.0000001, Number.MIN_VALUE], a: { second: 2, first: -0 } }
    const canonical = canonicalStringify(value)
    expect(canonical).toBe('{"a":{"first":0,"second":2},"z":["温度",1e-7,5e-324]}')
    expect(canonicalStringify(JSON.parse(canonical))).toBe(canonical)
    expect(canonicalBytes(value)).toEqual(new TextEncoder().encode(canonical))
    expect(canonicalByteLength(value)).toBe(new TextEncoder().encode(canonical).byteLength)
    expect(canonicalByteLength(value)).toBeGreaterThan(canonical.length)
    expect(canonicalStringify({ value: 'é' })).not.toBe(canonicalStringify({ value: 'é' }))
  })

  it('does not invoke accessors, toJSON, or inherited array behavior', () => {
    let reads = 0
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { reads += 1; return 1 } })
    expect(() => canonicalStringify(accessor)).toThrow(WorkbenchDataError)
    expect(reads).toBe(0)
    expect(() => canonicalStringify({ toJSON() { reads += 1; return {} } })).toThrow(WorkbenchDataError)
    expect(reads).toBe(0)
    class ReadingArray extends Array<number> {}
    expect(() => canonicalStringify(new ReadingArray(1, 2))).toThrow(WorkbenchDataError)
  })

  it('rejects non-JSON values in every nested location', () => {
    const invalid: readonly unknown[] = [
      NaN, Infinity, -Infinity, undefined, 1n, () => 1, Symbol('reading'),
      { nested: { value: Infinity } }, { value: undefined }, [undefined], new Date(), new Map(),
      '\ud800', '\udc00',
    ]
    for (const value of invalid) expect(() => jsonValue(value)).toThrow(WorkbenchDataError)
    const sparse = new Array<number>(2)
    sparse[1] = 3
    expect(() => jsonValue(sparse)).toThrow(WorkbenchDataError)
    const additional = [1, 2]
    Object.defineProperty(additional, '4294967295', { enumerable: true, value: () => 4 })
    expect(() => jsonValue(additional)).toThrow(WorkbenchDataError)
    const symbol = { value: 1, [Symbol('hidden')]: 2 }
    expect(() => jsonValue(symbol)).toThrow(WorkbenchDataError)
    const hidden = Object.defineProperty({ value: 1 }, 'other', { value: 2 })
    expect(() => jsonValue(hidden)).toThrow(WorkbenchDataError)
  })

  it('rejects cycles and unsafe property names without losing the source', () => {
    const cyclic: { value: number; child?: object } = { value: 4 }
    cyclic.child = cyclic
    expect(() => canonicalStringify(cyclic)).toThrow(WorkbenchDataError)
    expect(cyclic.child).toBe(cyclic)
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(parseJsonObject(JSON.parse(`{"${key}":{"value":1}}`)).ok).toBe(false)
    }
  })

  it('copies optional typed domain fields without replacing missing data by zero', () => {
    const source = { reading: 17.123456789012345, currentState: { phase: 'liquid', optional: undefined }, comparisonState: undefined }
    const copy = copyJsonObject(source)
    expect(copy).toEqual({ reading: 17.123456789012345, currentState: { phase: 'liquid' } })
    source.currentState.phase = 'solid'
    expect(copy.currentState).toEqual({ phase: 'liquid' })
    expect(Object.isFrozen(copy)).toBe(true)
    expect(Object.isFrozen(copy.currentState)).toBe(true)
    expect(parseJsonObject(source).ok).toBe(false)
    expect(() => copyJsonObject({ samples: [1, undefined] })).toThrow(WorkbenchDataError)
    expect(() => copyJsonObject({ sampleReadout: () => [] })).toThrow(WorkbenchDataError)
  })

  it('preserves non-finite diagnostic reasons without permitting non-finite raw measurements', () => {
    const diagnostic = copyDiagnosticObject({ code: 'LEVER_DEGENERATE_INERTIA', retryable: false,
      details: { momentOfInertia: Infinity, evaluated: -Infinity, residual: NaN, mass: 2, optional: undefined } })
    expect(diagnostic).toEqual({ code: 'LEVER_DEGENERATE_INERTIA', retryable: false,
      details: { momentOfInertia: { missing: 'non-finite-diagnostic', value: 'Infinity' },
        evaluated: { missing: 'non-finite-diagnostic', value: '-Infinity' },
        residual: { missing: 'non-finite-diagnostic', value: 'NaN' }, mass: 2 } })
    expect(Object.isFrozen(diagnostic)).toBe(true)
    expect(() => copyJsonObject({ measurement: Infinity })).toThrow(WorkbenchDataError)
    expect(() => copyDiagnosticObject({ details: { callback: () => 1 } })).toThrow(WorkbenchDataError)
    expect(() => copyDiagnosticObject({ details: [undefined] })).toThrow(WorkbenchDataError)
  })

  it('accepts a repeated noncyclic value by copying both occurrences', () => {
    const shared = { value: 3 }
    const copy = jsonValue({ left: shared, right: shared })
    expect(copy).toEqual({ left: { value: 3 }, right: { value: 3 } })
  })
})
