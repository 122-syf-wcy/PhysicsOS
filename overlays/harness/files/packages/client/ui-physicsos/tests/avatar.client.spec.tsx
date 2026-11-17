// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarImage, AvatarPicker } from '../src/client/AvatarPicker.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import { createAuthApi, type AuthApi, type AuthUser } from '../src/client/auth-api.ts'
import { createAuthController, type AuthState } from '../src/client/auth-store.ts'
import { AVATAR_CATALOG, AVATAR_OWNER_HEADER, avatarUrlForId, type AvatarId, type AvatarOwner } from '../src/client/avatar-catalog.ts'
import { zh } from '../src/client/locales.ts'

const USER: AuthUser = { id: 'u_one', schoolId: 'GZU', schoolName: '贵州大学', username: 'student1', displayName: '李明', role: 'STUDENT' }
const OTHER: AuthUser = { ...USER, id: 'u_two', schoolId: 'GZNU', schoolName: '贵州师范大学' }
const owner = (user: AuthUser): AvatarOwner => ({ id: user.id, schoolId: user.schoolId, username: user.username })
const selected = (id: AvatarId, user = USER): AuthUser => ({ ...user, avatarId: id, avatarUrl: avatarUrlForId(id) })
const failure = (code: string) => Object.assign(new Error('private backend details'), { code })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const api = (overrides: Partial<AuthApi> = {}): AuthApi => ({
  register: async () => ({ kind: 'registered', user: USER }), login: async () => ({ user: USER }),
  searchSchools: async () => ({ schools: [] }), me: async () => ({ user: USER }), logout: async () => ({ ok: true }),
  setAvatar: async id => ({ user: selected(id) }), forgotPassword: async () => ({ ok: true }),
  resetPassword: async () => ({ ok: true }), reportLearning: async () => ({ ok: true }), ...overrides,
})
const reload = vi.fn()
beforeEach(() => { localStorage.clear(); reload.mockReset(); vi.stubGlobal('location', { reload }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const hint = (user = USER) => localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: user.id, schoolId: user.schoolId }))
async function controller(overrides: Partial<AuthApi> = {}) {
  hint()
  const auth = createAuthController(api(overrides), localStorage)
  await auth.boot()
  return auth
}
const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

function footer(auth: Awaited<ReturnType<typeof controller>>, wide = true) {
  const useAuth = <S,>(selector: (state: AuthState) => S): S => useSyncExternalStore(
    auth.store.subscribe, () => selector(auth.store.getSnapshot()),
  )
  return <SidebarFooter wide={wide} useAuth={useAuth} setAvatar={auth.setAvatar} logout={auth.logout} t={t} />
}

describe('cookie-only avatar fetch client', () => {
  it('sends only closed avatarId JSON and an exact expected-owner rejection header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ user: selected('discovery') }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await createAuthApi().setAvatar('discovery', { ...owner(USER), avatarUrl: 'https://evil.test/x', role: 'SUPER_ADMIN' } as AvatarOwner)
    expect(result.user.avatarId).toBe('discovery')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/physicsos/auth/me/avatar')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    expect(JSON.parse(init!.body as string)).toEqual({ avatarId: 'discovery' })
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(decodeURIComponent(headers.get(AVATAR_OWNER_HEADER)!))).toEqual(owner(USER))
    expect(headers.has('authorization')).toBe(false)
  })

  it('rejects illegal IDs before fetch and preserves server error codes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'OWNER_CHANGED', message: '账号已切换' } }), { status: 409 }))
    vi.stubGlobal('fetch', fetcher)
    const client = createAuthApi()
    await expect(client.setAvatar('https://evil.test/a' as AvatarId, owner(USER))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(client.setAvatar('discovery', owner(USER))).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
  })
})

describe('auth avatar principal snapshots and account generations', () => {
  it('publishes the real saved user once, without reload, profile mirroring or extra identity fields', async () => {
    const setAvatar = vi.fn<AuthApi['setAvatar']>(async id => ({ user: selected(id) }))
    const auth = await controller({ setAvatar })
    const before = auth.store.getSnapshot()
    const profile = JSON.stringify({ grade: 'junior', mode: 'study' })
    localStorage.setItem('physicsos.profile', profile)
    const storedBefore = [...Array(localStorage.length)].map((_, index) => localStorage.key(index))
    const snapshots: AuthState[] = []
    const stop = auth.store.subscribe(() => { snapshots.push(auth.store.getSnapshot()) })
    await auth.setAvatar('pendulum', owner(USER))
    stop()
    expect(setAvatar).toHaveBeenCalledWith('pendulum', owner(USER))
    expect(auth.store.getSnapshot()).toEqual({ status: 'authed', user: selected('pendulum') })
    expect(auth.store.getSnapshot()).not.toBe(before)
    expect(snapshots).toHaveLength(1)
    expect(before.user).toEqual(USER)
    expect(reload).not.toHaveBeenCalled()
    expect(localStorage.getItem('physicsos.profile')).toBe(profile)
    expect(JSON.parse(localStorage.getItem('physicsos.auth.user')!)).toEqual({ id: USER.id, schoolId: USER.schoolId })
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).toEqual(storedBefore)
  })

  it('does not optimistically change the principal or lose the old avatar after a failed save', async () => {
    const pending = deferred<{ user: AuthUser }>()
    const auth = await controller({ me: async () => ({ user: selected('silver-greeting') }), setAvatar: () => pending.promise })
    const before = auth.store.getSnapshot()
    const saving = auth.setAvatar('discovery', owner(USER)).catch((error: unknown) => error)
    expect(auth.store.getSnapshot()).toBe(before)
    pending.reject(new TypeError('Failed to fetch'))
    expect(await saving).toBeInstanceOf(TypeError)
    expect(auth.store.getSnapshot()).toBe(before)
  })

  it.each(['other-user', 'same-username-other-school', 'wrong-path', 'missing-id'] as const)('rejects a mismatched successful response: %s', async (kind) => {
    const response = kind === 'other-user' ? selected('discovery', { ...USER, id: 'u_replaced' })
      : kind === 'same-username-other-school' ? selected('discovery', OTHER)
        : kind === 'wrong-path' ? { ...selected('discovery'), avatarUrl: 'https://evil.test/a' }
          : { ...USER, avatarUrl: avatarUrlForId('discovery') }
    const auth = await controller({ setAvatar: async () => ({ user: response }) })
    const before = auth.store.getSnapshot()
    await expect(auth.setAvatar('discovery', owner(USER))).rejects.toMatchObject({ code: kind.startsWith('other') || kind.startsWith('same') ? 'OWNER_CHANGED' : 'BAD_RESPONSE' })
    expect(auth.store.getSnapshot()).toBe(before)
  })

  it('rejects a stale owner and guest state locally, without calling the API', async () => {
    const setAvatar = vi.fn<AuthApi['setAvatar']>()
    const auth = await controller({ setAvatar })
    await expect(auth.setAvatar('discovery', owner(OTHER))).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
    auth.store.set({ status: 'guest' })
    await expect(auth.setAvatar('discovery', owner(USER))).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
    await expect(auth.setAvatar('not-a-catalog-id' as AvatarId, owner(USER))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(setAvatar).not.toHaveBeenCalled()
  })

  it.each(['A-to-B', 'A-to-B-to-A', 'logout'] as const)('ignores a late saved avatar after %s', async (mode) => {
    const pending = deferred<{ user: AuthUser }>()
    const auth = await controller({ setAvatar: () => pending.promise })
    const saving = auth.setAvatar('discovery', owner(USER)).catch((error: unknown) => error)
    if (mode === 'logout') await auth.logout()
    else {
      auth.store.set({ status: 'authed', user: OTHER })
      if (mode === 'A-to-B-to-A') auth.store.set({ status: 'authed', user: selected('silver-moon') })
    }
    const current = auth.store.getSnapshot()
    pending.resolve({ user: selected('discovery') })
    expect(await saving).toMatchObject({ code: 'OWNER_CHANGED' })
    expect(auth.store.getSnapshot()).toBe(current)
  })

  it('does not let an old avatar failure tear down the new account', async () => {
    const pending = deferred<{ user: AuthUser }>()
    const auth = await controller({ setAvatar: () => pending.promise })
    const saving = auth.setAvatar('discovery', owner(USER)).catch((error: unknown) => error)
    auth.store.set({ status: 'authed', user: OTHER })
    pending.reject(failure('UNAUTHENTICATED'))
    await saving
    expect(auth.store.getSnapshot()).toEqual({ status: 'authed', user: OTHER })
    expect(reload).not.toHaveBeenCalled()
  })

  it('invalidates in-flight avatar results as soon as another login begins, even before its response', async () => {
    const pending = deferred<{ user: AuthUser }>()
    const loggingIn = deferred<{ user: AuthUser }>()
    const setAvatar = vi.fn<AuthApi['setAvatar']>(() => pending.promise)
    const auth = await controller({ setAvatar, login: () => loggingIn.promise })
    const saving = auth.setAvatar('discovery', owner(USER)).catch((error: unknown) => error)
    const login = auth.login({ username: OTHER.username, password: 'private', rememberDevice: false })
    await expect(auth.setAvatar('pendulum', owner(USER))).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
    expect(setAvatar).toHaveBeenCalledTimes(1)
    pending.resolve({ user: selected('discovery') })
    expect(await saving).toMatchObject({ code: 'OWNER_CHANGED' })
    loggingIn.resolve({ user: OTHER })
    await login
    expect(auth.store.getSnapshot().user).toEqual(OTHER)
  })

  it('keeps only the newest avatar response when callbacks complete out of order', async () => {
    const old = deferred<{ user: AuthUser }>()
    const next = deferred<{ user: AuthUser }>()
    const auth = await controller({ setAvatar: id => id === 'pendulum' ? old.promise : next.promise })
    const first = auth.setAvatar('pendulum', owner(USER)).catch((error: unknown) => error)
    const second = auth.setAvatar('discovery', owner(USER))
    next.resolve({ user: selected('discovery') })
    await second
    old.resolve({ user: selected('pendulum') })
    expect(await first).toMatchObject({ code: 'OWNER_CHANGED' })
    expect(auth.store.getSnapshot().user?.avatarId).toBe('discovery')
  })

  it('ignores a delayed boot and delayed logout after a newer login; identity hints follow the newest user', async () => {
    hint()
    const bootReply = deferred<{ user: AuthUser }>()
    const logoutReply = deferred<{ ok: boolean }>()
    const auth = createAuthController(api({ me: () => bootReply.promise, login: async () => ({ user: OTHER }), logout: () => logoutReply.promise }), localStorage)
    const boot = auth.boot()
    const logout = auth.logout()
    await auth.login({ username: OTHER.username, password: 'private', rememberDevice: false })
    bootReply.resolve({ user: USER })
    logoutReply.resolve({ ok: true })
    await Promise.all([boot, logout])
    expect(auth.store.getSnapshot().user).toEqual(OTHER)
    expect(JSON.parse(localStorage.getItem('physicsos.auth.user')!)).toEqual({ id: OTHER.id, schoolId: OTHER.schoolId })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not clear a switched principal or its hint when a prior logout finishes', async () => {
    const pending = deferred<{ ok: boolean }>()
    const auth = await controller({ logout: () => pending.promise })
    const loggingOut = auth.logout()
    auth.store.set({ status: 'authed', user: OTHER })
    hint(OTHER)
    pending.resolve({ ok: true })
    await loggingOut
    expect(auth.store.getSnapshot().user).toEqual(OTHER)
    expect(JSON.parse(localStorage.getItem('physicsos.auth.user')!)).toEqual({ id: OTHER.id, schoolId: OTHER.schoolId })
    expect(reload).not.toHaveBeenCalled()
  })

  it('reads a persisted server avatar on the next boot and a later password login', async () => {
    const serverUser = selected('indigo-reader')
    const auth = await controller({ me: async () => ({ user: serverUser }), login: async () => ({ user: serverUser }) })
    expect(auth.store.getSnapshot().user?.avatarId).toBe('indigo-reader')
    const reboot = createAuthController(api({ me: async () => ({ user: serverUser }) }), localStorage)
    await reboot.boot()
    expect(reboot.store.getSnapshot().user?.avatarId).toBe('indigo-reader')
    await auth.login({ username: USER.username, password: 'private', rememberDevice: false })
    expect(auth.store.getSnapshot().user?.avatarId).toBe('indigo-reader')
  })
})

describe('AvatarImage failures and source lifetimes', () => {
  it('keeps old URLs readable and falls back to the name on errors, resetting for a new URL', () => {
    const view = render(<AvatarImage src="https://legacy.example.test/photo.jpg" name="李明" alt="本人头像" />)
    let image = view.container.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://legacy.example.test/photo.jpg')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.load(image)
    fireEvent.error(image)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('图片未加载')
    expect(view.container.querySelector('[data-avatar-fallback]')?.textContent).toBe('李')
    view.rerender(<AvatarImage src={avatarUrlForId('discovery')} name="李明" alt="本人头像" />)
    image = view.container.querySelector('img')!
    expect(image.getAttribute('src')).toBe(avatarUrlForId('discovery'))
    expect(view.container.querySelector('[data-avatar-fallback]')).toBeNull()
    fireEvent.load(image)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('本人头像')
  })

  it('uses a neutral icon for blank names and does not invent another avatar', () => {
    const { container } = render(<AvatarImage name="  " />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-avatar-fallback] svg')).toBeTruthy()
  })
})

describe('AvatarPicker and sidebar self-account entry', () => {
  it('opens from the avatar, previews twelve choices, cancels without saving and restores trigger focus', async () => {
    const setAvatar = vi.fn<AuthApi['setAvatar']>(async id => ({ user: selected(id) }))
    const auth = await controller({ setAvatar, me: async () => ({ user: selected('silver-greeting') }) })
    render(footer(auth))
    const trigger = screen.getByRole('button', { name: '更换头像' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '选择头像' })
    const radios = within(dialog).getAllByRole('radio')
    expect(radios).toHaveLength(12)
    expect(new Set(radios.map(input => input.getAttribute('name'))).size).toBe(1)
    expect((within(dialog).getByRole('radio', { name: '银饰迎新' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: '保存头像' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('radio', { name: '摆球探索' }))
    expect(dialog.querySelector('[data-avatar-preview="pendulum"]')).toBeTruthy()
    expect(auth.store.getSnapshot().user?.avatarId).toBe('silver-greeting')
    expect(setAvatar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    expect((screen.getByRole('radio', { name: '银饰迎新' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(setAvatar).not.toHaveBeenCalled()
  })

  it('contains keyboard focus and restores it on Escape without submitting a preview', async () => {
    const auth = await controller()
    render(footer(auth))
    const trigger = screen.getByRole('button', { name: '更换头像' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('radio', { name: '灵感发现' }))
    const save = screen.getByRole('button', { name: '保存头像' })
    const close = screen.getByRole('button', { name: '关闭头像选择' })
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(document.activeElement).toBe(trigger)
    expect(auth.store.getSnapshot().user).toEqual(USER)
  })

  it('opens the same self-avatar picker from the account menu without removing logout', async () => {
    const auth = await controller()
    render(footer(auth))
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '更换头像' }))
    expect(screen.getByRole('dialog', { name: '选择头像' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('saves once, shows pending state, updates the sidebar from the principal and closes', async () => {
    const pending = deferred<{ user: AuthUser }>()
    const setAvatar = vi.fn<AuthApi['setAvatar']>(() => pending.promise)
    const auth = await controller({ setAvatar })
    const view = render(footer(auth, false))
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }))
    fireEvent.click(screen.getByRole('radio', { name: '灵感发现' }))
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(setAvatar).toHaveBeenCalledWith('discovery', owner(USER))
    expect((screen.getByRole('button', { name: '正在保存…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭头像选择' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(auth.store.getSnapshot().user).toEqual(USER)
    await act(async () => { pending.resolve({ user: selected('discovery') }); await pending.promise })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(avatarUrlForId('discovery'))
    expect(setAvatar).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    expect(screen.getByText('李明 · student1')).toBeTruthy()
  })

  it('keeps the draft and current avatar after save failure, offers retry and focuses the safe error', async () => {
    const setAvatar = vi.fn<AuthApi['setAvatar']>().mockRejectedValueOnce(failure('DEPENDENCY_UNAVAILABLE')).mockImplementationOnce(async id => ({ user: selected(id) }))
    const auth = await controller({ setAvatar, me: async () => ({ user: selected('silver-greeting') }) })
    render(footer(auth))
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }))
    fireEvent.click(screen.getByRole('radio', { name: '透镜小匠' }))
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('当前页面仍显示原头像')
    expect(alert.textContent).not.toContain('private backend')
    expect(document.activeElement).toBe(alert)
    expect((screen.getByRole('radio', { name: '透镜小匠' }) as HTMLInputElement).checked).toBe(true)
    expect(auth.store.getSnapshot().user?.avatarId).toBe('silver-greeting')
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(auth.store.getSnapshot().user?.avatarId).toBe('lens-maker')
  })

  it('closes on account change and ignores the old panel success instead of closing the new user panel', async () => {
    const pending = deferred<{ user: AuthUser }>()
    const auth = await controller({ setAvatar: () => pending.promise })
    render(footer(auth))
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }))
    fireEvent.click(screen.getByRole('radio', { name: '灵感发现' }))
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }))
    act(() => { auth.store.set({ status: 'authed', user: OTHER }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }))
    const next = screen.getByRole('dialog')
    await act(async () => { pending.resolve({ user: selected('discovery') }); await pending.promise })
    expect(screen.getByRole('dialog')).toBe(next)
    expect(auth.store.getSnapshot().user).toEqual(OTHER)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('resets an independent picker draft on account replacement and ignores an unmounted failure', async () => {
    const pending = deferred<void>()
    const setAvatar = vi.fn(() => pending.promise)
    const onClose = vi.fn()
    const view = render(<AvatarPicker open user={USER} setAvatar={setAvatar} onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: '银月静思' }))
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }))
    view.rerender(<AvatarPicker open user={OTHER} setAvatar={setAvatar} onClose={onClose} />)
    expect((screen.getByRole('button', { name: '保存头像' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true)
    await act(async () => { pending.reject(failure('UNAUTHENTICATED')); await pending.promise.catch(() => undefined) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps a broken preview usable with a visible fallback, and no implicit default choice for legacy avatars', () => {
    render(<AvatarPicker open user={{ ...USER, avatarUrl: 'https://legacy.example.test/a.jpg' }} setAvatar={vi.fn(async () => {})} onClose={vi.fn()} />)
    const preview = screen.getByRole('img', { name: '头像预览：当前头像' })
    fireEvent.error(preview.querySelector('img')!)
    expect(preview.querySelector('[data-avatar-fallback]')).toBeNull() // The root itself is the fallback.
    expect(preview.hasAttribute('data-avatar-fallback')).toBe(true)
    expect(preview.textContent).toBe('李')
    expect(screen.getByText(/图片暂未加载/)).toBeTruthy()
    expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true)
    expect((screen.getByRole('button', { name: '保存头像' }) as HTMLButtonElement).disabled).toBe(true)
    expect(AVATAR_CATALOG).toHaveLength(12)
  })
})
