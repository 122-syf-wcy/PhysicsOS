/**
 * Induction → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + InductionEngine for a pure single-bench induction
 * scene and reports frames in the shared {@link WorkspaceSnapshot} shape, so
 * the induction domain renders through the same `PhysicsWorkspace` shell and
 * `PhysicsCanvas` as every other domain. Parameter edits (B / R / 棒速 /
 * 磁通量变化率) go through real scene commands, so a change is an auditable
 * revision bump rather than local component state.
 *
 * The physics is closed-form: E = BLv (bar_motion) or E = -dΦ/dt (flux_change),
 * constant over the run. The clock animates the bar's sweep x(t) = v·t — the
 * student SEES the rod cross the field while the readout stays put, which is
 * the whole lesson (a steady cut yields a steady EMF).
 */

import {
  createInductionSimulationRequest,
  InductionEngine,
  resolveInductionModel,
  type ResolvedInductionModel,
} from '@physicsos/engine-induction'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  inductionBenchOf,
  type InductionBench,
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
  fmtInductionValue,
  inductionObservableKeyOf,
  inductionSceneVisual,
  lenzDirectionText,
} from './induction-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  QuantityParameter,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

/** Bar sweep window: enough for a visible crossing at the default v = 2 m/s.
    The double_bar_rail rig needs a longer window — its relative velocity decays
    with τ = R·m₁m₂/(B²L²(m₁+m₂)) ≈ 10 s on the defaults — so the run length
    comes from the scene's timeline (the double-bar factory stamps 10 s). */
const RUN_DURATION_SECONDS = 5

const OBSERVABLE_LABELS: Record<string, string> = {
  emf: '感应电动势',
  inductionCurrent: '感应电流',
  flux: '磁通量',
  barMotion: '导体棒运动',
  barVelocity: '双棒速度',
}

const DERIVED_LABELS: Record<string, string> = {
  induced_emf: '感应电动势 E',
  induced_current: '感应电流 I',
  loop_resistance: '回路电阻 R',
  magnetic_flux_density: '磁感应强度 B',
  bar_length: '棒长 L（导轨间距）',
  bar_velocity: '棒速 v',
  flux_rate: '磁通量变化率 dΦ/dt',
  magnetic_flux: '磁通量 Φ',
  lenz_direction: '感应方向（+1/−1）',
  bar1_velocity: '棒 1 速度 v₁',
  bar2_velocity: '棒 2 速度 v₂',
  relative_velocity: '相对速度 u = v₁ − v₂',
  magnetic_force: '磁力 F磁 = BIL',
  momentum1: '棒 1 动量 p₁',
  momentum2: '棒 2 动量 p₂',
  kinetic_energy: '总动能 K',
  joule_heat: '焦耳热 Q',
}

const VERIFICATION_LABELS: Record<string, string> = {
  faraday_law: '法拉第定律 E = BLv / E = -dΦ/dt / E = BL(v₁−v₂)',
  lenz_direction: '楞次定律方向',
  lenz_force_opposes_relative_motion: '楞次定律：磁力阻碍相对运动',
  momentum_conservation: '动量守恒（无外力双棒）',
  energy_bookkeeping: '能量守恒：K + Q = K₀ + W',
  ohm_law_loop: '回路欧姆定律 I = E/R',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  induction_bench_dimensions: '实验台量纲正确',
  induction_bench_values: 'B、R 为正，几何量为正（方向量可为负）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** The run window comes from the scene's timeline (double-bar stamps 10 s). */
const runDurationOf = (scene: PhysicsScene): number => {
  const end = scene.timeline.endTime
  return end === undefined ? RUN_DURATION_SECONDS : canonicalValue(end)
}

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedInductionModel
}

/** The signed engine fact behind the 感应方向 sentence: a sweeping bar quotes
 *  its derived EMF (E = BLv, sign = cutting direction), a coil rig quotes the
 *  stated flux rate dΦ/dt. Both are engine published values, never recomputed. */
const lenzReadoutOf = (simulation: SimulationResult, model: ResolvedInductionModel): number => {
  const key = model.subModel === 'bar_motion_emf' ? 'induced_emf' : 'flux_rate'
  const entry = simulation.derivedQuantities.find(candidate => candidate.key === key)
  return entry === undefined || !isScalarQuantity(entry.value) ? Number.NaN : entry.value.value
}

/**
 * The induction workspace runtime — see the module doc for its role.
 */
export class InductionWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new InductionEngine()
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
        createInductionSimulationRequest(
          scene,
          `induction-lab-${String(scene.id)}-${scene.revision}`,
          `induction-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveInductionModel(scene)
      this.currentTime = Math.min(this.currentTime, runDurationOf(scene))
      this.failure = undefined
      this.computed = { simulation, model }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '感应 Runtime 无法启动。'
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
        commandId: `induction-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `induction-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '电磁感应实验'
    const badge = branchBadgeOf(scene)
    const bench = inductionBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'induction',
        title,
        subtitle: scene.metadata.description ?? '真实电磁感应 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('induction'),
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
          code: 'INDUCTION_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Induction Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    /* The frame is drawn from the engine's EXACT state at the clock time, not
       the nearest of 61 samples: on the double-bar rig (τ = 0.25 s) a sample
       can sit 0.03 s from the clock, and the E / v readouts would then belong
       to a different instant than the "t =" printed beside them. */
    const frameState = this.engine.stateAt(scene, quantity(this.currentTime, 's', 'time'))
    const view = inductionSceneVisual({
      scene,
      model,
      simulation,
      time: this.currentTime,
      state: frameState,
    })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'induction',
      title,
      subtitle: scene.metadata.description ?? '真实电磁感应 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, bench),
      inspector: this.inspectorOf(bench, model, frameState.derived),
      charts: chartsOf(simulation, model),
      table: tableOf(model, simulation),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? formatDerived(derived.key, derived.value.value) : '—',
            unit: derivedUnitOf(derived.key, derived.value.unit),
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      /* The bar sweep is the animation; a flux_change run is a steady reading. */
      clock: {
        time: this.currentTime,
        total: runDurationOf(scene),
        running: this.running,
        rate: this.rate,
      },
      trajectoryTimes: simulation.states.map(state => canonicalValue(state.time)),
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

  private treeOf(scene: PhysicsScene, bench: InductionBench): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const isDoubleBar = bench.type === 'double_bar_rail'
    const benchChildren: SceneTreeNode[] = [
      {
        id: bench.id,
        label: isDoubleBar ? '导轨与双棒' : bench.type === 'bar_motion' ? '导体棒与导轨' : '线圈',
        secondary: model === undefined
          ? ''
          : `B = ${fmtInductionValue(model.magneticFluxDensity, 3)} T · R = ${fmtInductionValue(model.resistance, 3)} Ω`,
        icon: 'field' as const,
        kind: 'object' as const,
      },
    ]
    if (bench.type === 'bar_motion' && bench.barLength !== undefined) {
      benchChildren.push({
        id: `${bench.id}.bar`,
        label: '导体棒',
        secondary: `L = ${fmtInductionValue(canonicalValue(bench.barLength) * 100, 3)} cm · v = ${model === undefined ? '—' : fmtInductionValue(model.barVelocity, 3)} m/s`,
        icon: 'body' as const,
        kind: 'object' as const,
      })
    }
    if (isDoubleBar) {
      benchChildren.push({
        id: `${bench.id}.bar1`,
        label: '棒 1（左）',
        secondary: model === undefined
          ? ''
          : `m₁ = ${fmtInductionValue((model.barMasses?.[0] ?? 0) * 1000, 3)} g · v₁₀ = ${fmtInductionValue(model.barVelocities?.[0] ?? 0, 3)} m/s`,
        icon: 'body' as const,
        kind: 'object' as const,
      })
      benchChildren.push({
        id: `${bench.id}.bar2`,
        label: '棒 2（右）',
        secondary: model === undefined
          ? ''
          : `m₂ = ${fmtInductionValue((model.barMasses?.[1] ?? 0) * 1000, 3)} g · v₂₀ = ${fmtInductionValue(model.barVelocities?.[1] ?? 0, 3)} m/s`,
        icon: 'body' as const,
        kind: 'object' as const,
      })
    }
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = inductionObservableKeyOf(definition)
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
      { id: 'bench', label: bench.type === 'bar_motion' ? '切割磁感线装置' : bench.type === 'double_bar_rail' ? '导轨双棒装置' : '磁通量变化装置', icon: 'folder', kind: 'group', children: benchChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    bench: InductionBench,
    model: ResolvedInductionModel | undefined,
    frameDerived?: SimulationResult['derivedQuantities'],
  ): readonly InspectorSection[] {
    const sections: InspectorSection[] = []
    const isBar = bench.type === 'bar_motion'
    const isDoubleBar = bench.type === 'double_bar_rail'

    const parameters: QuantityParameter[] = [
      {
        id: 'field-strength',
        label: '磁感应强度',
        symbol: 'B',
        unit: 'T',
        value: model === undefined
          ? Number.NaN
          : Number.parseFloat(model.magneticFluxDensity.toFixed(3)),
        min: 0.1,
        step: 0.1,
        highlights: bench.id,
      },
      {
        id: 'loop-resistance',
        label: '回路电阻',
        symbol: 'R',
        unit: 'Ω',
        value: model === undefined
          ? Number.NaN
          : Number.parseFloat(model.resistance.toFixed(2)),
        min: 0.5,
        step: 0.5,
        highlights: bench.id,
      },
    ]

    if (isBar) {
      parameters.push(
        {
          id: 'bar-length',
          label: '棒长',
          symbol: 'L',
          unit: 'cm',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.barLength * 100).toFixed(1)),
          min: 5,
          step: 5,
          highlights: `${bench.id}.bar`,
        },
        {
          id: 'bar-velocity',
          label: '棒速（正负 = 方向）',
          symbol: 'v',
          unit: 'm/s',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat(model.barVelocity.toFixed(2)),
          min: -10,
          max: 10,
          step: 0.5,
          highlights: `${bench.id}.bar`,
        },
      )
    } else if (isDoubleBar) {
      parameters.push(
        {
          id: 'bar-length',
          label: '导轨间距（棒长）',
          symbol: 'L',
          unit: 'cm',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.barLength * 100).toFixed(1)),
          min: 5,
          step: 5,
          highlights: bench.id,
        },
        {
          id: 'bar-mass-1',
          label: '棒 1 质量',
          symbol: 'm₁',
          unit: 'g',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat(((model.barMasses?.[0] ?? 1) * 1000).toFixed(1)),
          min: 10,
          step: 10,
          highlights: `${bench.id}.bar1`,
        },
        {
          id: 'bar-mass-2',
          label: '棒 2 质量',
          symbol: 'm₂',
          unit: 'g',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat(((model.barMasses?.[1] ?? 1) * 1000).toFixed(1)),
          min: 10,
          step: 10,
          highlights: `${bench.id}.bar2`,
        },
        {
          id: 'bar-velocity-1',
          label: '棒 1 初速度（正负 = 方向）',
          symbol: 'v₁₀',
          unit: 'm/s',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.barVelocities?.[0] ?? 0).toFixed(2)),
          min: -10,
          max: 10,
          step: 0.5,
          highlights: `${bench.id}.bar1`,
        },
        {
          id: 'bar-velocity-2',
          label: '棒 2 初速度（正负 = 方向）',
          symbol: 'v₂₀',
          unit: 'm/s',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.barVelocities?.[1] ?? 0).toFixed(2)),
          min: -10,
          max: 10,
          step: 0.5,
          highlights: `${bench.id}.bar2`,
        },
        {
          id: 'external-force',
          label: '棒 1 恒定外力（0 = 自由双棒）',
          symbol: 'F',
          unit: 'N',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.externalForce ?? 0).toFixed(3)),
          min: 0,
          step: 0.01,
          highlights: `${bench.id}.bar1`,
        },
      )
    } else {
      parameters.push({
        id: 'flux-rate',
        label: '磁通量变化率（正负 = 方向）',
        symbol: 'dΦ/dt',
        unit: 'Wb/s',
        value: model === undefined || model.fluxRate === undefined
          ? Number.NaN
          : Number.parseFloat(model.fluxRate.toFixed(3)),
        min: -0.5,
        max: 0.5,
        step: 0.01,
        highlights: bench.id,
      })
    }
    sections.push({
      id: 'bench',
      title: isBar ? '切割磁感线' : isDoubleBar ? '导轨双棒' : '磁通量变化',
      parameters,
    })

    if (this.computed !== undefined && model !== undefined) {
      /* Derived rows follow the clock: on a time-varying rig the end-of-run
         snapshot in `simulation.derivedQuantities` would print E ≈ 0 while the
         canvas beside it reads E = 0.2 V at t = 0. The frame's own derived set
         is the same engine fact at the instant the student is looking at. */
      const derived: DerivedQuantityView[] = (frameDerived ?? this.computed.simulation.derivedQuantities)
        .filter(entry => isScalarQuantity(entry.value))
        .map(entry => ({
          id: entry.key,
          label: derivedLabelOf(entry.key),
          symbol: '',
          value: isScalarQuantity(entry.value) ? formatDerived(entry.key, entry.value.value) : '—',
          unit: derivedUnitOf(entry.key, entry.value.unit),
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      derived.push({
        id: 'lenz-text',
        label: '感应方向',
        symbol: '',
        /* Direction facts come from the engine: the bar rig quotes its derived
           EMF sign, the coil rig quotes the bench's stated flux rate. */
        value: lenzDirectionText(
          model.subModel === 'bar_motion_emf',
          lenzReadoutOf(this.computed.simulation, model),
        ),
        unit: '',
        highlights: model.benchId,
      })
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const bench = inductionBenchOf(this.sceneRuntime.getScene())
    if (bench === undefined) return this.getSnapshot()

    if (id === 'field-strength') {
      this.command('SetInductionFieldStrength', {
        benchId: bench.id,
        strength: quantity(value, 'T', 'magnetic_flux_density'),
      })
    } else if (id === 'loop-resistance') {
      this.command('SetInductionLoopResistance', {
        benchId: bench.id,
        resistance: quantity(value, 'Ω', 'resistance'),
      })
    } else if (id === 'bar-length') {
      this.command('SetInductionBarLength', {
        benchId: bench.id,
        length: quantity(value, 'cm', 'length'),
      })
    } else if (id === 'bar-velocity') {
      this.command('SetInductionBarVelocity', {
        benchId: bench.id,
        velocity: quantity(value, 'm/s', 'velocity'),
      })
    } else if (id === 'flux-rate') {
      this.command('SetInductionFluxRate', {
        benchId: bench.id,
        fluxRate: quantity(value, 'Wb/s', 'magnetic_flux_rate'),
      })
    } else if (id === 'bar-mass-1') {
      const model = this.computed?.model
      this.command('SetInductionBarMasses', {
        benchId: bench.id,
        masses: [
          quantity(value, 'g', 'mass'),
          quantity(model === undefined || model.barMasses === undefined ? 0.1 : model.barMasses[1], 'kg', 'mass'),
        ],
      })
    } else if (id === 'bar-mass-2') {
      const model = this.computed?.model
      this.command('SetInductionBarMasses', {
        benchId: bench.id,
        masses: [
          quantity(model === undefined || model.barMasses === undefined ? 0.1 : model.barMasses[0], 'kg', 'mass'),
          quantity(value, 'g', 'mass'),
        ],
      })
    } else if (id === 'bar-velocity-1') {
      this.command('SetInductionBarVelocityOne', {
        benchId: bench.id,
        barIndex: 1,
        velocity: quantity(value, 'm/s', 'velocity'),
      })
    } else if (id === 'bar-velocity-2') {
      this.command('SetInductionBarVelocityOne', {
        benchId: bench.id,
        barIndex: 2,
        velocity: quantity(value, 'm/s', 'velocity'),
      })
    } else if (id === 'external-force') {
      this.command('SetInductionExternalForce', {
        benchId: bench.id,
        force: quantity(value, 'N', 'force'),
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
      .observableDefinitions.find(candidate => inductionObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    if (running && this.computed !== undefined) {
      if (this.currentTime >= runDurationOf(this.sceneRuntime.getScene())) this.currentTime = 0
    }
    this.running = running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const total = runDurationOf(this.sceneRuntime.getScene())
    this.currentTime = Number.isFinite(time)
      ? Math.min(total, Math.max(0, time))
      : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const total = runDurationOf(this.sceneRuntime.getScene())
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= total ? total : next
      if (this.currentTime >= total) this.running = false
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

/** Format a derived value into the unit a student reads. */
const formatDerived = (key: string, value: number): string => {
  if (key === 'bar_length') return fmtInductionValue(value * 100, 3)
  if (key === 'magnetic_flux') return fmtInductionValue(value, 3)
  return fmtInductionValue(value, 4)
}

const derivedUnitOf = (key: string, fallback: string): string => {
  if (key === 'bar_length') return 'cm'
  return fallback
}

/** E–t and I–t are flat lines for constant rigs — the chart makes that visible. */
const chartsOf = (
  simulation: SimulationResult,
  model: ResolvedInductionModel,
): readonly {
  id: string
  title: string
  xLabel: string
  yLabel: string
  role: 'trajectory'
  points: readonly { t: number; value: number }[]
}[] => {
  const emfPoints = simulation.states.map((state) => {
    const entry = state.derived.find(candidate => candidate.key === 'induced_emf')
    if (entry === undefined || !isScalarQuantity(entry.value)) return { t: canonicalValue(state.time), value: Number.NaN }
    return { t: canonicalValue(state.time), value: entry.value.value }
  })
  /* The curve's shape depends on the rig, not just the sub-model: a free pair
     decays toward a common velocity (E falls), while a constant pull drives the
     relative velocity UP to the terminal u∞ (E rises to a plateau). Titling the
     driven rig "E 减小" would caption the chart against its own data. */
  const driven = (model.externalForce ?? 0) > 0
  const title =
    model.subModel === 'double_bar_rail'
      ? driven
        ? '感应电动势 E–t（外力驱动：相对速度趋向 u∞ → E 趋于稳定）'
        : '感应电动势 E–t（相对速度指数衰减 → E 减小）'
      : '感应电动势 E–t（匀速切割 / 恒定变化率 → E 恒定）'
  return [{
    id: 'induction-emf',
    title,
    xLabel: 't / s',
    yLabel: 'E / V',
    role: 'trajectory',
    points: emfPoints,
  }]
}

/** One-row reading table: the rig's inputs and the engine's outputs. */
const tableOf = (model: ResolvedInductionModel, simulation: SimulationResult): DataTableView => {
  const scalarOf = (key: string): string => {
    const entry = simulation.derivedQuantities.find(candidate => candidate.key === key)
    if (entry === undefined || !isScalarQuantity(entry.value)) return '—'
    return fmtInductionValue(entry.value.value, 4)
  }
  const isBar = model.subModel === 'bar_motion_emf'
  const isDoubleBar = model.subModel === 'double_bar_rail'
  if (isDoubleBar) {
    return {
      columns: ['B / T', 'L / cm', 'R / Ω', 'm₁ / g', 'm₂ / g', 'v₁₀ / (m/s)', 'v₂₀ / (m/s)', 'E / V', 'I / A'],
      rows: [{
        step: 0,
        values: [
          fmtInductionValue(model.magneticFluxDensity, 3),
          fmtInductionValue(model.barLength * 100, 3),
          fmtInductionValue(model.resistance, 3),
          fmtInductionValue((model.barMasses?.[0] ?? 0) * 1000, 3),
          fmtInductionValue((model.barMasses?.[1] ?? 0) * 1000, 3),
          fmtInductionValue(model.barVelocities?.[0] ?? 0, 3),
          fmtInductionValue(model.barVelocities?.[1] ?? 0, 3),
          scalarOf('induced_emf'),
          scalarOf('induced_current'),
        ],
      }],
    }
  }
  return {
    columns: isBar
      ? ['B / T', 'L / cm', 'v / (m/s)', 'R / Ω', 'E / V', 'I / A']
      : ['B / T', 'S / cm²', 'dΦ/dt / (Wb/s)', 'R / Ω', 'E / V', 'I / A'],
    rows: [{
      step: 0,
      values: isBar
        ? [
          fmtInductionValue(model.magneticFluxDensity, 3),
          fmtInductionValue(model.barLength * 100, 3),
          fmtInductionValue(model.barVelocity, 3),
          fmtInductionValue(model.resistance, 3),
          scalarOf('induced_emf'),
          scalarOf('induced_current'),
        ]
        : [
          fmtInductionValue(model.magneticFluxDensity, 3),
          fmtInductionValue((model.coilArea ?? 0) * 1e4, 3),
          fmtInductionValue(model.fluxRate ?? 0, 3),
          fmtInductionValue(model.resistance, 3),
          scalarOf('induced_emf'),
          scalarOf('induced_current'),
        ],
    }],
  }
}

/**
 * The induction workspace runtime helper `createInductionWorkspaceRuntime`.
 * @returns the induction workspace runtime.
 * @param scene - the physics scene.
 */
export const createInductionWorkspaceRuntime = (scene: PhysicsScene): InductionWorkspaceRuntime =>
  new InductionWorkspaceRuntime(scene)
