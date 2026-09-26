/** SUPER_ADMIN editor for the platform-wide internal-testing notice. */

import { useEffect, useId, useState } from 'react'
import type { NoticeApi, PlatformNoticeRow } from './notice-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './PlatformDialog.module.css'

export interface AdminPlatformNoticeTabProps {
  readonly api: NoticeApi
  readonly t: (key: PhysicsosKey) => string
}

const fmtTime = (iso: string): string => {
  if (iso === '') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function AdminPlatformNoticeTab({ api, t }: AdminPlatformNoticeTabProps): React.ReactNode {
  const titleId = useId()
  const bodyId = useId()
  const [notice, setNotice] = useState<PlatformNoticeRow | undefined>()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void api.getPlatformNotice().then(
      (result) => {
        if (!live) return
        setNotice(result.notice)
        setTitle(result.notice.title)
        setBody(result.notice.body)
        setEnabled(result.notice.enabled)
      },
      (cause: unknown) => {
        if (!live) return
        setError(cause instanceof Error ? cause.message : t('admin.platformNotice.loadError'))
      },
    )
    return () => { live = false }
  }, [api, t])

  if (notice === undefined) {
    return <p className={css.empty}>{error ?? t('admin.loading')}</p>
  }

  const valid = title.trim() !== '' && title.trim().length <= 80
    && body.trim() !== '' && body.trim().length <= 2000

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await api.updatePlatformNotice({
        title: title.trim(),
        body: body.trim(),
        enabled,
      })
      setNotice(result.notice)
      setTitle(result.notice.title)
      setBody(result.notice.body)
      setEnabled(result.notice.enabled)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.platformNotice.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.form} data-admin-platform-notice="">
      <div>
        <h2 className={css.title}>{t('admin.platformNotice.title')}</h2>
        <p className={css.hint}>{t('admin.platformNotice.hint')}</p>
        <p className={css.meta}>
          {t('admin.platformNotice.version').replace('{version}', String(notice.version))}
          {' · '}
          {t('admin.platformNotice.updatedBy')} {notice.updatedBy || '—'}
          {' · '}
          {fmtTime(notice.updatedAt)}
        </p>
      </div>
      <label className={css.field} htmlFor={titleId}>
        <span className={css.label}>{t('admin.platformNotice.titleField')}</span>
        <input
          id={titleId}
          className={css.input}
          maxLength={80}
          value={title}
          onChange={(event) => { setTitle(event.target.value) }}
        />
      </label>
      <label className={css.field} htmlFor={bodyId}>
        <span className={css.label}>{t('admin.platformNotice.bodyField')}</span>
        <textarea
          id={bodyId}
          className={css.textarea}
          maxLength={2000}
          rows={8}
          value={body}
          onChange={(event) => { setBody(event.target.value) }}
        />
      </label>
      <label className={css.label}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => { setEnabled(event.target.checked) }}
        />
        {' '}
        {t('admin.platformNotice.enabled')}
      </label>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.actions}>
        <button
          type="button"
          className={css.primary}
          disabled={busy || !valid}
          onClick={() => { void save() }}
        >
          {busy ? t('admin.platformNotice.saving') : t('admin.platformNotice.save')}
        </button>
      </div>
    </div>
  )
}
