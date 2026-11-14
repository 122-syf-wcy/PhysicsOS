/**
 * Domain-aware frame planner for the worker.
 *
 * The candidate is authored against the Lab's viewport, so acceptance frames
 * must come from that same viewport runtime. The Lab's all-domain dispatcher
 * eagerly imports every domain module; the worker instead loads only the one
 * domain a scene names. That keeps the worker small and avoids pulling in
 * domains (e.g. optics' extra dependencies) whose modules are not installed
 * in the worker image.
 *
 * Every coordinate produced here is an engine fact read from the runtime's
 * snapshot. Nothing is re-solved and nothing is invented.
 */
import { planFrames, wireSnapshot, type FramePlan, type FrameSource, type SnapshotLike } from './frame-plan.ts'

export type DomainRuntimeLoader = (domain: string) => Promise<((scene: Record<string, unknown>) => FrameSource | null) | null>

/** Which workspace-runtime module owns each scene domain. */
export const DOMAIN_RUNTIME_MODULES: Readonly<Record<string, { readonly module: string; readonly factory: string }>> = {
  mechanics: { module: './mechanics-workspace-runtime.ts', factory: 'createMechanicsWorkspaceRuntime' },
  magnetic: { module: './magnetic-workspace-runtime.ts', factory: 'createMagneticWorkspaceRuntime' },
  electric: { module: './electric-workspace-runtime.ts', factory: 'createElectricWorkspaceRuntime' },
  circuit: { module: './circuit-workspace-runtime.ts', factory: 'createCircuitWorkspaceRuntime' },
  composite: { module: './composite-workspace-runtime.ts', factory: 'createCompositeWorkspaceRuntime' },
  collision: { module: './collision-workspace-runtime.ts', factory: 'createCollisionWorkspaceRuntime' },
  energy: { module: './energy-workspace-runtime.ts', factory: 'createEnergyWorkspaceRuntime' },
  lever: { module: './lever-workspace-runtime.ts', factory: 'createLeverWorkspaceRuntime' },
  wave: { module: './wave-workspace-runtime.ts', factory: 'createWaveWorkspaceRuntime' },
  thermal: { module: './thermal-workspace-runtime.ts', factory: 'createThermalWorkspaceRuntime' },
  modern: { module: './modern-workspace-runtime.ts', factory: 'createModernWorkspaceRuntime' },
}

export class PlannerError extends Error {
  constructor(readonly code: 'UNKNOWN_DOMAIN' | 'RUNTIME_UNAVAILABLE' | 'NO_FRAMES' | 'NO_PARAMETER', message: string) {
    super(message)
    this.name = 'PlannerError'
  }
}

/**
 * Resolve the plan for one scene through an already-resolved runtime factory.
 * This is the function the HTTP layer calls; it keeps the async loading out
 * of the request handler's hot path.
 */
export function planScene(
  scene: Record<string, unknown>,
  createRuntime: ((scene: Record<string, unknown>) => FrameSource | null) | null,
): { frames: readonly { frameId: string; snapshot: Record<string, unknown> }[]; changedFrame?: { frameId: string; snapshot: Record<string, unknown> }; notes: readonly string[] } {
  if (createRuntime === null) throw new PlannerError('RUNTIME_UNAVAILABLE', '该领域没有可用的视口运行时。')
  let runtime: FrameSource | null
  try { runtime = createRuntime(scene) } catch (error) {
    throw new PlannerError('RUNTIME_UNAVAILABLE', error instanceof Error ? error.message : 'runtime construction failed')
  }
  if (runtime === null) throw new PlannerError('RUNTIME_UNAVAILABLE', '该领域没有可用的视口运行时。')
  const plan: FramePlan = planFrames(runtime)
  if (plan.frames.length === 0) throw new PlannerError('NO_FRAMES', '没有构造出任何引擎帧。')
  return {
    frames: plan.frames.map(frame => ({ frameId: frame.frameId, snapshot: wireSnapshot(frame.snapshot) as unknown as Record<string, unknown> })),
    ...(plan.changedFrame === undefined ? {} : {
      changedFrame: { frameId: plan.changedFrame.frameId, snapshot: wireSnapshot(plan.changedFrame.snapshot) as unknown as Record<string, unknown> },
    }),
    notes: plan.notes,
  }
}

export type { SnapshotLike }
