import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CapturedResult, DatasetExtractionOptions, DatasetObject, PublicCapturedResult } from '@physicsos/physics-workbench/types'
import { captureDatasets, publicCapturedResult } from '@physicsos/physics-workbench/data'
import type { WorkspaceFrame, WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

/** Retain memoized panel identities while excluding the legacy sample callback. */
export const workspaceFrameOf = (snapshot: WorkspaceSnapshot): WorkspaceFrame => {
  const { sampleReadout: _sampleReadout, ...frame } = snapshot
  return frame
}

export class WorkspaceCaptureError extends Error {
  readonly code: 'CAPTURE_UNAVAILABLE' | 'CAPTURE_REVISION_MISMATCH'
  constructor(code: WorkspaceCaptureError['code'], message: string) {
    super(message)
    this.name = 'WorkspaceCaptureError'
    this.code = code
  }
}

/** Captured engine evidence belongs to exactly one committed scene revision. */
export const assertCaptureRevision = (capture: CapturedResult, scene: PhysicsScene = capture.scene): void => {
  const sceneId = String(scene.id)
  const revision = scene.revision
  if (String(capture.scene.id) !== sceneId || capture.scene.revision !== revision) {
    throw new WorkspaceCaptureError('CAPTURE_REVISION_MISMATCH', 'The held capture does not belong to this committed scene.')
  }
  if (capture.request !== undefined &&
    (String(capture.request.sceneId) !== sceneId || capture.request.sceneRevision !== revision)) {
    throw new WorkspaceCaptureError('CAPTURE_REVISION_MISMATCH', 'The held simulation request belongs to a different scene revision.')
  }
  if (capture.result !== undefined &&
    (String(capture.result.sceneId) !== sceneId || capture.result.sceneRevision !== revision ||
      (capture.request !== undefined && String(capture.request.simulationId) !== String(capture.result.simulationId)))) {
    throw new WorkspaceCaptureError('CAPTURE_REVISION_MISMATCH', 'The held simulation result does not match its request and scene.')
  }
  for (const dataset of capture.analysis ?? []) {
    if (dataset.origin.sceneId !== sceneId || dataset.origin.sceneRevision !== revision ||
      (dataset.origin.simulationId !== undefined && capture.result !== undefined &&
        dataset.origin.simulationId !== String(capture.result.simulationId))) {
      throw new WorkspaceCaptureError('CAPTURE_REVISION_MISMATCH', 'An analysis dataset belongs to a different simulation revision.')
    }
  }
}

/** No solve, stateAt call, formatted-table parsing, or snapshot cloning occurs here. */
export const captureWorkspaceRuntime = (
  runtime: WorkspaceRuntime,
  committedScene?: PhysicsScene,
): PublicCapturedResult => {
  if (runtime.captureRaw === undefined) {
    throw new WorkspaceCaptureError('CAPTURE_UNAVAILABLE', 'This runtime does not expose held engine evidence.')
  }
  // A retained publication method is an optimization, never schema authority.
  // Caller-supplied methods pass the same revision and full public validation.
  const capture = runtime.capturePublished === undefined ? runtime.captureRaw() : runtime.capturePublished()
  assertCaptureRevision(capture, committedScene)
  // The owner may maintain Notebook/release metadata separately from engine facts.
  const scene = committedScene ?? capture.scene
  const release = scene.metadata.experimentRelease
  return publicCapturedResult({
    ...capture,
    scene,
    engineInfo: { ...capture.engineInfo, ...(release === undefined ? {} : { release }) },
  })
}

export const workspaceCaptureDatasets = (
  capture: CapturedResult,
  options: DatasetExtractionOptions,
): readonly DatasetObject[] => {
  assertCaptureRevision(capture)
  return captureDatasets(capture, options)
}
