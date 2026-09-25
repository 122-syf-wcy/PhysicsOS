/**
 * Package-owned durable invariants for `physicsos_paper`.
 *
 * The two relations the whole workflow stands on: a `verified` blueprint may
 * only sit on `verified` source papers, and an `approved`/`exported` job's
 * approval hash must equal its latest version hash AND the live document
 * hash — the binding that makes post-approval edits void the approval.
 * @module @deepseek-ai/dsh-paper-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { documentHash, type ExamBlueprint, type PaperJob, type SourcePaper } from '@physicsos/question-paper'

const PACKAGE_NAME = '@deepseek-ai/dsh-paper-host'
const DOMAIN = 'physicsos_paper'

/** Cordis companion plugin name. */
export const name = 'paper-host-invariant'
/**
 * Service required before the companion can reserve package ownership.
 *
 * `invariants` ONLY, matching every other package's companion. Listing
 * `storageDomain` here reads like rigour and is actually a deadlock: the
 * companion is mounted inside the invariant startup barrier, so a companion
 * that waits for a Loader-managed service waits for a row that is itself
 * held at that barrier. The domain is reached lazily inside {@link check}
 * instead — by the time a `domain/changed` event fires, the service exists.
 */
export const inject = ['invariants']

/** Re-check the durable relations after each change lands. */
const check = (ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN) return
  const domain = ctx.storageDomain.get(DOMAIN)
  if (domain === undefined) return

  if (change.table === 'blueprints' && change.operation === 'put') {
    const blueprint = change.value as ExamBlueprint
    if (blueprint.status !== 'verified') return
    for (const sourceId of blueprint.basedOn) {
      const source = domain.table('source_papers').get(sourceId) as SourcePaper | undefined
      if (source?.status !== 'verified') {
        fail(`blueprint '${blueprint.id}' is verified on unverified source '${sourceId}'`)
      }
    }
    return
  }

  if (change.table === 'jobs' && change.operation === 'put') {
    const job = change.value as PaperJob
    if (job.status !== 'approved' && job.status !== 'exported') return
    const current = job.versions.at(-1)
    if (current === undefined) fail(`job '${job.id}' is ${job.status} with no version`)
    else if (job.approval === undefined) fail(`job '${job.id}' is ${job.status} without approval`)
    else if (job.approval.versionHash !== current.hash) {
      fail(`job '${job.id}' approval binds ${job.approval.versionHash}, current is ${current.hash}`)
    }
    if (job.document !== undefined && documentHash(job.document) !== current.hash) {
      fail(`job '${job.id}' document hash drifted from version ${current.version}`)
    }
  }
}

/** Install the relation checks on every domain change. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => { check(ctx, change, fail) })
}

/**
 * Register the paper-domain invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
