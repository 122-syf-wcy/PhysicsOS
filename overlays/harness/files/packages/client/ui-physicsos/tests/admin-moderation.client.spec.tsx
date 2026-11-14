// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import type { AdminApi } from '../src/client/auth-api.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { zh } from '../src/client/locales.ts'
import { AdminModerationTab } from '../src/client/AdminModerationTab.tsx'
import { createModerationApi, ModerationApiError, type ModerationApi, type ModerationCase, type ModerationSettings, type ModerationQuery, type ModerationDecision } from '../src/client/moderation-api.ts'

const item = (patch: Partial<ModerationCase> = {}): ModerationCase => ({
  id: 'mc_a', sessionId: 'session-a', messageId: 'message-a', sessionTitle: '安全教学',
  ownerKey: 'school/alice', schoolId: 'school', username: 'alice', userId: 'user-a',
  text: '<img src=x onerror=alert(1)> 学习实验', context: '<script>pwned()</script> 上下文',
  textTruncated: true, contextTruncated: true, status: 'flagged', version: 4,
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', accountStatus: 'active',
  review: { risk: 'review', category: 'other', severity: 'low', confidence: 0.82,
    reason: '<b>仅为建议</b>', evidence: ['<img src=x onerror=alert(1)>'] }, ...patch,
})
const initialSettings: ModerationSettings = { version: 3, enabled: true, updatedAt: '', captureFailures: 2, lastCaptureFailure: 'CAPTURE_CAPACITY' }
function fixture(rows: ModerationCase[] = [item()]) {
  let settings = { ...initialSettings }
  const api: ModerationApi = {
    list: vi.fn(async (query: ModerationQuery) => {
      const filtered = rows.filter(row => !query.status || row.status === query.status)
      const page = query.page ?? 1, limit = query.limit ?? 20
      return { cases: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit }
    }),
    detail: vi.fn(async (id: string) => structuredClone(rows.find(row => row.id === id)!)),
    settings: vi.fn(async () => ({ ...settings })),
    setEnabled: vi.fn(async (input: Parameters<ModerationApi['setEnabled']>[0]) => { settings = { ...settings, ...input, version: settings.version + 1 }; return { ...settings } }),
    decide: vi.fn(async (id: string, input: ModerationDecision) => {
      const index = rows.findIndex(row => row.id === id), row = rows[index]!
      if (input.version !== row.version) throw new ModerationApiError(409, 'VERSION_CONFLICT', '审核版本已更新')
      rows[index] = { ...row, status: input.decision === 'ban' ? 'banned' : 'dismissed', version: row.version + 1,
        accountStatus: input.decision === 'ban' ? 'disabled' : row.accountStatus,
        decision: { decision: input.decision, reason: input.reason, actorKey: 'admin', decidedAt: '' } }
      return structuredClone(rows[index])
    }),
    retry: vi.fn(async (id: string, input: Parameters<ModerationApi['retry']>[1]) => {
      const index = rows.findIndex(row => row.id === id), row = rows[index]!
      if (input.version !== row.version) throw new ModerationApiError(409, 'VERSION_CONFLICT', '审核版本已更新')
      rows[index] = { ...row, version: row.version + 1, status: 'pending' }
      return structuredClone(rows[index])
    }),
    scan: vi.fn(async () => ({ scanned: 20, captured: 2 })),
  }
  return { api, rows }
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const selectFirst = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '查看 mc_a' }))
  return screen.findByTestId('moderation-detail')
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('moderation Cookie API', () => {
  it('uses same-origin cookies, no-store, bounded query and a fixed case route for JSON decisions', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(item()), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const api = createModerationApi(), abort = new AbortController()
    await api.decide('mc_a/other', { version: 4, decision: 'ban', reason: '人工证据' }, abort.signal)
    expect(fetch).toHaveBeenCalledWith('/physicsos/admin/moderation/cases/mc_a%2Fother/decision', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', signal: abort.signal, method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"version":4,"decision":"ban","reason":"人工证据"}',
    }))
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ cases: [], total: 0, page: 2, limit: 50 })))
    await api.list({ page: 2, limit: 999, status: 'allowed' })
    expect(fetch.mock.calls.at(-1)?.[0]).toBe('/physicsos/admin/moderation/cases?page=2&limit=50&status=allowed')
  })
  it('preserves structured denial/conflict errors and rejects incomplete successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '其他管理员已审核' } }), { status: 409 })))
    await expect(createModerationApi().retry('mc_a', { version: 4 })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', message: '其他管理员已审核' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(createModerationApi().settings()).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(createModerationApi().detail('mc_a')).rejects.toMatchObject({ status: 403, code: 'REQUEST_FAILED' })
  })
  it('sends only bounded scan JSON and versioned enable/retry bodies', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ scanned: 20, captured: 2 })))
    vi.stubGlobal('fetch', fetch)
    const api = createModerationApi()
    expect(await api.scan()).toEqual({ scanned: 20, captured: 2 })
    expect(fetch.mock.calls[0]).toEqual(['/physicsos/admin/moderation/scan', expect.objectContaining({ method: 'POST', body: '{}' })])
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(initialSettings)))
    await api.setEnabled({ version: 3, enabled: false })
    expect(fetch.mock.calls[1]).toEqual(['/physicsos/admin/moderation/settings', expect.objectContaining({ body: '{"version":3,"enabled":false}' })])
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(item({ status: 'pending' }))))
    await api.retry('mc_a', { version: 4 })
    expect(fetch.mock.calls[2]).toEqual(['/physicsos/admin/moderation/cases/mc_a/retry', expect.objectContaining({ body: '{"version":4}' })])
  })
})

describe('human moderation page', () => {
  it('loads the injected moderation client only after its SUPER_ADMIN tab is opened', async () => {
    const { api } = fixture()
    const useAuth = <T,>(select: (state: AuthState) => T) => select({ status: 'authed', user: {
      id: 'admin', username: 'admin', displayName: '管理员', schoolId: 'platform', schoolName: '平台', role: 'SUPER_ADMIN',
    } })
    render(<AdminWorkspace api={{ listUsers: async () => ({ users: [] }) } as unknown as AdminApi}
      moderationApi={api} useAuth={useAuth} t={key => zh[key]} />)
    expect(api.list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: '对话审核' }))
    await selectFirst()
    expect(screen.getByTestId('moderation-detail').textContent).toContain('学习实验')
    expect(document.querySelectorAll('[data-admin-page-header]')).toHaveLength(1)
  })
  it('shows literal evidence and truncation with real account status, never interprets hostile HTML', async () => {
    const { api } = fixture()
    render(<AdminModerationTab api={api} />)
    const detail = await selectFirst()
    expect(detail.textContent).toContain('<img src=x onerror=alert(1)> 学习实验')
    expect(detail.textContent).toContain('<script>pwned()</script> 上下文')
    expect(detail.textContent).toContain('<b>仅为建议</b>')
    expect(detail.textContent).toContain('原文已截断')
    expect(detail.textContent).toContain('上下文已截断')
    expect(within(detail).getByText('账号正常')).not.toBeNull()
    expect(document.querySelector('script, img')).toBeNull()
    expect(screen.getByText(/AI 仅提供建议/)).not.toBeNull()
  })
  it('requires a nonempty reason and an explicit fixed-account ban confirmation, then reflects disabled status', async () => {
    const { api } = fixture()
    render(<AdminModerationTab api={api} />)
    await selectFirst()
    expect(button('封禁账号').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('人工审核理由'), { target: { value: '  查证后的人工理由  ' } })
    fireEvent.click(button('封禁账号'))
    expect(vi.mocked(api.decide).mock.calls).toHaveLength(0)
    const confirmation = screen.getByRole('alertdialog', { name: '确认封禁账号' })
    expect(confirmation.textContent).toContain('alice')
    expect(confirmation.textContent).toContain('school')
    expect(within(confirmation).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认封禁' }))
    await screen.findByText('账号已停用')
    expect(api.decide).toHaveBeenCalledWith('mc_a', { version: 4, decision: 'ban', reason: '查证后的人工理由' }, expect.any(AbortSignal))
    expect(button('封禁账号').disabled).toBe(true)
    expect(api.list).toHaveBeenCalledTimes(2)
  })
  it.each(['allowed', 'pending', 'reviewing'] as const)('allows human dismissal of %s without relying on AI permission', async (status) => {
    const { api } = fixture([item({ status })])
    render(<AdminModerationTab api={api} />)
    await selectFirst()
    fireEvent.change(screen.getByLabelText('人工审核理由'), { target: { value: '合法安全教学' } })
    fireEvent.click(button('驳回风险'))
    await screen.findByText('人工决定：驳回风险')
    expect(api.decide).toHaveBeenCalledWith('mc_a', { version: 4, decision: 'dismiss', reason: '合法安全教学' }, expect.any(AbortSignal))
  })
  it('refreshes current case/version after conflict, preserves reason, and requires a fresh ban confirmation', async () => {
    const { api, rows } = fixture()
    render(<AdminModerationTab api={api} />)
    await selectFirst()
    fireEvent.change(screen.getByLabelText('人工审核理由'), { target: { value: '保留待核对的理由' } })
    fireEvent.click(button('封禁账号'))
    rows[0] = item({ version: 7, accountStatus: 'disabled' })
    fireEvent.click(button('确认封禁'))
    expect((await screen.findByRole('alert')).textContent).toContain('VERSION_CONFLICT')
    await screen.findByText('版本 7')
    expect((screen.getByLabelText('人工审核理由') as HTMLTextAreaElement).value).toBe('保留待核对的理由')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('账号已停用')).not.toBeNull()
  })
  it('retries a failed case using its version and shows the refreshed pending state', async () => {
    const { api } = fixture([item({ status: 'error', error: 'REVIEW_TIMEOUT' })])
    render(<AdminModerationTab api={api} />)
    await selectFirst()
    fireEvent.click(button('重试 AI 审查'))
    await screen.findByText('版本 5')
    expect(api.retry).toHaveBeenCalledWith('mc_a', { version: 4 }, expect.any(AbortSignal))
    expect(button('重试 AI 审查').disabled).toBe(true)
  })
  it('shows intake failures, versions the automatic toggle and reports bounded history scan', async () => {
    const { api } = fixture()
    render(<AdminModerationTab api={api} />)
    await screen.findByText(/接收失败累计：2/)
    expect(screen.getByText(/CAPTURE_CAPACITY/)).not.toBeNull()
    fireEvent.click(button('暂停自动审查'))
    await screen.findByRole('button', { name: '启用自动审查' })
    expect(api.setEnabled).toHaveBeenCalledWith({ version: 3, enabled: false }, expect.any(AbortSignal))
    fireEvent.click(button('补扫历史（最多 20 条）'))
    await screen.findByText('本次扫描 20 条，新增记录 2 条。')
  })
  it('paginates all cases and filters statuses from page one', async () => {
    const { api } = fixture(Array.from({ length: 21 }, (_, index) => item({ id: `mc_${index}`, status: index === 20 ? 'allowed' : 'flagged' })))
    render(<AdminModerationTab api={api} />)
    await screen.findByRole('button', { name: '查看 mc_0' })
    fireEvent.click(button('下一页'))
    await screen.findByRole('button', { name: '查看 mc_20' })
    expect(screen.queryByRole('button', { name: '查看 mc_0' })).toBeNull()
    fireEvent.change(screen.getByLabelText('审核状态'), { target: { value: 'allowed' } })
    await waitFor(() => { expect(api.list).toHaveBeenLastCalledWith({ page: 1, limit: 20, status: 'allowed' }, expect.any(AbortSignal)) })
    await screen.findByRole('button', { name: '查看 mc_20' })
    expect(button('下一页').disabled).toBe(true)
  })
  it('keeps newer selected details when a previous case response arrives late', async () => {
    const { api } = fixture([item(), item({ id: 'mc_b', username: 'bob', text: '第二条内容' })])
    const old = deferred<ModerationCase>()
    vi.mocked(api.detail).mockImplementationOnce(() => old.promise)
    render(<AdminModerationTab api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看 mc_a' }))
    fireEvent.click(button('查看 mc_b'))
    await screen.findByText('第二条内容')
    await act(async () => { old.resolve(item()); await old.promise })
    expect(screen.getByTestId('moderation-detail').textContent).toContain('第二条内容')
    expect(screen.getByTestId('moderation-detail').textContent).not.toContain('学习实验')
    expect(vi.mocked(api.detail).mock.calls[0]?.[1]?.aborted).toBe(true)
  })
  it('ignores a same-case poll response started before a human ban', async () => {
    const { api } = fixture()
    vi.useFakeTimers()
    render(<AdminModerationTab api={api} />)
    await act(async () => {})
    fireEvent.click(button('查看 mc_a'))
    await act(async () => {})
    const old = deferred<ModerationCase>()
    vi.mocked(api.detail).mockImplementationOnce(() => old.promise)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    fireEvent.change(screen.getByLabelText('人工审核理由'), { target: { value: '人工核对完成' } })
    fireEvent.click(button('封禁账号'))
    fireEvent.click(button('确认封禁'))
    await act(async () => {})
    expect(screen.getByText('版本 5')).not.toBeNull()
    expect(screen.getByText('账号已停用')).not.toBeNull()
    await act(async () => { old.resolve(item()); await old.promise })
    expect(screen.getByText('版本 5')).not.toBeNull()
    expect(screen.getByText('账号已停用')).not.toBeNull()
    expect(vi.mocked(api.detail).mock.calls[1]?.[1]?.aborted).toBe(true)
  })
  it('retains scan errors and refreshes settings after a version conflict', async () => {
    const { api } = fixture()
    vi.mocked(api.setEnabled).mockImplementationOnce(async () => {
      vi.mocked(api.settings).mockResolvedValue({ ...initialSettings, version: 6, enabled: false })
      throw new ModerationApiError(409, 'VERSION_CONFLICT', '自动审查设置已更新')
    })
    vi.mocked(api.scan).mockRejectedValueOnce(new ModerationApiError(503, 'CAPTURE_CAPACITY', '审核存储已满'))
    render(<AdminModerationTab api={api} />)
    await screen.findByRole('button', { name: '查看 mc_a' })
    fireEvent.click(button('暂停自动审查'))
    await screen.findByRole('button', { name: '启用自动审查' })
    expect((await screen.findByRole('alert')).textContent).toContain('VERSION_CONFLICT')
    await waitFor(() => { expect(button('补扫历史（最多 20 条）').disabled).toBe(false) })
    fireEvent.click(button('补扫历史（最多 20 条）'))
    expect((await screen.findByRole('alert')).textContent).toContain('CAPTURE_CAPACITY')
    expect(screen.queryByText(/本次扫描/)).toBeNull()
  })
  it('polls every 10 seconds only while visible and aborts outstanding requests on unmount', async () => {
    const { api } = fixture()
    vi.useFakeTimers()
    const view = render(<AdminModerationTab api={api} />)
    await act(async () => {})
    fireEvent.click(button('查看 mc_a'))
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(api.list).toHaveBeenCalledTimes(2)
    const count = vi.mocked(api.list).mock.calls.length
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(api.list).toHaveBeenCalledTimes(count)
    const pending = deferred<ModerationCase>()
    vi.mocked(api.detail).mockImplementationOnce(() => pending.promise)
    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => {})
    expect(api.list).toHaveBeenCalledTimes(count + 1)
    view.unmount()
    expect(vi.mocked(api.detail).mock.calls.at(-1)?.[1]?.aborted).toBe(true)
    await act(async () => { pending.resolve(item()); await pending.promise; await vi.advanceTimersByTimeAsync(20_000) })
    expect(api.list).toHaveBeenCalledTimes(count + 1)
  })
})
