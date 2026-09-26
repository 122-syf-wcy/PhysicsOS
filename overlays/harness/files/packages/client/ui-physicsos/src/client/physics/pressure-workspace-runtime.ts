/**
 * Pressure rigs → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + PressureEngine for a pure single-bench pressure scene
 * and reports frames in the shared {@link WorkspaceSnapshot} shape, so the three
 * rigs render through the same `PhysicsWorkspace` shell and `PhysicsCanvas` as
 * the buoyancy tank beside them on the shelf. Parameter edits (压力 / 受力面积 /
 * 液体密度 / 探头深度 / 大气压) go through real scene commands, so a change is an
 * auditable revision bump rather than local component state.
 *
 * There is NO timeline here, and the clock says so: `total: 0`. A bench at rest
 * reads the same pressure at every instant, so the shell disables the transport
 * rather than offering a scrub that would move nothing. Every reading comes from
 * the engine's verified closed form; nothing is computed in this file.
 */

import {
  PressureEngine,
  atmosphericPressureOf,
  createPressureSimulationRequest,
  liquidPressureOf,
  resolvePressureModel,
  solidPressureOf,
  type ResolvedPressureModel,
} from '@physicsos/engine-fluid'
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
import { pressureObservableKeyOf, pressureSceneVisual } from './pressure-visual-bridge.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

/**
 * Observable labels per rig. The two keys mean different apparatus in each
 * sub-model — on the solid rig the reading is a force diagram, in a tank it is a
 * probe, on the atmospheric rig it is a barometer — so a single flat map would
 * have to lie about at least one of them.
 */
const OBSERVABLE_LABELS: Record<
  ResolvedPressureModel['type'],
  Record<'reading' | 'comparison', string>
> = {
  solid: {
    reading: '压力箭头与受力面积',
    comparison: '换一个受力面（同一压力）',
  },
  liquid: {
    reading: '探头深度与压强标注',
    comparison: '更深处 · 换一种液体',
  },
  atmospheric: {
    reading: '汞柱高度与标注',
    comparison: '马德堡半球',
  },
}

const DERIVED_LABELS: Record<string, string> = {
  contact_force: '压力 F',
  contact_area: '受力面积 S',
  contact_pressure: '压强 p',
  comparison_area: '对比面受力面积 S₂',
  comparison_pressure: '对比面压强 p₂',
  liquid_density: '液体密度 ρ',
  probe_depth: '探头深度 h',
  liquid_pressure: '探头处压强 p',
  comparison_depth_pressure: '深处压强 p₂',
  comparison_liquid_pressure: '另一种液体的压强 p₃',
  atmospheric_pressure: '大气压 p₀',
  barometer_column: '汞柱高度 h',
  hemisphere_force: '拉开半球所需的力 F',
}

/**
 * Verification labels. The engine folds the scene checks in (per-target ids like
 * `pressure_bench_values:pressure-bench-1`), so labels resolve by prefix.
 */
const VERIFICATION_LABELS: Record<string, string> = {
  contact_force_invariant: '压力与压强的关系：F = p·S 一致，p 与 S 成反比',
  hydrostatic_gradient_integral: '液体压强梯度 dp/dh = ρg 的积分与 p = ρgh 一致',
  pressure_proportional_to_depth: '同种液体中压强与深度成正比',
  pressure_proportional_to_density: '同一深度处压强与液体密度成正比',
  hemisphere_projected_force: '马德堡半球拉力 = p₀·πr²（与球面积分一致）',
  barometer_column_balance: '托里拆利管平衡：ρ_汞·g·h = p₀',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  pressure_bench_dimensions: '实验台量纲正确',
  pressure_bench_values: '实验台数值有效（力 ≥ 0，面积 · 密度 · 气压 > 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Liquid presets for the one-tap 换液体 switch; the numeric field stays free. */
const LIQUID_DENSITIES: Record<string, number> = {
  water: 1000,
  brine: 1100,
  alcohol: 800,
}

/**
 * Air-pressure presets for the barometer. Reading the column at three altitudes
 * is the whole reason a barometer is an altimeter: the same instrument, three
 * columns, one number different.
 */
const ATMOSPHERIC_PRESSURES: Record<string, number> = {
  standard: 101_300,
  plateau: 70_000,
  highland: 60_000,
}

/** The engine's verified frame for the current revision. */
interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedPressureModel
}

/**
 * The pressure workspace runtime — see the module doc for its role.
 */
export class PressureWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new PressureEngine()
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
        createPressureSimulationRequest(
          scene,
          `pressure-lab-${String(scene.id)}-${scene.revision}`,
          `pressure-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolvePressureModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '压强 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the reading the
       student just verified was derived from the original conditions. Observable
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
        commandId: `pressure-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `pressure-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '压强实验'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'fluid',
        title,
        subtitle: scene.metadata.description ?? '真实压强 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('fluid'),
        ariaLabel: title,
        tree: this.treeOf(scene, undefined),
        inspector: this.inspectorOf(undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: 1 },
        trajectoryTimes: [],
        error: {
          code: 'PRESSURE_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Pressure Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation } = this.computed
    const view = pressureSceneVisual({ scene, model: this.computed.model })
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'fluid',
      title,
      subtitle: scene.metadata.description ?? '真实压强 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, this.computed.model),
      inspector: this.inspectorOf(this.computed.model),
      /* No chart: the rig is static, so a curve against time would either be a
         single point or an invented transient. The table carries the readings. */
      charts: [],
      table: tableOf(this.computed.model),
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
      /* The rig reads the same at every instant, so there is no moment to mark
         and the clock below has no length to place one on. */
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

  private treeOf(
    scene: PhysicsScene,
    model: ResolvedPressureModel | undefined,
  ): readonly SceneTreeNode[] {
    const rigChildren: SceneTreeNode[] = [
      {
        id: model?.benchId ?? 'pressure-bench',
        label: rigLabelOf(model?.type),
        secondary: model === undefined ? '' : rigSecondaryOf(model),
        icon: 'ground' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = pressureObservableKeyOf(definition)
        if (key === undefined || model === undefined) return []
        const subKey = key === 'pressure' ? 'reading' : 'comparison'
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[model.type][subKey],
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: key,
        }]
      },
    )
    return [
      { id: 'rig', label: '压强实验台', icon: 'folder', kind: 'group', children: rigChildren },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: observableChildren,
      },
    ]
  }

  private inspectorOf(model: ResolvedPressureModel | undefined): readonly InspectorSection[] {
    if (model === undefined) return []
    return [parametersOf(model), derivedSectionOf(this.computed?.simulation, model)]
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
    if (id === 'liquid-density' && model.type === 'liquid') {
      const density = LIQUID_DENSITIES[value]
      /* `custom` is a display state, not a command — the numeric field owns it. */
      if (density !== undefined && Math.abs(model.liquidDensity - density) > 1e-9) {
        this.command('SetPressureLiquidDensity', {
          benchId: model.benchId,
          density: quantity(density, 'kg/m^3', 'density'),
        })
      }
    }
    if (id === 'atmospheric-pressure' && model.type === 'atmospheric') {
      const pressure = ATMOSPHERIC_PRESSURES[value]
      if (pressure !== undefined && Math.abs(model.atmosphericPressure - pressure) > 1e-6) {
        this.command('SetPressureAtmospheric', {
          benchId: model.benchId,
          pressure: quantity(pressure, 'Pa', 'pressure'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => pressureObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The rig is at rest: there is no clock to start, stop or scrub. Each method
     returns the same frame the shell already has, and the shell's own transport
     is disabled by `clock.total <= 0`, so none of these is reachable from the
     UI — they exist only to satisfy the shared runtime contract. */
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

const rigLabelOf = (type: ResolvedPressureModel['type'] | undefined): string => {
  switch (type) {
    case 'solid':
      return '压力作用效果（固体压强）'
    case 'liquid':
      return '液体内部压强'
    case 'atmospheric':
      return '大气压的测量'
    default:
      return '压强实验台'
  }
}

const rigSecondaryOf = (model: ResolvedPressureModel): string => {
  if (model.type === 'solid') {
    return `F = ${fmtFluidValue(model.force, 5)} N · S = ${fmtFluidValue(model.area * 1e4, 5)} cm²`
  }
  if (model.type === 'liquid') {
    return `ρ = ${fmtFluidValue(model.liquidDensity, 5)} kg/m³ · h = ${fmtFluidValue(model.depth * 100, 5)} cm`
  }
  return `p₀ = ${fmtFluidValue(model.atmosphericPressure, 5)} Pa · r = ${fmtFluidValue(model.hemisphereRadius * 100, 5)} cm`
}

/** One editable row per field the bench actually carries. */
const parametersOf = (model: ResolvedPressureModel): InspectorSection => {
  /* Every row lights the one bench: the rig has no other object to point at. */
  const highlights = model.benchId
  const parameter = (
    id: string,
    label: string,
    symbol: string,
    unit: string,
    value: number,
    step: number,
    min = 0,
  ) => ({ id, label, symbol, unit, value: Number.parseFloat(value.toFixed(4)), min, step, highlights })

  if (model.type === 'solid') {
    const parameters = [
      parameter('pressure-force', '压力', 'F', 'N', model.force, 1),
      parameter('contact-area', '受力面积', 'S', 'cm²', model.area * 1e4, 10, 1),
    ]
    if (model.comparisonArea !== undefined) {
      parameters.push(
        parameter('comparison-area', '对比面面积', 'S₂', 'cm²', model.comparisonArea * 1e4, 10, 1),
      )
    }
    return { id: 'rig', title: '压强实验台', parameters }
  }

  if (model.type === 'liquid') {
    const liquidValue =
      Object.entries(LIQUID_DENSITIES).find(
        ([, density]) => Math.abs(density - model.liquidDensity) < 1e-9,
      )?.[0] ?? 'custom'
    const parameters = [
      parameter('liquid-density', '液体密度', 'ρ', 'kg/m³', model.liquidDensity, 50, 1),
      parameter('probe-depth', '探头深度', 'h', 'cm', model.depth * 100, 5),
    ]
    if (model.comparisonDepth !== undefined) {
      parameters.push(
        parameter('comparison-depth', '对比深度', 'h₂', 'cm', model.comparisonDepth * 100, 5),
      )
    }
    if (model.comparisonLiquidDensity !== undefined) {
      parameters.push(
        parameter(
          'comparison-liquid-density',
          '对比液体密度',
          'ρ₂',
          'kg/m³',
          model.comparisonLiquidDensity,
          50,
          1,
        ),
      )
    }
    return {
      id: 'rig',
      title: '压强实验台',
      parameters,
      choices: [
        {
          id: 'liquid-density',
          label: '液体',
          value: liquidValue,
          options: [
            { value: 'water', label: '水（1000 kg/m³）' },
            { value: 'brine', label: '盐水（1100 kg/m³）' },
            { value: 'alcohol', label: '酒精（800 kg/m³）' },
            { value: 'custom', label: '自定义密度' },
          ],
        },
      ],
    }
  }

  const pressureValue =
    Object.entries(ATMOSPHERIC_PRESSURES).find(
      ([, pressure]) => Math.abs(pressure - model.atmosphericPressure) < 1e-6,
    )?.[0] ?? 'custom'

  return {
    id: 'rig',
    title: '压强实验台',
    parameters: [
      parameter(
        'atmospheric-pressure',
        '大气压',
        'p₀',
        'Pa',
        model.atmosphericPressure,
        1000,
        1,
      ),
      parameter(
        'barometer-fluid-density',
        '气压计液体密度',
        'ρ_液',
        'kg/m³',
        model.barometerFluidDensity,
        100,
        1,
      ),
      parameter(
        'hemisphere-radius',
        '半球半径',
        'r',
        'cm',
        model.hemisphereRadius * 100,
        1,
        0.5,
      ),
    ],
    choices: [
      {
        id: 'atmospheric-pressure',
        label: '气压',
        value: pressureValue,
        options: [
          { value: 'standard', label: '标准大气压（101300 Pa）' },
          { value: 'plateau', label: '高原（70000 Pa）' },
          { value: 'highland', label: '高山（60000 Pa）' },
          { value: 'custom', label: '自定义气压' },
        ],
      },
    ],
  }
}

/**
 * Editable row id → the scene command it writes, per sub-model. A row that the
 * resolved model does not carry has no entry: a bench authored without a
 * comparison face cannot be given one from the inspector, because the missing
 * field is a structural fact about the rig, not a zero.
 */
const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedPressureModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'pressure-force',
    (model, value) =>
      model.type === 'solid'
        ? {
          type: 'SetPressureForce',
          payload: { benchId: model.benchId, force: quantity(value, 'N', 'force') },
        }
        : undefined,
  ],
  [
    'contact-area',
    (model, value) =>
      model.type === 'solid'
        ? {
          type: 'SetPressureContactArea',
          payload: { benchId: model.benchId, area: quantity(value, 'cm^2', 'area') },
        }
        : undefined,
  ],
  [
    'comparison-area',
    (model, value) =>
      model.type === 'solid'
        ? {
          type: 'SetPressureComparisonArea',
          payload: { benchId: model.benchId, area: quantity(value, 'cm^2', 'area') },
        }
        : undefined,
  ],
  [
    'liquid-density',
    (model, value) =>
      model.type === 'liquid'
        ? {
          type: 'SetPressureLiquidDensity',
          payload: { benchId: model.benchId, density: quantity(value, 'kg/m^3', 'density') },
        }
        : undefined,
  ],
  [
    'probe-depth',
    (model, value) =>
      model.type === 'liquid'
        ? {
          type: 'SetPressureProbeDepth',
          payload: { benchId: model.benchId, depth: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'comparison-depth',
    (model, value) =>
      model.type === 'liquid'
        ? {
          type: 'SetPressureComparisonDepth',
          payload: { benchId: model.benchId, depth: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'comparison-liquid-density',
    (model, value) =>
      model.type === 'liquid'
        ? {
          type: 'SetPressureComparisonLiquidDensity',
          payload: { benchId: model.benchId, density: quantity(value, 'kg/m^3', 'density') },
        }
        : undefined,
  ],
  [
    'atmospheric-pressure',
    (model, value) =>
      model.type === 'atmospheric'
        ? {
          type: 'SetPressureAtmospheric',
          payload: { benchId: model.benchId, pressure: quantity(value, 'Pa', 'pressure') },
        }
        : undefined,
  ],
  [
    'barometer-fluid-density',
    (model, value) =>
      model.type === 'atmospheric'
        ? {
          type: 'SetPressureBarometerFluidDensity',
          payload: { benchId: model.benchId, density: quantity(value, 'kg/m^3', 'density') },
        }
        : undefined,
  ],
  [
    'hemisphere-radius',
    (model, value) =>
      model.type === 'atmospheric'
        ? {
          type: 'SetPressureHemisphereRadius',
          payload: { benchId: model.benchId, radius: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
]

/** The engine's own derived quantities, plus the reading each instrument lands on. */
const derivedSectionOf = (
  simulation: SimulationResult | undefined,
  model: ResolvedPressureModel,
): InspectorSection => {
  const derived: DerivedQuantityView[] = []
  if (simulation !== undefined) {
    for (const entry of simulation.derivedQuantities) {
      if (!isScalarQuantity(entry.value)) continue
      derived.push({
        id: entry.key,
        label: derivedLabelOf(entry.key),
        symbol: '',
        value: fmtFluidValue(entry.value.value, 5),
        unit: entry.value.unit,
        ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
      })
    }
  }
  /* The reading the rig's own instrument lands on, stated once in the unit the
     textbook uses rather than in the canonical unit the engine emits. */
  derived.push({
    id: 'instrument-reading',
    label: '仪器读数',
    symbol: '',
    value: instrumentReadingOf(model),
    unit: '',
    highlights: model.benchId,
  })
  return { id: 'derived', title: '派生量', derived }
}

const instrumentReadingOf = (model: ResolvedPressureModel): string => {
  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    return reading.comparisonPressure === undefined
      ? `p = ${fmtFluidValue(reading.pressure, 5)} Pa`
      : `p = ${fmtFluidValue(reading.pressure, 5)} Pa · p₂ = ${fmtFluidValue(reading.comparisonPressure, 5)} Pa`
  }
  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    return `p = ${fmtFluidValue(reading.pressure, 5)} Pa`
  }
  const reading = atmosphericPressureOf(model)
  return `h = ${fmtFluidValue(reading.columnHeight * 1000, 5)} mm · F = ${fmtFluidValue(reading.hemisphereForce, 5)} N`
}

/**
 * The readings side by side. There is no time column: the rig does not move, so
 * the rows are the rig's own faces / probes / instruments rather than instants.
 */
const tableOf = (model: ResolvedPressureModel): DataTableView => {
  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    const rows = [
      {
        step: 0,
        values: [
          '受力面',
          fmtFluidValue(reading.force, 5),
          fmtFluidValue(reading.area * 1e4, 5),
          fmtFluidValue(reading.pressure, 5),
        ],
      },
    ]
    if (reading.comparisonArea !== undefined && reading.comparisonPressure !== undefined) {
      rows.push({
        step: 1,
        values: [
          '对比面',
          fmtFluidValue(reading.force, 5),
          fmtFluidValue(reading.comparisonArea * 1e4, 5),
          fmtFluidValue(reading.comparisonPressure, 5),
        ],
      })
    }
    return { columns: ['受力面', 'F / N', 'S / cm²', 'p / Pa'], rows }
  }

  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    const rows = [
      {
        step: 0,
        values: [
          '探头',
          fmtFluidValue(reading.liquidDensity, 5),
          fmtFluidValue(reading.depth * 100, 5),
          fmtFluidValue(reading.pressure, 5),
        ],
      },
    ]
    if (reading.comparisonDepth !== undefined && reading.comparisonDepthPressure !== undefined) {
      rows.push({
        step: 1,
        values: [
          '深处探头',
          fmtFluidValue(reading.liquidDensity, 5),
          fmtFluidValue(reading.comparisonDepth * 100, 5),
          fmtFluidValue(reading.comparisonDepthPressure, 5),
        ],
      })
    }
    if (
      reading.comparisonLiquidDensity !== undefined &&
      reading.comparisonLiquidPressure !== undefined
    ) {
      rows.push({
        step: rows.length,
        values: [
          '另一种液体',
          fmtFluidValue(reading.comparisonLiquidDensity, 5),
          fmtFluidValue(reading.depth * 100, 5),
          fmtFluidValue(reading.comparisonLiquidPressure, 5),
        ],
      })
    }
    return { columns: ['探头', 'ρ / (kg/m³)', 'h / cm', 'p / Pa'], rows }
  }

  const reading = atmosphericPressureOf(model)
  return {
    columns: ['仪器', '依据', '读数'],
    rows: [
      {
        step: 0,
        values: [
          '托里拆利管',
          `p₀ = ρ_液·g·h，ρ_液 = ${fmtFluidValue(model.barometerFluidDensity, 5)} kg/m³`,
          `h = ${fmtFluidValue(reading.columnHeight * 1000, 5)} mm`,
        ],
      },
      {
        step: 1,
        values: [
          '马德堡半球',
          `F = p₀·πr²，r = ${fmtFluidValue(model.hemisphereRadius * 100, 5)} cm`,
          `F = ${fmtFluidValue(reading.hemisphereForce, 5)} N`,
        ],
      },
    ],
  }
}

/**
 * The pressure workspace runtime helper `createPressureWorkspaceRuntime`.
 * @returns the pressure workspace runtime.
 * @param scene - the physics scene.
 */
export const createPressureWorkspaceRuntime = (
  scene: PhysicsScene,
): PressureWorkspaceRuntime => new PressureWorkspaceRuntime(scene)
