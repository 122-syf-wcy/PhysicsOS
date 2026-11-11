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
  const { sceneId, revision, domain, engineId, title, cause, scene, visualization } = value as Record<string, unknown>
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
  if (visualization !== undefined) {
    if (typeof visualization !== 'object' || visualization === null || Array.isArray(visualization)) fail('physics/scene visualization must be an object')
    const code = visualization as Record<string, unknown>
    if (!['generating', 'ready', 'failed'].includes(String(code.status))) fail('physics/scene visualization carries an unknown status')
    if (code.sceneId !== sceneId || code.sceneRevision !== revision) fail('physics/scene visualization must identify this exact scene revision')
    if (typeof code.ownerSessionId !== 'string' || !code.ownerSessionId) fail('physics/scene visualization requires an owner session')
    const common = ['status', 'ownerSessionId', 'sceneId', 'sceneRevision', 'requestSha256']
    if (code.requestSha256 !== undefined && (typeof code.requestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(code.requestSha256))) fail('physics/scene visualization.requestSha256 must be a SHA256 digest')
    const fields = code.status === 'ready' ? [...common, 'artifactId', 'sceneSha256', 'experimentId', 'sha256', 'title', 'rendererKind', 'childSessionId', 'createdAt'] : code.status === 'generating' ? [...common, 'jobId', 'deadlineAt'] : [...common, 'jobId', 'code', 'message']
    if (Object.keys(code).some(key => !fields.includes(key))) fail('physics/scene visualization cannot contain source code or capability URLs')
    if (code.status === 'ready') {
      if (code.rendererKind !== undefined && code.rendererKind !== 'independent') fail('physics/scene visualization.rendererKind must be independent when present')
      for (const key of ['sceneSha256', 'sha256']) if (typeof code[key] !== 'string' || !/^[a-f0-9]{64}$/.test(code[key])) fail(`physics/scene visualization.${key} must be a SHA256 digest`)
      for (const key of ['artifactId', 'experimentId', 'title', 'childSessionId', 'createdAt']) if (typeof code[key] !== 'string' || !code[key]) fail(`physics/scene visualization.${key} must be a nonempty string`)
    } else if (code.status === 'generating') {
      if (typeof code.jobId !== 'string' || !code.jobId) fail('physics/scene generating visualization requires a job id')
      if (code.deadlineAt !== undefined && (typeof code.deadlineAt !== 'number' || !Number.isSafeInteger(code.deadlineAt) || code.deadlineAt < 0)) fail('physics/scene generating deadlineAt must be a non-negative safe integer')
    } else {
      if (typeof code.code !== 'string' || typeof code.message !== 'string') fail('physics/scene failed visualization requires a coded message')
    }
  }

}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'physics/scene') validateSnapshot(event.data, fail)
}

/** Install validation for loaded and newly appended scene snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing invariant replay; migration deferred.
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
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
