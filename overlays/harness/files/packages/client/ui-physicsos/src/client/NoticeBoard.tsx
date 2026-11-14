/**
 * Feedback, the student-facing half.
 *
 * Platform announcements are a versioned shell overlay; this page is only the
 * outbound queue. The student sees their OWN reports back because the server
 * decides visibility and this pane renders the answer.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { IconArchive, IconBulb, IconChatBubble, IconQuestionSheet, IconUnverified, IconVerified } from './icons/physics-icons.tsx'
import { LoadingState } from './LoadingState.tsx'

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
  const panelId = useId()
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState<readonly FeedbackRow[]>([])
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [body, setBody] = useState('')
  const [contact, setContact] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    setError(undefined)
    setLoading(true)
    api.listFeedback()
      .then((feedback) => { setMine(feedback.items) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      }).finally(() => { setLoading(false) })
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

  const icons = { bug: IconUnverified, content: IconQuestionSheet, idea: IconBulb, other: IconArchive }

  return (
    <div className={css.root} data-physicsos-surface="notice">
      <header className={css.header}>
        <h1 className={css.title}><IconChatBubble size={34} />{t('notice.title')}</h1>
        <p className={css.subtitle}>{t('notice.subtitle')}</p>
      </header>
      <nav className={css.tabs} role="tablist" aria-label={t('notice.pageLabel')} onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
        const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? tab === 'new' ? 'history' : 'new'
          : event.key === 'Home' ? 'new' : event.key === 'End' ? 'history' : undefined
        if (next === undefined) return
        event.preventDefault(); setTab(next)
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === 'new' ? 0 : 1]?.focus()
      }}>
        <button type="button" role="tab" id={`${panelId}-new`} aria-controls={`${panelId}-content`} aria-selected={tab === 'new'} tabIndex={tab === 'new' ? 0 : -1} onClick={() => { setTab('new') }}>{t('notice.new')}</button>
        <button type="button" role="tab" id={`${panelId}-history`} aria-controls={`${panelId}-content`} aria-selected={tab === 'history'} tabIndex={tab === 'history' ? 0 : -1} onClick={() => { setTab('history') }}>{t('notice.mine')}</button>
      </nav>
      <div role="tabpanel" id={`${panelId}-content`} aria-labelledby={`${panelId}-${tab}`}>
        {tab === 'new' ? <div className={css.columns}>
          <form className={css.pane} data-testid="notice-feedback" onSubmit={(event) => { event.preventDefault(); if (!busy && body.trim()) submit() }}>
            <h2 className={css.paneTitle}>{t('notice.kindLabel')}</h2>
            <div className={css.kinds}>
              {KINDS.map((value) => {
                const Icon = icons[value]
                return <button key={value} type="button"
                  className={value === kind ? css.kindActive : css.kind}
                  aria-pressed={value === kind} onClick={() => { setKind(value) }}>
                  <Icon size={20} />{t(`notice.kind.${value}`)}
                </button>
              })}
            </div>
            <label className={css.field}>
              <span>{t('notice.description')}</span>
              <textarea className={css.textarea} rows={5} data-testid="feedback-body"
                placeholder={t(`notice.placeholder.${kind}`)} value={body} required
                onChange={(event) => { setBody(event.target.value); setSent(false) }} />
            </label>
            <label className={css.field}>
              <span>{t('notice.contactLabel')}</span>
              <input className={css.input} placeholder={t('notice.contact')} value={contact}
                onChange={(event) => { setContact(event.target.value) }} />
            </label>
            <div className={css.actions}>
              <button type="submit" className={css.primary} disabled={busy || body.trim() === ''}>
                {busy ? t('notice.sending') : t('notice.send')}
              </button>
              {sent && <span className={css.ok} role="status">{t('notice.sent')}</span>}
              {error !== undefined && <span className={css.error} role="alert">{error}</span>}
            </div>
          </form>
          <aside className={css.guide} aria-label={t('notice.guideLabel')}>
            <IconChatBubble size={38} />
            <h2>{t('notice.guideTitle')}</h2>
            <ol>
              <li><strong>{t('notice.guidePage')}</strong><span>{t('notice.guidePageHint')}</span></li>
              <li><strong>{t('notice.guideAction')}</strong><span>{t('notice.guideActionHint')}</span></li>
              <li><strong>{t('notice.guideResult')}</strong><span>{t('notice.guideResultHint')}</span></li>
            </ol>
            <p><IconVerified size={20} />{t('notice.privateHint')}</p>
          </aside>
        </div> : <section className={css.history} aria-label={t('notice.mine')}>
          <div className={css.historyActions}>
            <button type="button" className={css.kind} onClick={load} disabled={loading}>{t('notice.refresh')}</button>
            <button type="button" className={css.primary} onClick={() => { setTab('new') }}>{t('notice.new')}</button>
          </div>
          {error !== undefined && <p className={css.error} role="alert">{error}</p>}
          {loading && mine.length === 0 ? <LoadingState inline>{t('notice.loading')}</LoadingState>
            : mine.length === 0 ? <p className={css.empty}>{t('notice.empty')}</p>
              : mine.map((row) => {
                const Icon = icons[row.kind]
                return <details key={row.id} className={css.mine} data-mine={row.id}>
                  <summary><span className={css.historyIcon}><Icon size={22} /></span>
                    <span className={css.historyName}>{row.body}<small>{fmtTime(row.createdAt)} · {t(`notice.kind.${row.kind}`)}</small></span>
                    <span className={css.status} data-state={row.status}>{t(`notice.state.${row.status}`)}</span>
                  </summary>
                  <p className={css.body}>{row.body}</p>
                  <ol className={css.progress} aria-label={t('notice.progress')}>
                    <li data-complete>{t('notice.progress.submitted')}</li>
                    <li data-complete={row.status !== 'open' || undefined}>{t('notice.progress.pending')}</li>
                    <li data-complete={row.status === 'closed' || undefined}>{t('notice.progress.complete')}</li>
                  </ol>
                  {row.reply !== undefined && <p className={css.reply}><strong>{t('notice.reply')}</strong> {row.reply}</p>}
                </details>
              })}
        </section>}
      </div>
    </div>
  )
}
