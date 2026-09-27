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
 * There is NO timeline here, and the clock says so: `total: 0`. The cart really
 * does move, but the ledger is a function of WHERE it is rather than of when, so
 * the rig reports the accounting at the two ends of the trip instead of
 * integrating a trajectory the engines beside it would each have to repeat.
 */

import {
  EnergyEngine,
  createEnergySimulationRequest,
  energyLedgerOf,
  resolveEnergyModel,
  type ResolvedEnergyModel,
} from '@physicsos/engine-mechanics'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
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
        createEnergySimulationRequest(
          scene,
          `energy-lab-${String(scene.id)}-${scene.revision}`,
          `energy-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveEnergyModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '机械能 Runtime 无法启动。'
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
    this.recompute()
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
        inspector: this.inspectorOf(undefined),
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
    const view = energySceneVisual({ scene, model })
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
      /* No chart: the ledger is an accounting, not a curve against time. */
      charts: [],
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
      clock: { time: 0, total: 0, running: false, rate: 1 },
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
    const model = this.computed?.model
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
    const model = this.computed?.model
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

  /* The ledger is a function of the geometry, not of the clock: there is nothing
     to start, stop or scrub. Each method returns the frame the shell already
     has, and the shell's own transport is disabled by `clock.total <= 0`. */
  setRunning(running: boolean): WorkspaceSnapshot {
    void running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    void rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    void time
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    void delta
    return this.getSnapshot()
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    void wallClockSeconds
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
    this.recompute()
    return this.getSnapshot()
  }
}

/* -------------------------------------------------------------- inspector -- */

const parametersOf = (model: ResolvedEnergyModel): InspectorSection => {
  const ledger = energyLedgerOf(model)
  return {
    id: 'energy-parameters',
    title: '斜面与小车',
    parameters: [
      {
        id: 'cart-mass',
        label: '小车质量',
        symbol: 'm',
        unit: 'kg',
        value: ledger.mass,
        min: 0.1,
        max: 20,
        step: 0.1,
      },
      {
        id: 'release-height',
        label: '释放高度',
        symbol: 'h',
        unit: 'cm',
        value: ledger.releaseHeight * 100,
        min: 5,
        max: 300,
        step: 5,
      },
      {
        id: 'ramp-angle',
        label: '斜面倾角',
        symbol: 'θ',
        unit: '°',
        value: (ledger.inclineAngle * 180) / Math.PI,
        min: 5,
        max: 85,
        step: 5,
      },
      {
        id: 'ramp-friction',
        label: '摩擦系数',
        symbol: 'μ',
        unit: '',
        value: ledger.frictionCoefficient,
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
export const createEnergyWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new EnergyWorkspaceRuntime(scene)
