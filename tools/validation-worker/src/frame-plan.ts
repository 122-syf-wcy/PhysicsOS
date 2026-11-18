/**
 * Build the engine snapshots a validation run needs, from a runtime surface
 * the caller supplies.
 *
 * The app already owns the authoritative physics runtime (the same adapter
 * that renders the Lab). This module turns that runtime into the three
 * sampled frames plus one parameter-change frame, without knowing which
 * domain it is and without re-solving anything: every snapshot comes from
 * `getSnapshot()`/`seek()`/`editParameter()`, i.e. from the verified engine.
 *
 * It is deliberately a plain shape so a host can implement it either against
 * the in-process runtime bridge or against the same interface in a worker.
 */

export interface SnapshotLike {
  readonly domain?: string
  readonly sceneRevision?: number
  readonly status?: string
  readonly title?: string
  readonly ariaLabel?: string
  readonly table?: object
  readonly charts?: readonly unknown[]
  readonly verification?: readonly unknown[]
  readonly trajectoryTimes?: readonly number[]
  /** Runtime-only behavior/authority; contributionSnapshot deliberately omits it. */
  readonly sampleReadout?: unknown
  readonly scene?: unknown
  readonly ownerSessionId?: string
  readonly clock: { readonly time: number; readonly total: number; readonly running?: boolean; readonly rate?: number }
  readonly view: {
    readonly bodies?: readonly { readonly at: { readonly x: number; readonly y: number } }[]
  }
  readonly inspector?: readonly {
    readonly id: string
    readonly parameters?: readonly { readonly id: string; readonly value: number; readonly min?: number; readonly max?: number; readonly step?: number }[]
  }[]
  readonly events?: readonly { readonly kind: string; readonly time: number }[]
}

/**
 * The wire copy of a runtime snapshot: plain JSON only.
 *
 * Runtime snapshots carry a `sampleReadout` closure for interactive hover.
 * It is behavior, not a fact, so it must not cross to the browser (the same
 * rule the product's own `universalContributionSnapshot` applies).
 */
export function wireSnapshot<T>(snapshot: T): T {
  return JSON.parse(JSON.stringify(snapshot, (key, value: unknown) => {
    if (key === 'sampleReadout') return undefined
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid engine value in snapshot')
    return value
  })) as T
}

export interface FrameSource {
  getSnapshot(): SnapshotLike
  seek?(time: number): SnapshotLike
  editParameter?(id: string, value: number): SnapshotLike
  /** Raw engine identity/cursor, read server-side only for a static policy. */
  captureRaw?(): {
    readonly scene?: unknown
    readonly engineInfo: { readonly id: string; readonly version: string; readonly model?: string }
    readonly cursor: { readonly kind: string; readonly identity?: string }
  }
}

export interface PlannedFrame {
  readonly frameId: string
  readonly snapshot: SnapshotLike
}

export interface FramePlan {
  readonly frames: readonly PlannedFrame[]
  /** Real edited snapshot (including its engine revision); absent without an editable parameter. */
  readonly changedFrame?: PlannedFrame
  readonly parameter?: { readonly id: string; readonly from: number; readonly to: number }
  readonly notes: readonly string[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Pick sample times: t0, the declared apex/impact event if any, and the end. */
export function sampleTimes(snapshot: SnapshotLike): number[] {
  const total = finite(snapshot.clock.total) ? snapshot.clock.total : 0
  const events = snapshot.events ?? []
  const apex = events.find(event => event.kind === 'apex' && finite(event.time))
  const impact = events.find(event => event.kind === 'impact' && finite(event.time))
  const candidates = [0, apex?.time, impact?.time, total]
    .filter((value): value is number => finite(value) && value >= 0)
  const unique = [...new Set(candidates.map(value => Math.round(value * 1000) / 1000))]
  if (unique.length >= 2) return unique.slice(0, 4)
  // A zero-duration engine has only its actual frozen time. The motion policy
  // then fails honestly; only a trusted static profile may replay this state.
  return total > 0 ? [0, total] : [snapshot.clock.time]
}

/** Step a numeric parameter by one visible unit inside its declared range. */
function changedValue(parameter: { readonly value: number; readonly min?: number; readonly max?: number; readonly step?: number }): number | undefined {
  const step = finite(parameter.step) && parameter.step > 0 ? parameter.step : Math.max(1, Math.abs(parameter.value) * 0.1)
  const direction = parameter.value + step <= (finite(parameter.max) ? parameter.max : Number.POSITIVE_INFINITY) ? 1 : -1
  const next = parameter.value + step * direction
  const min = finite(parameter.min) ? parameter.min : Number.NEGATIVE_INFINITY
  const max = finite(parameter.max) ? parameter.max : Number.POSITIVE_INFINITY
  return next >= min && next <= max && next !== parameter.value ? Math.round(next * 1e6) / 1e6 : undefined
}

/**
 * Produce the plan. Returns no `changedFrame` when there is no numeric
 * parameter to move — the verdict then reports `parameter-change` as failed
 * rather than silently skipping the check.
 */
export function planFrames(source: FrameSource): FramePlan {
  const base = source.getSnapshot()
  const notes: string[] = []
  const frames: PlannedFrame[] = []
  for (const [index, time] of sampleTimes(base).entries()) {
    if (source.seek === undefined) {
      if (index > 0) break
      frames.push({ frameId: 'f0', snapshot: base })
      continue
    }
    const snapshot = index === 0 ? base : source.seek(time)
    frames.push({ frameId: `f${index}`, snapshot })
  }
  if (source.seek === undefined) notes.push('运行时没有 seek 接口，只采样了当前帧。')
  const parameter = base.inspector
    ?.flatMap(section => section.parameters ?? [])
    .find(item => finite(item.value) && changedValue(item) !== undefined)
  if (parameter === undefined || source.editParameter === undefined) {
    notes.push('运行时没有可编辑的数值参数，改参检查将无法通过。')
    return { frames, notes }
  }
  const to = changedValue(parameter)!
  let changed: SnapshotLike
  try {
    changed = source.editParameter(parameter.id, to)
  } catch (error) {
    notes.push(`改参失败：${error instanceof Error ? error.message : 'unknown'}`)
    return { frames, notes }
  }
  return {
    frames,
    changedFrame: { frameId: 'f-changed', snapshot: changed },
    parameter: { id: parameter.id, from: parameter.value, to },
    notes,
  }
}
