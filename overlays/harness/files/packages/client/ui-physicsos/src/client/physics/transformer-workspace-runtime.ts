/**
 * Transformer rig → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + TransformerEngine for a pure transformer scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape. Parameter edits
 * (电压 / 电流 / 两个匝数) go through real scene commands, so a change is an
 * auditable revision bump rather than local component state.
 *
 * There is NO timeline: the ratios hold at every instant of the AC cycle, so the
 * clock says `total: 0` and the transport stays disabled.
 */

import {
  TransformerEngine,
  createTransformerSimulationRequest,
  resolveTransformerModel,
  transformerReadingOf,
  type ResolvedTransformerModel,
} from '@physicsos/engine-induction'
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

import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import {
  transformerObservableKeyOf,
  transformerRigText,
  transformerSceneVisual,
} from './transformer-visual-bridge.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<'voltage' | 'current', string> = {
  voltage: '两侧的电压与匝数',
  current: '两侧的电流',
}

const DERIVED_LABELS: Record<string, string> = {
  primary_voltage: '一次电压 U₁',
  turns_ratio: '匝数比 N₁/N₂',
  flux_rate: '磁通变化率 dΦ/dt',
  secondary_voltage: '二次电压 U₂',
  secondary_current: '二次电流 I₂',
  primary_power: '一次功率 P₁',
  secondary_power: '二次功率 P₂',
}

const VERIFICATION_LABELS: Record<string, string> = {
  both_windings_share_one_flux: '同一个磁通：两侧算出的 dΦ/dt 相同',
  power_passes_through_unchanged: '理想变压器不改变功率：U₁I₁ = U₂I₂',
  output_scales_with_the_turns_ratio: '匝比就是这台机器：匝数加倍则电压加倍、电流减半',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  transformer_bench_dimensions: '实验台量纲正确',
  transformer_bench_values: '实验台数值有效（电压 · 匝数 > 0，电流 ≥ 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedTransformerModel
}

/**
 * The transformer workspace runtime — see the module doc for its role.
 */
export class TransformerWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new TransformerEngine()
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
        createTransformerSimulationRequest(
          scene,
          `transformer-lab-${String(scene.id)}-${scene.revision}`,
          `transformer-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveTransformerModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '变压器 Runtime 无法启动。'
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
        commandId: `transformer-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `transformer-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '变压器'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'induction',
        title,
        subtitle: scene.metadata.description ?? '真实变压器 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('induction'),
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
          code: 'TRANSFORMER_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Transformer Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const view = transformerSceneVisual({ scene, model })
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'induction',
      title,
      subtitle: scene.metadata.description ?? '真实变压器 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene),
      inspector: this.inspectorOf(model),
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
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = transformerObservableKeyOf(definition)
        if (key === undefined) return []
        const subKey = key === 'voltage' ? 'voltage' : 'current'
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
      {
        id: 'rig',
        label: transformerRigText(),
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: 'transformer-bench',
            label: '铁芯与两个绕组',
            secondary: '理想变压器',
            icon: 'ground' as const,
            kind: 'object' as const,
          },
        ],
      },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(model: ResolvedTransformerModel | undefined): readonly InspectorSection[] {
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
    /* 升压 / 降压 in one tap: the two windings swap which one is bigger, and the
       output follows the ratio rather than the absolute counts. */
    if (id === 'transformer-kind') {
      const wanted = value === 'step-up' ? 5 * model.primaryTurns : model.primaryTurns
      if (Math.abs(wanted - model.secondaryTurns) > 1e-9) {
        this.command('SetSecondaryTurns', {
          benchId: model.benchId,
          turns: quantity(wanted, '', 'dimensionless'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => transformerObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The ratios hold at every instant of the cycle: there is no clock to start,
     stop or scrub. */
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

  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin === undefined) return this.getSnapshot()
    this.sceneRuntime = new SceneRuntime(this.origin)
    this.highlighted = []
    this.recompute()
    return this.getSnapshot()
  }
}

/* -------------------------------------------------------------- inspector -- */

const parametersOf = (model: ResolvedTransformerModel): InspectorSection => {
  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )
  return {
    id: 'transformer-parameters',
    title: '铁芯与两个绕组',
    parameters: [
      {
        id: 'transformer-voltage',
        label: '一次电压',
        symbol: 'U₁',
        unit: 'V',
        value: reading.primaryVoltage,
        min: 1,
        max: 1000,
        step: 10,
      },
      {
        id: 'transformer-current',
        label: '一次电流',
        symbol: 'I₁',
        unit: 'A',
        value: reading.primaryCurrent,
        min: 0,
        max: 10,
        step: 0.05,
      },
      {
        id: 'primary-turns',
        label: '一次匝数',
        symbol: 'N₁',
        unit: '匝',
        value: reading.primaryTurns,
        min: 50,
        max: 5000,
        step: 50,
      },
      {
        id: 'secondary-turns',
        label: '二次匝数',
        symbol: 'N₂',
        unit: '匝',
        value: reading.secondaryTurns,
        min: 50,
        max: 5000,
        step: 50,
      },
    ],
    choices: [
      {
        id: 'transformer-kind',
        label: '变压器类型',
        value: reading.stepsUp ? 'step-up' : 'step-down',
        options: [
          { value: 'step-down', label: '降压（N₂ < N₁）' },
          { value: 'step-up', label: '升压（N₂ > N₁）' },
        ],
      },
    ],
  }
}

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedTransformerModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'transformer-voltage',
    (model, value) => ({
      type: 'SetTransformerVoltage',
      payload: { benchId: model.benchId, voltage: quantity(value, 'V', 'electric_potential') },
    }),
  ],
  [
    'transformer-current',
    (model, value) => ({
      type: 'SetTransformerCurrent',
      payload: { benchId: model.benchId, current: quantity(value, 'A', 'electric_current') },
    }),
  ],
  [
    'primary-turns',
    (model, value) => ({
      type: 'SetPrimaryTurns',
      payload: { benchId: model.benchId, turns: quantity(value, '', 'dimensionless') },
    }),
  ],
  [
    'secondary-turns',
    (model, value) => ({
      type: 'SetSecondaryTurns',
      payload: { benchId: model.benchId, turns: quantity(value, '', 'dimensionless') },
    }),
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedTransformerModel,
): InspectorSection => {
  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value: `${fmtFluidValue(reading.primaryVoltage, 4)} V → ${fmtFluidValue(reading.secondaryVoltage, 4)} V（${reading.stepsUp ? '升压' : '降压'}）`,
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
  return { id: 'transformer-derived', title: '读数', derived: [...readings, ...derived] }
}

const tableOf = (model: ResolvedTransformerModel): DataTableView => {
  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )
  const number = (value: number) => fmtFluidValue(value, 4)
  return {
    columns: ['绕组', '匝数', '电压 / V', '电流 / A', '功率 / W'],
    rows: [
      {
        step: 0,
        values: ['一次', number(reading.primaryTurns), number(reading.primaryVoltage), number(reading.primaryCurrent), number(reading.primaryPower)],
      },
      {
        step: 1,
        values: ['二次', number(reading.secondaryTurns), number(reading.secondaryVoltage), number(reading.secondaryCurrent), number(reading.secondaryPower)],
      },
    ],
  }
}

/**
 * The transformer workspace runtime helper `createTransformerWorkspaceRuntime`.
 * @returns the workspace runtime.
 * @param scene - the physics scene.
 */
export const createTransformerWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new TransformerWorkspaceRuntime(scene)
