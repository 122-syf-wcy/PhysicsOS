/**
 * Per-parent code checkpoints: the shared write budget and committed source
 * of one generation job, kept across the job's child runs so a resume after
 * a token limit or an upstream fault continues the same files instead of
 * starting over. A parent holds at most one checkpoint; a different job or
 * scene revision replaces it.
 * @module @deepseek-ai/dsh-tool-physicsos/code-checkpoints
 */

import { QuestionCodeParts } from './question-code-parts.ts'

/** Identity of the job a checkpoint belongs to. */
export interface CheckpointKey {
  readonly jobId: string
  readonly sceneId: string
  readonly revision: number
}

/** One checkpoint: its job identity and the source assembled so far. */
export interface Checkpoint extends CheckpointKey {
  readonly parts: QuestionCodeParts
  /** Forget this checkpoint; a no-op if the parent already moved to another. */
  release(): void
}

export class CodeCheckpoints {
  private readonly byParent = new WeakMap<object, Checkpoint>()

  /**
   * The checkpoint for `key`, resuming the parent's existing one when it is
   * the same job and scene revision, otherwise a fresh one that replaces it.
   * @param parent - the parent agent (identity only).
   * @param key - the job this child run serves.
   * @returns the checkpoint whose `parts` the child writes into.
   */
  acquire(parent: object, key: CheckpointKey): Checkpoint {
    const prior = this.byParent.get(parent)
    const resumable = prior !== undefined && prior.jobId === key.jobId
      && prior.sceneId === key.sceneId && prior.revision === key.revision
    const parts = resumable ? prior.parts : new QuestionCodeParts()
    prior?.release()
    const checkpoint: Checkpoint = {
      ...key,
      parts,
      release: () => {
        if (this.byParent.get(parent) === checkpoint) this.byParent.delete(parent)
      },
    }
    this.byParent.set(parent, checkpoint)
    return checkpoint
  }
}
