/**
 * Question taxonomy — the formal question-type grammar.
 *
 * A paper is not "some choice and some calculation"; the standard names the
 * exact families a section may draw from, so a type the profile does not list
 * is a compliance failure, not a style preference. Choice splits
 * single/multiple; Experiment carries the five inquiry variants; Calculation
 * splits single-model / multi-process / comprehensive; ContextualProblem is
 * the standing-applied family.
 */

import {
  isOneOf,
  readNonEmptyArray,
  readObject,
  readOneOf,
  readString,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** Single- vs multiple-answer choice. */
export const CHOICE_TYPES = ['CHOICE_SINGLE', 'CHOICE_MULTIPLE'] as const
export type ChoiceType = (typeof CHOICE_TYPES)[number]

/** Experiment variants: reading, design, data processing, error analysis, inquiry. */
export const EXPERIMENT_TYPES = [
  'INSTRUMENT_READING',
  'EXPERIMENTAL_DESIGN',
  'DATA_PROCESSING',
  'ERROR_ANALYSIS',
  'INQUIRY_EXPERIMENT',
] as const
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number]

/** Calculation variants. */
export const CALCULATION_TYPES = [
  'CALCULATION_SINGLE_MODEL',
  'CALCULATION_MULTI_PROCESS',
  'CALCULATION_COMPREHENSIVE',
] as const
export type CalculationType = (typeof CALCULATION_TYPES)[number]

/** Scenario-anchored problem. */
export const CONTEXTUAL_TYPES = ['CONTEXTUAL_PROBLEM'] as const
export type ContextualType = (typeof CONTEXTUAL_TYPES)[number]

/** Every question type the taxonomy can express. */
export const QUESTION_TYPES = [
  ...CHOICE_TYPES,
  ...EXPERIMENT_TYPES,
  ...CALCULATION_TYPES,
  ...CONTEXTUAL_TYPES,
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

/** The four families a section is grouped under. */
export const QUESTION_CATEGORIES = ['CHOICE', 'EXPERIMENT', 'CALCULATION', 'CONTEXTUAL'] as const
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number]

/** Which family each type belongs to. */
export const QUESTION_CATEGORY_OF = {
  CHOICE_SINGLE: 'CHOICE',
  CHOICE_MULTIPLE: 'CHOICE',
  INSTRUMENT_READING: 'EXPERIMENT',
  EXPERIMENTAL_DESIGN: 'EXPERIMENT',
  DATA_PROCESSING: 'EXPERIMENT',
  ERROR_ANALYSIS: 'EXPERIMENT',
  INQUIRY_EXPERIMENT: 'EXPERIMENT',
  CALCULATION_SINGLE_MODEL: 'CALCULATION',
  CALCULATION_MULTI_PROCESS: 'CALCULATION',
  CALCULATION_COMPREHENSIVE: 'CALCULATION',
  CONTEXTUAL_PROBLEM: 'CONTEXTUAL',
} satisfies Record<QuestionType, QuestionCategory>

/** One listed type, with its human label. */
export interface TaxonomyEntry {
  readonly type: QuestionType
  readonly label: string
  readonly category: QuestionCategory
}

/** The profile's declared taxonomy. */
export interface QuestionTaxonomy {
  readonly id: string
  readonly entries: readonly TaxonomyEntry[]
}

export const isQuestionType = (value: unknown): value is QuestionType =>
  isOneOf(value, QUESTION_TYPES)

/** The family a type belongs to. */
export const categoryOf = (type: QuestionType): QuestionCategory => QUESTION_CATEGORY_OF[type]

/** Whether the taxonomy lists the type. */
export const taxonomyHasType = (taxonomy: QuestionTaxonomy, type: QuestionType): boolean =>
  taxonomy.entries.some((entry) => entry.type === type)

/**
 * Validate a taxonomy value that arrived as external data.
 * @param value - the raw input.
 * @param path - field path for issues.
 */
export function validateQuestionTaxonomy(
  value: unknown,
  path: string,
): ValidationResult<QuestionTaxonomy> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const rawEntries = readNonEmptyArray(record, 'entries', path, issues)
  const entries: TaxonomyEntry[] = []
  rawEntries.forEach((raw, index) => {
    const entryPath = `${path}.entries[${index}]`
    const entry = readObject(raw, entryPath, issues)
    const type = readOneOf(entry, 'type', QUESTION_TYPES, entryPath, issues)
    const label = readString(entry, 'label', entryPath, issues)
    entries.push({ type, label, category: categoryOf(type) })
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, entries } }
}
