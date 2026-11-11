import { describe, expect, it } from 'vitest'
import { createApiPolicy, type ApiPolicyActor, type ApiPolicyStore } from '../src/api-policy.ts'

const actor = (role: ApiPolicyActor['role']): ApiPolicyActor => ({ userKey: 'fixture:operator',
  schoolId: 'fixture', username: 'operator', role })
const store: ApiPolicyStore = { owns: () => false, ownedIds: () => new Set(), claim: async () => {}, release: async () => {} }
const request = (method: string, payload: Record<string, unknown> = {}): Request => new Request(`http://fixture/api/${method}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: 'physicsos_session=fixture-only' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'plugin-policy', method, payload }),
})
const success = (): Response => Response.json({ type: 'server-response', rpcId: 'plugin-policy',
  result: { ok: true, value: { available: true } } })

describe('public plugin functionality is disabled independently of internal modules', () => {
  for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const) {
    for (const method of ['pluginManager.inspect', 'pluginManager.installBundle', 'pluginManager.setBundleEnabled',
      'pluginManager.removeBundle', 'pluginManager.cancelInstall', 'pluginRegistryProbe.fastest']) {
      it(`rejects ${method} for ${role} before a host operation can run`, async () => {
        const policy = createApiPolicy({ actorFromCookie: () => actor(role), actorFromRequest: () => actor(role), store,
          ensureWorkspace: async () => ({ id: 'workspace-fixture', path: '/fixture', title: 'fixture' }) })
        let reachedHost = false
        const response = await policy.wrapFetch(async () => { reachedHost = true; return success() })(request(method, {
          args: { spec: 'fixture-package', name: 'fixture-package', enabled: true },
        }))
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'PLUGIN_MANAGEMENT_DISABLED' } } })
        expect(reachedHost).toBe(false)
      })
    }
  }

  it('retains the inventory read required by internal client module composition', async () => {
    const policy = createApiPolicy({ actorFromCookie: () => actor('STUDENT'), actorFromRequest: () => actor('STUDENT'), store,
      ensureWorkspace: async () => ({ id: 'workspace-fixture', path: '/fixture', title: 'fixture' }) })
    const response = await policy.wrapFetch(async () => success())(request('pluginInventory.list'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { available: true } } })
  })
})
