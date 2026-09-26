// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminApi, AuthApi, AuthUser } from '../src/client/auth-api.ts'
import {
  createAuthController, migrateAnonymousProgress, namespacedStorage,
} from '../src/client/auth-store.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import { AuthGate } from '../src/client/AuthGate.tsx'
import { SidebarBrand } from '../src/client/SidebarBrand.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import { zh } from '../src/client/locales.ts'

/* Auth V1 client specs: controller lifecycle (boot/login/logout/namespace),
   the gate's three views — login is account+password with the school only
   surfacing through SCHOOL_REQUIRED disambiguation, register resolves a
   free-text school name — and the sidebar identity surfaces, all against a
   stub AuthApi, no network. */

afterEach(cleanup)
beforeEach(() => { globalThis.localStorage.clear() })

const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

const neverHook = (() => {
  throw new Error('unused hook')
}) as never

const USER: AuthUser = {
  id: 'u_test1', schoolId: 'GZU', schoolName: '贵州大学',
  username: '2023123456', displayName: '李明', role: 'STUDENT',
}

const apiError = (
  code: string, message: string,
  candidates?: { id: string; name: string; city?: string; county?: string }[],
): Error => {
  const error = new Error(message) as Error & { code: string; candidates?: unknown }
  Object.defineProperty(error, 'code', { value: code })
  if (candidates !== undefined) Object.defineProperty(error, 'candidates', { value: candidates })
  return error
}

const stubApi = (overrides: Partial<AuthApi> = {}): AuthApi => ({
  register: async () => ({ user: USER }),
  login: async () => ({ user: USER }),
  logout: async () => ({ ok: true }),
  me: async () => ({ user: USER }),
  forgotPassword: async () => ({ ok: true }),
  resetPassword: async () => ({ ok: true }),
  reportLearning: async () => ({ ok: true }),
  ...overrides,
})

const unauthenticated = (): AuthApi =>
  stubApi({
    me: async () => {
      const error = new Error('未登录') as Error & { code: string }
      Object.defineProperty(error, 'code', { value: 'UNAUTHENTICATED' })
      throw error
    },
  })

const gateProps = (state: AuthState) => ({
  useAuth: <S,>(selector: (state: AuthState) => S): S => selector(state),
  login: vi.fn(async () => {}),
  register: vi.fn(async () => {}),
  forgotPassword: vi.fn(async () => ({ ok: true })),
  useSessions: neverHook,
  useWorkspaces: neverHook,
  t,
})

describe('auth controller', () => {
  it('boots authed when /me resolves a user', async () => {
    const controller = createAuthController(stubApi(), globalThis.localStorage)
    await controller.boot()
    expect(controller.store.getSnapshot().status).toBe('authed')
    expect(controller.store.getSnapshot().user?.schoolName).toBe('贵州大学')
  })

  it('boots guest on UNAUTHENTICATED and clears the stale hint', async () => {
    globalThis.localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: 'u_old', schoolId: 'GZU' }))
    const controller = createAuthController(unauthenticated(), globalThis.localStorage)
    await controller.boot()
    expect(controller.store.getSnapshot().status).toBe('guest')
    expect(globalThis.localStorage.getItem('physicsos.auth.user')).toBeNull()
  })

  it('a stored hint binds the userStorage namespace for the data controllers', () => {
    globalThis.localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: 'u_abc', schoolId: 'GZU' }))
    const controller = createAuthController(stubApi(), globalThis.localStorage)
    controller.userStorage.setItem('physicsos.recent-scenes', '[]')
    expect(globalThis.localStorage.getItem('physicsos.u.u_abc.physicsos.recent-scenes')).toBe('[]')
    /* The anonymous key stays untouched — a guest boot still owns it. */
    expect(globalThis.localStorage.getItem('physicsos.recent-scenes')).toBeNull()
  })

  it('login persists the identity hint and hands off to a reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const controller = createAuthController(stubApi(), globalThis.localStorage)
    await controller.login({ username: 'u1', password: 'p', rememberDevice: false })
    expect(JSON.parse(globalThis.localStorage.getItem('physicsos.auth.user') ?? '{}')).toMatchObject({ id: 'u_test1' })
    expect(reload).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('logout clears the hint even when the API call fails', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    globalThis.localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: 'u_test1', schoolId: 'GZU' }))
    const controller = createAuthController(
      stubApi({ logout: async () => { throw new Error('network down') } }),
      globalThis.localStorage,
    )
    await controller.logout()
    expect(globalThis.localStorage.getItem('physicsos.auth.user')).toBeNull()
    expect(reload).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('user storage namespace', () => {
  it('namespaces every key and clears only its own', () => {
    const ns = namespacedStorage(globalThis.localStorage, 'u_1')
    ns.setItem('a', '1')
    globalThis.localStorage.setItem('a', 'other')
    ns.setItem('b', '2')
    expect(ns.getItem('a')).toBe('1')
    ns.clear()
    expect(globalThis.localStorage.getItem('physicsos.u.u_1.a')).toBeNull()
    expect(globalThis.localStorage.getItem('physicsos.u.u_1.b')).toBeNull()
    expect(globalThis.localStorage.getItem('a')).toBe('other')
  })

  it('migrates anonymous progress once, never overwriting existing namespaced data', () => {
    globalThis.localStorage.setItem('physicsos.recent-scenes', 'anon-scenes')
    migrateAnonymousProgress(globalThis.localStorage, 'u_1')
    expect(globalThis.localStorage.getItem('physicsos.u.u_1.physicsos.recent-scenes')).toBe('anon-scenes')
    /* A second run must not clobber newer namespaced data. */
    globalThis.localStorage.setItem('physicsos.u.u_1.physicsos.recent-scenes', 'newer')
    globalThis.localStorage.setItem('physicsos.recent-scenes', 'stale-anon')
    migrateAnonymousProgress(globalThis.localStorage, 'u_1')
    expect(globalThis.localStorage.getItem('physicsos.u.u_1.physicsos.recent-scenes')).toBe('newer')
  })
})

describe('AuthGate', () => {
  it('renders nothing while authed', () => {
    const { container } = render(<AuthGate {...gateProps({ status: 'authed', user: USER })} />)
    expect(container.firstChild).toBeNull()
  })

  it('covers the shell with the login form for guests — no school field', () => {
    const { getByText, queryByText } = render(
      <AuthGate {...gateProps({ status: 'guest' })} />,
    )
    expect(getByText('探索一个物理世界')).toBeTruthy()
    expect(queryByText('学校')).toBeNull()
    expect(getByText('登录 PhysicsOS')).toBeTruthy()
    expect(getByText('忘记密码')).toBeTruthy()
    expect(getByText('记住此设备')).toBeTruthy()
  })

  it('requires credentials before submitting', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByRole } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('登录 PhysicsOS'))
    await waitFor(() => { expect(getByRole('alert').textContent).toBe('请输入账号和密码') })
    expect(props.login).not.toHaveBeenCalled()
  })

  it('submits account + password only and surfaces a server rejection', async () => {
    const props = gateProps({ status: 'guest' })
    props.login.mockRejectedValue(new Error('账号或密码不正确'))
    const { getByText, getByRole, container } = render(<AuthGate {...props} />)

    const [usernameInput] = [...container.querySelectorAll('input[type="text"]')]
      .filter(el => (el as HTMLInputElement).autocomplete === 'username')
    fireEvent.change(usernameInput!, { target: { value: '2023123456' } })
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'hunter2pass' } })
    fireEvent.click(getByText('登录 PhysicsOS'))

    await waitFor(() => { expect(getByRole('alert').textContent).toBe('账号或密码不正确') })
    expect(props.login).toHaveBeenCalledWith({
      username: '2023123456', password: 'hunter2pass', rememberDevice: false,
    })
  })

  it('SCHOOL_REQUIRED reveals the candidate select and retries with schoolId', async () => {
    const props = gateProps({ status: 'guest' })
    props.login
      .mockRejectedValueOnce(apiError('SCHOOL_REQUIRED', '该账号属于多所学校，请选择你的学校', [
        { id: 'GZU', name: '贵州大学', city: '贵阳市', county: '花溪区' },
        { id: 'GZNU', name: '贵州师范大学', city: '贵阳市' },
      ]))
      .mockResolvedValueOnce(undefined)
    const { getByText, container } = render(<AuthGate {...props} />)

    const [usernameInput] = [...container.querySelectorAll('input[type="text"]')]
      .filter(el => (el as HTMLInputElement).autocomplete === 'username')
    fireEvent.change(usernameInput!, { target: { value: 'shared01' } })
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'sharedpass1' } })
    fireEvent.click(getByText('登录 PhysicsOS'))

    /* The picker is a GlassSelect combobox: open it, then read the rows the
       popover renders (they carry the region labels that disambiguate). */
    const picker = await waitFor(() => {
      const found = container.querySelector('[data-glass-select]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    fireEvent.click(picker)
    const options = screen.getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['贵州大学（贵阳市 花溪区）', '贵州师范大学（贵阳市）'])
    fireEvent.click(screen.getByRole('option', { name: '贵州师范大学（贵阳市）' }))
    fireEvent.click(getByText('登录 PhysicsOS'))
    await waitFor(() => {
      expect(props.login).toHaveBeenLastCalledWith({
        username: 'shared01', password: 'sharedpass1', rememberDevice: false, schoolId: 'GZNU',
      })
    })
  })

  it('switches to the register view and validates the form', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByRole } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    expect(getByText('创建你的学习空间')).toBeTruthy()
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => { expect(getByRole('alert').textContent).toBe('请先填写学校') })
  })

  it('registers with a free-text schoolName', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    const school = container.querySelector('input[autocomplete="organization"]')!
    fireEvent.change(school, { target: { value: '贵州大学' } })
    const inputs = [...container.querySelectorAll('input[type="text"]')]
    const usernameInput = inputs.find(el => (el as HTMLInputElement).autocomplete === 'username')!
    const nameInput = inputs.find(el => (el as HTMLInputElement).autocomplete === 'name')!
    fireEvent.change(usernameInput, { target: { value: 's2024001' } })
    fireEvent.change(nameInput, { target: { value: '李明' } })
    for (const input of container.querySelectorAll('input[type="password"]')) {
      fireEvent.change(input, { target: { value: 'hunter2pass' } })
    }
    fireEvent.click(container.querySelector('input[type="checkbox"]')!)
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(props.register).toHaveBeenCalledWith({
        schoolName: '贵州大学', username: 's2024001', displayName: '李明', password: 'hunter2pass',
      })
    })
  })

  it('registers an unlisted school straight through — the gate has no apply step', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, queryByText, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    expect(queryByText('找不到你的学校？申请开通')).toBeNull()
    fireEvent.change(container.querySelector('input[autocomplete="organization"]')!, {
      target: { value: '贵阳一中' },
    })
    const inputs = [...container.querySelectorAll('input[type="text"]')]
    fireEvent.change(inputs.find(el => (el as HTMLInputElement).autocomplete === 'username')!, {
      target: { value: 's2024001' },
    })
    fireEvent.change(inputs.find(el => (el as HTMLInputElement).autocomplete === 'name')!, {
      target: { value: '李明' },
    })
    for (const input of container.querySelectorAll('input[type="password"]')) {
      fireEvent.change(input, { target: { value: 'hunter2pass' } })
    }
    fireEvent.click(container.querySelector('input[type="checkbox"]')!)
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(props.register).toHaveBeenCalledWith({
        schoolName: '贵阳一中', username: 's2024001', displayName: '李明', password: 'hunter2pass',
      })
    })
  })

  it('shows the forgot receipt after a reset request — username only', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('忘记密码'))
    const [usernameInput] = [...container.querySelectorAll('input[type="text"]')]
      .filter(el => (el as HTMLInputElement).autocomplete === 'username')
    fireEvent.change(usernameInput!, { target: { value: '2023123456' } })
    fireEvent.click(getByText('提交重置请求'))
    await waitFor(() => { expect(getByText(/已记录你的重置请求/)).toBeTruthy() })
    expect(props.forgotPassword).toHaveBeenCalledWith({ username: '2023123456' })
  })
})

describe('sidebar identity', () => {
  it('renders the school under the brand when authed', () => {
    const state: AuthState = { status: 'authed', user: USER }
    const { getByText } = render(
      <SidebarBrand
        wide
        openHome={vi.fn()}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
      />,
    )
    expect(getByText('PhysicsOS')).toBeTruthy()
    expect(getByText('贵州大学')).toBeTruthy()
  })

  it('hides the school line for guests', () => {
    const state: AuthState = { status: 'guest' }
    const { queryByText } = render(
      <SidebarBrand
        wide
        openHome={vi.fn()}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
      />,
    )
    expect(queryByText('贵州大学')).toBeNull()
  })

  it('opens the account menu and logout calls back', async () => {
    const state: AuthState = { status: 'authed', user: USER }
    const logout = vi.fn(async () => {})
    const { getByLabelText, getByText } = render(
      <SidebarFooter
        wide
        startSession={vi.fn()}
        openHome={vi.fn()}
        logout={logout}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
      />,
    )
    fireEvent.click(getByLabelText('账户菜单'))
    expect(getByText('李明 · 2023123456')).toBeTruthy()
    expect(getByText('贵州大学')).toBeTruthy()
    fireEvent.click(getByText('退出登录'))
    expect(logout).toHaveBeenCalled()
  })

  it('offers 管理后台 only to admin roles and calls back', () => {
    const admin: AuthUser = { ...USER, role: 'SCHOOL_ADMIN' }
    const openAdmin = vi.fn()
    const { getByLabelText, getByText, queryByText, unmount } = render(
      <SidebarFooter
        wide
        startSession={vi.fn()}
        openHome={vi.fn()}
        openAdmin={openAdmin}
        logout={vi.fn(async () => {})}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector({ status: 'authed', user: admin })}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
      />,
    )
    fireEvent.click(getByLabelText('账户菜单'))
    fireEvent.click(getByText('管理后台'))
    expect(openAdmin).toHaveBeenCalled()
    unmount()

    /* A student menu never shows the entry — the host still re-checks. */
    const student = render(
      <SidebarFooter
        wide
        startSession={vi.fn()}
        openHome={vi.fn()}
        openAdmin={openAdmin}
        logout={vi.fn(async () => {})}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector({ status: 'authed', user: USER })}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
      />,
    )
    fireEvent.click(student.getByLabelText('账户菜单'))
    expect(student.queryByText('管理后台')).toBeNull()
    expect(queryByText('管理后台')).toBeNull()
  })
})

describe('AdminWorkspace', () => {
  const adminApi = (): AdminApi => ({
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
    dashboard: async () => { throw new Error('unused') },
    listDevices: async () => ({ devices: [], risk: [] }),
    setDeviceRevoked: async () => ({ deviceId: '', scope: '' }),
  })

  const authedAs = (role: AuthUser['role']) =>
    <S,>(selector: (state: AuthState) => S): S =>
      selector({ status: 'authed', user: { ...USER, role } })

  it('shows all four tabs to SUPER_ADMIN', async () => {
    const { getByRole } = render(
      <AdminWorkspace api={adminApi()} useAuth={authedAs('SUPER_ADMIN')} t={t} />,
    )
    for (const tab of ['学校申请', '学校', '用户', '审计']) {
      expect(getByRole('tab', { name: tab })).toBeTruthy()
    }
    await waitFor(() => { expect(getByRole('tab', { name: '用户' })).toBeTruthy() })
  })

  it('scopes SCHOOL_ADMIN to 用户/审计 only', () => {
    const { getByRole, queryByRole } = render(
      <AdminWorkspace api={adminApi()} useAuth={authedAs('SCHOOL_ADMIN')} t={t} />,
    )
    expect(getByRole('tab', { name: '用户' })).toBeTruthy()
    expect(getByRole('tab', { name: '审计' })).toBeTruthy()
    expect(queryByRole('tab', { name: '学校申请' })).toBeNull()
    expect(queryByRole('tab', { name: '学校' })).toBeNull()
  })

  it('renders the forbidden state for non-admin roles', () => {
    const { getByText, queryByRole } = render(
      <AdminWorkspace api={adminApi()} useAuth={authedAs('STUDENT')} t={t} />,
    )
    expect(getByText('当前账号没有管理权限')).toBeTruthy()
    expect(queryByRole('tab')).toBeNull()
  })
})
