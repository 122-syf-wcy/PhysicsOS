/**
 * Authenticated, account-scoped policy for the shared Harness `/api` surface.
 *
 * The browser transport authenticates `/physicsos/*` itself, but `/api` predates
 * that account layer and exposes sessions, workspaces, provider metadata, and
 * agent controls. This module keeps the legacy transport intact while making
 * every remote call pass through one account boundary:
 *
 * - every request needs a live PhysicsOS session cookie;
 * - sessions and workspaces are owned by the account that created them;
 * - non-admin accounts only run the PhysicsOS student preset;
 * - students and teachers get a host-created private workspace instead of the
 *   caller choosing an arbitrary host path;
 * - list and history surfaces return only owned resources.
 *
 * The policy is deliberately transport-shaped: Connection wraps its complete
 * shared dispatcher with it, so both the Typert Gateway and the legacy API
 * Proxy are covered by construction.
 */

import type { IncomingMessage } from 'node:http'
import type {
  EventsApi, HostFrame, MuxFrame, RpcRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'

/** The account fields the API policy needs from auth-host. */
export interface ApiPolicyActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
}

/** Resource kinds whose ownership is persisted by the auth domain. */
export type ApiResourceKind = 'session' | 'workspace'

/** Ownership operations supplied by `AuthService`. */
export interface ApiPolicyStore {
  owns(actor: ApiPolicyActor, kind: ApiResourceKind, id: string): boolean
  ownedIds(actor: ApiPolicyActor, kind: ApiResourceKind): ReadonlySet<string>
  claim(actor: ApiPolicyActor, kind: ApiResourceKind, id: string): Promise<void>
  release(actor: ApiPolicyActor, kind: ApiResourceKind, id: string): Promise<void>
}

/** The one host-created workspace a non-admin account can use. */
export interface ApiPolicyWorkspace {
  readonly id: string
  readonly path: string
}

/** Host seams the pure policy needs. */
export interface ApiPolicyDeps {
  actorFromCookie(cookie: string | undefined): ApiPolicyActor | null
  actorFromRequest(req: IncomingMessage): ApiPolicyActor | null
  readonly store: ApiPolicyStore
  ensureWorkspace(actor: ApiPolicyActor): Promise<ApiPolicyWorkspace>
}

/** One request envelope before schema validation. */
interface ClientEnvelope {
  type?: unknown
  rpcId?: unknown
  method?: unknown
  payload?: unknown
}

interface ClientValue<T> {
  type: 'server-response'
  rpcId: string
  result: { ok: true; value: T } | {
    ok: false
    error: { code: string; message: string; details: Record<string, unknown> }
  }
}

type FetchLike = (request: Request) => Promise<Response>

interface JsonResponseBody {
  type?: unknown
  rpcId?: unknown
  result?: unknown
}

const STUDENT_PRESET = 'physics-student'

/** Remote methods that operate on host paths or the deployment configuration. */
const ADMIN_ONLY_METHODS = new Set([
  'host.pickDirectory',
  'host.listDirectory',
  'host.createDirectory',
  'host.openPath',
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEnvelope = (value: unknown): value is ClientEnvelope =>
  isRecord(value) && value['type'] === 'client-request'

const rpcIdOf = (body: ClientEnvelope): string =>
  typeof body.rpcId === 'string' ? body.rpcId : 'invalid-request'

const rpcError = (
  rpcId: string,
  code: string,
  message: string,
  details: Record<string, unknown>,
): Response => Response.json({
  type: 'server-response',
  rpcId,
  result: { ok: false, error: { code, message, details } },
} satisfies ClientValue<never>)

const rpcValue = (rpcId: string, value: unknown): Response => Response.json({
  type: 'server-response',
  rpcId,
  result: { ok: true, value },
} satisfies ClientValue<unknown>)

const bodyOf = async (response: Response): Promise<JsonResponseBody | undefined> => {
  const type = response.headers.get('content-type') ?? ''
  if (!type.toLowerCase().includes('application/json')) return undefined
  try {
    const value: unknown = await response.clone().json()
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

const responseWithBody = (response: Response, body: JsonResponseBody): Response =>
  new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

const valueOf = (body: JsonResponseBody): unknown => {
  const result = body.result
  if (!isRecord(result) || result['ok'] !== true) return undefined
  return result['value']
}

const denyNotFound = (rpcId: string, kind: 'session' | 'workspace', id: string): Response =>
  kind === 'session'
    ? rpcError(rpcId, 'session-not-found', `session "${id}" not found`, { sessionId: id })
    : rpcError(rpcId, 'workspace-not-found', `workspace "${id}" not found`, { workspaceId: id })

const sessionIdOf = (payload: Record<string, unknown>): string | undefined =>
  typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined

const workspaceIdOf = (payload: Record<string, unknown>): string | undefined =>
  typeof payload['workspaceId'] === 'string' ? payload['workspaceId'] : undefined

const resourceIdsIn = (
  value: unknown,
  sessions = new Set<string>(),
  workspaces = new Set<string>(),
): { sessions: Set<string>; workspaces: Set<string> } => {
  if (Array.isArray(value)) {
    for (const item of value) resourceIdsIn(item, sessions, workspaces)
  } else if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && (key === 'sessionId' || key === 'parentSessionId')) {
        sessions.add(nested)
      } else if (typeof nested === 'string' && key === 'workspaceId') {
        workspaces.add(nested)
      } else {
        resourceIdsIn(nested, sessions, workspaces)
      }
    }
  }
  return { sessions, workspaces }
}

const privateWorkspaceView = (workspace: ApiPolicyWorkspace): Record<string, unknown> => ({
  workspaceId: workspace.id,
  path: workspace.path,
  title: workspace.path.split('/').filter(Boolean).at(-1) ?? 'PhysicsOS',
  sessionIds: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
})

const hasSameAuthority = (origin: string, host: string): boolean => {
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

/**
 * Build the policy object Connection resolves as `apiPolicy`.
 * @param deps - cookie resolution, ownership storage, and private-workspace creation.
 * @returns the shared `/api` policy.
 */
export function createApiPolicy(deps: ApiPolicyDeps): {
  wrapFetch(next: FetchLike): FetchLike
  scopeEvents(req: IncomingMessage, events: EventsApi): Promise<EventsApi | undefined>
} {
  const pendingResponses = new Map<string, { expiresAt: number }>()
  const pendingResponseTtlMs = 15 * 60 * 1000
  const admin = (actor: ApiPolicyActor): boolean => actor.role === 'SUPER_ADMIN'
  const pendingKey = (actor: ApiPolicyActor, rpcId: string): string =>
    `${actor.userKey}\u0000${rpcId}`

  const prunePending = (now = Date.now()): void => {
    for (const [rpcId, pending] of pendingResponses) {
      if (pending.expiresAt <= now) pendingResponses.delete(rpcId)
    }
  }

  const consumePending = (actor: ApiPolicyActor, rpcId: string): boolean => {
    if (admin(actor)) return true
    prunePending()
    const key = pendingKey(actor, rpcId)
    const pending = pendingResponses.get(key)
    if (pending === undefined) return false
    pendingResponses.delete(key)
    return true
  }

  const authorizeMethod = (
    actor: ApiPolicyActor,
    method: string,
    payload: Record<string, unknown>,
    rpcId: string,
  ): Response | undefined => {
    if (ADMIN_ONLY_METHODS.has(method) && !admin(actor)) {
      return rpcError(rpcId, 'internal', 'this method is available only to platform administrators', {})
    }

    if (method === 'agentPreset.select') {
      const sessionId = sessionIdOf(payload)
      if (sessionId === undefined || (!admin(actor) && !deps.store.owns(actor, 'session', sessionId))) {
        return denyNotFound(rpcId, 'session', sessionId ?? '')
      }
      const preset = payload['agentPreset']
      if (!admin(actor) && preset !== STUDENT_PRESET) {
        return rpcError(rpcId, 'agent-preset-not-found', `agent preset "${String(preset)}" not found`, {
          agentPreset: String(preset),
          available: [STUDENT_PRESET],
        })
      }
      return undefined
    }

    const sessionScoped = method.startsWith('session.') || method.startsWith('goal.') || method === 'skill.list'
    if (sessionScoped && method !== 'session.create' && method !== 'session.list' && method !== 'session.search') {
      const sessionId = sessionIdOf(payload)
      if (sessionId === undefined || (!admin(actor) && !deps.store.owns(actor, 'session', sessionId))) {
        return denyNotFound(rpcId, 'session', sessionId ?? '')
      }
    }

    if (method.startsWith('subagent.')) {
      const parentSessionId = typeof payload['parentSessionId'] === 'string'
        ? payload['parentSessionId']
        : undefined
      if (parentSessionId === undefined
        || (!admin(actor) && !deps.store.owns(actor, 'session', parentSessionId))) {
        return denyNotFound(rpcId, 'session', parentSessionId ?? '')
      }
    }

    if (method === 'workspace.rename' || method === 'workspace.delete' || method === 'workspace.insertBefore') {
      const workspaceId = workspaceIdOf(payload)
      if (workspaceId === undefined || (!admin(actor) && !deps.store.owns(actor, 'workspace', workspaceId))) {
        return denyNotFound(rpcId, 'workspace', workspaceId ?? '')
      }
    }
    if (method === 'workspace.insertSessionBefore') {
      const workspaceId = workspaceIdOf(payload)
      const sessionId = sessionIdOf(payload)
      if (workspaceId === undefined || (!admin(actor) && !deps.store.owns(actor, 'workspace', workspaceId))) {
        return denyNotFound(rpcId, 'workspace', workspaceId ?? '')
      }
      if (sessionId === undefined || (!admin(actor) && !deps.store.owns(actor, 'session', sessionId))) {
        return denyNotFound(rpcId, 'session', sessionId ?? '')
      }
    }
    if (method === 'workspace.archiveSession') {
      const sessionId = sessionIdOf(payload)
      if (sessionId === undefined || (!admin(actor) && !deps.store.owns(actor, 'session', sessionId))) {
        return denyNotFound(rpcId, 'session', sessionId ?? '')
      }
    }

    if (!admin(actor) && method !== 'session.create' && method !== 'workspace.create') {
      const refs = resourceIdsIn(payload)
      for (const sessionId of refs.sessions) {
        if (!deps.store.owns(actor, 'session', sessionId)) {
          return denyNotFound(rpcId, 'session', sessionId)
        }
      }
      for (const workspaceId of refs.workspaces) {
        if (!deps.store.owns(actor, 'workspace', workspaceId)) {
          return denyNotFound(rpcId, 'workspace', workspaceId)
        }
      }
    }
    return undefined
  }

  const rewriteRequest = async (
    actor: ApiPolicyActor,
    request: Request,
    method: string,
    body: ClientEnvelope,
  ): Promise<{ request: Request; response?: Response }> => {
    const payload = isRecord(body.payload) ? { ...body.payload } : {}
    const rpcId = rpcIdOf(body)

    if (method === 'workspace.create' && !admin(actor)) {
      const workspace = await deps.ensureWorkspace(actor)
      await deps.store.claim(actor, 'workspace', workspace.id)
      return {
        request,
        response: rpcValue(rpcId, {
          created: false,
          workspace: privateWorkspaceView(workspace),
        }),
      }
    }

    if (method === 'session.create' && !admin(actor)) {
      const workspace = await deps.ensureWorkspace(actor)
      await deps.store.claim(actor, 'workspace', workspace.id)
      delete payload['cwd']
      delete payload['sessionId']
      payload['workspaceId'] = workspace.id
      payload['agentPreset'] = STUDENT_PRESET
    }

    if (method === 'session.create' || method === 'session.fork'
      || method === 'workspace.create' || method === 'workspace.delete') {
      const next = new Request(request.url, {
        method: request.method,
        headers: new Headers([...request.headers].filter(([name]) => name !== 'content-length')),
        body: JSON.stringify({ ...body, payload }),
        signal: request.signal,
      })
      return { request: next }
    }
    return { request }
  }

  const rewriteResponse = async (
    actor: ApiPolicyActor,
    method: string,
    body: ClientEnvelope,
    response: Response,
  ): Promise<Response> => {
    const parsed = await bodyOf(response)
    if (parsed === undefined) return response
    const payload = isRecord(body.payload) ? body.payload : {}
    const value = valueOf(parsed)
    if (!isRecord(value)) return response
    let changed = false

    if (method === 'session.list' && Array.isArray(value['items'])) {
      value['items'] = admin(actor) ? value['items'] : value['items'].filter(item =>
        isRecord(item) && typeof item['sessionId'] === 'string'
        && deps.store.owns(actor, 'session', item['sessionId']))
      changed = true
    }

    if (method === 'session.search' && Array.isArray(value['items'])) {
      value['items'] = admin(actor) ? value['items'] : value['items'].filter(item =>
        isRecord(item) && typeof item['sessionId'] === 'string'
        && deps.store.owns(actor, 'session', item['sessionId']))
      changed = true
    }

    if (method === 'workspace.list') {
      const workspace = admin(actor) ? undefined : await deps.ensureWorkspace(actor)
      if (workspace !== undefined) {
        await deps.store.claim(actor, 'workspace', workspace.id)
        const items = Array.isArray(value['items']) ? value['items'] : []
        const owned = items.filter(item =>
          isRecord(item) && typeof item['workspaceId'] === 'string'
          && deps.store.owns(actor, 'workspace', item['workspaceId']))
        if (!owned.some(item => isRecord(item) && item['workspaceId'] === workspace.id)) {
          owned.push(privateWorkspaceView(workspace))
        }
        value['items'] = owned
        if (Array.isArray(value['archivedSessionIds'])) {
          value['archivedSessionIds'] = value['archivedSessionIds'].filter(id =>
            typeof id === 'string' && deps.store.owns(actor, 'session', id))
        }
        changed = true
      }
    }

    if (method === 'agentPreset.list' && Array.isArray(value['presets']) && !admin(actor)) {
      value['presets'] = value['presets'].filter(preset =>
        isRecord(preset) && preset['id'] === STUDENT_PRESET)
      changed = true
    }

    if (method === 'host.describe' && !admin(actor)) {
      const workspace = await deps.ensureWorkspace(actor)
      await deps.store.claim(actor, 'workspace', workspace.id)
      value['cwd'] = workspace.path
      value['attachedSessions'] = deps.store.ownedIds(actor, 'session').size
      changed = true
    }

    if (method === 'session.create' || method === 'session.fork') {
      const sessionId = typeof value['sessionId'] === 'string' ? value['sessionId'] : undefined
      if (sessionId !== undefined) await deps.store.claim(actor, 'session', sessionId)
    }
    if (method === 'workspace.create') {
      const workspace = isRecord(value['workspace']) ? value['workspace'] : undefined
      const workspaceId = workspace !== undefined && typeof workspace['workspaceId'] === 'string'
        ? workspace['workspaceId']
        : undefined
      if (workspaceId !== undefined) await deps.store.claim(actor, 'workspace', workspaceId)
    }
    if (method === 'workspace.delete') {
      const workspaceId = workspaceIdOf(payload)
      if (workspaceId !== undefined) await deps.store.release(actor, 'workspace', workspaceId)
    }
    if (method === 'subagent.list' && Array.isArray(value['entries'])) {
      const parentSessionId = typeof payload['parentSessionId'] === 'string' ? payload['parentSessionId'] : undefined
      if (parentSessionId !== undefined) {
        for (const entry of value['entries']) {
          if (isRecord(entry) && typeof entry['id'] === 'string') {
            await deps.store.claim(actor, 'session', entry['id'])
          }
        }
      }
    }

    return changed ? responseWithBody(response, { ...parsed, result: { ok: true, value } }) : response
  }

  return {
    wrapFetch: next => async (request) => {
      const cookie = request.headers.get('cookie') ?? undefined
      const actor = deps.actorFromCookie(cookie)
      if (actor === null) {
        return Response.json({ error: 'unauthenticated' }, { status: 401 })
      }

      const url = new URL(request.url)
      const method = url.pathname.startsWith('/api/') ? url.pathname.slice('/api/'.length) : ''
      if (request.method === 'POST') {
        const origin = request.headers.get('origin')
        const host = request.headers.get('host')
        if (origin !== null && (host === null || !hasSameAuthority(origin, host))) {
          return new Response('forbidden', { status: 403 })
        }
        const site = request.headers.get('sec-fetch-site')
        if (site === 'cross-site') return new Response('forbidden', { status: 403 })
      }

      if (method === 'session.export') {
        const sessionId = url.searchParams.get('sessionId') ?? ''
        return admin(actor) || deps.store.owns(actor, 'session', sessionId)
          ? next(request)
          : denyNotFound('session-export', 'session', sessionId)
      }

      if (method === 'respond') {
        let rpcId: string | undefined
        try {
          const raw: unknown = await request.clone().json()
          if (isRecord(raw) && typeof raw['rpcId'] === 'string') rpcId = raw['rpcId']
        } catch {
          // The downstream carrier owns malformed-body diagnostics.
        }
        return rpcId !== undefined && consumePending(actor, rpcId)
          ? next(request)
          : new Response('forbidden', { status: 403 })
      }

      let body: ClientEnvelope | undefined
      if (request.method === 'POST') {
        try {
          const raw: unknown = await request.clone().json()
          if (isEnvelope(raw)) body = raw
        } catch {
          return next(request)
        }
      }
      if (body === undefined) return next(request)
      const rpcId = rpcIdOf(body)
      const payload = isRecord(body.payload) ? body.payload : {}

      const denied = authorizeMethod(actor, method, payload, rpcId)
      if (denied !== undefined) return denied

      const rewritten = await rewriteRequest(actor, request, method, body)
      if (rewritten.response !== undefined) return rewritten.response
      const response = await next(rewritten.request)
      return rewriteResponse(actor, method, body, response)
    },
    scopeEvents: (req, events) => {
      const actor = deps.actorFromRequest(req)
      if (actor === null) return Promise.resolve(undefined)
      if (admin(actor)) return Promise.resolve(events)
      const ownsSession = (id: string): boolean => deps.store.owns(actor, 'session', id)
      const ownsWorkspace = (id: string): boolean => deps.store.owns(actor, 'workspace', id)

      const mapFrames = async function* <T>(
        source: AsyncIterable<RpcRequest<T>>,
        map: (frame: RpcRequest<T>) => RpcRequest<T> | undefined,
      ): AsyncIterable<RpcRequest<T>> {
        for await (const frame of source) {
          const mapped = map(frame)
          if (mapped !== undefined) yield mapped
        }
      }

      return Promise.resolve({
        mux: async function * (request, signal) {
          for await (const frame of events.mux(request, signal)) {
            const payload: MuxFrame = frame.payload
            if (payload.type === 'stream/error') {
              yield frame
              continue
            }
            if (!ownsSession(payload.sessionId)) continue
            if (payload.type === 'question/requested' || payload.type === 'approval/requested') {
              pendingResponses.set(pendingKey(actor, frame.rpcId), {
                expiresAt: Date.now() + pendingResponseTtlMs,
              })
            }
            if (payload.type === 'question/resolved') {
              pendingResponses.delete(pendingKey(actor, payload.questionRpcId))
            }
            yield frame
          }
        },
        host: (request, signal) => mapFrames(events.host(request, signal), (frame) => {
          const payload: HostFrame = frame.payload
          switch (payload.type) {
            case 'stream/error':
              return frame
            case 'host/session-added':
            case 'host/session-removed':
            case 'host/session-status':
            case 'host/agent-error':
              return ownsSession(payload.sessionId) ? frame : undefined
            case 'host/workspace-changed':
              return ownsWorkspace(payload.workspace.workspaceId) ? frame : undefined
            case 'host/workspace-removed':
              return ownsWorkspace(payload.workspaceId) ? frame : undefined
            case 'host/workspace-order-changed': {
              const workspaceIds = payload.workspaceIds.filter(ownsWorkspace)
              return workspaceIds.length === 0
                ? undefined
                : { ...frame, payload: { ...payload, workspaceIds } }
            }
            case 'host/archived-sessions-changed': {
              const archivedSessionIds = payload.archivedSessionIds.filter(ownsSession)
              return archivedSessionIds.length === 0
                ? undefined
                : { ...frame, payload: { ...payload, archivedSessionIds } }
            }
            case 'host/remote-event':
              return undefined
          }
        }),
      })
    },
  }
}
