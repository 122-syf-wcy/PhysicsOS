/** Activity v1 is not the legacy usage/use:view contract. No free-text telemetry. */
export const ACTIVITY_MODULES = ['app', 'home', 'lab', 'canvas', 'whiteboard', 'courseware', 'projects', 'papers', 'community', 'profile', 'sessions'] as const
export type ActivityModule = typeof ACTIVITY_MODULES[number]
import type { ActivityOwner, ActivitySource } from './activity-contract.ts'
export { ACTIVITY_SOURCES } from './activity-contract.ts'
export type { ActivitySource, ActivityOwner, ActivitySuccessCapsule, ActivityDelivery, ActivitySink, ActivityReplaySource } from './activity-contract.ts'
export const ACTIVITY_SOURCE_MODULE: Readonly<Record<ActivitySource, ActivityModule>> = {
  'experiment-run': 'lab', 'canvas-edit': 'canvas', 'whiteboard-edit': 'whiteboard', 'courseware-session': 'courseware',
}
/** Fixed, versioned routing; never create an overflow shard when a bucket fills. */
export const ACTIVITY_SHARDS = 4
/** Timestamp-bearing immutable ids bind client retries to the ORIGINAL day, not receipt time. */
export interface ActivityClientEvent {
  readonly kind: 'visit' | 'open'
  readonly id: string
  readonly pageInstanceId: string
  readonly module: ActivityModule
}
export interface ActivityEventAck { readonly status: 'recorded' | 'duplicate'; readonly occurredAt: string }
export interface ActivityCounts { readonly visits: number; readonly opens: number; readonly uses: number }
export interface ActivityModuleCounts extends ActivityCounts { readonly module: ActivityModule; readonly lastUseAt?: string }
export interface ActivitySchool {
  readonly id: string
  readonly name: string
  readonly status: 'active' | 'disabled'
  readonly mergedInto?: string
  readonly rosterAliasOf?: string
  readonly archivedAt?: string
  readonly reviewState?: string
}
/** A minimal projection, NEVER raw auth rows (password/email/security fields are not accepted). */
export interface ActivityRosterUser extends ActivityOwner {
  readonly username: string
  readonly status: 'active' | 'disabled'
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
  readonly avatarUrl?: string
}
export interface ActivityRoster {
  /** Changes on account/school lifecycle, role, name or avatar mutation; used in permission-scoped cache keys. */
  readonly version: string
  readonly schools: readonly ActivitySchool[]
  readonly users: readonly ActivityRosterUser[]
}
export interface ActivityAvatar { readonly id: string; readonly label: string; readonly path: string }
export interface ActivityAvatarSnapshot {
  readonly asOf: string
  readonly eligibleUsers: number
  readonly adoptedUsers: number
  readonly otherUsers: number
  readonly distribution: readonly { readonly id: string; readonly label: string; readonly path: string; readonly users: number }[]
}
export interface ActivityIntegrity {
  readonly state: 'complete' | 'delayed' | 'incomplete'
  readonly codes: readonly string[]
  readonly pendingReceipts: number
  readonly sources: readonly { readonly source: ActivitySource; readonly caughtUp: boolean; readonly lastCheckedAt?: string }[]
}
export interface ActivityWindow {
  readonly version: 1
  readonly timezone: 'Asia/Shanghai'
  readonly from: string
  readonly to: string
  readonly collectionStartedAt: string | null
  readonly updatedAt: string
  readonly integrity: ActivityIntegrity
  /** Only exact configured exclusions in this actor's visible scope; personal historical detail is not erased. */
  readonly rankingExclusions: { readonly schoolIds: readonly string[]; readonly accounts: readonly { readonly schoolId: string; readonly username: string }[] }
}
export interface ActivityUserDetail extends ActivityWindow, ActivityCounts {
  readonly schoolId: string
  readonly username: string
  readonly lastUseAt?: string
  readonly modules: readonly ActivityModuleCounts[]
}
export interface ActivitySchoolRow extends ActivityCounts {
  /** Competition rank by effective use only; ties are ordered by immutable school id. */
  readonly rank: number
  readonly schoolId: string
  readonly schoolName: string
  readonly activeUsers: number
  readonly lastUseAt?: string
  readonly avatars: ActivityAvatarSnapshot
}
export interface ActivitySchoolRanking extends ActivityWindow {
  readonly scope: 'platform' | 'school'
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly sort: ActivityRankSort
  readonly order: 'asc' | 'desc'
  readonly overview: ActivityCounts & { readonly schools: number; readonly activeUsers: number; readonly adoptedUsers: number }
  readonly rows: readonly ActivitySchoolRow[]
}
export type ActivityRankSort = 'uses' | 'visits' | 'opens' | 'activeUsers' | 'adoptedUsers'
export interface ActivityDateQuery { readonly days?: 1 | 7 | 30 | 90; readonly to?: string }
export interface ActivityRankQuery extends ActivityDateQuery {
  readonly schoolId?: string
  readonly q?: string
  readonly page?: number
  readonly pageSize?: number
  readonly sort?: ActivityRankSort
  readonly order?: 'asc' | 'desc'
}
export interface ActivityLimits {
  readonly maxRows: number
  readonly maxStoredBytes: number
  readonly maxBucketRows: number
  readonly maxReceiptRows: number
  readonly maxBucketBytes: number
  readonly maxEventsPerBucket: number
  readonly maxRequestBytes: number
  readonly maxInFlight: number
  readonly maxQueuedWrites: number
  readonly maxPersistWritesPerMinute: number
  readonly successTimeoutMs: number
  readonly maxClientEventsPerMinute: number
  readonly maxGlobalClientEventsPerMinute: number
  readonly maxRateOwners: number
  readonly maxRosterUsers: number
  readonly maxRosterSchools: number
  readonly maxRosterBytes: number
  readonly maxCacheEntries: number
  readonly maxCacheBytes: number
  readonly cacheTtlMs: number
  readonly maxScanRows: number
  readonly maxScanBytes: number
  readonly maxColdStartMs: number
  readonly maxQueryMs: number
  readonly maxReplayBatch: number
  readonly maxPrunePerPass: number
  readonly requestTimeoutMs: number
  readonly recoveryIntervalMs: number
}
/** Deliberately finite. Exceeding this envelope requires indexed storage, not a larger UI page size. */
export const DEFAULT_ACTIVITY_LIMITS: ActivityLimits = {
  maxRows: 120_000, maxStoredBytes: 96 * 1024 * 1024, maxBucketRows: 90_000, maxReceiptRows: 30_000,
  maxBucketBytes: 64 * 1024, maxEventsPerBucket: 256, maxRequestBytes: 2048,
  maxInFlight: 8, maxQueuedWrites: 128, maxPersistWritesPerMinute: 6000, successTimeoutMs: 3000, maxClientEventsPerMinute: 60, maxGlobalClientEventsPerMinute: 1200,
  maxRateOwners: 4096, maxRosterUsers: 10_000, maxRosterSchools: 2000, maxRosterBytes: 8 * 1024 * 1024,
  maxCacheEntries: 8, maxCacheBytes: 8 * 1024 * 1024, cacheTtlMs: 5000,
  maxScanRows: 120_000, maxScanBytes: 96 * 1024 * 1024, maxColdStartMs: 2000, maxQueryMs: 2000,
  maxReplayBatch: 200, maxPrunePerPass: 1000, requestTimeoutMs: 30_000, recoveryIntervalMs: 30_000,
}
