import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'
import type { ExperimentSession } from './experiment-session.ts'
import { lensParameter } from './lens-bench.ts'

/** Public protocol v1 deliberately carries only the experiment's physical facts. */
export interface ContributionSnapshot {
  readonly revision: number
  readonly source: 'platform-engine'
  readonly parameters: {
    readonly objectDistanceCm: number
    readonly focalLengthCm: number
    readonly screenDistanceCm: number
  }
  readonly result: {
    readonly imageDistanceCm: number | null
    readonly imageHeightCm: number | null
    readonly imageKind: 'real' | 'virtual' | 'none'
    readonly screenSharp: boolean
  }
}

export function contributionSnapshot(frame: WorkspaceSnapshot): ContributionSnapshot {
  const image = frame.view.opticalImages?.[0]
  const elementX = frame.view.opticalElements?.[0]?.at.x ?? 0
  return {
    revision: frame.sceneRevision,
    source: 'platform-engine',
    parameters: {
      objectDistanceCm: lensParameter(frame, 'object-distance'),
      focalLengthCm: lensParameter(frame, 'focal-length'),
      screenDistanceCm: lensParameter(frame, 'screen-distance'),
    },
    result: {
      imageDistanceCm: image === undefined ? null : image.at.x - elementX,
      imageHeightCm: image?.height ?? null,
      imageKind: image?.nature ?? 'none',
      screenSharp: frame.view.opticalScreens?.[0]?.lit === true,
    },
  }
}

export function isContributionMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Only these bounded intents can cross the package boundary. No arbitrary commands. */
export function applyContributionIntent(session: ExperimentSession, value: unknown): boolean {
  if (!isContributionMessage(value)) return false
  if (value.type === 'parameter/cancel') {
    session.cancelPreview()
    return true
  }
  if (value.type !== 'parameter/preview' && value.type !== 'parameter/commit') return false
  const id =
    value.id === 'objectDistanceCm'
      ? 'object-distance'
      : value.id === 'focalLengthCm'
        ? 'focal-length'
        : value.id === 'screenDistanceCm'
          ? 'screen-distance'
          : undefined
  if (id === undefined || typeof value.value !== 'number' || !Number.isFinite(value.value))
    return false
  const parameter = session
    .getSnapshot()
    .inspector.flatMap(section => section.parameters ?? [])
    .find(item => item.id === id)
  if (
    parameter === undefined ||
    value.value < (parameter.min ?? 1) ||
    value.value > Math.min(parameter.max ?? 200, 200)
  )
    return false
  if (value.type === 'parameter/preview') session.previewParameter(id, value.value)
  else session.commitParameter(id, value.value)
  return true
}
