/** Account-scoped PhysicsOS platform notice. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import type { AuthState } from './auth-store.ts'
import { markdownLabels } from './markdown-labels.ts'
import type { NoticeApi, PlatformNoticeRow } from './notice-api.ts'
import css from './PlatformDialog.module.css'

export interface PlatformNoticeDialogInjected {
  readonly api: NoticeApi
  readonly hooks: {
    readonly auth: SnapshotStore<AuthState>
  }
}

export type PlatformNoticeDialogProps =
  InjectFace<PlatformNoticeDialogInjected>
  & PropsLocale<'physicsos'>

/**
 * Show the current platform notice until this account has acknowledged this
 * exact version. Acknowledgement is stored by notice-host, not in the
 * deployment-wide settings document, so two accounts never share a receipt.
 */
export function PlatformNoticeDialog({
  api, useAuth, t,
}: PlatformNoticeDialogProps): ReactNode {
  const titleId = useId()
  const status = useAuth(state => state.status)
  const userId = useAuth(state => state.user?.id)
  const [notice, setNotice] = useState<PlatformNoticeRow | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (status !== 'authed' || userId === undefined) {
      setNotice(undefined)
      setError(undefined)
      return
    }
    let live = true
    setNotice(undefined)
    setError(undefined)
    void api.getPlatformNotice().then(
      (result) => {
        if (!live) return
        if (!result.notice.enabled || result.acknowledgedVersion === result.notice.version) return
        setNotice(result.notice)
      },
      () => {
        /* A transient notice-host failure must not block the whole product.
           The upstream onboarding step is independently suppressed. */
      },
    )
    return () => { live = false }
  }, [api, status, userId])

  if (notice === undefined) return null

  const acknowledge = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await api.ackPlatformNotice(notice.version)
      setNotice(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('platformNotice.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.backdrop} data-physicsos-platform-notice="">
      <section
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={css.header}>
          <div>
            <p className={css.eyebrow}>PhysicsOS · 公测</p>
            <h2 id={titleId} className={css.title}>{notice.title}</h2>
          </div>
        </header>
        <div className={css.copy}>
          <MarkdownText text={notice.body} labels={markdownLabels(t)} />
        </div>
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
        <div className={css.actions}>
          <button
            type="button"
            className={css.primary}
            disabled={saving}
            onClick={() => { void acknowledge() }}
          >
            {saving ? t('platformNotice.saving') : t('platformNotice.continue')}
          </button>
        </div>
      </section>
    </div>
  )
}

/**
 * Keep the upstream Harness onboarding ledger occupied forever.
 *
 * `settings.onboarding` renders only the first incomplete step. PhysicsOS
 * owns model configuration server-side, so neither the upstream developer
 * notice nor its API-key setup step belongs in the product. Returning null
 * without calling `complete` is the only seam that suppresses both without
 * editing the upstream package.
 */
export function UpstreamOnboardingSink(): null {
  return null
}
