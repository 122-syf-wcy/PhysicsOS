/**
 * Package-owned durable `physics/scene` invariants.
 * @module @deepseek-ai/dsh-tool-physicsos/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-physicsos'
const CAUSES = new Set(['created', 'solved', 'command'])
const SCENE_SCHEMA = 'physics-scene/1.0'

/** Cordis companion plugin name. */
export const name = 'tool-physicsos-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one scene snapshot before it reaches the durable log: the header
 * must agree with the embedded PhysicsScene (same id, same revision, the
 * frozen schema version), because the Lab mounts the embedded scene and
 * labels it with the header — a mismatch would show one revision and claim
 * another.
 */
function validateSnapshot(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('physics/scene data must be an object')
  const { sceneId, revision, domain, engineId, title, cause, scene } = value as Record<string, unknown>
  if (typeof sceneId !== 'string' || sceneId.length === 0) fail('physics/scene sceneId must be a non-empty string')
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    fail('physics/scene revision must be a non-negative integer')
  }
  for (const [field, entry] of Object.entries({ domain, engineId, title })) {
    if (typeof entry !== 'string') fail(`physics/scene ${field} must be a string`)
  }
  if (typeof cause !== 'string' || !CAUSES.has(cause)) fail(`physics/scene carries unknown cause ${JSON.stringify(cause)}`)
  if (typeof scene !== 'object' || scene === null) fail('physics/scene scene must be the PhysicsScene object')
  const embedded = scene as Record<string, unknown>
  if (embedded.schemaVersion !== SCENE_SCHEMA) fail(`physics/scene scene.schemaVersion must be ${SCENE_SCHEMA}`)
  if (embedded.id !== sceneId) fail('physics/scene scene.id must equal sceneId')
  if (embedded.revision !== revision) fail('physics/scene scene.revision must equal revision')
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'physics/scene') validateSnapshot(event.data, fail)
}

/** Install validation for loaded and newly appended scene snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the scene-snapshot invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
