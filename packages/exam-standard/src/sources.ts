/**
 * Official source provenance.
 *
 * Every rule an exam profile carries must point at the official document it
 * derives from, with the issuing authority, issue date and validity window.
 * The engine never asserts a rule without this reference — that is the whole
 * difference between "the model feels like a Guizhou paper" and a governed
 * standard. This module defines the reference shapes only; it ships no real
 * document metadata.
 */

import {
  readObject,
  readOneOf,
  readOptionalString,
  readString,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** Bodies that can issue binding exam standards. */
export const OFFICIAL_AUTHORITIES = [
  'MOE',
  'GZ_EDUCATION_DEPARTMENT',
  'GZ_EXAMINATION_AUTHORITY',
] as const
export type OfficialAuthority = (typeof OFFICIAL_AUTHORITIES)[number]

/** What part of the standard a source governs. */
export const OFFICIAL_SOURCE_SCOPES = [
  'CURRICULUM',
  'EXAM_POLICY',
  'PAPER_STRUCTURE',
  'SCORING',
  'ANSWER_FORMAT',
] as const
export type OfficialSourceScope = (typeof OFFICIAL_SOURCE_SCOPES)[number]

/** A lightweight reference to a standard document (e.g. a curriculum standard). */
export interface SourceRef {
  readonly id: string
  readonly title: string
  readonly sourceUrl?: string
}

/**
 * A full official source: authority, dates, URL and the scope it governs.
 * `effectiveTo` absent means "still in force"; `effectiveFrom` absent means
 * "from the `issuedAt` date".
 */
export interface OfficialSourceRef {
  readonly id: string
  readonly authority: OfficialAuthority
  readonly title: string
  readonly issuedAt: string
  readonly effectiveFrom?: string
  readonly effectiveTo?: string
  readonly sourceUrl: string
  readonly scope: OfficialSourceScope
}

/** Validate a lightweight source reference. */
export function validateSourceRef(value: unknown, path: string): ValidationResult<SourceRef> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const title = readString(record, 'title', path, issues)
  const sourceUrl = readOptionalString(record, 'sourceUrl', path, issues)
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, title, sourceUrl } }
}

/**
 * Narrow an external value into an {@link OfficialSourceRef}.
 * @param value - the raw input.
 * @param path - the field path, for the issues we may return.
 */
export function validateOfficialSourceRef(
  value: unknown,
  path: string,
): ValidationResult<OfficialSourceRef> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const authority = readOneOf(record, 'authority', OFFICIAL_AUTHORITIES, path, issues)
  const title = readString(record, 'title', path, issues)
  const issuedAt = readString(record, 'issuedAt', path, issues)
  const effectiveFrom = readOptionalString(record, 'effectiveFrom', path, issues)
  const effectiveTo = readOptionalString(record, 'effectiveTo', path, issues)
  const sourceUrl = readString(record, 'sourceUrl', path, issues)
  const scope = readOneOf(record, 'scope', OFFICIAL_SOURCE_SCOPES, path, issues)
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, authority, title, issuedAt, effectiveFrom, effectiveTo, sourceUrl, scope } }
}
