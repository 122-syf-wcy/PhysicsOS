/**
 * Lever statics → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + LeverEngine for a pure class-1 lever scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the lever
 * stays inside the mechanics Lab (same picker group, same renderer domain)
 * rather than inventing a tenth subject. Parameter edits (钩码质量 / 力臂)
 * go through real scene commands, so a change is an auditable revision bump
 * rather than local component state.
 *
 * The physics is statics: masses and arms do not change with time. The short
 * clock is only the display tip — an unbalanced beam leans toward the larger
 * moment so the student can see which side went down.
 */

import {
  LeverEngine,
  createLeverSimulationRequest,
  leverRunDuration,
  leverStateAt,
  momentsOf,
  resolveMomentBalance,
  type ResolvedLeverModel,
} from '@physicsos/engine-lever'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  leverBenchOf,
  type LeverBench,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import {
  fmtLeverValue,
  leverObservableKeyOf,
  leverPhaseText,
  leverSceneVisual,
} from './lever-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ChartSeries,
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<string, string> = {
  moments: '重力和力矩',
  arms: '力臂',
}

const DERIVED_LABELS: Record<string, string> = {
  left_weight: '左端重力 G₁',
  right_weight: '右端重力 G₂',
  left_arm: '左力臂 l₁',
  right_arm: '右力臂 l₂',
  left_moment: '左端力矩 M₁',
  right_moment: '右端力矩 M₂',
  moment_ratio: '力矩比 M₁/M₂',
}

const VERIFICATION_LABELS: Record<string, string> = {
  weight_from_mass: '钩码重力 G = mg',
  moment_from_force: '力矩 M = F·l',
  arms_opposite: '第一类杠杆：支点在中间',
  moment_balance: '杠杆平衡条件 F₁l₁ = F₂l₂',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  lever_bench_dimensions: '实验台量纲正确',
  lever_bench_values: '两边钩码在支点两侧，质量与力臂均为正',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

const EVENT_VIEW: Record<string, { label: string; kind: TimelineEvent['kind'] }> = {
  LeverBalanced: { label: '杠杆平衡', kind: 'launch' },
  LeverSettling: { label: '开始倾斜', kind: 'launch' },
  LeverTipped: { label: '倾斜到位', kind: 'impact' },
}

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedLeverModel
}

const cmOf = (metres: number): number => metres * 100
const nCmOf = (newtonMetres: number): number => newtonMetres * 100

export class LeverWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new LeverEngine()
  private currentTime = 0
  private running = false
  private rate = 1
  private commandSequence = 0
  private highlighted: readonly string[] = []
  private failure: string | undefined
  private computed: Computed | undefined
  private readonly origin: PhysicsScene | undefined

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    this.origin = scene.metadata.sourceQuestionId === undefined ? undefined : scene
    this.recompute()
  }

  private recompute(): void {
    const scene = this.sceneRuntime.getScene()
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const simulation = this.engine.simulate(
        scene,
        createLeverSimulationRequest(
          scene,
          `lever-lab-${String(scene.id)}-${scene.revision}`,
          `lever-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveMomentBalance(scene)
      this.currentTime = Math.min(this.currentTime, leverRunDuration())
      this.failure = undefined
      this.computed = { simulation, model }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '杠杆 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    const result = this.sceneRuntime.execute(
      createSceneCommand<T>({
        commandId: `lever-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `lever-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    this.recompute()
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '杠杆实验'
    const badge = branchBadgeOf(scene)
    const bench = leverBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'mechanics',
        title,
        subtitle: scene.metadata.description ?? '真实杠杆 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('mechanics'),
        ariaLabel: title,
        tree: bench === undefined ? [] : this.treeOf(scene, bench),
        inspector: bench === undefined ? [] : this.inspectorOf(bench, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'LEVER_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Lever Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const totalTime = leverRunDuration()
    const state = leverStateAt(model, this.currentTime)
    const view = leverSceneVisual({ scene, model, state, time: this.currentTime })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'mechanics',
      title,
      subtitle: scene.metadata.description ?? '真实杠杆 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, bench),
      inspector: this.inspectorOf(bench, model),
      charts: chartsOf(simulation, model),
      table: tableOf(model),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value)
              ? formatDerived(derived.key, derived.value.value)
              : '—',
            unit: derivedUnitOf(derived.key, derived.value.unit),
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: simulation.events.flatMap((event) => {
        const viewOf = EVENT_VIEW[event.type]
        if (viewOf === undefined || typeof event.time !== 'number') return []
        return [{ id: String(event.eventId), time: event.time, label: viewOf.label, kind: viewOf.kind }]
      }),
      clock: {
        time: this.currentTime,
        total: totalTime,
        running: this.running,
        rate: this.rate,
      },
      trajectoryTimes: [],
      ...(badge === undefined
        ? {}
        : {
          branch: {
            originQuestionTitle: this.origin?.metadata.title,
            parentRevision: badge.parentRevision,
            canRestore: this.origin !== undefined,
          },
        }),
    }
  }

  private treeOf(scene: PhysicsScene, bench: LeverBench): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const moments = model === undefined ? undefined : momentsOf(model)
    const hangerChildren: SceneTreeNode[] = bench.hangers.map((hanger) => {
      const resolved = hanger.side === 'left' ? model?.left : model?.right
      const moment = hanger.side === 'left' ? moments?.leftMoment : moments?.rightMoment
      return {
        id: hanger.id,
        label: hanger.name ?? (hanger.side === 'left' ? '左钩码' : '右钩码'),
        secondary: resolved === undefined || moment === undefined
          ? ''
          : `m = ${fmtLeverValue(resolved.mass * 1000, 4)} g · l = ${fmtLeverValue(cmOf(resolved.armLength), 3)} cm · M = ${fmtLeverValue(nCmOf(moment), 4)} N·cm`,
        icon: 'body' as const,
        kind: 'object' as const,
      }
    })
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap((definition) => {
      const key = leverObservableKeyOf(definition)
      if (key === undefined) return []
      return [{
        id: String(definition.id),
        label: OBSERVABLE_LABELS[key] ?? key,
        icon: 'observable' as const,
        kind: 'observable' as const,
        observable: key,
      }]
    })
    return [
      { id: 'lever', label: '杠杆', icon: 'folder', kind: 'group', children: hangerChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    bench: LeverBench,
    model: ResolvedLeverModel | undefined,
  ): readonly InspectorSection[] {
    const left = bench.hangers.find(hanger => hanger.side === 'left')
    const right = bench.hangers.find(hanger => hanger.side === 'right')
    const sections: InspectorSection[] = [
      {
        id: 'lever',
        title: '杠杆',
        parameters: [
          {
            id: 'left-mass',
            label: '左钩码质量',
            symbol: 'm₁',
            unit: 'g',
            value: model === undefined
              ? Number.NaN
              : Number.parseFloat((model.left.mass * 1000).toFixed(2)),
            min: 1,
            step: 20,
            ...(left === undefined ? {} : { highlights: left.id }),
          },
          {
            id: 'left-arm',
            label: '左力臂',
            symbol: 'l₁',
            unit: 'cm',
            value: model === undefined
              ? Number.NaN
              : Number.parseFloat(cmOf(model.left.armLength).toFixed(2)),
            min: 1,
            ...(model === undefined
              ? {}
              : { max: Number.parseFloat(cmOf(model.beamLength / 2).toFixed(2)) }),
            step: 0.5,
            ...(left === undefined ? {} : { highlights: left.id }),
          },
          {
            id: 'right-mass',
            label: '右钩码质量',
            symbol: 'm₂',
            unit: 'g',
            value: model === undefined
              ? Number.NaN
              : Number.parseFloat((model.right.mass * 1000).toFixed(2)),
            min: 1,
            step: 20,
            ...(right === undefined ? {} : { highlights: right.id }),
          },
          {
            id: 'right-arm',
            label: '右力臂',
            symbol: 'l₂',
            unit: 'cm',
            value: model === undefined
              ? Number.NaN
              : Number.parseFloat(cmOf(model.right.armLength).toFixed(2)),
            min: 1,
            ...(model === undefined
              ? {}
              : { max: Number.parseFloat(cmOf(model.beamLength / 2).toFixed(2)) }),
            step: 0.5,
            ...(right === undefined ? {} : { highlights: right.id }),
          },
        ],
      },
    ]

    if (this.computed !== undefined && model !== undefined) {
      const state = leverStateAt(model, this.currentTime)
      const derived: DerivedQuantityView[] = this.computed.simulation.derivedQuantities
        .filter(entry => isScalarQuantity(entry.value))
        .map(entry => ({
          id: entry.key,
          label: derivedLabelOf(entry.key),
          symbol: '',
          value: isScalarQuantity(entry.value)
            ? formatDerived(entry.key, entry.value.value)
            : '—',
          unit: derivedUnitOf(entry.key, entry.value.unit),
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      derived.push({
        id: 'balance-state',
        label: '平衡判断',
        symbol: '',
        value: leverPhaseText(state),
        unit: '',
        highlights: model.leverId,
      })
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const bench = leverBenchOf(this.sceneRuntime.getScene())
    if (bench === undefined) return this.getSnapshot()
    const left = bench.hangers.find(hanger => hanger.side === 'left')
    const right = bench.hangers.find(hanger => hanger.side === 'right')

    if (id === 'left-mass' && left !== undefined) {
      this.command('SetHangerMass', {
        leverId: bench.id,
        hangerId: left.id,
        mass: quantity(value, 'g', 'mass'),
      })
    } else if (id === 'right-mass' && right !== undefined) {
      this.command('SetHangerMass', {
        leverId: bench.id,
        hangerId: right.id,
        mass: quantity(value, 'g', 'mass'),
      })
    } else if (id === 'left-arm' && left !== undefined) {
      this.command('SetHangerArm', {
        leverId: bench.id,
        hangerId: left.id,
        armLength: quantity(value, 'cm', 'length'),
      })
    } else if (id === 'right-arm' && right !== undefined) {
      this.command('SetHangerArm', {
        leverId: bench.id,
        hangerId: right.id,
        armLength: quantity(value, 'cm', 'length'),
      })
    }
    return this.getSnapshot()
  }

  setChoice(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => leverObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    if (running && this.computed !== undefined) {
      const totalTime = leverRunDuration()
      if (this.currentTime >= totalTime) this.currentTime = 0
    }
    this.running = running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const total = this.computed === undefined ? 0 : leverRunDuration()
    this.currentTime = Number.isFinite(time) ? Math.min(total, Math.max(0, time)) : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const totalTime = leverRunDuration()
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= totalTime ? totalTime : next
      if (this.currentTime >= totalTime) this.running = false
    }
    return this.getSnapshot()
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.getSnapshot()
  }

  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin === undefined) return this.getSnapshot()
    this.sceneRuntime = new SceneRuntime(this.origin)
    this.highlighted = []
    this.currentTime = 0
    this.running = false
    this.recompute()
    return this.getSnapshot()
  }
}

const formatDerived = (key: string, value: number): string => {
  if (key === 'left_arm' || key === 'right_arm') return fmtLeverValue(cmOf(value), 3)
  if (key === 'left_moment' || key === 'right_moment') return fmtLeverValue(nCmOf(value), 4)
  if (key === 'moment_ratio') return fmtLeverValue(value, 4)
  return fmtLeverValue(value, 4)
}

const derivedUnitOf = (key: string, fallback: string): string => {
  if (key === 'left_arm' || key === 'right_arm') return 'cm'
  if (key === 'left_moment' || key === 'right_moment') return 'N·cm'
  if (key === 'moment_ratio') return ''
  return fallback
}

const chartsOf = (
  simulation: SimulationResult,
  model: ResolvedLeverModel,
): readonly ChartSeries[] => {
  const points = simulation.states.flatMap((state) => {
    const values = state.objects.find(object => object.id === model.leverId)?.values
    const tilt = values?.['tilt']
    if (tilt === undefined || !isScalarQuantity(tilt)) return []
    return [{ t: canonicalValue(state.time), value: (tilt.value * 180) / Math.PI }]
  })
  if (points.length === 0) return []
  return [{
    id: 'lever-tilt',
    title: momentsOf(model).balanced ? '倾角 θ–t（保持水平）' : '倾角 θ–t（向力矩大的一侧倾斜）',
    xLabel: 't / s',
    yLabel: 'θ / °',
    role: 'trajectory',
    points,
  }]
}

const tableOf = (model: ResolvedLeverModel): DataTableView => {
  const moments = momentsOf(model)
  return {
    columns: ['钩码', 'm / g', 'l / cm', 'G / N', 'M / N·cm'],
    rows: [
      {
        step: 0,
        values: [
          '左',
          fmtLeverValue(model.left.mass * 1000, 4),
          fmtLeverValue(cmOf(model.left.armLength), 3),
          fmtLeverValue(moments.leftWeight, 3),
          fmtLeverValue(nCmOf(moments.leftMoment), 4),
        ],
      },
      {
        step: 1,
        values: [
          '右',
          fmtLeverValue(model.right.mass * 1000, 4),
          fmtLeverValue(cmOf(model.right.armLength), 3),
          fmtLeverValue(moments.rightWeight, 3),
          fmtLeverValue(nCmOf(moments.rightMoment), 4),
        ],
      },
    ],
  }
}

export const createLeverWorkspaceRuntime = (scene: PhysicsScene): LeverWorkspaceRuntime =>
  new LeverWorkspaceRuntime(scene)
