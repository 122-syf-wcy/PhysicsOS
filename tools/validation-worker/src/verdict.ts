/**
 * Pure acceptance verdict for one generated experiment candidate.
 *
 * The browser driver collects observations; this module decides. Missing or
 * unattributable evidence fails closed, including a frame with only stamps.
 */
import type { BrowserFrame, DrawnBody, DrawnGround, ParameterControlEvidence } from './types.ts'
import { MECHANICS_VALIDATION_PROFILE, UNSUPPORTED_VALIDATION_PROFILE, isQuestionCodeValidationProfile, validationProfileKey, type QuestionCodeValidationProfile, type QuestionCodeValidationCheckName } from '../../../packages/shared/src/validation-profile.ts'
import { opticsGeometry, opticsParameterChanged, opticsSemanticState, opticsStaticStable } from './optics-verdict.ts'

export type CheckName = QuestionCodeValidationCheckName

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
  readonly mobileFrame?: SampledFrame
  readonly parameterControl?: ParameterControlEvidence
  /** Chosen by the trusted server plan, never read from the candidate page. */
  readonly validationProfile?: QuestionCodeValidationProfile
  /** Trusted worker-planned edit, independent of the candidate's messages. */
  readonly parameter?: import('./planner.ts').SceneFramePlan['parameter']
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

/** Canvas transforms are Float32; this subpixel bound never changes world-unit checks. */
const pixelClose = (left: number, right: number, ...calibration: number[]): boolean => {
  const values = [left, right, ...calibration]
  if (!values.every(finite)) return false
  const magnitude = Math.max(1, ...values.map(Math.abs))
  const ulp = 2 ** (Math.floor(Math.log2(magnitude)) - 23)
  return Math.abs(left - right) <= Math.min(1 / 1024, 4 * ulp)
}

/** Native centre must be internally consistent and have surviving actual fill. */
const nativeBody = (draw: DrawnBody): boolean => {
  if (draw.source !== 'canvas-2d-arc-fill'
    || !finite(draw.x) || !finite(draw.y) || !finite(draw.pixelX) || !finite(draw.pixelY)
    || !Number.isSafeInteger(draw.surface) || draw.surface < 0
    || !Number.isSafeInteger(draw.drawIndex) || draw.drawIndex < 0
    || !Number.isInteger(draw.paintedPixels) || draw.paintedPixels < 0 || draw.paintedPixels > 25
    || (draw.paintedPatches !== undefined && (!Number.isInteger(draw.paintedPatches) || draw.paintedPatches < 0 || draw.paintedPatches > 8))
    || (draw.paintedPixels < 16 && (draw.paintedPatches ?? 0) < 2)
    || !Array.isArray(draw.transform) || draw.transform.length !== 6 || !draw.transform.every(finite)) return false
  const [a, b, c, d, e, f] = draw.transform
  const determinant = a * d - b * c
  return finite(determinant) && Math.abs(determinant) > 1e-12
    && close(draw.pixelX, a * draw.x + c * draw.y + e)
    && close(draw.pixelY, b * draw.x + d * draw.y + f)
}

const positionMatches = (frame: SampledFrame, draw: DrawnBody): boolean => validBody(frame) && nativeBody(draw)
  && close(draw.x, frame.engineBody!.x) && close(draw.y, frame.engineBody!.y)

/** Calibrate ONLY from the independently painted ground's known world span. */
function groundProjection(frame: SampledFrame, line: DrawnGround): { x: number; y: number } | undefined {
  const ground = frame.engineGround
  if (ground === undefined || !finite(ground.from) || !finite(ground.to) || ground.to <= ground.from || !finite(ground.y)
    || !validBody(frame) || line.source !== 'canvas-2d-line-stroke'
    || !Number.isSafeInteger(line.surface) || line.surface < 0 || !Number.isSafeInteger(line.strokeIndex) || line.strokeIndex < 0
    || !Number.isInteger(line.paintedPatches) || line.paintedPatches < 2 || line.paintedPatches > 4
    || !Array.isArray(line.transform) || line.transform.length !== 6 || !line.transform.every(finite)
    || ![line.from?.x, line.from?.y, line.to?.x, line.to?.y, line.pixelFrom?.x, line.pixelFrom?.y, line.pixelTo?.x, line.pixelTo?.y].every(finite)) return undefined
  const [a, b, c, d, e, f] = line.transform
  if (Math.abs(a * d - b * c) <= 1e-12
    || !close(line.pixelFrom.x, a * line.from.x + c * line.from.y + e)
    || !close(line.pixelFrom.y, b * line.from.x + d * line.from.y + f)
    || !close(line.pixelTo.x, a * line.to.x + c * line.to.y + e)
    || !close(line.pixelTo.y, b * line.to.x + d * line.to.y + f)
    || !close(line.pixelFrom.y, line.pixelTo.y)) return undefined
  const scale = (line.pixelTo.x - line.pixelFrom.x) / (ground.to - ground.from)
  if (!finite(scale) || scale <= 0) return undefined
  // The accepted camera is positive, equal-unit x/y with world y upwards.
  // No term here comes from fitting the observed body or its renderer stamp.
  const x = line.pixelFrom.x + (frame.engineBody!.x - ground.from) * scale
  const y = line.pixelFrom.y - (frame.engineBody!.y - ground.y) * scale
  return finite(x) && finite(y) ? { x, y } : undefined
}

function groundBodyTrack(frames: readonly SampledFrame[], changedFrame?: SampledFrame): readonly DrawnBody[] | undefined {
  const first = frames[0], ground = first?.engineGround
  if (first === undefined || ground === undefined || !frames.every(frame => frame.engineGround !== undefined
    && close(frame.engineGround.from, ground.from) && close(frame.engineGround.to, ground.to) && close(frame.engineGround.y, ground.y))) return undefined
  for (const anchor of first.drawnGrounds ?? []) {
    const projected = groundProjection(first, anchor)
    if (projected === undefined) continue
    for (const candidate of first.drawnBodies ?? []) {
      const calibration = [anchor.pixelFrom.x, anchor.pixelFrom.y, anchor.pixelTo.x, anchor.pixelTo.y]
      if (!nativeBody(candidate) || candidate.surface !== anchor.surface || !pixelClose(candidate.pixelX, projected.x, ...calibration) || !pixelClose(candidate.pixelY, projected.y, ...calibration)) continue
      const track: DrawnBody[] = []
      const allFrames = changedFrame === undefined ? frames : [...frames, changedFrame]
      for (const frame of allFrames) {
        const line = frame.drawnGrounds?.find(item => item.surface === anchor.surface && item.strokeIndex === anchor.strokeIndex && groundProjection(frame, item) !== undefined)
        const expected = line === undefined ? undefined : groundProjection(frame, line)
        const draw = expected === undefined || line === undefined ? undefined : frame.drawnBodies?.find(item => item.surface === candidate.surface && item.drawIndex === candidate.drawIndex
          && nativeBody(item) && pixelClose(item.pixelX, expected.x, line.pixelFrom.x, line.pixelTo.x, line.pixelFrom.y)
          && pixelClose(item.pixelY, expected.y, line.pixelFrom.x, line.pixelTo.x, line.pixelFrom.y))
        if (draw === undefined) break
        track.push(draw)
      }
      if (track.length === allFrames.length) return track
    }
  }
  return undefined
}

/**
 * Preserve the world-coordinate proof under a stable CTM, or use an independent
 * ground anchor for the SAME primitive through EVERY ordinary/changed frame.
 * Static trajectory dots and body-fitted projections are never evidence.
 */
function bodyTrack(frames: readonly SampledFrame[], changedFrame?: SampledFrame, allowGround = true): readonly DrawnBody[] | undefined {
  const first = frames[0]
  const allFrames = changedFrame === undefined ? frames : [...frames, changedFrame]
  if (first === undefined || !allFrames.every(validBody)) return undefined
  for (const candidate of first.drawnBodies ?? []) {
    if (!positionMatches(first, candidate)) continue
    const track: DrawnBody[] = []
    for (const frame of allFrames) {
      const draw = frame.drawnBodies?.find(item => item.surface === candidate.surface && item.drawIndex === candidate.drawIndex
        && positionMatches(frame, item) && item.transform.every((value, index) => close(value, candidate.transform[index]!)))
      if (draw === undefined) break
      track.push(draw)
    }
    if (track.length === allFrames.length) return track
  }
  return allowGround ? groundBodyTrack(frames, changedFrame) : undefined
}

/** All checks are mandatory; absent evidence is never filtered out as a pass. */
export function evaluateObservation(observation: Observation): { passed: boolean; validationProfile: QuestionCodeValidationProfile; checks: readonly Check[] } {
  const requested = observation.validationProfile ?? MECHANICS_VALIDATION_PROFILE
  const known = isQuestionCodeValidationProfile(requested)
  const validationProfile = known ? requested : UNSUPPORTED_VALIDATION_PROFILE
  if (!known || validationProfile.id === 'unsupported-runtime') return {
    passed: false, validationProfile, checks: [{ name: 'profile-binding', passed: false, detail: validationProfileKey(validationProfile) }],
  }
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
  checks.push({ name: 'profile-binding', passed: true, detail: validationProfileKey(validationProfile) })
  checks.push({ name: 'first-frame', passed: observation.firstFrameAcknowledged, detail: observation.firstFrameAcknowledged ? undefined : '15 秒内没有收到首帧绘制确认。' })
  checks.push({ name: 'runtime-error', passed: observation.runtimeError === undefined, detail: observation.runtimeError })
  const painted = observation.frames.filter(frame => frame.opaquePixels > 0 && (frame.distinctColors > 3 || frame.geometryCount > 0))
  const subjectDrawn = observation.nativeSurface && painted.length === observation.frames.length && observation.frames.length > 0
  checks.push({ name: 'subject-drawn', passed: subjectDrawn,
    detail: subjectDrawn ? undefined : observation.frames.some(frame => (frame.taintedSurfaces ?? 0) > 0)
      ? 'Canvas 绘制跨源图片后不可读；尚无经验证的截图绘制证据，验收阻断。'
      : observation.nativeSurface ? '未观察到非空的实验主体绘制。' : '页面上没有可见的 canvas/svg 绘制表面。' })

  if (validationProfile.id === 'optics-thin-lens-real-static') {
    const geometry = observation.frames.length === 2 && observation.frames.every(frame => opticsGeometry(frame) !== undefined)
    checks.push({ name: 'geometry-follows-engine', passed: geometry,
      detail: geometry ? undefined : '缺少原生线段/箭头实绘或独立轴投影；未支持的光学几何仍阻断。' })
    const stable = opticsStaticStable(observation.frames)
    checks.push({ name: 'static-frame-stable', passed: stable,
      detail: stable ? undefined : '相同冻结时刻、引擎事实和实际画面未保持一致；不能伪造时间替代静态证明。' })
    const semantics = observation.frames.length === 2 && observation.frames.every(opticsSemanticState)
    checks.push({ name: 'semantic-state', passed: semantics,
      detail: semantics ? undefined : '真实光路/实像事实或原生绘制的精确语义读数缺失。' })
    const changed = observation.parameterChanged === true && opticsParameterChanged(observation.frames[0], observation.changedFrame, observation.parameterControl)
      && observation.changedPaintHash === observation.changedFrame?.paintHash && observation.originalPaintHash === observation.frames[0]?.paintHash
      && observation.changedPaintHash !== observation.originalPaintHash
      && /^[a-f0-9]{64}$/.test(observation.changedPaintHash ?? '') && /^[a-f0-9]{64}$/.test(observation.originalPaintHash ?? '')
    checks.push({ name: 'parameter-change', passed: changed,
      detail: changed ? undefined : '未核对物高原生控件的精确平台契约、真实改参意图及新快照的几何/语义实绘。' })
    const mobile = observation.mobile
    checks.push({ name: 'mobile-layout', passed: mobile !== undefined && mobile.scrollWidth <= mobile.viewportWidth + 1 && !mobile.overflow,
      detail: mobile === undefined ? '没有手机视口结果。' : undefined })
    const resized = observation.mobileFrame, last = observation.changedFrame
    const mobileGeometry = resized !== undefined && last !== undefined && resized.snapshotSha256 === last.snapshotSha256
      && resized.time === last.time && resized.revision === last.revision && JSON.stringify(resized.optics) === JSON.stringify(last.optics)
      && opticsGeometry(resized) !== undefined && opticsSemanticState(resized)
    checks.push({ name: 'mobile-geometry', passed: mobileGeometry,
      detail: mobileGeometry ? undefined : '手机尺寸下未保留相同引擎事实的可见真实几何与语义实绘。' })
    return { passed: checks.every(check => check.passed), validationProfile, checks }
  }

  const magnetic = validationProfile.id === 'magnetic-uniform-circular-native-motion'
  const track = bodyTrack(observation.frames, undefined, !magnetic)
  checks.push({
    name: 'geometry-follows-engine',
    passed: track !== undefined,
    detail: track !== undefined ? undefined
      : !observation.frames.every(validBody) ? '引擎帧缺少完整、有限的 x/y，无法核对几何。'
        : magnetic ? '缺少固定非奇异 CTM 下相同 surface/drawIndex 的原生粒子圆实绘；磁场不接受地面替代、像素预投影或逐帧平移。'
          : '缺少逐帧一致的真实绘制证据，或位置/投影不一致；须有世界坐标或独立地面锚点，stamp、SVG 或未知像素投影不能放行，产品验收仍阻断。',
  })

  const times = observation.frames.map(frame => frame.time)
  const paints = new Set(observation.frames.map(frame => frame.paintHash))
  const moved = track !== undefined && track.some(draw => !pixelClose(draw.pixelX, track[0]!.pixelX) || !pixelClose(draw.pixelY, track[0]!.pixelY))
  const quarterSamples = !magnetic || observation.frames.length === 4 && times[0] === 0 && finite(times[1]) && times[1]! > 0
    && times[2] === times[1]! * 2 && Math.abs(times[3]! / times[1]! - 3) <= 8 * Number.EPSILON
    && observation.frames.every(frame => frame.revision === observation.frames[0]?.revision && /^[a-f0-9]{64}$/.test(frame.snapshotSha256 ?? ''))
  checks.push({
    name: 'motion-sampled',
    passed: quarterSamples && observation.frames.length >= 2 && times.every(time => finite(time) && time >= 0)
      && new Set(times).size >= 2 && paints.size > 1 && moved,
    detail: !moved ? '没有观察到随引擎位置变化的同一真实绘制主体；背景或文字变化不算运动。' : paints.size <= 1 ? '不同时刻画出了同一张静止画面。' : undefined,
  })

  const changedGeometry = observation.changedFrame !== undefined
    && bodyTrack(observation.frames, observation.changedFrame, !magnetic) !== undefined
  const edit = observation.parameter, first = observation.frames[0], phase = observation.frames[1], next = observation.changedFrame
  const magneticChanged = !magnetic || quarterSamples && edit?.id === 'v0' && finite(edit.from) && edit.from > 0 && edit.to === edit.from * 1.1
    && first !== undefined && phase !== undefined && next !== undefined && Number.isSafeInteger(first.revision)
    && next.revision === first.revision! + 1 && next.time === phase.time && validBody(next) && validBody(phase)
    && (!close(next.engineBody!.x, phase.engineBody!.x) || !close(next.engineBody!.y, phase.engineBody!.y))
    && /^[a-f0-9]{64}$/.test(next.snapshotSha256 ?? '') && next.snapshotSha256 !== phase.snapshotSha256
  const changed = observation.parameterChanged === true && changedGeometry && magneticChanged
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
        : !magneticChanged ? 'v0 × 1.1 的新修订、精确四分之一周期与真实变化快照不匹配。'
          : !changedGeometry ? '改参帧缺少可核对的真实几何，或位置/投影与引擎不一致。'
          : '改参后画面没有可核对的变化，疑似没有使用新快照。',
  })

  const mobile = observation.mobile
  checks.push({
    name: 'mobile-layout',
    passed: mobile !== undefined && mobile.scrollWidth <= mobile.viewportWidth + 1 && !mobile.overflow,
    detail: mobile === undefined ? '没有手机视口结果。' : !(mobile.scrollWidth <= mobile.viewportWidth + 1) ? '手机视口出现横向溢出。' : mobile.overflow ? '实验主体超出手机视口。' : undefined,
  })

  return { passed: checks.every(check => check.passed), validationProfile, checks }
}
