// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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
  afterEach(cleanup)

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
