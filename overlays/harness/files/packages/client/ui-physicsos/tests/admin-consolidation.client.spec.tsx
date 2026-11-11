// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import type { AdminApi, DeviceRow, PasswordResetQueueRow } from '../src/client/auth-api.ts'
import type { AuthState, AuthUser } from '../src/client/auth-store.ts'
import type { NoticeApi } from '../src/client/notice-api.ts'
import type { PaperApi } from '../src/client/paper-api.ts'
import type { ModelPoolApi } from '../src/client/model-pool-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'
import type { UsageApi, UsageSummary } from '../src/client/usage-api.ts'

// Root owns the shared dictionary; these literal labels exercise the intended UI
// before its new locale keys are integrated.
const newLabels: Readonly<Record<string, string>> = {
  'admin.tab.overview': '概览', 'admin.tab.feedback': '反馈与公告',
  'admin.accounts.tabs': '用户管理', 'admin.accounts.users': '账号',
  'admin.overview.tabs': '概览内容', 'admin.overview.summary': '使用概览',
  'admin.overview.operations': '运维', 'admin.overview.audit': '审计',
  'admin.overview.refresh': '刷新',
  'admin.review.tabs': '审核内容', 'admin.review.experiments': '实验投稿',
  'admin.review.content': '题目内容', 'admin.feedback.tabs': '反馈与公告管理',
}
const t = (key: PhysicsosKey): string => newLabels[key] ?? zh[key] ?? key
const user: AuthUser = { id: 'admin-fixture', username: 'operator', displayName: '管理员',
  role: 'SUPER_ADMIN', schoolId: 'school-fixture', schoolName: '测试学校' }
const useAuth = (role: AuthUser['role']) => <T,>(select: (state: AuthState) => T): T =>
  select({ status: 'authed', user: { ...user, role } })
const device: DeviceRow = { id: 'device-row', deviceId: 'a'.repeat(64), primaryUserKey: 'school-fixture:student',
  schoolId: 'school-fixture', username: 'student', firstSeenAt: '2026-11-09T01:00:00Z',
  lastSeenAt: '2026-11-10T01:00:00Z', seenCount: 2, revoked: false, revokedGlobally: false }
const reset: PasswordResetQueueRow = { id: 'reset-fixture', schoolId: 'school-fixture', schoolName: '测试学校',
  username: 'student', displayName: '学生', status: 'pending', delivery: 'queue', at: '2026-11-10T01:00:00Z' }
const dashboard = { schools: { total: 1, active: 1, disabled: 0 },
  users: { total: 1, byRole: { STUDENT: 1 }, disabled: 0 }, sessions: { live: 1, distinctUsers: 1 }, activity: [],
  learning: { available: false, attempts: 0, correct: 0, wrong: 0, nodes: [], days: 0 },
  limiters: { login: { tracked: 0, saturated: 0, limit: 5, windowMs: 60000 },
    ip: { tracked: 0, saturated: 0, limit: 20, windowMs: 60000 }, apply: { tracked: 0, saturated: 0, limit: 10, windowMs: 60000 } } }

function apiFixture(): AdminApi {
  let revoked = false
  let resetStatus: PasswordResetQueueRow['status'] = 'pending'
  return {
    dashboard: async () => dashboard,
    listSchoolRequests: async () => ({ requests: [] }), listSchools: async () => ({ schools: [] }),
    listUsers: async () => ({ users: [] }),
    listPasswordResets: async () => ({ requests: [{ ...reset, status: resetStatus }] }),
    issuePasswordReset: async id => {
      if (id !== reset.id) throw new Error('Wrong recovery request')
      resetStatus = 'active'
      return { request: { ...reset, status: resetStatus }, token: 'fixture-only-token',
        expiresAt: '2026-11-10T02:00:00Z', resetPath: '/reset?token=fixture-only-token' }
    },
    cancelPasswordReset: async id => {
      if (id !== reset.id) throw new Error('Wrong recovery request')
      resetStatus = 'cancelled'
      return { request: { ...reset, status: resetStatus } }
    },
    listDevices: async () => ({ devices: [{ ...device, revoked }], risk: [] }),
    setDeviceRevoked: async (id, next) => {
      if (id !== device.deviceId) throw new Error('Wrong device')
      revoked = next
      return { deviceId: id, scope: 'school-fixture' }
    },
    listAudit: async () => ({ events: [{ id: 'audit-fixture', schoolId: 'school-fixture', actorKey: 'school-fixture:operator',
      action: 'user.disabled', target: 'student', createdAt: '2026-11-10T01:00:00Z' }] }),
    createUser: async () => { throw new Error('unused') }, setUserStatus: async () => { throw new Error('unused') },
    resetUserPassword: async () => ({ ok: true }), revokeUserSessions: async () => ({ ok: true }),
    approveSchoolRequest: async () => { throw new Error('unused') }, rejectSchoolRequest: async () => { throw new Error('unused') },
    createSchool: async () => { throw new Error('unused') }, setSchoolStatus: async () => { throw new Error('unused') },
    opsMetrics: async () => { throw new Error('No host metrics in this tenant fixture') },
  }
}
const paperApi = { listBankItems: async () => [], listSources: async () => [] } as unknown as PaperApi
const noticeApi = { listFeedback: async () => ({ items: [] }), getPlatformNotice: async () => ({
  notice: { title: '', body: '', version: 0, enabled: true, updatedAt: '', updatedBy: '' }, acknowledgedVersion: null,
}) } as unknown as NoticeApi
const modelPoolApi = {} as ModelPoolApi
const mount = (role: AuthUser['role']) => render(<AdminWorkspace api={apiFixture()} paperApi={paperApi}
  noticeApi={noticeApi} modelPoolApi={modelPoolApi} useAuth={useAuth(role)} t={t} />)
const primary = (): HTMLElement => document.querySelector('[data-admin-page] [role="tablist"]') as HTMLElement

afterEach(cleanup)

describe('confirmed administrator navigation', () => {
  it('opens overview and offers only the confirmed primary business pages', () => {
    mount('SUPER_ADMIN')
    expect(within(primary()).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      '概览', '学校申请', '学校', '用户', '对话审核', '实验审核', '反馈与公告', '官网管理', '模型通道',
    ])
    expect(within(primary()).getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps recovery issuance and cancellation inside the users page', async () => {
    mount('SCHOOL_ADMIN')
    fireEvent.click(within(primary()).getByRole('tab', { name: '用户' }))
    const accounts = screen.getByRole('tablist', { name: '用户管理' })
    fireEvent.click(within(accounts).getByRole('tab', { name: '密码重置' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['admin.passwordResets.issue'] }))
    expect(await screen.findByText('/reset?token=fixture-only-token')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['admin.passwordResets.cancel'] }))
    await waitFor(() => { expect(screen.queryByText('/reset?token=fixture-only-token')).toBeNull() })
    expect(screen.queryByRole('button', { name: zh['admin.passwordResets.issue'] })).toBeNull()
  })

  it('keeps device revocation and restoration inside the users page', async () => {
    mount('SCHOOL_ADMIN')
    fireEvent.click(within(primary()).getByRole('tab', { name: '用户' }))
    fireEvent.click(within(screen.getByRole('tablist', { name: '用户管理' })).getByRole('tab', { name: '设备' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['admin.devices.revoke'] }))
    expect(await screen.findByRole('button', { name: zh['admin.devices.restore'] })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['admin.devices.restore'] }))
    expect(await screen.findByRole('button', { name: zh['admin.devices.revoke'] })).not.toBeNull()
  })

  it('keeps operational jobs and audit results inside overview', async () => {
    mount('SCHOOL_ADMIN')
    fireEvent.click(within(primary()).getByRole('tab', { name: '概览' }))
    const overview = screen.getByRole('tablist', { name: '概览内容' })
    fireEvent.click(within(overview).getByRole('tab', { name: '运维' }))
    expect(await screen.findByText(zh['admin.ops.import'])).not.toBeNull()
    fireEvent.click(within(overview).getByRole('tab', { name: '审计' }))
    expect(await screen.findByText('user.disabled')).not.toBeNull()
  })

  it('allows tenant question review without platform experiment or announcement controls', async () => {
    mount('SCHOOL_ADMIN')
    expect(within(primary()).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['概览', '用户', '实验审核', '反馈与公告'])
    fireEvent.click(within(primary()).getByRole('tab', { name: '实验审核' }))
    const reviews = screen.getByRole('tablist', { name: '审核内容' })
    expect(within(reviews).queryByRole('tab', { name: '实验投稿' })).toBeNull()
    fireEvent.click(within(reviews).getByRole('tab', { name: '题目内容' }))
    await screen.findByPlaceholderText(zh['admin.content.search'])
    fireEvent.click(within(primary()).getByRole('tab', { name: '反馈与公告' }))
    expect(screen.queryByRole('tab', { name: '公告' })).toBeNull()
  })

  it('does not offer administrator navigation to a student', () => {
    mount('STUDENT')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText(zh['admin.forbidden'])).not.toBeNull()
  })

  it('reads authoritative admin usage and shows missing reporting coverage separately from tokens', async () => {
    const calls: unknown[] = []
    const usageApi = { adminSummary: async (query?: unknown) => {
      calls.push(query)
      return { scope: 'school', timezone: 'Asia/Shanghai', from: '2026-11-01', to: '2026-11-10', visits: 12, uses: 8,
        activeDays: 3, tokens: { inputTokens: 11, outputTokens: 13, cacheReadTokens: 5, cacheWriteTokens: 7,
          reasoningTokens: 3, totalTokens: 36 }, coverage: { reportedCalls: 4, missingCalls: 2 },
        system: { reportedCalls: 0, missingCalls: 0, tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
          cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 } }, daily: [], updatedAt: '2026-11-10T01:00:00Z' }
    } }
    render(<AdminWorkspace {...{ api: apiFixture(), useAuth: useAuth('SCHOOL_ADMIN'), t, usageApi } as any} />)
    await waitFor(() => { expect(document.querySelector('[data-stat="usage.visits"]')?.textContent).toContain('12') })
    expect(document.querySelector('[data-stat="usage.tokens.total"]')?.textContent).toContain('36')
    expect(document.querySelector('[data-stat="usage.calls.missing"]')?.textContent).toContain('2')
    expect(calls).toEqual([undefined])
  })

  it('separates missing background-call coverage from fully reported account usage', async () => {
    const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 }
    const summary: UsageSummary = {
      scope: 'platform', timezone: 'Asia/Shanghai', from: '2026-11-01', to: '2026-11-10', visits: 1, uses: 1,
      activeDays: 1, tokens, coverage: { reportedCalls: 2, missingCalls: 0 },
      system: { reportedCalls: 1, missingCalls: 3, tokens }, daily: [], updatedAt: '2026-11-10T01:00:00Z',
    }
    const usageApi: UsageApi = {
      summary: () => Promise.resolve(summary), adminSummary: () => Promise.resolve(summary),
      recordEvent: input => Promise.resolve({ ...input, at: summary.updatedAt }),
    }
    render(<AdminWorkspace api={apiFixture()} useAuth={useAuth('SUPER_ADMIN')} t={t} usageApi={usageApi} />)
    await waitFor(() => expect(document.querySelector('[data-stat="usage.system.calls.missing"]')?.textContent).toContain('3'))
    expect(document.querySelector('[data-stat="usage.system.calls.reported"]')?.textContent).toContain('1')
    expect(document.querySelector('[data-stat="usage.calls.missing"]')?.textContent).toContain('0')
  })

  it('keeps a failed usage read visible and lets the operator retry the actual API', async () => {
    let calls = 0
    const usageApi = { adminSummary: async () => { calls += 1; throw new Error('Usage service unavailable') } }
    render(<AdminWorkspace {...{ api: apiFixture(), useAuth: useAuth('SCHOOL_ADMIN'), t, usageApi } as any} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Usage service unavailable'))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => { expect(calls).toBe(2) })
  })
})
