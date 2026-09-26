import type {
  DirectoryScanResult,
  OpsAlert,
  OpsBytesUsage,
  OpsDirectoryUsage,
  OpsDiskUsage,
  OpsMetrics,
  OpsPostgresProbe,
  OpsRedisProbe,
} from './types.ts'

export interface OpsPaths {
  readonly root: string
  readonly data: string
  readonly sessions: string
  readonly workspaces: string
}

export interface OpsThresholds {
  readonly diskWarningPercent: number
  readonly diskCriticalPercent: number
}

export interface OpsCollectorDependencies {
  readonly now?: () => number
  readonly paths: OpsPaths
  readonly thresholds: OpsThresholds
  readonly readDiskUsage: (path: string) => Promise<OpsDiskUsage>
  readonly scanDirectory: (path: string) => Promise<DirectoryScanResult>
  readonly probePostgres: (signal: AbortSignal) => Promise<OpsMetrics['health']['postgres']>
  readonly probeRedis: (signal: AbortSignal) => Promise<OpsMetrics['health']['redis']>
  readonly hostInfo?: () => OpsMetrics['health']['node'] & { readonly uptimeSeconds: number }
}

export interface OpsCollectorOptions {
  readonly ttlMs: number
  readonly timeoutMs: number
}

const byteUsage = (
  value: { readonly bytes: number | undefined; readonly available: boolean; readonly partial: boolean },
): OpsBytesUsage => ({
  bytes: Number.isFinite(value.bytes) && (value.bytes ?? 0) >= 0 ? (value.bytes ?? 0) : 0,
  available: value.available,
  partial: value.partial,
})

const safeNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

const severityRank: Record<OpsAlert['severity'], number> = { critical: 0, warning: 1 }

const sortAlerts = (alerts: OpsAlert[]): OpsAlert[] =>
  alerts.sort((left, right) => severityRank[left.severity] - severityRank[right.severity])

const directoryUsage = (path: string, result: DirectoryScanResult): OpsDirectoryUsage => ({
  path,
  bytes: safeNumber(result.bytes),
  entries: safeNumber(result.entries),
  partial: result.partial,
})

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('PROBE_TIMEOUT'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export class OpsCollector {
  private cached: { value: OpsMetrics; expiresAt: number } | undefined
  private inFlight: Promise<OpsMetrics> | undefined

  constructor(
    private readonly dependencies: OpsCollectorDependencies,
    private readonly options: OpsCollectorOptions,
  ) {}

  collect(force = false): Promise<OpsMetrics> {
    const now = this.dependencies.now?.() ?? Date.now()
    if (!force && this.cached !== undefined && now < this.cached.expiresAt) {
      return Promise.resolve({
        ...this.cached.value,
        cache: { ...this.cached.value.cache, hit: true },
      })
    }
    if (this.inFlight !== undefined) return this.inFlight

    const pending = this.collectFresh(now)
    this.inFlight = pending
    return pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = undefined
    })
  }

  private async collectFresh(now: number): Promise<OpsMetrics> {
    const signal = new AbortController()
    const rootPromise = this.dependencies.readDiskUsage(this.dependencies.paths.root)
      .catch(() => unavailableDisk(this.dependencies.paths.root))
    const dataPromise = this.dependencies.readDiskUsage(this.dependencies.paths.data)
      .catch(() => unavailableDisk(this.dependencies.paths.data))
    const sessionsPromise = this.dependencies.scanDirectory(this.dependencies.paths.sessions)
      .catch(() => ({ bytes: 0, entries: 0, partial: true }))
    const workspacesPromise = this.dependencies.scanDirectory(this.dependencies.paths.workspaces)
      .catch(() => ({ bytes: 0, entries: 0, partial: true }))
    const postgresPromise = withTimeout(
      this.dependencies.probePostgres(signal.signal),
      this.options.timeoutMs,
      signal,
    ).catch((): OpsPostgresProbe => ({ ok: false, code: 'POSTGRES_UNAVAILABLE' }))
    const redisPromise = withTimeout(
      this.dependencies.probeRedis(signal.signal),
      this.options.timeoutMs,
      signal,
    ).catch((): OpsRedisProbe => ({ ok: false, code: 'REDIS_UNAVAILABLE' }))

    const [root, data, sessions, workspaces, postgres, redis] = await Promise.all([
      rootPromise,
      dataPromise,
      sessionsPromise,
      workspacesPromise,
      postgresPromise,
      redisPromise,
    ])

    const alerts: OpsAlert[] = []
    const diskPartial = !root.available || !data.available
    if (!root.available || !data.available) {
      alerts.push({
        severity: 'warning',
        code: 'DISK_PROBE_FAILED',
        message: '磁盘容量探测失败，请检查运行环境挂载。',
      })
    }
    if (root.available && root.usedPercent >= this.dependencies.thresholds.diskCriticalPercent) {
      alerts.push({
        severity: 'critical',
        code: 'DISK_CRITICAL',
        message: `根文件系统使用率已达到 ${root.usedPercent.toFixed(1)}%。`,
      })
    } else if (root.available && root.usedPercent >= this.dependencies.thresholds.diskWarningPercent) {
      alerts.push({
        severity: 'warning',
        code: 'DISK_WARNING',
        message: `根文件系统使用率已达到 ${root.usedPercent.toFixed(1)}%。`,
      })
    }
    if (data.available && data.usedPercent >= this.dependencies.thresholds.diskCriticalPercent) {
      alerts.push({
        severity: 'critical',
        code: 'DATA_DISK_CRITICAL',
        message: `数据卷使用率已达到 ${data.usedPercent.toFixed(1)}%。`,
      })
    } else if (data.available && data.usedPercent >= this.dependencies.thresholds.diskWarningPercent) {
      alerts.push({
        severity: 'warning',
        code: 'DATA_DISK_WARNING',
        message: `数据卷使用率已达到 ${data.usedPercent.toFixed(1)}%。`,
      })
    }
    if (!postgres.ok) {
      alerts.push({
        severity: 'critical',
        code: 'POSTGRES_UNAVAILABLE',
        message: 'PostgreSQL 连接失败。',
      })
    } else if (postgres.code !== undefined) {
      alerts.push({
        severity: 'warning',
        code: postgres.code,
        message: 'PostgreSQL 已连接，但账号与会话聚合计数暂不可用。',
      })
    }
    if (!redis.ok) {
      alerts.push({
        severity: 'critical',
        code: 'REDIS_UNAVAILABLE',
        message: 'Redis 连接失败。',
      })
    }
    if (sessions.partial) {
      alerts.push({
        severity: 'warning',
        code: 'SESSIONS_SCAN_PARTIAL',
        message: '会话目录扫描达到边界，统计为部分结果。',
      })
    }
    if (workspaces.partial) {
      alerts.push({
        severity: 'warning',
        code: 'WORKSPACES_SCAN_PARTIAL',
        message: '工作区目录扫描达到边界，统计为部分结果。',
      })
    }

    const partial = diskPartial || sessions.partial || workspaces.partial
      || postgres.code !== undefined || !postgres.ok || !redis.ok
    const status = alerts.some(alert => alert.severity === 'critical')
      ? 'critical'
      : alerts.length > 0 ? 'warning' : 'ok'
    const hostInfo = this.dependencies.hostInfo?.() ?? {
      uptimeSeconds: process.uptime(),
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    }
    const collectedAt = new Date(now).toISOString()
    const cache = {
      ttlMs: this.options.ttlMs,
      hit: false,
      collectedAt,
      partial,
    }
    const value: OpsMetrics = {
      cache,
      disk: {
        thresholds: {
          warningPercent: this.dependencies.thresholds.diskWarningPercent,
          criticalPercent: this.dependencies.thresholds.diskCriticalPercent,
        },
        root,
        data,
        breakdown: {
          sessions: directoryUsage(this.dependencies.paths.sessions, sessions),
          workspaces: directoryUsage(this.dependencies.paths.workspaces, workspaces),
          postgres: byteUsage({
            bytes: postgres.sizeBytes,
            available: postgres.ok,
            partial: postgres.code !== undefined,
          }),
          redis: byteUsage({
            bytes: redis.usedMemoryBytes,
            available: redis.ok,
            partial: !redis.ok,
          }),
        },
        partial: diskPartial || sessions.partial || workspaces.partial,
      },
      health: {
        status,
        uptimeSeconds: safeNumber(hostInfo.uptimeSeconds),
        node: {
          version: hostInfo.version,
          platform: hostInfo.platform,
          arch: hostInfo.arch,
        },
        postgres,
        redis,
        sessions: postgres.sessions ?? { live: 0, distinctUsers: 0 },
        accounts: postgres.accounts ?? { total: 0, active: 0, disabled: 0 },
      },
      alerts: sortAlerts(alerts),
      partial,
    }

    this.cached = {
      value,
      expiresAt: now + this.options.ttlMs,
    }
    return value
  }
}

const unavailableDisk = (path: string): OpsDiskUsage => ({
  path,
  totalBytes: 0,
  freeBytes: 0,
  availableBytes: 0,
  usedBytes: 0,
  usedPercent: 0,
  available: false,
})
