import type { IdentityActor } from './identity.ts'

interface ScopedReviewRecord {
  readonly schoolId?: string | null
  readonly status: 'pending' | 'verified' | 'rejected'
}

/**
 * Resolve the persistent tenant scope for newly-created content.
 * @param actor - the server-resolved writer.
 * @returns `null` for platform-owned content, otherwise the actor's school.
 */
export const schoolScopeOf = (actor: IdentityActor): string | null =>
  actor.role === 'SUPER_ADMIN' ? null : actor.schoolId

/**
 * Whether a reader may see one school-scoped Paper record.
 * @param actor - the server-resolved reader.
 * @param record - a row with its persisted school and review state.
 * @returns whether the reader may see this record.
 */
export const canReadPaperRecord = (actor: IdentityActor, record: ScopedReviewRecord): boolean => {
  if (actor.role === 'SUPER_ADMIN') return true
  if (record.schoolId === actor.schoolId) {
    return actor.role !== 'STUDENT' || record.status === 'verified'
  }
  return record.schoolId == null && record.status === 'verified'
}

/**
 * Whether a writer may mutate one school-scoped Paper record.
 * @param actor - the server-resolved writer.
 * @param record - a row with its persisted school scope.
 * @returns whether the writer may mutate this record.
 */
export const canManagePaperRecord = (
  actor: IdentityActor,
  record: { readonly schoolId?: string | null },
): boolean => actor.role === 'SUPER_ADMIN' || record.schoolId === actor.schoolId
