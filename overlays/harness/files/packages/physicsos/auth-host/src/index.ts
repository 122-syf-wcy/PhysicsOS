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
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { openAuthDomain } from './domain.ts'
import { ARGON2_AVAILABLE } from './passwords.ts'
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthServiceConfig } from './service.ts'
import { seedBootstrapAdmins, type BootstrapAdmin } from './bootstrap.ts'
import { seedSchools } from './schools.ts'
import { adminRoutes, authRoutes } from './routes.ts'

export const name = 'auth-host'
export const inject = ['webServer', 'storageDomain']

/** Plugin config: session lifetimes and attempt budgets are deployment knobs. */
export interface Config extends Partial<AuthServiceConfig> {
  /**
   * Initial admin accounts seeded at boot — the ONLY way a SUPER_ADMIN comes
   * into existence (the wire can never mint one). Typically one entry under
   * the `PHYSICSOS-OPEN` ops tenant with its password read from env via
   * `!!js` in cordis.yml. Idempotent: existing accounts are left untouched.
   */
  bootstrapAdmins?: BootstrapAdmin[]
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
  attemptWindowMs: z.number().default(DEFAULT_AUTH_CONFIG.attemptWindowMs),
  bootstrapAdmins: z.array(bootstrapAdmin).default([]),
})

/**
 * Plugin entry: open the auth domain, seed the school tenants, then serve
 * `/physicsos/auth` until the fiber unloads. Activation awaits the route
 * registration so a booted composition never 404s its own API.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @param config - validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!ARGON2_AVAILABLE) {
    throw new Error('auth-host requires node:crypto.argon2 (Node >= 24.7)')
  }
  await ctx.effect(async function* () {
    const domain = await openAuthDomain(ctx)
    const service = new AuthService(domain, config as AuthServiceConfig)

    const seeded = await seedSchools(
      id => domain.table('schools').get(id),
      async (id, school) => { await domain.table('schools').put(id, school) },
    )
    if (seeded > 0) ctx.logger.info(`auth-host: seeded ${seeded} schools`)

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
