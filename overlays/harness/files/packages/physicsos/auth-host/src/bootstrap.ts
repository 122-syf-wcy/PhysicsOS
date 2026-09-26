/**
 * Bootstrap admin seeding — the only code path that can mint a SUPER_ADMIN.
 * Credentials arrive via plugin config (deployment env), never via the wire;
 * seeding is idempotent so a restart never rotates or duplicates the account.
 */

import crypto from 'node:crypto'
import type { AuthDomain, UserRecord } from './domain.ts'
import { userKey } from './domain.ts'
import { hashPassword } from './passwords.ts'

/** One config-supplied admin entry (post-validation shape). */
export interface BootstrapAdmin {
  /** Tenant the admin belongs to; a stub school row is created when the id is not among the seeded tenants. */
  schoolId: string
  /** Login name inside that tenant — the account key is `schoolId:username`. */
  username: string
  /** Initial plaintext password from deployment config; stored only as its argon2id hash. */
  password: string
  /** Display name shown on admin surfaces. */
  displayName: string
  /** Platform-wide or single-school scope; no other role is seedable. */
  role: 'SUPER_ADMIN' | 'SCHOOL_ADMIN'
}

/**
 * Ensure each configured admin exists under its tenant, creating a stub school
 * row when the id is not among the seeded tenants. Existing accounts are left
 * untouched — an operator rotates a bootstrap password by editing the store
 * or the account, not by restarting.
 * @param domain - the opened auth domain.
 * @param admins - validated `bootstrapAdmins` config entries.
 * @returns how many accounts were created this boot.
 */
export async function seedBootstrapAdmins(
  domain: AuthDomain, admins: readonly BootstrapAdmin[],
): Promise<number> {
  let created = 0
  for (const admin of admins) {
    const now = new Date().toISOString()
    if (domain.table('schools').get(admin.schoolId) === undefined) {
      await domain.table('schools').put(admin.schoolId, {
        id: admin.schoolId,
        name: admin.schoolId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
    }
    const key = userKey(admin.schoolId, admin.username)
    if (domain.table('users').get(key) !== undefined) continue
    const record: UserRecord = {
      id: `u_${crypto.randomBytes(9).toString('base64url')}`,
      schoolId: admin.schoolId,
      username: admin.username.toLowerCase(),
      passwordHash: hashPassword(admin.password),
      displayName: admin.displayName,
      role: admin.role,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await domain.table('users').put(key, record)
    created += 1
  }
  return created
}
