// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import {
  AdminCard,
  AdminEmpty,
  AdminPage,
  AdminStats,
  AdminTable,
  AdminToolbar,
} from '../src/client/AdminPrimitives.tsx'
import type { AdminApi } from '../src/client/auth-api.ts'
import type { AuthState, AuthUser } from '../src/client/auth-store.ts'
import type { PhysicsosKey } from '../src/client/locales.ts'
import { zh } from '../src/client/locales.ts'
import type { ModelPoolApi } from '../src/client/model-pool-api.ts'
import type { NoticeApi } from '../src/client/notice-api.ts'
import type { PaperApi } from '../src/client/paper-api.ts'
import css from '../src/client/AdminWorkspace.module.css'
import { contributionApi } from '../src/client/experiments/contribution-api.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const user: AuthUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: 'SUPER_ADMIN',
  schoolId: 'platform',
  schoolName: '平台',
}

const authedAs = (role: AuthUser['role']) =>
  <S,>(selector: (state: AuthState) => S): S =>
    selector({ status: 'authed', user: { ...user, role } })

const dashboard = {
  schools: { total: 0, active: 0, disabled: 0 },
  users: {
    total: 0,
    byRole: { STUDENT: 0, TEACHER: 0, SCHOOL_ADMIN: 0, SUPER_ADMIN: 0 },
    disabled: 0,
  },
  sessions: { live: 0, distinctUsers: 0 },
  activity: [],
  learning: { available: false, attempts: 0, correct: 0, wrong: 0, nodes: [], days: 0 },
  limiters: {
    login: { tracked: 0, saturated: 0, limit: 5, windowMs: 60_000 },
    ip: { tracked: 0, saturated: 0, limit: 20, windowMs: 60_000 },
    apply: { tracked: 0, saturated: 0, limit: 10, windowMs: 60_000 },
  },
}

const api = {
  dashboard: async () => dashboard,
  listSchoolRequests: async () => ({ requests: [] }),
  approveSchoolRequest: async () => { throw new Error('unused') },
  rejectSchoolRequest: async () => { throw new Error('unused') },
  listSchools: async () => ({ schools: [] }),
  createSchool: async () => { throw new Error('unused') },
  setSchoolStatus: async () => { throw new Error('unused') },
  listUsers: async () => ({ users: [] }),
  createUser: async () => { throw new Error('unused') },
  setUserStatus: async () => { throw new Error('unused') },
  resetUserPassword: async () => ({ ok: true }),
  revokeUserSessions: async () => ({ ok: true }),
  listAudit: async () => ({ events: [] }),
  listPasswordResets: async () => ({ requests: [] }),
  issuePasswordReset: async () => { throw new Error('unused') },
  cancelPasswordReset: async () => { throw new Error('unused') },
  listDevices: async () => ({ devices: [], risk: [] }),
  setDeviceRevoked: async () => ({ deviceId: '', scope: '' }),
} as unknown as AdminApi

const paperApi = {
  listBankItems: async () => [],
  listSources: async () => [],
} as unknown as PaperApi

const noticeApi = {
  listFeedback: async () => ({ items: [] }),
  getPlatformNotice: async () => ({
    notice: {
      title: '',
      body: '',
      version: 0,
      enabled: true,
      updatedAt: '',
      updatedBy: '',
    },
    acknowledgedVersion: null,
  }),
} as unknown as NoticeApi

const modelPoolApi = {
  state: async () => ({
    settings: {
      id: 'settings',
      retryCount: 2,
      failureThreshold: 3,
      cooldownBaseMs: 30_000,
      cooldownMaxMs: 1_800_000,
      autoRecover: true,
      updatedAt: '',
      updatedBy: '',
    },
    channels: [],
    stats: {
      channels: 0,
      keys: 0,
      activeKeys: 0,
      cooldownKeys: 0,
      disabledKeys: 0,
    },
    audit: [],
    encryptionReady: true,
    proxy: { host: '127.0.0.1', port: 38972 },
  }),
} as unknown as ModelPoolApi

const expectSingleShell = (content: Element): void => {
  expect(document.querySelectorAll('[data-admin-page-header]')).toHaveLength(1)
  expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-admin-page-content]')).toHaveLength(1)
  expect(content.querySelector('[data-admin-page-header]')).toBeNull()
  expect(content.querySelector('[role="tablist"]')).toBeNull()
  expect(content.querySelector('[data-admin-page-content]')).toBeNull()

  const hasLegacyOuterWrapper = [...content.children].some(child =>
    (css.list !== undefined && child.classList.contains(css.list))
    || (css.poolRoot !== undefined && child.classList.contains(css.poolRoot)))
  expect(hasLegacyOuterWrapper).toBe(false)
}

describe('administrator shell', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('exports the shared admin primitives', () => {
    expect([
      AdminPage,
      AdminToolbar,
      AdminStats,
      AdminCard,
      AdminEmpty,
      AdminTable,
    ].every(primitive => typeof primitive === 'function')).toBe(true)
  })

  it('offers developer prompt management only to platform administrators', () => {
    const first = render(
      <AdminWorkspace api={api} useAuth={authedAs('SCHOOL_ADMIN')} t={t} />,
    )
    expect(screen.queryByRole('tab', { name: '开发提示词' })).toBeNull()
    first.unmount()
    render(<AdminWorkspace api={api} useAuth={authedAs('SUPER_ADMIN')} t={t} />)
    expect(screen.getByRole('tab', { name: '开发提示词' })).not.toBeNull()
  })

  it('offers experiment review only to platform administrators', () => {
    const first = render(
      <AdminWorkspace api={api} useAuth={authedAs('SCHOOL_ADMIN')} t={t} />,
    )
    expect(screen.queryByRole('tab', { name: '实验审核' })).toBeNull()
    first.unmount()
    render(<AdminWorkspace api={api} useAuth={authedAs('SUPER_ADMIN')} t={t} />)
    expect(screen.getByRole('tab', { name: '实验审核' })).not.toBeNull()
  })

  it('opens the experiment review queue without the contribution uploader', async () => {
    vi.spyOn(contributionApi, 'catalog').mockResolvedValue({
      active: null,
      canReview: true,
      items: [{
        id: 'pending-lens-2',
        experimentId: 'convex-lens',
        version: '2.0.0',
        schemaVersion: 2,
        protocolVersion: 2,
        sha256: 'a'.repeat(64),
        status: 'pending',
        author: { name: '实验创作者' },
        createdAt: '2026-11-04T00:00:00Z',
        note: '等待审核的独立凸透镜实验',
      }],
    })
    render(<AdminWorkspace api={api} useAuth={authedAs('SUPER_ADMIN')} t={t} />)

    fireEvent.click(screen.getByRole('tab', { name: '实验审核' }))

    expect(screen.getByRole('heading', { name: '实验审核' })).not.toBeNull()
    expect(await screen.findByRole('button', { name: '预览 v2.0.0' })).not.toBeNull()
    expect(screen.getByText('等待审核的独立凸透镜实验')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '上传并提交审核' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: '贡献资源' })).toBeNull()
  })

  it('keeps one page header, tablist, and content region across every visible tab', () => {
    render(
      <AdminWorkspace
        api={api}
        paperApi={paperApi}
        noticeApi={noticeApi}
        modelPoolApi={modelPoolApi}
        useAuth={authedAs('SUPER_ADMIN')}
        t={t}
      />,
    )

    const content = document.querySelector('[data-admin-page-content]')
    expect(content).not.toBeNull()

    for (const label of [
      '学校申请',
      '学校',
      '看板',
      '用户',
      '密码重置',
      '内容',
      '实验审核',
      '反馈',
      '公告',
      '模型通道',
      '运维',
      '设备',
      '审计',
    ]) {
      fireEvent.click(screen.getByRole('tab', { name: label }))
      expect(document.querySelector('[data-admin-page-content]')).toBe(content)
      expectSingleShell(content!)
    }
  })
})
