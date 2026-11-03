import type { ExperimentObservation, PhysicsScene } from '@physicsos/physics-scene'
import { createFrameSource } from '../physics/frame-source.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

import { captureObservation, NOTEBOOK_LIMIT, readNotebook } from './experiment-notebook.ts'

/** Shared command/clock boundary for both the generic workspace and dedicated pages. */
export function createExperimentSession(
  runtime: WorkspaceRuntime,
  onSceneChange?: (scene: PhysicsScene) => void,
) {
  let summary = runtime.getSnapshot()
  let notebook: readonly ExperimentObservation[] = readNotebook(runtime.getScene?.())
  let previewing = false
  let release = runtime.getScene?.().metadata.experimentRelease
  const savedScene = (): PhysicsScene | undefined => {
    const scene = runtime.getScene?.()
    if (scene === undefined) return undefined
    const metadata = { ...scene.metadata }
    delete metadata.experimentRelease
    if (release !== undefined) metadata.experimentRelease = { ...release }
    return {
      ...scene,
      metadata: { ...metadata, experimentNotebook: { version: 1, entries: notebook } },
    }
  }
  let lastSummaryAt = 0
  const frames = createFrameSource(summary)
  const listeners = new Set<() => void>()
  const publish = (next: WorkspaceSnapshot): void => {
    summary = next
    for (const listener of listeners) listener()
  }
  const commit = (next: WorkspaceSnapshot): void => {
    const previous = summary
    frames.set(next)
    publish(next)
    if (previous.sceneRevision !== next.sceneRevision || previous.branch !== next.branch) {
      const scene = savedScene()
      if (scene !== undefined) onSceneChange?.(scene)
    }
  }
  return {
    runtime,
    frames,
    getSnapshot: () => summary,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    commit,
    getScene: savedScene,
    setRelease: (next: PhysicsScene['metadata']['experimentRelease']) => {
      release = next === undefined ? undefined : { ...next }
      const saved = savedScene()
      if (saved !== undefined) onSceneChange?.(saved)
    },
    getNotebook: () => notebook,
    isPreviewing: () => previewing,
    recordObservation: () => {
      if (previewing || notebook.length >= NOTEBOOK_LIMIT) return
      const scene = runtime.getScene?.()
      if (scene === undefined) return
      const entry = captureObservation(scene, summary)
      if (entry === undefined) return
      notebook = [
        ...notebook,
        { ...entry, ...(release === undefined ? {} : { experimentRelease: { ...release } }) },
      ]
      publish({ ...summary })
      const saved = savedScene()
      if (saved !== undefined) onSceneChange?.(saved)
    },
    removeObservation: (id: string) => {
      notebook = notebook.filter(entry => entry.id !== id)
      publish({ ...summary })
      const saved = savedScene()
      if (saved !== undefined) onSceneChange?.(saved)
    },
    previewParameter: (id: string, value: number) => {
      const next = runtime.previewParameter?.(id, value)
      if (next !== undefined) {
        previewing = true
        frames.set(next)
        publish(next)
      }
    },
    commitParameter: (id: string, value: number) => {
      previewing = false
      // Compare against committed facts, never the temporary preview's branch.
      runtime.cancelParameterPreview?.()
      summary = runtime.getSnapshot()
      commit(runtime.commitParameter?.(id, value) ?? runtime.editParameter(id, value))
    },
    cancelPreview: () => {
      previewing = false
      const next = runtime.cancelParameterPreview?.() ?? runtime.getSnapshot()
      frames.set(next)
      publish(next)
    },
    advance: (elapsed: number, now = performance.now()) => {
      const next = runtime.advance(elapsed)
      frames.set(next)
      if (
        next.status !== summary.status ||
        next.sceneRevision !== summary.sceneRevision ||
        next.clock.running !== summary.clock.running ||
        now - lastSummaryAt >= 250
      ) {
        lastSummaryAt = now
        publish(next)
      }
    },
  }
}

export type ExperimentSession = ReturnType<typeof createExperimentSession>
