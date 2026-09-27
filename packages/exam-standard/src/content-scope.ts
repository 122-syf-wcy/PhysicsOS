/**
 * Content scope — the 考试范围 (Curriculum Scope).
 *
 * The ministry abolished 考试大纲-style syllabi, so the governor of what may be
 * asked is a *scope*: entries the curriculum covers, plus explicit exclusions.
 * We call it 考试范围 / Curriculum Scope throughout — never 中考大纲. A
 * knowledge tag the scope does not cover (or that is explicitly excluded) is
 * out of scope, and an out-of-scope item is a compliance failure.
 */

import {
  readNonEmptyArray,
  readObject,
  readString,
  readStringArray,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** One covered scope entry and the knowledge tags it licenses. */
export interface ContentScopeEntry {
  readonly id: string
  readonly label: string
  readonly tags: readonly string[]
}

/** The profile's declared content scope. */
export interface ContentScope {
  readonly id: string
  /** Ids of the curriculum-standard sources this scope derives from. */
  readonly standardRefIds: readonly string[]
  readonly entries: readonly ContentScopeEntry[]
  /** Knowledge tags explicitly excluded from the exam. */
  readonly exclusions: readonly string[]
}

/** Whether a knowledge tag is in scope (covered and not excluded). */
export const isKnowledgeInScope = (scope: ContentScope, tag: string): boolean =>
  !scope.exclusions.includes(tag) && scope.entries.some((entry) => entry.tags.includes(tag))

/** The subset of tags that are out of scope. */
export const outOfScopeTags = (scope: ContentScope, tags: readonly string[]): readonly string[] =>
  tags.filter((tag) => !isKnowledgeInScope(scope, tag))

/** Validate a content scope value that arrived as external data. */
export function validateContentScope(value: unknown, path: string): ValidationResult<ContentScope> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const standardRefIds = readStringArray(record, 'standardRefIds', path, issues)
  const exclusions = readStringArray(record, 'exclusions', path, issues)
  const rawEntries = readNonEmptyArray(record, 'entries', path, issues)
  const entries: ContentScopeEntry[] = []
  rawEntries.forEach((raw, index) => {
    const entryPath = `${path}.entries[${index}]`
    const entry = readObject(raw, entryPath, issues)
    const entryId = readString(entry, 'id', entryPath, issues)
    const label = readString(entry, 'label', entryPath, issues)
    const tags = readStringArray(entry, 'tags', entryPath, issues)
    entries.push({ id: entryId, label, tags })
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, standardRefIds, entries, exclusions } }
}
