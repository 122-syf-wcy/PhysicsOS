import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CodeVisualizationState } from '@deepseek-ai/dsh-tool-physicsos/types'
import type { SnapshotStore } from '../runtime-compat.ts'
import { questionCodeApi, questionCodeGenerationJobMatches, questionCodeGenerationStatus, questionCodeRefMatches, type QuestionCodeJobView } from './question-code-api.ts'
export type QuestionCodeOwnerStore = Pick<SnapshotStore<string | undefined>, 'getSnapshot' | 'subscribe'> & {
  /** Shared only within this root's authenticated owner; optional for snapshot-only consumers. */
  readonly generationJobs?: {
    readonly getSnapshot: (key: string) => QuestionCodeJobView | undefined
    readonly getOwnerEpoch: () => number
    readonly subscribe: (listener: () => void) => () => void
    readonly publish: (key: string, job: QuestionCodeJobView) => void
  }
}
const terminalJob = (job: QuestionCodeJobView): boolean =>
  job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'superseded'
/** Inject one root-owned store across optional bundles; ownership must never be copied into module globals. */
export function createQuestionCodeOwnerStore() {
  let ownerSessionId: string | undefined
  let ownerEpoch = 0
  const listeners = new Set<() => void>()
  const jobs = new Map<string, QuestionCodeJobView>()
  const jobListeners = new Set<() => void>()
  return {
    generationJobs: {
      getSnapshot: (key: string) => jobs.get(key),
      getOwnerEpoch: () => ownerEpoch,
      subscribe: (listener: () => void) => {
        jobListeners.add(listener)
        return () => { jobListeners.delete(listener) }
      },
      publish: (key: string, job: QuestionCodeJobView): void => {
        const previous = jobs.get(key)
        if (previous !== undefined && (previous.updatedAt > job.updatedAt
          || previous.updatedAt === job.updatedAt && terminalJob(previous) && !terminalJob(job))) return
        jobs.set(key, job)
        for (const listener of jobListeners) listener()
      },
    },
    getSnapshot: () => ownerSessionId,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: string | undefined): void => {
      if (ownerSessionId === next) return
      ownerSessionId = next
      ownerEpoch += 1
      jobs.clear()
      for (const listener of listeners) listener()
      for (const listener of jobListeners) listener()
    },
  }
}
const emptyStore: QuestionCodeOwnerStore = { getSnapshot: () => undefined, subscribe: () => () => {} }
export function useQuestionCodeOwner(store: QuestionCodeOwnerStore = emptyStore): string | undefined {
  return useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot(), () => undefined)
}
/** Read the current generating job without allocating a renderer or changing the saved scene. */
export function useQuestionCodeGeneration(
  visualization: CodeVisualizationState | undefined,
  scene: { readonly id: string; readonly revision: number },
  store: QuestionCodeOwnerStore = emptyStore,
) {
  const owner = useQuestionCodeOwner(store)
  const ownerEpoch = useSyncExternalStore(
    listener => store.generationJobs?.subscribe(listener) ?? (() => {}),
    () => store.generationJobs?.getOwnerEpoch() ?? 0,
    () => 0,
  )
  const bound = visualization !== undefined && questionCodeRefMatches(visualization, scene, owner)
  const jobId = bound && visualization.status === 'generating' ? visualization.jobId : undefined
  const deadlineAt = visualization?.status === 'generating' ? visualization.deadlineAt : undefined
  const key = JSON.stringify([owner, ownerEpoch, scene.id, scene.revision, jobId, visualization?.requestSha256])
  const [observed, setObserved] = useState<{ readonly key: string; readonly job: QuestionCodeJobView }>()
  const sharedJob = useSyncExternalStore(
    listener => store.generationJobs?.subscribe(listener) ?? (() => {}),
    () => store.generationJobs?.getSnapshot(key),
    () => undefined,
  )
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      const timestamp = Date.now()
      setNow(timestamp)
      if (deadlineAt !== undefined && Number.isFinite(deadlineAt) && deadlineAt > timestamp) {
        timer = setTimeout(tick, Math.min(2_147_483_647, deadlineAt - timestamp + 1))
      }
    }
    tick()
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [key, deadlineAt])
  useEffect(() => {
    if (jobId === undefined) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = (): boolean => !abort.signal.aborted && store.getSnapshot() === owner
    // Revoke immediately, including a switch away and back before React commits.
    const stopOwner = store.subscribe(() => {
      if (store.getSnapshot() !== owner) { abort.abort(); setObserved(undefined) }
    })
    const again = (delay: number): void => {
      if (current() && deadlineAt !== undefined && Number.isFinite(deadlineAt) && deadlineAt > Date.now()) timer = setTimeout(poll, delay)
    }
    const poll = (): void => {
      if (!current()) return
      void questionCodeApi.job(jobId, abort.signal).then(next => {
        if (!current()) return
        if (!questionCodeGenerationJobMatches(next, visualization) || next === undefined) { again(4000); return }
        if (store.generationJobs === undefined) setObserved({ key, job: next })
        else store.generationJobs.publish(key, next)
        if (!terminalJob(next)) again(1500)
      }).catch(() => { again(4000) })
    }
    timer = setTimeout(poll, 800)
    return () => { abort.abort(); stopOwner(); if (timer !== undefined) clearTimeout(timer) }
  }, [store, owner, key, jobId, deadlineAt])
  const candidate = store.generationJobs === undefined ? observed?.key === key ? observed.job : undefined : sharedJob
  const job = bound && questionCodeGenerationJobMatches(candidate, visualization) ? candidate : undefined
  const status = questionCodeGenerationStatus(visualization, scene, owner, Math.max(now, Date.now()), job)
  const message = status === 'failed' ? job?.message ?? (visualization?.status === 'failed' ? visualization.message : undefined) : undefined
  return { owner, status, job, message, bindingKey: key }
}
