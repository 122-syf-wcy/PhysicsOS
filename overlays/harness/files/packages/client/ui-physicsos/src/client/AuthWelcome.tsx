/**
 * Presentation-only authentication welcome. Artwork stays in its own story
 * column, never behind the form. Account and permission decisions belong to
 * AuthGate's injected callbacks and the existing auth host.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Mascot } from './Mascot.tsx'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import { ProfileIcon } from './ProfileIcons.tsx'
import type { PhysicsosKey } from './locales.ts'
import { buildStamp } from './build-stamp.ts'
import css from './AuthGate.module.css'

export type AuthWelcomeView = 'login' | 'register' | 'forgot' | 'reset' | 'pending' | 'loading'
export type AuthInfoPanel = 'help' | 'roles' | 'culture' | 'privacy' | 'terms'

interface AuthWelcomeProps {
  t: (key: PhysicsosKey) => string
  view: AuthWelcomeView
  heading?: PhysicsosKey | undefined
  busy?: boolean | undefined
  onBack?: (() => void) | undefined
  children: (actions: { showInfo: (panel: AuthInfoPanel) => void }) => ReactNode
}

const headings: Record<AuthWelcomeView, PhysicsosKey> = {
  login: 'auth.login.title', register: 'auth.register.title',
  forgot: 'auth.forgot.title', reset: 'auth.reset.title',
  pending: 'auth.pending.title', loading: 'auth.welcome.loading',
}

const supports: Record<AuthWelcomeView, PhysicsosKey> = {
  login: 'auth.login.support', register: 'auth.support',
  forgot: 'auth.forgot.hint', reset: 'auth.reset.hint',
  pending: 'auth.pending.status', loading: 'auth.busy',
}

function CultureSources({ t }: Pick<AuthWelcomeProps, 't'>) {
  return (
    <>
      <p>{t('auth.welcome.cultureBody')}</p>
      <p>{t('auth.welcome.cultureBoundary')}</p>
      <div className={css.sourceLinks}>
        <a href="https://www.ihchina.cn/art/detail/id/13989.html" target="_blank" rel="noopener noreferrer">
          {t('auth.welcome.embroiderySource')}
        </a>
        <a href="https://www.ihchina.cn/art/detail/id/14331.html" target="_blank" rel="noopener noreferrer">
          {t('auth.welcome.silverSource')}
        </a>
      </div>
    </>
  )
}

/** Native modal focus/keyboard handling; the open attribute is only a test fallback. */
function AuthInfo({ panel, close, t }: { panel: AuthInfoPanel; close: () => void; t: AuthWelcomeProps['t'] }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog === null) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus()
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (trigger?.isConnected === true) trigger.focus({ preventScroll: true })
    }
  }, [])

  const titleKey: Record<AuthInfoPanel, PhysicsosKey> = {
    help: 'auth.welcome.helpTitle', roles: 'auth.welcome.rolesTitle',
    culture: 'auth.welcome.culture', privacy: 'auth.welcome.privacy', terms: 'auth.welcome.terms',
  }

  return (
    <dialog
      ref={dialogRef}
      className={css.infoDialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
      }}
    >
      <div className={css.infoHeader}>
        <h2 id={titleId}>{t(titleKey[panel])}</h2>
        <button ref={closeRef} type="button" className={css.infoClose} onClick={close}>
          {t('auth.welcome.close')}
        </button>
      </div>
      <div className={css.infoBody}>
        {panel === 'help' && (
          <>
            <h3>{t('auth.welcome.helpAccountTitle')}</h3>
            <p>{t('auth.welcome.helpAccount')}</p>
            <h3>{t('auth.welcome.helpSchoolTitle')}</h3>
            <p>{t('auth.welcome.helpSchool')}</p>
            <h3>{t('auth.welcome.helpRecoveryTitle')}</h3>
            <p>{t('auth.welcome.helpRecovery')}</p>
            <h3>{t('auth.welcome.rolesTitle')}</h3>
            <p>{t('auth.welcome.roles')}</p>
          </>
        )}
        {panel === 'roles' && <p>{t('auth.welcome.roles')}</p>}
        {panel === 'terms' && <p>{t('auth.welcome.termsBody')}</p>}
        {panel === 'privacy' && <p>{t('auth.welcome.privacyBody')}</p>}
        {panel === 'culture' && <CultureSources t={t} />}
      </div>
    </dialog>
  )
}

function StoryArtwork({ joining, t }: { joining: boolean; t: AuthWelcomeProps['t'] }) {
  const [failed, setFailed] = useState(false)
  const name = joining ? 'join' : 'welcome'
  const base = `/physicsos/auth-heritage/${name}`

  return (
    <div className={css.storyFrame} data-auth-artwork={name}>
      <div className={css.storyCopy}>
        <span className={css.storyLabel}>{t('auth.welcome.storyLabel')}</span>
        <h2>{t(joining ? 'auth.welcome.joinTitle' : 'auth.welcome.storyTitle')}</h2>
        <p>{t(joining ? 'auth.welcome.joinBody' : 'auth.welcome.storyBody')}</p>
      </div>
      {failed ? (
        <div className={css.artFallback} data-testid="auth-art-fallback">
          <Mascot pose={joining ? 'think' : 'wave'} size={240} float={false} />
          <p>{t('auth.welcome.imageFallback')}</p>
        </div>
      ) : (
        <picture className={css.storyPicture}>
          <source
            type="image/avif"
            srcSet={`${base}-440.avif 440w, ${base}-880.avif 880w`}
            sizes="(max-width: 900px) 1px, (max-width: 1160px) calc(50vw - 56px), 500px"
          />
          <img
            src={`${base}-880.webp`}
            srcSet={`${base}-440.webp 440w, ${base}-880.webp 880w`}
            sizes="(max-width: 900px) 1px, (max-width: 1160px) calc(50vw - 56px), 500px"
            width={880}
            height={1184}
            alt={t(joining ? 'auth.welcome.joinImageAlt' : 'auth.welcome.imageAlt')}
            decoding="async"
            loading="lazy"
            draggable={false}
            onError={() => { setFailed(true) }}
          />
        </picture>
      )}
    </div>
  )
}

export function AuthWelcome({ t, view, heading, busy = false, onBack, children }: AuthWelcomeProps) {
  const [info, setInfo] = useState<AuthInfoPanel>()
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingKey = heading ?? headings[view]
  const lastHeading = useRef(headingKey)
  const joining = view === 'register' || view === 'pending'

  useEffect(() => {
    if (lastHeading.current !== headingKey) headingRef.current?.focus({ preventScroll: false })
    lastHeading.current = headingKey
  }, [headingKey])

  const eyebrowKey = joining ? 'auth.welcome.registerEyebrow'
    : view === 'forgot' || view === 'reset' ? 'auth.welcome.recoveryEyebrow' : 'auth.welcome.eyebrow'

  return (
    <div className={css.gate} data-physicsos-auth-gate="" data-auth-layout="heritage" data-auth-screen={view}>
      <header className={css.topbar}>
        <a className={css.wordmark} href="/physicsos/website/index.html" aria-label={t('auth.welcome.about')}>
          <PhysicsOSMark size={34} className={css.wordmarkIcon} />
          <span>{t('brand.name')}<small>{t('auth.welcome.platform')}</small></span>
        </a>
        <nav className={css.topLinks} aria-label={t('auth.welcome.help')}>
          <button type="button" className={css.helpButton} onClick={() => { setInfo('help') }}>
            <ProfileIcon id="physics-tutor" />
            {t('auth.welcome.help')}
          </button>
          <a href="/physicsos/website/index.html" className={css.aboutLink}>{t('auth.welcome.about')}</a>
        </nav>
      </header>

      <main className={css.stage}>
        <section className={css.formPanel} aria-labelledby={titleId}>
          {onBack !== undefined && (
            <button type="button" className={css.backButton} disabled={busy} onClick={onBack}>
              <span aria-hidden="true" className={css.backArrow} />{t('auth.welcome.back')}
            </button>
          )}
          <div className={css.welcomeHeading}>
            <div className={css.mobileMascot}>
              <Mascot pose={joining ? 'think' : 'wave'} variant="avatar" size={64} float={false} />
            </div>
            <p className={css.eyebrow}>{t(eyebrowKey)}</p>
            <h1 id={titleId} ref={headingRef} className={css.tagline} tabIndex={-1}>{t(headingKey)}</h1>
            <p className={css.support}>{t(supports[view])}</p>
          </div>
          {children({ showInfo: setInfo })}
        </section>

        <aside className={css.storyPanel} aria-label={t('auth.welcome.storyLabel')}>
          <StoryArtwork key={joining ? 'join' : 'welcome'} joining={joining} t={t} />
          <button type="button" className={css.cultureLink} onClick={() => { setInfo('culture') }}>
            <span className={css.cultureStitch} aria-hidden="true" />{t('auth.welcome.culture')}
          </button>
        </aside>
      </main>

      <footer className={css.footer}>
        <span className={css.footerMotto}>{t('auth.welcome.footer')}</span>
        <div className={css.footerLinks}>
          <button type="button" onClick={() => { setInfo('privacy') }}>{t('auth.welcome.privacy')}</button>
          <button type="button" onClick={() => { setInfo('terms') }}>{t('auth.welcome.terms')}</button>
          <button type="button" className={css.mobileCulture} onClick={() => { setInfo('culture') }}>{t('auth.welcome.culture')}</button>
        </div>
        <span className={css.buildStamp} data-build-stamp>{buildStamp()}</span>
      </footer>
      {info !== undefined && <AuthInfo panel={info} t={t} close={() => { setInfo(undefined) }} />}
    </div>
  )
}
