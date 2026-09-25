/**
 * 反馈与公告 — the operator's side of both directions.
 *
 * Feedback first, because it is a queue with a service level: a student who
 * reports a broken experiment and hears nothing stops reporting. The list is
 * the TENANT's (a student calling the same endpoint sees only their own rows —
 * that filter is the server's, not this component's).
 *
 * Announcements are the reverse direction and share the tab: the operator who
 * reads "the lab is broken" is the one who posts "the lab is fixed".
 */
import { useCallback, useEffect, useState } from 'react'

import type { AnnouncementRow, FeedbackRow, FeedbackStatus, NoticeApi } from './notice-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './AdminWorkspace.module.css'

export interface AdminNoticeTabProps {
  readonly api: NoticeApi
  /** Teacher and above may reply; only school admins and up may publish. */
  readonly canPublish: boolean
  readonly t: (key: PhysicsosKey) => string
}

const KIND_LABEL: Record<FeedbackRow['kind'], string> = {
  bug: '故障',
  content: '内容',
  idea: '建议',
  other: '其他',
}

const fmtTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function AdminNoticeTab({ api, canPublish, t }: AdminNoticeTabProps) {
  const [items, setItems] = useState<readonly FeedbackRow[] | undefined>()
  const [announcements, setAnnouncements] = useState<readonly AnnouncementRow[]>([])
  const [status, setStatus] = useState<FeedbackStatus | ''>('open')
  const [error, setError] = useState<string | undefined>()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [notice, setNotice] = useState({ title: '', body: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(undefined)
    /* The whole tenant queue is fetched and filtered in place: the counts at
       the top describe the collection, and a filtered fetch could only ever
       describe the view. */
    Promise.all([api.listFeedback(), api.listAnnouncements()])
      .then(([feedback, notices]) => {
        setItems(feedback.items)
        setAnnouncements(notices.items)
      })
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
  if (items === undefined) return <p className={css.empty}>{t('admin.loading')}</p>

  const visible = status === '' ? items : items.filter(row => row.status === status)

  return (
    <>
      {error !== undefined && <p className={css.error}>{error}</p>}

      <div className={css.stats}>
        {(['open', 'answered', 'closed'] as const).map(bucket => (
          <span key={bucket} className={css.stat} data-stat={`feedback.${bucket}`}>
            <strong>{items.filter(row => row.status === bucket).length}</strong>
            {' '}
            {t(`admin.notice.status.${bucket}`)}
          </span>
        ))}
      </div>

      <div className={css.toolbar}>
        <select className={css.select} value={status}
          onChange={(event) => { setStatus(event.target.value as FeedbackStatus | '') }}>
          <option value="">{t('admin.content.filter.all')}</option>
          {(['open', 'answered', 'closed'] as const).map(bucket => (
            <option key={bucket} value={bucket}>{t(`admin.notice.status.${bucket}`)}</option>
          ))}
        </select>
      </div>

      <div className={css.list}>
        {visible.length === 0 && <p className={css.empty}>{t('admin.empty')}</p>}
        {visible.map(row => (
          <section key={row.id} className={css.card} data-feedback={row.id}>
            <p className={css.cardMeta}>
              {fmtTime(row.createdAt)} · {KIND_LABEL[row.kind]} · {row.authorKey}
              {row.context === undefined ? '' : ` · ${row.context}`}
            </p>
            <p className={css.cardText}>{row.body}</p>
            {row.reply !== undefined && (
              <p className={css.cardMeta}>
                {t('admin.notice.repliedBy')} {row.repliedBy} · {row.reply}
              </p>
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
          </section>
        ))}
      </div>

      <div className={css.list}>
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('admin.notice.publish')}</h3>
          {!canPublish && <p className={css.cardMeta}>{t('admin.notice.publishForbidden')}</p>}
          <div className={css.formRow}>
            <input className={css.input} placeholder={t('admin.notice.titleField')}
              value={notice.title}
              onChange={(event) => { setNotice(n => ({ ...n, title: event.target.value })) }} />
          </div>
          <textarea
            className={css.textarea} rows={4} data-testid="notice-body"
            placeholder={t('admin.notice.bodyField')}
            value={notice.body}
            onChange={(event) => { setNotice(n => ({ ...n, body: event.target.value })) }}
          />
          <div className={css.formRow}>
            <button
              type="button" className={css.primary}
              disabled={busy || !canPublish || notice.title.trim() === '' || notice.body.trim() === ''}
              onClick={() => {
                run(() => api.publishAnnouncement({
                  title: notice.title.trim(), body: notice.body.trim(),
                }).then(() => { setNotice({ title: '', body: '' }) }))
              }}
            >
              {t('admin.notice.publishRun')}
            </button>
          </div>
        </section>

        {announcements.map(row => (
          <section key={row.id} className={css.card} data-announcement={row.id}>
            <h3 className={css.cardTitle}>{row.title}</h3>
            <p className={css.cardMeta}>
              {row.schoolId === null ? t('admin.notice.scopePlatform') : row.schoolId}
              {' · '}{row.authorKey}
              {' · '}{fmtTime(row.publishedAt ?? row.createdAt)}
            </p>
            <p className={css.cardText}>{row.body}</p>
            {canPublish && (
              <button
                type="button" className={css.ghost} disabled={busy}
                onClick={() => { run(() => api.retireAnnouncement(row.id)) }}
              >
                {t('admin.notice.retire')}
              </button>
            )}
          </section>
        ))}
      </div>
    </>
  )
}
