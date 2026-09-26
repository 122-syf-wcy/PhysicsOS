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
  /** Present for personal-token requests; absent actors are treated as sessions. */
  readonly credential?:
    | { readonly kind: 'session' }
    | { readonly kind: 'api-token'; readonly tokenId: string; readonly scope: 'read' | 'write' }
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
  /** Human-readable display title; defaults to {@link DEFAULT_WORKSPACE_TITLE}. */
  readonly title: string
}

/** Fixed-window policy passed through the existing auth limiter seam. */
export interface ApiPolicyRateLimitPolicy {
  readonly name: string
  readonly limit: number
  readonly windowMs: number
  readonly maxBuckets: number
}

/** Atomic rate-limit backend accepted by the `/api` policy. */
export interface ApiPolicyLimiterBackend {
  readonly kind: string
  consume(
    policy: ApiPolicyRateLimitPolicy,
    key: string,
    now?: number,
  ): boolean | Promise<boolean>
}

/** One reservation in the shared one-time response ledger. */
export interface ApiPolicyOnceClaim {
  readonly status: 'claimed' | 'already-claimed'
  readonly expiresAt: number
}

/** Structural subset of the shared-state once ledger used by the `/api` policy. */
export interface ApiPolicyOnceLedger {
  readonly kind: string
  claim(
    key: string,
    ttlSeconds: number,
    now?: number,
  ): ApiPolicyOnceClaim | Promise<ApiPolicyOnceClaim>
  consume(key: string, now?: number): boolean | Promise<boolean>
  release(key: string, now?: number): void | Promise<void>
}

/** Optional per-account model budget overrides. */
export interface ApiPolicyModelBudget {
  readonly limit: number
  readonly windowMs: number
  readonly maxBuckets: number
}

/** Host seams the pure policy needs. */
export interface ApiPolicyDeps {
  actorFromCookie(cookie: string | undefined, authorization?: string): ApiPolicyActor | null
  actorFromRequest(req: IncomingMessage): ApiPolicyActor | null
  readonly store: ApiPolicyStore
  ensureWorkspace(actor: ApiPolicyActor, title?: string): Promise<ApiPolicyWorkspace>
  /**
   * Server-filesystem browsing (`host.listDirectory` / `pickDirectory` /
   * `createDirectory`). `deny` (the default) refuses every role — a hosted
   * deployment must not expose the container's filesystem, and account
   * workspaces are assigned by the server, so no client needs to browse.
   * `admin` keeps the capability for trusted single-user installations.
   */
  readonly hostFilesystemAccess?: 'deny' | 'admin'
  readonly limiter?: ApiPolicyLimiterBackend
  readonly onceLedger?: ApiPolicyOnceLedger
  readonly modelPolicy?: Partial<ApiPolicyModelBudget>
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

/** Default display title for an account's private workspace. */
export const DEFAULT_WORKSPACE_TITLE = '我的工作区'
/** Maximum length of an account-owned workspace title. */
export const MAX_WORKSPACE_TITLE_LENGTH = 80
const WORKSPACE_PATH_PREFIX = 'physicsos-workspace://'

/**
 * Decode the virtual path the client uses to ask for a NAMED account
 * workspace. The browser never gets to name a filesystem path: only the title
 * crosses this seam, and auth-host chooses and creates the directory itself.
 * `undefined` means "the default managed workspace", `null` means a malformed
 * title that must be refused.
 */
export const workspaceTitleFromPath = (value: unknown): string | null | undefined => {
  if (typeof value !== 'string' || !value.startsWith(WORKSPACE_PATH_PREFIX)) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(value.slice(WORKSPACE_PATH_PREFIX.length))
  } catch {
    return null
  }
  const title = decoded.trim()
  if (
    title === ''
    || title.length > MAX_WORKSPACE_TITLE_LENGTH
    || /[\u0000-\u001f\u007f]/.test(title)
  ) {
    return null
  }
  return title
}

/**
 * Methods that browse or create directories on the HOST the harness runs in.
 * They are refused for every role unless the deployment opts in, because a
 * hosted deployment's host is the server, not the user's machine.
 */
const HOST_FILESYSTEM_METHODS = new Set([
  'host.listDirectory',
  'host.pickDirectory',
  'host.createDirectory',
])

/** Cordis service key for the shared one-time response ledger, when composed. */
export const ONCE_LEDGER_SERVICE = 'physicsosOnceLedger'

/** Default per-account model budget for the open-registration beta. */
export const DEFAULT_MODEL_ATTEMPT_LIMIT = 60
export const DEFAULT_MODEL_ATTEMPT_WINDOW_MS = 10 * 60 * 1000

const MODEL_POLICY_NAME = 'model'
const MODEL_BUDGET_EXCEEDED = 'MODEL_BUDGET_EXCEEDED'
const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE'
const PENDING_RESPONSE_TTL_MS = 15 * 60 * 1000
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'
const ONBOARDING_ACK_FIELD = 'welcomeNoticeVersion'

/** Methods that can start or continue an agent turn and therefore spend model budget. */
const MODEL_CONSUMING_METHODS = new Set([
  'session.create',
  'session.prompt',
  'subagent.prompt',
  'goal.create',
  'goal.resume',
])

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

/** Methods a read-scoped personal token may call. */
const READ_ONLY_METHODS = new Set([
  'agentPreset.list',
  'credentials.describe',
  'host.describe',
  'session.export',
  'session.list',
  'session.search',
  'settings.describe',
  'workspace.list',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOnboardingMutation = (payload: Record<string, unknown>): boolean => {
  if (payload['ns'] !== ONBOARDING_SETTINGS_NAMESPACE || !Array.isArray(payload['ops'])) return false
  return payload['ops'].every((operation) => {
    if (!isRecord(operation)) return false
    const path = operation['path']
    if (!Array.isArray(path) || path.length !== 1 || path[0] !== ONBOARDING_ACK_FIELD) return false
    return operation['op'] === 'set' || operation['op'] === 'unset'
  })
}

const isEnvelope = (value: unknown): value is ClientEnvelope =>
  isRecord(value) && value['type'] === 'client-request'

const rpcIdOf = (body: ClientEnvelope): string =>
  typeof body.rpcId === 'string' ? body.rpcId : 'invalid-request'

const rpcError = (
  rpcId: string,
  code: string,
  message: string,
  details: Record<string, unknown>,
  status = 200,
): Response => Response.json({
  type: 'server-response',
  rpcId,
  result: { ok: false, error: { code, message, details } },
} satisfies ClientValue<never>, { status })

const dependencyUnavailable = (message: string): Response => Response.json({
  error: { code: DEPENDENCY_UNAVAILABLE, message },
}, { status: 503 })

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
  title: workspace.title,
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
 * Validate the optional shared one-time ledger service before policy boot.
 * @param value - Cordis service value, when composed.
 * @returns the validated ledger, or undefined in single-process mode.
 */
export function asOnceLedger(value: unknown): ApiPolicyOnceLedger | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${ONCE_LEDGER_SERVICE} must be an object`)
  }
  const candidate = value as Partial<ApiPolicyOnceLedger>
  if (typeof candidate.kind !== 'string' || candidate.kind.trim() === '') {
    throw new Error(`${ONCE_LEDGER_SERVICE}.kind must be a non-empty string`)
  }
  if (typeof candidate.claim !== 'function') {
    throw new Error(`${ONCE_LEDGER_SERVICE}.claim must be a function`)
  }
  if (typeof candidate.consume !== 'function') {
    throw new Error(`${ONCE_LEDGER_SERVICE}.consume must be a function`)
  }
  if (typeof candidate.release !== 'function') {
    throw new Error(`${ONCE_LEDGER_SERVICE}.release must be a function`)
  }
  return candidate as ApiPolicyOnceLedger
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
  const approvalResponseKeys = new Map<string, string>()
  const admin = (actor: ApiPolicyActor): boolean => actor.role === 'SUPER_ADMIN'
  const pendingKey = (actor: ApiPolicyActor, rpcId: string): string =>
    `${actor.userKey}\u0000${rpcId}`
  const approvalKey = (actor: ApiPolicyActor, approvalId: string): string =>
    `${actor.userKey}\u0000${approvalId}`
  const modelPolicy: ApiPolicyRateLimitPolicy = {
    name: MODEL_POLICY_NAME,
    limit: deps.modelPolicy?.limit ?? DEFAULT_MODEL_ATTEMPT_LIMIT,
    windowMs: deps.modelPolicy?.windowMs ?? DEFAULT_MODEL_ATTEMPT_WINDOW_MS,
    maxBuckets: deps.modelPolicy?.maxBuckets ?? 10_000,
  }
  const memoryBudgetBuckets = new Map<string, { count: number; resetAt: number }>()

  const prunePending = (now = Date.now()): void => {
    for (const [rpcId, pending] of pendingResponses) {
      if (pending.expiresAt <= now) pendingResponses.delete(rpcId)
    }
  }

  const pruneModelBudget = (now: number): void => {
    for (const [key, bucket] of memoryBudgetBuckets) {
      if (bucket.resetAt <= now) memoryBudgetBuckets.delete(key)
    }
  }

  const consumeMemoryModelBudget = (key: string, now = Date.now()): boolean => {
    pruneModelBudget(now)
    const existing = memoryBudgetBuckets.get(key)
    if (existing === undefined) {
      if (memoryBudgetBuckets.size >= modelPolicy.maxBuckets) return false
      memoryBudgetBuckets.set(key, { count: 1, resetAt: now + modelPolicy.windowMs })
      return modelPolicy.limit >= 1
    }
    existing.count += 1
    return existing.count <= modelPolicy.limit
  }

  const chargeModelBudget = async (
    actor: ApiPolicyActor,
    method: string,
    rpcId: string,
  ): Promise<Response | undefined> => {
    // Platform operators stay exempt so a depleted beta budget can never lock
    // them out of incident response or deployment administration.
    if (admin(actor) || !MODEL_CONSUMING_METHODS.has(method)) return undefined
    try {
      const allowed = deps.limiter === undefined
        ? consumeMemoryModelBudget(actor.userKey)
        : await deps.limiter.consume(modelPolicy, actor.userKey)
      if (allowed) return undefined
      return rpcError(
        rpcId,
        MODEL_BUDGET_EXCEEDED,
        '模型调用额度已用完，请稍后再试',
        { limit: modelPolicy.limit, windowMs: modelPolicy.windowMs },
        429,
      )
    } catch {
      return rpcError(
        rpcId,
        DEPENDENCY_UNAVAILABLE,
        '模型调用额度服务暂时不可用，请稍后再试',
        {},
        503,
      )
    }
  }

  const claimPending = async (actor: ApiPolicyActor, rpcId: string): Promise<string> => {
    const key = pendingKey(actor, rpcId)
    if (deps.onceLedger === undefined) {
      prunePending()
      if (!pendingResponses.has(key)) {
        pendingResponses.set(key, { expiresAt: Date.now() + PENDING_RESPONSE_TTL_MS })
      }
      return key
    }
    const claim = await deps.onceLedger.claim(key, PENDING_RESPONSE_TTL_MS / 1_000)
    pendingResponses.set(key, { expiresAt: claim.expiresAt })
    return key
  }

  const releasePendingKey = async (key: string): Promise<void> => {
    pendingResponses.delete(key)
    await deps.onceLedger?.release(key)
  }

  const consumePending = async (
    actor: ApiPolicyActor,
    rpcId: string,
  ): Promise<'accepted' | 'missing' | 'unavailable'> => {
    if (admin(actor)) return 'accepted'
    const key = pendingKey(actor, rpcId)
    if (deps.onceLedger !== undefined) {
      try {
        return await deps.onceLedger.consume(key) ? 'accepted' : 'missing'
      } catch {
        return 'unavailable'
      }
    }
    prunePending()
    const pending = pendingResponses.get(key)
    if (pending === undefined) return 'missing'
    pendingResponses.delete(key)
    return 'accepted'
  }

  const authorizeMethod = (
    actor: ApiPolicyActor,
    method: string,
    payload: Record<string, unknown>,
    rpcId: string,
  ): Response | undefined => {
    if (HOST_FILESYSTEM_METHODS.has(method)
      && (deps.hostFilesystemAccess !== 'admin' || !admin(actor))) {
      return rpcError(
        rpcId,
        'HOST_FILESYSTEM_DENIED',
        '该部署不允许浏览服务器文件系统；工作区由账号自动分配',
        { method },
        403,
      )
    }

    const allowedNonAdminSettingsMethod =
      method === 'settings.describe' ||
      (method === 'settings.mutate' && isOnboardingMutation(payload))
    if (ADMIN_ONLY_METHODS.has(method) && !admin(actor) && !allowedNonAdminSettingsMethod) {
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
      if (workspaceId === undefined || !deps.store.owns(actor, 'workspace', workspaceId)) {
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

    if (method === 'workspace.create') {
      const requestedTitle = workspaceTitleFromPath(payload['path'])
      if (requestedTitle === null) {
        return {
          request,
          response: rpcError(
            rpcId,
            'workspace-title-invalid',
            `workspace title must be 1-${String(MAX_WORKSPACE_TITLE_LENGTH)} printable characters`,
            {},
          ),
        }
      }
      const workspace = await deps.ensureWorkspace(actor, requestedTitle)
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

    if (method === 'settings.describe' && !admin(actor)) {
      const namespaces = value['namespaces']
      value['namespaces'] = Array.isArray(namespaces)
        ? namespaces.filter(namespace =>
          isRecord(namespace) && namespace['ns'] === ONBOARDING_SETTINGS_NAMESPACE)
        : []
      changed = true
    }

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
      /* Every account owns at least one private workspace; named workspaces
         created through the product virtual path are already in the registry
         and remain visible only to their owner. The platform operator sees
         the full registry for troubleshooting. */
      const workspace = await deps.ensureWorkspace(actor)
      await deps.store.claim(actor, 'workspace', workspace.id)
      const items = Array.isArray(value['items']) ? value['items'] : []
      const visible = admin(actor)
        ? items.filter(item => isRecord(item))
        : items.filter(item =>
          isRecord(item) && typeof item['workspaceId'] === 'string'
          && deps.store.owns(actor, 'workspace', item['workspaceId']))
      /* The registry names a record after its directory basename; the account
         digest must never surface as the workspace's display title. */
      const digest = workspace.path.split('/').filter(Boolean).at(-1)
      for (const item of visible) {
        if (isRecord(item) && item['workspaceId'] === workspace.id
          && (typeof item['title'] !== 'string' || item['title'] === digest)) {
          item['title'] = workspace.title
        }
      }
      if (!visible.some(item => isRecord(item) && item['workspaceId'] === workspace.id)) {
        visible.push(privateWorkspaceView(workspace))
      }
      value['items'] = visible
      if (!admin(actor) && Array.isArray(value['archivedSessionIds'])) {
        value['archivedSessionIds'] = value['archivedSessionIds'].filter(id =>
          typeof id === 'string' && deps.store.owns(actor, 'session', id))
      }
      changed = true
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
      /* Fail closed if the enforced preset did not survive the request
         rewrite: a student session that came back composed as the deployment
         default means the rewritten request never reached the host. The
         session was already created upstream, so refusing the response is the
         only honest answer — claiming it for the account would hide a scope
         breach behind an apparently successful call. */
      const createdPreset = value['agentPreset']
      if (method === 'session.create' && !admin(actor)
        && createdPreset !== undefined && createdPreset !== STUDENT_PRESET) {
        const actualPreset = typeof createdPreset === 'string'
          ? createdPreset
          : JSON.stringify(createdPreset)
        return rpcError(
          rpcIdOf(body),
          'session-scope-mismatch',
          '会话未按账号隔离创建，已拒绝该响应，请稍后重试或联系管理员',
          { expectedPreset: STUDENT_PRESET, actualPreset },
        )
      }
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
      const authorization = request.headers.get('authorization') ?? undefined
      const actor = deps.actorFromCookie(cookie, authorization)
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
        if (rpcId === undefined) return new Response('forbidden', { status: 403 })
        const pending = await consumePending(actor, rpcId)
        if (pending === 'unavailable') {
          return dependencyUnavailable('一次性响应校验服务暂时不可用，请稍后再试')
        }
        return pending === 'accepted'
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
      if (actor.credential?.kind === 'api-token'
        && actor.credential.scope === 'read'
        && !READ_ONLY_METHODS.has(method)) {
        return rpcError(
          rpcId,
          'TOKEN_SCOPE_REQUIRED',
          '该令牌只有只读权限',
          { requiredScope: 'write' },
          403,
        )
      }

      const denied = authorizeMethod(actor, method, payload, rpcId)
      if (denied !== undefined) return denied

      const budgetDenied = await chargeModelBudget(actor, method, rpcId)
      if (budgetDenied !== undefined) return budgetDenied

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
          const claimedKeys = new Set<string>()
          try {
            for await (const frame of events.mux(request, signal)) {
              const payload: MuxFrame = frame.payload
              if (payload.type === 'stream/error') {
                yield frame
                continue
              }
              if (!ownsSession(payload.sessionId)) continue
              if (payload.type === 'question/requested' || payload.type === 'approval/requested') {
                const key = await claimPending(actor, frame.rpcId)
                claimedKeys.add(key)
                if (payload.type === 'approval/requested') {
                  approvalResponseKeys.set(approvalKey(actor, payload.approvalId), key)
                }
              }
              if (payload.type === 'question/resolved') {
                const key = pendingKey(actor, payload.questionRpcId)
                claimedKeys.delete(key)
                await releasePendingKey(key)
              }
              if (payload.type === 'approval/resolved') {
                const key = approvalResponseKeys.get(approvalKey(actor, payload.approvalId))
                if (key !== undefined) {
                  approvalResponseKeys.delete(approvalKey(actor, payload.approvalId))
                  claimedKeys.delete(key)
                  await releasePendingKey(key)
                }
              }
              yield frame
            }
          } finally {
            const released = new Set<string>()
            for (const key of claimedKeys) {
              await releasePendingKey(key)
              released.add(key)
            }
            for (const [key, pendingKeyValue] of approvalResponseKeys) {
              if (released.has(pendingKeyValue)) approvalResponseKeys.delete(key)
            }
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
