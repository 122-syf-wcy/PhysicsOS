/**
 * Feedback, the student-facing half.
 *
 * Platform announcements are a versioned shell overlay; this page is only the
 * outbound queue. The student sees their OWN reports back because the server
 * decides visibility and this pane renders the answer.
 */
import { useCallback, useEffect, useState } from 'react'

import type { FeedbackKind, FeedbackRow, NoticeApi } from './notice-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './NoticeBoard.module.css'

export interface NoticeBoardProps {
  readonly api: NoticeApi
  /** Where the reporter was — free context for whoever reads the queue. */
  readonly context?: string
  readonly t: (key: PhysicsosKey) => string
}

const KINDS: readonly FeedbackKind[] = ['bug', 'content', 'idea', 'other']

const fmtTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function NoticeBoard({ api, context, t }: NoticeBoardProps) {
  const [mine, setMine] = useState<readonly FeedbackRow[]>([])
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [body, setBody] = useState('')
  const [contact, setContact] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    setError(undefined)
    api.listFeedback()
      .then((feedback) => { setMine(feedback.items) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [api])

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

  return (
    <div className={css.root} data-physicsos-surface="notice">
      <header className={css.header}>
        <h1 className={css.title}>{t('notice.title')}</h1>
      </header>

      <div className={css.columns}>
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
