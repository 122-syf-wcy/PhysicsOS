import type { JsonObject, JsonValue, ParseIssue, ParseResult } from './types.ts'

export class WorkbenchDataError extends Error {
  readonly issues: readonly ParseIssue[]

  constructor(issues: readonly ParseIssue[]) {
    super(issues.map((issue) => `${issue.path || '/'}: ${issue.message}`).join('; '))
    this.name = 'WorkbenchDataError'
    this.issues = issues
  }
}

/** JSON Pointer paths make errors and merge conflicts unambiguous even for keys containing '/'. */
export const pointer = (path: string, key: string | number): string =>
  `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`

export const fail = (path: string, code: string, message: string): never => {
  throw new WorkbenchDataError([{ path, code, message }])
}

/** Rejects objects whose reading could execute code or silently discard non-JSON state. */
export const record = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'object', 'Expected a plain JSON object.')
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, 'prototype', 'Only plain JSON objects are accepted.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail(path, 'symbol', 'Symbol properties are not JSON data.')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return fail(pointer(path, key), 'unsafe-key', 'This property name is not accepted in JSON data.')
    }
    if (!('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      return fail(pointer(path, key), 'accessor', 'Accessor properties are not JSON data.')
    }
    if (!descriptor.enumerable) {
      return fail(pointer(path, key), 'non-enumerable', 'Non-enumerable properties would be lost in JSON.')
    }
  }
  return value as Record<string, unknown>
}

const unicodeString = (value: string, path: string): string => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return fail(path, 'unicode', 'Unpaired UTF-16 surrogates are not accepted.')
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return fail(path, 'unicode', 'Unpaired UTF-16 surrogates are not accepted.')
    }
  }
  return value
}

export const text = (value: unknown, path: string, nonempty = false): string => {
  if (typeof value !== 'string' || (nonempty && value.trim().length === 0)) {
    return fail(path, 'string', nonempty ? 'Expected a non-empty string.' : 'Expected a string.')
  }
  return unicodeString(value, path)
}
export const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(path, 'finite', 'Expected a finite number.')
  }
  return Object.is(value, -0) ? 0 : value
}
export const integer = (value: unknown, path: string, minimum = 0): number => {
  const number = finite(value, path)
  if (!Number.isSafeInteger(number) || number < minimum) {
    return fail(path, 'integer', `Expected a safe integer greater than or equal to ${minimum}.`)
  }
  return number
}
export const positive = (value: unknown, path: string): number => {
  const number = finite(value, path)
  return number > 0 ? number : fail(path, 'positive', 'Expected a positive number.')
}
export const nonnegative = (value: unknown, path: string): number => {
  const number = finite(value, path)
  return number >= 0 ? number : fail(path, 'nonnegative', 'Expected a non-negative number.')
}
export const boolean = (value: unknown, path: string): boolean =>
  typeof value === 'boolean' ? value : fail(path, 'boolean', 'Expected a boolean.')
export const oneOf = <T extends string>(value: unknown, choices: readonly T[], path: string): T => {
  const candidate = text(value, path)
  const choice = choices.find((entry) => entry === candidate)
  return choice === undefined
    ? fail(path, 'enum', `Expected one of ${choices.join(', ')}.`)
    : choice
}
export const array = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(path, 'array', 'Expected an array.')
  if (Object.getPrototypeOf(value) !== Array.prototype) return fail(path, 'prototype', 'Only plain JSON arrays are accepted.')
  if (Object.getOwnPropertySymbols(value).length > 0) return fail(path, 'symbol', 'Array symbols are not JSON data.')
  const names = Object.getOwnPropertyNames(value)
  if (names.some((key) => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || Number(key) >= 0xffffffff))) {
    return fail(path, 'array-property', 'Arrays cannot contain additional properties.')
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return fail(pointer(path, index), 'array-entry', 'Sparse arrays and array accessors are not JSON data.')
    }
  }
  return value as readonly unknown[]
}
export const list = <T>(value: unknown, path: string, parse: (entry: unknown, path: string) => T): T[] =>
  array(value, path).map((entry, index) => parse(entry, pointer(path, index)))
export const optional = <T>(value: unknown, path: string, parse: (entry: unknown, path: string) => T): T | undefined =>
  value === undefined ? undefined : parse(value, path)
export const isoDate = (value: unknown, path: string): string => {
  const candidate = text(value, path, true)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(candidate)
  if (match === null || !Number.isFinite(Date.parse(candidate))) {
    return fail(path, 'date', 'Expected a valid ISO date-time with an explicit time zone.')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(0, 0, 0, 0)
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) {
    return fail(path, 'date', 'Invalid calendar date or time.')
  }
  return candidate
}
export const digest = (value: unknown, path: string): string => {
  const candidate = text(value, path)
  return candidate.length === 64 && /^[a-f0-9]{64}$/.test(candidate)
    ? candidate
    : fail(path, 'digest', 'Expected a 64-character lower-case SHA256 hex digest.')
}
export const exactKeys = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(pointer(path, key), 'unknown-field', 'Unexpected field in this versioned contract.')
  }
}
export const unique = <T>(values: readonly T[], key: (value: T) => string, path: string): void => {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    const identity = key(value)
    if (seen.has(identity)) fail(pointer(path, index), 'duplicate-id', `Duplicate identity '${identity}'.`)
    seen.add(identity)
  })
}

// Provenance is private: Object.freeze on caller data never grants canonical reuse.
const canonicalData = new WeakSet<object>()
const canonicalText = new WeakMap<object, string>()
export interface CanonicalJsonStats {
  readonly bytes: number
  readonly nodes: number
  readonly depth: number
}
const canonicalStats = new WeakMap<object, CanonicalJsonStats>()
const statsEncoder = new TextEncoder()

/** Only values copied, validated, and recursively frozen by this module qualify. */
export const isCanonicalData = (value: unknown): value is JsonObject | readonly JsonValue[] =>
  value !== null && typeof value === 'object' && canonicalData.has(value)

const retainCanonical = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !canonicalData.has(value)) {
    for (const child of Object.values(value)) retainCanonical(child)
    Object.freeze(value)
    canonicalData.add(value)
  }
  return value
}

const copyJson = (
  value: unknown, path: string, ancestors: Set<object>, depth: number,
  omitAbsent = false, reuseCanonical = true,
): JsonValue => {
  if (depth > 512) return fail(path, 'depth', 'JSON nesting exceeds the safe parsing depth.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return unicodeString(value, path)
  if (typeof value === 'number') return finite(value, path)
  if (typeof value !== 'object') return fail(path, 'json', 'Expected JSON data; undefined and executable values are not accepted.')
  if (reuseCanonical && canonicalData.has(value)) return value as JsonObject | readonly JsonValue[]
  if (ancestors.has(value)) return fail(path, 'cycle', 'Cyclic data cannot be serialized.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return array(value, path).map((entry, index) => copyJson(entry, pointer(path, index), ancestors, depth + 1, omitAbsent, reuseCanonical))
    }
    const input = record(value, path)
    const output: Record<string, JsonValue> = {}
    for (const key of Object.keys(input)) {
      unicodeString(key, pointer(path, key))
      const entry = input[key]
      if (omitAbsent && entry === undefined) continue
      output[key] = copyJson(entry, pointer(path, key), ancestors, depth + 1, omitAbsent, reuseCanonical)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

/** Validates the whole value before any typed parser reads it, then detaches caller-owned state. */
export const jsonValue = (input: unknown, path = ''): JsonValue => {
  try {
    return copyJson(input, path, new Set(), 0)
  } catch (error) {
    if (error instanceof WorkbenchDataError) throw error
    return fail(path, 'unsafe-object', 'The input could not be inspected as plain JSON data.')
  }
}
export const jsonObject = (input: unknown, path = ''): JsonObject => {
  const value = jsonValue(input, path)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'object', 'Expected a JSON object.')
  }
  return value as JsonObject
}

/** Copies and freezes domain data in one pass; only our own validated immutable values are reused. */
export const copyJsonObject = (input: unknown): JsonObject => {
  try {
    const value = copyJson(input, '', new Set(), 0, true)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail('', 'object', 'Expected a JSON object.')
    }
    return retainCanonical(value as JsonObject)
  } catch (error) {
    if (error instanceof WorkbenchDataError) throw error
    return fail('', 'unsafe-object', 'The input could not be inspected as plain capture data.')
  }
}
/** Copy/validate first: a caller freeze or asserted TypeScript type never grants canonical provenance. */
export const copyCanonicalData = <T>(input: T): T => retainCanonical(jsonValue(input)) as T

/** Complete occurrence counts are policy-independent; callers reapply their current limits every time. */
export const canonicalJsonStats = (input: unknown): CanonicalJsonStats | undefined => {
  if (!isCanonicalData(input)) return undefined
  const measure = (value: JsonValue): CanonicalJsonStats => {
    if (value === null || typeof value !== 'object') return { bytes: statsEncoder.encode(JSON.stringify(value)).byteLength, nodes: 1, depth: 0 }
    const cached = canonicalStats.get(value)
    if (cached !== undefined) return cached
    const children = Array.isArray(value) ? value : Object.values(value)
    let bytes = 2 + Math.max(0, children.length - 1)
    if (!Array.isArray(value)) for (const key of Object.keys(value)) bytes += statsEncoder.encode(JSON.stringify(key)).byteLength + 1
    let nodes = 1
    let depth = 0
    for (const child of children) {
      const stats = measure(child)
      bytes += stats.bytes; nodes += stats.nodes; depth = Math.max(depth, stats.depth + 1)
    }
    const result = { bytes, nodes, depth }
    canonicalStats.set(value, result)
    return result
  }
  return measure(input)
}
export const parseJsonObject = (input: unknown): ParseResult<JsonObject> => parsed(() => jsonObject(input))

/** Diagnostic-only conversion: non-finite error details become explicit missing reasons, never sample values. */
export const copyDiagnosticObject = (input: unknown): JsonObject => {
  const ancestors = new Set<object>()
  const reading = (value: unknown, path: string, depth: number): JsonValue => {
    if (depth > 512) return fail(path, 'depth', 'Diagnostic nesting exceeds the safe parsing depth.')
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { missing: 'non-finite-diagnostic', value: String(value) }
    }
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') return text(value, path)
    if (typeof value === 'number') return finite(value, path)
    if (typeof value !== 'object') return fail(path, 'json', 'Diagnostic details must be plain data, not executable values.')
    if (ancestors.has(value)) return fail(path, 'cycle', 'Cyclic diagnostic details are not accepted.')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) return array(value, path).map((entry, index) => reading(entry, pointer(path, index), depth + 1))
      const source = record(value, path)
      const output: Record<string, JsonValue> = {}
      for (const [key, entry] of Object.entries(source)) {
        if (entry !== undefined) output[key] = reading(entry, pointer(path, key), depth + 1)
      }
      return output
    } finally {
      ancestors.delete(value)
    }
  }
  try {
    return freezeData(jsonObject(reading(input, '', 0)))
  } catch (error) {
    if (error instanceof WorkbenchDataError) throw error
    return fail('', 'unsafe-object', 'The diagnostic details could not be inspected as plain data.')
  }
}

/** Does not invoke toJSON, normalize text, drop unknown values, or reorder arrays. */
export const canonicalStringify = (input: unknown): string => {
  const owned = isCanonicalData(input)
  if (owned) {
    const cached = canonicalText.get(input)
    if (cached !== undefined) return cached
  }
  const emit = (value: JsonValue): string => {
    if (value === null) return 'null'
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`
    const object = value as JsonObject
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${emit(object[key]!)}`).join(',')}}`
  }
  const text = emit(jsonValue(input))
  if (owned) canonicalText.set(input, text)
  return text
}
export const canonicalBytes = (input: unknown): Uint8Array => new TextEncoder().encode(canonicalStringify(input))
export const canonicalByteLength = (input: unknown): number => canonicalBytes(input).byteLength

export const freezeData = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child)
    Object.freeze(value)
  }
  return value
}
export const cloneData = <T>(value: T): T => {
  const json = jsonValue(value)
  return json as T
}
export const parsed = <T>(parse: () => T): ParseResult<T> => {
  try {
    return { ok: true, value: freezeData(parse()) }
  } catch (error) {
    if (error instanceof WorkbenchDataError) return { ok: false, issues: error.issues }
    throw error
  }
}
export const unwrap = <T>(result: ParseResult<T>): T => {
  if (result.ok) return result.value
  throw new WorkbenchDataError(result.issues)
}
