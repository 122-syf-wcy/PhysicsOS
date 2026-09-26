/**
 * AuthGate — the PhysicsOS 账户体系 entrance, registered into `shell.overlay`.
 *
 * Three store states plus four gate views: `loading` paints a quiet brand splash so
 * the shell never flashes through, `guest` paints the full-screen
 * login/register/forgot flow, a URL or injected reset token paints the
 * redemption form, and `authed` renders nothing so the real shell shows. All
 * session-changing submits go through the injected controller callbacks; reset
 * submits use the injected callback or the package's same-origin API fallback.
 */

import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import {
  createAuthApi,
  type AdminApi,
  type AuthApiError,
  type IssuedPasswordReset,
  type LoginInput,
  type PasswordResetQueueRow,
  type RegisterInput,
  type SchoolRow,
} from './auth-api.ts'
import type { AuthState } from './auth-store.ts'
import type { PhysicsosKey } from './locales.ts'
import { buildStamp } from './build-stamp.ts'
import { GlassSelect } from './GlassSelect.tsx'
import css from './AuthGate.module.css'

/** Registration-side face for {@link AuthGate}. */
export interface AuthGateInjected {
  hooks: { auth: SnapshotStore<AuthState> }
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  forgotPassword: (input: { username: string; schoolId?: string }) => Promise<{ ok: boolean }>
  resetPassword?: (input: { token: string; newPassword: string }) => Promise<{ ok: boolean }>
}

export type AuthGateProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'physicsos'>
  & InjectFace<AuthGateInjected>
  & { resetToken?: string }

type View = 'login' | 'register' | 'forgot' | 'reset'

/** Read a reset token from either query or fragment without mutating history. */
function readResetToken(explicit?: string): string {
  if (explicit !== undefined && explicit !== '') return explicit
  if (typeof window === 'undefined') return ''
  const fromSearch = new URLSearchParams(window.location.search).get('reset_token')
  if (fromSearch !== null && fromSearch !== '') return fromSearch
  const fragment = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  return new URLSearchParams(fragment).get('reset_token') ?? ''
}

/** Remove a consumed token from the address bar before login is shown again. */
function clearResetToken(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('reset_token')
  window.history.replaceState({}, '', url)
}

/** The eye/eye-off affordance inside the password field. */
const EyeIcon = ({ hidden }: { hidden: boolean }): ReactNode => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M2.4 12s3.6-6.6 9.6-6.6S21.6 12 21.6 12 18 18.6 12 18.6 2.4 12 2.4 12Z"
      stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
    />
    {hidden
      ? <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      : <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.5" />}
  </svg>
)

/** Brand chrome shared by every gate view. */
function GateChrome({ t, children }: { t: (key: PhysicsosKey) => string; children: ReactNode }) {
  return (
    <div className={css.gate} data-physicsos-auth-gate="">
      <header className={css.topbar}>
        <span className={css.wordmark}>
          <PhysicsOSMark size={18} className={css.wordmarkIcon} />
          {t('brand.name')}
        </span>
        <span className={css.topLinks}>{t('auth.topLinks')}</span>
      </header>
      <main className={css.stage}>
        <PhysicsOSMark size={52} className={css.heroMark} />
        <h1 className={css.tagline}>{t('brand.tagline')}</h1>
        <p className={css.support}>{t('auth.support')}</p>
        {children}
      </main>
      <footer className={css.footer}>
        {t('auth.footerLinks')}
        {/* 登录页也要有版本戳:没登进来的用户同样会报障,而这是他们唯一能看
            到的地方。 */}
        <span className={css.buildStamp} data-build-stamp>{buildStamp()}</span>
      </footer>
    </div>
  )
}

/** One labeled field row of the gate form. */
function Field({ label, invalid, children }: { label: string; invalid?: boolean; children: ReactNode }) {
  return (
    <label className={css.field}>
      <span className={clsx(css.fieldLabel, invalid === true && css.fieldLabelInvalid)}>{label}</span>
      {children}
    </label>
  )
}

export function AuthGate({
  useAuth, login, register, forgotPassword, resetPassword, t, resetToken,
}: AuthGateProps) {
  const status = useAuth(state => state.status)
  const [token, setToken] = useState(() => readResetToken(resetToken))
  const [view, setView] = useState<View>(token === '' ? 'login' : 'reset')
  const [schoolName, setSchoolName] = useState('')
  const [candidates, setCandidates] = useState<SchoolRow[] | undefined>()
  const [schoolPick, setSchoolPick] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [terms, setTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  if (status === 'authed' && token === '') return null

  const switchView = (next: View): void => {
    setView(next)
    setError('')
    setForgotSent(false)
    setResetSent(false)
    setCandidates(undefined)
    setSchoolPick('')
  }

  const run = async (
    action: () => Promise<void>,
    onError?: (cause: AuthApiError) => void,
  ): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      const apiError = cause instanceof Error ? cause : new Error(t('auth.error.unknown'))
      setError(apiError.message)
      onError?.(apiError as AuthApiError)
      setBusy(false)
    }
    /* Success never clears `busy`: the controller reloads the page. */
  }

  const showCandidates = (cause: AuthApiError, code: string): void => {
    if (cause.code !== code || cause.candidates === undefined) return
    const first = cause.candidates[0]
    if (first === undefined) return
    setCandidates(cause.candidates)
    setSchoolPick(first.id)
  }

  /* Same-name schools only differ by region — the picker's label carries it. */
  const candidateLabel = (school: SchoolRow): string => {
    const region = [school.city, school.county].filter(Boolean).join(' ')
    return region === '' ? school.name : `${school.name}（${region}）`
  }

  const submitLogin = (event: FormEvent): void => {
    event.preventDefault()
    if (username.trim() === '' || password === '') { setError(t('auth.error.needCredentials')); return }
    void run(
      () => login({
        username: username.trim(),
        password,
        rememberDevice: remember,
        ...(schoolPick === '' ? {} : { schoolId: schoolPick }),
      }),
      (cause) => { showCandidates(cause, 'SCHOOL_REQUIRED') },
    )
  }

  const submitRegister = (event: FormEvent): void => {
    event.preventDefault()
    if (schoolName.trim() === '') { setError(t('auth.error.needSchool')); return }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) { setError(t('auth.error.usernameFormat')); return }
    if (displayName.trim() === '') { setError(t('auth.error.needName')); return }
    if (password.length < 8) { setError(t('auth.error.passwordShort')); return }
    if (password !== confirm) { setError(t('auth.error.passwordMismatch')); return }
    if (!terms) { setError(t('auth.error.needTerms')); return }
    void run(
      () => register({
        schoolName: schoolName.trim(),
        ...(schoolPick === '' ? {} : { schoolId: schoolPick }),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      }),
      (cause) => { showCandidates(cause, 'SCHOOL_AMBIGUOUS') },
    )
  }

  const submitForgot = (event: FormEvent): void => {
    event.preventDefault()
    if (username.trim() === '') { setError(t('auth.error.needUsername')); return }
    void run(async () => {
      await forgotPassword({ username: username.trim() })
      setForgotSent(true)
      setBusy(false)
    })
  }

  const submitReset = (event: FormEvent): void => {
    event.preventDefault()
    if (password.length < 8) { setError(t('auth.error.passwordShort')); return }
    if (password !== confirm) { setError(t('auth.error.passwordMismatch')); return }
    void run(async () => {
      const send = resetPassword ?? createAuthApi().resetPassword
      await send({ token, newPassword: password })
      clearResetToken()
      setResetSent(true)
      setBusy(false)
    })
  }

  if (status === 'loading' && token === '') {
    return (
      <GateChrome t={t}>
        <div className={css.form} aria-busy="true">
          <span className={css.loadingDot} />
        </div>
      </GateChrome>
    )
  }

  const passwordField = (
    <div className={css.passwordWrap}>
      <input
        className={css.input}
        type={showPassword ? 'text' : 'password'}
        autoComplete={view === 'register' || view === 'reset' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(event) => { setPassword(event.target.value) }}
      />
      <button
        type="button"
        className={css.eye}
        aria-label={showPassword ? t('auth.password.hide') : t('auth.password.show')}
        onClick={() => { setShowPassword(current => !current) }}
      >
        <EyeIcon hidden={!showPassword} />
      </button>
    </div>
  )

  return (
    <GateChrome t={t}>
      {view === 'login' && (
        <form className={css.form} onSubmit={submitLogin} noValidate data-physicsos-auth-view="login">
          <Field label={t('auth.username.label')}>
            <input
              className={css.input}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setCandidates(undefined)
                setSchoolPick('')
              }}
            />
          </Field>
          {candidates !== undefined && (
            <Field label={t('auth.school.pick')}>
              <GlassSelect
                className={css.select}
                value={schoolPick}
                ariaLabel={t('auth.school.pick')}
                testId="login-school"
                placeholder={t('auth.school.pick')}
                options={candidates.map(school => ({ value: school.id, label: candidateLabel(school) }))}
                onChange={setSchoolPick}
              />
            </Field>
          )}
          <Field label={t('auth.password.label')}>
            {passwordField}
          </Field>
          <div className={css.row}>
            <label className={css.checkbox}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => { setRemember(event.target.checked) }}
              />
              <span>{t('auth.remember')}</span>
            </label>
            <button type="button" className={css.link} onClick={() => { switchView('forgot') }}>
              {t('auth.forgot.link')}
            </button>
          </div>
          {error !== '' && <p className={css.error} role="alert">{error}</p>}
          <button type="submit" className={css.submit} disabled={busy}>
            {busy ? t('auth.busy') : t('auth.login.submit')}
          </button>
          <p className={css.alt}>
            {t('auth.login.noAccount')}
            <button type="button" className={css.link} onClick={() => { switchView('register') }}>
              {t('auth.login.toRegister')}
            </button>
          </p>
        </form>
      )}

      {view === 'register' && (
        <form className={css.form} onSubmit={submitRegister} noValidate data-physicsos-auth-view="register">
          <h2 className={css.formTitle}>{t('auth.register.title')}</h2>
          <Field label={t('auth.school.label')} invalid={error !== '' && schoolName.trim() === ''}>
            <input
              className={css.input}
              type="text"
              autoComplete="organization"
              placeholder={t('auth.school.registerPlaceholder')}
              value={schoolName}
              onChange={(event) => {
                setSchoolName(event.target.value)
                setCandidates(undefined)
                setSchoolPick('')
              }}
            />
          </Field>
          {candidates !== undefined && (
            <Field label={t('auth.school.pick')}>
              <GlassSelect
                className={css.select}
                value={schoolPick}
                ariaLabel={t('auth.school.pick')}
                testId="register-school"
                placeholder={t('auth.school.pick')}
                options={candidates.map(school => ({ value: school.id, label: candidateLabel(school) }))}
                onChange={setSchoolPick}
              />
            </Field>
          )}
          <Field label={t('auth.username.label')}>
            <input
              className={css.input}
              type="text"
              autoComplete="username"
              placeholder={t('auth.username.registerPlaceholder')}
              value={username}
              onChange={(event) => { setUsername(event.target.value) }}
            />
          </Field>
          <Field label={t('auth.displayName.label')}>
            <input
              className={css.input}
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value) }}
            />
          </Field>
          <Field label={t('auth.password.label')}>
            {passwordField}
          </Field>
          <Field label={t('auth.confirm.label')}>
            <input
              className={css.input}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => { setConfirm(event.target.value) }}
            />
          </Field>
          <label className={clsx(css.checkbox, css.terms)}>
            <input
              type="checkbox"
              checked={terms}
              onChange={(event) => { setTerms(event.target.checked) }}
            />
            <span>{t('auth.terms')}</span>
          </label>
          {error !== '' && <p className={css.error} role="alert">{error}</p>}
          <button type="submit" className={css.submit} disabled={busy}>
            {busy ? t('auth.busy') : t('auth.register.submit')}
          </button>
          <p className={css.alt}>
            {t('auth.register.hasAccount')}
            <button type="button" className={css.link} onClick={() => { switchView('login') }}>
              {t('auth.register.toLogin')}
            </button>
          </p>
        </form>
      )}

      {view === 'forgot' && (
        forgotSent
          ? (
            <div className={css.form} data-physicsos-auth-view="forgot">
              <h2 className={css.formTitle}>{t('auth.forgot.title')}</h2>
              <p className={css.receipt}>{t('auth.forgot.receipt')}</p>
              <button type="button" className={css.submit} onClick={() => { switchView('login') }}>
                {t('auth.forgot.back')}
              </button>
            </div>
          )
          : (
            <form className={css.form} onSubmit={submitForgot} noValidate>
              <h2 className={css.formTitle}>{t('auth.forgot.title')}</h2>
              <p className={css.receipt}>{t('auth.forgot.hint')}</p>
              <Field label={t('auth.username.label')}>
                <input
                  className={css.input}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => { setUsername(event.target.value) }}
                />
              </Field>
              {error !== '' && <p className={css.error} role="alert">{error}</p>}
              <button type="submit" className={css.submit} disabled={busy}>
                {busy ? t('auth.busy') : t('auth.forgot.submit')}
              </button>
              <p className={css.alt}>
                <button type="button" className={css.link} onClick={() => { switchView('login') }}>
                  {t('auth.forgot.toLogin')}
                </button>
              </p>
            </form>
          )
      )}

      {view === 'reset' && (
        resetSent
          ? (
            <div className={css.form} data-physicsos-auth-view="reset">
              <h2 className={css.formTitle}>{t('auth.reset.title')}</h2>
              <p className={css.receipt}>{t('auth.reset.receipt')}</p>
              <button
                type="button"
                className={css.submit}
                onClick={() => { window.location.reload() }}
              >
                {t('auth.reset.toLogin')}
              </button>
            </div>
          )
          : (
            <form className={css.form} onSubmit={submitReset} noValidate>
              <h2 className={css.formTitle}>{t('auth.reset.title')}</h2>
              <p className={css.receipt}>{t('auth.reset.hint')}</p>
              <Field label={t('auth.password.label')}>
                {passwordField}
              </Field>
              <Field label={t('auth.confirm.label')}>
                <input
                  className={css.input}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => { setConfirm(event.target.value) }}
                />
              </Field>
              {error !== '' && <p className={css.error} role="alert">{error}</p>}
              <button type="submit" className={css.submit} disabled={busy}>
                {busy ? t('auth.busy') : t('auth.reset.submit')}
              </button>
              <p className={css.alt}>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => {
                    clearResetToken()
                    setToken('')
                    setView('login')
                  }}
                >
                  {t('auth.forgot.toLogin')}
                </button>
              </p>
            </form>
          )
      )}
    </GateChrome>
  )
}

/** Admin-facing password-reset queue and one-time token reveal. */
export interface PasswordResetQueueProps {
  api: Pick<AdminApi, 'listPasswordResets' | 'issuePasswordReset' | 'cancelPasswordReset'>
  t: (key: PhysicsosKey) => string
}

const resetStatusKey = (status: PasswordResetQueueRow['status']): PhysicsosKey => {
  switch (status) {
    case 'pending': return 'admin.passwordResets.status.pending'
    case 'active': return 'admin.passwordResets.status.active'
    case 'used': return 'admin.passwordResets.status.used'
    case 'cancelled': return 'admin.passwordResets.status.cancelled'
    case 'expired': return 'admin.passwordResets.status.expired'
    case 'superseded': return 'admin.passwordResets.status.superseded'
    case 'delivery_failed': return 'admin.passwordResets.status.failed'
  }
}

export function PasswordResetQueue({ api, t }: PasswordResetQueueProps) {
  const [requests, setRequests] = useState<PasswordResetQueueRow[]>([])
  const [issued, setIssued] = useState<Map<string, IssuedPasswordReset>>(() => new Map())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = (): void => {
    setError('')
    api.listPasswordResets()
      .then((result) => { setRequests(result.requests) })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  useEffect(load, [api])

  const issue = (request: PasswordResetQueueRow): void => {
    setBusy(request.id)
    setError('')
    api.issuePasswordReset(request.id)
      .then((result) => {
        setIssued(current => new Map(current).set(request.id, result))
        setRequests(current =>
          current.map(row => row.id === request.id ? result.request : row))
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setBusy('') })
  }

  const cancel = (request: PasswordResetQueueRow): void => {
    setBusy(request.id)
    setError('')
    api.cancelPasswordReset(request.id)
      .then((result) => {
        setRequests(current =>
          current.map(row => row.id === request.id ? result.request : row))
        setIssued((current) => {
          const next = new Map(current)
          next.delete(request.id)
          return next
        })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setBusy('') })
  }

  return (
    <section className={css.form} data-physicsos-password-reset-queue="">
      <h2 className={css.formTitle}>{t('admin.passwordResets.title')}</h2>
      <p className={css.receipt}>{t('admin.passwordResets.hint')}</p>
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
      {requests.length === 0 && <p className={css.receipt}>{t('admin.empty')}</p>}
      {requests.map((request) => {
        const oneTime = issued.get(request.id)
        const finished = request.status === 'used'
          || request.status === 'cancelled'
          || request.status === 'superseded'
        return (
          <div key={request.id}>
            <p className={css.receipt}>
              {request.displayName} @{request.username}
              {' · '}{request.schoolName}
              {' · '}{t(resetStatusKey(request.status))}
            </p>
            {oneTime !== undefined && (
              <p className={css.receipt} data-reset-token={oneTime.token}>
                <code>{oneTime.resetPath}</code>
              </p>
            )}
            {!finished && (
              <div className={css.row}>
                <button
                  type="button"
                  className={css.link}
                  disabled={busy === request.id}
                  onClick={() => { issue(request) }}
                >
                  {t('admin.passwordResets.issue')}
                </button>
                <button
                  type="button"
                  className={css.link}
                  disabled={busy === request.id}
                  onClick={() => { cancel(request) }}
                >
                  {t('admin.passwordResets.cancel')}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
