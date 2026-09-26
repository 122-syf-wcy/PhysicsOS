/**
 * Legacy Harness session/workspace ownership migration.
 *
 * The command consumes an explicit manifest rather than guessing ownership:
 * assigning a learner's private workspace to the wrong account is a data
 * breach, so an unknown or malformed row aborts before the first write.
 */

import { z } from 'zod'
import type { AuthDomain } from './domain.ts'
import { userKey } from './domain.ts'

const MAX_OWNERSHIP_ENTRIES = 10_000

const ownershipEntry = z.object({
  kind: z.enum(['session', 'workspace']),
  resourceId: z.string().min(1).max(256),
  schoolId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
})

const ownershipManifest = z.union([
  z.array(ownershipEntry).max(MAX_OWNERSHIP_ENTRIES),
  z.object({
    ownership: z.array(ownershipEntry).max(MAX_OWNERSHIP_ENTRIES),
  }).transform(value => value.ownership),
])

/** One explicit legacy-resource assignment. */
export type OwnershipMigrationEntry = z.infer<typeof ownershipEntry>

/** One refused assignment; the existing owner is never overwritten. */
export interface OwnershipMigrationConflict {
  readonly kind: OwnershipMigrationEntry['kind']
  readonly resourceId: string
  readonly existingOwner: string
  readonly requestedOwner: string
}

/** Machine-readable command/API result. */
export interface OwnershipMigrationSummary {
  readonly migrated: number
  readonly alreadyOwned: number
  readonly conflicts: readonly OwnershipMigrationConflict[]
}

/**
 * Parse a JSON manifest without performing IO.
 * @param input - parsed JSON value.
 * @returns validated entries.
 */
export function parseOwnershipManifest(input: unknown): OwnershipMigrationEntry[] {
  return ownershipManifest.parse(input)
}

/**
 * Assign missing `api_resources` rows to existing accounts.
 * @param domain - the opened auth domain.
 * @param entries - explicit `kind/resourceId/owner` assignments.
 * @param options - `apply: false` performs a dry run; `now` is injectable for tests.
 * @returns counts plus every conflicting assignment.
 */
export async function migrateLegacyOwnership(
  domain: AuthDomain,
  entries: readonly OwnershipMigrationEntry[],
  options: { apply?: boolean; now?: () => Date } = {},
): Promise<OwnershipMigrationSummary> {
  const parsed = parseOwnershipManifest([...entries])
  const users = domain.table('users')
  const resources = domain.table('api_resources')

  for (const entry of parsed) {
    if (users.get(userKey(entry.schoolId, entry.username)) === undefined) {
      throw new Error(
        `unknown owner ${entry.schoolId}:${entry.username} for ${entry.kind}:${entry.resourceId}`,
      )
    }
  }

  const apply = options.apply !== false
  const now = options.now ?? (() => new Date())
  let migrated = 0
  let alreadyOwned = 0
  const conflicts: OwnershipMigrationConflict[] = []

  for (const entry of parsed) {
    const ownerKey = userKey(entry.schoolId, entry.username)
    const id = `${entry.kind}:${entry.resourceId}`
    const existing = resources.get(id)
    if (existing !== undefined) {
      if (existing.ownerKey === ownerKey) alreadyOwned += 1
      else {
        conflicts.push({
          kind: entry.kind,
          resourceId: entry.resourceId,
          existingOwner: existing.ownerKey,
          requestedOwner: ownerKey,
        })
      }
      continue
    }

    migrated += 1
    if (!apply) continue
    await resources.put(id, {
      id,
      kind: entry.kind,
      resourceId: entry.resourceId,
      ownerKey,
      schoolId: entry.schoolId,
      createdAt: now().toISOString(),
    })
  }

  return { migrated, alreadyOwned, conflicts }
}
