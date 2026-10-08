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

interface LegacyRpcRequest<T = unknown> {
  readonly rpcId: string
  readonly payload: T
}

interface LegacyEventsApi {
  mux(
    request: LegacyRpcRequest,
    signal: AbortSignal,
  ): AsyncIterable<LegacyRpcRequest>
  host(
    request: LegacyRpcRequest,
    signal: AbortSignal,
  ): AsyncIterable<LegacyRpcRequest>
}

type RpcRequest<T = unknown> = LegacyRpcRequest<T>
type EventsApi = LegacyEventsApi

type MuxFrame =
  | { readonly type: 'stream/error' }
  | { readonly type: 'question/requested'; readonly sessionId: string }
  | {
    readonly type: 'approval/requested'
    readonly sessionId: string
    readonly approvalId: string
  }
  | {
    readonly type: 'question/resolved'
    readonly sessionId: string
    readonly questionRpcId: string
  }
  | {
    readonly type: 'approval/resolved'
    readonly sessionId: string
    readonly approvalId: string
  }

type HostFrame =
  | { readonly type: 'stream/error' }
  | {
    readonly type: 'host/session-added' | 'host/session-removed' | 'host/session-status' | 'host/agent-error'
    readonly sessionId: string
  }
  | {
    readonly type: 'host/workspace-changed'
    readonly workspace: { readonly workspaceId: string }
  }
  | { readonly type: 'host/workspace-removed'; readonly workspaceId: string }
  | {
    readonly type: 'host/workspace-order-changed'
    readonly workspaceIds: readonly string[]
  }
  | {
    readonly type: 'host/archived-sessions-changed'
    readonly archivedSessionIds: readonly string[]
  }
  | { readonly type: 'host/remote-event' }

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

/** Per-connection resource scoping the carrier threads onto the peer. */
export interface ApiPolicyWorkspaceAdmission {
  ownsWorkspace(workspaceId: string): boolean
  ownsSession(sessionId: string): boolean
}

/**
 * What an upgraded connection may receive: remote-event frames pass the
 * admission predicate, stream-carried Workspace frames pass the workspace
 * scoping. Either field may be absent — an absent scope is the carrier's
 * stock behaviour, not a denial.
 */
export interface ApiPolicyPeerAdmission {
  remoteEventAdmission?(event: string, args: readonly unknown[]): boolean
  workspaceAdmission?: ApiPolicyWorkspaceAdmission
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

/**
 * The namespaces a non-administrator may READ.
 *
 * Their settings pages — Shell, Agent loop, Subagent, Web search — register
 * into the Plugins page only while the Host serves the namespace, so hiding
 * every namespace except onboarding did not merely keep students out of the
 * configuration: it emptied the Plugins page down to 「还没有安装任何插件。」.
 *
 * Nothing secret rides along. The controller answers every remote read under
 * `redactSecrets`, so a `role('secret')` field arrives as `{ path, set }` and
 * never as a value, and every write stays on
 * {@link ADMIN_ONLY_METHODS}: `settings.describe` is the one settings method a
 * non-administrator may call at all. The list is explicit rather than a
 * denylist so a namespace added upstream is not readable by accident.
 */
const READABLE_SETTINGS_NAMESPACES: ReadonlySet<string> = new Set([
  ONBOARDING_SETTINGS_NAMESPACE,
  /* Shell: the bash and powershell executors. */
  'bash-sandbox',
  'pwsh-sandbox',
  'agent-loop',
  /* Subagent: recursion limits, and which model the children use. */
  'subagent',
  'subagent-model-selection-settings',
  'web-search-deepseek',
])

/** The one model name a student sees. */
const PLATFORM_MODEL_NAME = '平台公益模型'

/** The group header above it — the product, never the vendor serving the pool. */
const PLATFORM_MODEL_GROUP_NAME = 'PhysicsOS'

/**
 * Reduce a model catalog to the one entry a student is shown.
 *
 * The catalog is discovered from whatever the platform's channels currently
 * serve, so its ids and names name the upstream vendor (`deepseek-flash`,
 * `DeepSeek-V4-Pro`) and change whenever the operator swaps a channel — none of
 * which is the student's business, and all of which the student-facing persona
 * is already forbidden to reveal. The deployment's default model is kept under
 * the platform's own name, **with its ids untouched**: they are what the client
 * submits for routing, and the pool behind them stays the operator's concern.
 * @param value - the catalog value, mutated in place.
 */
const reduceModelCatalog = (value: Record<string, unknown>): void => {
  const selection = isRecord(value['default']) ? value['default'] : {}
  const preferred = typeof selection['model'] === 'string' ? selection['model'] : undefined
  /* The group the Session actually routes through, not merely the first one
     that carries a model with that id: several providers may answer to the same
     platform id, and keeping a different one leaves the picker unable to resolve
     the current selection — it then falls back to showing the raw
     `provider/model` pair the product must never show. */
  const routed = typeof selection['provider'] === 'string' ? selection['provider'] : undefined
  const groups = value['groups']
  if (!Array.isArray(groups)) return
  const usable = groups.filter(isRecord).filter(group => Array.isArray(group['models']))
  const modelIn = (group: Record<string, unknown>): Record<string, unknown> | undefined => {
    const models = (group['models'] as unknown[]).filter(isRecord)
    return models.find(model => model['id'] === preferred) ?? models[0]
  }
  const group = usable.find(candidate => candidate['id'] === routed) ?? usable[0]
  if (group === undefined) {
    value['groups'] = []
    value['routableProviders'] = []
    value['failures'] = []
    return
  }
  const chosen = modelIn(group)
  const kept: Record<string, unknown>[] = []
  if (chosen !== undefined) {
    const entry: Record<string, unknown> = { ...chosen, name: PLATFORM_MODEL_NAME }
    delete entry['description']
    kept.push({ id: group['id'], name: PLATFORM_MODEL_GROUP_NAME, models: [entry] })
  }
  value['groups'] = kept
  value['routableProviders'] = kept.map(entry => entry['id'])
  /* A failure names the provider it could not reach. */
  value['failures'] = []
}
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

/** Project either the legacy flat payload or the 0.1.7 named-argument payload. */
const policyPayloadOf = (payload: Record<string, unknown>): Record<string, unknown> => {
  const args = payload['args']
  if (!isRecord(args)) return payload
  const request = args['request']
  return isRecord(request) ? request : args
}

/** Put a rewritten policy payload back into the envelope's original wire shape. */
const withPolicyPayload = (
  wirePayload: Record<string, unknown>,
  policyPayload: Record<string, unknown>,
): Record<string, unknown> => {
  const args = wirePayload['args']
  if (!isRecord(args)) return policyPayload
  const request = args['request']
  return isRecord(request)
    ? { ...wirePayload, args: { ...args, request: policyPayload } }
    : { ...wirePayload, args: policyPayload }
}

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
  authorizeRequest(req: Pick<IncomingMessage, 'headers'>): boolean
  wrapFetch(next: FetchLike): FetchLike
  scopeEvents(req: IncomingMessage, events: EventsApi): Promise<EventsApi | undefined>
  admitUpgrade(
    req: Pick<IncomingMessage, 'headers'>,
  ): ApiPolicyPeerAdmission | null | undefined
} {
  const pendingResponses = new Map<string, { expiresAt: number }>()
  const approvalResponseKeys = new Map<string, string>()
  const admin = (actor: ApiPolicyActor): boolean => actor.role === 'SUPER_ADMIN'
  const ownsSession = (actor: ApiPolicyActor, id: string): boolean =>
    deps.store.owns(actor, 'session', id)
  const remoteSessionId = (args: readonly unknown[]): string | undefined => {
    const first = args[0]
    if (typeof first === 'string') return first
    if (typeof first !== 'object' || first === null) return undefined
    const record = first as Record<string, unknown>
    if (typeof record['sessionId'] === 'string') return record['sessionId']
    const agent = record['agent']
    if (typeof agent === 'object' && agent !== null
      && typeof (agent as Record<string, unknown>)['id'] === 'string') {
      return (agent as Record<string, unknown>)['id'] as string
    }
    return undefined
  }
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

    /* Naming a session is what makes a call session-addressed. Not every
       `session.*` method names one: the model catalog and the other read-only
       descriptors take no sessionId at all, and requiring one refused them for
       every non-administrator — which is why the model picker never opened for
       a student. A call that names no session has nothing of anyone else's to
       reach; one that names a session is still checked against the actor. */
    const sessionScoped = method.startsWith('session.') || method.startsWith('goal.') || method === 'skill.list'
    const sessionId = sessionIdOf(payload)
    const addressesSession = sessionScoped && sessionId !== undefined && sessionId !== ''
    if (addressesSession && method !== 'session.create' && method !== 'session.list' && method !== 'session.search') {
      if (!admin(actor) && !deps.store.owns(actor, 'session', sessionId)) {
        return denyNotFound(rpcId, 'session', sessionId)
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
    const wirePayload = isRecord(body.payload) ? { ...body.payload } : {}
    const payload = { ...policyPayloadOf(wirePayload) }
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
    } else if (method === 'session.create') {
      /* Reuse calls (`sessionId` present) keep the Session's own preset —
         `create` cannot change an existing Session's preset, and the client
         seeds its request with the currently selected one, so letting it
         through made every 「打开工作区」 reuse fail with
         `agent-preset/conflict` while the composer stayed inert. */
      if (payload['sessionId'] !== undefined) delete payload['agentPreset']
      /* Fresh creates for the operator open in the product's mode too. Leaving
         them on the installation's default preset is what made an administrator
         see a worse product than a student: that preset carries no physics
         tools, so the tutor answered 「环境无法执行命令」 and derived numbers by
         hand instead of running the engine. A later `agentPreset.select` — which
         an administrator is free to make — still wins. */
      else if (payload['agentPreset'] === undefined) payload['agentPreset'] = STUDENT_PRESET
    }

    if (method === 'session.create' || method === 'session.fork'
      || method === 'workspace.create' || method === 'workspace.delete') {
      const next = new Request(request.url, {
        method: request.method,
        headers: new Headers([...request.headers].filter(([name]) => name !== 'content-length')),
        body: JSON.stringify({ ...body, payload: withPolicyPayload(wirePayload, payload) }),
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
    const payload = policyPayloadOf(isRecord(body.payload) ? body.payload : {})
    const value = valueOf(parsed)
    if (!isRecord(value)) return response
    let changed = false

    if (method === 'settings.describe' && !admin(actor)) {
      const namespaces = value['namespaces']
      value['namespaces'] = Array.isArray(namespaces)
        ? namespaces.filter(namespace =>
          isRecord(namespace) && READABLE_SETTINGS_NAMESPACES.has(String(namespace['ns'])))
        : []
      changed = true
    }

    /* Every actor, administrators included: this catalog feeds the product's
       own model seat, and the vendor serving the pool is not the operator's
       either. Managing the pool happens on the surfaces that name it — the
       models settings page (the llm namespaces) and the 模型通道 console. */
    if (method === 'session.modelCatalog') {
      reduceModelCatalog(value)
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

    if (method === 'workspace.initializeDefault') {
      /* The stock answer is the installation's shared default Workspace (or
         none). Surfacing either to a hosted account seeds the client model
         with a row it cannot own; the account's ensured Workspace is the only
         default this product has. */
      const workspace = await deps.ensureWorkspace(actor)
      await deps.store.claim(actor, 'workspace', workspace.id)
      value['workspace'] = privateWorkspaceView(workspace)
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
    authorizeRequest: (req) => {
      /* Fail closed, and audibly: a storage failure while resolving the cookie
         must refuse the request rather than throw into the web server's
         last-resort guard, whose bare 400 no client can read. */
      try {
        return deps.actorFromRequest(req as IncomingMessage) !== null
      } catch (error) {
        console.warn(`api-policy: authorizeRequest failed: ${String(error)}`)
        return false
      }
    },
    admitUpgrade: (req) => {
      const actor = deps.actorFromRequest(req as IncomingMessage)
      if (actor === null) return null
      /* Every connection — the operator's included — sees the Workspaces its
         account owns in the product's picker. Registry-wide troubleshooting is
         an admin-console concern; streaming the whole registry to the operator
         is how a picker full of indistinguishable 「我的工作区」 rows appeared. */
      /* Every connection — the operator's included — sees the Workspaces its
         account owns in the product's picker. Registry-wide troubleshooting is
         an admin-console concern; streaming the whole registry to the operator
         is how a picker full of indistinguishable 「我的工作区」 rows appeared. */
      const workspaceAdmission = {
        ownsWorkspace: (id: string): boolean => deps.store.owns(actor, 'workspace', id),
        ownsSession: (id: string): boolean => ownsSession(actor, id),
      }
      if (admin(actor)) {
        /* Remote events stay unscoped for the operator so approvals and
           account-wide questions keep flowing. */
        return { workspaceAdmission }
      }
      /* Only session-scoped events cross to ordinary accounts. Dropping
         account-independent catalog and settings chatter is deliberate: the
         old transport scoped every frame, and a global fallback would expose
         another learner's activity. */
      return {
        workspaceAdmission,
        remoteEventAdmission: (_event: string, args: readonly unknown[]) => {
          const sessionId = remoteSessionId(args)
          return sessionId !== undefined && ownsSession(actor, sessionId)
        },
      }
    },
    wrapFetch: next => async (request) => {
      const cookie = request.headers.get('cookie') ?? undefined
      const authorization = request.headers.get('authorization') ?? undefined
      const actor = deps.actorFromCookie(cookie, authorization)
      if (actor === null) {
        return Response.json({ error: 'unauthenticated' }, { status: 401 })
      }

      const url = new URL(request.url)
      const endpoint = url.pathname.startsWith('/api/') ? url.pathname.slice('/api/'.length) : ''
      const method = endpoint.split('/').join('.')
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
      const payload = policyPayloadOf(isRecord(body.payload) ? body.payload : {})
      try {
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
        return await rewriteResponse(actor, method, body, response)
      } catch (error) {
        /* This front door answers an envelope. A throw anywhere below would
           otherwise leave the web server's last-resort guard writing a bare
           400 — no rpcId, no code, no reason — which every caller reads as a
           dead transport it cannot act on, and which leaves the operator with
           nothing to look at either. */
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`api-policy: ${method} failed: ${reason}`)
        /* One refusal class belongs to the client's blank-Session reuse: the
           Session it wanted is unusable — held by a writer, or gone from the
           Host entirely (the reuse scans the client's own list, so a Session
           the registry still names but the log no longer loads lands here).
           Both mean "replace the blank", which is the code that says so. */
        const unusableBlank = /writer|owned|already|held|占用|锁定/i.test(reason)
          || (method === 'session.create' && /not found/i.test(reason))
        if (unusableBlank) {
          return rpcError(rpcId, 'session/writer-held', reason, {})
        }
        return rpcError(rpcId, 'gateway/internal', `请求处理失败：${reason}`, {})
      }
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
              const payload = frame.payload as MuxFrame
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
          const payload = frame.payload as HostFrame
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
