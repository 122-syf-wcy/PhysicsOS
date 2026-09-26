import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  createApiPolicy,
  type ApiPolicyActor,
  type ApiPolicyStore,
  type ApiPolicyWorkspace,
} from '../src/api-policy.ts'

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

const otherStudent: ApiPolicyActor = {
  userKey: 'school:other',
  schoolId: 'school',
  username: 'other',
  role: 'STUDENT',
}

const workspace: ApiPolicyWorkspace = {
  id: 'workspace-student',
  path: '/srv/physicsos-users/student',
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

const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

const makeStore = (
  owned: Partial<Record<'session' | 'workspace', readonly string[]>> = {},
): ApiPolicyStore & { claims: string[] } => {
  const sessions = new Set(owned.session ?? [])
  const workspaces = new Set(owned.workspace ?? [])
  const claims: string[] = []
  return {
    claims,
    owns: (_actor, kind, id) => (kind === 'session' ? sessions : workspaces).has(id),
    ownedIds: (_actor, kind) => new Set(kind === 'session' ? sessions : workspaces),
    claim: async (_actor, kind, id) => {
      claims.push(`${kind}:${id}`)
      ;(kind === 'session' ? sessions : workspaces).add(id)
    },
    release: async (_actor, kind, id) => {
      ;(kind === 'session' ? sessions : workspaces).delete(id)
    },
  }
}

const makePolicy = (options: {
  actor?: ApiPolicyActor | null
  store?: ApiPolicyStore & { claims: string[] }
  ensureWorkspace?: () => Promise<ApiPolicyWorkspace>
} = {}) => {
  const store = options.store ?? makeStore()
  return {
    store,
    policy: createApiPolicy({
      actorFromCookie: () => options.actor === undefined ? student : options.actor,
      actorFromRequest: () => options.actor === undefined ? student : options.actor,
      store,
      ensureWorkspace: options.ensureWorkspace ?? (async () => workspace),
    }),
  }
}

describe('PhysicsOS shared /api policy', () => {
  it('refuses an anonymous request before dispatch', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy({ actor: null })
    const response = await policy.wrapFetch(next)(request('session.list', {}, ''))
    expect(response.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('lists only sessions owned by the account', async () => {
    const { policy } = makePolicy({
      store: makeStore({ session: ['owned-a'] }),
    })
    const response = await policy.wrapFetch(async () => rpc({
      items: [
        { sessionId: 'owned-a', updatedAt: 2, running: false, blank: false },
        { sessionId: 'foreign-b', updatedAt: 1, running: false, blank: false },
      ],
    }))(request('session.list'))
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'policy-test',
      result: {
        ok: true,
        value: {
          items: [{ sessionId: 'owned-a', updatedAt: 2, running: false, blank: false }],
        },
      },
    })
  })

  it('answers session-not-found for an unowned session without dispatch', async () => {
    const next = vi.fn(async () => rpc({ events: [] }))
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('session.history', { sessionId: 'foreign' }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: false,
        error: { code: 'session-not-found', details: { sessionId: 'foreign' } },
      },
    })
  })

  it('forces a non-admin session into PhysicsOS scope and records ownership', async () => {
    const { policy, store } = makePolicy()
    const next = vi.fn(async (forwarded: Request) => {
      const body = await forwarded.clone().json() as {
        payload: { agentPreset?: string; workspaceId?: string; cwd?: string }
      }
      expect(body.payload).toEqual({
        agentPreset: 'physics-student',
        workspaceId: workspace.id,
      })
      return rpc({ sessionId: 'new-session', agentPreset: 'physics-student' })
    })
    const response = await policy.wrapFetch(next)(request('session.create', {
      agentPreset: 'standard',
      cwd: '/etc',
    }))
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { sessionId: 'new-session' } },
    })
    expect(next).toHaveBeenCalledTimes(1)
    expect(store.claims).toEqual(['workspace:workspace-student', 'session:new-session'])
  })

  it('returns the account workspace instead of accepting a caller path', async () => {
    const next = vi.fn(async () => rpc({ created: true, workspace: {} }))
    const { policy, store } = makePolicy()
    const response = await policy.wrapFetch(next)(request('workspace.create', { path: '/etc' }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: { created: false, workspace: { workspaceId: 'workspace-student', path: workspace.path } },
      },
    })
    expect(store.claims).toEqual(['workspace:workspace-student'])
  })

  it('refuses a non-admin agent preset switch', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy({ store: makeStore({ session: ['owned-a'] }) })
    const response = await policy.wrapFetch(next)(request('agentPreset.select', {
      sessionId: 'owned-a',
      agentPreset: 'standard',
    }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'agent-preset-not-found' } },
    })
  })

  it('scopes nested session ids on gateway-style methods', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy({ store: makeStore({ session: ['owned-a'] }) })
    const response = await policy.wrapFetch(next)(request('messageFeedback.put', {
      args: { sessionId: 'foreign', note: 'x' },
    }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'session-not-found' } },
    })
  })

  it('accepts a pending response only from the account that received its rpc', async () => {
    const delivered = makePolicy({ store: makeStore({ session: ['owned-session'] }) })
    const other = makePolicy({
      actor: otherStudent,
      store: makeStore({ session: ['owned-session'] }),
    })
    const events = {
      mux: async function * () {
        yield {
          rpcId: 'question-rpc',
          payload: {
            type: 'question/requested',
            sessionId: 'owned-session',
            questions: [],
          },
        }
        yield {
          rpcId: 'foreign-rpc',
          payload: {
            type: 'question/requested',
            sessionId: 'foreign-session',
            questions: [],
          },
        }
      },
      host: async function * () {},
    }
    const request = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await delivered.policy.scopeEvents(request, events) as typeof events
    await collect(scoped.mux({ rpcId: RpcId('test'), payload: {} }, new AbortController().signal))

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
    const accepted = vi.fn(async () => Response.json({ accepted: true }))
    expect((await delivered.policy.wrapFetch(accepted)(responseRequest())).status).toBe(200)
    expect(accepted).toHaveBeenCalledTimes(1)

    const deniedNext = vi.fn(async () => Response.json({ accepted: true }))
    expect((await other.policy.wrapFetch(deniedNext)(responseRequest())).status).toBe(403)
    expect(deniedNext).not.toHaveBeenCalled()

    const foreignResponse = vi.fn(async () => Response.json({ accepted: true }))
    const forged = new Request('http://dsh.internal/api/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'physicsos_session=student',
      },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: 'foreign-rpc',
        result: { ok: true, value: { answer: 'A' } },
      }),
    })
    expect((await delivered.policy.wrapFetch(foreignResponse)(forged)).status).toBe(403)
    expect(foreignResponse).not.toHaveBeenCalled()
  })

  it('lets a platform admin use the unscoped API surface', async () => {
    const next = vi.fn(async () => rpc({ ok: 'admin' }))
    const { policy } = makePolicy({ actor: admin })
    const response = await policy.wrapFetch(next)(request('session.history', {
      sessionId: 'legacy-session',
    }, 'admin'))
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { ok: 'admin' } } })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('filters both event streams to owned sessions and workspaces', async () => {
    const store = makeStore({
      session: ['owned-session'],
      workspace: ['owned-workspace'],
    })
    const { policy } = makePolicy({ store })
    const events = {
      mux: async function* () {
        yield { rpcId: 'mux-owned', payload: { type: 'session/event', sessionId: 'owned-session' } }
        yield { rpcId: 'mux-foreign', payload: { type: 'session/event', sessionId: 'foreign-session' } }
      },
      host: async function* () {
        yield { rpcId: 'host-session', payload: { type: 'host/session-status', sessionId: 'owned-session', running: true } }
        yield { rpcId: 'host-foreign', payload: { type: 'host/session-status', sessionId: 'foreign-session', running: true } }
        yield {
          rpcId: 'host-workspace',
          payload: {
            type: 'host/workspace-changed',
            workspace: { workspaceId: 'owned-workspace' },
          },
        }
        yield {
          rpcId: 'host-order',
          payload: {
            type: 'host/workspace-order-changed',
            workspaceIds: ['owned-workspace', 'foreign-workspace'],
          },
        }
        yield {
          rpcId: 'host-archive',
          payload: {
            type: 'host/archived-sessions-changed',
            archivedSessionIds: ['owned-session', 'foreign-session'],
          },
        }
        yield { rpcId: 'host-remote', payload: { type: 'host/remote-event', event: 'x', args: [] } }
      },
    }
    const request = { headers: { cookie: 'physicsos_session=student' } } as IncomingMessage
    const scoped = await policy.scopeEvents(request, events) as typeof events

    expect((await collect(scoped.mux({ rpcId: RpcId('test'), payload: {} }, new AbortController().signal)))
      .map(frame => frame.rpcId))
      .toEqual(['mux-owned'])
    expect((await collect(scoped.host({ rpcId: RpcId('test'), payload: {} }, new AbortController().signal)))
      .map(frame => frame.rpcId))
      .toEqual(['host-session', 'host-workspace', 'host-order', 'host-archive'])
    expect((await collect(scoped.host({ rpcId: RpcId('test'), payload: {} }, new AbortController().signal)))[2]).toMatchObject({
      payload: { workspaceIds: ['owned-workspace'] },
    })
    expect((await collect(scoped.host({ rpcId: RpcId('test'), payload: {} }, new AbortController().signal)))[3]).toMatchObject({
      payload: { archivedSessionIds: ['owned-session'] },
    })
  })
})
