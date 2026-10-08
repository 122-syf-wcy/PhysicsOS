/**
 * The pack registry and profile resolution.
 *
 * {@link createExamStandardRegistry} returns a registry with **no populated
 * real pack**. Resolution by `(jurisdiction, stage, subject, year)` either
 * finds exactly one confirmed pack, or returns an explicit `UNCONFIRMED` state
 * naming *why* — never a defaulted profile. Ambiguity (two confirmed packs for
 * the same target) is refused, not silently ordered. The stage is part of the
 * key, so a 中考 query can never cross into a 高考 pack.
 */

import {
  EXAM_STAGES,
  SUBJECTS,
  targetKey,
  type ExamProfile,
  type ProfileTarget,
} from './profile.ts'
import { isConfirmedPack, validatePack, type ConfirmedPack, type ExamStandardPack } from './pack.ts'
import { isOneOf, type ValidationResult } from './validate.ts'

/** A profile lookup: the four-part identity. */
export type ProfileQuery = ProfileTarget

/** Why resolution could not produce a confirmed profile. */
export type UnconfirmedCode =
  | 'INVALID_QUERY'
  | 'NO_PACK_REGISTERED'
  | 'NO_PACK_FOR_TARGET'
  | 'YEAR_NOT_AVAILABLE'
  | 'PACK_NOT_CONFIRMED'
  | 'AMBIGUOUS_PACK'

/** Outcome of resolving a query. */
export type ProfileResolution =
  | { readonly status: 'CONFIRMED'; readonly pack: ConfirmedPack; readonly profile: ExamProfile }
  | {
      readonly status: 'UNCONFIRMED'
      readonly code: UnconfirmedCode
      readonly reason: string
      readonly requested: ProfileQuery
      /** Years that do exist for the requested jurisdiction/stage/subject. */
      readonly availableYears: readonly number[]
    }

/** The registry surface. */
export interface ExamStandardRegistry {
  /** Validate and add a pack; returns the parse result. */
  readonly register: (input: unknown) => ValidationResult<ExamStandardPack>
  /** A snapshot of the registered packs. */
  readonly packs: () => readonly ExamStandardPack[]
  /** Resolve a profile query, or report why it cannot. */
  readonly resolve: (query: ProfileQuery) => ProfileResolution
}

const unconfirmed = (
  code: UnconfirmedCode,
  reason: string,
  requested: ProfileQuery,
  availableYears: readonly number[],
): ProfileResolution => ({ status: 'UNCONFIRMED', code, reason, requested, availableYears })

/** Resolve a query against a fixed pack list. */
export function resolveFromPacks(
  packs: readonly ExamStandardPack[],
  query: ProfileQuery,
): ProfileResolution {
  if (
    !isOneOf(query.stage, EXAM_STAGES) ||
    !isOneOf(query.subject, SUBJECTS) ||
    typeof query.jurisdiction !== 'string' ||
    query.jurisdiction.trim().length === 0 ||
    !Number.isInteger(query.year)
  ) {
    return unconfirmed('INVALID_QUERY', '查询目标不合法', query, [])
  }
  if (packs.length === 0) {
    return unconfirmed('NO_PACK_REGISTERED', '尚未登记任何考试标准档案包', query, [])
  }
  const forTarget = packs.filter(
    (pack) =>
      pack.jurisdiction === query.jurisdiction &&
      pack.stage === query.stage &&
      pack.subject === query.subject,
  )
  if (forTarget.length === 0) {
    return unconfirmed('NO_PACK_FOR_TARGET', `没有对应 ${targetKey(query)} 的档案包`, query, [])
  }
  const availableYears = [...new Set(forTarget.map((pack) => pack.year))].sort((a, b) => a - b)
  const forYear = forTarget.filter((pack) => pack.year === query.year)
  if (forYear.length === 0) {
    return unconfirmed('YEAR_NOT_AVAILABLE', `${query.year} 年暂无档案包`, query, availableYears)
  }
  const confirmed = forYear.filter(isConfirmedPack)
  if (confirmed.length === 0) {
    return unconfirmed('PACK_NOT_CONFIRMED', '该年度档案包尚未确认，拒绝出卷', query, availableYears)
  }
  if (confirmed.length > 1) {
    return unconfirmed('AMBIGUOUS_PACK', '该目标存在多个已确认档案包，需人工消歧', query, availableYears)
  }
  const pack = confirmed.find(() => true)
  if (pack === undefined) {
    return unconfirmed('PACK_NOT_CONFIRMED', '该年度档案包尚未确认，拒绝出卷', query, availableYears)
  }
  return { status: 'CONFIRMED', pack, profile: pack.profile }
}

/**
 * Create a registry. `initial` seeds are validated up front; an invalid seed
 * throws, so a malformed data file fails loudly at startup rather than becoming
 * a silently-ignored pack.
 */
export function createExamStandardRegistry(
  initial: readonly unknown[] = [],
): ExamStandardRegistry {
  const packs: ExamStandardPack[] = []
  initial.forEach((input, index) => {
    const result = validatePack(input)
    if (!result.ok) {
      const detail = result.issues.map((item) => `${item.path}: ${item.message}`).join('; ')
      throw new Error(`考试标准档案包种子 [${index}] 校验失败：${detail}`)
    }
    packs.push(result.value)
  })
  return {
    register(input) {
      const result = validatePack(input)
      if (result.ok) packs.push(result.value)
      return result
    },
    packs() {
      return [...packs]
    },
    resolve(query) {
      return resolveFromPacks(packs, query)
    },
  }
}

/**
 * The process-wide registry. Ships empty: there is no populated real pack, so
 * every resolve returns `UNCONFIRMED` until a Guizhou pack is authored from
 * official documents and registered.
 */
export const examStandardRegistry: ExamStandardRegistry = createExamStandardRegistry()
