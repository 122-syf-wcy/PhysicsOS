/**
 * Seed tenants for the auth domain. Seeding is additive and idempotent — an
 * existing row wins, so edits made through the admin surface are never
 * clobbered on restart. `PHYSICSOS-OPEN` is the ops tenant the bootstrap
 * SUPER_ADMIN hangs off; the Guizhou roster in {@link GUIZHOU_SCHOOLS} is the
 * fixed tenant list registration resolves against, keyed by a deterministic
 * name hash so every deployment derives the same ids.
 */

import { createHash } from 'node:crypto'
import type { School } from './domain'
import { GUIZHOU_SCHOOLS } from './schools-data.ts'

export const OPEN_SCHOOL_ID = 'PHYSICSOS-OPEN'

/**
 * Deterministic tenant id for a roster name — `gz_` marks a roster seed vs
 * admin-chosen ids (e.g. `SYZX`) or legacy `s_` rows. Identical names map to
 * one tenant everywhere, matching the roster's name-based deduplication.
 */
export const rosterSchoolId = (name: string): string =>
  `gz_${createHash('sha256').update(name, 'utf8').digest('base64url').slice(0, 12)}`

export const SEED_SCHOOLS: readonly Omit<School, 'createdAt' | 'updatedAt'>[] = [
  { id: OPEN_SCHOOL_ID, name: 'PhysicsOS 开放学校', shortName: '开放学校', status: 'active' },
  ...GUIZHOU_SCHOOLS.map(seed => ({
    id: rosterSchoolId(seed.name),
    name: seed.name,
    city: seed.city,
    ...(seed.county !== undefined ? { county: seed.county } : {}),
    status: 'active' as const,
  })),
]

/**
 * Insert seed rows the table lacks. Returns the number inserted so apply()
 * can log a quiet signal.
 * @param put - the schools-table put handle.
 */
export async function seedSchools(
  get: (id: string) => School | undefined | Promise<School | undefined>,
  put: (id: string, school: School) => Promise<void>,
): Promise<number> {
  const now = new Date().toISOString()
  let inserted = 0
  for (const seed of SEED_SCHOOLS) {
    if (await get(seed.id) !== undefined) continue
    await put(seed.id, { ...seed, createdAt: now, updatedAt: now })
    inserted += 1
  }
  return inserted
}
