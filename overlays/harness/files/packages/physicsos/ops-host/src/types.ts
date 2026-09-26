/** Stable JSON shapes exposed by the administrator operations endpoint. */

export type OpsHealthStatus = 'ok' | 'warning' | 'critical'
export type OpsAlertSeverity = 'warning' | 'critical'

export interface OpsDiskUsage {
  readonly path: string
  readonly totalBytes: number
  readonly freeBytes: number
  readonly availableBytes: number
  readonly usedBytes: number
  readonly usedPercent: number
  readonly available: boolean
}

export interface OpsDirectoryUsage {
  readonly path: string
  readonly bytes: number
  readonly entries: number
  readonly partial: boolean
}

export interface OpsBytesUsage {
  readonly bytes: number
  readonly available: boolean
  readonly partial: boolean
}

export interface OpsProbe {
  readonly ok: boolean
  readonly latencyMs?: number
  readonly code?: string
}

export interface OpsPostgresProbe extends OpsProbe {
  readonly sizeBytes?: number
  readonly sessions?: {
    readonly live: number
    readonly distinctUsers: number
  }
  readonly accounts?: {
    readonly total: number
    readonly active: number
    readonly disabled: number
  }
}

export interface OpsRedisProbe extends OpsProbe {
  readonly usedMemoryBytes?: number
}

export interface OpsAlert {
  readonly severity: OpsAlertSeverity
  readonly code: string
  readonly message: string
}

export interface OpsMetrics {
  readonly cache: {
    readonly ttlMs: number
    readonly hit: boolean
    readonly collectedAt: string
    readonly partial: boolean
  }
  readonly disk: {
    readonly thresholds: {
      readonly warningPercent: number
      readonly criticalPercent: number
    }
    readonly root: OpsDiskUsage
    readonly data: OpsDiskUsage
    readonly breakdown: {
      readonly sessions: OpsDirectoryUsage
      readonly workspaces: OpsDirectoryUsage
      readonly postgres: OpsBytesUsage
      readonly redis: OpsBytesUsage
    }
    readonly partial: boolean
  }
  readonly health: {
    readonly status: OpsHealthStatus
    readonly uptimeSeconds: number
    readonly node: {
      readonly version: string
      readonly platform: string
      readonly arch: string
    }
    readonly postgres: OpsPostgresProbe
    readonly redis: OpsRedisProbe
    readonly sessions: {
      readonly live: number
      readonly distinctUsers: number
    }
    readonly accounts: {
      readonly total: number
      readonly active: number
      readonly disabled: number
    }
  }
  readonly alerts: readonly OpsAlert[]
  readonly partial: boolean
}

/** Result of one bounded directory traversal. */
export interface DirectoryScanResult {
  readonly bytes: number
  readonly entries: number
  readonly partial: boolean
}

export interface DirectoryScanLimits {
  readonly maxEntries: number
  readonly maxDepth: number
}

export interface StatfsLike {
  readonly bsize: number
  readonly blocks: number
  readonly bfree: number
  readonly bavail: number
}
