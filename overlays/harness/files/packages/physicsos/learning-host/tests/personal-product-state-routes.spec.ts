import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { personalProductStateRoutes, PRODUCT_STATE_PREFIX } from '../src/personal-product-state-routes.ts'
import { learningRoutes } from '../src/routes.ts'
import type { PhysicsosIdentity } from '../src/identity.ts'
import { owner, peer, admin, otherSchool, personalFixture, sceneEntry } from './personal-product-state-fixture.ts'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))))) })
async function httpFixture(enabled = true) {
  const f = personalFixture({ enabled })
  const actors = { alice: owner, bob: peer, admin, foreign: otherSchool }
  const identity: PhysicsosIdentity = {
    actorOf: req => actors[(req.headers.cookie ?? '').replace('account=', '') as keyof typeof actors] ?? null,
    record: async () => {},
  }
  const product = personalProductStateRoutes({ service: f.personal, identity: () => identity })
  const legacy = learningRoutes({ service: f.service, identity: () => identity })
  const server = createServer((req, res) => { void ((req.url ?? '').startsWith(PRODUCT_STATE_PREFIX) ? product(req, res) : legacy(req, res)) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, token?: keyof typeof actors, body?: unknown, headers: Record<string, string> = {}) => {
    const actor = token === undefined ? undefined : actors[token]
    return fetch(`${base}${path}`, { method,
      headers: { ...(token === undefined ? {} : { cookie: `account=${token}` }),
        ...(actor === undefined ? {} : { 'x-physicsos-learning-owner': encodeURIComponent(JSON.stringify({ schoolId: actor.schoolId, username: actor.username })) }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  return { ...f, call }
}
const deletion = { action: 'delete', expectedGeneration: 0, expectedVersion: 0, operationId: 'delete-one' }
describe('personal product routes guard every account and mutation', () => {
  it('requires cookie identity and matching namespace, never JSON owner authority', async () => {
    const f = await httpFixture()
    expect((await f.call('GET', `${PRODUCT_STATE_PREFIX}/projects`)).status).toBe(401)
    for (const token of ['bob', 'admin', 'foreign'] as const)
      expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, token, deletion)).status).toBe(404)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', { ...deletion, ownerKey: peer.userKey })).status).toBe(400)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion,
      { 'x-physicsos-learning-owner': encodeURIComponent(JSON.stringify({ schoolId: peer.schoolId, username: peer.username })) })).status).toBe(409)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion, { origin: 'https://attacker.invalid' })).status).toBe(403)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion, { 'content-type': 'text/plain' })).status).toBe(400)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion, { authorization: 'Bearer read-only-fixture' })).status).toBe(403)
    expect(f.personal.projectDeleted(owner, 'momentum')).toBe(false)
  })
  it('returns conflict state, retains snapshot, and refuses legacy resurrection after a successful delete', async () => {
    const f = await httpFixture()
    await f.service.saveScene(owner, 'motion', sceneEntry())
    const response = await f.call('POST', `${PRODUCT_STATE_PREFIX}/recent-scenes/motion`, 'alice', deletion)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: { recentState: 'deleted', recentGeneration: 1 } })
    const stale = await f.call('PUT', '/physicsos/learning/scenes/motion', 'alice', sceneEntry('motion', 9))
    expect(stale.status).toBe(410)
    expect(await stale.json()).toMatchObject({ error: { code: 'RECENT_SCENE_DELETED', current: { recentGeneration: 1 } } })
    expect(await (await f.call('GET', '/physicsos/learning/scenes', 'alice')).json()).toMatchObject({ items: [] })
    expect(await (await f.call('GET', `${PRODUCT_STATE_PREFIX}/recent-scenes?state=deleted`, 'alice')).json()).toMatchObject({ items: [{ sceneId: 'motion', recentState: 'deleted' }] })
    expect(f.learning.table('saved_scenes').size).toBe(1)
  })
  it('keeps bridge reads working but rejects all new metadata mutations', async () => {
    const f = await httpFixture(false)
    expect((await f.call('GET', `${PRODUCT_STATE_PREFIX}/projects?state=all`, 'alice')).status).toBe(200)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/projects/momentum`, 'alice', deletion)).status).toBe(503)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/session-projects/s1`, 'alice', { projectId: null, expectedVersion: 0, operationId: 'move' })).status).toBe(503)
    expect((await f.call('GET', `${PRODUCT_STATE_PREFIX}/projects?limit=101`, 'alice')).status).toBe(400)
    expect((await f.call('GET', `${PRODUCT_STATE_PREFIX}/recent-scenes?state=unknown`, 'alice')).status).toBe(400)
    expect((await f.call('POST', `${PRODUCT_STATE_PREFIX}/recent-scenes/bad%2Fid`, 'alice', deletion)).status).toBe(400)
  })
})
