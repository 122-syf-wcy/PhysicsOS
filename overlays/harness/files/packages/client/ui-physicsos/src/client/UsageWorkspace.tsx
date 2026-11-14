import { useEffect, useState } from 'react'
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
