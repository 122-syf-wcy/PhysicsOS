/**
 * Exam Standard Pack — the unit of extension, as data.
 *
 * A pack binds one `(jurisdiction, stage, subject, year)` to a confirmed
 * {@link ExamProfile} and the official sources it derives from. The registry
 * ships with *no* populated real pack: the engine is a resolver plus
 * validation, so adding Guizhou 2026 later is a data task driven by official
 * documents, not a code change. A pack only becomes resolvable once its review
 * status is `CONFIRMED` *and* it carries a profile — there is no single
 * boolean, and no confirmed pack without a validated profile.
 */

import {
  EXAM_STAGES,
  SUBJECTS,
  validateExamProfile,
  type ExamProfile,
  type ExamStage,
  type Jurisdiction,
  type Subject,
} from './profile.ts'
import { validateOfficialSourceRef, type OfficialSourceRef } from './sources.ts'
import {
  issue,
  readArray,
  readCount,
  readObject,
  readOneOf,
  readOptionalString,
  readString,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** Review lifecycle of a pack. Only `CONFIRMED` is resolvable. */
export const PACK_REVIEW_STATUSES = ['CONFIRMED', 'DRAFT', 'PENDING_REVIEW'] as const
export type PackReviewStatus = (typeof PACK_REVIEW_STATUSES)[number]

/** One versioned standard for one exam target. */
export interface ExamStandardPack {
  readonly id: string
  readonly version: string
  readonly reviewStatus: PackReviewStatus
  readonly jurisdiction: Jurisdiction
  readonly stage: ExamStage
  readonly subject: Subject
  readonly year: number
  readonly sources: readonly OfficialSourceRef[]
  /** Absent until the pack is authored; required for `CONFIRMED`. */
  readonly profile: ExamProfile | null
  readonly notes?: string
}

/** A pack that has passed review and carries a profile — safe to resolve. */
export interface ConfirmedPack extends ExamStandardPack {
  readonly profile: ExamProfile
}

/** `id@version` — the pack's stable identity. */
export const packIdentity = (pack: ExamStandardPack): string => `${pack.id}@${pack.version}`

/** Whether a pack may be resolved (confirmed and carrying a profile). */
export const isConfirmedPack = (pack: ExamStandardPack): pack is ConfirmedPack =>
  pack.reviewStatus === 'CONFIRMED' && pack.profile !== null

/**
 * Cross-field integrity of a typed pack: a confirmed pack must carry a profile
 * and sources, and the profile's target must match the pack's.
 */
export function packIssues(pack: ExamStandardPack): readonly string[] {
  const issues: string[] = []
  if (pack.reviewStatus === 'CONFIRMED') {
    if (pack.profile === null) issues.push('已确认的档案包必须包含档案')
    if (pack.sources.length === 0) issues.push('已确认的档案包必须包含官方来源')
  }
  const profile = pack.profile
  if (profile !== null) {
    if (
      profile.jurisdiction !== pack.jurisdiction ||
      profile.stage !== pack.stage ||
      profile.subject !== pack.subject ||
      profile.year !== pack.year
    ) {
      issues.push('档案包与档案的考试目标不一致')
    }
  }
  return issues
}

/** Validate a pack value that arrived as external data. */
export function validatePack(value: unknown): ValidationResult<ExamStandardPack> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, 'pack', issues)
  const id = readString(record, 'id', 'pack', issues)
  const version = readString(record, 'version', 'pack', issues)
  const reviewStatus = readOneOf(record, 'reviewStatus', PACK_REVIEW_STATUSES, 'pack', issues)
  const jurisdiction = readString(record, 'jurisdiction', 'pack', issues)
  const stage = readOneOf(record, 'stage', EXAM_STAGES, 'pack', issues)
  const subject = readOneOf(record, 'subject', SUBJECTS, 'pack', issues)
  const year = readCount(record, 'year', 'pack', issues)
  const notes = readOptionalString(record, 'notes', 'pack', issues)

  const sources: OfficialSourceRef[] = []
  readArray(record, 'sources', 'pack', issues).forEach((raw, index) => {
    const result = validateOfficialSourceRef(raw, `pack.sources[${index}]`)
    if (result.ok) sources.push(result.value)
    else for (const item of result.issues) issues.push(item)
  })

  let profile: ExamProfile | null = null
  const rawProfile = record['profile']
  if (rawProfile === undefined || rawProfile === null) {
    profile = null
  } else {
    const result = validateExamProfile(rawProfile, 'pack.profile')
    if (result.ok) profile = result.value
    else for (const item of result.issues) issues.push(item)
  }

  if (issues.length > 0) return { ok: false, issues }
  const pack: ExamStandardPack = {
    id,
    version,
    reviewStatus,
    jurisdiction,
    stage,
    subject,
    year,
    sources,
    profile,
    notes,
  }
  const structural = packIssues(pack)
  if (structural.length > 0) {
    return { ok: false, issues: structural.map((message) => issue('pack', message)) }
  }
  return { ok: true, value: pack }
}
