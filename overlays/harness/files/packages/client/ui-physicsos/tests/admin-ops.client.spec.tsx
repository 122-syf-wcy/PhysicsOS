// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminOpsTab } from '../src/client/AdminOpsTab.tsx'
import type { AdminApi, DashboardRow } from '../src/client/auth-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const dashboard = (): DashboardRow => ({
  schools: { total: 1, active: 1, disabled: 0 },
  users: { total: 2, byRole: { STUDENT: 2, TEACHER: 0, SCHOOL_ADMIN: 0, SUPER_ADMIN: 0 }, disabled: 0 },
  sessions: { live: 1, distinctUsers: 1 },
  activity: [],
  limiters: {
    login: { tracked: 3, saturated: 1, limit: 5, windowMs: 60_000 },
    ip: { tracked: 2, saturated: 0, limit: 20, windowMs: 60_000 },
    apply: { tracked: 0, saturated: 0, limit: 10, windowMs: 60_000 },
  },
})

/**
 * A stub that records what was asked of it.
 *
 * `createUser` rejects for the username `dup` — the case the per-row report
 * exists for — so the test can assert a PARTIAL import without needing a real
 * host.
 */
const stubApi = () => {
  const createUser = vi.fn().mockImplementation((input: { username: string }) =>
    input.username === 'dup'
      ? Promise.reject(new Error('该账号已被注册'))
      : Promise.resolve({}))
  const setUserStatus = vi.fn().mockImplementation((_s: string, username: string) =>
    username === 'missing'
      ? Promise.reject(new Error('账号不存在'))
      : Promise.resolve({}))
  const api = {
    dashboard: vi.fn().mockResolvedValue(dashboard()),
    createUser,
    setUserStatus,
  } as unknown as AdminApi
  return { api, createUser, setUserStatus }
}

const mount = (api: AdminApi, isSuper = true) =>
  render(<AdminOpsTab api={api} isSuper={isSuper} t={t} />)

const csvBox = () => screen.getByTestId('ops-csv')

describe('AdminOpsTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('reports a partial CSV import row by row', async () => {
    /* The whole point: 2 of 3 land, and the operator is told WHICH row did not
       — "import failed" would be both wrong and unusable. */
    const { api, createUser } = stubApi()
    mount(api)
    await waitFor(() => { expect(createUser).not.toHaveBeenCalled() })

    fireEvent.change(csvBox(), {
      target: {
        value: [
          'username,displayName,password,role',
          's1,甲同学,pw1,STUDENT',
          'dup,乙同学,pw2,STUDENT',
          's3,丙同学,pw3,TEACHER',
        ].join('\n'),
      },
    })
    /* The header row is skipped, not counted as malformed. */
    expect(screen.getByText(/将导入 3 行/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }))

    await waitFor(() => { expect(screen.getByTestId('ops-report')).toBeTruthy() })
    const report = screen.getByTestId('ops-report')
    expect(report.textContent).toContain('成功 2 条')
    expect(report.textContent).toContain('失败 1 条')
    expect(report.textContent).toContain('第 3 行')
    expect(report.textContent).toContain('该账号已被注册')
    /* The two good rows did not get re-sent because one failed. */
    expect(createUser).toHaveBeenCalledTimes(3)
  })

  it('rejects a malformed row without calling the host for it', async () => {
    const { api, createUser } = stubApi()
    mount(api)

    fireEvent.change(csvBox(), {
      target: { value: 's1,甲同学\ns2,乙同学,pw2,STUDENT' },
    })
    expect(screen.getByText(/另有 1 行格式有问题/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }))

    await waitFor(() => { expect(screen.getByTestId('ops-report')).toBeTruthy() })
    /* Only the well-formed row reached the API. */
    expect(createUser).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('ops-report').textContent).toContain('需要 账号,姓名,密码')
  })

  it('refuses an unknown role rather than guessing', async () => {
    const { api, createUser } = stubApi()
    mount(api)

    fireEvent.change(csvBox(), {
      target: { value: 's1,甲同学,pw1,PRINCIPAL' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }))

    await waitFor(() => { expect(screen.getByTestId('ops-report')).toBeTruthy() })
    expect(createUser).not.toHaveBeenCalled()
    expect(screen.getByTestId('ops-report').textContent).toContain('角色只能是 STUDENT 或 TEACHER')
  })

  it('batch-disables and reports the row that did not land', async () => {
    const { api, setUserStatus } = stubApi()
    mount(api)
    await waitFor(() => { expect(setUserStatus).not.toHaveBeenCalled() })

    fireEvent.change(screen.getByTestId('ops-disable'), {
      target: { value: 's1\nmissing\ns3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始停用' }))

    await waitFor(() => { expect(screen.getByTestId('ops-disable-report')).toBeTruthy() })
    const report = screen.getByTestId('ops-disable-report')
    expect(report.textContent).toContain('成功 2 条')
    expect(report.textContent).toContain('账号不存在')
    expect(setUserStatus).toHaveBeenCalledTimes(3)
  })

  it('takes only the first column of a pasted table for batch disable', async () => {
    /* A graduation list pasted out of a spreadsheet arrives with extra cells;
       the account is the first one and the trailing columns are not an error. */
    const { api, setUserStatus } = stubApi()
    mount(api)

    fireEvent.change(screen.getByTestId('ops-disable'), {
      target: { value: 's1,甲同学,2026-07\ns2,乙同学,2026-07' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始停用' }))

    await waitFor(() => { expect(setUserStatus).toHaveBeenCalledTimes(2) })
    expect(setUserStatus).toHaveBeenCalledWith(expect.any(String), 's1', 'disabled')
    expect(setUserStatus).toHaveBeenCalledWith(expect.any(String), 's2', 'disabled')
  })

  it('shows the rate limiters as counts, without identities', async () => {
    const { api } = stubApi()
    mount(api)
    await waitFor(() => {
      expect(document.querySelector('[data-stat="limiter.login"]')).not.toBeNull()
    })

    const login = document.querySelector('[data-stat="limiter.login"]')?.textContent ?? ''
    expect(login).toContain('1')
    expect(login).toContain('3/5')
    /* Aggregates only — no key material leaks into the console. */
    expect(login).not.toContain('@')
    expect(login).not.toContain('127.0.0.1')
  })
})
