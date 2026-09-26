/**
 * Current-magnetic rigs → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + CurrentFieldEngine for a pure single-bench scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the two rigs
 * render through the same `PhysicsWorkspace` shell and `PhysicsCanvas` as the
 * Lorentz particle scene beside them on the shelf. Parameter edits (电流 /
 * 探测距离 / 匝数 / 线圈长度) go through real scene commands, so a change is an
 * auditable revision bump rather than local component state.
 *
 * There is NO timeline here, and the clock says so: `total: 0`. A steady current
 * makes the same field at every instant, so the shell disables the transport
 * rather than offering a scrub that would move nothing. Every reading comes from
 * the engine's verified closed form; nothing is computed in this file.
 */

import {
  CurrentFieldEngine,
  createCurrentSimulationRequest,
  electromagnetFieldOf,
  motorReadingOf,
  resolveCurrentModel,
  solenoidFieldOf,
  straightWireFieldOf,
  type ResolvedCurrentModel,
} from '@physicsos/engine-magnetic'
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

import { currentObservableKeyOf, currentRigText } from './current-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import { currentSceneVisual } from './current-visual-bridge.ts'
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
 * Observable labels per rig. The two keys mean different apparatus in each rig —
 * on the wire the field is a set of rings around a conductor, on the coil a line
 * along the axis and the loops that close it — so a single flat map would have
 * to lie about at least one of them.
 */
const OBSERVABLE_LABELS: Record<
  ResolvedCurrentModel['type'],
  Record<'field' | 'comparison', string>
> = {
  straight_wire: {
    field: '探测点与磁场方向',
    comparison: '更远处的第二个探测点',
  },
  solenoid: {
    field: '管内磁场方向、磁感线与匝数',
    comparison: '第二个绕组（同一骨架）',
  },
  electromagnet: {
    field: '铁芯中的磁场与磁感线',
    comparison: '换一个铁芯（同一线圈）',
  },
  motor: {
    field: '安培力与转动方向',
    comparison: '换一个线圈角度（同一转子）',
  },
}

const DERIVED_LABELS: Record<string, string> = {
  wire_current: '电流 I',
  probe_distance: '探测距离 r',
  magnetic_flux_density: '磁感应强度 B',
  field_circulation: '磁场环绕方向',
  comparison_distance: '对比探测距离 r₂',
  comparison_field: '对比点磁感应强度 B₂',
  coil_current: '电流 I',
  coil_turns: '匝数 N',
  coil_length: '线圈长度 L',
  end_field: '管口磁感应强度 B_端',
  north_pole: 'N 极所在端',
  comparison_turns: '对比绕组匝数 N₂',
  core_permeability: '铁芯相对磁导率 μ_r',
  air_cored_field: '空气芯磁感应强度 B₀',
  pole_face_pull: '极面吸力 F',
  held_mass: '吸力相当于的质量 m',
  comparison_core_permeability: '对比铁芯 μ_r₂',
  comparison_pull: '对比铁芯吸力 F₂',
  rotor_current: '电流 I',
  rotor_turns: '匝数 n',
  stator_field: '定子磁场 B',
  coil_area: '线圈面积 A',
  coil_angle: '线圈角度 θ',
  side_force: '每边安培力 F',
  motor_torque: '力矩 τ',
  peak_torque: '最大力矩 τ_max',
  rotation_sense: '转动方向',
}

/**
 * Verification labels. The engine folds the scene checks in (per-target ids like
 * `current_bench_values:current-bench-1`), so labels resolve by prefix.
 */
const VERIFICATION_LABELS: Record<string, string> = {
  wire_field_from_finite_segment: 'B = μ₀I/(2πr) 与有限长导线的毕奥–萨伐尔结果一致',
  field_inverse_with_distance: '磁场与距离成反比：B·r 在两处探测点上相同',
  field_direction_follows_current: '安培定则：磁场环绕方向随电流反向而反向',
  solenoid_field_from_turn_density: '螺线管 B = μ₀(N/L)I，与管口磁场/2 一致',
  field_proportional_to_turns: '同一骨架上磁场与匝数成正比',
  north_pole_follows_current: '安培定则：N 极随电流反向而互换',
  core_field_from_permeability: '铁芯作用：B = μ_r·μ₀(N/L)I，正是空气芯磁场的 μ_r 倍',
  pull_proportional_to_field_squared: '吸力与 B 的平方成正比：F = B²A/(2μ₀)，电流加倍吸力变四倍',
  pull_proportional_to_core_squared: '吸力与 μ_r 的平方成正比：换更好的铁芯按平方增益',
  torque_from_ampere_force: '力矩的两条算法一致：τ = n·F·W·cosθ 与 τ = n·B·I·A·cosθ',
  torque_vanishes_at_dead_point: '平衡位置：θ = 90° 时力矩恰好为零',
  commutator_keeps_torque_one_signed: '换向器：过平衡位置时把电流反向，力矩方向不变',
  torque_proportional_to_current: '力矩与电流成正比（与电磁铁的平方规律不同）',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  current_bench_dimensions: '实验台量纲正确',
  current_bench_values: '实验台数值有效（电流非零，距离 · 匝数 · 长度 > 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/**
 * Cores the Lab hands over, as relative permeabilities. Air is first because it
 * is the baseline the other two are measured against, and 200 is what a junior
 * textbook means by 铁芯; `custom` is a display state the numeric field owns.
 */
const CORE_PERMEABILITIES: Readonly<Record<string, number>> = {
  air: 1,
  'soft-iron': 200,
  'silicon-steel': 800,
}

const CORE_MATERIAL_OPTIONS = [
  { value: 'air', label: '空气芯（μ_r = 1）' },
  { value: 'soft-iron', label: '软铁（μ_r = 200）' },
  { value: 'silicon-steel', label: '硅钢（μ_r = 800）' },
  { value: 'custom', label: '自定义' },
] as const

const coreMaterialValueOf = (relativePermeability: number): string =>
  Object.entries(CORE_PERMEABILITIES).find(
    ([, value]) => Math.abs(value - relativePermeability) < 1e-9,
  )?.[0] ?? 'custom'

/**
 * Field formatting, chosen the same way the bridge chooses it: the bench
 * conductor reads tens of microtesla and the coil reads millitesla, and one
 * fixed unit would print one of them as 0.00004.
 */
const fieldText = (teslas: number): string => {
  const magnitude = Math.abs(teslas)
  if (magnitude < 1e-4) return `${fmtFluidValue(teslas * 1e6, 4)} µT`
  if (magnitude < 0.1) return `${fmtFluidValue(teslas * 1e3, 4)} mT`
  return `${fmtFluidValue(teslas, 4)} T`
}

/** The engine's verified frame for the current revision. */
interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedCurrentModel
}

/**
 * The current workspace runtime — see the module doc for its role.
 */
export class CurrentWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new CurrentFieldEngine()
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
        createCurrentSimulationRequest(
          scene,
          `current-lab-${String(scene.id)}-${scene.revision}`,
          `current-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveCurrentModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '电流磁场 Runtime 无法启动。'
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
        commandId: `current-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `current-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '电流的磁场'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'magnetic',
        title,
        subtitle: scene.metadata.description ?? '真实电流磁场 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('magnetic'),
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
          code: 'CURRENT_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Current Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const view = currentSceneVisual({ scene, model })
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'magnetic',
      title,
      subtitle: scene.metadata.description ?? '真实电流磁场 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, model),
      inspector: this.inspectorOf(model),
      /* No chart: the field is steady, so a curve against time would either be a
         single point or an invented transient. The table carries the readings. */
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
      /* The field is steady, so there is no moment to mark and the clock below
         has no length to place one on. */
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
    model: ResolvedCurrentModel | undefined,
  ): readonly SceneTreeNode[] {
    const rigChildren: SceneTreeNode[] = [
      {
        id: model?.benchId ?? 'current-bench',
        label: model === undefined ? '电流磁场实验台' : currentRigText(model.type),
        secondary: model === undefined ? '' : rigSecondaryOf(model),
        icon: 'ground' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = currentObservableKeyOf(definition)
        if (key === undefined || model === undefined) return []
        const subKey = key === 'fieldLines' ? 'field' : 'comparison'
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[model.type][subKey],
          secondary: definition.visible ? '显示' : '隐藏',
          icon: 'observable' as const,
          kind: 'observable' as const,
          visible: definition.visible,
        }]
      },
    )
    return [
      { id: 'rig', label: '电流磁场实验台', icon: 'folder', kind: 'group', children: rigChildren },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: observableChildren,
      },
    ]
  }

  private inspectorOf(model: ResolvedCurrentModel | undefined): readonly InspectorSection[] {
    if (model === undefined) return []
    return [parametersOf(model), directionChoiceOf(model), derivedSectionOf(this.computed, model)]
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

  /**
   * The direction switch. Reversing the current is the one edit that changes no
   * magnitude at all — B, B₂ and the end field are all unchanged — while
   * swapping the circulation and the poles, which is exactly what 安培定则 says.
   */
  setChoice(id: string, value: string): WorkspaceSnapshot {
    const model = this.computed?.model
    if (model === undefined) return this.getSnapshot()
    if (id === 'current-direction') {
      const sign = value === 'in' ? -1 : 1
      const magnitude = Math.abs(model.current)
      if (Math.sign(model.current) !== sign) {
        this.command('SetCurrent', {
          benchId: model.benchId,
          current: quantity(sign * magnitude, 'A', 'electric_current'),
        })
      }
    }
    /* Swapping the core is the edit this rig exists for: it moves the pull by
       the SQUARE of the change, so the same click that doubles the field
       quadruples what the magnet holds. */
    if (id === 'core-material' && model.type === 'electromagnet') {
      const permeability = CORE_PERMEABILITIES[value]
      if (
        permeability !== undefined &&
        Math.abs(permeability - model.coreRelativePermeability) > 1e-9
      ) {
        this.command('SetCorePermeability', {
          benchId: model.benchId,
          relativePermeability: quantity(permeability, '', 'dimensionless'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => currentObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The current is steady: there is no clock to start, stop or scrub. Each
     method returns the same frame the shell already has, and the shell's own
     transport is disabled by `clock.total <= 0`, so none of these is reachable
     from the UI — they exist only to satisfy the shared runtime contract. */
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

const rigSecondaryOf = (model: ResolvedCurrentModel): string => {
  if (model.type === 'straight_wire') {
    return `I = ${fmtFluidValue(model.current, 4)} A · r = ${fmtFluidValue(model.probeDistance * 100, 4)} cm`
  }
  if (model.type === 'electromagnet') {
    return `I = ${fmtFluidValue(model.current, 4)} A · μ_r = ${fmtFluidValue(model.coreRelativePermeability, 4)}`
  }
  if (model.type === 'motor') {
    return `B = ${fmtFluidValue(model.magneticFluxDensity, 4)} T · n = ${fmtFluidValue(model.turns, 4)} · I = ${fmtFluidValue(model.current, 4)} A`
  }
  return `N = ${fmtFluidValue(model.turns, 4)} · L = ${fmtFluidValue(model.coilLength * 100, 4)} cm`
}

const parametersOf = (model: ResolvedCurrentModel): InspectorSection => {
  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)
    const parameters = [
      {
        id: 'current',
        label: '电流',
        symbol: 'I',
        unit: 'A',
        value: model.current,
        step: 1,
        /* Signed, so the field can be reversed from the field's own row and not
           only from the direction switch. Zero is excluded: a dead conductor
           makes no field. */
        min: -50,
        max: 50,
      },
      {
        id: 'probe-distance',
        label: '探测距离',
        symbol: 'r',
        unit: 'cm',
        value: reading.probeDistance * 100,
        min: 0.5,
        max: 50,
        step: 0.5,
      },
    ]
    if (reading.comparisonDistance !== undefined) {
      parameters.push({
        id: 'comparison-probe-distance',
        label: '对比探测距离',
        symbol: 'r₂',
        unit: 'cm',
        value: reading.comparisonDistance * 100,
        min: 0.5,
        max: 100,
        step: 0.5,
      })
    }
    return { id: 'current-parameters', title: '直导线参数', parameters }
  }

  if (model.type === 'electromagnet') {
    const reading = electromagnetFieldOf(model)
    const parameters = [
      {
        id: 'current',
        label: '电流',
        symbol: 'I',
        unit: 'A',
        value: model.current,
        step: 0.5,
        min: -50,
        max: 50,
      },
      {
        id: 'solenoid-turns',
        label: '匝数',
        symbol: 'N',
        unit: '匝',
        value: reading.turns,
        min: 1,
        max: 4000,
        step: 10,
      },
      {
        id: 'solenoid-length',
        label: '线圈长度',
        symbol: 'L',
        unit: 'cm',
        value: reading.coilLength * 100,
        min: 2,
        max: 100,
        step: 1,
      },
      {
        id: 'core-permeability',
        label: '铁芯相对磁导率',
        symbol: 'μ_r',
        unit: '',
        value: reading.coreRelativePermeability,
        /* 1 is the air-cored coil — the baseline, not a floor to stay above. */
        min: 1,
        max: 5000,
        step: 10,
      },
    ]
    if (reading.comparisonCoreRelativePermeability !== undefined) {
      parameters.push({
        id: 'comparison-core-permeability',
        label: '对比铁芯相对磁导率',
        symbol: 'μ_r₂',
        unit: '',
        value: reading.comparisonCoreRelativePermeability,
        min: 1,
        max: 5000,
        step: 10,
      })
    }
    parameters.push({
      id: 'core-area',
      label: '极面面积',
      symbol: 'A',
      unit: 'cm²',
      value: reading.coreArea * 1e4,
      min: 0.5,
      max: 100,
      step: 0.5,
    })
    return { id: 'current-parameters', title: '电磁铁参数', parameters }
  }

  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    return {
      id: 'current-parameters',
      title: '电动机参数',
      parameters: [
        {
          id: 'current',
          label: '电流',
          symbol: 'I',
          unit: 'A',
          value: model.current,
          step: 0.5,
          min: -50,
          max: 50,
        },
        {
          id: 'rotor-field',
          label: '定子磁场',
          symbol: 'B',
          unit: 'T',
          value: reading.field,
          min: 0.05,
          max: 2,
          step: 0.05,
        },
        {
          id: 'rotor-turns',
          label: '匝数',
          symbol: 'n',
          unit: '匝',
          value: reading.turns,
          min: 1,
          max: 2000,
          step: 10,
        },
        {
          id: 'rotor-side',
          label: '受力边长',
          symbol: 'L',
          unit: 'cm',
          value: reading.sideLength * 100,
          min: 1,
          max: 40,
          step: 0.5,
        },
        {
          id: 'rotor-width',
          label: '线圈宽度',
          symbol: 'W',
          unit: 'cm',
          value: reading.coilWidth * 100,
          min: 1,
          max: 40,
          step: 0.5,
        },
        {
          id: 'rotor-angle',
          label: '线圈角度',
          symbol: 'θ',
          unit: '°',
          value: (reading.angle * 180) / Math.PI,
          min: -90,
          max: 180,
          step: 5,
        },
      ],
    }
  }

  const reading = solenoidFieldOf(model)
  const parameters = [
    {
      id: 'current',
      label: '电流',
      symbol: 'I',
      unit: 'A',
      value: model.current,
      step: 0.5,
      min: -50,
      max: 50,
    },
    {
      id: 'solenoid-turns',
      label: '匝数',
      symbol: 'N',
      unit: '匝',
      value: reading.turns,
      min: 1,
      max: 4000,
      step: 10,
    },
    {
      id: 'solenoid-length',
      label: '线圈长度',
      symbol: 'L',
      unit: 'cm',
      value: reading.coilLength * 100,
      min: 2,
      max: 100,
      step: 1,
    },
  ]
  if (reading.comparisonTurns !== undefined) {
    parameters.push({
      id: 'solenoid-comparison-turns',
      label: '对比绕组匝数',
      symbol: 'N₂',
      unit: '匝',
      value: reading.comparisonTurns,
      min: 1,
      max: 8000,
      step: 10,
    })
  }
  return { id: 'current-parameters', title: '螺线管参数', parameters }
}

const directionChoiceOf = (model: ResolvedCurrentModel): InspectorSection => ({
  id: 'current-direction-section',
  title: model.type === 'electromagnet' ? '安培定则与铁芯' : '安培定则',
  choices: [
    {
      id: 'current-direction',
      label: '电流方向',
      value: model.current > 0 ? 'out' : 'in',
      options: [
        { value: 'out', label: '电流出纸面（⊙）' },
        { value: 'in', label: '电流进纸面（⊗）' },
      ],
    },
    ...(model.type === 'electromagnet'
      ? [
        {
          id: 'core-material',
          label: '铁芯',
          value: coreMaterialValueOf(model.coreRelativePermeability),
          options: CORE_MATERIAL_OPTIONS,
        },
      ]
      : []),
  ],
})

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedCurrentModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'current',
    (model, value) => ({
      type: 'SetCurrent',
      payload: { benchId: model.benchId, current: quantity(value, 'A', 'electric_current') },
    }),
  ],
  [
    'probe-distance',
    (model, value) =>
      model.type === 'straight_wire'
        ? {
          type: 'SetProbeDistance',
          payload: { benchId: model.benchId, distance: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'comparison-probe-distance',
    (model, value) =>
      model.type === 'straight_wire'
        ? {
          type: 'SetComparisonProbeDistance',
          payload: { benchId: model.benchId, distance: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'solenoid-turns',
    (model, value) =>
      model.type === 'solenoid' || model.type === 'electromagnet'
        ? {
          type: 'SetSolenoidTurns',
          payload: { benchId: model.benchId, turns: quantity(value, '', 'dimensionless') },
        }
        : undefined,
  ],
  [
    'solenoid-comparison-turns',
    (model, value) =>
      model.type === 'solenoid'
        ? {
          type: 'SetSolenoidComparisonTurns',
          payload: { benchId: model.benchId, turns: quantity(value, '', 'dimensionless') },
        }
        : undefined,
  ],
  [
    'solenoid-length',
    (model, value) =>
      model.type === 'solenoid' || model.type === 'electromagnet'
        ? {
          type: 'SetSolenoidLength',
          payload: { benchId: model.benchId, length: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'core-permeability',
    (model, value) =>
      model.type === 'electromagnet'
        ? {
          type: 'SetCorePermeability',
          payload: {
            benchId: model.benchId,
            relativePermeability: quantity(value, '', 'dimensionless'),
          },
        }
        : undefined,
  ],
  [
    'comparison-core-permeability',
    (model, value) =>
      model.type === 'electromagnet'
        ? {
          type: 'SetComparisonCorePermeability',
          payload: {
            benchId: model.benchId,
            relativePermeability: quantity(value, '', 'dimensionless'),
          },
        }
        : undefined,
  ],
  [
    'core-area',
    (model, value) =>
      model.type === 'electromagnet'
        ? {
          type: 'SetCoreArea',
          payload: { benchId: model.benchId, area: quantity(value, 'cm^2', 'area') },
        }
        : undefined,
  ],
  [
    'rotor-field',
    (model, value) =>
      model.type === 'motor'
        ? {
          type: 'SetRotorField',
          payload: {
            benchId: model.benchId,
            field: quantity(value, 'T', 'magnetic_flux_density'),
          },
        }
        : undefined,
  ],
  [
    'rotor-turns',
    (model, value) =>
      model.type === 'motor'
        ? {
          type: 'SetSolenoidTurns',
          payload: { benchId: model.benchId, turns: quantity(value, '', 'dimensionless') },
        }
        : undefined,
  ],
  [
    'rotor-side',
    (model, value) =>
      model.type === 'motor'
        ? {
          type: 'SetRotorSideLength',
          payload: { benchId: model.benchId, length: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'rotor-width',
    (model, value) =>
      model.type === 'motor'
        ? {
          type: 'SetRotorCoilWidth',
          payload: { benchId: model.benchId, width: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'rotor-angle',
    (model, value) =>
      model.type === 'motor'
        ? {
          type: 'SetRotorAngle',
          payload: { benchId: model.benchId, angle: quantity(value, 'deg', 'angle') },
        }
        : undefined,
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedCurrentModel,
): InspectorSection => {
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value: instrumentReadingOf(model),
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
  return { id: 'current-derived', title: '读数', derived: [...readings, ...derived] }
}

/** The one-line reading, the way every other bench states its dial. */
const instrumentReadingOf = (model: ResolvedCurrentModel): string => {
  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)
    return reading.comparisonField === undefined
      ? `B = ${fieldText(reading.field)}`
      : `B = ${fieldText(reading.field)} · B₂ = ${fieldText(reading.comparisonField)}`
  }
  if (model.type === 'electromagnet') {
    /* What this rig HOLDS is the answer to the question it asks, so the dial is
       the pull and the mass, not the field that produced them. */
    const reading = electromagnetFieldOf(model)
    return `F = ${fmtFluidValue(reading.pull, 4)} N · m = ${fmtFluidValue(reading.heldMass, 4)} kg`
  }
  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    return `τ = ${fmtFluidValue(reading.torque, 4)} N·m · F = ${fmtFluidValue(reading.sideForce, 4)} N`
  }
  const reading = solenoidFieldOf(model)
  return `B = ${fieldText(reading.field)} · B_端 = ${fieldText(reading.endField)}`
}

const tableOf = (model: ResolvedCurrentModel): DataTableView => {
  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)
    /* One unit for the whole column: both readings come from the same current,
       so they differ only by the distance ratio and a per-cell unit would make
       the column unreadable even when both are microtesla. */
    const unit = Math.abs(reading.field) < 1e-4 ? 'µT' : Math.abs(reading.field) < 1 ? 'mT' : 'T'
    const factor = unit === 'µT' ? 1e6 : unit === 'mT' ? 1e3 : 1
    const rows = [
      {
        step: 0,
        values: ['近处探测点', fmtFluidValue(reading.probeDistance * 100, 4), fmtFluidValue(reading.field * factor, 4)],
      },
    ]
    if (reading.comparisonDistance !== undefined && reading.comparisonField !== undefined) {
      rows.push({
        step: 1,
        values: [
          '远处探测点',
          fmtFluidValue(reading.comparisonDistance * 100, 4),
          fmtFluidValue(reading.comparisonField * factor, 4),
        ],
      })
    }
    return {
      columns: ['探测点', 'r / cm', `B / ${unit}`],
      rows,
    }
  }

  if (model.type === 'electromagnet') {
    /* Three rows, not two: the air-cored coil is the control the other two are
       read against, and it is the row that shows what the iron is FOR. */
    const reading = electromagnetFieldOf(model)
    const rows = [
      {
        step: 0,
        values: [
          '主铁芯',
          fmtFluidValue(reading.coreRelativePermeability, 4),
          fmtFluidValue(reading.field, 4),
          fmtFluidValue(reading.pull, 4),
          fmtFluidValue(reading.heldMass, 4),
        ],
      },
    ]
    if (
      reading.comparisonCoreRelativePermeability !== undefined &&
      reading.comparisonField !== undefined &&
      reading.comparisonPull !== undefined
    ) {
      rows.push({
        step: 1,
        values: [
          '对比铁芯',
          fmtFluidValue(reading.comparisonCoreRelativePermeability, 4),
          fmtFluidValue(reading.comparisonField, 4),
          fmtFluidValue(reading.comparisonPull, 4),
          fmtFluidValue(reading.comparisonPull / model.gravity, 4),
        ],
      })
    }
    rows.push({
      step: rows.length,
      values: [
        '空气芯',
        '1',
        fmtFluidValue(reading.airField, 4),
        fmtFluidValue(reading.airPull, 4),
        fmtFluidValue(reading.airHeldMass, 4),
      ],
    })
    return { columns: ['铁芯', 'μ_r', 'B / T', 'F / N', 'm / kg'], rows }
  }

  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    const degrees = (radians: number) => fmtFluidValue((radians * 180) / Math.PI, 4)
    /* The middle row is the whole lesson: at the dead point the FORCE is
       unchanged and the LEVER ARM is what has gone to zero. */
    return {
      columns: ['线圈角度', 'θ / °', '杠杆臂 / cm', 'F / N', 'τ / N·m'],
      rows: [
        {
          step: 0,
          values: [
            '当前',
            degrees(reading.angle),
            fmtFluidValue(reading.coilWidth * 100 * Math.cos(reading.angle), 4),
            fmtFluidValue(reading.sideForce, 4),
            fmtFluidValue(reading.torque, 4),
          ],
        },
        {
          step: 1,
          values: ['平衡位置', '90', '0', fmtFluidValue(reading.sideForce, 4), '0'],
        },
        {
          step: 2,
          values: [
            '力矩最大',
            '0',
            fmtFluidValue(reading.coilWidth * 100, 4),
            fmtFluidValue(reading.sideForce, 4),
            fmtFluidValue(reading.peakTorque, 4),
          ],
        },
      ],
    }
  }

  const reading = solenoidFieldOf(model)
  const unit = Math.abs(reading.field) < 1e-4 ? 'µT' : Math.abs(reading.field) < 1 ? 'mT' : 'T'
  const factor = unit === 'µT' ? 1e6 : unit === 'mT' ? 1e3 : 1
  const rows = [
    {
      step: 0,
      values: [
        '主绕组',
        fmtFluidValue(reading.turns, 4),
        fmtFluidValue(reading.coilLength * 100, 4),
        fmtFluidValue(reading.field * factor, 4),
      ],
    },
  ]
  if (reading.comparisonTurns !== undefined && reading.comparisonField !== undefined) {
    rows.push({
      step: 1,
      values: [
        '对比绕组',
        fmtFluidValue(reading.comparisonTurns, 4),
        fmtFluidValue(reading.coilLength * 100, 4),
        fmtFluidValue(reading.comparisonField * factor, 4),
      ],
    })
  }
  rows.push({
    step: 2,
    values: ['管口', '—', '—', fmtFluidValue(reading.endField * factor, 4)],
  })
  return {
    columns: ['绕组', 'N', 'L / cm', `B / ${unit}`],
    rows,
  }
}

/**
 * The current workspace runtime helper `createCurrentWorkspaceRuntime`.
 * @returns the workspace runtime.
 * @param scene - the physics scene.
 */
export const createCurrentWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new CurrentWorkspaceRuntime(scene)
