import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  createApiPolicy,
  type ApiPolicyActor,
  type ApiPolicyStore,
  type ApiPolicyWorkspace,
} from '../src/api-policy.ts'

interface TestLimiter {
  readonly kind: string
  consume(
    policy: { readonly name: string; readonly limit: number; readonly windowMs: number },
    key: string,
    now?: number,
  ): boolean | Promise<boolean>
}

interface TestOnceClaim {
  readonly status: 'claimed' | 'already-claimed'
  readonly expiresAt: number
}

interface TestOnceLedger {
  readonly kind: string
  claim(key: string, ttlSeconds: number, now?: number): TestOnceClaim | Promise<TestOnceClaim>
  consume(key: string, now?: number): boolean | Promise<boolean>
  release(key: string, now?: number): void | Promise<void>
}

interface ScopedEvents {
  mux: (
    frame: { rpcId: string; payload: unknown },
    signal: AbortSignal,
  ) => AsyncIterable<{ rpcId: string }>
  host: (
    frame: { rpcId: string; payload: unknown },
    signal: AbortSignal,
  ) => AsyncIterable<{ rpcId: string }>
}

const student: ApiPolicyActor = {
  userKey: 'school:student',
  schoolId: 'school',
  username: 'student',
  role: 'STUDENT',
}

const admin: ApiPolicyActor = {
  userKey: 'ops:admin',
  schoolId: 'ops',
  username: 'admin',
  role: 'SUPER_ADMIN',
}

const workspace: ApiPolicyWorkspace = {
  id: 'workspace-student',
  path: '/srv/physicsos-users/student',
  title: '我的工作区',
}

const request = (method: string, payload: Record<string, unknown> = {}, cookie = 'student'): Request =>
  new Request(`http://dsh.internal/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...cookie === '' ? {} : { cookie: `physicsos_session=${cookie}` },
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'policy-test',
      method,
      payload,
    }),
  })

const rpc = (value: unknown): Response => Response.json({
  type: 'server-response',
  rpcId: 'policy-test',
  result: { ok: true, value },
})

const makeStore = (sessions: readonly string[] = []): ApiPolicyStore => {
  const owned = new Set(sessions)
  return {
    owns: (_actor, kind, id) => kind === 'session' ? owned.has(id) : false,
    ownedIds: (_actor, kind) => kind === 'session' ? new Set(owned) : new Set(),
    claim: async (_actor, kind, id) => {
      if (kind === 'session') owned.add(id)
    },
    release: async (_actor, kind, id) => {
      if (kind === 'session') owned.delete(id)
    },
  }
}

const makePolicy = (options: {
  actor?: ApiPolicyActor
  store?: ApiPolicyStore
  limiter?: TestLimiter
  modelPolicy?: { limit: number; windowMs: number; maxBuckets?: number }
  onceLedger?: TestOnceLedger
} = {}) => ({
  policy: createApiPolicy({
    actorFromCookie: () => options.actor ?? student,
    actorFromRequest: () => options.actor ?? student,
    store: options.store ?? makeStore(['owned-session']),
    ensureWorkspace: async () => workspace,
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
    ...(options.modelPolicy === undefined ? {} : { modelPolicy: options.modelPolicy }),
    ...(options.onceLedger === undefined ? {} : { onceLedger: options.onceLedger }),
  }),
})

const responseBody = async (response: Response): Promise<unknown> => await response.json()

const sharedLedger = (): TestOnceLedger & {
  readonly claims: Map<string, number>
  readonly released: string[]
  consumeError?: Error
} => {
  const claims = new Map<string, number>()
  const released: string[] = []
  return {
    kind: 'test',
    claims,
    released,
    claim(key, ttlSeconds) {
      const existing = claims.get(key)
      if (existing !== undefined) return { status: 'already-claimed', expiresAt: existing }
      const expiresAt = Date.now() + ttlSeconds * 1_000
      claims.set(key, expiresAt)
      return { status: 'claimed', expiresAt }
    },
    consume(key) {
      if (this.consumeError !== undefined) throw this.consumeError
      return claims.delete(key)
    },
    release(key) {
      released.push(key)
      claims.delete(key)
    },
  }
}

describe('PhysicsOS /api model budget', () => {
  it('returns 429 after the per-account model budget is exhausted', async () => {
    const consume = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const { policy } = makePolicy({
      limiter: { kind: 'test', consume },
      modelPolicy: { limit: 1, windowMs: 60_000, maxBuckets: 10 },
    })
    const next = vi.fn(async () => rpc({ accepted: true }))

    expect((await policy.wrapFetch(next)(request('session.prompt', { sessionId: 'owned-session' }))).status).toBe(200)
    const refused = await policy.wrapFetch(next)(request('session.prompt', { sessionId: 'owned-session' }))

    expect(refused.status).toBe(429)
    const refusedBody = await responseBody(refused)
    expect(refusedBody).toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'MODEL_BUDGET_EXCEEDED',
        },
      },
    })
    expect(JSON.stringify(refusedBody)).toMatch(/额度/)
    expect(consume).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'model', limit: 1, windowMs: 60_000 }),
      student.userKey,
    )
  })

  it('does not charge budget when ownership rejects the request first', async () => {
    const consume = vi.fn(async () => false)
    const next = vi.fn(async () => rpc({ accepted: true }))
    const { policy } = makePolicy({
      limiter: { kind: 'test', consume },
      modelPolicy: { limit: 1, windowMs: 60_000 },
    })

    const refused = await policy.wrapFetch(next)(request('session.prompt', { sessionId: 'foreign-session' }))

    expect(await responseBody(refused)).toMatchObject({
      result: { ok: false, error: { code: 'session-not-found' } },
    })
    expect(consume).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('charges every method that starts or continues an agent turn', async () => {
    const methods: readonly [string, Record<string, unknown>][] = [
      ['session.create', {}],
      ['session.prompt', { sessionId: 'owned-session' }],
      ['subagent.prompt', { parentSessionId: 'owned-session', childSessionId: 'child-session', mode: 'continuable' }],
      ['goal.create', { sessionId: 'owned-session', objective: 'finish' }],
      ['goal.resume', { sessionId: 'owned-session', ref: { id: 'goal', revision: 1 } }],
    ]

    for (const [method, payload] of methods) {
      const consume = vi.fn(async () => true)
      const { policy } = makePolicy({ limiter: { kind: 'test', consume } })
      await policy.wrapFetch(async () => rpc({}))(request(method, payload))
      expect(consume, method).toHaveBeenCalledTimes(1)
    }
  })

  it('exempts SUPER_ADMIN from the model budget', async () => {
    const consume = vi.fn(async () => false)
    const next = vi.fn(async () => rpc({ accepted: true }))
    const { policy } = makePolicy({
      actor: admin,
      limiter: { kind: 'test', consume },
      modelPolicy: { limit: 0, windowMs: 60_000 },
    })

    const response = await policy.wrapFetch(next)(request('session.prompt', { sessionId: 'legacy' }, 'admin'))

    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledTimes(1)
    expect(consume).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the shared limiter backend throws', async () => {
    const next = vi.fn(async () => rpc({ accepted: true }))
    const { policy } = makePolicy({
      limiter: { kind: 'test', consume: async () => { throw new Error('redis down') } },
    })

    const response = await policy.wrapFetch(next)(request('session.prompt', { sessionId: 'owned-session' }))

    expect(response.status).toBe(503)
    expect(await responseBody(response)).toMatchObject({
      result: { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE' } },
    })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('PhysicsOS /api one-time response ledger', () => {
  it('claims, consumes, and releases a question through the shared ledger', async () => {
    const ledger = sharedLedger()
    const { policy } = makePolicy({ onceLedger: ledger })
    const events = {
      mux: async function * () {
        yield {
          rpcId: 'question-rpc',
          payload: { type: 'question/requested', sessionId: 'owned-session', questions: [] },
        }
      },
      host: async function * () {},
    }
    const request = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await policy.scopeEvents(request, events) as unknown as ScopedEvents
    const source = scoped.mux({ rpcId: 'test', payload: {} }, new AbortController().signal)
    const iterator = source[Symbol.asyncIterator]()

    expect(await iterator.next()).toMatchObject({ value: { rpcId: 'question-rpc' } })
    expect(ledger.claims.has(`${student.userKey}\u0000question-rpc`)).toBe(true)
    await iterator.return?.()

    expect(ledger.claims.has(`${student.userKey}\u0000question-rpc`)).toBe(false)
    expect(ledger.released).toEqual([`${student.userKey}\u0000question-rpc`])
  })

  it('shares a claimed response across policy instances and rejects replay', async () => {
    const ledger = sharedLedger()
    const first = makePolicy({ onceLedger: ledger }).policy
    const second = makePolicy({ onceLedger: ledger }).policy
    const third = makePolicy({ onceLedger: ledger }).policy
    const events = {
      mux: async function * () {
        yield {
          rpcId: 'question-rpc',
          payload: { type: 'question/requested', sessionId: 'owned-session', questions: [] },
        }
      },
      host: async function * () {},
    }
    const scopedRequest = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await first.scopeEvents(scopedRequest, events) as unknown as ScopedEvents

    const source = scoped.mux({ rpcId: 'test', payload: {} }, new AbortController().signal)
    const iterator = source[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ value: { rpcId: 'question-rpc' } })
    expect(ledger.claims.has(`${student.userKey}\u0000question-rpc`)).toBe(true)

    const responseRequest = (): Request => new Request('http://dsh.internal/api/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'physicsos_session=student',
      },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: 'question-rpc',
        result: { ok: true, value: { answer: 'A' } },
      }),
    })

    const secondNext = vi.fn(async () => Response.json({ accepted: true }))
    expect((await second.wrapFetch(secondNext)(responseRequest())).status).toBe(200)
    expect(secondNext).toHaveBeenCalledTimes(1)
    await iterator.return?.()

    const thirdNext = vi.fn(async () => Response.json({ accepted: true }))
    expect((await third.wrapFetch(thirdNext)(responseRequest())).status).toBe(403)
    expect(thirdNext).not.toHaveBeenCalled()
  })

  it('releases a claimed question when the host reports it resolved', async () => {
    const ledger = sharedLedger()
    const { policy } = makePolicy({ onceLedger: ledger })
    const events = {
      mux: async function * () {
        yield {
          rpcId: 'question-rpc',
          payload: { type: 'question/requested', sessionId: 'owned-session', questions: [] },
        }
        yield {
          rpcId: 'question-resolved',
          payload: {
            type: 'question/resolved',
            sessionId: 'owned-session',
            questionRpcId: 'question-rpc',
            outcome: 'cancelled',
          },
        }
      },
      host: async function * () {},
    }
    const request = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await policy.scopeEvents(request, events) as unknown as ScopedEvents

    const frames: string[] = []
    for await (const frame of scoped.mux(
      { rpcId: 'test', payload: {} },
      new AbortController().signal,
    )) {
      frames.push(frame.rpcId)
    }

    expect(frames).toEqual(['question-rpc', 'question-resolved'])
    expect(ledger.claims.has(`${student.userKey}\u0000question-rpc`)).toBe(false)
    expect(ledger.released).toEqual([`${student.userKey}\u0000question-rpc`])
  })

  it('fails closed with 503 when the shared ledger throws', async () => {
    const ledger = sharedLedger()
    ledger.consumeError = new Error('redis down')
    const { policy } = makePolicy({ onceLedger: ledger })
    const events = {
      mux: async function * () {
        yield {
          rpcId: 'question-rpc',
          payload: { type: 'question/requested', sessionId: 'owned-session', questions: [] },
        }
      },
      host: async function * () {},
    }
    const scopedRequest = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await policy.scopeEvents(scopedRequest, events) as unknown as ScopedEvents
    const source = scoped.mux({ rpcId: 'test', payload: {} }, new AbortController().signal)
    const iterator = source[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()

    const next = vi.fn(async () => Response.json({ accepted: true }))
    const response = await policy.wrapFetch(next)(new Request('http://dsh.internal/api/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'physicsos_session=student',
      },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: 'question-rpc',
        result: { ok: true, value: { answer: 'A' } },
      }),
    }))

    expect(response.status).toBe(503)
    expect(await responseBody(response)).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE' },
    })
    expect(next).not.toHaveBeenCalled()
  })
})
