/**
 * Thermometer rig → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + ThermometerEngine for a pure thermometer scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape. Parameter edits
 * (泡的体积 / 细管直径 / 测温液体 / 所测温度) go through real scene commands, so a
 * change is an auditable revision bump rather than local component state.
 *
 * There is NO timeline: the column stands where the temperature puts it, so the
 * clock says `total: 0` and the transport stays disabled.
 */

import {
  ThermometerEngine,
  createThermometerSimulationRequest,
  resolveThermometerModel,
  thermometerReadingOf,
  type ResolvedThermometerModel,
} from '@physicsos/engine-thermal'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { CELSIUS_ZERO_IN_KELVIN } from '@physicsos/physics-scene'
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
  thermometerObservableKeyOf,
  thermometerRigText,
  thermometerSceneVisual,
} from './thermometer-visual-bridge.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<'scale' | 'column', string> = {
  scale: '玻璃上的刻度与两个固定点',
  column: '液柱高度',
}

const DERIVED_LABELS: Record<string, string> = {
  bulb_volume: '玻璃泡体积 V₀',
  bore_area: '细管截面积 A',
  expansion_coefficient: '膨胀系数 β',
  scale_factor: '灵敏度 k',
  ice_point: '0 °C 时的液柱长',
  steam_point: '100 °C 时的液柱长',
  centigrade_span: '0–100 °C 的液柱长（量程）',
  column_length: '液柱长度 h',
  reading_temperature: '所测温度 t',
}

const VERIFICATION_LABELS: Record<string, string> = {
  column_from_expansion: '液柱升高 = 膨胀体积 / 截面积（两条算法一致）',
  scale_is_uniform: '刻度均匀：膨胀线性，每一度在玻璃上同样长',
  fixed_points_define_the_span: '两个固定点定标：0 与 100 °C 之间的距离被分成 100 等份',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  thermometer_bench_dimensions: '实验台量纲正确',
  thermometer_bench_values: '实验台数值有效（泡 · 管 · 膨胀系数 · 零点长 > 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Liquids a lab thermometer is actually filled with, as volumetric β (1/K). */
const FILLING_LIQUIDS: Readonly<Record<string, number>> = {
  alcohol: 1.1e-3,
  'mercury-like': 2e-4,
  water: 2.1e-4,
}

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedThermometerModel
}

export class ThermometerWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new ThermometerEngine()
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
        createThermometerSimulationRequest(
          scene,
          `thermometer-lab-${String(scene.id)}-${scene.revision}`,
          `thermometer-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveThermometerModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '温度计 Runtime 无法启动。'
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
        commandId: `thermometer-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `thermometer-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '温度计'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'thermal',
        title,
        subtitle: scene.metadata.description ?? '真实温度计 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('thermal'),
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
          code: 'THERMOMETER_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Thermometer Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const view = thermometerSceneVisual({ scene, model })
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'thermal',
      title,
      subtitle: scene.metadata.description ?? '真实温度计 Runtime',
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
        const key = thermometerObservableKeyOf(definition)
        if (key === undefined) return []
        const subKey = key === 'guides' ? 'scale' : 'column'
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
        label: thermometerRigText(),
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: 'thermometer-bench',
            label: '玻璃泡、细管与刻度',
            secondary: '液体温度计',
            icon: 'ground' as const,
            kind: 'object' as const,
          },
        ],
      },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(model: ResolvedThermometerModel | undefined): readonly InspectorSection[] {
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
    /* 换测温液体: the filling is what decides the sensitivity, so this is the
       edit that shows why two thermometers read differently. */
    if (id === 'filling-liquid') {
      const coefficient = FILLING_LIQUIDS[value]
      if (coefficient !== undefined && Math.abs(coefficient - model.expansionCoefficient) > 1e-12) {
        this.command('SetFillingLiquid', {
          benchId: model.benchId,
          coefficient: quantity(coefficient, '', 'dimensionless'),
        })
      }
    }
    /* 把温度计分别插进冰水与沸水 —— the two fixed points, as an action rather
       than a sentence. */
    if (id === 'dip-into') {
      const celsius = value === 'ice' ? 0 : value === 'steam' ? 100 : 25
      this.command('SetThermometerTemperature', {
        benchId: model.benchId,
        temperature: quantity(celsius + CELSIUS_ZERO_IN_KELVIN, 'K', 'temperature'),
      })
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => thermometerObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The column stands where the temperature puts it: no clock to start or scrub. */
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

const celsiusOf = (model: ResolvedThermometerModel): number =>
  model.temperature - CELSIUS_ZERO_IN_KELVIN

const parametersOf = (model: ResolvedThermometerModel): InspectorSection => {
  const celsius = celsiusOf(model)
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    celsius,
    model.icePointLength,
  )
  return {
    id: 'thermometer-parameters',
    title: '玻璃泡与细管',
    parameters: [
      {
        id: 'thermometer-temperature',
        label: '所测温度',
        symbol: 't',
        unit: '°C',
        value: celsius,
        min: -30,
        max: 120,
        step: 5,
      },
      {
        id: 'filling-coefficient',
        label: '膨胀系数',
        symbol: 'β',
        unit: '1/K',
        value: reading.expansionCoefficient,
        min: 1e-5,
        max: 2e-3,
        step: 1e-5,
      },
      {
        id: 'bulb-volume',
        label: '玻璃泡体积',
        symbol: 'V₀',
        unit: 'cm³',
        value: reading.bulbVolume * 1e6,
        min: 0.02,
        max: 1,
        step: 0.02,
      },
      {
        id: 'bore-diameter',
        label: '细管直径',
        symbol: 'd',
        unit: 'mm',
        value: reading.boreDiameter * 1000,
        min: 0.05,
        max: 1,
        step: 0.01,
      },
    ],
    choices: [
      {
        id: 'filling-liquid',
        label: '测温液体',
        value:
          Object.entries(FILLING_LIQUIDS).find(
            ([, beta]) => Math.abs(beta - reading.expansionCoefficient) < 1e-12,
          )?.[0] ?? 'custom',
        options: [
          { value: 'mercury-like', label: '类水银（β = 2×10⁻⁴）' },
          { value: 'water', label: '水（β = 2.1×10⁻⁴）' },
          { value: 'alcohol', label: '酒精（β = 1.1×10⁻³，灵敏度高得多）' },
          { value: 'custom', label: '自定义' },
        ],
      },
      {
        id: 'dip-into',
        label: '把温度计插进',
        value: celsius === 0 ? 'ice' : celsius === 100 ? 'steam' : 'room',
        options: [
          { value: 'ice', label: '冰水混合物（0 °C，下固定点）' },
          { value: 'steam', label: '沸水（100 °C，上固定点）' },
          { value: 'room', label: '室温（25 °C）' },
        ],
      },
    ],
  }
}

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedThermometerModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'thermometer-temperature',
    (model, value) => ({
      type: 'SetThermometerTemperature',
      payload: {
        benchId: model.benchId,
        temperature: quantity(value + CELSIUS_ZERO_IN_KELVIN, 'K', 'temperature'),
      },
    }),
  ],
  [
    'filling-coefficient',
    (model, value) => ({
      type: 'SetFillingLiquid',
      payload: { benchId: model.benchId, coefficient: quantity(value, '', 'dimensionless') },
    }),
  ],
  [
    'bulb-volume',
    (model, value) => ({
      type: 'SetThermometerBulb',
      payload: { benchId: model.benchId, volume: quantity(value, 'cm^3', 'volume') },
    }),
  ],
  [
    'bore-diameter',
    (model, value) => ({
      type: 'SetThermometerBore',
      payload: { benchId: model.benchId, diameter: quantity(value, 'mm', 'length') },
    }),
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedThermometerModel,
): InspectorSection => {
  const celsius = celsiusOf(model)
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    celsius,
    model.icePointLength,
  )
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value: `${fmtFluidValue(celsius, 4)} °C · 液柱 ${fmtFluidValue(reading.column * 100, 4)} cm`,
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
  return { id: 'thermometer-derived', title: '读数', derived: [...readings, ...derived] }
}

const tableOf = (model: ResolvedThermometerModel): DataTableView => {
  const celsius = celsiusOf(model)
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    celsius,
    model.icePointLength,
  )
  const number = (value: number) => fmtFluidValue(value, 4)
  const at = (t: number) =>
    number((reading.icePoint + reading.scale * t) * 100)
  return {
    /* The table IS the scale: a column per fixed point and a column per tenth of
       the way between them, which is what "divided into 100 parts" means. */
    columns: ['t / °C', '液柱 / cm', '相对 0 °C 上升 / mm'],
    rows: [
      { step: 0, values: ['0（下固定点）', at(0), '0'] },
      { step: 1, values: ['25', at(25), number(reading.scale * 25 * 1000)] },
      { step: 2, values: ['50', at(50), number(reading.scale * 50 * 1000)] },
      { step: 3, values: ['100（上固定点）', at(100), number(reading.span * 1000)] },
    ],
  }
}

export const createThermometerWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new ThermometerWorkspaceRuntime(scene)
