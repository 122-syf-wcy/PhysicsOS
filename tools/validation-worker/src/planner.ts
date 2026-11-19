/**
 * Domain-aware frame planner for the worker.
 *
 * The candidate is authored against the Lab's viewport, so acceptance frames
 * must come from that same viewport runtime. The Lab's all-domain dispatcher
 * eagerly imports every domain module; the worker instead loads only the one
 * domain the engine selects. Missing compiled runtimes remain unavailable;
 * other geometry contracts do not inherit an acceptance policy.
 *
 * Every coordinate produced here is an engine fact read from the runtime's
 * snapshot. Nothing is re-solved and nothing is invented.
 */
import { planFrames, wireSnapshot, type FramePlan, type FrameSource, type SnapshotLike } from './frame-plan.ts'
import { MECHANICS_VALIDATION_PROFILE, OPTICS_VALIDATION_PROFILE, MAGNETIC_VALIDATION_PROFILE, type QuestionCodeValidationProfile } from '../../../packages/shared/src/validation-profile.ts'
import { prepareMagneticMotionValidation } from '../../../packages/physics-runtime/src/index.ts'
import { parsePhysicsScene } from '../../../packages/physics-scene/src/index.ts'
import { canonicalValue } from '../../../packages/physics-units/src/index.ts'
import { derivedVector, toCanonicalVector } from '../../../packages/physics-core/src/index.ts'
import { verifyMagneticScene } from '../../../packages/physics-verifier/src/index.ts'
import { staticOpticsFacts } from './static-optics.ts'

export type DomainRuntimeLoader = (domain: string) => Promise<((scene: Record<string, unknown>) => FrameSource | null) | null>

/** Which workspace-runtime module owns each scene domain. */
export const DOMAIN_RUNTIME_MODULES: Readonly<Record<string, { readonly module: string; readonly factory: string }>> = {
  mechanics: { module: './mechanics-workspace-runtime.ts', factory: 'createMechanicsWorkspaceRuntime' },
  magnetic: { module: './magnetic-workspace-runtime.ts', factory: 'createMagneticWorkspaceRuntime' },
  electric: { module: './electric-workspace-runtime.ts', factory: 'createElectricWorkspaceRuntime' },
  circuit: { module: './circuit-workspace-runtime.ts', factory: 'createCircuitWorkspaceRuntime' },
  optics: { module: './optics-workspace-runtime.ts', factory: 'createOpticsWorkspaceRuntime' },
  composite: { module: './composite-workspace-runtime.ts', factory: 'createCompositeWorkspaceRuntime' },
  collision: { module: './collision-workspace-runtime.ts', factory: 'createCollisionWorkspaceRuntime' },
  energy: { module: './energy-workspace-runtime.ts', factory: 'createEnergyWorkspaceRuntime' },
  lever: { module: './lever-workspace-runtime.ts', factory: 'createLeverWorkspaceRuntime' },
  wave: { module: './wave-workspace-runtime.ts', factory: 'createWaveWorkspaceRuntime' },
  thermal: { module: './thermal-workspace-runtime.ts', factory: 'createThermalWorkspaceRuntime' },
  modern: { module: './modern-workspace-runtime.ts', factory: 'createModernWorkspaceRuntime' },
}

export class PlannerError extends Error {
  constructor(readonly code: 'UNKNOWN_DOMAIN' | 'RUNTIME_UNAVAILABLE' | 'NO_FRAMES' | 'NO_PARAMETER' | 'INVALID_SNAPSHOT' | 'PROFILE_UNSUPPORTED', message: string) {
    super(message)
    this.name = 'PlannerError'
  }
}

/** Same fact allowlist as the Lab's universalContributionSnapshot, without client imports. */
function contributionSnapshot(frame: SnapshotLike, experimentId: string): Record<string, unknown> {
  if (typeof experimentId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(experimentId)
    || frame.status === 'failed' || typeof frame.sceneRevision !== 'number'
    || !Number.isSafeInteger(frame.sceneRevision) || frame.sceneRevision < 0) {
    throw new PlannerError('INVALID_SNAPSHOT', '运行时没有提供有效的实验帧身份。')
  }
  return wireSnapshot({
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
  })
}

export interface SceneFramePlan {
  readonly validationProfile: QuestionCodeValidationProfile
  readonly frames: readonly { readonly frameId: string; readonly snapshot: Record<string, unknown> }[]
  readonly changedFrame?: { readonly frameId: string; readonly snapshot: Record<string, unknown> }
  readonly parameter?: { readonly id: string; readonly from: number; readonly to: number }
  readonly notes: readonly string[]
}

function planStaticOptics(runtime: FrameSource, scene: Record<string, unknown>, experimentId: string): SceneFramePlan {
  for (const key of ['bodies', 'particles', 'fields', 'forces', 'regions', 'boundaries', 'constraints', 'circuits',
    'acousticBenches', 'fluidTanks', 'thermalBenches', 'leverBenches', 'inductionBenches', 'waveBenches', 'cyclotronBenches',
    'modernPhysicsBenches', 'pressureBenches', 'currentBenches', 'energyBenches', 'lightBenches', 'transformerBenches', 'thermometerBenches', 'noiseBenches']) {
    const collection = scene[key]
    if (collection !== undefined && (!Array.isArray(collection) || collection.length > 0)) throw new PlannerError('PROFILE_UNSUPPORTED', '静态薄透镜策略不支持混合装置。')
  }
  const capture = runtime.captureRaw?.()
  if (capture?.engineInfo.id !== 'engine-optics' || capture.engineInfo.version !== '1.0.0'
    || capture.engineInfo.model !== 'thin_lens_imaging' || capture.cursor.kind !== 'static'
    || capture.cursor.identity !== 'optics-geometric-imaging' || capture.scene === undefined
    || JSON.stringify(wireSnapshot(capture.scene)) !== JSON.stringify(wireSnapshot(scene))) {
    throw new PlannerError('PROFILE_UNSUPPORTED', '静态验收缺少匹配的真实引擎身份。')
  }
  const base = contributionSnapshot(runtime.getSnapshot(), experimentId)
  const facts = staticOpticsFacts(base)
  if (facts === undefined || base.revision !== scene.revision) throw new PlannerError('PROFILE_UNSUPPORTED', '静态薄透镜快照缺少可核对的光线、实像或语义事实。')
  if (runtime.editParameter === undefined) throw new PlannerError('NO_PARAMETER', '静态薄透镜运行时没有真实的物高改参接口。')
  // Repeat EXACT engine time/state, not a synthetic animation cursor.
  const repeated = contributionSnapshot(runtime.getSnapshot(), experimentId)
  if (JSON.stringify(base) !== JSON.stringify(repeated)) throw new PlannerError('INVALID_SNAPSHOT', '静态引擎在未改参时改变了冻结事实。')
  const from = facts.heightParameter.value, to = from + facts.heightParameter.step
  if (!Number.isFinite(to) || to === from) throw new PlannerError('NO_PARAMETER', '物高无法按平台步长变化。')
  const changed = contributionSnapshot(runtime.editParameter('object-height', to), experimentId)
  const changedFacts = staticOpticsFacts(changed)
  const after = runtime.captureRaw?.()
  if (changedFacts === undefined || changedFacts.heightParameter.value !== to || after?.engineInfo.id !== capture.engineInfo.id
    || after.engineInfo.version !== capture.engineInfo.version || after.engineInfo.model !== capture.engineInfo.model
    || after.cursor.kind !== capture.cursor.kind || after.cursor.identity !== capture.cursor.identity) {
    throw new PlannerError('INVALID_SNAPSHOT', '真实物高改参没有返回可验证的静态薄透镜事实。')
  }
  return {
    validationProfile: OPTICS_VALIDATION_PROFILE,
    frames: [{ frameId: 'f0', snapshot: base }, { frameId: 'f-static-repeat', snapshot: repeated }],
    changedFrame: { frameId: 'f-changed', snapshot: changed },
    parameter: { id: 'object-height', from, to }, notes: [],
  }
}

const sameFacts = (left: unknown, right: unknown): boolean => left === undefined || right === undefined
  ? left === right : JSON.stringify(wireSnapshot(left)) === JSON.stringify(wireSnapshot(right))
const near = (left: number, right: number): boolean => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-6

/** Samples physical quarter-periods exactly; the generic millisecond sampler is inapplicable. */
function planMagneticMotion(runtime: FrameSource, scene: Record<string, unknown>, experimentId: string): SceneFramePlan {
  const parsed = parsePhysicsScene(scene)
  const prepared = parsed.ok ? prepareMagneticMotionValidation(parsed.value, experimentId) : undefined
  if (!parsed.ok || prepared === undefined) throw new PlannerError('PROFILE_UNSUPPORTED', '仅支持已注册、真实验证通过的二维单粒子全局匀强磁场圆周运动。')
  if (runtime.seek === undefined || runtime.editParameter === undefined || runtime.captureRaw === undefined) {
    throw new PlannerError('PROFILE_UNSUPPORTED', '磁场运行时缺少真实 seek、v0 改参或原始引擎结果。')
  }
  const frozen = parsed.value, period = prepared.plan.endTime
  const capture = () => {
    const raw = runtime.captureRaw!()
    if (raw.scene === undefined || raw.request === undefined || raw.result === undefined || raw.state === undefined
      || raw.engineInfo.id !== prepared.plan.engineId || raw.engineInfo.version !== prepared.plan.engineVersion
      || raw.cursor.kind !== 'time' || raw.result.metadata.engineId !== raw.engineInfo.id
      || raw.result.metadata.engineVersion !== raw.engineInfo.version || raw.result.sceneId !== raw.scene.id
      || raw.result.sceneRevision !== raw.scene.revision || raw.request.sceneId !== raw.scene.id
      || raw.request.sceneRevision !== raw.scene.revision
      || verifyMagneticScene(raw.scene, raw.result, { request: raw.request }).status !== 'passed'
      || raw.result.verification.status !== 'passed') {
      throw new PlannerError('INVALID_SNAPSHOT', '缺少对应场景修订、真实验证通过的磁场原始结果。')
    }
    return { ...raw, scene: raw.scene, request: raw.request, result: raw.result, state: raw.state, cursor: raw.cursor }
  }
  const initial = capture()
  if (!sameFacts(initial.scene, frozen)) throw new PlannerError('PROFILE_UNSUPPORTED', '磁场运行时没有使用 canonical frozen scene。')
  const checkedFrame = (snapshot: SnapshotLike, expectedTime: number, expectedScene: typeof frozen) => {
    const raw = capture(), view = snapshot.view as SnapshotLike['view'] & { readonly extent?: { readonly width: number; readonly height: number } }
    const particle = view.particles?.[0], object = raw.state.objects.find(item => item.id === expectedScene.particles[0]!.id)
    if (snapshot.domain !== 'magnetic' || snapshot.status !== 'verified' || snapshot.sceneRevision !== expectedScene.revision
      || !sameFacts(raw.scene, expectedScene) || snapshot.clock.time !== expectedTime || snapshot.clock.total !== period
      || raw.cursor.kind !== 'time' || canonicalValue(raw.cursor.time) !== expectedTime
      || canonicalValue(raw.state.time) !== expectedTime || view.bodies?.length !== 0 || view.particles?.length !== 1
      || particle?.id !== expectedScene.particles[0]!.id || object?.position === undefined || view.extent === undefined
      || !Array.isArray(snapshot.verification) || snapshot.verification.length === 0
      || !snapshot.verification.every(check => typeof check === 'object' && check !== null && 'status' in check && check.status === 'passed')) {
      throw new PlannerError('INVALID_SNAPSHOT', '磁场帧没有精确对应引擎时刻、修订或唯一粒子。')
    }
    const position = toCanonicalVector(object.position).vectorSI
    const center = toCanonicalVector(derivedVector(raw.result.derivedQuantities, 'orbit_center')).vectorSI
    // Verify the bridge's existing box-centred cm mapping; do not put raw SI on the wire.
    if (!near(particle.at.x, view.extent.width / 2 + (position.x - center.x) * 100)
      || !near(particle.at.y, view.extent.height / 2 + (position.y - center.y) * 100)) {
      throw new PlannerError('INVALID_SNAPSHOT', '磁场粒子视图不是运行时已有的圆心平移厘米坐标。')
    }
    return contributionSnapshot(snapshot, experimentId)
  }
  const frames = [0, period / 4, period / 2, 3 * period / 4].map((time, index) => ({
    frameId: `f${index}`, snapshot: checkedFrame(runtime.seek!(time), time, frozen),
  }))
  const inspector = runtime.getSnapshot().inspector?.flatMap(section => section.parameters ?? [])
  const speed = inspector?.find(item => item.id === 'v0')
  const from = speed?.value, to = typeof from === 'number' ? from * 1.1 : Number.NaN
  if (!(typeof from === 'number' && from > 0 && Number.isFinite(to) && to > from)) throw new PlannerError('NO_PARAMETER', '缺少可核对的真实 v0 参数。')
  runtime.editParameter('v0', to)
  const after = capture(), changedSupport = prepareMagneticMotionValidation(after.scene, experimentId)
  const beforeParticle = frozen.particles[0]!, afterParticle = after.scene.particles[0]
  const velocity = toCanonicalVector(beforeParticle.velocity).vectorSI
  const changedVelocity = afterParticle === undefined ? undefined : toCanonicalVector(afterParticle.velocity).vectorSI
  const { revision: _revision, metadata: _metadata, particles: _particles, ...beforeRest } = frozen
  const { revision: _nextRevision, metadata: _nextMetadata, particles: _nextParticles, ...afterRest } = after.scene
  if (changedSupport === undefined || after.scene.revision !== frozen.revision + 1
    || after.result.sceneRevision !== after.scene.revision || sameFacts(initial.result, after.result)
    || !sameFacts(beforeRest, afterRest) || afterParticle === undefined
    || !sameFacts({ ...beforeParticle, velocity: undefined }, { ...afterParticle, velocity: undefined })
    || changedVelocity === undefined || !near(changedVelocity.x, velocity.x * 1.1)
    || !near(changedVelocity.y, velocity.y * 1.1) || !near(changedVelocity.z, velocity.z * 1.1)
    || changedSupport.plan.endTime !== period) {
    throw new PlannerError('INVALID_SNAPSHOT', 'v0 改参没有生成仅改变速度的新修订与真实引擎结果。')
  }
  const changedSnapshot = runtime.seek(period / 4)
  const nextSpeed = changedSnapshot.inspector?.flatMap(section => section.parameters ?? []).find(item => item.id === 'v0')
  const changedFrame = { frameId: 'f-changed', snapshot: checkedFrame(changedSnapshot, period / 4, after.scene) }
  const baseView = frames[0]!.snapshot.view as Record<string, unknown>, changedView = changedFrame.snapshot.view as Record<string, unknown>
  const baseScale = (baseView.overlay as Record<string, unknown> | undefined)?.scale
  const nextScale = (changedView.overlay as Record<string, unknown> | undefined)?.scale
  if (nextSpeed?.value !== to || baseView.extent === undefined || baseView.grid === undefined || baseView.field === undefined || baseScale === undefined
    || !sameFacts(baseView.extent, changedView.extent) || !sameFacts(baseView.grid, changedView.grid)
    || !sameFacts(baseView.field, changedView.field) || !sameFacts(baseScale, nextScale)
    || sameFacts((frames[1]!.snapshot.view as SnapshotLike['view']).particles, changedView.particles)) {
    throw new PlannerError('INVALID_SNAPSHOT', 'v0 改参未保持固定视口/B 纹理，或粒子仍是旧改参快照。')
  }
  return { validationProfile: MAGNETIC_VALIDATION_PROFILE, frames, changedFrame, parameter: { id: 'v0', from, to }, notes: [] }
}

/**
 * Resolve the plan for one scene through an already-resolved runtime factory.
 * The template identity comes from the app's bound artifact, not scene metadata.
 */
export function planScene(
  scene: Record<string, unknown>,
  createRuntime: ((scene: Record<string, unknown>) => FrameSource | null) | null,
  experimentId: string,
): SceneFramePlan {
  if (createRuntime === null) throw new PlannerError('RUNTIME_UNAVAILABLE', '该领域没有可用的视口运行时。')
  let runtime: FrameSource | null
  try { runtime = createRuntime(scene) } catch (error) {
    throw new PlannerError('RUNTIME_UNAVAILABLE', error instanceof Error ? error.message : 'runtime construction failed')
  }
  if (runtime === null) throw new PlannerError('RUNTIME_UNAVAILABLE', '该领域没有可用的视口运行时。')
  const base = runtime.getSnapshot()
  if (base.status === 'failed' || !Number.isSafeInteger(base.sceneRevision) || Number(base.sceneRevision) < 0) throw new PlannerError('INVALID_SNAPSHOT', '运行时没有提供有效的实验帧身份。')
  if (base.domain === 'optics') return planStaticOptics(runtime, scene, experimentId)
  if (base.domain === 'magnetic') return planMagneticMotion(runtime, scene, experimentId)
  if (base.domain !== 'mechanics') throw new PlannerError('PROFILE_UNSUPPORTED', '该运行时没有受支持的原生几何验收策略。')
  const rawIdentity = runtime.captureRaw?.().engineInfo
  if (rawIdentity !== undefined && rawIdentity.id !== 'engine-mechanics') throw new PlannerError('PROFILE_UNSUPPORTED', '该力学变体尚无原生几何验收策略。')
  const plan: FramePlan = planFrames(runtime)
  if (plan.frames.length === 0) throw new PlannerError('NO_FRAMES', '没有构造出任何引擎帧。')
  return {
    validationProfile: MECHANICS_VALIDATION_PROFILE,
    frames: plan.frames.map(frame => ({ frameId: frame.frameId, snapshot: contributionSnapshot(frame.snapshot, experimentId) })),
    ...(plan.changedFrame === undefined ? {} : {
      changedFrame: { frameId: plan.changedFrame.frameId, snapshot: contributionSnapshot(plan.changedFrame.snapshot, experimentId) },
    }),
    ...(plan.parameter === undefined ? {} : { parameter: plan.parameter }),
    notes: plan.notes,
  }
}

export type { SnapshotLike }
