/**
 * Experimental branch fork.
 *
 * A question states FACTS. Asking "what if the height were 30 m" is a different
 * physical world, so the Lab forks rather than advancing the question's own
 * revision — otherwise the solution the student just read would silently start
 * describing a scene that no longer matches the problem text.
 *
 * The fork is a plain `PhysicsScene` with lineage in its metadata; there is no
 * second scene contract and no diffing. Playback, seeking and observable toggles
 * are NOT forks: they change what is shown, not what is true.
 */

import { asSceneId, type IsoDateTime, type SceneId } from '@physicsos/shared'

import type { PhysicsScene, SceneLineage } from './scene.ts'

export interface ForkExperimentalSceneInput {
  /** Untouched scene the branch starts from. */
  readonly scene: PhysicsScene
  /** Stable id for the branch; a caller may supply one for reproducible tests. */
  readonly sceneId?: string
  readonly now?: IsoDateTime
  /** Branch title; defaults to the parent's title marked as an experiment. */
  readonly title?: string
}

const clone = <T>(value: T): T => structuredClone(value)

/**
 * Fork a scene into an experimental branch.
 *
 * The branch starts at revision 0: it is a NEW world, and inheriting the parent's
 * revision number would make two different scenes claim the same version. The
 * parent's revision is preserved in `lineage.parentRevision`, which is what a
 * "restore the original conditions" action needs.
 *
 * A branch of a branch keeps pointing at the ORIGINAL scene through
 * `lineage.originSceneId`, so the way back is always one hop for the student.
 */
export const forkExperimentalScene = (input: ForkExperimentalSceneInput): PhysicsScene => {
  const { scene } = input
  const now = input.now ?? (new Date().toISOString() as IsoDateTime)
  const parentLineage = scene.metadata.lineage
  const sceneId: SceneId = asSceneId(
    input.sceneId ?? `experiment-${String(scene.id)}-r${scene.revision}-${Date.now()}`,
  )

  const lineage: SceneLineage = {
    origin: parentLineage?.origin ?? (scene.metadata.sourceQuestionId === undefined ? 'template' : 'question'),
    branchType: 'experimental',
    ...(scene.metadata.sourceQuestionId === undefined
      ? parentLineage?.originQuestionId === undefined
        ? {}
        : { originQuestionId: parentLineage.originQuestionId }
      : { originQuestionId: scene.metadata.sourceQuestionId }),
    originSceneId: parentLineage?.originSceneId ?? scene.id,
    parentSceneId: scene.id,
    parentRevision: scene.revision,
    forkedAt: now,
  }

  const title = input.title ?? scene.metadata.title
  return {
    ...clone(scene),
    id: sceneId,
    revision: 0,
    metadata: {
      ...clone(scene.metadata),
      createdAt: now,
      updatedAt: now,
      ...(title === undefined ? {} : { title }),
      lineage,
    },
  }
}

/** Whether a scene is an experimental branch rather than an original. */
export const isExperimentalBranch = (scene: PhysicsScene): boolean =>
  scene.metadata.lineage?.branchType === 'experimental'
