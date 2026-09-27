/**
 * PhysicsOS Home.
 *
 * Home is the blank-Session Conversation panel, so the product occupies the
 * composer chain: while a Session has no messages the election below hides the
 * shell's resident hero chrome (its headline, workspace chip and agent-preset
 * row) and its chat composer, and this page becomes the only Home surface. The
 * student therefore sees exactly ONE input — the one in the hero — and no
 * Harness workspace / folder / mode identity at first level (docs 04 §Home).
 *
 * Layout, top to bottom: the brand copy, the single input with its 开始探索
 * action, the example chips, the two primary entry cards, 继续探索 over the
 * student's real PhysicsScenes, then 今日物理挑战.
 */

import { useCallback, useId, useRef, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import { HomeActions } from './HomeActions.tsx'
import { HomeBrand } from './HomeBrand.tsx'
import type { PhysicsSceneRef, RecentExperimentsState } from './surface-store.ts'
import css from './HomeHero.module.css'

/** Registration-side face: the product actions Home needs. */
export type HomeHeroInjected = {
  openSurface: (surface: 'home' | 'lab' | 'record', sceneRef?: PhysicsSceneRef) => void
  /** Queue one prompt on the student's current Session and let the tutor answer. */
  submitPrompt: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>
  hooks: {
    recentExperiments: SnapshotStore<RecentExperimentsState>
  }
}

/** Slot props for the blank-Session product front page. */
export type HomeHeroProps =
  & PropsLocale<'physicsos'>
  & InjectFace<HomeHeroInjected>

/**
 * Composer-chain election: the product page stands in for the shell composer
 * exactly while the current Session is blank and nothing else claims the seat.
 * A pending interaction (approval / question) always wins, and a Session with
 * messages falls back to the real transcript composer.
 * @param owner - the chain owner props.
 * @returns a non-null marker when Home should render, otherwise `null`.
 */
export function homeElection(owner: Pick<ComposerChainProps, 'session' | 'pendingInteraction'>): { home: true } | null {
  if (owner.pendingInteraction !== undefined) return null
  return owner.session?.blank === true ? { home: true } : null
}

/**
 * Render the PhysicsOS Home.
 * @param props - product copy, surface navigation, prompt submission, recent scenes.
 */
export function HomeHero({ openSurface, submitPrompt, useRecentExperiments, t }: HomeHeroProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const submit = useCallback(async (text: string): Promise<void> => {
    const prompt = text.trim()
    if (prompt === '' || busy) return
    setBusy(true)
    setError(null)
    const result = await submitPrompt(prompt)
    setBusy(false)
    if (result.ok) {
      setDraft('')
      return
    }
    setError(result.error)
  }, [busy, submitPrompt])

  const examples = ['examples.magnet', 'examples.projectile', 'examples.work'] as const

  return (
    <div className={css.root} data-physicsos-home="">
      <section className={css.hero} aria-label={t('brand.tagline')}>
        <HomeBrand t={t} />

        <form
          className={css.launch}
          onSubmit={(event) => {
            event.preventDefault()
            void submit(draft)
          }}
        >
          <label className={css.srOnly} htmlFor={inputId}>{t('home.input.aria')}</label>
          <div className={css.field}>
            <input
              ref={inputRef}
              id={inputId}
              className={css.input}
              type="text"
              value={draft}
              aria-invalid={error === null ? undefined : true}
              placeholder={t('home.input.placeholder')}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button type="submit" className={css.start} disabled={busy || draft.trim() === ''}>
              {busy ? t('home.input.busy') : t('home.input.start')}
              <IconChevronRightOutlineMedium size={15} />
            </button>
          </div>
          {error === null ? null : (
            <p className={css.error} role="alert">{error}</p>
          )}
        </form>

        <ul className={css.examples} aria-label={t('examples.label')}>
          {examples.map(key => (
            <li key={key}>
              <button
                type="button"
                className={css.example}
                onClick={() => {
                  setDraft(t(key))
                  inputRef.current?.focus()
                }}
              >
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <HomeActions
        openSurface={openSurface}
        useRecentExperiments={useRecentExperiments}
        t={t}
      />
    </div>
  )
}
