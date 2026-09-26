import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { opsRoutes } from '../src/routes.ts'

const makeRes = () => {
  const result = {
    status: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      result.status = status
      result.headers = headers
      return result
    },
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value
    },
    end(body: string) { result.body = body },
  }
  return result
}

const makeReq = (method = 'GET', url = '/physicsos/ops/metrics', cookie = 'physicsos_session=x') =>
  ({ method, url, headers: { cookie } }) as IncomingMessage

const actor = (role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN') => ({
  userKey: 'school:user',
  schoolId: 'school',
  username: 'user',
  role,
})

const identity = (role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN' | null) => ({
  actorOf: () => role === null ? null : actor(role),
  record: vi.fn().mockResolvedValue(undefined),
})

const metrics = {
  cache: { ttlMs: 15_000, hit: false, collectedAt: '2026-09-26T00:00:00.000Z', partial: false },
  disk: {
    root: { path: '/', totalBytes: 1, freeBytes: 1, availableBytes: 1, usedBytes: 0, usedPercent: 0, available: true },
    data: { path: '/data', totalBytes: 1, freeBytes: 1, availableBytes: 1, usedBytes: 0, usedPercent: 0, available: true },
    breakdown: {
      sessions: { path: '/data/sessions', bytes: 0, entries: 0, partial: false },
      workspaces: { path: '/data/workspaces', bytes: 0, entries: 0, partial: false },
      postgres: { bytes: 0, available: true, partial: false },
      redis: { bytes: 0, available: true, partial: false },
    },
    partial: false,
  },
  health: {
    status: 'ok' as const,
    uptimeSeconds: 1,
    node: { version: 'v1', platform: 'darwin', arch: 'arm64' },
    postgres: { ok: true },
    redis: { ok: true },
    sessions: { live: 0, distinctUsers: 0 },
    accounts: { total: 0, active: 0, disabled: 0 },
  },
  alerts: [],
  partial: false,
}

describe('ops routes', () => {
  it('refuses unauthenticated and non-super-admin callers', async () => {
    const handler = opsRoutes({ identity: () => identity(null), collect: vi.fn() })
    const unauthenticated = makeRes()
    await handler(makeReq(), unauthenticated as unknown as ServerResponse)
    expect(unauthenticated.status).toBe(401)

    const forbidden = makeRes()
    await handler(makeReq(), forbidden as unknown as ServerResponse)
    const adminHandler = opsRoutes({ identity: () => identity('SCHOOL_ADMIN'), collect: vi.fn() })
    await adminHandler(makeReq(), forbidden as unknown as ServerResponse)
    expect(forbidden.status).toBe(403)
  })

  it('passes force to the collector and accepts only GET', async () => {
    const collect = vi.fn().mockResolvedValue(metrics)
    const handler = opsRoutes({ identity: () => identity('SUPER_ADMIN'), collect })
    const ok = makeRes()
    await handler(makeReq('GET', '/physicsos/ops/metrics?force=1'), ok as unknown as ServerResponse)
    expect(ok.status).toBe(200)
    expect(collect).toHaveBeenCalledWith(true)

    const method = makeRes()
    await handler(makeReq('POST'), method as unknown as ServerResponse)
    expect(method.status).toBe(405)
  })
})
