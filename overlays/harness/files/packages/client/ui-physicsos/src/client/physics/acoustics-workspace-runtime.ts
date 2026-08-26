/**
 * Acoustics → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + AcousticsEngine for a pure single-range echo scene
 * and reports frames in the shared {@link WorkspaceSnapshot} shape, so the
 * acoustics domain renders through the same `PhysicsWorkspace` shell and
 * `PhysicsCanvas` as every other domain. Parameter edits (峭壁距离 / 声速) go
 * through real scene commands, so a change is an auditable revision bump
 * rather than local component state.
 *
 * Echo ranging HAS a real timeline: the pulse leaves at t = 0 and the echo
 * returns at t = 2d/v, so playback is genuine — the clock advances scene
 * seconds and every frame is the closed-form pulse state at that instant. No
 * physics is computed here; the pulse position comes from the engine's
 * verified kinematics.
 */

import {
  AcousticsEngine,
  createAcousticsSimulationRequest,
  echoTimingOf,
  pulseStateAt,
  resolveEchoRanging,
  type ResolvedAcousticModel,
} from '@physicsos/engine-acoustics'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  acousticBenchOf,
  createSceneCommand,
  type AcousticBench,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  acousticsObservableKeyOf,
  acousticsSceneVisual,
  fmtAcousticsValue,
  pulsePhaseText,
} from './acoustics-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
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
  wavefronts: '声波波前',
  path: '传播路径',
}

const DERIVED_LABELS: Record<string, string> = {
  wall_distance: '峭壁距离 d',
  sound_speed: '声速 v',
  one_way_time: '单程时间 t₁',
  echo_time: '回声时间 t',
  measured_distance: '测得距离 d = v·t/2',
}

/**
 * Verification labels. The engine folds the scene checks in (per-target ids
 * like `acoustic_bench_values:acoustic-bench-1`), so labels resolve by prefix.
 */
const VERIFICATION_LABELS: Record<string, string> = {
  echo_distance_formula: '回声测距公式 d = v·t/2',
  reflection_symmetry: '往返对称：t₁ = t₂ = d/v',
  pulse_speed_constant: '声速恒定（匀速直线传播）',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  acoustic_bench_dimensions: '测距台量纲正确',
  acoustic_bench_values: '峭壁在声源前方 · 声速为正',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Timeline markers for the three engine events, in the shell's own kinds. */
const EVENT_VIEW: Record<string, { label: string; kind: TimelineEvent['kind'] }> = {
  PulseEmitted: { label: '发出声脉冲', kind: 'launch' },
  PulseReflected: { label: '到达峭壁并反射', kind: 'apex' },
  EchoReceived: { label: '回声返回声源', kind: 'impact' },
}

/** Medium presets for the one-tap 介质 switch; the numeric field stays free. */
const MEDIUM_SPEEDS: Record<string, number> = {
  air: 340,
  water: 1500,
  steel: 5200,
}

const metres = (value: number) => quantity(value, 'm', 'length')

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedAcousticModel
}

export class AcousticsWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new AcousticsEngine()
  private currentTime = 0
  private running = false
  private rate = 1
  private commandSequence = 0
  private highlighted: readonly string[] = []
  private failure: string | undefined
  private computed: Computed | undefined
  /** The scene as the source stated it, kept so an experimental branch can be discarded. */
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
        createAcousticsSimulationRequest(
          scene,
          `acoustics-lab-${String(scene.id)}-${scene.revision}`,
          `acoustics-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveEchoRanging(scene)
      /* A parameter edit re-times the whole trip; clamp the clock into the new
         window so a shortened range does not park the pulse past the echo. */
      this.currentTime = Math.min(this.currentTime, echoTimingOf(model).roundTripTime)
      this.failure = undefined
      this.computed = { simulation, model }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '声学 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the solution the
       student just read was verified against the original conditions. Observable
       toggles are NOT facts and never fork. */
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    const result = this.sceneRuntime.execute(
      createSceneCommand<T>({
        commandId: `acoustics-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `acoustics-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '回声测距实验'
    const badge = branchBadgeOf(scene)
    const bench = acousticBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'acoustics',
        title,
        subtitle: scene.metadata.description ?? '真实声学 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('acoustics'),
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
          code: 'ACOUSTICS_RUNTIME_FAILED',
          message: this.failure ?? '当前声学场景不满足 Acoustics Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const { roundTripTime } = echoTimingOf(model)
    const pulse = pulseStateAt(model, this.currentTime)
    const view = acousticsSceneVisual({ scene, model, pulse, time: this.currentTime })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'acoustics',
      title,
      subtitle: scene.metadata.description ?? '真实声学 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, bench),
      inspector: this.inspectorOf(bench, model),
      charts: chartsOf(simulation, model),
      table: tableOf(simulation, model),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? fmtAcousticsValue(derived.value.value) : '—',
            unit: derived.value.unit,
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
        total: roundTripTime,
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

  private treeOf(scene: PhysicsScene, bench: AcousticBench): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const rangeChildren: SceneTreeNode[] = [
      {
        id: bench.source.id,
        label: bench.source.name ?? '声源',
        secondary: model === undefined ? '' : `x = ${fmtAcousticsValue(model.sourceX)} m`,
        icon: 'body' as const,
        kind: 'object' as const,
      },
      {
        id: bench.reflector.id,
        label: bench.reflector.name ?? '峭壁',
        secondary: model === undefined
          ? ''
          : `x = ${fmtAcousticsValue(model.reflectorX)} m · d = ${fmtAcousticsValue(model.wallDistance)} m`,
        icon: 'ground' as const,
        kind: 'object' as const,
      },
      {
        id: bench.id,
        label: '传播介质',
        secondary: `v = ${fmtAcousticsValue(canonicalValue(bench.soundSpeed))} m/s`,
        icon: 'field' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = acousticsObservableKeyOf(definition)
        if (key === undefined) return []
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[key] ?? key,
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: key,
        }]
      },
    )
    return [
      { id: 'range', label: '测距台', icon: 'folder', kind: 'group', children: rangeChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    bench: AcousticBench,
    model: ResolvedAcousticModel | undefined,
  ): readonly InspectorSection[] {
    const sections: InspectorSection[] = []
    const soundSpeed = model?.soundSpeed ?? canonicalValue(bench.soundSpeed)

    /* One-tap 介质 switch: the same range in air, water or steel — the point
       of the lesson is that v belongs to the medium. The numeric field stays
       for free-form speeds; a non-preset speed reads as 自定义. */
    const mediumValue =
      Object.entries(MEDIUM_SPEEDS).find(
        ([, speed]) => Math.abs(speed - soundSpeed) < 1e-9,
      )?.[0] ?? 'custom'

    sections.push({
      id: 'range',
      title: '测距台',
      parameters: [
        {
          id: 'wall-distance',
          label: '峭壁距离',
          symbol: 'd',
          unit: 'm',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat(model.wallDistance.toFixed(2)),
          min: 1,
          step: 10,
          highlights: bench.reflector.id,
        },
        {
          id: 'sound-speed',
          label: '声速',
          symbol: 'v',
          unit: 'm/s',
          value: Number.parseFloat(soundSpeed.toFixed(2)),
          min: 1,
          step: 10,
          highlights: bench.id,
        },
      ],
      choices: [
        {
          id: 'medium',
          label: '传播介质',
          value: mediumValue,
          options: [
            { value: 'air', label: '空气 15 ℃（340 m/s）' },
            { value: 'water', label: '水（1500 m/s）' },
            { value: 'steel', label: '钢铁（5200 m/s）' },
            { value: 'custom', label: '自定义声速' },
          ],
        },
      ],
    })

    if (this.computed !== undefined && model !== undefined) {
      const derived: DerivedQuantityView[] = this.computed.simulation.derivedQuantities
        .filter(entry => isScalarQuantity(entry.value))
        .map(entry => ({
          id: entry.key,
          label: derivedLabelOf(entry.key),
          symbol: '',
          value: isScalarQuantity(entry.value) ? fmtAcousticsValue(entry.value.value) : '—',
          unit: entry.value.unit,
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      /* The frame's own reading: which leg the pulse is on right now. */
      derived.push({
        id: 'pulse-phase',
        label: '脉冲状态',
        symbol: '',
        value: pulsePhaseText(pulseStateAt(model, this.currentTime).phase),
        unit: '',
        highlights: 'sound-pulse',
      })
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const bench = acousticBenchOf(scene)
    const model = this.computed?.model
    if (bench === undefined || model === undefined) return this.getSnapshot()

    if (id === 'wall-distance') {
      this.command('SetAcousticReflectorPosition', {
        benchId: bench.id,
        position: metres(model.sourceX + value),
      })
    } else if (id === 'sound-speed') {
      this.command('SetAcousticSoundSpeed', {
        benchId: bench.id,
        soundSpeed: quantity(value, 'm/s', 'velocity'),
      })
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'medium') {
      const speed = MEDIUM_SPEEDS[value]
      const bench = acousticBenchOf(this.sceneRuntime.getScene())
      /* `custom` is a display state, not a command — the numeric field owns it. */
      if (speed !== undefined && bench !== undefined) {
        if (Math.abs(canonicalValue(bench.soundSpeed) - speed) > 1e-9) {
          this.command('SetAcousticSoundSpeed', {
            benchId: bench.id,
            soundSpeed: quantity(speed, 'm/s', 'velocity'),
          })
        }
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => acousticsObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    /* Restarting the finished experiment replays it from the clap. */
    if (running && this.computed !== undefined) {
      const { roundTripTime } = echoTimingOf(this.computed.model)
      if (this.currentTime >= roundTripTime) this.currentTime = 0
    }
    this.running = running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const total = this.computed === undefined ? 0 : echoTimingOf(this.computed.model).roundTripTime
    this.currentTime = Number.isFinite(time) ? Math.min(total, Math.max(0, time)) : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    /* Echo trips run at human seconds (2 s for the textbook range), so wall
       time maps 1:1 onto scene time. The run stops at the echo rather than
       looping: hearing the echo IS the measurement. */
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const { roundTripTime } = echoTimingOf(this.computed.model)
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= roundTripTime ? roundTripTime : next
      if (this.currentTime >= roundTripTime) this.running = false
    }
    return this.getSnapshot()
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.getSnapshot()
  }

  /** Discard an experimental branch and return to the scene the question stated. */
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

/* -------------------------------------------------------------- projections -- */

/** Pulse position over the whole round trip — the x–t triangle wave. */
const chartsOf = (
  simulation: SimulationResult,
  model: ResolvedAcousticModel,
): readonly ChartSeries[] => {
  const points = simulation.states.flatMap((state) => {
    const benchValues = state.objects.find(object => object.id === model.benchId)?.values
    const position = benchValues?.['pulse_position_x']
    if (position === undefined || !isScalarQuantity(position)) return []
    return [{ t: canonicalValue(state.time), value: position.value }]
  })
  if (points.length === 0) return []
  return [{
    id: 'pulse-position',
    title: '脉冲位置 x–t 图（往返折线）',
    xLabel: 't / s',
    yLabel: 'x / m',
    role: 'trajectory',
    points,
  }]
}

/** Sampled readings across the trip: t, x, travelled distance, leg. */
const tableOf = (
  simulation: SimulationResult,
  model: ResolvedAcousticModel,
): DataTableView => {
  const stride = 8
  const rows = simulation.states.flatMap((state, index) => {
    if (index % stride !== 0 && index !== simulation.states.length - 1) return []
    const timeSeconds = canonicalValue(state.time)
    const pulse = pulseStateAt(model, timeSeconds)
    return [{
      step: index,
      values: [
        timeSeconds.toFixed(3),
        fmtAcousticsValue(pulse.x),
        fmtAcousticsValue(pulse.travelled),
        pulse.phase === 'outbound' ? '去程' : pulse.phase === 'return' ? '回程' : '已接收',
      ],
    }]
  })
  return { columns: ['t / s', 'x / m', '路程 / m', '阶段'], rows }
}

export const createAcousticsWorkspaceRuntime = (scene: PhysicsScene): AcousticsWorkspaceRuntime =>
  new AcousticsWorkspaceRuntime(scene)
