/**
 * @deepseek-ai/dsh-mobile-host — the PhysicsOS first-party Android API.
 *
 * One `/physicsos/mobile/v1` prefix over the hosts that already own the
 * rules: auth-host issues and resolves device grants, learning-host owns
 * attempts and scenes, class-host owns memberships and submissions,
 * paper-host owns the verified question library, and notice-host owns the
 * platform notice. This host only composes them into the envelope the Android
 * client speaks, so no business rule is duplicated and no second storage
 * domain is created.
 *
 * Loading order is irrelevant: every dependency is resolved per request, so a
 * boot that composes this host before its providers simply answers 503 until
 * they publish their services.
 *
 * @module @deepseek-ai/dsh-mobile-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  MOBILE_AUTH_SERVICE,
  MOBILE_PREFIX,
  type IdentityActor,
  type MobileAuthFacade,
  type MobileClassFacade,
  type MobileLearningFacade,
  type MobileNoticeFacade,
  type MobilePaperFacade,
  type MobilePushFacade,
} from './contract.ts'
import { mobileRoutes, type ExportSection, type RouteDeps } from './routes.ts'
import { MobileApiError } from './contract.ts'

export { MOBILE_AUTH_SERVICE, MOBILE_PREFIX, MobileApiError } from './contract.ts'
export type {
  IdentityActor,
  MobileAuthFacade,
  MobileClassFacade,
  MobileLearningFacade,
  MobileNoticeFacade,
  MobilePaperFacade,
  MobilePushFacade,
} from './contract.ts'
export { mobileRoutes } from './routes.ts'
export type { ExportSection, RouteDeps } from './routes.ts'

/** Stable Cordis plugin name. */
export const name = 'mobile-host'

/** The route carrier this plugin registers against. */
export const inject = ['webServer'] as const

/** Services this host reads by name; all optional so boot order never matters. */
export const LEARNING_SERVICE = 'physicsosMobileLearning'
export const CLASS_SERVICE = 'physicsosMobileClasses'
export const PAPER_SERVICE = 'physicsosMobilePaper'
export const NOTICE_SERVICE = 'physicsosMobileNotice'
export const PUSH_SERVICE = 'physicsosMobilePush'
/** Composite provider published by `account-erasure-host`. */
export const ERASURE_SERVICE = 'physicsosAccountErasure'

type ServiceLookup = (service: string) => unknown

/**
 * Read a published facade, or undefined while its provider is not mounted.
 * @param lookup - the context's service getter.
 * @param service - the exact Cordis service name.
 * @returns the facade object when present.
 */
function facade<T>(lookup: ServiceLookup, service: string): T | undefined {
  const value = lookup(service)
  return value === undefined || value === null ? undefined : value as T
}

/**
 * Per-request dependencies. Nothing is captured at load time, so a provider
 * that registers later is picked up on the next request.
 * @param ctx - plugin context.
 * @returns the route dependency bag.
 */
function depsOf(ctx: Context): RouteDeps {
  const lookup: ServiceLookup = service => ctx.get(service)
  return {
    auth: () => facade<MobileAuthFacade>(lookup, MOBILE_AUTH_SERVICE),
    learning: () => facade<MobileLearningFacade>(lookup, LEARNING_SERVICE),
    classes: () => facade<MobileClassFacade>(lookup, CLASS_SERVICE),
    paper: () => facade<MobilePaperFacade>(lookup, PAPER_SERVICE),
    notice: () => facade<MobileNoticeFacade>(lookup, NOTICE_SERVICE),
    push: () => facade<MobilePushFacade>(lookup, PUSH_SERVICE),
    exports: () => exportSections(lookup),
    clientIp: req => {
      // The auth host owns proxy trust; hand it the socket address and let it decide.
      const forwarded = req.headers['x-forwarded-for']
      if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]?.trim()
      return req.socket.remoteAddress ?? undefined
    },
    erase: async request => {
      const provider = facade<{ assertAvailable(): void; eraseAccount(input: unknown): Promise<void> }>(lookup, ERASURE_SERVICE)
      if (provider === undefined) {
        // Reporting `deleted` without a provider would strand the account's rows.
        throw new MobileApiError(503, 'ERASURE_UNAVAILABLE', '账户擦除服务未挂载')
      }
      provider.assertAvailable()
      await provider.eraseAccount(request)
      return 'deleted'
    },
  }
}

/**
 * The export manifest. Sections are derived from the facades that are
 * actually mounted, so the app never receives a manifest naming a section the
 * server cannot answer.
 * @param lookup - service getter.
 * @returns the ordered sections.
 */
function exportSections(lookup: ServiceLookup): ExportSection[] {
  const sections: ExportSection[] = []
  const learning = facade<MobileLearningFacade>(lookup, LEARNING_SERVICE)
  if (learning !== undefined) {
    sections.push(
      { id: 'learning.attempts', rows: actor => learning.listAttempts(actor) },
      { id: 'learning.scenes', rows: actor => learning.listScenes(actor) },
    )
  }
  const classes = facade<MobileClassFacade>(lookup, CLASS_SERVICE)
  if (classes !== undefined) {
    sections.push(
      { id: 'classes.memberships', rows: actor => classes.exportMemberships(actor) },
      { id: 'classes.submissions', rows: actor => classes.exportSubmissions(actor) },
    )
  }
  return sections
}

/**
 * Register the mobile prefix on the host web server.
 * @param ctx - plugin context with the webServer service.
 * @returns the effect disposer that unregisters the prefix.
 */
export function apply(ctx: Context): () => void {
  const handler = mobileRoutes(depsOf(ctx))
  return ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: MOBILE_PREFIX, handler }),
    'mobile-host: /physicsos/mobile/v1',
  )
}

/** The account actor shape this host passes through, re-exported for tests. */
export type { IdentityActor as MobileIdentityActor }
