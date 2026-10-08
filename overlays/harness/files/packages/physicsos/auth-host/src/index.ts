/**
 * @deepseek-ai/dsh-auth-host — the PhysicsOS 账户体系 host plugin.
 *
 * Owns the `physicsos_auth` storage domain (school tenants, school-scoped
 * users, hash-keyed sessions, reset requests), serves the `/physicsos/auth`
 * REST surface on the webServer service, and holds the account-security
 * posture: argon2id hashing, uniform credential errors, IP/account attempt
 * buckets, and HttpOnly cookie sessions — the raw token never reaches the
 * wire or the store. Loading fails loud on Node runtimes without
 * `crypto.argon2` (< 24.7) rather than silently weakening password storage.
 *
 * @module @deepseek-ai/dsh-auth-host
 */

import { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { openAuthDomain } from './domain.ts'
import { ARGON2_AVAILABLE, ARGON2_UNAVAILABLE_REASON } from './passwords.ts'
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthServiceConfig } from './service.ts'
import { seedBootstrapAdmins, type BootstrapAdmin } from './bootstrap.ts'
import { seedSchools } from './schools.ts'
import { adminRoutes, authRoutes } from './routes.ts'
import { IDENTITY_SERVICE, createIdentityService } from './identity.ts'
import {
  DEFAULT_WORKSPACE_TITLE,
  DEFAULT_MODEL_ATTEMPT_LIMIT,
  DEFAULT_MODEL_ATTEMPT_WINDOW_MS,
  ONCE_LEDGER_SERVICE,
  asOnceLedger,
  createApiPolicy,
  type ApiPolicyActor,
  type ApiPolicyLimiterBackend,
  type ApiPolicyWorkspace,
} from './api-policy.ts'
import { validateTrustedProxies } from './proxy.ts'
import { LIMITER_SERVICE, asLimiterBackend, type LimiterPolicy } from './limiter.ts'
import {
  PASSWORD_RESET_DELIVERY_SERVICE, asPasswordResetDelivery,
} from './reset-delivery.ts'

export const name = 'auth-host'
export const inject = ['webServer', 'storageDomain']

/** Cordis service name consumed by the browser connection's `/api` policy seam. */
export const API_POLICY_SERVICE = 'apiPolicy'

interface WorkspaceRecordSeam {
  readonly id: string
  readonly path: string
  readonly title: string
  setTitle(title: string): Promise<void>
}

interface WorkspaceRegistrySeam {
  create(path: string, title?: string): Promise<WorkspaceRecordSeam>
}

/** Plugin config: session lifetimes and attempt budgets are deployment knobs. */
export interface Config extends Partial<AuthServiceConfig> {
  /**
   * Initial admin accounts seeded at boot — the ONLY way a SUPER_ADMIN comes
   * into existence (the wire can never mint one). Typically one entry under
   * the `PHYSICSOS-OPEN` ops tenant with its password read from env via
   * `!!js` in cordis.yml. Idempotent: existing accounts are left untouched.
   */
  bootstrapAdmins?: BootstrapAdmin[]
  /** Root for account-private Harness workspaces. */
  workspaceRoot?: string
  /** Maximum live workspaces one account may own. */
  workspaceLimit?: number
  /**
   * Server-filesystem browsing for `host.listDirectory` / `pickDirectory` /
   * `createDirectory`. `deny` (default) refuses every role: the hosted
   * deployment's host is the server, account workspaces are assigned
   * server-side, and the picker would expose the per-account hash layout.
   */
  hostFilesystemAccess?: 'deny' | 'admin'
  /** Per-account model-call budget for the beta. Super admins are exempt. */
  modelAttemptLimit?: number
  /** Fixed window for {@link modelAttemptLimit}. */
  modelAttemptWindowMs?: number
}

const bootstrapAdmin = z.object({
  schoolId: z.string().required(),
  username: z.string().required(),
  password: z.string().required(),
  displayName: z.string().default('平台管理员'),
  role: z.union(['SUPER_ADMIN', 'SCHOOL_ADMIN']).default('SUPER_ADMIN'),
})

export const Config: z<Config> = z.object({
  sessionTtlMs: z.number().default(DEFAULT_AUTH_CONFIG.sessionTtlMs),
  rememberTtlMs: z.number().default(DEFAULT_AUTH_CONFIG.rememberTtlMs),
  accountAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.accountAttemptLimit),
  ipAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.ipAttemptLimit),
  applyAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.applyAttemptLimit),
  registrationAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.registrationAttemptLimit),
  learningAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.learningAttemptLimit),
  passwordResetAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.passwordResetAttemptLimit),
  passwordResetTtlMs: z.number().default(DEFAULT_AUTH_CONFIG.passwordResetTtlMs),
  registrationMode: z.union(['open', 'invite', 'closed']).default(DEFAULT_AUTH_CONFIG.registrationMode),
  totpAttemptLimit: z.number().default(DEFAULT_AUTH_CONFIG.totpAttemptLimit),
  totpChallengeTtlMs: z.number().default(DEFAULT_AUTH_CONFIG.totpChallengeTtlMs),
  apiTokenLimit: z.number().default(DEFAULT_AUTH_CONFIG.apiTokenLimit),
  trustedProxies: z.array(z.string()).default([]),
  attemptBucketLimit: z.number().default(DEFAULT_AUTH_CONFIG.attemptBucketLimit),
  attemptWindowMs: z.number().default(DEFAULT_AUTH_CONFIG.attemptWindowMs),
  bootstrapAdmins: z.array(bootstrapAdmin).default([]),
  workspaceRoot: z.string().default(dshHomePath('physicsos-users')),
  workspaceLimit: z.number().min(1).step(1).default(20),
  hostFilesystemAccess: z.union(['deny', 'admin']).default('deny'),
  modelAttemptLimit: z.number().min(1).step(1).default(DEFAULT_MODEL_ATTEMPT_LIMIT),
  modelAttemptWindowMs: z.number().min(1).step(1).default(DEFAULT_MODEL_ATTEMPT_WINDOW_MS),
})

/**
 * Plugin entry: open the auth domain, seed the school tenants, then serve
 * `/physicsos/auth` until the fiber unloads. Activation awaits the route
 * registration so a booted composition never 404s its own API.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @param config - validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  validateTrustedProxies(config.trustedProxies ?? [])
  if (!ARGON2_AVAILABLE) {
    throw new Error(
      `auth-host requires a working argon2id: ${ARGON2_UNAVAILABLE_REASON ?? 'unknown reason'}`
      + ` (Node ${process.version}; needs >= 24.7 built against an OpenSSL with argon2id)`,
    )
  }
  await ctx.effect(async function* () {
    const domain = await openAuthDomain(ctx)
    const limiter = asLimiterBackend(ctx.get(LIMITER_SERVICE))
    const apiPolicyLimiter: ApiPolicyLimiterBackend | undefined = limiter === undefined
      ? undefined
      : {
        kind: limiter.kind,
        // The shared backend keys by the string name at runtime; the auth
        // limiter's compile-time union predates the new `model` policy.
        consume: (policy, key, now) =>
          limiter.consume(policy as unknown as LimiterPolicy, key, now),
      }
    const onceLedger = asOnceLedger(ctx.get(ONCE_LEDGER_SERVICE))
    const resetDelivery = asPasswordResetDelivery(ctx.get(PASSWORD_RESET_DELIVERY_SERVICE))
    const service = new AuthService(domain, config as AuthServiceConfig, {
      ...(limiter === undefined ? {} : { limiter }),
      ...(resetDelivery === undefined ? {} : { resetDelivery }),
      ...(onceLedger === undefined ? {} : { onceLedger }),
    })

    const seeded = await seedSchools(
      id => domain.table('schools').get(id),
      async (id, school) => { await domain.table('schools').put(id, school) },
    )
    if (seeded > 0) ctx.logger.info(`auth-host: seeded ${seeded} schools`)

    /* Published before the routes register, so a consumer that loads after
       this plugin always finds it. */
    const identity = createIdentityService(service)
    ctx.provide(IDENTITY_SERVICE, identity)

    const actorFromCookie = (
      cookie: string | undefined,
      authorization?: string,
    ): ApiPolicyActor | null => {
      const resolved = service.resolveCredential(cookie, authorization)
      if (resolved === null) return null
      return {
        ...resolved.actor,
        credential: resolved.credential.kind === 'session'
          ? { kind: 'session' }
          : {
            kind: 'api-token',
            tokenId: resolved.credential.token.id,
            scope: resolved.credential.scope,
          },
      }
    }
    const actorFromRequest = (req: IncomingMessage): ApiPolicyActor | null => {
      const resolved = service.resolveCredential(req.headers.cookie, req.headers.authorization)
      if (resolved === null) return null
      return {
        ...resolved.actor,
        credential: resolved.credential.kind === 'session'
          ? { kind: 'session' }
          : {
            kind: 'api-token',
            tokenId: resolved.credential.token.id,
            scope: resolved.credential.scope,
          },
      }
    }

    const workspacePromises = new Map<string, Promise<ApiPolicyWorkspace>>()
    /**
     * The harness names a workspace record after its directory basename — for
     * an account workspace that is the opaque `sha256(userKey)` digest. Rename
     * it once, durably, to the human-readable default; a title the user already
     * chose is never overwritten. A registry that refuses the rename still
     * answers with the readable title for this account's own views.
     */
    const adoptWorkspaceTitle = async (
      workspace: WorkspaceRecordSeam,
      title: string,
    ): Promise<string> => {
      if (workspace.title === title) return title
      try {
        await workspace.setTitle(title)
      } catch {
        // A registry that refuses the rename keeps the digest; the account's own
        // views fall back to the readable default below.
      }
      return title
    }
    const ensureWorkspace = (
      actor: ApiPolicyActor,
      requestedTitle?: string,
    ): Promise<ApiPolicyWorkspace> => {
      const own = service.ownedApiResources(actor, 'workspace')
      const limit = config.workspaceLimit ?? 20
      const title = requestedTitle === undefined ? DEFAULT_WORKSPACE_TITLE : requestedTitle
      const key = requestedTitle === undefined
        ? actor.userKey
        : `${actor.userKey}\u0000${requestedTitle}`
      const existing = workspacePromises.get(key)
      if (existing !== undefined) return existing
      const pending = (async (): Promise<ApiPolicyWorkspace> => {
        if (own.size >= limit) {
          throw new Error(`workspace limit reached (${String(limit)})`)
        }
        const registry = ctx.get('workspaceRegistry') as WorkspaceRegistrySeam | undefined
        if (registry === undefined) throw new Error('workspaceRegistry is not mounted')
        const digest = createHash('sha256').update(actor.userKey).digest('hex').slice(0, 32)
        const directory = requestedTitle === undefined ? digest : `${digest}-${randomUUID()}`
        const path = join(config.workspaceRoot ?? dshHomePath('physicsos-users'), directory)
        await mkdir(path, { recursive: true })
        const workspace = await registry.create(path, title)
        const displayTitle = await adoptWorkspaceTitle(workspace, title)
        return { id: workspace.id, path: workspace.path, title: displayTitle }
      })()
      workspacePromises.set(key, pending)
      void pending.catch(() => {
        if (workspacePromises.get(key) === pending) workspacePromises.delete(key)
      })
      return pending
    }

    ctx.provide(API_POLICY_SERVICE, createApiPolicy({
      actorFromCookie,
      actorFromRequest,
      store: {
        owns: (actor, kind, id) => service.ownsApiResource(actor, kind, id),
        ownedIds: (actor, kind) => service.ownedApiResources(actor, kind),
        claim: (actor, kind, id) => service.claimApiResource(actor, kind, id),
        release: (actor, kind, id) => service.releaseApiResource(actor, kind, id),
      },
      ensureWorkspace,
      hostFilesystemAccess: config.hostFilesystemAccess ?? 'deny',
      ...(apiPolicyLimiter === undefined ? {} : { limiter: apiPolicyLimiter }),
      ...(onceLedger === undefined ? {} : { onceLedger }),
      modelPolicy: {
        limit: config.modelAttemptLimit ?? DEFAULT_MODEL_ATTEMPT_LIMIT,
        windowMs: config.modelAttemptWindowMs ?? DEFAULT_MODEL_ATTEMPT_WINDOW_MS,
        maxBuckets: config.attemptBucketLimit ?? DEFAULT_AUTH_CONFIG.attemptBucketLimit,
      },
    }))

    const seededAdmins = await seedBootstrapAdmins(domain, config.bootstrapAdmins ?? [])
    if (seededAdmins > 0) ctx.logger.info(`auth-host: seeded ${seededAdmins} bootstrap admins`)

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/auth',
      handler: authRoutes(service),
    })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/admin',
      handler: adminRoutes(service),
    })
    yield () => domain.close()
  }, 'auth-host')
}
