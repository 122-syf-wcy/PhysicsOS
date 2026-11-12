/** Adapter/HTTP checks. Real learning/class/paper/notice facade integration is in data.spec.ts. */
import { describe, expect, it, vi } from 'vitest'
import type { MobileLearningFacade } from '../src/contract.ts'
import type { ExportSection } from '../src/routes.ts'
import { authFor, call, routeDeps, student } from './fixture.ts'

const unused = async (): Promise<never> => { throw new Error('Unexpected facade operation') }
const learning: MobileLearningFacade = {
  listAttempts: () => [{ id: 'a1', at: '2026-11-01T00:00:00Z' }, { id: 'a2', at: '2026-11-02T00:00:00Z' }, { id: 'a3', at: '2026-11-03T00:00:00Z' }],
  saveAttempt: unused, listScenes: () => [{ sceneId: 's1', revision: 1 }], getScene: unused,
  saveScene: async (_actor, id) => ({ item: { sceneId: id, revision: 2 }, replayed: false, appliedRevision: 2 }),
  deleteScene: unused, exportScene: unused,
  exportCanvasMetadata: unused, exportCanvasObjectIndex: unused, exportCanvasObject: unused,
}
const sections: ExportSection[] = [{ id: 'learning.scenes', rows: actor => learning.listScenes(actor), idOf: row => String(row['sceneId']) }]
const deps = () => routeDeps({ learning: () => learning, exports: () => sections })

describe('mobile HTTP boundary', () => {
  it('returns newest-first pages with opaque cursors rather than accepting coercible limits', async () => {
    const first = await call(deps(), 'GET', '/learning/attempts?limit=2')
    expect(first.status).toBe(200)
    expect(first.json.data['items']).toEqual([{ id: 'a3', at: '2026-11-03T00:00:00Z' }, { id: 'a2', at: '2026-11-02T00:00:00Z' }])
    const cursor = String(first.json.data['nextCursor'])
    expect(cursor).not.toBe('a2')
    const second = await call(deps(), 'GET', `/learning/attempts?limit=2&cursor=${cursor}`)
    expect(second.json.data['items']).toEqual([{ id: 'a1', at: '2026-11-01T00:00:00Z' }])
    expect(second.json.data['nextCursor']).toBeUndefined()
    for (const limit of ['0', '-1', '1.5', '1e2', 'NaN', 'Infinity', '101', '01', '']) {
      expect((await call(deps(), 'GET', `/learning/attempts?limit=${limit}`)).status).toBe(400)
    }
  })

  it('binds cursors to account instance, route and filters, and rejects duplicate query keys', async () => {
    const first = await call(deps(), 'GET', '/learning/attempts?limit=1')
    const cursor = String(first.json.data['nextCursor'])
    const replacement = routeDeps({ ...deps(), auth: () => authFor({ ...student, userId: 'replacement' }) })
    expect((await call(replacement, 'GET', `/learning/attempts?cursor=${cursor}`)).json.error.code).toBe('BAD_CURSOR')
    expect((await call(deps(), 'GET', `/learning/scenes?cursor=${cursor}`)).json.error.code).toBe('BAD_CURSOR')
    expect((await call(deps(), 'GET', '/learning/attempts?limit=1&limit=2')).status).toBe(400)
    expect((await call(deps(), 'GET', '/learning/attempts?cursor=broken')).json.error.code).toBe('BAD_CURSOR')
  })

  it('uses the refresh-compatible 401 code and never promotes admin roles to students', async () => {
    const signedOut = routeDeps({ auth: () => authFor(student, { resolve: () => null }) })
    expect((await call(signedOut, 'GET', '/auth/me')).json.error.code).toBe('UNAUTHENTICATED')
    for (const role of ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const) {
      const denied = routeDeps({ ...deps(), auth: () => authFor({ ...student, role }) })
      expect((await call(denied, 'GET', '/learning/attempts')).status).toBe(403)
      expect((await call(denied, 'GET', '/account/export')).status).toBe(403)
    }
  })

  it('fails unavailable dependencies and preserves business errors', async () => {
    expect((await call(routeDeps(), 'GET', '/learning/attempts')).status).toBe(503)
    const failing = routeDeps({ learning: () => ({ ...learning, listScenes: () => { throw Object.assign(new Error('deleted'), { status: 410, code: 'SCENE_DELETED' }) } }) })
    expect((await call(failing, 'GET', '/learning/scenes')).json.error.code).toBe('SCENE_DELETED')
    expect((await call(deps(), 'GET', '/does-not-exist')).status).toBe(404)
  })

  it('requires the idempotency key before applying a scene mutation', async () => {
    expect((await call(deps(), 'PUT', '/learning/scenes/s1', { body: { baseRevision: 1 } })).status).toBe(400)
    const accepted = await call(deps(), 'PUT', '/learning/scenes/s1', { body: { baseRevision: 1 }, headers: { 'idempotency-key': 'mutation-0001' } })
    expect(accepted.status).toBe(200)
    expect(accepted.json.data['appliedRevision']).toBe(2)
  })

  it('rejects browser mutations, ambiguous JSON, invalid UTF-8 and media types before writes', async () => {
    const headers = { 'idempotency-key': 'mutation-0001' }
    for (const raw of ['[]', 'null', '{"n":1e309}', '{"baseRevision":0,"baseRevision":1}', '{"x":0,"\\u0078":1}', '{"x":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}']) {
      expect((await call(deps(), 'PUT', '/learning/scenes/s1', { raw, headers })).status).toBe(400)
    }
    expect((await call(deps(), 'PUT', '/learning/scenes/s1', { raw: new Uint8Array([123, 34, 255, 34, 58, 48, 125]), headers })).status).toBe(400)
    expect((await call(deps(), 'PUT', '/learning/scenes/s1', { body: {}, headers: { ...headers, 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await call(deps(), 'PUT', '/learning/scenes/s1', { body: {}, headers: { ...headers, origin: 'https://untrusted.example' } })).status).toBe(403)
    expect((await call(deps(), 'PUT', '/learning/scenes/s1', { body: {}, headers: { ...headers, 'content-encoding': 'gzip' } })).status).toBe(415)
  })

  it('decodes a path segment exactly once and rejects traversal before URL normalization', async () => {
    const figure = vi.fn(async () => new Uint8Array([1]))
    const paper = { figure } as unknown as NonNullable<ReturnType<ReturnType<typeof deps>['paper']>>
    const configured = routeDeps({ classes: () => ({} as NonNullable<ReturnType<ReturnType<typeof deps>['classes']>>), paper: () => paper })
    const response = await call(configured, 'GET', '/classes/c/assignments/a/target/figures/fig%3Aone')
    expect(response.status).toBe(200)
    expect(figure).toHaveBeenCalledWith(student, 'c', 'a', 'fig:one')
    for (const path of ['/classes/%2e%2e/library', '/learning/scenes/a%2fb', '/learning/scenes/%252e', '/learning/scenes/%ff', '/learning//scenes/a', '/learning/scenes/../a']) {
      expect((await call(deps(), 'GET', path)).status).toBe(400)
    }
  })

  it('uses auth-owned client address and passes through reset/password/revoke/deletion receipts', async () => {
    const reset = vi.fn(async () => ({ ok: true as const }))
    const password = vi.fn(async () => ({ ok: true as const, reauthenticate: true as const }))
    const revoke = vi.fn(async () => ({ ok: true as const, reauthenticate: true }))
    const deletion = vi.fn(async () => ({ status: 'deletion_pending' as const, requestId: 'pending-one' }))
    const auth = authFor(student, { clientAddress: () => 'trusted-socket', requestPasswordReset: reset, submitPasswordReset: reset,
      changePassword: password, revokeDevice: revoke, deleteAccount: deletion })
    const configured = routeDeps({ auth: () => auth })
    for (const path of ['/auth/password-reset/request', '/auth/password-reset/submit']) {
      expect((await call(configured, 'POST', path, { body: {}, headers: { 'x-forwarded-for': 'forged' } })).status).toBe(200)
    }
    expect(reset).toHaveBeenLastCalledWith({}, 'trusted-socket')
    expect((await call(configured, 'POST', '/auth/password', { body: {} })).json.data).toEqual({ ok: true, reauthenticate: true })
    expect((await call(configured, 'DELETE', '/auth/devices/d')).json.data).toEqual({ ok: true, reauthenticate: true })
    const pending = routeDeps({ auth: () => ({ ...auth, resolve: () => null }) })
    expect((await call(pending, 'DELETE', '/auth/account', { body: {} })).json.data).toEqual({ status: 'deletion_pending', requestId: 'pending-one' })
    expect(deletion).toHaveBeenCalledTimes(1)
  })
})
