// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthController } from '../src/client/auth-store.ts'
import { createAuthApi } from '../src/client/auth-api.ts'
import { bufferActivityDisplays, reportActivityDisplayed, startActivityTelemetry } from '../src/client/activity-telemetry.ts'
import { createActivityApi, type ActivityClientEvent } from '../src/client/activity-api.ts'

const user = (username: string, schoolId = 'school') => ({ id: `${schoolId}:${username}`, schoolId, schoolName: schoolId, username, displayName: username, role: 'STUDENT' as const })
const memoryStorage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
describe('activity v1 successful-display telemetry', () => {
  it('does not count startup intent, auth snapshots or rerenders, only an app display and actual content entries', async () => {
    const events: ActivityClientEvent[] = [], fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as ActivityClientEvent; events.push(input)
      return { ok: true, json: async () => ({ status: 'recorded', occurredAt: '2026-11-16T00:00:00.000Z' }) } as Response
    })
    const auth = createAuthController(createAuthApi(), localStorage), name = `display-${Math.random()}`
    auth.store.set({ status: 'authed', user: user(name) })
    const telemetry = startActivityTelemetry(auth, { enabled: true, fetch: fetcher as typeof fetch, storage: memoryStorage() })
    try {
      expect(events).toHaveLength(0)
      telemetry.appDisplayed(); telemetry.appDisplayed()
      telemetry.openDisplayed('lab', 'entry-one'); telemetry.openDisplayed('lab', 'entry-one')
      auth.store.set({ status: 'authed', user: { ...user(name), avatarUrl: '/physicsos/avatars/guizhou-v1/discovery-192.webp' } })
      telemetry.openDisplayed('lab', 'entry-two')
      await vi.waitFor(() => { expect(events).toHaveLength(3) })
      expect(events.map(event => event.kind)).toEqual(['visit', 'open', 'open'])
      expect(events.filter(event => event.kind === 'open').map(event => event.module)).toEqual(['lab', 'lab'])
      expect(events.every(event => !('owner' in event) && !('occurredAt' in event) && event.kind !== ('use' as string))).toBe(true)
      expect(events[0]!.id).toBe(events[0]!.pageInstanceId)
    } finally { telemetry.dispose() }
  })
  it('pins expected owners on the wire and aborts in-flight work when an account changes', async () => {
    const signals: AbortSignal[] = [], headers: Headers[] = []
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal); headers.push(new Headers(init?.headers))
      return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true }) })
    })
    const auth = createAuthController(createAuthApi(), localStorage), a = `a-${Math.random()}`, b = `b-${Math.random()}`
    auth.store.set({ status: 'authed', user: user(a) })
    const telemetry = startActivityTelemetry(auth, { enabled: true, fetch: fetcher as typeof fetch, storage: memoryStorage() })
    try {
      telemetry.appDisplayed()
      expect(signals).toHaveLength(1)
      auth.store.set({ status: 'authed', user: user(b, 'other-school') })
      expect(signals[0]!.aborted).toBe(true)
      expect(JSON.parse(decodeURIComponent(headers[0]!.get('x-physicsos-activity-owner')!))).toEqual({ schoolId: 'school', username: a })
      expect(JSON.parse(decodeURIComponent(headers[1]!.get('x-physicsos-activity-owner')!))).toEqual({ schoolId: 'other-school', username: b })
    } finally { telemetry.dispose() }
  })
  it('replays the exact original id from the bounded session queue and never refreshes an expired event into today', async () => {
    const auth = createAuthController(createAuthApi(), localStorage), name = `replay-${Math.random()}`, storage = memoryStorage(), at = Date.now()
    auth.store.set({ status: 'authed', user: user(name) })
    const submitted: ActivityClientEvent[] = []
    const firstFetch = vi.fn(async (_url: unknown, init?: RequestInit) => { submitted.push(JSON.parse(String(init?.body))); throw new Error('offline') })
    const first = startActivityTelemetry(auth, { enabled: true, storage, now: () => at, fetch: firstFetch as typeof fetch })
    first.appDisplayed(); await vi.waitFor(() => { expect(submitted).toHaveLength(1) }); first.dispose()
    const replayFetch = vi.fn(async (_url: unknown, init?: RequestInit) => { submitted.push(JSON.parse(String(init?.body))); return { ok: true, json: async () => ({ status: 'duplicate', occurredAt: new Date(at).toISOString() }) } as Response })
    const next = startActivityTelemetry(auth, { enabled: true, storage, now: () => at + 60_000, fetch: replayFetch as typeof fetch })
    await vi.waitFor(() => { expect(submitted).toHaveLength(2) }); next.dispose()
    expect(submitted[1]).toEqual(submitted[0])
    storage.setItem('physicsos.activity.v1.pending', JSON.stringify([{ owner: { schoolId: 'school', username: name }, input: submitted[0] }]))
    const expiredFetch = vi.fn(), expired = startActivityTelemetry(auth, { enabled: true, storage, now: () => at + 8 * 86_400_000, fetch: expiredFetch as typeof fetch })
    expect(expiredFetch).not.toHaveBeenCalled(); expired.dispose()
  })
  it('makes disabled/bridge telemetry a true no-op and bounds a burst without fake success', async () => {
    const auth = createAuthController(createAuthApi(), localStorage), name = `limits-${Math.random()}`
    auth.store.set({ status: 'authed', user: user(name) })
    const fetcher = vi.fn(async () => { throw new Error('offline') }), issue = vi.fn()
    const bridge = startActivityTelemetry(auth, { enabled: false, fetch: fetcher as typeof fetch })
    bridge.appDisplayed(); bridge.openDisplayed('lab', 'first'); bridge.dispose()
    expect(fetcher).not.toHaveBeenCalled()
    const active = startActivityTelemetry(auth, { enabled: true, storage: memoryStorage(), fetch: fetcher as typeof fetch, onIssue: issue })
    try { for (let i = 0; i < 200; i += 1) active.openDisplayed('lab', `entry-${i}`); expect(fetcher.mock.calls.length).toBeLessThanOrEqual(128); expect(issue).toHaveBeenCalledWith('ACTIVITY_CLIENT_QUEUE_ROWS') } finally { active.dispose() }
  })
  it('buffers real successful displays before capabilities without a network request, preserves original time and rejects late old-account events', async () => {
    const auth = createAuthController(createAuthApi(), localStorage), name = `buffer-${Math.random()}`, owner = user(name)
    auth.store.set({ status: 'authed', user: owner })
    const beforeMidnight = Date.parse('2026-11-16T15:59:59.000Z'), events: ActivityClientEvent[] = []
    const buffer = bufferActivityDisplays(auth, { now: () => beforeMidnight })
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { events.push(JSON.parse(String(init?.body))); return { ok: true, json: async () => ({ status: 'recorded', occurredAt: new Date(beforeMidnight).toISOString() }) } as Response })
    reportActivityDisplayed('lab', 'successful-presentation', `${owner.schoolId}:${owner.username}`)
    reportActivityDisplayed('lab', 'successful-presentation', `${owner.schoolId}:${owner.username}`)
    reportActivityDisplayed('lab', 'stale-presentation', 'other-school:other-user')
    expect(fetcher).not.toHaveBeenCalled()
    const telemetry = startActivityTelemetry(auth, { enabled: true, storage: memoryStorage(), now: () => beforeMidnight + 2000, fetch: fetcher as typeof fetch })
    try {
      buffer.flushInto(telemetry); telemetry.appDisplayed()
      await vi.waitFor(() => { expect(events).toHaveLength(2) })
      expect(events.map(row => row.kind)).toEqual(['visit', 'open'])
      expect(events.every(row => Number(row.id.slice(0, 13)) === beforeMidnight)).toBe(true)
      expect(events[1]!.pageInstanceId).toBe(events[0]!.id)
    } finally { buffer.dispose(); telemetry.dispose() }
    const discarded = bufferActivityDisplays(auth)
    reportActivityDisplayed('canvas', 'must-not-transfer', `${owner.schoolId}:${owner.username}`)
    auth.store.set({ status: 'authed', user: user(`new-${Math.random()}`) })
    const nextTelemetry = { appDisplayed: vi.fn(), openDisplayed: vi.fn(), dispose: vi.fn() }
    discarded.flushInto(nextTelemetry)
    expect(nextTelemetry.openDisplayed).not.toHaveBeenCalled()
  })
  it('passes caller abort, no-store, owner expectation and exact target fields through the standalone API', async () => {
    let init: RequestInit | undefined, url = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => { url = String(input); init = options; return { ok: true, json: async () => ({}) } as Response })
    const controller = new AbortController(), api = createActivityApi({ fetch: fetcher as typeof fetch, owner: () => ({ schoolId: 'school', username: 'admin' }) })
    await api.userDetail({ schoolId: 'school', username: 'student' }, { days: 90 }, { signal: controller.signal })
    expect(url).toContain('/physicsos/admin/activity/v1/users?')
    expect(new URL(url, 'https://local.invalid').searchParams.get('days')).toBe('90')
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
    expect(new Headers(init!.headers).get('x-physicsos-activity-owner')).toBe(encodeURIComponent(JSON.stringify({ schoolId: 'school', username: 'admin' })))
    controller.abort(); expect(init!.signal!.aborted).toBe(true)
  })
})
