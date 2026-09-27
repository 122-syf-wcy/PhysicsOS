/**
 * Minimal runtime validation primitives — the pack trust boundary.
 *
 * A future Exam Standard Pack is authored from *external* data (official
 * documents, transcripts of policy notices), so it arrives as `unknown` and is
 * narrowed here before it becomes an {@link ExamStandardPack}. TypeScript types
 * cannot prove that external data is trustworthy; these guards and readers, not
 * casts, are where a pack becomes trusted.
 *
 * The `read*` readers follow one rule: on a bad field they push an issue and
 * return a harmless placeholder. The caller builds the typed value
 * optimistically and discards it whenever `issues.length > 0`, so a value is
 * only ever trusted when every field read clean. This keeps validators free of
 * `as`, `!` and hand-rolled undefined chains.
 */

/** One rejected field, addressed by its path inside the input object. */
export interface ValidationIssue {
  readonly path: string
  readonly message: string
}

/** Parse-don't-validate result: either a trusted value or the reasons we refused. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }

/** One issue, no value. */
export const issue = (path: string, message: string): ValidationIssue => ({ path, message })

/** A non-null, non-array object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string with at least one non-whitespace character. */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** Any finite number (rejects NaN and ±Infinity). */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A finite, positive number. */
export const isPositiveNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0

/** A finite, non-negative integer. */
export const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0

/** An array whose every element is a string. */
export const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** An array of as-yet-unknown elements (narrows to `unknown[]`, unlike `Array.isArray`). */
export const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

/** Membership test that narrows an `unknown` to one of the tuple's members. */
export const isOneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T => typeof value === 'string' && allowed.some((member) => member === value)

/** Read a nested value as a record; push an issue and return `{}` when it is not one. */
export const readRecord = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): Record<string, unknown> => readObject(source[key], `${path}.${key}`, issues)

/** Read a top-level value as a record; push an issue and return `{}` when it is not one. */
export const readObject = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Record<string, unknown> => {
  if (isRecord(value)) return value
  issues.push(issue(path, '必须是对象'))
  return {}
}

/** Read a required non-empty string. */
export const readString = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string => {
  const raw = source[key]
  if (isNonEmptyString(raw)) return raw
  issues.push(issue(`${path}.${key}`, '必须是非空字符串'))
  return ''
}

/** Read an optional non-empty string. */
export const readOptionalString = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined => {
  const raw = source[key]
  if (raw === undefined) return undefined
  if (isNonEmptyString(raw)) return raw
  issues.push(issue(`${path}.${key}`, '如果存在必须是非空字符串'))
  return undefined
}

/** Read a required finite, positive number. */
export const readPositiveNumber = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number => {
  const raw = source[key]
  if (isPositiveNumber(raw)) return raw
  issues.push(issue(`${path}.${key}`, '必须是正数'))
  return 0
}

/** Read a required non-negative integer (a count). */
export const readCount = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number => {
  const raw = source[key]
  if (isNonNegativeInteger(raw)) return raw
  issues.push(issue(`${path}.${key}`, '必须是非负整数'))
  return 0
}

/** Read a required boolean. */
export const readBoolean = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean => {
  const raw = source[key]
  if (typeof raw === 'boolean') return raw
  issues.push(issue(`${path}.${key}`, '必须是布尔值'))
  return false
}

/** Read a required member of a non-empty tuple of allowed values. */
export const readOneOf = <T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly [T, ...T[]],
  path: string,
  issues: ValidationIssue[],
): T => {
  const raw = source[key]
  if (isOneOf(raw, allowed)) return raw
  issues.push(issue(`${path}.${key}`, `必须是 ${allowed.join(' | ')} 之一`))
  return allowed[0]
}

/** Read a required array of unknown elements. */
export const readArray = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly unknown[] => {
  const raw = source[key]
  if (isUnknownArray(raw)) return raw
  issues.push(issue(`${path}.${key}`, '必须是数组'))
  return []
}

/** Read a required non-empty array of unknown elements. */
export const readNonEmptyArray = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly unknown[] => {
  const raw = source[key]
  if (isUnknownArray(raw) && raw.length > 0) return raw
  issues.push(issue(`${path}.${key}`, '必须是非空数组'))
  return []
}

/** Read a required array of strings. */
export const readStringArray = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] => {
  const raw = source[key]
  if (isStringArray(raw)) return raw
  issues.push(issue(`${path}.${key}`, '必须是字符串数组'))
  return []
}
