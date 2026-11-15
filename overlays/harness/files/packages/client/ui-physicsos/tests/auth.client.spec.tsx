// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AdminApi, AuthApi, AuthUser, RegisterOutcome, SchoolRow,
} from '../src/client/auth-api.ts'
import type { NoticeApi } from '../src/client/notice-api.ts'
import {
  createAuthController, migrateAnonymousProgress, namespacedStorage,
} from '../src/client/auth-store.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import { AuthGate } from '../src/client/AuthGate.tsx'
import { SidebarBrandName } from '../src/client/SidebarBrand.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import { en, zh } from '../src/client/locales.ts'

/* Auth V1 client specs: controller lifecycle (boot/login/logout/namespace),
   the gate's views — login is account+password with the school only surfacing
   through SCHOOL_REQUIRED disambiguation, register searches the roster for
   quick picks and parks an unlisted school for administrator review — and the
   sidebar identity surfaces, all against a stub AuthApi, no network. */

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
  register: async () => ({ kind: 'registered' as const, user: USER }),
  login: async () => ({ user: USER }),
  searchSchools: async () => ({ schools: [] }),
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

/**
 * Fill the registration form the way the UI drives it.
 * @param container - the rendered gate.
 * @param values - the fields to type; email defaults to a valid address.
 */
const fillRegister = (
  container: HTMLElement,
  values: { school?: string; username: string; displayName: string; email?: string; password?: string },
): void => {
  fireEvent.change(container.querySelector('input[autocomplete="organization"]')!, {
    target: { value: values.school ?? '贵州大学' },
  })
  const inputs = [...container.querySelectorAll('input[type="text"]')]
  fireEvent.change(inputs.find(el => (el as HTMLInputElement).autocomplete === 'username')!, {
    target: { value: values.username },
  })
  fireEvent.change(inputs.find(el => (el as HTMLInputElement).autocomplete === 'name')!, {
    target: { value: values.displayName },
  })
  fireEvent.change(container.querySelector('input[type="email"]')!, {
    target: { value: values.email ?? `${values.username}@example.com` },
  })
  for (const input of container.querySelectorAll('input[type="password"]')) {
    fireEvent.change(input, { target: { value: values.password ?? 'hunter2pass' } })
  }
  fireEvent.click(container.querySelector('input[type="checkbox"]')!)
}

const gateProps = (state: AuthState) => ({
  useAuth: <S,>(selector: (state: AuthState) => S): S => selector(state),
  login: vi.fn(async () => {}),
  register: vi.fn(async (): Promise<RegisterOutcome> => ({ kind: 'registered', user: USER })),
  searchSchools: vi.fn(async () => ({ schools: [] as SchoolRow[] })),
  forgotPassword: vi.fn(async () => ({ ok: true })),
  useSessions: neverHook,
  useWorkspaces: neverHook,
  t,
})

describe('auth controller', () => {
  it('boots authed when /me resolves a user', async () => {
    globalThis.localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: USER.id, schoolId: USER.schoolId }))
    const controller = createAuthController(stubApi(), globalThis.localStorage)
    await controller.boot()
    expect(controller.store.getSnapshot().status).toBe('authed')
    expect(controller.store.getSnapshot().user?.schoolName).toBe('贵州大学')
  })

  it('rebinds a recovered cookie session before publishing authed over anonymous storage', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    try {
      localStorage.setItem('physicsos.recent-scenes', 'anonymous-scenes')
      const controller = createAuthController(stubApi(), localStorage)
      const statuses: string[] = []
      const stop = controller.store.subscribe(() => {
        const status = controller.store.getSnapshot().status
        statuses.push(status)
        if (status === 'authed') controller.userStorage.setItem('physicsos.recent-scenes', 'private-scenes')
      })
      await controller.boot()
      stop()
      expect(statuses).not.toContain('authed')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem('physicsos.auth.user')!)).toEqual({ id: USER.id, schoolId: USER.schoolId })
      expect(localStorage.getItem('physicsos.recent-scenes')).toBe('anonymous-scenes')
      expect(localStorage.getItem(`physicsos.u.${USER.id}.physicsos.recent-scenes`)).toBe('anonymous-scenes')

      const rebound = createAuthController(stubApi(), localStorage)
      await rebound.boot()
      expect(rebound.store.getSnapshot().status).toBe('authed')
      rebound.userStorage.setItem('physicsos.recent-scenes', 'private-scenes')
      expect(localStorage.getItem('physicsos.recent-scenes')).toBe('anonymous-scenes')
      expect(localStorage.getItem(`physicsos.u.${USER.id}.physicsos.recent-scenes`)).toBe('private-scenes')
      expect(reload).toHaveBeenCalledTimes(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('does not reload repeatedly or sync private data when the recovered identity cannot persist', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    try {
      const storage = {
        getItem: () => null,
        setItem: () => { throw new Error('storage unavailable') },
        removeItem: () => {},
        clear: () => {}, key: () => null, length: 0,
      }
      const controller = createAuthController(stubApi(), storage)
      await controller.boot()
      expect(reload).not.toHaveBeenCalled()
      expect(controller.store.getSnapshot().status).toBe('guest')
    } finally { vi.unstubAllGlobals() }
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
    expect(getByText('欢迎回到 PhysicsOS')).toBeTruthy()
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

  it('registers with a free-text schoolName and a contact email', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fillRegister(container, { username: 's2024001', displayName: '李明' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(props.register).toHaveBeenCalledWith({
        schoolName: '贵州大学',
        username: 's2024001',
        displayName: '李明',
        password: 'hunter2pass',
        email: 's2024001@example.com',
      })
    })
  })

  it('requires an email before submitting', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByRole, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fillRegister(container, { username: 's2024002', displayName: '李明', email: '' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(getByRole('alert').textContent).toContain('请填写邮箱')
    })
    expect(props.register).not.toHaveBeenCalled()
  })

  it('rejects a malformed email before submitting', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByRole, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fillRegister(container, { username: 's2024003', displayName: '李明', email: 'not-an-address' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(getByRole('alert').textContent).toContain('有效的邮箱')
    })
    expect(props.register).not.toHaveBeenCalled()
  })

  it('offers quick picks as the school name is typed, and pins the chosen tenant', async () => {
    const props = gateProps({ status: 'guest' })
    vi.mocked(props.searchSchools).mockResolvedValue({
      schools: [{ id: 'GZU', name: '贵州大学', city: '贵阳市' }],
    })
    const { getByText, findByTestId, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fireEvent.change(container.querySelector('input[autocomplete="organization"]')!, {
      target: { value: '贵州' },
    })
    /* The lookup is debounced, so the option list appears after a pause. */
    const option = await findByTestId('school-option')
    expect(option.textContent).toContain('贵州大学（贵阳市）')
    expect(props.searchSchools).toHaveBeenCalledWith('贵州')
    fireEvent.click(option)
    fillRegister(container, { school: '贵州大学', username: 's2024004', displayName: '李明' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(props.register).toHaveBeenCalledWith(
        expect.objectContaining({ schoolName: '贵州大学', schoolId: 'GZU' }),
      )
    })
  })

  it('shows the apply-for-review hint when the roster has no match', async () => {
    const props = gateProps({ status: 'guest' })
    vi.mocked(props.searchSchools).mockResolvedValue({ schools: [] })
    const { getByText, findByTestId, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fireEvent.change(container.querySelector('input[autocomplete="organization"]')!, {
      target: { value: '贵阳一中' },
    })
    const hint = await findByTestId('school-not-found')
    expect(hint.textContent).toContain('审核')
    expect(getByText('创建 PhysicsOS 账号')).toBeTruthy()
  })

  it('shows the review receipt when the school needs administrator approval', async () => {
    const props = gateProps({ status: 'guest' })
    vi.mocked(props.register).mockResolvedValue({
      kind: 'pending',
      requestId: 'sr_test',
      schoolName: '贵阳一中',
      username: 's2024005',
      email: 's2024005@example.com',
    })
    const { getByText, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fillRegister(container, { school: '贵阳一中', username: 's2024005', displayName: '李明' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => {
      expect(container.querySelector('[data-physicsos-auth-view="pending"]')).toBeTruthy()
    })
    /* The receipt names what was submitted and how the answer arrives. */
    expect(getByText('申请已提交，等待管理员审核')).toBeTruthy()
    expect(getByText('贵阳一中')).toBeTruthy()
    expect(getByText('s2024005@example.com')).toBeTruthy()
    fireEvent.click(getByText('返回登录'))
    await waitFor(() => { expect(getByText('登录 PhysicsOS')).toBeTruthy() })
  })

  it('shows the forgot receipt after a reset request — username only when no school is selected', async () => {
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

  it('associates readable labels, focuses the invalid field and preserves keyboard submission', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByLabelText, getByRole, container } = render(<AuthGate {...props} />)
    const account = getByLabelText('账号') as HTMLInputElement
    const password = getByLabelText('密码') as HTMLInputElement
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    expect(document.activeElement).toBe(account)
    expect(account.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(account.getAttribute('aria-describedby')!)?.getAttribute('role')).toBe('alert')
    fireEvent.change(account, { target: { value: '  keyboard01  ' } })
    fireEvent.change(password, { target: { value: 'keyboard-pass' } })
    fireEvent.submit(form)
    await waitFor(() => { expect(props.login).toHaveBeenCalledWith({ username: 'keyboard01', password: 'keyboard-pass', rememberDevice: false }) })
    expect(getByRole('button', { name: '请稍候…' }).hasAttribute('disabled')).toBe(true)
  })

  it('does not choose an arbitrary same-name school or submit twice while login is pending', async () => {
    let resolve!: () => void
    const props = gateProps({ status: 'guest' })
    props.login.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const { getByLabelText, container } = render(<AuthGate {...props} />)
    fireEvent.change(getByLabelText('账号'), { target: { value: 'shared01' } })
    fireEvent.change(getByLabelText('密码'), { target: { value: 'sharedpass1' } })
    fireEvent.submit(container.querySelector('form')!)
    fireEvent.submit(container.querySelector('form')!)
    expect(props.login).toHaveBeenCalledTimes(1)
    expect((getByLabelText('账号') as HTMLInputElement).matches(':disabled')).toBe(true)
    resolve()
    await Promise.resolve()
  })

  it('requires an explicit school choice after SCHOOL_REQUIRED instead of defaulting to the first tenant', async () => {
    const props = gateProps({ status: 'guest' })
    props.login.mockRejectedValue(apiError('SCHOOL_REQUIRED', '请选择所属学校', [
      { id: 'school-one', name: '第一学校' }, { id: 'school-two', name: '第二学校' },
    ]))
    const { getByLabelText, getByText, getByRole } = render(<AuthGate {...props} />)
    fireEvent.change(getByLabelText('账号'), { target: { value: 'shared01' } })
    fireEvent.change(getByLabelText('密码'), { target: { value: 'sharedpass1' } })
    fireEvent.click(getByText('登录 PhysicsOS'))
    await waitFor(() => { expect(getByRole('combobox').textContent).toContain('选择你的学校') })
    fireEvent.click(getByText('登录 PhysicsOS'))
    await waitFor(() => { expect(getByRole('alert').textContent).toBe('请先选择所属学校，再继续提交') })
    expect(props.login).toHaveBeenCalledTimes(1)
  })

  it('keeps password and confirmation visibility separate without losing the values', () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByLabelText, getByRole } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    const password = getByLabelText('密码') as HTMLInputElement
    const confirm = getByLabelText('确认密码') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'private-pass-1' } })
    fireEvent.change(confirm, { target: { value: 'private-pass-1' } })
    fireEvent.click(getByRole('button', { name: '显示密码' }))
    expect(password.type).toBe('text')
    expect(confirm.type).toBe('password')
    expect(getByRole('button', { name: '隐藏密码' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(getByRole('button', { name: '显示确认密码' }))
    expect(confirm.type).toBe('text')
    expect(password.value).toBe('private-pass-1')
    expect(confirm.value).toBe('private-pass-1')
  })

  it('supports school selection with ArrowDown and Enter without submitting the form', async () => {
    const props = gateProps({ status: 'guest' })
    props.searchSchools.mockResolvedValue({ schools: [
      { id: 'same-east', name: '同名中学', city: '贵阳市', county: '南明区' },
      { id: 'same-west', name: '同名中学', city: '贵阳市', county: '花溪区' },
    ] })
    const { getByText, getByLabelText, findAllByRole, container } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    const school = getByLabelText('学校') as HTMLInputElement
    fireEvent.change(school, { target: { value: '同名' } })
    const rows = await findAllByRole('option')
    expect(rows.map(row => row.textContent)).toEqual(['同名中学（贵阳市 南明区）', '同名中学（贵阳市 花溪区）'])
    fireEvent.keyDown(school, { key: 'ArrowDown' })
    fireEvent.keyDown(school, { key: 'ArrowDown' })
    expect(school.getAttribute('aria-activedescendant')).toBe(rows[1]!.id)
    fireEvent.keyDown(school, { key: 'Enter' })
    expect(school.value).toBe('同名中学')
    expect(school.getAttribute('aria-expanded')).toBe('false')
    expect(props.register).not.toHaveBeenCalled()
    fillRegister(container, { school: '同名中学', username: 'schoolkey01', displayName: '测试学生' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => { expect(props.register).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'same-west' })) })
  })

  it('separates lookup network failure from an unlisted school and can retry', async () => {
    const props = gateProps({ status: 'guest' })
    props.searchSchools.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ schools: [] })
    const { getByText, getByLabelText, findByTestId, queryByTestId } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fireEvent.change(getByLabelText('学校'), { target: { value: '新学校' } })
    const failed = await findByTestId('school-lookup-failed')
    expect(failed.textContent).toContain('暂时未连接')
    expect(queryByTestId('school-not-found')).toBeNull()
    fireEvent.click(getByText('重试搜索'))
    expect((await findByTestId('school-not-found')).textContent).toContain('审核')
    expect(props.searchSchools).toHaveBeenCalledTimes(2)
  })

  it('never permits a stale school lookup to overwrite the latest search', async () => {
    let oldReply!: (value: { schools: SchoolRow[] }) => void
    const props = gateProps({ status: 'guest' })
    props.searchSchools.mockImplementation(async query => query === '旧学校'
      ? await new Promise<{ schools: SchoolRow[] }>((resolve) => { oldReply = resolve })
      : { schools: [{ id: 'new-school', name: '新学校' }] })
    const { getByText, getByLabelText, findByTestId, queryByText } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fireEvent.change(getByLabelText('学校'), { target: { value: '旧学校' } })
    await waitFor(() => { expect(props.searchSchools).toHaveBeenCalledWith('旧学校') })
    fireEvent.change(getByLabelText('学校'), { target: { value: '新学校' } })
    expect((await findByTestId('school-option')).textContent).toBe('新学校')
    oldReply({ schools: [{ id: 'old-school', name: '旧学校结果' }] })
    await waitFor(() => { expect(queryByText('旧学校结果')).toBeNull() })
  })

  it('focuses a network error, preserves entries, and makes the submit available to retry', async () => {
    const props = gateProps({ status: 'guest' })
    props.login.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { getByLabelText, getByText, findByRole, getByRole } = render(<AuthGate {...props} />)
    fireEvent.change(getByLabelText('账号'), { target: { value: 'network01' } })
    fireEvent.change(getByLabelText('密码'), { target: { value: 'network-pass' } })
    fireEvent.click(getByText('登录 PhysicsOS'))
    const alert = await findByRole('alert')
    expect(alert.textContent).toContain('网络连接失败')
    expect(document.activeElement).toBe(alert)
    expect((getByLabelText('账号') as HTMLInputElement).value).toBe('network01')
    expect((getByLabelText('密码') as HTMLInputElement).value).toBe('network-pass')
    expect(getByRole('button', { name: '登录 PhysicsOS' }).hasAttribute('disabled')).toBe(false)
  })

  it('does not claim recovery success when the callback returns ok false', async () => {
    const props = gateProps({ status: 'guest' })
    props.forgotPassword.mockResolvedValue({ ok: false })
    const { getByText, getByLabelText, findByRole, queryByText } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('忘记密码'))
    fireEvent.change(getByLabelText('账号'), { target: { value: 'recovery01' } })
    fireEvent.click(getByText('提交重置请求'))
    expect((await findByRole('alert')).textContent).toBe('操作失败，请稍后再试')
    expect(queryByText('找回请求已提交')).toBeNull()
  })

  it('passes a selected schoolId for recovery without changing the username-only default', async () => {
    const props = gateProps({ status: 'guest' })
    props.searchSchools.mockResolvedValue({ schools: [{ id: 'GZU', name: '贵州大学', city: '贵阳市' }] })
    const { getByText, getByLabelText, findByTestId } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('忘记密码'))
    fireEvent.change(getByLabelText('账号'), { target: { value: 'shared01' } })
    fireEvent.change(getByLabelText('学校（选填）'), { target: { value: '贵州' } })
    fireEvent.click(await findByTestId('school-option'))
    fireEvent.click(getByText('提交重置请求'))
    await waitFor(() => { expect(props.forgotPassword).toHaveBeenCalledWith({ username: 'shared01', schoolId: 'GZU' }) })
  })

  it('does not silently discard a typed recovery school without a chosen tenant', async () => {
    const props = gateProps({ status: 'guest' })
    const { getByText, getByLabelText, getByRole } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('忘记密码'))
    fireEvent.change(getByLabelText('账号'), { target: { value: 'shared01' } })
    fireEvent.change(getByLabelText('学校（选填）'), { target: { value: '同名中学' } })
    fireEvent.click(getByText('提交重置请求'))
    expect(getByRole('alert').textContent).toBe('请先选择所属学校，再继续提交')
    expect(props.forgotPassword).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(getByLabelText('学校（选填）'))
  })

  it('shows the real pending receipt reference without showing an account as opened', async () => {
    const props = gateProps({ status: 'guest' })
    props.register.mockResolvedValue({ kind: 'pending', requestId: 'sr_real_reference', schoolName: '新学校', username: 'pending01', email: 'pending01@example.com' })
    const { getByText, container, queryByText } = render(<AuthGate {...props} />)
    fireEvent.click(getByText('立即注册'))
    fillRegister(container, { school: '新学校', username: 'pending01', displayName: '测试学生' })
    fireEvent.click(getByText('创建 PhysicsOS 账号'))
    await waitFor(() => { expect(getByText('sr_real_reference')).toBeTruthy() })
    expect(getByText('等待审核，不代表已开通账号')).toBeTruthy()
    expect(queryByText('登录 PhysicsOS')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('keeps the form usable if story artwork fails and uses the approved character fallback', () => {
    const { container, getByText, getByTestId } = render(<AuthGate {...gateProps({ status: 'guest' })} />)
    const artwork = container.querySelector('[data-auth-artwork="welcome"] img') as HTMLImageElement
    expect(artwork.width).toBe(880)
    expect(artwork.height).toBe(1184)
    expect(artwork.srcset).toContain('welcome-440.webp 440w')
    expect(container.querySelector('[data-auth-artwork] source')?.getAttribute('srcset')).toContain('welcome-880.avif 880w')
    fireEvent.error(artwork)
    expect(getByTestId('auth-art-fallback').querySelector('[data-physicsos-mascot-edition="guizhou-v1"]')).toBeTruthy()
    expect(getByText('登录 PhysicsOS')).toBeTruthy()
  })

  it('offers real role and culture help with source links, then returns focus to the trigger', () => {
    const { getByRole, getByText } = render(<AuthGate {...gateProps({ status: 'guest' })} />)
    const help = getByRole('button', { name: '登录帮助' })
    help.focus()
    fireEvent.click(help)
    expect(getByRole('dialog', { name: '需要一点帮助？' }).textContent).toContain('不能在注册页自行提升')
    fireEvent.click(getByRole('button', { name: '关闭' }))
    expect(document.activeElement).toBe(help)
    const culture = screen.getAllByRole('button', { name: '角色的贵州文化灵感' })[0]!
    fireEvent.click(culture)
    expect(getByText(/不是特定村寨/)).toBeTruthy()
    expect(getByRole('link', { name: '雷山苗绣' }).getAttribute('href')).toBe('https://www.ihchina.cn/art/detail/id/13989.html')
    expect(getByRole('link', { name: '苗族银饰锻制技艺' }).getAttribute('href')).toBe('https://www.ihchina.cn/art/detail/id/14331.html')
  })

  it('updates new auth copy and validation immediately when the existing locale t changes', () => {
    const props = gateProps({ status: 'guest' })
    const view = render(<AuthGate {...props} />)
    fireEvent.submit(view.container.querySelector('form')!)
    const english = (key: string): string => (en as Record<string, string>)[key] ?? key
    view.rerender(<AuthGate {...props} t={english} />)
    expect(view.getByRole('heading', { name: 'Welcome back to PhysicsOS' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Sign-in help' })).toBeTruthy()
    expect(view.getByRole('alert').textContent).toBe('Please enter your account and password')
    expect(view.getByText('One entrance for students, teachers and administrators')).toBeTruthy()
  })

  it('redeems a reset token through the injected callback and clears it from query and fragment', async () => {
    const originalUrl = window.location.href
    const reset = vi.fn(async () => ({ ok: true }))
    try {
      window.history.replaceState({ route: 'preserved' }, '', '/?reset_token=query-token&keep=1#reset_token=fragment-token&panel=account')
      const { getByLabelText, getByText, container } = render(<AuthGate {...gateProps({ status: 'guest' })} resetPassword={reset} />)
      fireEvent.change(getByLabelText('密码'), { target: { value: 'new-private-pass' } })
      fireEvent.change(getByLabelText('确认密码'), { target: { value: 'new-private-pass' } })
      fireEvent.click(getByText('完成重置'))
      await waitFor(() => { expect(getByText('密码已经更新。请使用新密码重新登录。')).toBeTruthy() })
      expect(reset).toHaveBeenCalledWith({ token: 'query-token', newPassword: 'new-private-pass' })
      expect(window.location.search).toBe('?keep=1')
      expect(window.location.hash).toBe('#panel=account')
      expect(window.history.state).toEqual({ route: 'preserved' })
      expect(container.querySelector('input[type="password"]')).toBeNull()
    } finally { window.history.replaceState({}, '', originalUrl) }
  })

  it('does not redeem a short or mismatched reset password and focuses confirmation', async () => {
    const reset = vi.fn(async () => ({ ok: true }))
    const { getByLabelText, getByText, getByRole } = render(<AuthGate {...gateProps({ status: 'guest' })} resetToken="reset-test-token" resetPassword={reset} />)
    fireEvent.change(getByLabelText('密码'), { target: { value: 'short' } })
    fireEvent.click(getByText('完成重置'))
    expect(getByRole('alert').textContent).toBe('密码至少 8 位')
    fireEvent.change(getByLabelText('密码'), { target: { value: 'long-new-password' } })
    fireEvent.change(getByLabelText('确认密码'), { target: { value: 'different-password' } })
    fireEvent.click(getByText('完成重置'))
    expect(getByRole('alert').textContent).toBe('两次输入的密码不一致')
    expect(document.activeElement).toBe(getByLabelText('确认密码'))
    expect(reset).not.toHaveBeenCalled()
  })

  it('keeps an expired reset error honest and allows requesting another link', async () => {
    const reset = vi.fn(async () => { throw apiError('INVALID_RESET_TOKEN', '重置链接无效或已过期') })
    const { getByLabelText, getByText, findByRole, container } = render(<AuthGate {...gateProps({ status: 'guest' })} resetToken="expired-token" resetPassword={reset} />)
    fireEvent.change(getByLabelText('密码'), { target: { value: 'long-new-password' } })
    fireEvent.change(getByLabelText('确认密码'), { target: { value: 'long-new-password' } })
    fireEvent.click(getByText('完成重置'))
    expect((await findByRole('alert')).textContent).toBe('重置链接无效或已过期')
    fireEvent.click(getByText('重新申请重置链接'))
    expect(container.querySelector('[data-physicsos-auth-view="forgot"]')).toBeTruthy()
    expect(getByText('提交重置请求')).toBeTruthy()
  })
})

describe('sidebar identity', () => {
  it('renders the school under the brand when authed', () => {
    const state: AuthState = { status: 'authed', user: USER }
    const { getByText } = render(
      <SidebarBrandName
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
        t={t}
      />,
    )
    expect(getByText('PhysicsOS')).toBeTruthy()
    expect(getByText('贵州大学')).toBeTruthy()
  })

  it('hides the school line for guests', () => {
    const state: AuthState = { status: 'guest' }
    const { queryByText } = render(
      <SidebarBrandName
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
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
        logout={logout}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector(state)}
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
        openAdmin={openAdmin}
        logout={vi.fn(async () => {})}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector({ status: 'authed', user: admin })}
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
        openAdmin={openAdmin}
        logout={vi.fn(async () => {})}
        useAuth={<S,>(selector: (state: AuthState) => S): S => selector({ status: 'authed', user: USER })}
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
    opsMetrics: async () => { throw new Error('unused') },
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

  it('offers the announcement editor only to SUPER_ADMIN', () => {
    const noticeApi = { listFeedback: async () => ({ items: [] }) } as unknown as NoticeApi
    const superAdmin = render(
      <AdminWorkspace
        api={adminApi()}
        noticeApi={noticeApi}
        useAuth={authedAs('SUPER_ADMIN')}
        t={t}
      />,
    )
    fireEvent.click(superAdmin.getByRole('tab', { name: '反馈与公告' }))
    expect(superAdmin.getByRole('tab', { name: '公告' })).toBeTruthy()
    superAdmin.unmount()

    const schoolAdmin = render(
      <AdminWorkspace
        api={adminApi()}
        noticeApi={noticeApi}
        useAuth={authedAs('SCHOOL_ADMIN')}
        t={t}
      />,
    )
    fireEvent.click(schoolAdmin.getByRole('tab', { name: '反馈与公告' }))
    expect(schoolAdmin.queryByRole('tab', { name: '公告' })).toBeNull()
  })
})

it('keeps hook order while a restored session changes loading to authenticated', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const view = render(<AuthGate {...gateProps({ status: 'loading' })} />)
    expect(() =>{  view.rerender(<AuthGate {...gateProps({ status: 'authed', user: USER })} />); }).not.toThrow()
    expect(view.container.querySelector('[data-physicsos-auth-gate]')).toBeNull()
    expect(() =>{  view.rerender(<AuthGate {...gateProps({ status: 'guest' })} />); }).not.toThrow()
    expect(view.container.querySelector('[data-physicsos-auth-gate]')).toBeTruthy()
    expect(errors).not.toHaveBeenCalled()
  } finally { errors.mockRestore() }
})
