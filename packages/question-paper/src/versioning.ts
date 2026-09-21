/**
 * Version identity — a paper version is bound by the SHA-256 of its
 * canonical document JSON. Approvals reference this hash; any later edit
 * produces a different one and thereby voids the approval automatically.
 */

import { createHash } from 'node:crypto'
import type { PaperDocument } from './paper.ts'

/** JSON.stringify with sorted object keys — the canonical form we hash. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The canonical string form of a document — stable across key insertion
 * order, so equal documents hash equally.
 * @param doc - the document version to canonicalize.
 * @returns the canonical JSON text.
 */
export function canonicalDocument(doc: PaperDocument): string {
  /* Review workflow fields are metadata, not content: marking a question
     approved/rejected or annotating it must not change the version hash —
     only an actual content edit should void approvals. Strip them per item. */
  const content = {
    ...doc,
    sections: doc.sections.map(section => ({
      ...section,
      items: section.items.map(({ status: _status, reviewNote: _reviewNote, ...item }) => item),
    })),
  }
  return canonicalize(content)
}

/**
 * Hash one document version.
 * @param doc - the document version.
 * @returns lowercase hex SHA-256 of the canonical JSON.
 */
export function documentHash(doc: PaperDocument): string {
  return createHash('sha256').update(canonicalDocument(doc), 'utf8').digest('hex')
}

/**
 * The dedupe fingerprint of a question stem: case-folded, whitespace- and
 * punctuation-stripped, full-width digits/letters folded to half-width, so
 * the same question re-pasted from another site hashes equally while a
 * genuinely different question does not.
 * @param stem - raw question text (LaTeX tolerated).
 * @returns lowercase hex SHA-256 of the normalized stem.
 */
export function stemFingerprint(stem: string): string {
  const normalized = stem
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/[，。；：、（）【】《》「」‘’“”.,;:!?'""''()\-—_·…]/g, '')
    .toLowerCase()
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24)
}
