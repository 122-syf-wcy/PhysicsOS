/**
 * Thermal → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + ThermalEngine for a pure single-sample heating scene
 * and reports frames in the shared {@link WorkspaceSnapshot} shape, so the
 * thermal domain renders through the same `PhysicsWorkspace` shell and
 * `PhysicsCanvas` as every other domain. Parameter edits (加热功率 / 样品质量)
 * go through real scene commands, so a change is an auditable revision bump
 * rather than local component state.
 *
 * Heating HAS a real timeline and it is a long one — the textbook run is 836
 * scene seconds. Playback therefore defaults to a fast rate: the clock advances
 * scene seconds and every frame is the closed-form state at that instant, so
 * running quickly costs nothing and no physics is recomputed per frame.
 */

import {
  ThermalEngine,
  createThermalSimulationRequest,
  heatingTimingOf,
  resolveHeatingCurve,
  thermalStateAt,
  type ResolvedThermalModel,
} from '@physicsos/engine-thermal'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  thermalBenchOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
  type ThermalBench,
} from '@physicsos/physics-scene'

import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import {
  celsiusOf,
  fmtThermalValue,
  thermalObservableKeyOf,
  thermalPhaseText,
  thermalSceneVisual,
} from './thermal-visual-bridge.ts'
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
  thermometer: '温度计读数',
  phase: '熔点参考线',
}

const DERIVED_LABELS: Record<string, string> = {
  heater_power: '加热功率 P',
  melting_point: '熔点 T_熔',
  warm_up_time: '升温耗时 t₁',
  melting_duration: '熔化耗时 t_熔',
  melting_heat: '熔化吸热 Q_熔',
  warm_up_heat: '升温吸热 Q₁',
  total_heat: '总吸热 Q_总',
}

/**
 * Verification labels. The engine folds the scene checks in (per-target ids
 * like `thermal_bench_values:thermal-bench-1`), so labels resolve by prefix.
 */
const VERIFICATION_LABELS: Record<string, string> = {
  energy_conservation: '能量守恒：分段吸热 = P·t',
  heating_rate_ratio: '升温速率之比 = 比热容反比',
  melting_plateau: '熔化时吸热但温度不变',
  plateau_duration: '熔化耗时 t = mL/P',
  amorphous_no_plateau: '非晶体无固定熔点（温度持续上升）',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  thermal_bench_dimensions: '实验台量纲正确',
  thermal_bench_values: '质量 · 比热容 · 功率均为正且起始温度低于熔点',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Timeline markers for the engine events, in the shell's own kinds. */
const EVENT_VIEW: Record<string, { label: string; kind: TimelineEvent['kind'] }> = {
  HeatingStarted: { label: '开始加热', kind: 'launch' },
  MeltingStarted: { label: '开始熔化', kind: 'apex' },
  SofteningStarted: { label: '开始软化', kind: 'apex' },
  MeltingComplete: { label: '熔化完毕', kind: 'impact' },
}

/**
 * Heating runs in the hundreds of scene seconds, so the clock starts fast.
 * Every frame is a closed-form evaluation, so speed costs nothing.
 */
const DEFAULT_RATE = 20

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedThermalModel
}

export class ThermalWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new ThermalEngine()
  private currentTime = 0
  private running = false
  private rate = DEFAULT_RATE
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
        createThermalSimulationRequest(
          scene,
          `thermal-lab-${String(scene.id)}-${scene.revision}`,
          `thermal-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveHeatingCurve(scene)
      /* A parameter edit re-times the whole run; clamp the clock into the new
         window so a doubled power does not park the frame past the end. */
      this.currentTime = Math.min(this.currentTime, heatingTimingOf(model).totalTime)
      this.failure = undefined
      this.computed = { simulation, model }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '热学 Runtime 无法启动。'
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
        commandId: `thermal-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `thermal-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '加热实验'
    const badge = branchBadgeOf(scene)
    const bench = thermalBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'thermal',
        title,
        subtitle: scene.metadata.description ?? '真实热学 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('thermal'),
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
          code: 'THERMAL_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Thermal Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const { totalTime } = heatingTimingOf(model)
    const state = thermalStateAt(model, this.currentTime)
    const view = thermalSceneVisual({
      scene,
      model,
      state,
      time: this.currentTime,
      peakTemperature: thermalStateAt(model, totalTime).temperature,
    })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'thermal',
      title,
      subtitle: scene.metadata.description ?? '真实热学 Runtime',
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
            value: isScalarQuantity(derived.value)
              ? formatDerived(derived.key, derived.value.value)
              : '—',
            unit: derived.key === 'melting_point' ? '℃' : derived.value.unit,
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

  private treeOf(scene: PhysicsScene, bench: ThermalBench): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const benchChildren: SceneTreeNode[] = [
      {
        id: bench.sample.id,
        label: bench.sample.name ?? '样品',
        secondary: model === undefined
          ? ''
          : `m = ${fmtThermalValue(model.mass * 1000, 4)} g · c_固 = ${fmtThermalValue(model.solidSpecificHeat, 4)} J/(kg·℃)`,
        icon: 'body' as const,
        kind: 'object' as const,
      },
      {
        id: bench.id,
        label: '加热器',
        secondary: model === undefined ? '' : `P = ${fmtThermalValue(model.heaterPower, 3)} W`,
        icon: 'field' as const,
        kind: 'object' as const,
      },
      {
        id: 'thermometer',
        label: '温度计',
        secondary: model === undefined
          ? ''
          : `${celsiusOf(thermalStateAt(model, this.currentTime).temperature).toFixed(1)} ℃`,
        icon: 'observable' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = thermalObservableKeyOf(definition)
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
      { id: 'bench', label: '加热实验台', icon: 'folder', kind: 'group', children: benchChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    bench: ThermalBench,
    model: ResolvedThermalModel | undefined,
  ): readonly InspectorSection[] {
    const sections: InspectorSection[] = []

    sections.push({
      id: 'bench',
      title: '加热实验台',
      parameters: [
        {
          id: 'sample-mass',
          label: '样品质量',
          symbol: 'm',
          unit: 'g',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.mass * 1000).toFixed(2)),
          min: 1,
          step: 20,
          highlights: bench.sample.id,
        },
        {
          id: 'heater-power',
          label: '加热功率',
          symbol: 'P',
          unit: 'W',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat(model.heaterPower.toFixed(2)),
          min: 1,
          step: 10,
          highlights: bench.id,
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
          value: isScalarQuantity(entry.value)
            ? formatDerived(entry.key, entry.value.value)
            : '—',
          unit: entry.key === 'melting_point' ? '℃' : entry.value.unit,
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      /* The frame's own readings: what the thermometer says right now and which
         stretch of the curve it is on. */
      const state = thermalStateAt(model, this.currentTime)
      derived.push({
        id: 'current-temperature',
        label: '当前温度 T',
        symbol: '',
        value: celsiusOf(state.temperature).toFixed(1),
        unit: '℃',
        highlights: model.sampleId,
      })
      derived.push({
        id: 'thermal-phase',
        label: '所处阶段',
        symbol: '',
        value: thermalPhaseText(state.phase, model.crystalline),
        unit: '',
        highlights: model.sampleId,
      })
      derived.push({
        id: 'crystalline',
        label: '晶体判断',
        symbol: '',
        value: model.crystalline ? '晶体 · 有固定熔点' : '非晶体 · 无固定熔点',
        unit: '',
        highlights: model.sampleId,
      })
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const bench = thermalBenchOf(this.sceneRuntime.getScene())
    if (bench === undefined) return this.getSnapshot()

    if (id === 'sample-mass') {
      this.command('SetSampleMass', { benchId: bench.id, mass: quantity(value, 'g', 'mass') })
    } else if (id === 'heater-power') {
      this.command('SetHeaterPower', { benchId: bench.id, power: quantity(value, 'W', 'power') })
    }
    return this.getSnapshot()
  }

  setChoice(): WorkspaceSnapshot {
    /* The heating bench has no preset switches: the sample's material constants
       are what make it a crystal, and those are stated by the template rather
       than dialled in. */
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => thermalObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    /* Restarting the finished experiment cools the sample back to its start. */
    if (running && this.computed !== undefined) {
      const { totalTime } = heatingTimingOf(this.computed.model)
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
    const total = this.computed === undefined ? 0 : heatingTimingOf(this.computed.model).totalTime
    this.currentTime = Number.isFinite(time) ? Math.min(total, Math.max(0, time)) : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    /* The run stops at the end rather than looping: the finished curve IS the
       result the student reads. */
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const { totalTime } = heatingTimingOf(this.computed.model)
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

/** Temperatures are stated in kelvin but taught in °C; everything else is SI. */
const formatDerived = (key: string, value: number): string =>
  key === 'melting_point' ? celsiusOf(value).toFixed(1) : fmtThermalValue(value)

/** The heating curve itself — the graph this experiment exists to produce. */
const chartsOf = (
  simulation: SimulationResult,
  model: ResolvedThermalModel,
): readonly ChartSeries[] => {
  const points = simulation.states.flatMap((state) => {
    const benchValues = state.objects.find(object => object.id === model.benchId)?.values
    const temperature = benchValues?.['temperature']
    if (temperature === undefined || !isScalarQuantity(temperature)) return []
    return [{ t: canonicalValue(state.time), value: celsiusOf(temperature.value) }]
  })
  if (points.length === 0) return []
  return [{
    id: 'heating-curve',
    title: model.crystalline
      ? '熔化图像 T–t（升温 · 水平段 · 再升温）'
      : '加热图像 T–t（非晶体，无水平段）',
    xLabel: 't / s',
    yLabel: 'T / ℃',
    role: 'trajectory',
    points,
  }]
}

/** Sampled readings across the run: t, T, heat absorbed, melted fraction. */
const tableOf = (
  simulation: SimulationResult,
  model: ResolvedThermalModel,
): DataTableView => {
  const stride = 12
  const rows = simulation.states.flatMap((state, index) => {
    if (index % stride !== 0 && index !== simulation.states.length - 1) return []
    const timeSeconds = canonicalValue(state.time)
    const thermal = thermalStateAt(model, timeSeconds)
    return [{
      step: index,
      values: [
        timeSeconds.toFixed(0),
        celsiusOf(thermal.temperature).toFixed(1),
        fmtThermalValue(thermal.heatAbsorbed, 5),
        `${(thermal.meltedFraction * 100).toFixed(0)}%`,
        thermalPhaseText(thermal.phase, model.crystalline),
      ],
    }]
  })
  return {
    columns: ['t / s', 'T / ℃', '已吸热 / J', '已熔化', '阶段'],
    rows,
  }
}

export const createThermalWorkspaceRuntime = (scene: PhysicsScene): ThermalWorkspaceRuntime =>
  new ThermalWorkspaceRuntime(scene)
