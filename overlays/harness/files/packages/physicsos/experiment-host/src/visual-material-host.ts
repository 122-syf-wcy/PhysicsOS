/** Native experiment-host adapter; never exposes database credentials or fabricates ownership/leases. */
import type { IncomingMessage } from 'node:http'
import type { PoolConfig } from 'pg'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { IDENTITY_SERVICE } from './identity.ts'
import {
  VisualMaterialError, visualMaterialAborted,
  type VisualMaterialActor, type VisualMaterialLimits, type VisualMaterialPngValidator,
  type VisualMaterialRecoveryResult, type VisualMaterialService,
} from './visual-material-contracts.ts'
import { visualMaterialActor, visualMaterialOperationId } from './visual-material-domain.ts'
import { createVisualMaterialRuntime } from './visual-material-runtime.ts'
import type { VisualMaterialRouteIdentity } from './visual-material-routes.ts'

/** Parent must inject this lifecycle key so native startup cannot race postgres registration. */
export const VISUAL_MATERIAL_POSTGRES_SERVICE = storageBackendServiceKey('postgres')
export const VISUAL_MATERIAL_SERVICE = 'physicsosVisualMaterials'

declare module '@deepseek-ai/cordis' {
  interface Context { physicsosVisualMaterials: VisualMaterialService }
}

export interface VisualMaterialSessionIdentity {
  /** Optional for compatibility with older host tests, but absence refuses material operations. */
  usageSessionOwner?(sessionId: string): { readonly schoolId: string; readonly userKey: string } | undefined
  sessionOwnerKey(sessionId: string): string | undefined
}

/** Exact persisted session ownership, never ownsApiResource/SUPER_ADMIN or caller-supplied school. */
export function sessionVisualMaterialActor(identity: VisualMaterialSessionIdentity | undefined,
  sessionId: string, expectedUserKey?: string): VisualMaterialActor {
  visualMaterialOperationId(sessionId)
  if (identity === undefined || typeof identity.sessionOwnerKey !== 'function' || typeof identity.usageSessionOwner !== 'function') {
    throw new VisualMaterialError(503, 'MATERIAL_IDENTITY_UNAVAILABLE', 'Exact visual material session ownership is unavailable.')
  }
  const owner = identity.usageSessionOwner(sessionId), exact = identity.sessionOwnerKey(sessionId)
  if (owner === undefined || exact === undefined || owner.userKey !== exact || expectedUserKey !== undefined && exact !== expectedUserKey) {
    throw new VisualMaterialError(404, 'MATERIAL_OWNER_NOT_FOUND', 'Exact visual material session owner was not found.')
  }
  try { return visualMaterialActor(owner) }
  catch { throw new VisualMaterialError(503, 'MATERIAL_IDENTITY_UNAVAILABLE', 'Persisted visual material session ownership is invalid.') }
}

interface VisualMaterialPostgresBackend {
  readonly ready: Promise<void>
  assertWriterHeld(): void
  /** Native-only controlled accessor on the registered PostgresStorageBackend. Not a DTO. */
  siblingPoolConfig(): { readonly schema: string; readonly poolConfig: PoolConfig }
}
export interface VisualMaterialHostContext {
  readonly storage: { readonly backend: { get(name: string): unknown } }
  get(key: string): unknown
}
export interface VisualMaterialHostConfig {
  /** Reuse experiment-host's validated trusted assetOrigin, or existing PHYSICSOS_PUBLIC_URL. */
  readonly assetOrigin?: string
  /** Reuses resolveDshHome precedence; private filesystem still rejects physical symlink components. */
  readonly dshHome?: string
  readonly limits?: Partial<VisualMaterialLimits>
  readonly validatePng?: VisualMaterialPngValidator
  readonly onWriterLost?: () => void
}
export interface VisualMaterialHost {
  readonly service: VisualMaterialService
  readonly origin: string
  readonly identity: () => VisualMaterialRouteIdentity | undefined
  readonly actorForSession: (sessionId: string, expectedUserKey?: string) => VisualMaterialActor
  /** Await before provide/register, like Canvas/courseware durable initialization. */
  readonly initialize: (signal?: AbortSignal) => Promise<readonly VisualMaterialRecoveryResult[]>
  /** Close only this sibling's pool/lease; existing storage-postgres remains owned by its plugin. */
  readonly close: () => Promise<void>
}

function unavailable(): never {
  throw new VisualMaterialError(503, 'MATERIAL_POSTGRES_UNAVAILABLE', 'Registered PostgreSQL storage with its real writer/configuration seam is required.')
}
function registeredPostgres(ctx: VisualMaterialHostContext): VisualMaterialPostgresBackend {
  let backend: unknown, lifecycle: unknown
  try { backend = ctx.storage.backend.get('postgres'); lifecycle = ctx.get(VISUAL_MATERIAL_POSTGRES_SERVICE) }
  catch { return unavailable() }
  if (backend === null || typeof backend !== 'object' || lifecycle !== backend) return unavailable()
  const seam = backend as Partial<VisualMaterialPostgresBackend>
  if (typeof seam.assertWriterHeld !== 'function' || typeof seam.siblingPoolConfig !== 'function'
    || seam.ready === undefined || typeof seam.ready.then !== 'function') return unavailable()
  return seam as VisualMaterialPostgresBackend
}
function trustedOrigin(config: VisualMaterialHostConfig): string {
  const configured = config.assetOrigin ?? process.env.PHYSICSOS_PUBLIC_URL
  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new VisualMaterialError(503, 'ORIGIN_UNAVAILABLE', 'Visual materials require trusted assetOrigin or existing PHYSICSOS_PUBLIC_URL configuration.')
  }
  try {
    const url = new URL(configured.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('origin')
    return url.origin
  } catch { throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material public origin must be a trusted HTTP origin.') }
}
function routeIdentity(ctx: VisualMaterialHostContext): VisualMaterialRouteIdentity | undefined {
  const raw = ctx.get(IDENTITY_SERVICE)
  if (raw === null || typeof raw !== 'object') return undefined
  const seam = raw as Partial<VisualMaterialRouteIdentity>
  if (typeof seam.actorOf !== 'function') return undefined
  return {
    actorOf: (req: IncomingMessage) => seam.actorOf!(req),
    ...(typeof seam.record !== 'function' ? {} : { record: (actor: VisualMaterialActor, action: string, target: string, detail: Record<string, unknown>) => seam.record!(actor, action, target, detail) }),
  }
}

/** No env/secret PG re-parsing. Uses the SAME runtime-resolved connection/TLS/schema from storage-postgres. */
export async function createVisualMaterialHost(ctx: VisualMaterialHostContext, config: VisualMaterialHostConfig = {},
  signal?: AbortSignal): Promise<VisualMaterialHost> {
  visualMaterialAborted(signal)
  const origin = trustedOrigin(config)
  if (config.dshHome !== undefined && config.dshHome.trim() === '') throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material DSH_HOME must not be blank.')
  const backend = registeredPostgres(ctx)
  try { await backend.ready; backend.assertWriterHeld() } catch { return unavailable() }
  visualMaterialAborted(signal)
  if (registeredPostgres(ctx) !== backend) return unavailable()
  const assertWriterHeld = (): void => {
    if (registeredPostgres(ctx) !== backend) return unavailable()
    backend.assertWriterHeld()
  }
  // This closure never returns/logs PoolConfig; existing loader/secret mounting already resolved it.
  let sibling: ReturnType<VisualMaterialPostgresBackend['siblingPoolConfig']>
  try { assertWriterHeld(); sibling = backend.siblingPoolConfig() } catch { return unavailable() }
  const runtime = createVisualMaterialRuntime({
    schema: sibling.schema, poolConfig: sibling.poolConfig, assertWriterHeld, dshHome: resolveDshHome(config.dshHome),
    ...(config.limits === undefined ? {} : { limits: config.limits }),
    ...(config.validatePng === undefined ? {} : { validatePng: config.validatePng }),
    ...(config.onWriterLost === undefined ? {} : { onWriterLost: config.onWriterLost }),
  })
  return {
    service: runtime.service, origin, identity: () => routeIdentity(ctx),
    actorForSession: (sessionId, expectedUserKey) => {
      const raw = ctx.get(IDENTITY_SERVICE)
      const identity = raw !== null && typeof raw === 'object' ? raw as VisualMaterialSessionIdentity : undefined
      return sessionVisualMaterialActor(identity, sessionId, expectedUserKey)
    },
    initialize: async initializeSignal => {
      assertWriterHeld()
      return runtime.initialize(initializeSignal)
    },
    close: runtime.close,
  }
}
