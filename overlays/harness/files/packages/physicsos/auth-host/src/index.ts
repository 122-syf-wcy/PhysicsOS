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
import { createHash } from 'node:crypto'
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

interface ApiProxyWorkspaceSeam {
  readonly workspace: {
    create(request: {
      rpcId: string
      payload: { path: string }
    }): Promise<{
      result:
        | { ok: true; value: { workspace: { workspaceId: string; path: string } } }
        | { ok: false; error: { code: string; message: string } }
    }>
  }
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
    const ensureWorkspace = (actor: ApiPolicyActor): Promise<ApiPolicyWorkspace> => {
      const existing = workspacePromises.get(actor.userKey)
      if (existing !== undefined) return existing
      const pending = (async (): Promise<ApiPolicyWorkspace> => {
        const apiProxy = ctx.get('apiProxy') as ApiProxyWorkspaceSeam | undefined
        if (apiProxy === undefined) throw new Error('apiProxy is not mounted')
        const digest = createHash('sha256').update(actor.userKey).digest('hex').slice(0, 32)
        const path = join(config.workspaceRoot ?? dshHomePath('physicsos-users'), digest)
        await mkdir(path, { recursive: true })
        const response = await apiProxy.workspace.create({
          rpcId: `physicsos-scope-${digest}`,
          payload: { path },
        })
        if (!response.result.ok) {
          throw new Error(`private workspace failed: ${response.result.error.code} ${response.result.error.message}`)
        }
        const workspace = response.result.value.workspace
        return { id: workspace.workspaceId, path: workspace.path }
      })()
      workspacePromises.set(actor.userKey, pending)
      void pending.catch(() => {
        if (workspacePromises.get(actor.userKey) === pending) workspacePromises.delete(actor.userKey)
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
