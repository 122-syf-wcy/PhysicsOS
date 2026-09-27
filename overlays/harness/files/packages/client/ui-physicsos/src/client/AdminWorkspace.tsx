/**
 * AdminWorkspace — the 管理后台 surface. Visible only to SCHOOL_ADMIN /
 * SUPER_ADMIN principals; the host enforces the same boundary again, so this
 * component only decides what to show, never what is allowed. Tabs are
 * role-shaped: supers see 申请/学校/用户/审计, school admins see 用户/审计
 * scoped to their own tenant.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  AdminApi, AdminUserRow, AuditEventRow, SchoolRequestRow,
} from './auth-api.ts'
import type { PaperApi } from './paper-api.ts'
import type { NoticeApi } from './notice-api.ts'
import { AdminContentTab } from './AdminContentTab.tsx'
import { AdminDashboardTab } from './AdminDashboardTab.tsx'
import { AdminDeviceTab } from './AdminDeviceTab.tsx'
import { AdminModelPoolTab } from './AdminModelPoolTab.tsx'
import { AdminOpsTab } from './AdminOpsTab.tsx'
import { AdminNoticeTab } from './AdminNoticeTab.tsx'
import { AdminPlatformNoticeTab } from './AdminPlatformNoticeTab.tsx'
import { AdminPluginTab } from './AdminPluginTab.tsx'
import { PasswordResetQueue } from './AuthGate.tsx'
import { isAdminRole, type AuthState } from './auth-store.ts'
import type { PhysicsosKey } from './locales.ts'
import type { ModelPoolApi } from './model-pool-api.ts'
import { createPluginCenterApi, type PluginCenterApi } from './PluginCenterApi.ts'
import { GlassSelect } from './GlassSelect.tsx'
import {
  AdminCard,
  AdminCardActions,
  AdminCardHead,
  AdminCardMeta,
  AdminCardTitle,
  AdminEmpty,
  AdminPage,
  AdminToolbar,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

type Tab =
  | 'requests'
  | 'schools'
  | 'dashboard'
  | 'users'
  | 'resets'
  | 'content'
  | 'notice'
  | 'platformNotice'
  | 'modelPool'
  | 'plugins'
  | 'ops'
  | 'devices'
  | 'audit'

export interface AdminWorkspaceProps {
  api: AdminApi
  /**
   * 内容管理 drives the 出卷专区's own API rather than a parallel admin one.
   *
   * The operations an operator needs on the bank — filter, verify in bulk,
   * reject, inspect anomalies — are exactly the ones that API already serves,
   * and the guard on those routes already admits SCHOOL_ADMIN and SUPER_ADMIN.
   * A second, admin-shaped copy of twelve endpoints would be a second thing to
   * keep in step for no gain.
   *
   * Optional because a stripped composition may not mount the paper host; the
   * tab is then simply not offered.
   */
  paperApi?: PaperApi
  /**
   * Feedback queue and platform-announcement client. Optional for the same
   * reason paperApi is: a stripped composition may not mount the notice host,
   * and the tabs are then not offered rather than offered and broken.
   */
  noticeApi?: NoticeApi
  /** `/physicsos/model-pool` client — absent in stripped test compositions. */
  modelPoolApi?: ModelPoolApi
  /** SUPER_ADMIN plugin catalog client; defaults to the same-origin route. */
  pluginApi?: PluginCenterApi
  /** Bound auth store — the role comes from the session, never the wire. */
  useAuth: <T>(selector: (state: AuthState) => T) => T
  t: (key: PhysicsosKey) => string
}

const fmtTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

const defaultPluginApi = createPluginCenterApi()

export function AdminWorkspace({
  api, paperApi, noticeApi, modelPoolApi, pluginApi = defaultPluginApi, useAuth, t,
}: AdminWorkspaceProps) {
  const role = useAuth(state => state.user?.role)
  /* The judging account, attributed on every review — the same identity the
     server files the ledger row under. */
  const username = useAuth(state => state.user?.username) ?? 'admin'
  const [tab, setTab] = useState<Tab>('users')
  const isSuper = role === 'SUPER_ADMIN'

  if (!isAdminRole(role)) {
    return <div className={css.root}><p className={css.empty}>{t('admin.forbidden')}</p></div>
  }

  const tabs: { id: Tab; label: string }[] = [
    ...(isSuper ? [
      { id: 'requests' as const, label: t('admin.tab.requests') },
      { id: 'schools' as const, label: t('admin.tab.schools') },
    ] : []),
    { id: 'dashboard' as const, label: t('admin.tab.dashboard') },
    { id: 'users' as const, label: t('admin.tab.users') },
    /* 密码重置队列 is the admin side of the self-service flow: students file a
       request from the login gate, an admin issues the one-time link here.
       School admins see their own tenant; SUPER_ADMIN sees every school. */
    { id: 'resets' as const, label: t('admin.tab.resets') },
    ...(paperApi === undefined ? [] : [{ id: 'content' as const, label: t('admin.tab.content') }]),
    ...(noticeApi === undefined ? [] : [{ id: 'notice' as const, label: t('admin.tab.notice') }]),
    ...(noticeApi === undefined || !isSuper
      ? []
      : [{ id: 'platformNotice' as const, label: t('admin.tab.platformNotice') }]),
    ...(modelPoolApi === undefined || !isSuper
      ? []
      : [{ id: 'modelPool' as const, label: t('admin.tab.modelPool') }]),
    ...(!isSuper ? [] : [{ id: 'plugins' as const, label: t('admin.tab.plugins') }]),
    { id: 'ops' as const, label: t('admin.tab.ops') },
    { id: 'devices' as const, label: t('admin.tab.devices') },
    { id: 'audit' as const, label: t('admin.tab.audit') },
  ]
  const fallback = tabs[0]
  if (fallback === undefined) throw new Error('AdminWorkspace: no tab is visible for this role')
  const active = tabs.some(item => item.id === tab) ? tab : fallback.id

  return (
    <div className={css.root} data-physicsos-surface="admin">
      <AdminPage
        title={t('admin.title')}
        tabs={tabs}
        activeTab={active}
        onTabChange={setTab}
      >
        {active === 'requests' && isSuper && <RequestsTab api={api} t={t} />}
        {active === 'schools' && isSuper && <SchoolsTab api={api} t={t} />}
        {active === 'dashboard' && <AdminDashboardTab api={api} t={t} />}
        {active === 'users' && <UsersTab api={api} t={t} isSuper={isSuper} />}
        {active === 'resets' && <PasswordResetQueue api={api} t={t} />}
        {active === 'content' && paperApi !== undefined && (
          <AdminContentTab api={paperApi} reviewer={username} t={t} />
        )}
        {active === 'notice' && noticeApi !== undefined && (
          <AdminNoticeTab api={noticeApi} t={t} />
        )}
        {active === 'platformNotice' && noticeApi !== undefined && isSuper && (
          <AdminPlatformNoticeTab api={noticeApi} t={t} />
        )}
        {active === 'modelPool' && modelPoolApi !== undefined && isSuper && (
          <AdminModelPoolTab api={modelPoolApi} t={t} />
        )}
        {active === 'plugins' && isSuper && <AdminPluginTab api={pluginApi} t={t} />}
        {active === 'ops' && <AdminOpsTab api={api} isSuper={isSuper} t={t} />}
        {active === 'devices' && <AdminDeviceTab api={api} isSuper={isSuper} t={t} />}
        {active === 'audit' && <AuditTab api={api} t={t} />}
      </AdminPage>
    </div>
  )
}

/* ---- shared bits ---- */

const useLoad = <T,>(load: () => Promise<T>, deps: readonly unknown[]) => {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<string | undefined>()
  const reload = useCallback(() => {
    setError(undefined)
    load().then(setData).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    /* The dep array is the caller's: `load` closes over the tab's query
       state and is expected to be recreated. */
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, error, reload }
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={css.field}>
    <span className={css.fieldLabel}>{label}</span>
    {children}
  </label>
)

/* ---- 申请 tab (SUPER_ADMIN) ---- */

function RequestsTab({ api, t }: { api: AdminApi; t: (key: PhysicsosKey) => string }) {
  const { data, error, reload } = useLoad(
    () => api.listSchoolRequests('pending').then(r => r.requests), [api])
  const [form, setForm] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id); setNote(undefined)
    try { await run(); setExpanded(undefined); setForm({}); reload() }
    catch (reason) { setNote(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  if (error !== undefined) return <p className={css.error}>{error}</p>
  if (data === undefined) return <AdminEmpty>{t('admin.loading')}</AdminEmpty>
  if (data.length === 0) return <AdminEmpty>{t('admin.empty')}</AdminEmpty>

  return (
    <>
      {note !== undefined && <p className={css.error}>{note}</p>}
      {data.map((request: SchoolRequestRow) => (
        <AdminCard key={request.id}>
          <AdminCardHead>
            <div>
              <AdminCardTitle>{request.schoolName}</AdminCardTitle>
              <AdminCardMeta>
                {t('admin.contact')}: {request.contact} · {fmtTime(request.createdAt)}
                {' · '}{t('admin.requestedBy')}: {request.requestedBy === null
                  ? t('admin.anonymous') : request.requestedBy}
              </AdminCardMeta>
            </div>
            <AdminCardActions>
              <button
                type="button" className={css.primary}
                disabled={busy === request.id}
                onClick={() => { setExpanded(expanded === request.id ? undefined : request.id) }}
              >
                {t('admin.requests.approve')}
              </button>
              <button
                type="button" className={css.ghost}
                disabled={busy === request.id}
                onClick={() => { void act(request.id, () => api.rejectSchoolRequest(request.id, form[`reason:${request.id}`])) }}
              >
                {t('admin.requests.reject')}
              </button>
            </AdminCardActions>
          </AdminCardHead>
          {expanded === request.id && (
            <div className={css.form}>
              <Field label={t('admin.requests.field.schoolId')}>
                <input className={css.input} value={form.schoolId ?? ''} placeholder="GUIZHOU-XX"
                  onChange={(e) => { setForm(f => ({ ...f, schoolId: e.target.value })) }} />
              </Field>
              <Field label={t('admin.requests.field.shortName')}>
                <input className={css.input} value={form.shortName ?? ''}
                  onChange={(e) => { setForm(f => ({ ...f, shortName: e.target.value })) }} />
              </Field>
              <Field label={t('admin.requests.field.adminUsername')}>
                <input className={css.input} value={form.adminUsername ?? ''}
                  onChange={(e) => { setForm(f => ({ ...f, adminUsername: e.target.value })) }} />
              </Field>
              <Field label={t('admin.requests.field.adminDisplayName')}>
                <input className={css.input} value={form.adminDisplayName ?? ''}
                  onChange={(e) => { setForm(f => ({ ...f, adminDisplayName: e.target.value })) }} />
              </Field>
              <Field label={t('admin.requests.field.adminPassword')}>
                <input className={css.input} type="password" value={form.adminPassword ?? ''}
                  onChange={(e) => { setForm(f => ({ ...f, adminPassword: e.target.value })) }} />
              </Field>
              <button
                type="button" className={css.primary}
                disabled={busy === request.id}
                onClick={() => {
                  void act(request.id, () => api.approveSchoolRequest(request.id, {
                    schoolId: form.schoolId ?? '',
                    ...(form.shortName !== undefined && form.shortName !== '' ? { shortName: form.shortName } : {}),
                    adminUsername: form.adminUsername ?? '',
                    adminDisplayName: form.adminDisplayName ?? '',
                    adminPassword: form.adminPassword ?? '',
                  }))
                }}
              >
                {t('admin.confirm.submit')}
              </button>
            </div>
          )}
        </AdminCard>
      ))}
    </>
  )
}

/* ---- 学校 tab (SUPER_ADMIN) ---- */

interface AdminSchoolRow {
  id: string
  name: string
  shortName?: string
  status: 'active' | 'disabled'
}

function SchoolsTab({ api, t }: { api: AdminApi; t: (key: PhysicsosKey) => string }) {
  const { data, error, reload } = useLoad(
    () => api.listSchools().then(r => r.schools as AdminSchoolRow[]), [api])
  const [form, setForm] = useState({ id: '', name: '', shortName: '' })
  const [note, setNote] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)

  if (error !== undefined) return <p className={css.error}>{error}</p>
  if (data === undefined) return <AdminEmpty>{t('admin.loading')}</AdminEmpty>

  return (
    <>
      {note !== undefined && <p className={css.error}>{note}</p>}
      <AdminCard>
        <AdminCardTitle>{t('admin.schools.create')}</AdminCardTitle>
        <div className={css.formRow}>
          <input className={css.input} placeholder={t('admin.schools.field.id')}
            value={form.id} onChange={(e) => { setForm(f => ({ ...f, id: e.target.value })) }} />
          <input className={css.input} placeholder={t('admin.schools.field.name')}
            value={form.name} onChange={(e) => { setForm(f => ({ ...f, name: e.target.value })) }} />
          <input className={css.input} placeholder={t('admin.requests.field.shortName')}
            value={form.shortName} onChange={(e) => { setForm(f => ({ ...f, shortName: e.target.value })) }} />
          <button
            type="button" className={css.primary} disabled={creating}
            onClick={() => {
              setCreating(true); setNote(undefined)
              api.createSchool({ id: form.id, name: form.name, ...(form.shortName === '' ? {} : { shortName: form.shortName }) })
                .then(() => { setForm({ id: '', name: '', shortName: '' }); reload() })
                .catch((reason: unknown) => { setNote(reason instanceof Error ? reason.message : String(reason)) })
                .finally(() => { setCreating(false) })
            }}
          >
            {t('admin.confirm.submit')}
          </button>
        </div>
      </AdminCard>
      {data.length === 0 && <AdminEmpty>{t('admin.empty')}</AdminEmpty>}
      {data.map(school => (
        <AdminCard key={school.id}>
          <AdminCardHead>
            <div>
              <AdminCardTitle>{school.name}</AdminCardTitle>
              <AdminCardMeta>
                {school.id}{school.shortName === undefined ? '' : ` · ${school.shortName}`}
                {' · '}{school.status === 'active' ? t('admin.schools.status.active') : t('admin.schools.status.disabled')}
              </AdminCardMeta>
            </div>
            <button
              type="button"
              className={school.status === 'active' ? css.danger : css.ghost}
              onClick={() => {
                setNote(undefined)
                api.setSchoolStatus(school.id, school.status === 'active' ? 'disabled' : 'active')
                  .then(reload)
                  .catch((reason: unknown) => { setNote(reason instanceof Error ? reason.message : String(reason)) })
              }}
            >
              {school.status === 'active' ? t('admin.schools.disable') : t('admin.schools.enable')}
            </button>
          </AdminCardHead>
        </AdminCard>
      ))}
    </>
  )
}

/* ---- 用户 tab ---- */

function UsersTab({ api, t, isSuper }: { api: AdminApi; t: (key: PhysicsosKey) => string; isSuper: boolean }) {
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const { data, error, reload } = useLoad(
    () => api.listUsers({ ...(roleFilter === '' ? {} : { role: roleFilter }), ...(q === '' ? {} : { q }) })
      .then(r => r.users),
    [api, q, roleFilter])
  const [form, setForm] = useState({ schoolId: '', username: '', displayName: '', password: '', role: 'STUDENT' })
  const [resetFor, setResetFor] = useState<string | undefined>()
  const [newPassword, setNewPassword] = useState('')
  const [note, setNote] = useState<string | undefined>()

  const run = (job: () => Promise<unknown>) => {
    setNote(undefined)
    job().then(reload).catch((reason: unknown) => {
      setNote(reason instanceof Error ? reason.message : String(reason))
    })
  }

  if (error !== undefined) return <p className={css.error}>{error}</p>

  return (
    <>
      {note !== undefined && <p className={css.error}>{note}</p>}
      <AdminCard>
        <AdminCardTitle>{t('admin.users.create')}</AdminCardTitle>
        <div className={css.formRow}>
          {isSuper && (
            <input className={css.input} placeholder={t('admin.schools.field.id')}
              value={form.schoolId} onChange={(e) => { setForm(f => ({ ...f, schoolId: e.target.value })) }} />
          )}
          <input className={css.input} placeholder={t('admin.users.field.username')}
            value={form.username} onChange={(e) => { setForm(f => ({ ...f, username: e.target.value })) }} />
          <input className={css.input} placeholder={t('admin.users.field.displayName')}
            value={form.displayName} onChange={(e) => { setForm(f => ({ ...f, displayName: e.target.value })) }} />
          <input className={css.input} type="password" placeholder={t('admin.users.field.password')}
            value={form.password} onChange={(e) => { setForm(f => ({ ...f, password: e.target.value })) }} />
          <GlassSelect
            className={css.select}
            value={form.role}
            ariaLabel={t('admin.users.field.role')}
            testId="user-role"
            options={[
              { value: 'STUDENT', label: t('role.STUDENT') },
              { value: 'TEACHER', label: t('role.TEACHER') },
              ...isSuper ? [{ value: 'SCHOOL_ADMIN', label: t('role.SCHOOL_ADMIN') }] : [],
            ]}
            onChange={(role) => { setForm(f => ({ ...f, role })) }}
          />
          <button
            type="button" className={css.primary}
            onClick={() => {
              run(() => api.createUser({
                /* Only supers see the schoolId field; a school admin omits it
                   and the host lands the account in their own tenant. */
                ...(form.schoolId === '' ? {} : { schoolId: form.schoolId }),
                username: form.username,
                displayName: form.displayName,
                password: form.password,
                role: form.role as 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN',
              }).then(() => { setForm(f => ({ ...f, username: '', displayName: '', password: '' })) }))
            }}
          >
            {t('admin.confirm.submit')}
          </button>
        </div>
      </AdminCard>

      <AdminToolbar>
        <input className={css.input} placeholder={t('admin.users.search')}
          value={q} onChange={(e) => { setQ(e.target.value) }} />
        <GlassSelect
          className={css.select}
          value={roleFilter}
          ariaLabel={t('admin.users.role.all')}
          testId="role-filter"
          options={[
            { value: '', label: t('admin.users.role.all') },
            { value: 'STUDENT', label: t('role.STUDENT') },
            { value: 'TEACHER', label: t('role.TEACHER') },
            { value: 'SCHOOL_ADMIN', label: t('role.SCHOOL_ADMIN') },
            ...isSuper ? [{ value: 'SUPER_ADMIN', label: t('role.SUPER_ADMIN') }] : [],
          ]}
          onChange={setRoleFilter}
        />
      </AdminToolbar>

      {data === undefined
        ? <AdminEmpty>{t('admin.loading')}</AdminEmpty>
        : data.length === 0
          ? <AdminEmpty>{t('admin.empty')}</AdminEmpty>
          : data.map((user: AdminUserRow) => {
            const key = `${user.schoolId}:${user.username}`
            return (
              <AdminCard key={key}>
                <AdminCardHead>
                  <div>
                    <AdminCardTitle>
                      {user.displayName} <span className={css.dim}>@{user.username}</span>
                    </AdminCardTitle>
                    <AdminCardMeta>
                      {user.schoolName} · {t(`role.${user.role}`)}
                      {' · '}{user.status === 'active' ? t('admin.schools.status.active') : t('admin.schools.status.disabled')}
                    </AdminCardMeta>
                  </div>
                  {user.role !== 'SUPER_ADMIN' && (
                    <AdminCardActions>
                      <button
                        type="button" className={user.status === 'active' ? css.danger : css.ghost}
                        onClick={() => {
                          run(() => api.setUserStatus(
                            user.schoolId, user.username,
                            user.status === 'active' ? 'disabled' : 'active'))
                        }}
                      >
                        {user.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}
                      </button>
                      <button
                        type="button" className={css.ghost}
                        onClick={() => { setResetFor(resetFor === key ? undefined : key); setNewPassword('') }}
                      >
                        {t('admin.users.reset')}
                      </button>
                      <button
                        type="button" className={css.ghost}
                        onClick={() => { run(() => api.revokeUserSessions(user.schoolId, user.username)) }}
                      >
                        {t('admin.users.revoke')}
                      </button>
                    </AdminCardActions>
                  )}
                </AdminCardHead>
                {resetFor === key && (
                  <div className={css.formRow}>
                    <input
                      className={css.input} type="password" placeholder={t('admin.users.field.newPassword')}
                      value={newPassword} onChange={(e) => { setNewPassword(e.target.value) }}
                    />
                    <button
                      type="button" className={css.primary}
                      onClick={() => {
                        run(() => api.resetUserPassword(user.schoolId, user.username, newPassword)
                          .then(() => { setResetFor(undefined) }))
                      }}
                    >
                      {t('admin.confirm.submit')}
                    </button>
                  </div>
                )}
              </AdminCard>
            )
          })}
    </>
  )
}

/* ---- 审计 tab ---- */

function AuditTab({ api, t }: { api: AdminApi; t: (key: PhysicsosKey) => string }) {
  const { data, error } = useLoad(() => api.listAudit({ limit: 200 }).then(r => r.events), [api])
  if (error !== undefined) return <p className={css.error}>{error}</p>
  if (data === undefined) return <AdminEmpty>{t('admin.loading')}</AdminEmpty>
  if (data.length === 0) return <AdminEmpty>{t('admin.empty')}</AdminEmpty>

  return (
    <>
      {data.map((event: AuditEventRow) => (
        <AdminCard key={event.id}>
          <AdminCardMeta>{fmtTime(event.createdAt)} · {event.schoolId}</AdminCardMeta>
          <AdminCardTitle>
            <code className={css.action}>{event.action}</code> {event.target}
          </AdminCardTitle>
          <AdminCardMeta>
            {t('admin.audit.actor')}: {event.actorKey}
            {event.detail === undefined ? '' : ` · ${JSON.stringify(event.detail)}`}
          </AdminCardMeta>
        </AdminCard>
      ))}
    </>
  )
}
