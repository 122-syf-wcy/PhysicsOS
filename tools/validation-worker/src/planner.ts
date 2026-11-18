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
import { MECHANICS_VALIDATION_PROFILE, OPTICS_VALIDATION_PROFILE, type QuestionCodeValidationProfile } from '@physicsos/shared'
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
