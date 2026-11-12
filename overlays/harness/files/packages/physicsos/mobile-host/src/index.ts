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
/** Remaining identity-sensitive domains are composed by the account owner, never guessed here. */
export const PERSONAL_EXPORT_SERVICE = 'physicsosMobilePersonalExports'
export interface MobilePersonalExports { sections(): readonly ExportSection[] }
export const REQUIRED_PERSONAL_EXPORTS = ['learning.whiteboards', 'learning.usage', 'account.profile', 'account.sessions'] as const

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
  }
}

/** Stable row identities are explicit: a scene's identity is sceneId, not id. */
function exportId(row: Record<string, unknown>, name = 'id'): string {
  const value = row[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) throw new MobileApiError(503, 'EXPORT_UNAVAILABLE', '导出对象缺少稳定标识')
  return value
}

/**
 * A complete manifest or 503. Dependency outages never masquerade as an empty account.
 * File-backed sections enumerate indexes and hydrate one authorized object at a time.
 * @param lookup - service getter.
 * @returns every required personal section, with no credentials.
 */
export function exportSections(lookup: ServiceLookup): ExportSection[] {
  const learning = facade<MobileLearningFacade>(lookup, LEARNING_SERVICE)
  const classes = facade<MobileClassFacade>(lookup, CLASS_SERVICE)
  const notice = facade<MobileNoticeFacade>(lookup, NOTICE_SERVICE)
  const personal = facade<MobilePersonalExports>(lookup, PERSONAL_EXPORT_SERVICE)
  if (learning === undefined || classes === undefined || notice === undefined || personal === undefined) {
    throw new MobileApiError(503, 'EXPORT_UNAVAILABLE', '完整账户导出所需服务未就绪')
  }
  const sections: ExportSection[] = [
    { id: 'learning.attempts', rows: actor => learning.listAttempts(actor), idOf: row => exportId(row) },
    { id: 'learning.scenes', rows: actor => learning.listScenes(actor), idOf: row => exportId(row, 'sceneId'),
      load: (actor, row) => learning.exportScene(actor, exportId(row, 'sceneId'), Number(row['revision'])) },
    { id: 'learning.canvas.metadata', rows: actor => learning.exportCanvasMetadata(actor), idOf: row => exportId(row) },
    { id: 'learning.canvas.objects', rows: actor => learning.exportCanvasObjectIndex(actor), idOf: row => exportId(row),
      load: (actor, row) => learning.exportCanvasObject(actor, exportId(row)) },
    { id: 'classes.memberships', rows: actor => classes.exportMemberships(actor), idOf: row => exportId(row) },
    { id: 'classes.submissions', rows: actor => classes.exportSubmissions(actor), idOf: row => exportId(row) },
    { id: 'notices.account', rows: actor => notice.exportAccount(actor), idOf: row => exportId(row) },
    ...personal.sections(),
  ]
  const ids = sections.map(section => section.id)
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9.]{0,79}$/.test(id))
    || REQUIRED_PERSONAL_EXPORTS.some(id => !ids.includes(id))) {
    throw new MobileApiError(503, 'EXPORT_UNAVAILABLE', '账户导出清单不完整或重复')
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
