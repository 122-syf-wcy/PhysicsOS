/**
 * Read-only platform operations panel.
 *
 * The host returns one bounded JSON sample. This component deliberately does
 * not turn that sample into arbitrary dashboard widgets: disk, dependencies,
 * account/session totals, cache state, and alerts are the complete contract.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'

import type { AdminApi, OpsMetrics } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'
import {
  IconCache,
  IconDatabase,
  IconDisk,
  IconHealth,
  IconRefresh,
} from './icons/physics-icons.tsx'
import {
  AdminCard,
  AdminCardActions,
  AdminCardHead,
  AdminCardMeta,
  AdminCardTitle,
  AdminEmpty,
  AdminTable,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

export interface AdminOpsPanelProps {
  readonly api: AdminApi
  readonly t: (key: PhysicsosKey) => string
}

const REFRESH_MS = 30_000

const formatBytes = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  const digits = amount >= 100 || index === 0 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toFixed(digits)} ${units[index]}`
}

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${String(days)} 天 ${String(hours)} 小时`
  if (hours > 0) return `${String(hours)} 小时 ${String(minutes)} 分钟`
  return `${String(minutes)} 分钟`
}

const formatTime = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false })
}

const diskSeverity = (metrics: OpsMetrics): 'ok' | 'warning' | 'critical' => {
  const values = [metrics.disk.root, metrics.disk.data]
  if (values.some(value => value.usedPercent >= metrics.disk.thresholds.criticalPercent)) return 'critical'
  if (values.some(value => value.usedPercent >= metrics.disk.thresholds.warningPercent)) return 'warning'
  return 'ok'
}

const statusLabel = (
  t: (key: PhysicsosKey) => string,
  ok: boolean,
): string => ok ? t('admin.ops.metrics.healthy') : t('admin.ops.metrics.unavailable')

const MetricCard = ({
  icon,
  label,
  value,
  detail,
  severity = 'ok',
  testId,
  progress,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly value: string
  readonly detail: string
  readonly severity?: 'ok' | 'warning' | 'critical'
  readonly testId: string
  readonly progress?: number
}) => {
  const severityClass = severity === 'critical'
    ? css.opsMetricCritical
    : severity === 'warning' ? css.opsMetricWarning : undefined
  return (
    <section
      className={clsx(css.opsMetricCard, severityClass)}
      data-testid={testId}
      data-severity={severity}
    >
      <div className={css.opsMetricHead}>
        <span className={css.opsMetricIcon}>{icon}</span>
        <span className={css.opsMetricLabel}>{label}</span>
      </div>
      <strong className={css.opsMetricValue}>{value}</strong>
      {progress !== undefined && (
        <span className={css.opsProgress} aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </span>
      )}
      <span className={css.opsMetricDetail}>{detail}</span>
    </section>
  )
}

export function AdminOpsPanel({ api, t }: AdminOpsPanelProps) {
  const [metrics, setMetrics] = useState<OpsMetrics | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [paused, setPaused] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async (force: boolean): Promise<void> => {
    if (typeof api.opsMetrics !== 'function') {
      setLoading(false)
      setError(t('admin.ops.metrics.unavailable'))
      return
    }
    const id = requestId.current + 1
    requestId.current = id
    setLoading(true)
    setError(undefined)
    try {
      const next = await api.opsMetrics(force)
      if (requestId.current === id) setMetrics(next)
    } catch (reason: unknown) {
      if (requestId.current === id) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [api, t])

  useEffect(() => { void load(false) }, [load])

  useEffect(() => {
    if (paused) return
    const timer = globalThis.setInterval(() => { void load(false) }, REFRESH_MS)
    return () => { globalThis.clearInterval(timer) }
  }, [load, paused])

  if (metrics === undefined) {
    return (
      <AdminCard testId="ops-metrics">
        <AdminCardHead>
          <div>
            <AdminCardTitle>{t('admin.ops.metrics.title')}</AdminCardTitle>
            <AdminCardMeta>{t('admin.ops.metrics.hint')}</AdminCardMeta>
          </div>
          <button type="button" className={css.ghost} disabled={loading}
            onClick={() => { void load(true) }}>
            <IconRefresh size={14} />
            {' '}
            {loading ? t('admin.ops.metrics.loading') : t('admin.ops.metrics.refresh')}
          </button>
        </AdminCardHead>
        {error === undefined
          ? <AdminCardMeta>{t('admin.ops.metrics.loading')}</AdminCardMeta>
          : (
            <div className={css.opsEmpty}>
              <img
                className={css.opsEmptyArt}
                src="/physicsos/ops/ops-console.png"
                alt=""
              />
              <p className={css.error}>{error}</p>
            </div>
          )}
      </AdminCard>
    )
  }

  const severity = diskSeverity(metrics)
  const postgresOk = metrics.health.postgres.ok
  const redisOk = metrics.health.redis.ok
  const partial = metrics.partial || metrics.cache.partial

  return (
    <AdminCard className={css.opsMetrics} testId="ops-metrics" data-partial={partial}>
      <AdminCardHead>
        <div>
          <AdminCardTitle>{t('admin.ops.metrics.title')}</AdminCardTitle>
          <AdminCardMeta>{t('admin.ops.metrics.hint')}</AdminCardMeta>
        </div>
        <AdminCardActions>
          <button type="button" className={css.ghost}
            data-testid="ops-metrics-pause"
            onClick={() => { setPaused(value => !value) }}>
            {paused ? t('admin.ops.metrics.resume') : t('admin.ops.metrics.pause')}
          </button>
          <button type="button" className={css.primary}
            data-testid="ops-metrics-refresh"
            disabled={loading}
            onClick={() => { void load(true) }}>
            <IconRefresh size={14} />
            {' '}
            {loading ? t('admin.ops.metrics.loading') : t('admin.ops.metrics.refresh')}
          </button>
        </AdminCardActions>
      </AdminCardHead>

      {partial && <p className={css.note} data-testid="ops-metrics-partial">
        {t('admin.ops.metrics.partial')}
      </p>}
      {error !== undefined && <p className={css.error}>{error}</p>}

      <div className={css.opsMetricGrid}>
        <MetricCard
          icon={<IconDisk size={17} />}
          label={t('admin.ops.metrics.disk')}
          value={`${metrics.disk.root.usedPercent.toFixed(1)}%`}
          detail={`${formatBytes(metrics.disk.root.usedBytes)} / ${formatBytes(metrics.disk.root.totalBytes)}`}
          severity={severity}
          testId="ops-disk-card"
          progress={metrics.disk.root.usedPercent}
        />
        <MetricCard
          icon={<IconDatabase size={17} />}
          label={t('admin.ops.metrics.postgres')}
          value={statusLabel(t, postgresOk)}
          detail={postgresOk && metrics.health.postgres.latencyMs !== undefined
            ? `${t('admin.ops.metrics.latency')} ${String(metrics.health.postgres.latencyMs)} ms`
            : metrics.health.postgres.code ?? t('admin.ops.metrics.unavailable')}
          severity={postgresOk ? 'ok' : 'critical'}
          testId="ops-postgres-card"
        />
        <MetricCard
          icon={<IconHealth size={17} />}
          label={t('admin.ops.metrics.redis')}
          value={statusLabel(t, redisOk)}
          detail={redisOk && metrics.health.redis.latencyMs !== undefined
            ? `${formatBytes(metrics.health.redis.usedMemoryBytes)} · ${String(metrics.health.redis.latencyMs)} ms`
            : metrics.health.redis.code ?? t('admin.ops.metrics.unavailable')}
          severity={redisOk ? 'ok' : 'critical'}
          testId="ops-redis-card"
        />
      </div>

      <div className={css.opsMetaGrid}>
        <span className={css.opsMetaItem}>
          <span>{t('admin.ops.metrics.sessions')}</span>
          <strong>{metrics.health.sessions.live}</strong>
          <small>{t('admin.ops.metrics.distinctUsers')} {metrics.health.sessions.distinctUsers}</small>
        </span>
        <span className={css.opsMetaItem}>
          <span>{t('admin.ops.metrics.accounts')}</span>
          <strong>{metrics.health.accounts.total}</strong>
          <small>{t('admin.ops.metrics.activeAccounts')} {metrics.health.accounts.active}</small>
        </span>
        <span className={css.opsMetaItem}>
          <span>{t('admin.ops.metrics.uptime')}</span>
          <strong>{formatDuration(metrics.health.uptimeSeconds)}</strong>
          <small>{metrics.health.node.version} · {metrics.health.node.platform}/{metrics.health.node.arch}</small>
        </span>
        <span className={css.opsMetaItem}>
          <span>{t('admin.ops.metrics.cacheTtl')}</span>
          <strong>{Math.round(metrics.cache.ttlMs / 1000)} s</strong>
          <small>{t('admin.ops.metrics.collectedAt')} {formatTime(metrics.cache.collectedAt)}</small>
        </span>
      </div>

      <div className={css.opsBreakdown}>
        <h4>{t('admin.ops.metrics.breakdown')}</h4>
        <AdminTable className={css.opsTable}>
          <tbody>
            <tr>
              <th>{t('admin.ops.metrics.sessionsDir')}</th>
              <td>{formatBytes(metrics.disk.breakdown.sessions.bytes)}</td>
              <td>{metrics.disk.breakdown.sessions.entries} {t('admin.ops.metrics.entries')}</td>
            </tr>
            <tr>
              <th>{t('admin.ops.metrics.workspacesDir')}</th>
              <td>{formatBytes(metrics.disk.breakdown.workspaces.bytes)}</td>
              <td>{metrics.disk.breakdown.workspaces.entries} {t('admin.ops.metrics.entries')}</td>
            </tr>
            <tr>
              <th>{t('admin.ops.metrics.postgresData')}</th>
              <td>{formatBytes(metrics.disk.breakdown.postgres.bytes)}</td>
              <td>{metrics.disk.breakdown.postgres.available ? t('admin.ops.metrics.available') : t('admin.ops.metrics.unavailable')}</td>
            </tr>
            <tr>
              <th>{t('admin.ops.metrics.redisMemory')}</th>
              <td>{formatBytes(metrics.disk.breakdown.redis.bytes)}</td>
              <td>{metrics.disk.breakdown.redis.available ? t('admin.ops.metrics.available') : t('admin.ops.metrics.unavailable')}</td>
            </tr>
          </tbody>
        </AdminTable>
      </div>

      <div className={css.opsAlerts} data-testid="ops-metrics-alerts">
        <h4>{t('admin.ops.metrics.alerts')}</h4>
        {metrics.alerts.length === 0
          ? <AdminEmpty>{t('admin.ops.metrics.noAlerts')}</AdminEmpty>
          : metrics.alerts.map(alert => (
            <p key={`${alert.severity}:${alert.code}`}
              className={alert.severity === 'critical' ? css.error : css.note}
              data-alert={alert.code}>
              {alert.message}
            </p>
          ))}
      </div>

      <div className={css.opsCacheNote}>
        <IconCache size={15} />
        {' '}
        <span>
          {t('admin.ops.metrics.cacheHint')
            .replace('{seconds}', String(Math.round(metrics.cache.ttlMs / 1000)))}
        </span>
        <span className={css.dim}>{metrics.cache.hit ? t('admin.ops.metrics.cacheHit') : t('admin.ops.metrics.cacheMiss')}</span>
      </div>
    </AdminCard>
  )
}
