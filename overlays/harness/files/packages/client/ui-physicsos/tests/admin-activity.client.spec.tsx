// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminUserActivity } from '../src/client/AdminUserActivity.tsx'
import { AdminSchoolRanking } from '../src/client/AdminSchoolRanking.tsx'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import { AVATAR_CATALOG, avatarUrlForId } from '../src/client/avatar-catalog.ts'
import type { ActivityApi, ActivitySchoolRanking, ActivityUserDetail, ActivityWindow } from '../src/client/activity-api.ts'
import type { AdminApi, AdminUserRow } from '../src/client/auth-api.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const window: ActivityWindow = { version: 1, timezone: 'Asia/Shanghai', from: '2026-11-10', to: '2026-11-16', collectionStartedAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T01:00:00.000Z', rankingExclusions: { schoolIds: [], accounts: [] }, integrity: { state: 'incomplete', codes: ['ACTIVITY_SOURCE_NOT_CONNECTED'], pendingReceipts: 0, sources: [{ source: 'experiment-run', caughtUp: false }] } }
const detail = (username: string, uses: number): ActivityUserDetail => ({ ...window, schoolId: 'school', username, visits: 3, opens: 7, uses, lastUseAt: '2026-11-16T00:30:00.000Z', modules: [{ module: 'app', visits: 3, opens: 0, uses: 0 }, { module: 'canvas', visits: 0, opens: 7, uses, lastUseAt: '2026-11-16T00:30:00.000Z' }] })
const ranking = (): ActivitySchoolRanking => ({ ...window, scope: 'platform', page: 1, pageSize: 20, sort: 'uses', order: 'desc', total: 1, overview: { schools: 1, visits: 3, opens: 7, uses: 9, activeUsers: 2, adoptedUsers: 2 }, rows: [{ rank: 1, schoolId: 'school', schoolName: '测试学校', visits: 3, opens: 7, uses: 9, activeUsers: 2, avatars: { asOf: window.updatedAt, eligibleUsers: 3, adoptedUsers: 2, otherUsers: 1, distribution: AVATAR_CATALOG.map((row, index) => ({ id: row.id, label: row.name, path: avatarUrlForId(row.id), users: index === 0 ? 2 : 0 })) } }] })
const api = (over: Partial<ActivityApi> = {}): ActivityApi => ({ capabilities: vi.fn(async () => ({ schemaVersion: 1 as const, mode: 'enabled' as const, collectionEnabled: true, queryCapacityVerified: true })), userDetail: vi.fn(async (target: { schoolId: string; username: string }) => detail(target.username, 9)), schoolRanking: vi.fn(async () => ranking()), recordEvent: vi.fn(async () => ({ status: 'recorded' as const, occurredAt: window.updatedAt })), ...over })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('admin activity v1', () => {
  it('shows visit/open/use separately, Shanghai dates, collection start and an honest integrity gap', async () => {
    const client = api()
    render(<AdminUserActivity api={client} schoolId="school" username="alice" status="active" />)
    await waitFor(() => { expect(document.querySelector('[data-activity-metric="uses"] dd')?.textContent).toBe('9') })
    expect(document.querySelector('[data-activity-metric="visits"] dd')?.textContent).toBe('3')
    expect(document.querySelector('[data-activity-metric="opens"] dd')?.textContent).toBe('7')
    expect(screen.getByText(/统计不完整/)).toBeTruthy()
    expect(screen.getByText(/旧版 use:view 不并入/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '近90天' }))
    await waitFor(() => { expect(client.userDetail).toHaveBeenLastCalledWith({ schoolId: 'school', username: 'alice' }, { days: 90 }, { signal: expect.any(AbortSignal) }) })
    expect(screen.getByText(/采集起点/)).toBeTruthy()
  })
  it('aborts old targets and ignores late successful/error responses instead of mixing users', async () => {
    const old = deferred<ActivityUserDetail>(), next = deferred<ActivityUserDetail>(), signals: AbortSignal[] = []
    const client = api({ userDetail: vi.fn((target, _query, request) => { signals.push(request!.signal!); return target.username === 'alice' ? old.promise : next.promise }) })
    const view = render(<AdminUserActivity api={client} schoolId="school" username="alice" status="active" />)
    await waitFor(() => { expect(client.userDetail).toHaveBeenCalledTimes(1) })
    view.rerender(<AdminUserActivity api={client} schoolId="school" username="bob" status="active" />)
    expect(signals[0]!.aborted).toBe(true)
    await waitFor(() => { expect(client.userDetail).toHaveBeenCalledTimes(2) })
    next.resolve(detail('bob', 2))
    await waitFor(() => { expect(document.querySelector('[data-activity-metric="uses"] dd')?.textContent).toBe('2') })
    old.resolve(detail('alice', 999))
    await waitFor(() => { expect(document.querySelector('[data-activity-metric="uses"] dd')?.textContent).toBe('2') })
    expect(screen.queryByText('999')).toBeNull()
  })
  it('renders sortable school counts with current twelve-avatar distribution, not a colored pie or windowed adoption', async () => {
    const client = api()
    render(<AdminSchoolRanking api={client} isSuper />)
    await waitFor(() => { expect(screen.getByText('测试学校')).toBeTruthy() })
    expect(document.querySelector('[data-activity-metric="activeUsers"] dd')?.textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '查看12款' }))
    const distribution = screen.getByRole('region', { name: '测试学校 当前头像分布' })
    expect(within(distribution).getAllByRole('listitem')).toHaveLength(12)
    expect(within(distribution).getByText(/与上方时间范围无关/)).toBeTruthy()
    expect(distribution.querySelectorAll('img')).toHaveLength(12)
    expect(distribution.querySelector('svg,canvas')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '访问' }))
    await waitFor(() => { expect(client.schoolRanking).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'visits', order: 'desc', page: 1 }), expect.any(Object)) })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '测试' } })
    await waitFor(() => { expect(client.schoolRanking).toHaveBeenLastCalledWith(expect.objectContaining({ q: '测试', page: 1 }), expect.any(Object)) })
  })
  it('does not replace unavailable/ungated statistics with fake zero figures', async () => {
    render(<AdminSchoolRanking api={api({ schoolRanking: vi.fn().mockRejectedValue(new Error('服务器容量验收尚未完成')) })} isSuper={false} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('服务器容量验收尚未完成') })
    expect(document.querySelector('[data-activity-metric]')).toBeNull()
    expect(screen.getByText(/仅本校汇总/)).toBeTruthy()
  })
  it('offers the new ranking only with injected ActivityApi and attaches stats to the selected user detail', async () => {
    const people: AdminUserRow[] = ['alice', 'bob'].map(username => ({ id: username, schoolId: 'school', schoolName: '测试学校', username, displayName: username, status: 'active', createdAt: window.updatedAt, role: 'STUDENT' }))
    const adminApi = { listUsers: vi.fn(async () => ({ users: people })), listPasswordResets: vi.fn(async () => ({ requests: [] })), listDevices: vi.fn(async () => ({ devices: [], risk: [] })), dashboard: vi.fn(async () => { throw new Error('not used') }), listAudit: vi.fn(async () => ({ events: [] })) } as unknown as AdminApi
    const useAuth = <T,>(select: (value: AuthState) => T): T => select({ status: 'authed', user: { id: 'admin', schoolId: 'school', schoolName: '测试学校', username: 'admin', displayName: 'admin', role: 'SCHOOL_ADMIN' } })
    const t = (key: PhysicsosKey): string => zh[key] ?? key, client = api()
    const first = render(<AdminWorkspace api={adminApi} useAuth={useAuth} t={t} />)
    expect(screen.queryByRole('tab', { name: '学校排行' })).toBeNull(); first.unmount()
    render(<AdminWorkspace api={adminApi} activityApi={client} useAuth={useAuth} t={t} />)
    expect(screen.getByRole('tab', { name: '学校排行' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '用户' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'bob' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'bob' }))
    await waitFor(() => { expect(client.userDetail).toHaveBeenLastCalledWith({ schoolId: 'school', username: 'bob' }, { days: 7 }, expect.any(Object)) })
  })
})
