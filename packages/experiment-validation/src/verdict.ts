/**
 * Pure acceptance verdict for one generated experiment candidate.
 *
 * The browser driver collects observations; this module decides. Keeping the
 * decision here means the same rules are unit-tested without a browser and
 * the driver cannot "pass" a candidate by forgetting a check.
 */

export type CheckName =
  | 'first-frame'
  | 'runtime-error'
  | 'subject-drawn'
  | 'geometry-follows-engine'
  | 'motion-sampled'
  | 'parameter-change'
  | 'mobile-layout'
  | 'scene-binding'

export interface Check {
  readonly name: CheckName
  readonly passed: boolean
  readonly detail?: string
}

/** One sampled frame: `view` is the engine's authoritative snapshot at this time. */
export interface SampledFrame {
  /** Engine clock time in seconds. */
  readonly time: number
  /** First body position in engine coordinates, when the domain has one. */
  readonly engineBody?: { readonly x: number; readonly y: number }
  /** Canvas attributes the renderer stamped from the same snapshot. */
  readonly stamped?: { readonly bodyX?: number; readonly bodyY?: number; readonly clockTime?: number }
  /** Cheap fingerprint of what was actually painted. */
  readonly paintHash: string
  /** Drawn geometry commands that were derived from engine facts. */
  readonly geometryCount: number
  /** Opaque pixels in the sample; a blank canvas is 0. */
  readonly opaquePixels: number
  readonly distinctColors: number
}

export interface Observation {
  /** Emitted `experiment/rendered` acknowledgement or false on timeout. */
  readonly firstFrameAcknowledged: boolean
  readonly runtimeError?: string
  readonly frames: readonly SampledFrame[]
  /** Whether at least one visible canvas/svg element existed at all. */
  readonly nativeSurface: boolean
  /** True when changing a parameter produced a new snapshot and different paint. */
  readonly parameterChanged?: boolean
  readonly changedPaintHash?: string
  readonly originalPaintHash?: string
  readonly mobile?: {
    readonly viewportWidth: number
    readonly scrollWidth: number
    /** Negative x or overflow means content is clipped off-screen. */
    readonly overflow: boolean
  }
  /** Digest of the candidate the browser actually loaded. */
  readonly candidateSha256: string
  /** Expected scene digest taken from the persisted task input. */
  readonly expectedSceneSha256: string
  readonly candidateSceneSha256: string
  readonly candidateSceneRevision: number
  readonly expectedSceneRevision: number
}

const finite = (value: number | undefined): boolean => value !== undefined && Number.isFinite(value)

/** Stamp tolerance: the renderer writes engine coordinates to attributes for exactly this check. */
const positionMatches = (frame: SampledFrame): boolean | undefined => {
  if (frame.engineBody === undefined || frame.stamped?.bodyY === undefined) return undefined
  const dy = Math.abs(frame.stamped.bodyY - frame.engineBody.y)
  const dx = frame.stamped.bodyX === undefined ? 0 : Math.abs(frame.stamped.bodyX - frame.engineBody.x)
  return dx <= 1e-6 && dy <= 1e-6
}

/**
 * Turn observations into checks. `passed` is the AND of all checks; any
 * missing observation fails closed rather than being treated as success.
 */
export function evaluateObservation(observation: Observation): { passed: boolean; checks: readonly Check[] } {
  const checks: Check[] = []
  const bound = observation.candidateSceneSha256 === observation.expectedSceneSha256
    && observation.candidateSceneRevision === observation.expectedSceneRevision
    && /^[a-f0-9]{64}$/.test(observation.candidateSha256)
  checks.push({
    name: 'scene-binding',
    passed: bound,
    detail: bound
      ? undefined
      : observation.candidateSceneSha256 !== observation.expectedSceneSha256
        ? '候选绑定的题目条件与任务不一致。'
        : observation.candidateSceneRevision !== observation.expectedSceneRevision
          ? '候选绑定的题目修订号已过期。'
          : '候选摘要无效。',
  })
  checks.push({ name: 'first-frame', passed: observation.firstFrameAcknowledged, detail: observation.firstFrameAcknowledged ? undefined : '15 秒内没有收到首帧绘制确认。' })
  checks.push({ name: 'runtime-error', passed: observation.runtimeError === undefined, detail: observation.runtimeError })
  const painted = observation.frames.filter(frame => frame.opaquePixels > 0 && (frame.distinctColors > 3 || frame.geometryCount > 0))
  checks.push({ name: 'subject-drawn', passed: observation.nativeSurface && painted.length === observation.frames.length && observation.frames.length > 0,
    detail: observation.nativeSurface ? undefined : '页面上没有 canvas/svg 绘制表面。' })

  const stamps = observation.frames.map(positionMatches).filter((value): value is boolean => value !== undefined)
  checks.push({
    name: 'geometry-follows-engine',
    passed: stamps.length > 0 && stamps.every(Boolean),
    detail: stamps.length === 0 ? '画面没有把引擎位置写入可核对属性，无法证明几何来自引擎。' : stamps.every(Boolean) ? undefined : '画面位置与引擎快照不一致。',
  })

  const times = observation.frames.map(frame => frame.time).filter(finite)
  const paints = new Set(observation.frames.map(frame => frame.paintHash))
  checks.push({
    name: 'motion-sampled',
    passed: observation.frames.length >= 2 && new Set(times).size >= 2 && paints.size > 1,
    detail: paints.size <= 1 ? '不同时刻画出了同一张静止画面。' : undefined,
  })

  const changed = observation.parameterChanged === true
    && observation.changedPaintHash !== undefined
    && observation.originalPaintHash !== undefined
    && observation.changedPaintHash !== observation.originalPaintHash
    && /^[a-f0-9]{64}$/.test(observation.changedPaintHash)
    && /^[a-f0-9]{64}$/.test(observation.originalPaintHash)
  checks.push({
    name: 'parameter-change',
    passed: changed,
    detail: changed
      ? undefined
      : observation.parameterChanged === true
        ? '改参后画出了相同的画面，疑似没有使用新快照。'
        : '没有观察到改参后的真实快照。',
  })

  const mobile = observation.mobile
  checks.push({
    name: 'mobile-layout',
    passed: mobile !== undefined && mobile.scrollWidth <= mobile.viewportWidth + 1 && !mobile.overflow,
    detail: mobile === undefined ? '没有手机视口结果。' : !(mobile.scrollWidth <= mobile.viewportWidth + 1) ? '手机视口出现横向溢出。' : mobile.overflow ? '实验主体超出手机视口。' : undefined,
  })

  return { passed: checks.every(check => check.passed), checks }
}
