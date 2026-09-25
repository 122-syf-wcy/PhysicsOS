/**
 * 内容管理 — the admin console over the question bank.
 *
 * The 出卷专区 has twelve content routes and, until now, no management view at
 * all: 392 questions could only be put in by running a script, and a bad batch
 * could only be taken out by talking to the database. This is the console that
 * was missing, and it deliberately adds NO backend: it drives the same
 * `PaperApi` the 出卷专区 drives, because the operations an operator needs —
 * filter, inspect, verify, reject, clean up — are the ones the API already has.
 *
 * What makes it an ADMIN view rather than a re-skin of the studio:
 *
 *   - the UNIT of work is a batch, not a question. Bulk review is the operation
 *     the import path makes necessary: `pending` rows never reach the assembler,
 *     so an import of 388 questions is inert until somebody verifies it.
 *   - anomalies are surfaced first. `anomalies` is a per-item list the ingest
 *     pipeline fills when it is unsure (a missing figure, a stem that looks
 *     truncated); the studio shows them one card at a time, which is the wrong
 *     shape for finding "which 12 of the 392 are broken".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

import type { BankItemRow, PaperApi, SourcePaperRow } from './paper-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './AdminWorkspace.module.css'

type BankStatus = 'pending' | 'verified' | 'rejected'

export interface AdminContentTabProps {
  readonly api: PaperApi
  /** Who is judging — attributed on every review the way the ledger does it. */
  readonly reviewer: string
  readonly t: (key: PhysicsosKey) => string
}

/** A card's worth of the stem, short enough to scan a list of them. */
const STEM_PREVIEW = 90

const previewOf = (stem: string): string =>
  stem.length <= STEM_PREVIEW ? stem : `${stem.slice(0, STEM_PREVIEW)}…`

const STATUS_ORDER: readonly BankStatus[] = ['pending', 'verified', 'rejected']

export function AdminContentTab({ api, reviewer, t }: AdminContentTabProps) {
  const [items, setItems] = useState<readonly BankItemRow[] | undefined>()
  const [sources, setSources] = useState<readonly SourcePaperRow[]>([])
  const [error, setError] = useState<string | undefined>()
  const [status, setStatus] = useState<BankStatus | ''>('pending')
  const [level, setLevel] = useState('')
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>()

  const load = useCallback(() => {
    setError(undefined)
    /* Fetch the WHOLE bank, not the current filter: the status counts below
       describe the collection, not the view, and a filtered fetch could only
       ever report on itself. 392 rows is a few hundred kB of JSON — the honest
       trade for a console an operator opens occasionally. */
    api.listBankItems()
      .then(setItems)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    api.listSources()
      .then(setSources)
      .catch(() => { /* The bank is what this tab is for; a source read that
                       fails must not blank the page. */ })
  }, [api])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const all = items ?? []
    return {
      total: all.length,
      pending: all.filter(item => item.status === 'pending').length,
      verified: all.filter(item => item.status === 'verified').length,
      rejected: all.filter(item => item.status === 'rejected').length,
      anomalies: all.filter(item => item.anomalies.length > 0).length,
    }
  }, [items])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (items ?? []).filter((item) => {
      if (status !== '' && item.status !== status) return false
      if (level !== '' && item.level !== level) return false
      if (kind !== '' && item.kind !== kind) return false
      if (onlyAnomalies && item.anomalies.length === 0) return false
      if (needle === '') return true
      /* Search the stem AND the knowledge tags: an operator looking for "which
         压强 questions are broken" searches the tag, not the wording. */
      return item.stem.toLowerCase().includes(needle)
        || item.knowledge.some(tag => tag.toLowerCase().includes(needle))
    })
  }, [items, status, level, kind, onlyAnomalies, query])

  const kinds = useMemo(
    () => [...new Set((items ?? []).map(item => item.kind))].sort(),
    [items],
  )

  const runReview = async (next: BankStatus) => {
    if (selected.size === 0 || busy) return
    setBusy(true)
    setNote(undefined)
    try {
      const result = await api.reviewBankItems([...selected], next, reviewer)
      /* `missing` is reported, never swallowed: it means the list the operator
         was looking at is stale, which is worth knowing before they trust the
         count they just read. */
      setNote(result.missing.length === 0
        ? `已更新 ${result.updated} 条`
        : `已更新 ${result.updated} 条，${result.missing.length} 条已不存在`)
      setSelected(new Set())
      load()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = visible.length > 0 && visible.every(item => selected.has(item.id))

  return (
    <>
      {/* The collection's own numbers, above the view's: an operator needs to
          know how much of the bank is unverified before filtering to a subset. */}
      <div className={css.stats}>
        {/* `data-stat` names each bucket so a reader (a spec, a screenshot
            gate) can ask for ONE of them: several of these counts are equal by
            coincidence, and matching on the rendered digit is how a test grabs
            the wrong figure and still passes. */}
        <span className={css.stat} data-stat="total">
          <strong>{counts.total}</strong> {t('admin.content.total')}
        </span>
        {STATUS_ORDER.map(key => (
          <span key={key} className={css.stat} data-stat={key}>
            <strong>{counts[key]}</strong> {t(`admin.content.status.${key}`)}
          </span>
        ))}
        <span className={clsx(css.stat, counts.anomalies > 0 && css.statWarn)} data-stat="anomalies">
          <strong>{counts.anomalies}</strong> {t('admin.content.anomalies')}
        </span>
        <span className={css.stat} data-stat="sources">
          <strong>{sources.length}</strong> {t('admin.content.sources')}
        </span>
      </div>

      {error !== undefined && <p className={css.error}>{error}</p>}

      <div className={css.toolbar}>
        <select className={css.select} value={status}
          onChange={(event) => { setStatus(event.target.value as BankStatus | '') }}>
          <option value="">{t('admin.content.filter.all')}</option>
          {STATUS_ORDER.map(key => (
            <option key={key} value={key}>{t(`admin.content.status.${key}`)}</option>
          ))}
        </select>
        <select className={css.select} value={level} onChange={(event) => { setLevel(event.target.value) }}>
          <option value="">{t('admin.content.filter.level.all')}</option>
          <option value="zhongkao">中考</option>
          <option value="gaokao">高考</option>
        </select>
        <select className={css.select} value={kind} onChange={(event) => { setKind(event.target.value) }}>
          <option value="">{t('admin.content.filter.kind.all')}</option>
          {kinds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <input className={css.input} placeholder={t('admin.content.search')}
          value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <label className={css.checkbox}>
          <input type="checkbox" checked={onlyAnomalies}
            onChange={(event) => { setOnlyAnomalies(event.target.checked) }} />
          {t('admin.content.onlyAnomalies')}
        </label>
      </div>

      <div className={css.toolbar}>
        <label className={css.checkbox}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => {
              setSelected(event.target.checked
                ? new Set(visible.map(item => item.id))
                : new Set())
            }}
          />
          {t('admin.content.selectAll')}（{visible.length}）
        </label>
        <span className={css.dim}>{selected.size} {t('admin.content.selected')}</span>
        <button type="button" className={css.ghost} disabled={busy || selected.size === 0}
          onClick={() => { void runReview('verified') }}>
          {t('admin.content.verify')}
        </button>
        <button type="button" className={css.danger} disabled={busy || selected.size === 0}
          onClick={() => { void runReview('rejected') }}>
          {t('admin.content.reject')}
        </button>
        <button type="button" className={css.ghost} disabled={busy || selected.size === 0}
          onClick={() => { void runReview('pending') }}>
          {t('admin.content.requeue')}
        </button>
      </div>

      {note !== undefined && <p className={css.note}>{note}</p>}

      {items === undefined
        ? <p className={css.empty}>{t('admin.loading')}</p>
        : visible.length === 0
          ? <p className={css.empty}>{t('admin.content.empty')}</p>
          : visible.slice(0, 200).map(item => (
            <section key={item.id} className={css.card}>
              <div className={css.cardHead}>
                <label className={css.checkbox}>
                  <input type="checkbox" checked={selected.has(item.id)}
                    onChange={() => { toggle(item.id) }} />
                </label>
                <div className={css.cardBody}>
                  <p className={css.cardMeta}>
                    <span className={css.action}>{item.kind}</span>
                    <span className={css.action}>{item.level === 'zhongkao' ? '中考' : '高考'}</span>
                    <span className={css.action}>{item.difficulty}</span>
                    <span className={css.action}>{item.score} 分</span>
                    <span className={clsx(css.action, item.status === 'verified' && css.actionOk,
                      item.status === 'rejected' && css.actionBad)}>
                      {t(`admin.content.status.${item.status}`)}
                    </span>
                  </p>
                  <p className={css.stem}>{previewOf(item.stem)}</p>
                  <p className={css.cardMeta}>
                    {item.knowledge.join(' · ')}
                    {item.sourceLabel === undefined ? '' : ` · ${item.sourceLabel}`}
                    {' · '}{item.id}
                  </p>
                  {/* The reason this tab exists: an anomaly is why an operator
                      opens a console at all, so it is on the card rather than a
                      detail they have to click into. */}
                  {item.anomalies.length > 0 && (
                    <p className={css.anomaly}>{t('admin.content.anomaly')}：{item.anomalies.join('；')}</p>
                  )}
                </div>
              </div>
            </section>
          ))}

      {visible.length > 200 && (
        <p className={css.empty}>{t('admin.content.truncated')}（{visible.length}）</p>
      )}
    </>
  )
}
