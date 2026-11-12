/**
 * @deepseek-ai/dsh-account-erasure-host — the composite account erasure provider.
 *
 * `auth-host` accepts a deletion job and withdraws credentials, but it cannot
 * erase rows owned by the learning, class, notice or canvas domains: it does
 * not hold their services and must not import them. The contract it publishes
 * (`ACCOUNT_ERASURE_SERVICE`, `AccountErasure`) exists precisely so one
 * composition plugin can fan the request out and report success only when
 * every domain confirmed.
 *
 * Failure policy: the provider refuses to be considered available while a
 * domain that holds student data is not mounted. A partial erasure that
 * reports success is worse than a refused one — the account would be
 * unreachable while its rows survived.
 *
 * @module @deepseek-ai/dsh-account-erasure-host
 */

import type { Context } from '@deepseek-ai/cordis'

/** Service published by auth-host; this plugin provides it. */
export const ACCOUNT_ERASURE_SERVICE = 'physicsosAccountErasure'

/** Domains whose facades can erase one account's rows. */
const LEARNING_SERVICE = 'physicsosMobileLearning'
const CLASS_SERVICE = 'physicsosMobileClasses'
const NOTICE_SERVICE = 'physicsosMobileNotice'

/** Stable identity of one accepted erasure operation and account incarnation. */
export interface AccountErasureRequest {
  readonly requestId: string
  readonly userKey: string
  readonly userId: string
  readonly schoolId: string
  readonly username: string
}

/** The composite provider auth-host resolves per request. */
export interface AccountErasure {
  assertAvailable(): void
  eraseAccount(request: AccountErasureRequest): Promise<void>
}

/** One domain's erase entry point, as its mobile facade publishes it. */
interface ErasableDomain {
  eraseAccount(request: AccountErasureRequest): Promise<void>
}

/** Cordis plugin name. */
export const name = 'account-erasure-host'

/**
 * No injection: every domain is resolved per call so boot order never
 * matters, and a domain that mounts later is picked up immediately.
 */
export const inject: readonly string[] = []

type Lookup = (service: string) => unknown

const domainOf = (lookup: Lookup, service: string): ErasableDomain | undefined => {
  const value = lookup(service) as Partial<ErasableDomain> | undefined
  return value !== undefined && typeof value.eraseAccount === 'function'
    ? value as ErasableDomain
    : undefined
}

/**
 * Build the composite provider.
 * @param lookup - the context's service getter.
 * @returns the provider `auth-host` consumes.
 */
export function createAccountErasure(lookup: Lookup): AccountErasure {
  const domains = (): ErasableDomain[] => [
    domainOf(lookup, LEARNING_SERVICE),
    domainOf(lookup, CLASS_SERVICE),
    // The notice facade may be absent where announcements are not deployed;
    // it holds no student-authored rows, so its absence cannot orphan data.
    domainOf(lookup, NOTICE_SERVICE),
  ].filter((value): value is ErasableDomain => value !== undefined)

  return {
    assertAvailable(): void {
      // Only the domains that own student data are mandatory.
      const missing = [
        domainOf(lookup, LEARNING_SERVICE) === undefined ? 'learning' : null,
        domainOf(lookup, CLASS_SERVICE) === undefined ? 'class' : null,
      ].filter((value): value is string => value !== null)
      if (missing.length > 0) {
        throw new Error(`account erasure is unavailable: ${missing.join(', ')} domain not mounted`)
      }
    },
    async eraseAccount(request: AccountErasureRequest): Promise<void> {
      this.assertAvailable()
      // Idempotent by requestId in every domain; a retry re-runs the same set.
      for (const domain of domains()) {
        await domain.eraseAccount(request)
      }
    },
  }
}

/**
 * Publish the composite provider.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide(ACCOUNT_ERASURE_SERVICE, createAccountErasure(service => ctx.get(service)))
}
