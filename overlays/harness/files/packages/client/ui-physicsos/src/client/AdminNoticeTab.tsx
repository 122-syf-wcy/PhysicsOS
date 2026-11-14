/**
 * Feedback queue — the operator's side of the inbound reports.
 *
 * Platform announcements are edited separately and shown as a versioned shell
 * modal, so this tab has one job: answer students who took the time to report.
 */
import { useCallback, useEffect, useState } from 'react'

import type { FeedbackRow, FeedbackStatus, NoticeApi } from './notice-api.ts'
import type { PhysicsosKey } from './locales.ts'
import { GlassSelect } from './GlassSelect.tsx'
import {
  AdminCard,
  AdminCardMeta,
  AdminEmpty,
  AdminStats,
  AdminTable,
  AdminToolbar,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

export interface AdminNoticeTabProps {
  readonly api: NoticeApi
  readonly t: (key: PhysicsosKey) => string
}

const fmtTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function AdminNoticeTab({ api, t }: AdminNoticeTabProps) {
  const [items, setItems] = useState<readonly FeedbackRow[] | undefined>()
  const [selected, setSelected] = useState<string>()
  const [status, setStatus] = useState<FeedbackStatus | ''>('open')
  const [error, setError] = useState<string | undefined>()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(undefined)
    /* The whole tenant queue is fetched and filtered in place: the counts at
       the top describe the collection, and a filtered fetch could only ever
       describe the view. */
    api.listFeedback()
      .then((feedback) => { setItems(feedback.items) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [api])

  useEffect(load, [load])

  const run = (job: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    job().then(() => { load() }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }

  if (error !== undefined && items === undefined) return <p className={css.error}>{error}</p>
  if (items === undefined) return <AdminEmpty>{t('admin.loading')}</AdminEmpty>

  const visible = status === '' ? items : items.filter(row => row.status === status)
  const selectedId = visible.find(item => item.id === selected)?.id ?? visible[0]?.id

  return (
    <>
      {error !== undefined && <p className={css.error}>{error}</p>}

      <AdminStats items={(['open', 'answered', 'closed'] as const).map(bucket => ({
        key: bucket,
        dataStat: `feedback.${bucket}`,
        value: items.filter(row => row.status === bucket).length,
        label: t(`admin.notice.status.${bucket}`),
      }))} />

      <AdminToolbar>
        <GlassSelect
          className={css.select}
          value={status}
          ariaLabel={t('admin.content.filter.all')}
          testId="feedback-status"
          options={[
            { value: '', label: t('admin.content.filter.all') },
            ...(['open', 'answered', 'closed'] as const).map(bucket => ({
              value: bucket, label: t(`admin.notice.status.${bucket}`),
            })),
          ]}
          onChange={(next) => { setStatus(next as FeedbackStatus | '') }}
        />
      </AdminToolbar>

      {visible.length === 0 && <AdminEmpty>{t('admin.empty')}</AdminEmpty>}
      <div className={css.detailLayout}>
        <section className={css.detailList}>
          <AdminTable minWidth={430}>
            <thead><tr><th>{t('admin.audit.time')}</th><th>{t('notice.kindLabel')}</th><th>{t('notice.description')}</th><th>{t('admin.users.status')}</th></tr></thead>
            <tbody>{visible.map(row => <tr key={row.id} data-selected={row.id === selectedId || undefined}>
              <td className={css.timeCell}>{fmtTime(row.createdAt)}</td><td>{t(`notice.kind.${row.kind}`)}</td>
              <td><button type="button" className={css.tableLink} onClick={() => { setSelected(row.id) }}>{row.body.length > 80 ? `${row.body.slice(0, 80)}…` : row.body}</button></td>
              <td><button type="button" className={css.ghost} onClick={() => { setSelected(row.id) }}>{t(`admin.notice.status.${row.status}`)}</button></td>
            </tr>)}</tbody>
          </AdminTable>
        </section>
        {visible.filter(row => row.id === selectedId).map(row => (
          <AdminCard key={row.id} className={css.detailPane} data-feedback={row.id}>
          <AdminCardMeta>
              {fmtTime(row.createdAt)} · {t(`notice.kind.${row.kind}`)} · {row.authorKey}
            {row.context === undefined ? '' : ` · ${row.context}`}
          </AdminCardMeta>
          <p className={css.cardText}>{row.body}</p>
          {row.reply !== undefined && (
            <AdminCardMeta>
              {t('admin.notice.repliedBy')} {row.repliedBy} · {row.reply}
            </AdminCardMeta>
          )}
          <div className={css.formRow}>
            <input
              className={css.input}
              placeholder={t('admin.notice.replyPlaceholder')}
              value={drafts[row.id] ?? ''}
              onChange={(event) => {
                setDrafts(current => ({ ...current, [row.id]: event.target.value }))
              }}
            />
            <button
              type="button" className={css.primary}
              disabled={busy || (drafts[row.id] ?? '').trim() === ''}
              onClick={() => {
                const text = (drafts[row.id] ?? '').trim()
                if (text === '') return
                run(() => api.replyFeedback(row.id, text)
                  .then(() => { setDrafts(current => ({ ...current, [row.id]: '' })) }))
              }}
            >
              {t('admin.notice.reply')}
            </button>
          </div>
        </AdminCard>
      ))}
      </div>
    </>
  )
}
