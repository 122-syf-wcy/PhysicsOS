/**
 * Wave → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + WaveEngine for a pure single-bench wave scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the wave
 * domain renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas`
 * as every other domain. Parameter edits (A / f / v / Δ / L / n) go through real
 * scene commands, so a change is an auditable revision bump rather than local
 * component state.
 *
 * The physics is closed-form and the clock IS the lesson: the rope profile
 * advances one wavelength per period while the marked particle stays put, the
 * interference crests spread and meet at P, the standing string swings between
 * its envelopes. Every frame is the engine's `stateAt(t)` — the runtime never
 * evaluates y(x, t) itself.
 */

import {
  WaveEngine,
  createWaveSimulationRequest,
  resolveWaveModel,
  type ResolvedWaveModel,
} from '@physicsos/engine-wave'
import { isScalarQuantity, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  waveBenchOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
  type WaveBench,
} from '@physicsos/physics-scene'

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
  QuantityParameter,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import {
  fmtWaveValue,
  interferenceVerdictText,
  waveObservableKeyOf,
  waveSceneVisual,
} from './wave-visual-bridge.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<string, string> = {
  waveform: '波形',
  waveSpeed: '波速读数 v = λf',
  superposition: '叠加判定',
  nodes: '波节与波腹',
}

const DERIVED_LABELS: Record<string, string> = {
  wave_speed: '波速 v',
  period: '周期 T',
  wavelength: '波长 λ',
  frequency: '频率 f',
  amplitude: '振幅 A',
  rope_length: '绳长 ℓ',
  path_difference: '路程差 Δ',
  path_difference_ratio: '路程差 / 波长 Δ/λ',
  resultant_amplitude: '合振幅 A_P',
  interference_type: '叠加判定（+1 加强 / −1 减弱 / 0 部分）',
  source_separation: '波源间距 d',
  string_length: '弦长 L',
  harmonic: '谐波次数 n',
  fundamental_frequency: '基频 f₁',
  node_count: '波节数',
  antinode_count: '波腹数',
}

const VERIFICATION_LABELS: Record<string, string> = {
  wave_speed_relation: '波速关系 v = λf',
  period_frequency_reciprocal: '周期与频率互为倒数 T = 1/f',
  profile_translation: '波形以波速整体平移',
  particle_no_net_transport: '质点只振动、不随波迁移',
  interference_geometry: '路程差几何可达 |r₂ − r₁| ≤ d',
  path_difference_rule: '路程差规则：nλ 加强、(n+½)λ 减弱',
  superposition_bounds: '叠加位移不超过合振幅',
  harmonic_relation: '驻波条件 L = nλ/2',
  frequency_harmonic: '谐波频率 f_n = n·f₁',
  boundary_nodes: '固定端始终为波节',
  node_positions_fixed: '波节位移恒为零',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  wave_bench_dimensions: '实验台量纲正确',
  wave_bench_values: '振幅、频率、长度为正，谐波次数为正整数',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Metre-valued displacements read in centimetres; everything else as published. */
const CENTIMETRE_KEYS: ReadonlySet<string> = new Set(['amplitude', 'resultant_amplitude'])

const formatDerived = (key: string, value: number): string =>
  CENTIMETRE_KEYS.has(key) ? fmtWaveValue(value * 100, 4) : fmtWaveValue(value, 4)

const derivedUnitOf = (key: string, fallback: string): string =>
  CENTIMETRE_KEYS.has(key) ? 'cm' : fallback

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedWaveModel
  /** Engine state at t = 0; the standing-wave envelope and a stable table row. */
  readonly initialState: SimulationState
  readonly runSeconds: number
}

export class WaveWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new WaveEngine()
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
        createWaveSimulationRequest(
          scene,
          `wave-lab-${String(scene.id)}-${scene.revision}`,
          `wave-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveWaveModel(scene)
      const runSeconds =
        scene.timeline.endTime === undefined ? 1 : Math.max(0.1, canonicalValue(scene.timeline.endTime))
      this.currentTime = Math.min(this.currentTime, runSeconds)
      this.failure = undefined
      this.computed = {
        simulation,
        model,
        initialState: this.engine.stateAt(scene, quantity(0, 's', 'time')),
        runSeconds,
      }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '波动 Runtime 无法启动。'
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
        commandId: `wave-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `wave-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    this.recompute()
  }

  private get runSeconds(): number {
    return this.computed?.runSeconds ?? 1
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '机械波实验'
    const badge = branchBadgeOf(scene)
    const bench = waveBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'wave',
        title,
        subtitle: scene.metadata.description ?? '真实机械波 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('wave'),
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
          code: 'WAVE_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Wave Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model, initialState } = this.computed
    const state = this.engine.stateAt(scene, quantity(this.currentTime, 's', 'time'))
    const view = waveSceneVisual({
      scene,
      model,
      simulation,
      state,
      envelopeState: initialState,
      time: this.currentTime,
    })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'wave',
      title,
      subtitle: scene.metadata.description ?? '真实机械波 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, bench),
      inspector: this.inspectorOf(bench, model),
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
            unit: derivedUnitOf(derived.key, isScalarQuantity(derived.value) ? derived.value.unit : ''),
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      clock: {
        time: this.currentTime,
        total: this.runSeconds,
        running: this.running,
        rate: this.rate,
      },
      trajectoryTimes: simulation.states.map(entry => canonicalValue(entry.time)),
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

  private treeOf(scene: PhysicsScene, bench: WaveBench): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const rigLabel =
      bench.type === 'travelling' ? '绳与波源' : bench.type === 'interference' ? '两个相干波源' : '两端固定的弦'
    const benchChildren: SceneTreeNode[] = [
      {
        id: bench.id,
        label: rigLabel,
        secondary:
          model === undefined
            ? ''
            : `A = ${fmtWaveValue(model.amplitude * 100)} cm · λ = ${fmtWaveValue(model.wavelength)} m · f = ${fmtWaveValue(model.frequency)} Hz`,
        icon: 'body' as const,
        kind: 'object' as const,
      },
    ]
    if (bench.type === 'travelling') {
      benchChildren.push({
        id: `${bench.id}.marker`,
        label: '标记质点',
        secondary: '只在平衡位置附近横向振动',
        icon: 'particle' as const,
        kind: 'object' as const,
      })
    }
    if (bench.type === 'interference') {
      benchChildren.push(
        { id: `${bench.id}.source-1`, label: '波源 S₁', icon: 'particle' as const, kind: 'object' as const },
        { id: `${bench.id}.source-2`, label: '波源 S₂', icon: 'particle' as const, kind: 'object' as const },
        {
          id: `${bench.id}.point`,
          label: '观察点 P',
          secondary:
            model === undefined
              ? ''
              : `r₁ = ${fmtWaveValue(model.pathOne ?? 0)} m · r₂ = ${fmtWaveValue(model.pathTwo ?? 0)} m`,
          icon: 'keyPoint' as const,
          kind: 'object' as const,
        },
      )
    }
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap((definition) => {
      const key = waveObservableKeyOf(definition)
      if (key === undefined) return []
      return [{
        id: String(definition.id),
        label: OBSERVABLE_LABELS[key] ?? key,
        icon: 'observable' as const,
        kind: 'observable' as const,
        observable: key,
      }]
    })
    const groupLabel =
      bench.type === 'travelling' ? '绳波装置' : bench.type === 'interference' ? '双源干涉装置' : '弦驻波装置'
    return [
      { id: 'bench', label: groupLabel, icon: 'folder', kind: 'group', children: benchChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(bench: WaveBench, model: ResolvedWaveModel | undefined): readonly InspectorSection[] {
    const sections: InspectorSection[] = []
    const rounded = (value: number | undefined, digits: number): number =>
      value === undefined ? Number.NaN : Number.parseFloat(value.toFixed(digits))

    const parameters: QuantityParameter[] = [
      {
        id: 'amplitude',
        label: '振幅',
        symbol: 'A',
        unit: 'cm',
        value: rounded(model === undefined ? undefined : model.amplitude * 100, 1),
        min: 0.5,
        max: 20,
        step: 0.5,
        highlights: bench.id,
      },
    ]

    if (bench.type !== 'standing') {
      /* The source sets f, the medium sets v; λ = v/f follows in the derived rows. */
      parameters.push({
        id: 'frequency',
        label: '波源频率',
        symbol: 'f',
        unit: 'Hz',
        value: rounded(model?.frequency, 2),
        min: 0.5,
        max: 50,
        step: 0.5,
        highlights: bench.id,
      })
    }
    parameters.push({
      id: 'wave-speed',
      label: bench.type === 'standing' ? '弦上波速（由介质决定）' : '波速（由介质决定）',
      symbol: 'v',
      unit: 'm/s',
      value: rounded(model?.waveSpeed, 2),
      min: 0.5,
      max: 200,
      step: 0.5,
      highlights: bench.id,
    })
    if (bench.type === 'interference') {
      parameters.push({
        id: 'path-difference',
        label: '路程差（移动观察点）',
        symbol: 'Δ',
        unit: 'm',
        value: rounded(
          model === undefined ? undefined : Math.abs((model.pathTwo ?? 0) - (model.pathOne ?? 0)),
          3,
        ),
        min: 0,
        max: model?.sourceSeparation ?? 1,
        step: 0.05,
        highlights: `${bench.id}.point`,
      })
    }
    if (bench.type === 'standing') {
      parameters.push(
        {
          id: 'string-length',
          label: '弦长',
          symbol: 'L',
          unit: 'm',
          value: rounded(model?.stringLength, 2),
          min: 0.2,
          max: 5,
          step: 0.1,
          highlights: bench.id,
        },
        {
          id: 'harmonic',
          label: '谐波次数',
          symbol: 'n',
          unit: '',
          value: rounded(model?.harmonic, 0),
          min: 1,
          max: 8,
          step: 1,
          highlights: bench.id,
        },
      )
    }
    const sectionTitle =
      bench.type === 'travelling' ? '绳波' : bench.type === 'interference' ? '双源干涉' : '弦驻波'
    sections.push({ id: 'bench', title: sectionTitle, parameters })

    if (this.computed !== undefined && model !== undefined) {
      const derived: DerivedQuantityView[] = this.computed.simulation.derivedQuantities
        .filter(entry => isScalarQuantity(entry.value))
        .map(entry => ({
          id: entry.key,
          label: derivedLabelOf(entry.key),
          symbol: '',
          value: isScalarQuantity(entry.value) ? formatDerived(entry.key, entry.value.value) : '—',
          unit: derivedUnitOf(entry.key, isScalarQuantity(entry.value) ? entry.value.unit : ''),
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      if (model.subModel === 'wave_interference') {
        const sign = this.computed.simulation.derivedQuantities.find(entry => entry.key === 'interference_type')
        const verdict =
          sign !== undefined && isScalarQuantity(sign.value)
            ? sign.value.value > 0 ? 'constructive' : sign.value.value < 0 ? 'destructive' : 'partial'
            : 'partial'
        derived.push({
          id: 'verdict-text',
          label: 'P 点振动',
          symbol: '',
          value: interferenceVerdictText(verdict),
          unit: '',
          highlights: `${model.benchId}.point`,
        })
      }
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const bench = waveBenchOf(this.sceneRuntime.getScene())
    if (bench === undefined) return this.getSnapshot()

    if (id === 'amplitude') {
      this.command('SetWaveAmplitude', { benchId: bench.id, amplitude: quantity(value, 'cm', 'length') })
    } else if (id === 'frequency') {
      this.command('SetWaveFrequency', { benchId: bench.id, frequency: quantity(value, 'Hz', 'frequency') })
    } else if (id === 'wave-speed') {
      this.command('SetWaveSpeed', { benchId: bench.id, speed: quantity(value, 'm/s', 'velocity') })
    } else if (id === 'path-difference') {
      this.command('SetWavePathDifference', {
        benchId: bench.id,
        pathDifference: quantity(value, 'm', 'length'),
      })
    } else if (id === 'string-length') {
      this.command('SetWaveStringLength', { benchId: bench.id, stringLength: quantity(value, 'm', 'length') })
    } else if (id === 'harmonic') {
      this.command('SetWaveHarmonic', { benchId: bench.id, harmonic: Math.round(value) })
    }
    return this.getSnapshot()
  }

  setChoice(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => waveObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    if (running && this.computed !== undefined) {
      if (this.currentTime >= this.runSeconds) this.currentTime = 0
    }
    this.running = running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    this.currentTime = Number.isFinite(time) ? Math.min(this.runSeconds, Math.max(0, time)) : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= this.runSeconds ? this.runSeconds : next
      if (this.currentTime >= this.runSeconds) this.running = false
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

/** y–t of the one point each rig is about: the marked particle, P, or the first antinode. */
const chartsOf = (simulation: SimulationResult, model: ResolvedWaveModel): readonly ChartSeries[] => {
  const targetId =
    model.subModel === 'travelling_wave'
      ? `${model.benchId}.marker`
      : model.subModel === 'wave_interference'
        ? `${model.benchId}.point`
        : `${model.benchId}.antinode.0`
  const title =
    model.subModel === 'travelling_wave'
      ? '标记质点位移 y–t（简谐振动，不随波迁移）'
      : model.subModel === 'wave_interference'
        ? '观察点 P 的位移 y_P–t（两波叠加）'
        : '波腹位移 y–t（弦在两条包络线之间摆动）'
  const points = simulation.states.map((state) => {
    const object = state.objects.find(entry => entry.id === targetId)
    const t = canonicalValue(state.time)
    if (object === undefined) return { t, value: Number.NaN }
    if (model.subModel === 'wave_interference') {
      const displacement = object.values?.['displacement']
      return displacement !== undefined && isScalarQuantity(displacement)
        ? { t, value: displacement.value * 100 }
        : { t, value: Number.NaN }
    }
    return { t, value: (object.position?.vector.y ?? Number.NaN) * 100 }
  })
  return [{ id: 'wave-displacement', title, xLabel: 't / s', yLabel: 'y / cm', role: 'trajectory', points }]
}

/** One-row reading table: the rig's inputs and the engine's outputs. */
const tableOf = (model: ResolvedWaveModel, simulation: SimulationResult): DataTableView => {
  const scalarOf = (key: string, factor = 1): string => {
    const entry = simulation.derivedQuantities.find(candidate => candidate.key === key)
    if (entry === undefined || !isScalarQuantity(entry.value)) return '—'
    return fmtWaveValue(entry.value.value * factor, 4)
  }
  if (model.subModel === 'travelling_wave') {
    return {
      columns: ['A / cm', 'λ / m', 'f / Hz', 'v / (m/s)', 'T / s'],
      rows: [{
        step: 0,
        values: [scalarOf('amplitude', 100), scalarOf('wavelength'), scalarOf('frequency'), scalarOf('wave_speed'), scalarOf('period')],
      }],
    }
  }
  if (model.subModel === 'wave_interference') {
    const sign = simulation.derivedQuantities.find(entry => entry.key === 'interference_type')
    const verdict =
      sign !== undefined && isScalarQuantity(sign.value)
        ? interferenceVerdictText(sign.value.value > 0 ? 'constructive' : sign.value.value < 0 ? 'destructive' : 'partial')
        : '—'
    return {
      columns: ['A / cm', 'λ / m', 'd / m', 'Δ / m', 'Δ/λ', 'A_P / cm', 'P 点'],
      rows: [{
        step: 0,
        values: [
          scalarOf('amplitude', 100),
          scalarOf('wavelength'),
          scalarOf('source_separation'),
          scalarOf('path_difference'),
          scalarOf('path_difference_ratio'),
          scalarOf('resultant_amplitude', 100),
          verdict,
        ],
      }],
    }
  }
  return {
    columns: ['A / cm', 'L / m', 'n', 'v / (m/s)', 'λ / m', 'f_n / Hz', 'f₁ / Hz'],
    rows: [{
      step: 0,
      values: [
        scalarOf('amplitude', 100),
        scalarOf('string_length'),
        scalarOf('harmonic'),
        scalarOf('wave_speed'),
        scalarOf('wavelength'),
        scalarOf('frequency'),
        scalarOf('fundamental_frequency'),
      ],
    }],
  }
}

export const createWaveWorkspaceRuntime = (scene: PhysicsScene): WaveWorkspaceRuntime =>
  new WaveWorkspaceRuntime(scene)
