/**
 * Mechanical-energy rig → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + EnergyEngine for a pure single-bench energy scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the ramp
 * renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas` as the
 * lever and the projectiles beside it on the shelf. Parameter edits (质量 /
 * 释放高度 / 斜面倾角 / 摩擦系数) go through real scene commands, so a change is
 * an auditable revision bump rather than local component state.
 *
 * The engine supplies the constant-force descent and energy conversion at each
 * physical time; playback ends at the ramp foot and preserves the final ledger.
 */

import {
  EnergyEngine,
  createEnergySimulationRequest,
  energyLedgerOf,
  energyMotionAt,
  resolveEnergyModel,
  type EnergyLedger,
  type ResolvedEnergyModel,
} from '@physicsos/engine-mechanics'
import { isScalarQuantity, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { conditionsFromScene, publicCapturedResult } from '@physicsos/physics-workbench/data'
import { copyJsonObject } from '@physicsos/physics-workbench/json'
import type { AnalysisDataset, CapturedResult } from '@physicsos/physics-workbench/types'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import { energyObservableKeyOf, energyRigText, energySceneVisual } from './energy-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import { runtimeStatusOf } from './verified-result.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<'ledger' | 'conversion', string> = {
  ledger: '能量账本（势能 → 动能 → 热）',
  conversion: '斜面几何与高度',
}

const DERIVED_LABELS: Record<string, string> = {
  cart_mass: '小车质量 m',
  release_height: '释放高度 h',
  incline_angle: '斜面倾角 θ',
  ramp_length: '斜面长度 L',
  friction_coefficient: '摩擦系数 μ',
  potential_energy: '出发时的重力势能 Ep',
  friction_work: '摩擦生的热 Q',
  kinetic_energy: '到底端的动能 Ek',
  speed_at_bottom: '到底端的速度 v',
}

const VERIFICATION_LABELS: Record<string, string> = {
  ledger_sums_to_release_height: '能量守恒：Ep = Ek + Q，账本两边相等',
  speed_from_height: '速度与高度：光滑斜面上 v = √(2gh)，粗糙斜面上更慢',
  friction_work_from_ramp_length: '摩擦做功 W = μmg·cosθ·L = μmg·h·cotθ（斜面越缓越多）',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  energy_bench_dimensions: '实验台量纲正确',
  energy_bench_values: '实验台数值有效（质量 · 高度 · 重力 > 0，0° < θ < 90°，μ ≥ 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

const joulesText = (value: number): string => `${fmtFluidValue(value, 4)} J`

/** The rougher surface the 换一种表面 switch offers; a wooden ramp's μ. */
const ROUGH_COEFFICIENT = 0.2

/** The engine's verified frame for the current revision. */
interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedEnergyModel
  readonly analysis: readonly AnalysisDataset[]
}

/**
 * The energy workspace runtime — see the module doc for its role.
 */
export class EnergyWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new EnergyEngine()
  private commandSequence = 0
  private highlighted: readonly string[] = []
  private failure: string | undefined
  private computed: Computed | undefined
  /** Stated inputs remain editable even when the resulting ledger fails verification. */
  private inputModel: ResolvedEnergyModel | undefined
  /** Raw submitted input/output survive an engine verification failure. */
  private retainedRun: Pick<CapturedResult, 'scene' | 'request' | 'result'> | undefined
  private engineInfo: CapturedResult['engineInfo'] = { id: this.engine.engineId, version: this.engine.engineVersion }
  private rawState: CapturedResult['rawState']
  private currentState: SimulationState | undefined
  private time = 0
  private running = false
  private rate = 1
  /** The scene as the source stated it, kept so an experimental branch can be discarded. */
  private readonly origin: PhysicsScene | undefined

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    this.origin = scene.metadata.sourceQuestionId === undefined ? undefined : scene
    this.recompute()
  }

  private recompute(): void {
    const scene = this.sceneRuntime.peekScene()
    this.retainedRun = { scene }
    this.inputModel = undefined
    this.rawState = undefined
    this.currentState = undefined
    this.engineInfo = {
      id: this.engine.engineId,
      version: this.engine.engineVersion,
      ...(scene.metadata.experimentRelease === undefined ? {} : { release: scene.metadata.experimentRelease }),
    }
    try {
      const support = this.engine.canHandle(scene)
      if (support.modelId !== undefined) this.engineInfo = { ...this.engineInfo, model: support.modelId }
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveEnergyModel(scene)
      this.inputModel = model
      const request = createEnergySimulationRequest(
        scene,
        `energy-lab-${String(scene.id)}-${scene.revision}`,
        `energy-lab-trace-${String(scene.id)}-${scene.revision}`,
      )
      this.retainedRun = { scene, request }
      const simulation = this.engine.simulate(scene, request)
      this.retainedRun = { scene, request, result: simulation }
      this.engineInfo = { ...this.engineInfo, id: simulation.metadata.engineId, version: simulation.metadata.engineVersion }
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const ledger = energyLedgerOf(model)
      this.rawState = copyJsonObject({ model, ledger })
      this.failure = undefined
      this.computed = { simulation, model, analysis: [energyLedgerDatasetOf(scene, simulation, model, ledger)] }
      this.currentState = this.engine.stateAt(scene, quantity(this.time, 's', 'time'))
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '机械能 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    const current = this.sceneRuntime.getScene()
    const prospective = requiresExperimentalFork(current, type)
      ? new SceneRuntime(forkExperimentalScene({ scene: current }))
      : this.sceneRuntime
    const scene = prospective.getScene()
    this.commandSequence += 1
    const result = prospective.execute(
      createSceneCommand<T>({
        commandId: `energy-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `energy-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    this.sceneRuntime = prospective
    if (type !== 'SetObservableEnabled') {
      this.time = 0
      this.running = false
    }
    this.recompute()
  }

  getScene(): PhysicsScene {
    return this.sceneRuntime.getScene()
  }

  captureRaw(): CapturedResult {
    const run: Pick<CapturedResult, 'scene' | 'request' | 'result'> = this.retainedRun ?? { scene: this.sceneRuntime.peekScene() }
    const state = this.currentState
    const end = run.result?.states.at(-1)?.time
    const clock = { time: this.time, total: end === undefined ? 0 : canonicalValue(end),
      running: this.computed !== undefined && this.running, rate: this.rate }
    return publicCapturedResult({
      ...run,
      ...(state === undefined ? {} : { state }),
      ...(this.rawState === undefined ? {} : { rawState: this.rawState }),
      ...(this.computed === undefined ? {} : { analysis: this.computed.analysis }),
      clock,
      cursor: run.request === undefined ? { kind: 'static', identity: `unavailable:${this.engine.engineId}` }
        : { kind: 'time', time: quantity(clock.time, 's', 'time') },
      engineInfo: this.engineInfo,
      metricSemantics: {
        potential_energy: {
          semanticKey: 'gravitational_potential_energy',
          scale: { kind: 'linear' },
          reference: { identity: 'gravitational-potential-at-ramp-bottom', value: quantity(0, 'J', 'energy') },
        },
        friction_work: { semanticKey: 'friction_dissipated_energy', scale: { kind: 'linear' } },
      },
      ...(this.failure === undefined ? {} : { diagnostics: [{ code: 'ENERGY_RUNTIME_DIAGNOSTIC', message: this.failure }] }),
    })
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '机械能实验'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'mechanics',
        title,
        subtitle: scene.metadata.description ?? '真实机械能 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('mechanics'),
        ariaLabel: title,
        tree: this.treeOf(scene),
        inspector: this.inputModel === undefined ? [] : [parametersOf(this.inputModel)],
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: 1 },
        trajectoryTimes: [],
        error: {
          code: 'ENERGY_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Energy Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    this.currentState = this.engine.stateAt(scene, quantity(this.time, 's', 'time'))
    const view = energySceneVisual({ scene, model, time: this.time })
    const status = runtimeStatusOf(simulation.verification)

    return {
      domain: 'mechanics',
      title,
      subtitle: scene.metadata.description ?? '真实机械能 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene),
      inspector: this.inspectorOf(model),
      charts: [
        { id: 'Ep-t', title: '重力势能 Ep(t)', key: 'current_potential_energy', role: 'trajectory' as const },
        { id: 'Ek-t', title: '动能 Ek(t)', key: 'current_kinetic_energy', role: 'velocity' as const },
        { id: 'Q-t', title: '转化的内能 Q(t)', key: 'current_thermal_energy', role: 'force' as const },
      ].map(({ id, title: chartTitle, key, role }) => ({ id, title: chartTitle, xLabel: 't / s', yLabel: 'E / J', role,
        points: simulation.states.map((state) => {
          const value = state.derived.find(entry => entry.key === key)?.value
          return { t: state.time.value, value: value !== undefined && isScalarQuantity(value) ? value.value : 0 }
        }),
      })),
      table: tableOf(model),
      derivation: simulation.derivedQuantities
        .filter(derived => isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? fmtFluidValue(derived.value.value, 5) : '—',
            unit: isScalarQuantity(derived.value) ? derived.value.unit : '',
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      clock: { time: this.time, total: energyMotionAt(model, 0).duration, running: this.running, rate: this.rate },
      trajectoryTimes: simulation.states.map(state => state.time.value),
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

  private treeOf(scene: PhysicsScene): readonly SceneTreeNode[] {
    const benchChildren: SceneTreeNode[] = [
      {
        id: 'energy-bench',
        label: energyRigText(),
        secondary: '斜面与小车',
        icon: 'ground' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = energyObservableKeyOf(definition)
        if (key === undefined) return []
        const subKey = key === 'energy' ? 'ledger' : 'conversion'
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[subKey],
          secondary: definition.visible ? '显示' : '隐藏',
          icon: 'observable' as const,
          kind: 'observable' as const,
          visible: definition.visible,
          observable: key,
        }]
      },
    )
    return [
      { id: 'rig', label: '机械能实验台', icon: 'folder', kind: 'group', children: benchChildren },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: observableChildren,
      },
    ]
  }

  private inspectorOf(model: ResolvedEnergyModel | undefined): readonly InspectorSection[] {
    if (model === undefined) return []
    return [parametersOf(model), derivedSectionOf(this.computed, model)]
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const model = this.inputModel
    if (model !== undefined) {
      for (const [parameterId, dispatch] of PARAMETER_COMMANDS) {
        if (parameterId !== id) continue
        const command = dispatch(model, value)
        if (command !== undefined) this.command(command.type, command.payload)
        break
      }
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    const model = this.inputModel
    if (model === undefined) return this.getSnapshot()
    /* The two surfaces are one tap apart because the whole experiment is the
       difference between them. */
    if (id === 'ramp-surface') {
      const coefficient = value === 'rough' ? ROUGH_COEFFICIENT : 0
      if (Math.abs(coefficient - model.frictionCoefficient) > 1e-9) {
        this.command('SetRampFriction', {
          benchId: model.benchId,
          coefficient: quantity(coefficient, '', 'dimensionless'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => energyObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    const total = this.getSnapshot().clock.total
    if (running && total > 0 && this.time >= total) this.time = 0
    this.running = running && total > 0
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    if (Number.isFinite(time)) this.time = Math.max(0, Math.min(this.getSnapshot().clock.total, time))
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.time + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    if (this.running && Number.isFinite(wallClockSeconds) && wallClockSeconds > 0) {
      const total = this.getSnapshot().clock.total
      this.time = Math.min(total, this.time + wallClockSeconds * this.rate)
      if (this.time >= total) this.running = false
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
    this.time = 0
    this.running = false
    this.recompute()
    return this.getSnapshot()
  }
}

/** Native ledger facts have one static identity; they are not a cart trajectory. */
const energyLedgerDatasetOf = (
  scene: PhysicsScene,
  simulation: SimulationResult,
  model: ResolvedEnergyModel,
  ledger: EnergyLedger,
): AnalysisDataset => {
  const readings = [
    ['mass', ledger.mass, 'cart_mass', 'mass', 'kg'],
    ['gravity', ledger.gravity, 'gravity_acceleration_magnitude', 'acceleration', 'm/s^2'],
    ['releaseHeight', ledger.releaseHeight, 'release_height', 'length', 'm'],
    ['inclineAngle', ledger.inclineAngle, 'incline_angle', 'angle', 'rad'],
    ['frictionCoefficient', ledger.frictionCoefficient, 'friction_coefficient', 'dimensionless', ''],
    ['rampLength', ledger.rampLength, 'ramp_length', 'length', 'm'],
    ['potentialAtRelease', ledger.potentialAtRelease, 'gravitational_potential_energy', 'energy', 'J'],
    ['frictionWork', ledger.frictionWork, 'friction_dissipated_energy', 'energy', 'J'],
    ['kineticAtBottom', ledger.kineticAtBottom, 'kinetic_energy', 'energy', 'J'],
    ['speedAtBottom', ledger.speedAtBottom, 'speed_at_bottom', 'velocity', 'm/s'],
    ['idealSpeed', ledger.idealSpeed, 'frictionless_speed_at_bottom', 'velocity', 'm/s'],
    ['energyAccounted', ledger.energyAccounted, 'energy_accounted', 'energy', 'J'],
  ] as const
  return {
    schemaVersion: 1,
    kind: 'dataset',
    id: `${String(simulation.simulationId)}:energy-ledger`,
    axes: [{
      id: 'static',
      kind: 'static',
      identity: 'mechanical-energy-ledger',
      dimension: 'dimensionless',
      unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: 'mechanical-energy-ledger' },
    }],
    metrics: readings.map(([id, , semanticKey, dimension, unit]): AnalysisDataset['metrics'][number] => ({
      id,
      semanticKey,
      targetId: model.benchId,
      component: 'scalar',
      dimension,
      unit,
      scale: { kind: 'linear' },
      ...(id === 'potentialAtRelease'
        ? { reference: { identity: 'gravitational-potential-at-ramp-bottom', value: quantity(0, 'J', 'energy') } }
        : {}),
    })),
    rows: [{
      rowId: 'ledger',
      axes: { static: 0 },
      values: Object.fromEntries(readings.map(([id, value]) => [id, value])),
      evidence: { scope: 'resolved-engine-energy-ledger' },
    }],
    conditions: conditionsFromScene(scene),
    origin: {
      sceneId: String(scene.id),
      sceneRevision: scene.revision,
      simulationId: String(simulation.simulationId),
      collection: 'analysis',
      analysisId: 'energy-ledger',
    },
  }
}

/* -------------------------------------------------------------- inspector -- */

const parametersOf = (model: ResolvedEnergyModel): InspectorSection => {
  return {
    id: 'energy-parameters',
    title: '斜面与小车',
    parameters: [
      {
        id: 'cart-mass',
        label: '小车质量',
        symbol: 'm',
        unit: 'kg',
        value: model.mass,
        min: 0.1,
        max: 20,
        step: 0.1,
      },
      {
        id: 'release-height',
        label: '释放高度',
        symbol: 'h',
        unit: 'cm',
        value: model.releaseHeight * 100,
        min: 5,
        max: 300,
        step: 5,
      },
      {
        id: 'ramp-angle',
        label: '斜面倾角',
        symbol: 'θ',
        unit: '°',
        value: (model.inclineAngle * 180) / Math.PI,
        min: 5,
        max: 85,
        step: 5,
      },
      {
        id: 'ramp-friction',
        label: '摩擦系数',
        symbol: 'μ',
        unit: '',
        value: model.frictionCoefficient,
        min: 0,
        max: 0.8,
        step: 0.05,
      },
    ],
    choices: [
      {
        id: 'ramp-surface',
        label: '斜面表面',
        value: model.frictionCoefficient === 0 ? 'smooth' : 'rough',
        options: [
          { value: 'smooth', label: '光滑（μ = 0，机械能守恒）' },
          { value: 'rough', label: '粗糙（μ = 0.2）' },
        ],
      },
    ],
  }
}

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedEnergyModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'cart-mass',
    (model, value) => ({
      type: 'SetEnergyMass',
      payload: { benchId: model.benchId, mass: quantity(value, 'kg', 'mass') },
    }),
  ],
  [
    'release-height',
    (model, value) => ({
      type: 'SetReleaseHeight',
      payload: { benchId: model.benchId, height: quantity(value, 'cm', 'length') },
    }),
  ],
  [
    'ramp-angle',
    (model, value) => ({
      type: 'SetRampAngle',
      payload: { benchId: model.benchId, angle: quantity(value, 'deg', 'angle') },
    }),
  ],
  [
    'ramp-friction',
    (model, value) => ({
      type: 'SetRampFriction',
      payload: { benchId: model.benchId, coefficient: quantity(value, '', 'dimensionless') },
    }),
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedEnergyModel,
): InspectorSection => {
  const ledger = energyLedgerOf(model)
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value: `Ep = ${joulesText(ledger.potentialAtRelease)} → Ek = ${joulesText(ledger.kineticAtBottom)} · v = ${fmtFluidValue(ledger.speedAtBottom, 4)} m/s`,
      unit: '',
    },
  ]
  const derived = (computed?.simulation.derivedQuantities ?? [])
    .filter(entry => isScalarQuantity(entry.value))
    .map(entry => ({
      id: entry.key,
      label: derivedLabelOf(entry.key),
      symbol: '',
      value: isScalarQuantity(entry.value) ? fmtFluidValue(entry.value.value, 5) : '—',
      unit: isScalarQuantity(entry.value) ? entry.value.unit : '',
    }))
  return { id: 'energy-derived', title: '读数', derived: [...readings, ...derived] }
}

/**
 * The ledger as a table: one row per station of the trip, with the same three
 * columns the bar draws. The 出发 row is all potential and the 到底端 row is the
 * split that came out of it — and the TOTAL column is what has to stay put.
 */
const tableOf = (model: ResolvedEnergyModel): DataTableView => {
  const ledger = energyLedgerOf(model)
  const number = (value: number) => fmtFluidValue(value, 4)
  return {
    columns: ['位置', 'Ep / J', 'Ek / J', 'Q / J', '合计 / J'],
    rows: [
      {
        step: 0,
        values: [
          '出发（斜面顶端）',
          number(ledger.potentialAtRelease),
          '0',
          '0',
          number(ledger.potentialAtRelease),
        ],
      },
      {
        step: 1,
        values: [
          '到底端',
          '0',
          number(ledger.kineticAtBottom),
          number(ledger.frictionWork),
          number(ledger.energyAccounted),
        ],
      },
      {
        step: 2,
        values: ['到底端速度 v / (m/s)', '—', '—', '—', number(ledger.speedAtBottom)],
      },
    ],
  }
}

/**
 * The energy workspace runtime helper `createEnergyWorkspaceRuntime`.
 * @returns the workspace runtime.
 * @param scene - the physics scene.
 */
export const createEnergyWorkspaceRuntime = (scene: PhysicsScene): EnergyWorkspaceRuntime =>
  new EnergyWorkspaceRuntime(scene)
