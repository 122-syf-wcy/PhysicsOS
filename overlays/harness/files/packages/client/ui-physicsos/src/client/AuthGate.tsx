/**
 * AuthGate — the PhysicsOS account entrance registered into `shell.overlay`.
 * The welcome is presentation-only. Real login, school review and recovery
 * continue through the injected controller/API; no role or session is invented.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Mascot } from './Mascot.tsx'
import { AuthWelcome } from './AuthWelcome.tsx'
import {
  createAuthApi,
  type AdminApi,
  type AuthApiError,
  type IssuedPasswordReset,
  type LoginInput,
  type PasswordResetQueueRow,
  type RegisterInput,
  type RegisterOutcome,
  type SchoolRow,
} from './auth-api.ts'
import type { AuthState } from './auth-store.ts'
import type { PhysicsosKey } from './locales.ts'
import { GlassSelect } from './GlassSelect.tsx'
import { IconObservable, IconRefresh, IconTime, IconUnverified, IconVerified } from './icons/physics-icons.tsx'
import {
  AdminCard,
  AdminCardMeta,
  AdminCardTitle,
  AdminEmpty,
} from './AdminPrimitives.tsx'
import css from './AuthGate.module.css'
import adminCss from './AdminWorkspace.module.css'

/** Registration-side face for {@link AuthGate}. */
export interface AuthGateInjected {
  hooks: { auth: SnapshotStore<AuthState> }
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<RegisterOutcome>
  /** Public school lookup, injected so tests need no network. */
  searchSchools: (query: string) => Promise<{ schools: SchoolRow[] }>
  forgotPassword: (input: { username: string; schoolId?: string }) => Promise<{ ok: boolean }>
  resetPassword?: (input: { token: string; newPassword: string }) => Promise<{ ok: boolean }>
}

export type AuthGateProps =
  PropsLocale<'physicsos'>
  & InjectFace<AuthGateInjected>
  & { resetToken?: string }

type View = 'login' | 'register' | 'forgot' | 'reset'
type FieldName = 'school' | 'username' | 'displayName' | 'email' | 'password' | 'confirm' | 'terms'
type LookupState = 'idle' | 'searching' | 'ready' | 'failed'
interface FormError {
  message?: string | undefined
  key?: PhysicsosKey | undefined
  field?: FieldName | undefined
  code?: string | undefined
}

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

/** Remove only reset parameters, preserving other URL state and router history. */
function clearResetToken(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('reset_token')
  const fragment = new URLSearchParams(url.hash.slice(1))
  if (fragment.has('reset_token')) {
    fragment.delete('reset_token')
    url.hash = fragment.toString()
  }
  window.history.replaceState(window.history.state, '', url)
}

/** Preserve the existing eye-off SVG; visible eye reuses the semantic icon set. */
const HiddenEyeIcon = (): ReactNode => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2.4 12s3.6-6.6 9.6-6.6S21.6 12 21.6 12 18 18.6 12 18.6 2.4 12 2.4 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

/** Explicit label association avoids wrapping an input and eye button in a label. */
function Field({ label, id, invalid, hint, children }: {
  label: string; id?: string | undefined; invalid?: boolean | undefined; hint?: string | undefined; children: ReactNode
}) {
  return (
    <div className={css.field}>
      <label htmlFor={id} className={clsx(css.fieldLabel, invalid === true && css.fieldLabelInvalid)}>{label}</label>
      {children}
      {hint !== undefined && <p className={css.fieldHint} id={`${id}-hint`}>{hint}</p>}
    </div>
  )
}

function PasswordInput({ id, name, value, onChange, autoComplete, invalid, describedBy, t }: {
  id: string; name: 'password' | 'confirm'; value: string; onChange: (value: string) => void
  autoComplete: 'new-password' | 'current-password'; invalid: boolean; describedBy?: string | undefined
  t: (key: PhysicsosKey) => string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={css.passwordWrap}>
      <input
        id={id}
        name={name}
        className={css.input}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => { onChange(event.target.value) }}
      />
      <button
        type="button"
        className={css.eye}
        aria-label={t(name === 'confirm'
          ? visible ? 'auth.confirm.hide' : 'auth.confirm.show'
          : visible ? 'auth.password.hide' : 'auth.password.show')}
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => { setVisible(current => !current) }}
      >
        {visible ? <IconObservable size={20} /> : <HiddenEyeIcon />}
      </button>
    </div>
  )
}

function SubmitButton({ busy, label, t }: { busy: boolean; label: PhysicsosKey; t: (key: PhysicsosKey) => string }) {
  return (
    <button type="submit" className={css.submit} disabled={busy}>
      {busy && <span className={css.spinner} aria-hidden="true" />}
      {t(busy ? 'auth.busy' : label)}
    </button>
  )
}

export function AuthGate({
  useAuth, login, register, forgotPassword, resetPassword, searchSchools, t, resetToken,
}: AuthGateProps) {
  const status = useAuth(state => state.status)
  const [token, setToken] = useState(() => readResetToken(resetToken))
  const [view, setView] = useState<View>(token === '' ? 'login' : 'reset')
  const [schoolName, setSchoolName] = useState('')
  const [candidates, setCandidates] = useState<SchoolRow[]>()
  const [schoolPick, setSchoolPick] = useState('')
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow>()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [terms, setTerms] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<FormError>()
  const [busy, setBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [options, setOptions] = useState<SchoolRow[]>()
  const [lookup, setLookup] = useState<LookupState>('idle')
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [schoolOpen, setSchoolOpen] = useState(false)
  const [activeSchool, setActiveSchool] = useState(-1)
  const [pendingReview, setPendingReview] = useState<Extract<RegisterOutcome, { kind: 'pending' }>>()
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const schoolInputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const id = useId()
  const fieldId = (name: FieldName): string => `${id}-${name}`
  const errorId = `${id}-error`
  const listId = `${id}-school-options`
  const errorText = error?.key !== undefined ? t(error.key) : error?.message ?? ''

  const stopBusy = (): void => { busyRef.current = false; setBusy(false) }
  const clearFieldError = (name: FieldName): void => {
    setError(current => current?.field === name ? undefined : current)
  }
  const fail = (key: PhysicsosKey, field?: FieldName): void => { setError({ key, field }) }
  const invalid = (name: FieldName): boolean => error?.field === name
  const describe = (name: FieldName, hint = false): string | undefined => {
    const ids = [hint ? `${fieldId(name)}-hint` : '', invalid(name) ? errorId : ''].filter(Boolean)
    return ids.length === 0 ? undefined : ids.join(' ')
  }

  const switchView = (next: View): void => {
    if (busyRef.current) return
    const recoverySchool = next === 'forgot'
      ? selectedSchool ?? candidates?.find(school => school.id === schoolPick)
      : undefined
    setView(next)
    setError(undefined)
    setForgotSent(false)
    setResetSent(false)
    setCandidates(undefined)
    setOptions(undefined)
    setLookup('idle')
    setSchoolOpen(false)
    setActiveSchool(-1)
    setSchoolPick(recoverySchool?.id ?? '')
    setSelectedSchool(recoverySchool)
    if (next === 'forgot') setSchoolName(recoverySchool?.name ?? '')
    // Never carry a newly chosen/redeemed password into the login fields.
    if (view === 'reset' || next === 'forgot') { setPassword(''); setConfirm('') }
  }

  const run = async (action: () => Promise<void>, onError?: (cause: AuthApiError) => void): Promise<void> => {
    // Ref closes the same-tick keyboard/double-click gap before React disables controls.
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
      // Login/registered success stays busy until the real controller reloads.
      // Receipt-producing actions explicitly release busy only after their response.
    } catch (cause) {
      const apiError = cause instanceof Error ? cause as AuthApiError : undefined
      const code = apiError?.code
      const field: FieldName | undefined = code === 'SCHOOL_REQUIRED' || code === 'SCHOOL_AMBIGUOUS' ? 'school'
        : code === 'USERNAME_TAKEN' ? 'username' : code === 'INVALID_CREDENTIALS' ? 'password' : undefined
      if (apiError instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(apiError?.message ?? '')) {
        setError({ key: 'auth.error.network' })
      } else {
        setError(apiError?.message ? { message: apiError.message, code, field } : { key: 'auth.error.unknown' })
      }
      if (apiError !== undefined) onError?.(apiError)
      stopBusy()
    }
  }

  const showCandidates = (cause: AuthApiError, code: string): void => {
    if (cause.code !== code || cause.candidates === undefined || cause.candidates.length === 0) return
    setCandidates(cause.candidates)
    setSchoolPick('')
    setSelectedSchool(undefined)
    setActiveSchool(-1)
    setSchoolOpen(true)
  }

  const candidateLabel = (school: SchoolRow): string => {
    const region = [school.city, school.county].filter(Boolean).join(' ')
    return region === '' ? school.name : `${school.name}（${region}）`
  }

  // Both registration and optional recovery lookup use the existing public API.
  // Cancellation prevents old answers from replacing a new query or chosen tenant.
  useEffect(() => {
    if ((view !== 'register' && view !== 'forgot') || status === 'authed' || pendingReview !== undefined) return
    const needle = schoolName.trim()
    if (needle === '' || schoolPick !== '' || candidates !== undefined) {
      setOptions(undefined)
      setLookup('idle')
      return
    }
    let cancelled = false
    setOptions(undefined)
    setLookup('searching')
    setActiveSchool(-1)
    const timer = setTimeout(() => {
      void searchSchools(needle).then((result) => {
        if (cancelled) return
        setOptions(result.schools)
        setLookup('ready')
      }).catch(() => {
        if (cancelled) return
        // A failed connection is not evidence that the school is unlisted.
        setOptions(undefined)
        setLookup('failed')
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [schoolName, schoolPick, candidates, view, searchSchools, status, lookupAttempt, pendingReview])

  // A visible, announced error also receives keyboard focus. Client errors focus
  // the offending control; server/network errors focus the non-secret summary.
  useEffect(() => {
    if (error === undefined) return
    const field = error.field === 'school' && view === 'login'
      ? formRef.current?.querySelector<HTMLElement>('[data-testid="login-school"]')
      : error.field === undefined ? undefined : formRef.current?.querySelector<HTMLElement>(`[name="${error.field}"]`)
    const target = field ?? errorRef.current
    target?.focus()
  }, [error, view])

  useEffect(() => {
    if (activeSchool < 0) return
    const option = document.getElementById(`${listId}-${activeSchool}`)
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  }, [activeSchool, listId])

  const chooseSchool = (school: SchoolRow): void => {
    setSchoolName(school.name)
    setSchoolPick(school.id)
    setSelectedSchool(school)
    setOptions(undefined)
    setCandidates(undefined)
    setLookup('idle')
    setSchoolOpen(false)
    setActiveSchool(-1)
    clearFieldError('school')
    schoolInputRef.current?.focus({ preventScroll: true })
  }

  const dropdown = candidates ?? options
  const dropdownVisible = schoolOpen && dropdown !== undefined && dropdown.length > 0
  const schoolKeyboard = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') { setSchoolOpen(false); setActiveSchool(-1); return }
    if (dropdown === undefined || dropdown.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSchoolOpen(true)
      setActiveSchool(current => event.key === 'ArrowDown'
        ? (current + 1) % dropdown.length : current <= 0 ? dropdown.length - 1 : current - 1)
    } else if (event.key === 'Enter' && dropdownVisible && activeSchool >= 0 && !event.nativeEvent.isComposing) {
      const school = dropdown[activeSchool]
      if (school === undefined) return
      event.preventDefault()
      chooseSchool(school)
    }
  }

  const submitLogin = (event: FormEvent): void => {
    event.preventDefault()
    if (busyRef.current) return
    if (username.trim() === '') { fail('auth.error.needCredentials', 'username'); return }
    if (password === '') { fail('auth.error.needCredentials', 'password'); return }
    if (candidates !== undefined && schoolPick === '') { fail('auth.error.chooseSchool', 'school'); return }
    void run(() => login({
      username: username.trim(), password, rememberDevice: remember,
      ...(schoolPick === '' ? {} : { schoolId: schoolPick }),
    }), cause => { showCandidates(cause, 'SCHOOL_REQUIRED') })
  }

  const submitRegister = (event: FormEvent): void => {
    event.preventDefault()
    if (busyRef.current) return
    if (schoolName.trim() === '') { fail('auth.error.needSchool', 'school'); return }
    if (candidates !== undefined && schoolPick === '') { fail('auth.error.chooseSchool', 'school'); return }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) { fail('auth.error.usernameFormat', 'username'); return }
    if (displayName.trim() === '') { fail('auth.error.needName', 'displayName'); return }
    if (email.trim() === '') { fail('auth.error.needEmail', 'email'); return }
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s.]+$/.test(email.trim())) { fail('auth.error.emailFormat', 'email'); return }
    if (password.length < 8) { fail('auth.error.passwordShort', 'password'); return }
    if (password !== confirm) { fail('auth.error.passwordMismatch', 'confirm'); return }
    if (!terms) { fail('auth.error.needTerms', 'terms'); return }
    void run(async () => {
      const outcome = await register({
        schoolName: schoolName.trim(), ...(schoolPick === '' ? {} : { schoolId: schoolPick }),
        username: username.trim(), displayName: displayName.trim(), password, email: email.trim(),
      })
      if (outcome.kind === 'pending') {
        setPendingReview(outcome)
        setPassword('')
        setConfirm('')
        stopBusy()
      }
    }, cause => { showCandidates(cause, 'SCHOOL_AMBIGUOUS') })
  }

  const submitForgot = (event: FormEvent): void => {
    event.preventDefault()
    if (busyRef.current) return
    if (username.trim() === '') { fail('auth.error.needUsername', 'username'); return }
    if (schoolName.trim() !== '' && schoolPick === '') { fail('auth.error.chooseSchool', 'school'); return }
    void run(async () => {
      const result = await forgotPassword({ username: username.trim(), ...(schoolPick === '' ? {} : { schoolId: schoolPick }) })
      if (!result.ok) throw new Error(t('auth.error.unknown'))
      setForgotSent(true)
      stopBusy()
    })
  }

  const submitReset = (event: FormEvent): void => {
    event.preventDefault()
    if (busyRef.current) return
    if (password.length < 8) { fail('auth.error.passwordShort', 'password'); return }
    if (password !== confirm) { fail('auth.error.passwordMismatch', 'confirm'); return }
    void run(async () => {
      const send = resetPassword ?? createAuthApi().resetPassword
      const result = await send({ token, newPassword: password })
      if (!result.ok) throw new Error(t('auth.error.unknown'))
      clearResetToken()
      setPassword('')
      setConfirm('')
      setResetSent(true)
      stopBusy()
    })
  }

  // Every hook stays above the session fast path; the real store owns access.
  if (status === 'authed' && token === '') return null

  const feedback = errorText !== '' && (
    <p ref={errorRef} id={errorId} className={css.error} role="alert" tabIndex={-1}>{errorText}</p>
  )
  const passwordControl = (
    <Field label={t('auth.password.label')} id={fieldId('password')} invalid={invalid('password')}
      hint={view === 'register' || view === 'reset' ? t('auth.password.hint') : undefined}>
      <PasswordInput key={view} id={fieldId('password')} name="password" value={password}
        onChange={(value) => { setPassword(value); clearFieldError('password') }}
        autoComplete={view === 'register' || view === 'reset' ? 'new-password' : 'current-password'}
        invalid={invalid('password')} describedBy={describe('password', view === 'register' || view === 'reset')} t={t} />
    </Field>
  )
  const confirmControl = (
    <Field label={t('auth.confirm.label')} id={fieldId('confirm')} invalid={invalid('confirm')}>
      <PasswordInput key={view} id={fieldId('confirm')} name="confirm" value={confirm}
        onChange={(value) => { setConfirm(value); clearFieldError('confirm') }} autoComplete="new-password"
        invalid={invalid('confirm')} describedBy={describe('confirm')} t={t} />
    </Field>
  )
  const schoolControl = (
    <div className={css.schoolField} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setSchoolOpen(false); setActiveSchool(-1) }
    }}>
      <Field label={t(view === 'forgot' ? 'auth.school.optional' : 'auth.school.label')} id={fieldId('school')}
        invalid={invalid('school')} hint={t(view === 'forgot' ? 'auth.school.recoveryHint' : 'auth.school.hint')}>
        <input ref={schoolInputRef} id={fieldId('school')} name="school" className={css.input} type="text" autoComplete="organization"
          placeholder={t('auth.school.registerPlaceholder')} value={schoolName} required={view === 'register'}
          role="combobox" aria-autocomplete="list" aria-expanded={dropdownVisible} aria-controls={dropdownVisible ? listId : undefined}
          aria-activedescendant={dropdownVisible && activeSchool >= 0 ? `${listId}-${activeSchool}` : undefined}
          aria-invalid={invalid('school') || undefined} aria-describedby={describe('school', true)}
          onFocus={() => { setSchoolOpen(true) }} onKeyDown={schoolKeyboard}
          onChange={(event) => {
            setSchoolName(event.target.value)
            setSchoolPick('')
            setSelectedSchool(undefined)
            setCandidates(undefined)
            setOptions(undefined)
            setSchoolOpen(true)
            setActiveSchool(-1)
            clearFieldError('school')
          }} />
      </Field>
      {dropdownVisible && dropdown !== undefined && (
        <ul className={css.options} id={listId} role="listbox" aria-label={t('auth.school.pick')} data-testid="school-options">
          {dropdown.map((school, index) => (
            <li key={school.id} role="presentation">
              <button id={`${listId}-${index}`} type="button" role="option" className={css.option}
                data-testid="school-option" data-school-id={school.id} data-active={activeSchool === index || undefined}
                aria-selected={schoolPick === school.id} onPointerDown={(event) => { event.preventDefault() }}
                onClick={() => { chooseSchool(school) }}>
                {candidateLabel(school)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {lookup === 'searching' && <p className={css.lookupStatus} role="status">{t('auth.school.searching')}</p>}
      {lookup === 'failed' && (
        <div className={css.lookupFailed} data-testid="school-lookup-failed">
          <p role="status"><IconUnverified size={18} />{t(view === 'forgot' ? 'auth.school.recoveryLookupFailed' : 'auth.school.lookupFailed')}</p>
          <button type="button" className={css.retryButton} onClick={() => { setLookupAttempt(current => current + 1) }}>
            <IconRefresh size={16} />{t('auth.school.retry')}
          </button>
        </div>
      )}
      {view === 'register' && lookup === 'ready' && options?.length === 0 && schoolPick === '' && schoolName.trim().length >= 2 && (
        <p className={css.schoolNotice} data-testid="school-not-found">{t('auth.school.notFound')}</p>
      )}
      {view === 'forgot' && lookup === 'ready' && options?.length === 0 && schoolPick === '' && schoolName.trim().length >= 1 && (
        <p className={css.schoolNotice} role="status">{t('auth.school.recoveryNotFound')}</p>
      )}
      {selectedSchool !== undefined && (
        <p className={css.schoolSelected} role="status">{candidateLabel(selectedSchool)}</p>
      )}
    </div>
  )

  if (pendingReview !== undefined) {
    return (
      <AuthWelcome t={t} view="pending">
        {() => (
          <div className={css.form} data-physicsos-auth-view="pending">
            <div className={css.receiptIcon} aria-hidden="true"><IconTime size={28} /></div>
            <p className={css.receipt} role="status">{t('auth.pending.body')}</p>
            <dl className={css.receiptList}>
              <div><dt>{t('auth.school.label')}</dt><dd>{pendingReview.schoolName}</dd></div>
              <div><dt>{t('auth.username.label')}</dt><dd>{pendingReview.username}</dd></div>
              <div><dt>{t('auth.email.label')}</dt><dd>{pendingReview.email}</dd></div>
              <div><dt>{t('auth.pending.reference')}</dt><dd className={css.receiptReference}>{pendingReview.requestId}</dd></div>
            </dl>
            <p className={css.receiptNext}>{t('auth.pending.next')}</p>
            <button type="button" className={css.submit} onClick={() => { setPendingReview(undefined); switchView('login') }}>
              {t('auth.pending.back')}
            </button>
          </div>
        )}
      </AuthWelcome>
    )
  }

  if (status === 'loading' && token === '') {
    return (
      <AuthWelcome t={t} view="loading">
        {() => (
          <div className={clsx(css.form, css.loading)} aria-busy="true" role="status" aria-label={t('auth.busy')}>
            <Mascot pose="think" size={148} float={false} />
            <span className={css.loadingDot} aria-hidden="true" />
          </div>
        )}
      </AuthWelcome>
    )
  }

  const back = view === 'login' ? undefined : (): void => {
    if (view === 'reset') { clearResetToken(); setToken('') }
    switchView('login')
  }

  return (
    <AuthWelcome t={t} view={view} busy={busy} onBack={resetSent || forgotSent ? undefined : back}
      heading={forgotSent ? 'auth.forgot.receivedTitle' : resetSent ? 'auth.reset.doneTitle' : undefined}>
      {({ showInfo }) => (
        <>
          {view === 'login' && (
            <form ref={formRef} className={css.form} onSubmit={submitLogin} noValidate aria-busy={busy} data-physicsos-auth-view="login">
              {feedback}
              <fieldset className={css.formControls} disabled={busy}>
                <Field label={t('auth.username.label')} id={fieldId('username')} invalid={invalid('username')}>
                  <input id={fieldId('username')} name="username" className={css.input} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    placeholder={t('auth.username.loginPlaceholder')} value={username} required aria-invalid={invalid('username') || undefined}
                    aria-describedby={describe('username')} onChange={(event) => {
                      setUsername(event.target.value); setCandidates(undefined); setSchoolPick(''); setSelectedSchool(undefined); clearFieldError('username')
                    }} />
                </Field>
                {candidates !== undefined && (
                  <Field label={t('auth.school.pick')} invalid={invalid('school')}>
                    <GlassSelect className={css.select} value={schoolPick} ariaLabel={t('auth.school.pick')} testId="login-school"
                      placeholder={t('auth.school.pick')} options={candidates.map(school => ({ value: school.id, label: candidateLabel(school) }))}
                      disabled={busy} onChange={(value) => { setSchoolPick(value); clearFieldError('school') }} />
                  </Field>
                )}
                {passwordControl}
                <div className={css.row}>
                  <label className={css.checkbox} htmlFor={`${id}-remember`}>
                    <input id={`${id}-remember`} name="remember" type="checkbox" checked={remember}
                      onChange={(event) => { setRemember(event.target.checked) }} />
                    <span>{t('auth.remember')}</span>
                  </label>
                  <button type="button" className={css.link} onClick={() => { switchView('forgot') }}>{t('auth.forgot.link')}</button>
                </div>
                <SubmitButton busy={busy} label="auth.login.submit" t={t} />
                <p className={css.alt}>{t('auth.login.noAccount')}
                  <button type="button" className={css.link} onClick={() => { switchView('register') }}>{t('auth.login.toRegister')}</button>
                </p>
              </fieldset>
              <p className={css.roleNote}>{t('auth.welcome.loginRoles')}</p>
            </form>
          )}

          {view === 'register' && (
            <form ref={formRef} className={css.form} onSubmit={submitRegister} noValidate aria-busy={busy} data-physicsos-auth-view="register">
              <div className={css.registrationRole}>
                <span>{t('auth.welcome.studentAccount')}</span>
                <button type="button" className={css.link} onClick={() => { showInfo('roles') }}>{t('auth.welcome.teacherHelp')}</button>
              </div>
              {feedback}
              <fieldset className={css.formControls} disabled={busy}>
                {schoolControl}
                <div className={css.identityFields}>
                  <Field label={t('auth.username.label')} id={fieldId('username')} invalid={invalid('username')} hint={t('auth.username.hint')}>
                    <input id={fieldId('username')} name="username" className={css.input} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                      placeholder={t('auth.username.registerPlaceholder')} value={username} required aria-invalid={invalid('username') || undefined}
                      aria-describedby={describe('username', true)}
                      onChange={(event) => { setUsername(event.target.value); clearFieldError('username') }} />
                  </Field>
                  <Field label={t('auth.displayName.label')} id={fieldId('displayName')} invalid={invalid('displayName')}>
                    <input id={fieldId('displayName')} name="displayName" className={css.input} type="text" autoComplete="name"
                      placeholder={t('auth.displayName.placeholder')} value={displayName} required aria-invalid={invalid('displayName') || undefined}
                      aria-describedby={describe('displayName')} onChange={(event) => { setDisplayName(event.target.value); clearFieldError('displayName') }} />
                  </Field>
                </div>
                <Field label={t('auth.email.label')} id={fieldId('email')} invalid={invalid('email')} hint={t('auth.email.hint')}>
                  <input id={fieldId('email')} name="email" className={css.input} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
                    placeholder={t('auth.email.placeholder')} value={email} data-testid="register-email" required
                    aria-invalid={invalid('email') || undefined} aria-describedby={describe('email', true)}
                    onChange={(event) => { setEmail(event.target.value); clearFieldError('email') }} />
                </Field>
                <div className={css.passwordFields}>{passwordControl}{confirmControl}</div>
                <div className={css.termsRow}>
                  <label className={css.checkbox} htmlFor={fieldId('terms')}>
                    <input id={fieldId('terms')} name="terms" type="checkbox" checked={terms}
                      aria-invalid={invalid('terms') || undefined} aria-describedby={describe('terms')}
                      onChange={(event) => { setTerms(event.target.checked); clearFieldError('terms') }} />
                    <span>{t('auth.terms')}</span>
                  </label>
                  <button type="button" className={css.link} onClick={() => { showInfo('terms') }}>{t('auth.terms.read')}</button>
                </div>
                <SubmitButton busy={busy} label="auth.register.submit" t={t} />
                <p className={css.alt}>{t('auth.register.hasAccount')}
                  <button type="button" className={css.link} onClick={() => { switchView('login') }}>{t('auth.register.toLogin')}</button>
                </p>
              </fieldset>
            </form>
          )}

          {view === 'forgot' && (forgotSent ? (
            <div className={css.form} data-physicsos-auth-view="forgot">
              <div className={css.receiptIcon} aria-hidden="true"><IconVerified size={28} /></div>
              <p className={css.receipt} role="status">{t('auth.forgot.receipt')}</p>
              <button type="button" className={css.submit} onClick={() => { switchView('login') }}>{t('auth.forgot.back')}</button>
            </div>
          ) : (
            <form ref={formRef} className={css.form} onSubmit={submitForgot} noValidate aria-busy={busy} data-physicsos-auth-view="forgot">
              {feedback}
              <fieldset className={css.formControls} disabled={busy}>
                <Field label={t('auth.username.label')} id={fieldId('username')} invalid={invalid('username')}>
                  <input id={fieldId('username')} name="username" className={css.input} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    placeholder={t('auth.username.loginPlaceholder')} value={username} required aria-invalid={invalid('username') || undefined}
                    aria-describedby={describe('username')} onChange={(event) => { setUsername(event.target.value); clearFieldError('username') }} />
                </Field>
                {schoolControl}
                <SubmitButton busy={busy} label="auth.forgot.submit" t={t} />
                <p className={css.alt}><button type="button" className={css.link} onClick={() => { switchView('login') }}>{t('auth.forgot.toLogin')}</button></p>
              </fieldset>
            </form>
          ))}

          {view === 'reset' && (resetSent ? (
            <div className={css.form} data-physicsos-auth-view="reset">
              <div className={css.receiptIcon} aria-hidden="true"><IconVerified size={28} /></div>
              <p className={css.receipt} role="status">{t('auth.reset.receipt')}</p>
              <button type="button" className={css.submit} onClick={() => { window.location.reload() }}>{t('auth.reset.toLogin')}</button>
            </div>
          ) : (
            <form ref={formRef} className={css.form} onSubmit={submitReset} noValidate aria-busy={busy} data-physicsos-auth-view="reset">
              {feedback}
              <fieldset className={css.formControls} disabled={busy}>
                {passwordControl}{confirmControl}
                <SubmitButton busy={busy} label="auth.reset.submit" t={t} />
                {error?.code === 'INVALID_RESET_TOKEN' && (
                  <button type="button" className={css.link} onClick={() => { clearResetToken(); setToken(''); switchView('forgot') }}>
                    {t('auth.reset.requestAgain')}
                  </button>
                )}
                <p className={css.alt}><button type="button" className={css.link} onClick={back}>{t('auth.forgot.toLogin')}</button></p>
              </fieldset>
            </form>
          ))}
        </>
      )}
    </AuthWelcome>
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
    <AdminCard data-physicsos-password-reset-queue="">
      <AdminCardTitle>{t('admin.passwordResets.title')}</AdminCardTitle>
      <AdminCardMeta>{t('admin.passwordResets.hint')}</AdminCardMeta>
      {error !== '' && <p className={adminCss.error} role="alert">{error}</p>}
      {requests.length === 0 && <AdminEmpty>{t('admin.empty')}</AdminEmpty>}
      {requests.map((request) => {
        const oneTime = issued.get(request.id)
        const finished = request.status === 'used'
          || request.status === 'cancelled'
          || request.status === 'superseded'
        return (
          <div key={request.id} className={adminCss.resetRow}>
            <AdminCardMeta>
              {request.displayName} @{request.username}
              {' · '}{request.schoolName}
              {' · '}{t(resetStatusKey(request.status))}
            </AdminCardMeta>
            {oneTime !== undefined && (
              <AdminCardMeta data-reset-token={oneTime.token}>
                <code>{oneTime.resetPath}</code>
              </AdminCardMeta>
            )}
            {!finished && (
              <div className={adminCss.actions}>
                <button
                  type="button"
                  className={adminCss.primary}
                  disabled={busy === request.id}
                  onClick={() => { issue(request) }}
                >
                  {t('admin.passwordResets.issue')}
                </button>
                <button
                  type="button"
                  className={adminCss.ghost}
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
    </AdminCard>
  )
}
