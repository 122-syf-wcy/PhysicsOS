import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  createApiPolicy,
  type ApiPolicyActor,
  type ApiPolicyStore,
  type ApiPolicyWorkspace,
} from '../src/api-policy.ts'

/**
 * The scoped-events surface this file drives. The production type brands rpc
 * ids and unions the frame payloads; the fakes below stay structural, so the
 * test names the two iterator entry points it actually calls.
 */
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

const otherStudent: ApiPolicyActor = {
  userKey: 'school:other',
  schoolId: 'school',
  username: 'other',
  role: 'STUDENT',
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

/** The `value` a wrapped response carried, typed for the assertions below. */
const rpcValueOf = async (response: Response): Promise<unknown> => {
  const body = await response.json() as { result?: { value?: unknown } }
  return body.result?.value
}

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
  ensureWorkspace?: (actor: ApiPolicyActor, title?: string) => Promise<ApiPolicyWorkspace>
  hostFilesystemAccess?: 'deny' | 'admin'
} = {}) => {
  const store = options.store ?? makeStore()
  return {
    store,
    policy: createApiPolicy({
      actorFromCookie: () => options.actor === undefined ? student : options.actor,
      actorFromRequest: () => options.actor === undefined ? student : options.actor,
      store,
      ensureWorkspace: options.ensureWorkspace ?? (async () => workspace),
      ...(options.hostFilesystemAccess === undefined
        ? {}
        : { hostFilesystemAccess: options.hostFilesystemAccess }),
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

  it('allows a student to mutate the onboarding acknowledgement', async () => {
    const next = vi.fn(async (forwarded: Request) => {
      const body = await forwarded.clone().json() as { payload: unknown }
      expect(body.payload).toEqual({
        ns: 'ui-onboarding',
        ops: [{
          op: 'set',
          path: ['welcomeNoticeVersion'],
          value: '2026-08-13.1',
        }],
      })
      return rpc({
        ns: 'ui-onboarding',
        schema: {},
        value: { welcomeNoticeVersion: '2026-08-13.1' },
        applies: 'live',
        secrets: [],
        revision: 1,
      })
    })
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('settings.mutate', {
      ns: 'ui-onboarding',
      ops: [{
        op: 'set',
        path: ['welcomeNoticeVersion'],
        value: '2026-08-13.1',
      }],
    }))
    expect(next).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: {
          ns: 'ui-onboarding',
          value: { welcomeNoticeVersion: '2026-08-13.1' },
        },
      },
    })
  })

  it('refuses a student mutation of another settings namespace', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('settings.mutate', {
      ns: 'llm-deepseek',
      ops: [{ op: 'set', path: ['baseURL'], value: 'https://attacker.invalid' }],
    }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'internal',
          message: 'this method is available only to platform administrators',
        },
      },
    })
  })

  it('refuses a student mutation outside the onboarding acknowledgement path', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('settings.mutate', {
      ns: 'ui-onboarding',
      ops: [{ op: 'set', path: ['welcomeNoticeVersion', 'nested'], value: 'x' }],
    }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'internal',
          message: 'this method is available only to platform administrators',
        },
      },
    })
  })

  it('refuses a student mutation with a forbidden settings operation', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('settings.mutate', {
      ns: 'ui-onboarding',
      ops: [{ op: 'remove', path: ['welcomeNoticeVersion'] }],
    }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'internal',
          message: 'this method is available only to platform administrators',
        },
      },
    })
  })

  it('returns the onboarding and official-plugin namespaces when a student describes settings', async () => {
    const response = await makePolicy().policy.wrapFetch(async () => rpc({
      writable: true,
      hasDocument: true,
      namespaces: [
        {
          ns: 'llm-deepseek',
          schema: { secret: true },
          value: { apiKey: 'stored' },
          applies: 'live',
          secrets: [{ path: ['apiKey'], set: true }],
          revision: 7,
        },
        {
          ns: 'ui-onboarding',
          schema: { type: 'object' },
          value: { welcomeNoticeVersion: '2026-08-13.1' },
          applies: 'live',
          secrets: [],
          revision: 2,
        },
        /* The four official plugin pages register into the Plugins page only
           while their namespace is served, so a student must receive these or
           the page reads 「还没有安装任何插件。」. */
        ...[
          'bash-sandbox',
          'pwsh-sandbox',
          'agent-loop',
          'subagent',
          'subagent-model-selection-settings',
          'web-search-deepseek',
        ].map(ns => ({
          ns,
          schema: { type: 'object' },
          value: {},
          applies: 'live',
          secrets: [],
          revision: 1,
        })),
      ],
    }))(request('settings.describe'))
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'policy-test',
      result: {
        ok: true,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: 'ui-onboarding',
              schema: { type: 'object' },
              value: { welcomeNoticeVersion: '2026-08-13.1' },
              applies: 'live',
              secrets: [],
              revision: 2,
            },
            ...[
              'bash-sandbox',
              'pwsh-sandbox',
              'agent-loop',
              'subagent',
              'subagent-model-selection-settings',
              'web-search-deepseek',
            ].map(ns => ({
              ns,
              schema: { type: 'object' },
              value: {},
              applies: 'live',
              secrets: [],
              revision: 1,
            })),
          ],
        },
      },
    })
  })

  it('reduces the model catalog to the routed provider’s one platform model', async () => {
    /* Two providers answer to the platform's model id — the production shape
       (an Anthropic-protocol provider and the OpenAI-protocol pool route) — and
       the Session routes through the SECOND one. Keeping the first would leave
       the picker unable to resolve the live selection, and it would fall back to
       printing `provider/model` at the reader. */
    const catalog = () => ({
      default: { provider: 'physicsos-pool', model: 'deepseek-v4.1-flash' },
      routableProviders: ['deepseek-official', 'physicsos-pool'],
      groups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            {
              id: 'deepseek-v4.1-flash',
              name: 'DeepSeek-V4.1-Flash',
              reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
            },
            {
              id: 'deepseek-v4-pro',
              name: 'DeepSeek-V4-Pro',
              description: 'Stronger agentic coding.',
              reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
            },
          ],
        },
        {
          id: 'physicsos-pool',
          name: '平台公益模型',
          models: [{
            id: 'deepseek-v4.1-flash',
            name: '平台公益模型',
            reasoning: {
              efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }],
              defaultEffort: 'off',
            },
          }],
        },
      ],
      failures: [{ id: 'llm-pi-ai', name: 'Pi', message: 'unreachable' }],
    })

    const studentResponse = await makePolicy().policy.wrapFetch(async () => rpc(catalog()))(
      request('session.modelCatalog'),
    )
    /* The routed provider and model id survive untouched — the client submits
       them — under the product's own group and model name. */
    const reduced = {
      default: { provider: 'physicsos-pool', model: 'deepseek-v4.1-flash' },
      routableProviders: ['physicsos-pool'],
      groups: [{
        id: 'physicsos-pool',
        name: 'PhysicsOS',
        models: [{
          id: 'deepseek-v4.1-flash',
          name: '平台公益模型',
          reasoning: {
            efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }],
            defaultEffort: 'off',
          },
        }],
      }],
      failures: [],
    }
    expect(await rpcValueOf(studentResponse)).toEqual(reduced)

    /* The same reduction for an administrator: the model seat is a product
       surface, and the pool is managed on the surfaces that name it. */
    const adminResponse = await makePolicy({ actor: admin }).policy.wrapFetch(async () => rpc(catalog()))(
      request('session.modelCatalog', {}, 'admin'),
    )
    expect(await rpcValueOf(adminResponse)).toEqual(reduced)
  })

  it('answers an envelope when the Host throws, keeping a contention refusal actionable', async () => {
    /* The front door must never leave the web server's bare 400: it carries no
       rpcId, no code, and no reason, so every caller reads it as a dead
       transport. A contention throw keeps the code the client's blank-Session
       reuse is built to handle. */
    const policy = makePolicy().policy
    const contended = await policy.wrapFetch(async () => {
      throw new Error('SessionAlreadyOwnedError: session is already owned by a live writer')
    })(request('session.create', { args: { request: { workspaceId: 'ws-1' } } }))
    expect(await contended.json()).toMatchObject({
      result: { ok: false, error: { code: 'session/writer-held' } },
    })

    /* A blank the Host no longer holds is the same instruction to the client:
       replace it. The reuse scans the client's own list, so this arrives as a
       throw rather than as a business envelope. */
    const stale = await policy.wrapFetch(async () => {
      throw new Error('session "session-gone" not found')
    })(request('session.create', { args: { request: { workspaceId: 'ws-1', sessionId: 'session-gone' } } }))
    expect(await stale.json()).toMatchObject({
      result: { ok: false, error: { code: 'session/writer-held' } },
    })

    const broken = await policy.wrapFetch(async () => {
      throw new Error('boom')
    })(request('session.create', { args: { request: { workspaceId: 'ws-1' } } }))
    const brokenBody = await broken.json() as {
      result?: { error?: { code?: string; message?: string } }
    }
    expect(brokenBody.result?.error?.code).toBe('gateway/internal')
    expect(brokenBody.result?.error?.message).toContain('boom')
  })

  it('keeps the full settings description for an admin', async () => {
    const value = {
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'llm-deepseek',
        schema: { secret: true },
        value: { apiKey: 'stored' },
        applies: 'live' as const,
        secrets: [{ path: ['apiKey'], set: true }],
        revision: 7,
      }],
    }
    const response = await makePolicy({ actor: admin }).policy.wrapFetch(async () => rpc(value))(
      request('settings.describe', {}, 'admin'),
    )
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'policy-test',
      result: { ok: true, value },
    })
  })

  it('refuses an anonymous onboarding mutation before dispatch', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy({ actor: null })
    const response = await policy.wrapFetch(next)(request('settings.mutate', {
      ns: 'ui-onboarding',
      ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }],
    }, 'student'))
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

  it('dispatches a session method that names no session, for a student', async () => {
    /* The model catalog and the other read-only descriptors carry no sessionId
       at all. Requiring an owned session for them refused every
       non-administrator, which is what closed the model picker. */
    const next = vi.fn(async () => rpc({ models: [] }))
    const { policy } = makePolicy()
    const response = await policy.wrapFetch(next)(request('session.modelCatalog', {}))
    expect(next).toHaveBeenCalledOnce()
    expect(await response.json()).toMatchObject({ result: { ok: true } })
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
    // A caller-supplied cwd, workspaceId, agentPreset and sessionId are all
    // rewritten: the account workspace and the PhysicsOS student preset are
    // server-side facts, never request parameters.
    const response = await policy.wrapFetch(next)(request('session.create', {
      agentPreset: 'standard',
      workspaceId: 'foreign-workspace',
      sessionId: 'client-chosen-session',
      cwd: '/etc',
    }))
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { sessionId: 'new-session' } },
    })
    expect(next).toHaveBeenCalledTimes(1)
    expect(store.claims).toEqual(['workspace:workspace-student', 'session:new-session'])
  })

  it('opens an administrator’s Session in the product preset too', async () => {
    const { policy } = makePolicy({ actor: admin })
    /* The operator's workspace stays their own — only the preset is defaulted —
       so their own testing session behaves like a student's. */
    const next = vi.fn(async (_request: Request) => rpc({ sessionId: 'admin-session', agentPreset: 'physics-student' }))
    const response = await policy.wrapFetch(next)(request('session.create', {
      args: { request: { workspaceId: 'ops-workspace' } },
    }, 'admin'))
    const [forwarded] = next.mock.calls[0] as [Request]
    const body = await forwarded.clone().json() as { payload?: { args?: { request?: Record<string, unknown> } } }
    expect(body.payload?.args?.request).toMatchObject({
      workspaceId: 'ops-workspace',
      agentPreset: 'physics-student',
    })
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { sessionId: 'admin-session' } },
    })
  })

  it('leaves the preset alone when an administrator reuses a Session', async () => {
    const { policy } = makePolicy({ actor: admin })
    /* Reuse is how 「打开工作区」 resumes the blank Session the shell picked:
       `create` cannot change an existing Session's preset, and forcing one is
       what made every reuse fail with `agent-preset/conflict`. */
    /* The client seeds its request with the currently selected preset; the
       policy strips it because `create` cannot change a live Session's. */
    const next = vi.fn(async (_request: Request) => rpc({ sessionId: 'reused-session' }))
    const response = await policy.wrapFetch(next)(request('session.create', {
      args: { request: { workspaceId: 'ops-workspace', sessionId: 'reused-session', agentPreset: 'physics-student' } },
    }, 'admin'))
    const [forwarded] = next.mock.calls[0] as [Request]
    const body = await forwarded.clone().json() as { payload?: { args?: { request?: Record<string, unknown> } } }
    expect(body.payload?.args?.request).toEqual({
      workspaceId: 'ops-workspace',
      sessionId: 'reused-session',
    })
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { sessionId: 'reused-session' } },
    })
  })

  it('scopes an upgraded connection to the workspaces its account owns', () => {
    const owned = makeStore({ workspace: ['workspace-student'], session: ['session-student'] })
    const { policy } = makePolicy({ actor: admin, store: owned })
    const admission = policy.admitUpgrade({ headers: {} } as never)
    /* The operator is a user of the product picker too: the workspace scope is
       ownership-based for every role, while remote events stay unscoped so
       approvals keep flowing. */
    expect(admission?.remoteEventAdmission).toBeUndefined()
    expect(admission?.workspaceAdmission?.ownsWorkspace('workspace-student')).toBe(true)
    expect(admission?.workspaceAdmission?.ownsWorkspace('foreign')).toBe(false)

    const face = makePolicy({ store: owned }).policy.admitUpgrade({ headers: {} } as never)
    expect(face?.remoteEventAdmission).toBeTypeOf('function')
    expect(face?.remoteEventAdmission?.('x', [])).toBe(false)
    expect(face?.workspaceAdmission?.ownsSession('session-student')).toBe(true)
    expect(face?.workspaceAdmission?.ownsSession('session-other')).toBe(false)
  })

  it('answers workspace.initializeDefault with the account workspace', async () => {
    const { policy, store } = makePolicy()
    const next = vi.fn(async (_request: Request) => rpc({
      workspace: { workspaceId: 'shared-default', title: 'default' },
    }))
    const response = await policy.wrapFetch(next)(request('workspace.initializeDefault', {}))
    expect(await response.json()).toMatchObject({
      result: { ok: true, value: { workspace: { workspaceId: workspace.id, title: workspace.title } } },
    })
    expect(store.claims).toEqual([`workspace:${workspace.id}`])
  })

  it('refuses the response when the enforced preset did not survive the rewrite', async () => {
    const { policy } = makePolicy()
    // The host answers with the deployment default: the rewritten request never
    // reached it. Accepting this would claim a standard-preset session as the
    // student's own, so the policy answers with a stable code instead.
    const next = vi.fn(async () => rpc({ sessionId: 'raw-session', agentPreset: 'standard' }))
    const response = await policy.wrapFetch(next)(request('session.create', {
      agentPreset: 'standard',
      cwd: '/etc',
    }))
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'session-scope-mismatch',
          details: { expectedPreset: 'physics-student', actualPreset: 'standard' },
        },
      },
    })
    expect(JSON.stringify(body)).toContain('会话未按账号隔离创建')
  })

  it('returns the account workspace instead of accepting a caller path', async () => {
    const next = vi.fn(async () => rpc({ created: true, workspace: {} }))
    const { policy, store } = makePolicy()
    const response = await policy.wrapFetch(next)(request('workspace.create', { path: '/etc' }))
    expect(next).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: {
          created: false,
          workspace: {
            workspaceId: 'workspace-student',
            path: workspace.path,
            title: '我的工作区',
          },
        },
      },
    })
    expect(store.claims).toEqual(['workspace:workspace-student'])
  })

  it('creates a separately named account workspace from the product virtual path', async () => {
    const next = vi.fn(async () => rpc({ created: true, workspace: {} }))
    const ensureWorkspace = vi.fn(async (_actor: ApiPolicyActor, title?: string) => ({
      id: 'workspace-mechanics',
      path: '/srv/physicsos-users/student-mechanics',
      title: title ?? '我的工作区',
    }))
    const { policy, store } = makePolicy({ ensureWorkspace })
    const title = '高一物理 · 力学'
    const response = await policy.wrapFetch(next)(request('workspace.create', {
      path: `physicsos-workspace://${encodeURIComponent(title)}`,
    }))

    expect(next).not.toHaveBeenCalled()
    expect(ensureWorkspace).toHaveBeenCalledWith(student, title)
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: {
          workspace: {
            workspaceId: 'workspace-mechanics',
            title,
          },
        },
      },
    })
    expect(store.claims).toEqual(['workspace:workspace-mechanics'])
  })

  it('refuses a malformed virtual workspace title before creating anything', async () => {
    const next = vi.fn(async () => rpc({}))
    const ensureWorkspace = vi.fn(async () => workspace)
    const { policy } = makePolicy({ ensureWorkspace })
    const response = await policy.wrapFetch(next)(request('workspace.create', {
      path: 'physicsos-workspace://%00',
    }))

    expect(next).not.toHaveBeenCalled()
    expect(ensureWorkspace).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      result: {
        ok: false,
        error: { code: 'workspace-title-invalid' },
      },
    })
  })

  it('refuses all server filesystem browsing methods for a student with 403', async () => {
    const next = vi.fn(async () => rpc({}))
    const { policy } = makePolicy()
    for (const method of ['host.listDirectory', 'host.pickDirectory', 'host.createDirectory']) {
      const response = await policy.wrapFetch(next)(request(method, { path: '/etc' }))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        result: {
          ok: false,
          error: { code: 'HOST_FILESYSTEM_DENIED', details: { method } },
        },
      })
    }
    expect(next).not.toHaveBeenCalled()
  })

  it('refuses all server filesystem browsing methods for an admin unless the deployment opts in', async () => {
    const next = vi.fn(async () => rpc({ entries: [] }))
    const { policy } = makePolicy({ actor: admin })
    for (const method of ['host.listDirectory', 'host.pickDirectory', 'host.createDirectory']) {
      const denied = await policy.wrapFetch(next)(request(method, {}, 'admin'))
      expect(denied.status).toBe(403)
    }
    expect(next).not.toHaveBeenCalled()

    const optedIn = makePolicy({ actor: admin, hostFilesystemAccess: 'admin' })
    const allowed = await optedIn.policy.wrapFetch(next)(request('host.pickDirectory', {}, 'admin'))
    expect(allowed.status).toBe(200)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('refuses a workspace rename that targets another account', async () => {
    const next = vi.fn(async () => rpc({ workspace: {} }))
    const { policy } = makePolicy({ store: makeStore({ workspace: ['workspace-student'] }) })
    const response = await policy.wrapFetch(next)(request('workspace.rename', {
      workspaceId: 'workspace-other',
      title: '别人的工作区',
    }))
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'workspace-not-found' } },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('refuses an admin workspace rename that targets another account', async () => {
    const next = vi.fn(async () => rpc({ workspace: {} }))
    const { policy } = makePolicy({
      actor: admin,
      store: makeStore({ workspace: ['workspace-admin'] }),
    })
    const response = await policy.wrapFetch(next)(request('workspace.rename', {
      workspaceId: 'workspace-student',
      title: '越权改名',
    }, 'admin'))
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'workspace-not-found' } },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('forwards an owner workspace rename unchanged', async () => {
    const next = vi.fn(async (forwarded: Request) => {
      const body = await forwarded.clone().json() as { payload: Record<string, unknown> }
      expect(body.payload).toEqual({ workspaceId: 'workspace-student', title: '力学实验室' })
      return rpc({ workspace: { workspaceId: 'workspace-student', title: '力学实验室' } })
    })
    const { policy } = makePolicy({ store: makeStore({ workspace: ['workspace-student'] }) })
    const response = await policy.wrapFetch(next)(request('workspace.rename', {
      workspaceId: 'workspace-student',
      title: '力学实验室',
    }))
    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('lets an admin rename their own workspace and read the new title back', async () => {
    let title = '我的工作区'
    const adminWorkspace = {
      id: 'workspace-admin',
      path: '/srv/physicsos-users/admin',
      get title() {
        return title
      },
    }
    const next = vi.fn(async (forwarded: Request) => {
      const body = await forwarded.clone().json() as {
        method: string
        payload: { workspaceId?: string; title?: string }
      }
      if (body.method === 'workspace.rename') {
        expect(body.payload).toEqual({ workspaceId: adminWorkspace.id, title: '力学实验室' })
        title = body.payload.title ?? title
        return rpc({ workspace: { workspaceId: adminWorkspace.id, path: adminWorkspace.path, title } })
      }
      expect(body.method).toBe('workspace.list')
      return rpc({ items: [{ workspaceId: adminWorkspace.id, path: adminWorkspace.path, title }] })
    })
    const { policy } = makePolicy({
      actor: admin,
      store: makeStore({ workspace: [adminWorkspace.id] }),
      ensureWorkspace: async () => adminWorkspace,
    })
    const renamed = await policy.wrapFetch(next)(request('workspace.rename', {
      workspaceId: adminWorkspace.id,
      title: '力学实验室',
    }, 'admin'))
    expect(renamed.status).toBe(200)

    const listed = await policy.wrapFetch(next)(request('workspace.list', {}, 'admin'))
    expect(await listed.json()).toMatchObject({
      result: {
        ok: true,
        value: { items: [{ workspaceId: adminWorkspace.id, title: '力学实验室' }] },
      },
    })
  })

  it('creates an admin workspace through the server-managed path too', async () => {
    const next = vi.fn(async () => rpc({ workspace: {} }))
    const ensureWorkspace = vi.fn(async (_actor: ApiPolicyActor, title?: string) => ({
      id: 'workspace-admin-mechanics',
      path: '/srv/physicsos-users/admin-mechanics',
      title: title ?? '我的工作区',
    }))
    const { policy, store } = makePolicy({
      actor: admin,
      store: makeStore({ workspace: [] }),
      ensureWorkspace,
    })
    const response = await policy.wrapFetch(next)(request('workspace.create', {
      path: 'physicsos-workspace://%E5%8A%9B%E5%AD%A6',
    }, 'admin'))
    expect(next).not.toHaveBeenCalled()
    expect(ensureWorkspace).toHaveBeenCalledWith(admin, '力学')
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: { workspace: { workspaceId: 'workspace-admin-mechanics', title: '力学' } },
      },
    })
    expect(store.claims).toEqual(['workspace:workspace-admin-mechanics'])
  })

  it('gives an admin their own titled workspace while keeping the registry visible', async () => {
    const next = vi.fn(async () => rpc({
      items: [
        { workspaceId: 'workspace-student', path: '/srv/physicsos-users/student', title: '力学实验室' },
        { workspaceId: 'workspace-admin', path: '/srv/physicsos-users/deadbeef', title: 'deadbeef' },
      ],
      archivedSessionIds: ['foreign-session'],
    }))
    const { policy } = makePolicy({
      actor: admin,
      ensureWorkspace: async () => ({
        id: 'workspace-admin',
        path: '/srv/physicsos-users/deadbeef',
        title: '我的工作区',
      }),
    })
    const response = await policy.wrapFetch(next)(request('workspace.list', {}, 'admin'))
    expect(await response.json()).toMatchObject({
      result: {
        ok: true,
        value: {
          items: [
            { workspaceId: 'workspace-student', title: '力学实验室' },
            { workspaceId: 'workspace-admin', title: '我的工作区' },
          ],
        },
      },
    })
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
    const scoped =
      await delivered.policy.scopeEvents(request, events) as unknown as ScopedEvents
    const source = scoped.mux({ rpcId: 'test', payload: {} }, new AbortController().signal)
    const iterator = source[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ value: { rpcId: 'question-rpc' } })

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
    await iterator.return?.()
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
    const scoped = await policy.scopeEvents(request, events) as unknown as ScopedEvents

    expect((await collect(scoped.mux({ rpcId: 'test', payload: {} }, new AbortController().signal)))
      .map(frame => frame.rpcId))
      .toEqual(['mux-owned'])
    expect((await collect(scoped.host({ rpcId: 'test', payload: {} }, new AbortController().signal)))
      .map(frame => frame.rpcId))
      .toEqual(['host-session', 'host-workspace', 'host-order', 'host-archive'])
    expect((await collect(scoped.host({ rpcId: 'test', payload: {} }, new AbortController().signal)))[2]).toMatchObject({
      payload: { workspaceIds: ['owned-workspace'] },
    })
    expect((await collect(scoped.host({ rpcId: 'test', payload: {} }, new AbortController().signal)))[3]).toMatchObject({
      payload: { archivedSessionIds: ['owned-session'] },
    })
  })
})
