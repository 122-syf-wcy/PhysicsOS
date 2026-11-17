import type { ExperimentObservation, PhysicsScene } from '@physicsos/physics-scene'
import { createFrameSource } from '../physics/frame-source.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

import { captureObservation, NOTEBOOK_LIMIT, readNotebook } from './experiment-notebook.ts'

/** Host-only observations, never a wire event accepted from an iframe. Not a physics certificate. */
export interface ExperimentRunBoundary {
  readonly source: 'platform-engine'
  readonly kind: 'started' | 'first-step' | 'cancelled'
  readonly intent: number
}
const validRunFrame = (frame: WorkspaceSnapshot): boolean => frame.status !== 'failed' && frame.error === undefined &&
  !frame.verification.some(check => check.status === 'failed') && Number.isSafeInteger(frame.sceneRevision) && frame.sceneRevision >= 0
const validRunClock = (clock: WorkspaceSnapshot['clock'] | undefined): clock is WorkspaceSnapshot['clock'] => clock !== undefined &&
  Number.isFinite(clock.time) && clock.time >= 0 && Number.isFinite(clock.total) && clock.total > 0 && clock.time <= clock.total &&
  Number.isFinite(clock.rate) && clock.rate > 0 && typeof clock.running === 'boolean'

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
  const runListeners = new Set<(event: ExperimentRunBoundary) => void>()
  let intentSequence = 0
  let pendingRun: { readonly intent: number; readonly sceneRevision: number } | undefined
  const emitRun = (kind: ExperimentRunBoundary['kind'], intent: number): void => {
    for (const listener of runListeners) {
      try { listener({ source: 'platform-engine', kind, intent }) } catch { /* Recording must never affect the runtime. */ }
    }
  }
  const cancelRun = (): void => {
    const pending = pendingRun
    pendingRun = undefined
    if (pending !== undefined) emitRun('cancelled', pending.intent)
  }
  const physicalClock = (frame: WorkspaceSnapshot): WorkspaceSnapshot['clock'] | undefined => {
    try { return runtime.getPhysicalClock?.() ?? frame.clock } catch { return undefined }
  }
  const publish = (next: WorkspaceSnapshot): void => {
    summary = next
    for (const listener of listeners) listener()
  }
  const commit = (next: WorkspaceSnapshot): void => {
    const previous = summary
    // Seek/step/edit/failed state cancels an uncompleted run; generic snapshot commits never invent a play intent.
    if (pendingRun !== undefined && (!validRunFrame(next) || !next.clock.running || next.sceneRevision !== pendingRun.sceneRevision || next.clock.time !== previous.clock.time)) cancelRun()
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
    subscribeRun: (listener: (event: ExperimentRunBoundary) => void) => {
      runListeners.add(listener)
      return () => { runListeners.delete(listener) }
    },
    /** All host and MessagePort play commands enter here. No DOM listeners infer playback. */
    setRunning: (running: boolean, observeRun = true) => {
      const before = runtime.getSnapshot()
      let next: WorkspaceSnapshot
      try { next = runtime.setRunning(running) } catch (error) { cancelRun(); throw error }
      commit(next)
      const clock = physicalClock(next)
      let timePlayback = false
      try { timePlayback = runtime.getPlaybackKind?.() !== 'static' } catch { /* An uncertain clock is not run evidence. */ }
      if (observeRun && running && !before.clock.running && next.clock.running && validRunFrame(next) && validRunClock(clock) && timePlayback) {
        cancelRun()
        pendingRun = { intent: ++intentSequence, sceneRevision: next.sceneRevision }
        emitRun('started', pendingRun.intent)
      } else if (!observeRun || !running || !validRunFrame(next)) cancelRun()
      return next
    },
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
      cancelRun()
      const next = runtime.previewParameter?.(id, value)
      if (next !== undefined) {
        previewing = true
        frames.set(next)
        publish(next)
      }
    },
    commitParameter: (id: string, value: number) => {
      cancelRun()
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
      // Observe once while an explicit intent is awaiting its first step, never add a polling read to every animation frame.
      const pending = pendingRun, before = pending === undefined ? undefined : runtime.getSnapshot()
      const beforeClock = before === undefined ? undefined : physicalClock(before)
      let next: WorkspaceSnapshot
      try { next = runtime.advance(elapsed) } catch (error) { cancelRun(); throw error }
      const afterClock = pending === undefined ? undefined : physicalClock(next)
      if (pending !== undefined) {
        if (before === undefined || next.sceneRevision !== pending.sceneRevision || !validRunFrame(before) || !validRunFrame(next) || !validRunClock(beforeClock) || !validRunClock(afterClock)) cancelRun()
        else if (Number.isFinite(elapsed) && elapsed > 0 && beforeClock.running && (afterClock.time > beforeClock.time ||
          afterClock.running && afterClock.total === beforeClock.total && afterClock.time < beforeClock.time)) {
          // The trusted runtime returned a valid advanced clock (or wrapped its finite looping window).
          // Ready/rendered/seek/poll cannot reach this branch; periodic engines expose getPhysicalClock when available.
          pendingRun = undefined
          emitRun('first-step', pending.intent)
        } else if (!afterClock.running) cancelRun()
      }
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
