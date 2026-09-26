import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiPolicy } from '../src/api-policy.ts'
import {
  cookieOf,
  createSecurityHarness,
  get,
  post,
  school,
  user,
  type SecurityHarness,
} from './security-fixture.ts'

const harnesses: SecurityHarness[] = []

const makeHarness = async (): Promise<SecurityHarness> => {
  const harness = await createSecurityHarness({
    schools: [school('GZU', '贵州大学')],
    users: [user('GZU', 'student1', 'STUDENT')],
  })
  harnesses.push(harness)
  return harness
}

const login = async (harness: SecurityHarness): Promise<string> => {
  const response = await post(harness.auth, '/login', {
    schoolId: 'GZU',
    username: 'student1',
    password: 'bootstrap-pass',
  })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.close()))
})

describe('personal API tokens', () => {
  it('returns the secret once, stores only its hash, lists masked rows, and revokes immediately', async () => {
    const harness = await makeHarness()
    const cookie = await login(harness)
    const headers = { cookie: `physicsos_session=${cookie}` }
    const expiresAt = new Date(Date.now() + 60_000).toISOString()

    const created = await post(harness.auth, '/api-tokens', {
      name: '自动化脚本',
      scope: 'write',
      expiresAt,
    }, headers)
    expect(created.status).toBe(201)
    const body = await created.json() as {
      token: { id: string; name: string; scope: string; expiresAt: string }
      secret: string
    }
    expect(body.token).toMatchObject({ name: '自动化脚本', scope: 'write', expiresAt })
    expect(body.secret).toMatch(/^pso_/)

    const stored = [...harness.domain.table('api_tokens').entries()]
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(body.secret)
    expect(stored[0]?.[1].tokenHash).toHaveLength(64)

    const me = await get(harness.auth, '/me', {
      authorization: `Bearer ${body.secret}`,
    })
    expect(me.status).toBe(200)
    const listed = await get(harness.auth, '/api-tokens', headers)
    const listBody = await listed.json() as { tokens: { id: string; tokenMasked: string }[] }
    expect(listBody.tokens[0]).toMatchObject({
      id: body.token.id,
    })
    expect(listBody.tokens[0]?.tokenMasked).not.toContain(body.secret)
    expect(JSON.stringify(listBody)).not.toContain(body.secret)

    const revoked = await post(harness.auth, `/api-tokens/${body.token.id}/revoke`, {}, headers)
    expect(revoked.status).toBe(200)
    expect((await get(harness.auth, '/me', {
      authorization: `Bearer ${body.secret}`,
    })).status).toBe(401)

    const audit = await fetch(`${harness.admin}/audit`, { headers })
    expect(audit.status).toBe(403)
    const events = [...harness.domain.table('admin_audit').entries()].map(([, row]) => row)
    expect(events.some(event => event.action === 'api_token.create')).toBe(true)
    expect(events.some(event => event.action === 'api_token.revoke')).toBe(true)
  })

  it('defaults to read and enforces read/write scopes', async () => {
    const harness = await makeHarness()
    const cookie = await login(harness)
    const sessionHeaders = { cookie: `physicsos_session=${cookie}` }

    const readCreated = await post(harness.auth, '/api-tokens', { name: '只读' }, sessionHeaders)
    const readBody = await readCreated.json() as { secret: string }
    const writeCreated = await post(harness.auth, '/api-tokens', {
      name: '读写',
      scope: 'write',
    }, sessionHeaders)
    const writeBody = await writeCreated.json() as { secret: string }
    expect(readCreated.status).toBe(201)
    expect(writeCreated.status).toBe(201)

    const readWrite = await post(harness.auth, '/usage/learning', {
      knowledgeId: 'opt-lens-imaging',
      correct: true,
    }, { authorization: `Bearer ${readBody.secret}` })
    expect(readWrite.status).toBe(403)
    expect((await readWrite.json() as { error: { code: string } }).error.code)
      .toBe('TOKEN_SCOPE_REQUIRED')

    const writeWrite = await post(harness.auth, '/usage/learning', {
      knowledgeId: 'opt-lens-imaging',
      correct: true,
    }, { authorization: `Bearer ${writeBody.secret}` })
    expect(writeWrite.status).toBe(201)
  })

  it('uses the same per-account model budget key for cookie and token authentication', async () => {
    const harness = await makeHarness()
    const cookie = await login(harness)
    const created = await post(harness.auth, '/api-tokens', {
      name: '模型调用',
      scope: 'write',
    }, { cookie: `physicsos_session=${cookie}` })
    const { secret } = await created.json() as { secret: string }
    const credential = harness.service.resolveCredential(undefined, `Bearer ${secret}`)
    expect(credential?.actor.userKey).toBe('GZU:student1')

    const consume = vi.fn(async () => true)
    const policy = createApiPolicy({
      actorFromCookie: () => credential?.actor ?? null,
      actorFromRequest: () => credential?.actor ?? null,
      store: {
        owns: () => true,
        ownedIds: () => new Set(),
        claim: async () => {},
        release: async () => {},
      },
      ensureWorkspace: async () => ({ id: 'ws', path: '/tmp/ws', title: '我的工作区' }),
      limiter: { kind: 'test', consume },
      modelPolicy: { limit: 1, windowMs: 60_000, maxBuckets: 10 },
    })
    const request = new Request('http://dsh.internal/api/session.prompt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'token-budget',
        method: 'session.prompt',
        payload: { sessionId: 'owned' },
      }),
    })
    const response = await policy.wrapFetch(async () => Response.json({
      type: 'server-response',
      rpcId: 'token-budget',
      result: { ok: true, value: { accepted: true } },
    }))(request)
    expect(response.status).toBe(200)
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'model' }),
      'GZU:student1',
    )
  })

  it('enforces read scope inside the shared Harness /api policy', async () => {
    const harness = await makeHarness()
    const cookie = await login(harness)
    const created = await post(harness.auth, '/api-tokens', {
      name: 'API 只读',
    }, { cookie: `physicsos_session=${cookie}` })
    const { secret } = await created.json() as { secret: string }
    const credential = harness.service.resolveCredential(undefined, `Bearer ${secret}`)
    if (credential === null || credential.credential.kind !== 'api-token') {
      throw new Error('expected token credential')
    }
    const scopedActor = {
      ...credential.actor,
      credential: {
        kind: 'api-token' as const,
        tokenId: credential.credential.token.id,
        scope: credential.credential.scope,
      },
    }

    const next = vi.fn(async () => Response.json({
      type: 'server-response',
      rpcId: 'read-scope',
      result: { ok: true, value: {} },
    }))
    const policy = createApiPolicy({
      actorFromCookie: () => scopedActor,
      actorFromRequest: () => scopedActor,
      store: {
        owns: () => true,
        ownedIds: () => new Set(),
        claim: async () => {},
        release: async () => {},
      },
      ensureWorkspace: async () => ({ id: 'ws', path: '/tmp/ws', title: '我的工作区' }),
      limiter: { kind: 'test', consume: async () => true },
    })
    const request = new Request('http://dsh.internal/api/session.prompt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'read-scope',
        method: 'session.prompt',
        payload: { sessionId: 'owned' },
      }),
    })
    const response = await policy.wrapFetch(next)(request)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'TOKEN_SCOPE_REQUIRED' } },
    })
    expect(next).not.toHaveBeenCalled()

    const readRequest = new Request('http://dsh.internal/api/session.list', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'read-scope',
        method: 'session.list',
        payload: {},
      }),
    })
    expect((await policy.wrapFetch(next)(readRequest)).status).toBe(200)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('rejects unauthenticated and malformed token creation requests', async () => {
    const harness = await makeHarness()
    expect((await post(harness.auth, '/api-tokens', { name: 'x' })).status).toBe(401)
    const cookie = await login(harness)
    const blank = await post(harness.auth, '/api-tokens', { name: '' }, {
      cookie: `physicsos_session=${cookie}`,
    })
    expect(blank.status).toBe(400)
    const past = await post(harness.auth, '/api-tokens', {
      name: '过期',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }, { cookie: `physicsos_session=${cookie}` })
    expect(past.status).toBe(400)
  })
})
