/**
 * Pure acceptance verdict for one generated experiment candidate.
 *
 * The browser driver collects observations; this module decides. Missing or
 * unattributable evidence fails closed, including a frame with only stamps.
 */
import type { BrowserFrame, DrawnBody } from './types.ts'

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

/** Engine facts plus observations of the actual innermost drawing surface. */
export type SampledFrame = BrowserFrame

export interface Observation {
  /** Emitted `experiment/rendered` acknowledgement or false on timeout. */
  readonly firstFrameAcknowledged: boolean
  readonly runtimeError?: string
  readonly frames: readonly SampledFrame[]
  /** Whether at least one visible canvas/svg element existed at all. */
  readonly nativeSurface: boolean
  readonly changedFrame?: SampledFrame
  readonly parameterChanged?: boolean
  readonly changedPaintHash?: string
  readonly originalPaintHash?: string
  readonly mobile?: {
    readonly viewportWidth: number
    readonly scrollWidth: number
    readonly overflow: boolean
  }
  readonly candidateSha256: string
  readonly expectedSceneSha256: string
  readonly candidateSceneSha256: string
  readonly candidateSceneRevision: number
  readonly expectedSceneRevision: number
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validBody = (frame: SampledFrame): boolean => finite(frame.engineBody?.x) && finite(frame.engineBody?.y)
const close = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-6

/** A complete native centre, projected by the recorded CTM, with real pixel support. */
const positionMatches = (frame: SampledFrame, draw: DrawnBody): boolean => {
  const body = frame.engineBody
  if (body === undefined || !validBody(frame) || draw.source !== 'canvas-2d-arc-fill'
    || !finite(draw.x) || !finite(draw.y) || !finite(draw.pixelX) || !finite(draw.pixelY)
    || !Number.isSafeInteger(draw.surface) || draw.surface < 0
    || !Number.isSafeInteger(draw.drawIndex) || draw.drawIndex < 0
    || !Number.isInteger(draw.paintedPixels) || draw.paintedPixels < 16 || draw.paintedPixels > 25
    || !Array.isArray(draw.transform) || draw.transform.length !== 6 || !draw.transform.every(finite)) return false
  const [a, b, c, d, e, f] = draw.transform
  const determinant = a * d - b * c
  return finite(determinant) && Math.abs(determinant) > 1e-12
    && close(draw.x, body.x) && close(draw.y, body.y)
    && close(draw.pixelX, a * draw.x + c * draw.y + e)
    && close(draw.pixelY, b * draw.x + d * draw.y + f)
}

/**
 * Match the SAME painted primitive through EVERY frame, under a stable CTM.
 * Picking a different static trajectory dot per frame or fitting a projection
 * to the expected answers is not evidence. Unknown renderer projections stay
 * blocked until a separately justified mapping/probe exists.
 */
function bodyTrack(frames: readonly SampledFrame[]): readonly DrawnBody[] | undefined {
  const first = frames[0]
  if (first === undefined || !frames.every(validBody)) return undefined
  for (const candidate of first.drawnBodies ?? []) {
    if (!positionMatches(first, candidate)) continue
    const track: DrawnBody[] = []
    for (const frame of frames) {
      const draw = frame.drawnBodies?.find(item => item.surface === candidate.surface && item.drawIndex === candidate.drawIndex
        && positionMatches(frame, item) && item.transform.every((value, index) => close(value, candidate.transform[index]!)))
      if (draw === undefined) break
      track.push(draw)
    }
    if (track.length === frames.length) return track
  }
  return undefined
}

/** All checks are mandatory; absent evidence is never filtered out as a pass. */
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
  const subjectDrawn = observation.nativeSurface && painted.length === observation.frames.length && observation.frames.length > 0
  checks.push({ name: 'subject-drawn', passed: subjectDrawn,
    detail: subjectDrawn ? undefined : observation.nativeSurface ? '未观察到非空的实验主体绘制。' : '页面上没有可见的 canvas/svg 绘制表面。' })

  const track = bodyTrack(observation.frames)
  checks.push({
    name: 'geometry-follows-engine',
    passed: track !== undefined,
    detail: track !== undefined ? undefined
      : !observation.frames.every(validBody) ? '引擎帧缺少完整、有限的 x/y，无法核对几何。'
        : '缺少逐帧一致的真实世界坐标绘制证据，或位置/投影不一致；stamp、SVG 或未知像素投影不能放行，产品验收仍阻断。',
  })

  const times = observation.frames.map(frame => frame.time)
  const paints = new Set(observation.frames.map(frame => frame.paintHash))
  const moved = track !== undefined && track.some(draw => !close(draw.pixelX, track[0]!.pixelX) || !close(draw.pixelY, track[0]!.pixelY))
  checks.push({
    name: 'motion-sampled',
    passed: observation.frames.length >= 2 && times.every(time => finite(time) && time >= 0)
      && new Set(times).size >= 2 && paints.size > 1 && moved,
    detail: !moved ? '没有观察到随引擎位置变化的同一真实绘制主体；背景或文字变化不算运动。' : paints.size <= 1 ? '不同时刻画出了同一张静止画面。' : undefined,
  })

  const changedGeometry = observation.changedFrame !== undefined
    && bodyTrack([...observation.frames, observation.changedFrame]) !== undefined
  const changed = observation.parameterChanged === true && changedGeometry
    && observation.changedPaintHash !== undefined
    && observation.originalPaintHash !== undefined
    && observation.changedPaintHash === observation.changedFrame?.paintHash
    && observation.originalPaintHash === observation.frames[0]?.paintHash
    && observation.changedPaintHash !== observation.originalPaintHash
    && /^[a-f0-9]{64}$/.test(observation.changedPaintHash)
    && /^[a-f0-9]{64}$/.test(observation.originalPaintHash)
  checks.push({
    name: 'parameter-change',
    passed: changed,
    detail: changed ? undefined
      : observation.parameterChanged !== true ? '没有观察到改参后的真实快照。'
        : !changedGeometry ? '改参帧缺少可核对的真实几何，或位置/投影与引擎不一致。'
          : '改参后画面没有可核对的变化，疑似没有使用新快照。',
  })

  const mobile = observation.mobile
  checks.push({
    name: 'mobile-layout',
    passed: mobile !== undefined && mobile.scrollWidth <= mobile.viewportWidth + 1 && !mobile.overflow,
    detail: mobile === undefined ? '没有手机视口结果。' : !(mobile.scrollWidth <= mobile.viewportWidth + 1) ? '手机视口出现横向溢出。' : mobile.overflow ? '实验主体超出手机视口。' : undefined,
  })

  return { passed: checks.every(check => check.passed), checks }
}
