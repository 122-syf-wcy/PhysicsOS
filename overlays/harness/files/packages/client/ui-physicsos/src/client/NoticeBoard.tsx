/**
 * 反馈与公告, the student-facing half.
 *
 * Two panes with one thing in common: this is where the product talks to the
 * people using it. Announcements come down; feedback goes up. They share a
 * surface because a report usually starts as a question about a notice
 * ("更新之后滑轮就没了").
 *
 * The student sees their OWN reports back — not because this component filters
 * them (the request would return the same rows either way) but because the
 * server decides visibility and this pane renders the answer. An empty list is
 * the server saying so.
 *
 * Offline behaviour (方案 2.3「离线时缓存上一条,不显示空白」): the two panes
 * settle INDEPENDENTLY and announcements come from a per-account cache when the
 * host is unreachable. Reporting a bug must not depend on the announcements
 * request succeeding — a student whose notice fetch failed still has a bug to
 * report, and the old single `Promise.all` took that form away with it.
 */
import { useCallback, useEffect, useState } from 'react'

import type { AnnouncementRow, FeedbackKind, FeedbackRow, NoticeApi } from './notice-api.ts'
import { readCachedAnnouncements, writeCachedAnnouncements, type NoticeCacheStorage } from './notice-cache.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './NoticeBoard.module.css'

export interface NoticeBoardProps {
  readonly api: NoticeApi
  /** Where the reporter was — free context for whoever reads the queue. */
  readonly context?: string
  /**
   * Account-namespaced storage for the offline announcement cache. Absent in
   * stripped compositions: the board still works, it just cannot show 公告
   * after a failed fetch.
   */
  readonly storage?: NoticeCacheStorage
  readonly t: (key: PhysicsosKey) => string
}

const KINDS: readonly FeedbackKind[] = ['bug', 'content', 'idea', 'other']

const fmtTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function NoticeBoard({ api, context, storage, t }: NoticeBoardProps) {
  /* Start from the cache: a reload with no network shows the last 公告 the
     server actually sent, instead of a blank pane. */
  const [announcements, setAnnouncements] = useState<readonly AnnouncementRow[]>(
    () => readCachedAnnouncements(storage),
  )
  /* Whether the announcements request has settled. Distinguishes "no notices
     yet" from "we have not asked yet" so the pane can say 加载中 once. */
  const [announcementsSettled, setAnnouncementsSettled] = useState(false)
  const [mine, setMine] = useState<readonly FeedbackRow[]>([])
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [body, setBody] = useState('')
  const [contact, setContact] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  /* Set only when the announcements fetch failed while we had something to
     show — the pane says "this is the last one we got" rather than pretending
     it is current. */
  const [stale, setStale] = useState(false)

  /* The two panes are independent on purpose. A failed 公告 fetch must not
     take the 反馈 form with it; a failed 反馈 fetch must not blank 公告. */
  const load = useCallback(() => {
    api.listAnnouncements()
      .then((notices) => {
        setAnnouncements(notices.items)
        setStale(false)
        writeCachedAnnouncements(storage, notices.items)
      })
      .catch((reason: unknown) => {
        const cached = readCachedAnnouncements(storage)
        setAnnouncements(cached)
        setStale(cached.length > 0)
        /* Only shout if there is nothing to show — a cached notice is a better
           answer than an error message about a fetch nobody can act on. */
        if (cached.length === 0) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setAnnouncementsSettled(true) })

    api.listFeedback()
      .then((feedback) => { setMine(feedback.items) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [api, storage])

  useEffect(load, [load])

  const submit = (): void => {
    setBusy(true)
    setError(undefined)
    setSent(false)
    api.submitFeedback({
      kind,
      body: body.trim(),
      ...(contact.trim() === '' ? {} : { contact: contact.trim() }),
      ...(context === undefined ? {} : { context }),
    }).then(() => {
      setBody('')
      setContact('')
      setSent(true)
      load()
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }

  /* Scoped to the 公告 pane, never to the whole surface: an unreachable notice
     host is a reason to lose the notices, not the bug-report form. */
  const announcementsEmpty = !announcementsSettled
    ? t('notice.loading')
    : announcements.length === 0
      ? (error ?? t('notice.noAnnouncements'))
      : undefined

  return (
    <div className={css.root} data-physicsos-surface="notice">
      <header className={css.header}>
        <h1 className={css.title}>{t('notice.title')}</h1>
      </header>

      {/* Both panes scroll independently: reading a long notice must not push
          the feedback form off the screen, and vice versa. */}
      <div className={css.columns}>
        <section className={css.pane} data-testid="notice-announcements">
          <h2 className={css.paneTitle}>{t('notice.announcements')}</h2>
          {/* Says the notices are old rather than letting a stale one read as
              current — the plan asked for the last announcement, not a lie. */}
          {stale && <p className={css.stale} data-notice-stale="">{t('notice.stale')}</p>}
          {announcementsEmpty !== undefined && <p className={css.empty}>{announcementsEmpty}</p>}
          {announcements.map(row => (
            <article key={row.id} className={css.notice} data-announcement={row.id}>
              <h3 className={css.noticeTitle}>{row.title}</h3>
              <p className={css.meta}>
                {row.schoolId === null ? t('notice.scopePlatform') : t('notice.scopeSchool')}
                {' · '}{fmtTime(row.publishedAt ?? row.createdAt)}
              </p>
              <p className={css.body}>{row.body}</p>
            </article>
          ))}
        </section>

        <section className={css.pane} data-testid="notice-feedback">
          <h2 className={css.paneTitle}>{t('notice.feedback')}</h2>
          <div className={css.kinds}>
            {KINDS.map(value => (
              <button
                key={value} type="button"
                className={value === kind ? css.kindActive : css.kind}
                aria-pressed={value === kind}
                onClick={() => { setKind(value) }}
              >
                {t(`notice.kind.${value}`)}
              </button>
            ))}
          </div>
          <textarea
            className={css.textarea} rows={5} data-testid="feedback-body"
            placeholder={t(`notice.placeholder.${kind}`)}
            value={body}
            onChange={(event) => { setBody(event.target.value) }}
          />
          <input
            className={css.input}
            placeholder={t('notice.contact')}
            value={contact}
            onChange={(event) => { setContact(event.target.value) }}
          />
          <div className={css.actions}>
            <button
              type="button" className={css.primary}
              disabled={busy || body.trim() === ''}
              onClick={submit}
            >
              {busy ? t('notice.sending') : t('notice.send')}
            </button>
            {sent && <span className={css.ok}>{t('notice.sent')}</span>}
            {error !== undefined && <span className={css.error}>{error}</span>}
          </div>

          {/* What the reporter has already said, so nobody sends the same bug
              twice — the server returns only their own rows here. */}
          {mine.length > 0 && (
            <>
              <h3 className={css.historyTitle}>{t('notice.mine')}</h3>
              {mine.map(row => (
                <article key={row.id} className={css.mine} data-mine={row.id}>
                  <p className={css.meta}>
                    {fmtTime(row.createdAt)} · {t(`notice.kind.${row.kind}`)}
                    {' · '}{t(`notice.state.${row.status}`)}
                  </p>
                  <p className={css.body}>{row.body}</p>
                  {row.reply !== undefined && (
                    <p className={css.reply}>
                      <strong>{t('notice.reply')}</strong> {row.reply}
                    </p>
                  )}
                </article>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
