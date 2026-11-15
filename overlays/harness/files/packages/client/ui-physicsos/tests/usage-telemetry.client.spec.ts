// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createAuthController } from '../src/client/auth-store.ts'
import { createAuthApi } from '../src/client/auth-api.ts'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { startUsageTelemetry } from '../src/client/usage-telemetry.ts'
import type { UsageEventInput } from '../src/client/usage-api.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it('records inline learning as Lab use and retired library recovery as Home, without deleting historical categories', async () => {
  const events: UsageEventInput[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as UsageEventInput
    events.push(input)
    return { ok: true, json: async () => ({ ...input, at: '2026-11-16T00:00:00Z' }) } as Response
  }))
  const auth = createAuthController(createAuthApi(), localStorage)
  const surface = createPhysicsSurfaceController()
  auth.store.set({ status: 'authed', user: { id: 'student', schoolId: 'school', schoolName: 'School',
    username: 'student', displayName: 'Student', role: 'STUDENT' } })
  const stop = startUsageTelemetry(auth, surface)
  try {
    surface.open('lab')
    surface.adoptPanel('physicsos-library')
    surface.open('contribute')
    surface.open('paper')
    surface.open('notice')
    await vi.waitFor(() => {
      expect(events.filter(event => event.kind === 'use').map(event => event.surface))
        .toEqual(['home', 'lab', 'home', 'community', 'papers', 'profile'])
    })
    expect(events.filter(event => event.kind === 'visit')).toHaveLength(1)
    expect(events.some(event => event.surface === 'library')).toBe(false)
    stop()
    const count = events.length
    surface.open('lab')
    expect(events).toHaveLength(count)
  } finally {
    stop()
  }
})
