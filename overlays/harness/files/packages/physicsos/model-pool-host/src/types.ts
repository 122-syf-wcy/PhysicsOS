/**
 * Record shapes for the platform model pool.
 *
 * The one invariant worth restating: a key's plaintext exists only inside a
 * request. What the medium holds is an AES-GCM box ({@link SealedSecret}), and
 * the only part ever echoed back to a browser is `tail`.
 */

/** Key lifecycle: `active` serves traffic; `cooldown` is benched until `cooldownUntil`. */
export type KeyStatus = 'active' | 'cooldown'

/** Seal box written to the medium. `tail` is the last four characters, shown to admins. */
export interface SealedSecret {
  readonly iv: string
  readonly tag: string
  readonly data: string
  readonly tail: string
}

/** One upstream endpoint plus the model roster it is allowed to serve. */
export interface ChannelRecord {
  readonly id: string
  readonly name: string
  readonly baseURL: string
  /** Empty = every model the upstream serves; otherwise an allow-list. */
  readonly models: readonly string[]
  /** Lower runs first; the seeded platform fallback sits at the last tier. */
  readonly priority: number
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy: string
}

/** One credential inside a channel, with the counters the console renders. */
export interface KeyRecord {
  readonly id: string
  readonly channelId: string
  readonly label: string
  readonly enabled: boolean
  readonly weight: number
  readonly status: KeyStatus
  /** Consecutive failures; reset by any success or a manual reset. */
  readonly failCount: number
  /** How many times this key has been benched — drives the exponential backoff. */
  readonly cooldownStreak: number
  readonly cooldownUntil: number | null
  readonly lastError: string | null
  readonly lastUsedAt: string | null
  /** Cumulative counters the console turns into a failure rate. */
  readonly requestCount: number
  readonly failureCount: number
  readonly secret: SealedSecret
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy: string
}

/** One attributed admin edit. `detail` holds short `k=v` strings, never key material. */
export interface AuditRecord {
  readonly id: string
  readonly at: string
  readonly actorKey: string
  readonly action: string
  readonly target: string
  readonly detail: readonly string[]
}

/** Deployment-wide routing policy, editable from the console. */
export interface SettingsRecord {
  readonly id: 'settings'
  /** Extra attempts after the first one; the pool never exceeds the candidate count. */
  readonly retryCount: number
  /** Consecutive failures that bench a key. */
  readonly failureThreshold: number
  /** First cooldown; doubles per consecutive cooldown up to `cooldownMaxMs`. */
  readonly cooldownBaseMs: number
  readonly cooldownMaxMs: number
  /** `true` returns a key to service when its cooldown expires; `false` waits for an admin. */
  readonly autoRecover: boolean
  readonly updatedAt: string
  readonly updatedBy: string
}

/** A key as the console sees it — masked, with the derived rate. */
export interface KeyView {
  readonly id: string
  readonly channelId: string
  readonly label: string
  readonly keyTail: string
  readonly enabled: boolean
  readonly weight: number
  readonly status: KeyStatus
  readonly failCount: number
  readonly cooldownUntil: number | null
  readonly lastError: string | null
  readonly lastUsedAt: string | null
  readonly requestCount: number
  readonly failureCount: number
  readonly failureRate: number
  readonly updatedAt: string
  readonly updatedBy: string
}

/** A channel with its keys, as the console lists it. */
export interface ChannelView {
  readonly id: string
  readonly name: string
  readonly baseURL: string
  readonly models: readonly string[]
  readonly priority: number
  readonly enabled: boolean
  readonly updatedAt: string
  readonly updatedBy: string
  readonly keys: readonly KeyView[]
}

/** One-screen summary for the console header. */
export interface PoolStats {
  readonly channels: number
  readonly keys: number
  readonly activeKeys: number
  readonly cooldownKeys: number
  readonly disabledKeys: number
}

/** Everything the 模型通道 tab renders, in one bounded response. */
export interface PoolState {
  readonly settings: SettingsRecord
  readonly channels: readonly ChannelView[]
  readonly stats: PoolStats
  readonly audit: readonly AuditRecord[]
  /** False when the deployment secret is missing — writes refuse, nothing decrypts. */
  readonly encryptionReady: boolean
  readonly proxy: { readonly host: string; readonly port: number }
}

/** The classified outcome of one upstream attempt. */
export interface KeyFailure {
  readonly kind: 'transport' | 'auth' | 'rate-limit' | 'server' | 'client'
  readonly status: number
  /** Short, key-free description for the admin list. */
  readonly message: string
}
