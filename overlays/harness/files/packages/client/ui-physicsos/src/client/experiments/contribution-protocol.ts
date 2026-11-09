import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'
import type { ExperimentSession } from './experiment-session.ts'
import { lensParameter } from './lens-bench.ts'
import { PLAYBACK_RATES } from '../animation-clock.ts'

import type { ExperimentSnapshot } from './contract-wire.ts'
import {
  isUniversalExperimentIntent,
  type UniversalExperimentSnapshot,
} from './universal-contract.ts'
import type { ObservableKey } from '../physics/scene-visual-model.ts'

export type ContributionSnapshot = ExperimentSnapshot & { readonly source: 'platform-engine' }

export function contributionSnapshot(frame: WorkspaceSnapshot): ContributionSnapshot {
  const image = frame.view.opticalImages?.[0]
  const elementX = frame.view.opticalElements?.[0]?.at.x ?? 0
  return {
    revision: frame.sceneRevision,
    source: 'platform-engine',
    parameters: {
      objectDistanceCm: lensParameter(frame, 'object-distance'),
      objectHeightCm: lensParameter(frame, 'object-height'),
      focalLengthCm: lensParameter(frame, 'focal-length'),
      screenDistanceCm: lensParameter(frame, 'screen-distance'),
    },
    visible: { image: frame.view.visible.image === true, rays: frame.view.visible.rays === true },
    rays: (frame.view.opticalRays ?? []).map(ray => ({
      points: ray.points.map(point => ({ x: point.x - elementX, y: point.y })),
      ...(ray.extension === undefined
        ? {}
        : { extension: ray.extension.map(point => ({ x: point.x - elementX, y: point.y })) }),
    })),
    result: {
      imageDistanceCm: image === undefined ? null : image.at.x - elementX,
      imageHeightCm: image?.height ?? null,
      imageKind: image?.nature ?? 'none',
      screenSharp: frame.view.opticalScreens?.[0]?.lit === true,
    },
  }
}

/** The package sees the selected engine's render facts, never saved scene/account data. */
export function universalContributionSnapshot(
  frame: WorkspaceSnapshot,
  experimentId: string,
): UniversalExperimentSnapshot {
  if (frame.status === 'failed') throw new Error('Failed platform physics state')
  // Runtime views have optional undefined fields. Normalize once to the exact
  // JSON wire representation; sampleReadout and persisted scene metadata are
  // deliberately absent from this allowlist.
  return JSON.parse(JSON.stringify({
    experimentId,
    revision: frame.sceneRevision,
    source: 'platform-engine',
    domain: frame.domain,
    title: frame.title,
    view: frame.view,
    inspector: frame.inspector,
    clock: frame.clock,
    table: frame.table,
    charts: frame.charts,
    verification: frame.verification,
    events: frame.events,
    trajectoryTimes: frame.trajectoryTimes,
    ariaLabel: frame.ariaLabel,
  }, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Invalid platform render facts')
    return value
  })) as UniversalExperimentSnapshot
}

/** V3 uses current inspector IDs/options and only the runtime's declared bounds. */
export function applyUniversalContributionIntent(session: ExperimentSession, value: unknown): boolean {
  if (!isUniversalExperimentIntent(value)) return false
  const frame = session.getSnapshot()
  const runtime = session.runtime
  switch (value.type) {
    case 'parameter/cancel':
      session.cancelPreview()
      return true
    case 'parameter/preview':
    case 'parameter/commit': {
      const parameter = frame.inspector.flatMap(section => section.parameters ?? [])
        .find(item => item.id === value.id)
      if (parameter === undefined ||
        (parameter.min !== undefined && value.value < parameter.min) ||
        (parameter.max !== undefined && value.value > parameter.max)) return false
      if (value.type === 'parameter/preview') session.previewParameter(value.id, value.value)
      else session.commitParameter(value.id, value.value)
      return true
    }
    case 'choice/set': {
      const choice = frame.inspector.flatMap(section => section.choices ?? [])
        .find(item => item.id === value.id)
      if (!choice?.options.some(option => option.value === value.value)) return false
      session.cancelPreview()
      session.commit(runtime.setChoice(value.id, value.value))
      return true
    }
    case 'observable/set':
      if (!Object.hasOwn(frame.view.visible, value.key) ||
        typeof frame.view.visible[value.key as ObservableKey] !== 'boolean') return false
      session.commit(runtime.setObservable(value.key as ObservableKey, value.enabled))
      return true
    case 'playback/running':
      if (frame.clock.total <= 0 || frame.status === 'failed') return false
      session.commit(runtime.setRunning(value.running))
      return true
    case 'playback/rate':
      if (frame.clock.total <= 0 || !PLAYBACK_RATES.includes(value.rate)) return false
      session.commit(runtime.setRate(value.rate))
      return true
    case 'playback/seek':
      if (frame.clock.total <= 0 || value.time < 0 || value.time > frame.clock.total) return false
      session.commit(runtime.seek(value.time))
      return true
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
