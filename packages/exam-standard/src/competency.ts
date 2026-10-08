/**
 * Competency model — the curriculum's core-competency dimensions.
 *
 * Knowledge tags alone cannot describe why a question is in scope: the
 * standard also names the core competencies (物理观念 / 科学思维 / 科学探究 /
 * 科学态度与责任). A question record carries knowledge + competency +
 * reasoning + representation, so competency can be checked, not just tagged.
 */

import {
  readNonEmptyArray,
  readObject,
  readOneOf,
  readString,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** The four core-competency dimensions. */
export const COMPETENCY_DIMENSIONS = [
  'PHYSICS_CONCEPT',
  'SCIENTIFIC_THINKING',
  'SCIENTIFIC_INQUIRY',
  'SCIENTIFIC_ATTITUDE',
] as const
export type CompetencyDimension = (typeof COMPETENCY_DIMENSIONS)[number]

/** One dimension and its curriculum label. */
export interface CompetencyDimensionEntry {
  readonly dimension: CompetencyDimension
  readonly label: string
}

/** The profile's declared competency model. */
export interface CompetencyModel {
  readonly id: string
  readonly dimensions: readonly CompetencyDimensionEntry[]
}

/** Whether the model names every core dimension. */
export const coversAllDimensions = (model: CompetencyModel): boolean =>
  COMPETENCY_DIMENSIONS.every((dimension) =>
    model.dimensions.some((entry) => entry.dimension === dimension),
  )

/**
 * Validate a competency model value that arrived as external data.
 * @param value - the raw input.
 * @param path - field path for issues.
 */
export function validateCompetencyModel(
  value: unknown,
  path: string,
): ValidationResult<CompetencyModel> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const rawDimensions = readNonEmptyArray(record, 'dimensions', path, issues)
  const dimensions: CompetencyDimensionEntry[] = []
  rawDimensions.forEach((raw, index) => {
    const entryPath = `${path}.dimensions[${index}]`
    const entry = readObject(raw, entryPath, issues)
    const dimension = readOneOf(entry, 'dimension', COMPETENCY_DIMENSIONS, entryPath, issues)
    const label = readString(entry, 'label', entryPath, issues)
    dimensions.push({ dimension, label })
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, dimensions } }
}
