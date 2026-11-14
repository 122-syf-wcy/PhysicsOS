import { useEffect, useState } from 'react'
import { Chart } from './workspace-parts.tsx'
import { LoadingState } from './LoadingState.tsx'
import type { UsageApi, UsageSummary } from './usage-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './UsageWorkspace.module.css'

export interface UsageWorkspaceProps {
  readonly api: Pick<UsageApi, 'summary' | 'adminSummary'>
  readonly admin?: boolean
  readonly t: (key: PhysicsosKey) => string
}

/** Reads the same server-owned counters for the personal page and authorized overview. */
export function UsageWorkspace({ api, admin = false, t }: UsageWorkspaceProps) {
  const [metric, setMetric] = useState<'visits' | 'uses' | 'tokens'>('visits')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [summary, setSummary] = useState<UsageSummary>()
  const [error, setError] = useState<string>()
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    const request = admin ? api.adminSummary() : api.summary()
    void request
      .then(
        (value) => {
          if (active) setSummary(value)
        },
        (reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, admin, refresh])
  const n = (value: number): string => value.toLocaleString()
  const cards =
    summary === undefined
      ? []
      : ([
        ['usage.visits', summary.visits],
        ['usage.uses', summary.uses],
        ['usage.tokens.total', summary.tokens.totalTokens],
        ['usage.calls.reported', summary.coverage.reportedCalls],
        ['usage.calls.missing', summary.coverage.missingCalls],
        ['usage.sessions.unavailable', summary.coverage.unavailableSessions ?? 0],
      ] as const)
  const days = [...(summary?.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const metricLabel = t(metric === 'tokens' ? 'usage.tokens.total' : metric === 'uses' ? 'usage.uses' : 'usage.visits')
  const valueOf = (day: NonNullable<UsageSummary['daily'][number]>): number => metric === 'tokens' ? day.tokens.totalTokens : day[metric]
  const hovered = hoverIndex === null ? undefined : days[Math.max(0, Math.min(days.length - 1, hoverIndex))]
  return (
    <section className={admin ? css.embedded : css.root} data-physicsos-surface={admin ? undefined : 'record'}>
      <header className={css.header}>
        <div>
          <h1>{t(admin ? 'admin.overview.summary' : 'usage.heading')}</h1>
          <p>{t('usage.hint')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRefresh(value => value + 1)
          }}
          disabled={loading}
        >
          {t('usage.refresh')}
        </button>
      </header>
      {loading && summary === undefined ? <LoadingState inline label={t('usage.loading')}>{t('usage.loading')}</LoadingState> : null}
      {error === undefined ? null : (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {summary === undefined ? null : (
        <>
          <div className={css.cards}>
            {cards.map(([key, value]) => (
              <div key={key} className={css.card} data-stat={key}>
                <span>{t(key)}</span>
                <strong>{n(value)}</strong>
              </div>
            ))}
          </div>
          <p className={css.hint}>{t('usage.coverage')}</p>
          <dl className={css.buckets}>
            {(
              [
                ['usage.tokens.input', summary.tokens.inputTokens],
                ['usage.tokens.output', summary.tokens.outputTokens],
                ['usage.tokens.cacheRead', summary.tokens.cacheReadTokens],
                ['usage.tokens.cacheWrite', summary.tokens.cacheWriteTokens],
                ['usage.tokens.reasoning', summary.tokens.reasoningTokens],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{n(value)}</dd>
              </div>
            ))}
            {summary.scope === 'platform' ? (
              <>
                <div>
                  <dt>{t('usage.system')}</dt>
                  <dd>{n(summary.system.tokens.totalTokens)}</dd>
                </div>
                <div data-stat="usage.system.calls.reported">
                  <dt>{t('usage.system.calls.reported')}</dt>
                  <dd>{n(summary.system.reportedCalls)}</dd>
                </div>
                <div data-stat="usage.system.calls.missing">
                  <dt>{t('usage.system.calls.missing')}</dt>
                  <dd>{n(summary.system.missingCalls)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {days.length > 0 && <section className={css.trend} aria-label={t('usage.history')}>
            <div className={css.trendHeader}>
              <h2>{t('usage.history')}</h2>
              <div className={css.metricTabs} role="group" aria-label={t('usage.history')}>
                {(['visits', 'uses', 'tokens'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => { setMetric(value); setHoverIndex(null) }}>
                  {t(value === 'tokens' ? 'usage.tokens.total' : value === 'uses' ? 'usage.uses' : 'usage.visits')}
                </button>)}
              </div>
            </div>
            <div className={css.trendReadout} role="status">{hovered === undefined ? `${days[0]?.date ?? ''} — ${days.at(-1)?.date ?? ''}` : `${hovered.date} · ${metricLabel}: ${n(valueOf(hovered))}`}</div>
            <div className={css.trendPlot}>
              <Chart series={{ id: `usage-${metric}`, title: metricLabel, xLabel: t('usage.date'), yLabel: metricLabel, role: 'trajectory', points: days.map((day, index) => ({ t: index, value: valueOf(day) })) }}
                width={720} height={180} zeroBased time={hoverIndex ?? 0} total={hoverIndex === null ? 0 : days.length - 1}
                onHoverTime={(value) => { setHoverIndex(value === null ? null : Math.round(value)) }} />
            </div>
          </section>}
          <h2>{t('usage.history')}</h2>
          {summary.daily.length === 0 ? (
            <p>{t('usage.empty')}</p>
          ) : (
            <div className={css.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>{t('usage.date')}</th>
                    <th>{t('usage.visits')}</th>
                    <th>{t('usage.uses')}</th>
                    <th>{t('usage.tokens.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.daily].reverse().map(day => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{n(day.visits)}</td>
                      <td>{n(day.uses)}</td>
                      <td>{n(day.tokens.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
