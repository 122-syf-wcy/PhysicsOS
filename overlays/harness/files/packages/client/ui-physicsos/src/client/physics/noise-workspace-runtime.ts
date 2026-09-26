/**
 * Noise rig → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + NoiseEngine for a pure noise scene and reports frames
 * in the shared {@link WorkspaceSnapshot} shape. Parameter edits (声源功率级 /
 * 听者距离 / 屏障隔声量) go through real scene commands, so a change is an
 * auditable revision bump rather than local component state.
 *
 * There is NO timeline: the source is steady, so the meter reads the same at
 * every instant and the clock says `total: 0`.
 */

import {
  NoiseEngine,
  createNoiseSimulationRequest,
  noiseReadingOf,
  resolveNoiseModel,
  type ResolvedNoiseModel,
} from '@physicsos/engine-acoustics'
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
import { noiseObservableKeyOf, noiseRigText, noiseSceneVisual } from './noise-visual-bridge.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<'level' | 'spreading', string> = {
  level: '声级计读数',
  spreading: '声波面与距离',
}

const DERIVED_LABELS: Record<string, string> = {
  sound_power_level: '声源功率级 Lw',
  listener_distance: '听者距离 r',
  spreading_loss: '距离衰减',
  barrier_attenuation: '屏障隔声量 A',
  sound_level: '听者处声级 L',
  sound_intensity: '听者处声强 I',
  level_without_barrier: '无屏障时的声级',
}

const VERIFICATION_LABELS: Record<string, string> = {
  level_from_intensity: '声级的两个算法一致（Lw 与距离 / 先算 I 再取对数）',
  doubling_distance_costs_six_decibels: '距离加倍少 6 dB（r 变 10 倍少 20 dB）',
  barrier_is_an_independent_subtraction: '屏障是独立的减法，与距离衰减互不影响',
  decibels_are_a_ratio_not_a_difference: 'dB 是对数：少 6 dB 是声强只剩四分之一',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  noise_bench_dimensions: '实验台量纲正确',
  noise_bench_values: '实验台数值有效（距离 > 0，隔声量 ≥ 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Barriers a lab actually has, as measured insertion losses (dB). */
const BARRIERS: Readonly<Record<string, number>> = {
  none: 0,
  glass: 15,
  wall: 30,
  double: 45,
}

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedNoiseModel
}

/**
 * The noise workspace runtime — see the module doc for its role.
 */
export class NoiseWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new NoiseEngine()
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
        createNoiseSimulationRequest(
          scene,
          `noise-lab-${String(scene.id)}-${scene.revision}`,
          `noise-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveNoiseModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '噪声 Runtime 无法启动。'
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
        commandId: `noise-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `noise-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '噪声'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'acoustics',
        title,
        subtitle: scene.metadata.description ?? '真实噪声 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('acoustics'),
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
          code: 'NOISE_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Noise Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const view = noiseSceneVisual({ scene, model })
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'acoustics',
      title,
      subtitle: scene.metadata.description ?? '真实噪声 Runtime',
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
        const key = noiseObservableKeyOf(definition)
        if (key === undefined) return []
        const subKey = key === 'thermometer' ? 'level' : 'spreading'
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
        label: noiseRigText(),
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: 'noise-bench',
            label: '声源、听者与屏障',
            secondary: '点声源声级',
            icon: 'ground' as const,
            kind: 'object' as const,
          },
        ],
      },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(model: ResolvedNoiseModel | undefined): readonly InspectorSection[] {
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
    /* 加一道屏障: the 控制噪声 pathway, one tap from no wall to a wall. */
    if (id === 'barrier') {
      const attenuation = BARRIERS[value]
      if (attenuation !== undefined && Math.abs(attenuation - model.barrierAttenuation) > 1e-9) {
        this.command('SetBarrierAttenuation', {
          benchId: model.benchId,
          attenuation: quantity(attenuation, '', 'dimensionless'),
        })
      }
    }
    /* 退后一步: doubling the distance, which is worth 6 dB. */
    if (id === 'listener-step') {
      const target = value === 'near' ? 1 : value === 'double' ? 2 : value === 'far' ? 8 : model.distance
      if (Math.abs(target - model.distance) > 1e-9) {
        this.command('SetListenerDistance', {
          benchId: model.benchId,
          distance: quantity(target, 'm', 'length'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => noiseObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The source is steady: there is no clock to start, stop or scrub. */
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

const parametersOf = (model: ResolvedNoiseModel): InspectorSection => {
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)
  return {
    id: 'noise-parameters',
    title: '声源、听者与屏障',
    parameters: [
      {
        id: 'noise-source-level',
        label: '声源功率级',
        symbol: 'Lw',
        unit: 'dB',
        value: reading.soundPowerLevel,
        min: 40,
        max: 140,
        step: 5,
      },
      {
        id: 'listener-distance',
        label: '听者距离',
        symbol: 'r',
        unit: 'm',
        value: reading.distance,
        min: 0.5,
        max: 32,
        step: 0.5,
      },
      {
        id: 'barrier-attenuation',
        label: '屏障隔声量',
        symbol: 'A',
        unit: 'dB',
        value: reading.barrierAttenuation,
        min: 0,
        max: 60,
        step: 5,
      },
    ],
    choices: [
      {
        id: 'barrier',
        label: '屏障',
        value:
          Object.entries(BARRIERS).find(
            ([, value]) => Math.abs(value - reading.barrierAttenuation) < 1e-9,
          )?.[0] ?? 'custom',
        options: [
          { value: 'none', label: '没有屏障（对照组）' },
          { value: 'glass', label: '单层玻璃（15 dB）' },
          { value: 'wall', label: '砖墙（30 dB）' },
          { value: 'double', label: '双层隔声（45 dB）' },
          { value: 'custom', label: '自定义' },
        ],
      },
      {
        id: 'listener-step',
        label: '听者位置',
        value: reading.distance === 1 ? 'near' : reading.distance === 2 ? 'double' : reading.distance === 8 ? 'far' : 'custom',
        options: [
          { value: 'near', label: '1 m 处' },
          { value: 'double', label: '退到 2 m（距离加倍）' },
          { value: 'far', label: '退到 8 m（8 倍）' },
          { value: 'custom', label: '自定义' },
        ],
      },
    ],
  }
}

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedNoiseModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'noise-source-level',
    (model, value) => ({
      type: 'SetNoiseSourceLevel',
      payload: { benchId: model.benchId, level: quantity(value, '', 'dimensionless') },
    }),
  ],
  [
    'listener-distance',
    (model, value) => ({
      type: 'SetListenerDistance',
      payload: { benchId: model.benchId, distance: quantity(value, 'm', 'length') },
    }),
  ],
  [
    'barrier-attenuation',
    (model, value) => ({
      type: 'SetBarrierAttenuation',
      payload: { benchId: model.benchId, attenuation: quantity(value, '', 'dimensionless') },
    }),
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedNoiseModel,
): InspectorSection => {
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value: `L = ${fmtFluidValue(reading.level, 4)} dB`,
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
  return { id: 'noise-derived', title: '读数', derived: [...readings, ...derived] }
}

/**
 * The table IS the 6 dB rule: the same source at doubling distances, with the
 * falling level in one column and the falling INTENSITY in the next — which is
 * where "6 dB is a quarter" stops being a slogan and becomes two columns that
 * disagree by a factor of four.
 */
const tableOf = (model: ResolvedNoiseModel): DataTableView => {
  const number = (value: number) => fmtFluidValue(value, 4)
  const at = (distance: number) => noiseReadingOf(model.soundPowerLevel, distance, model.barrierAttenuation)
  const base = at(model.distance)
  return {
    columns: ['距离 / m', '声级 / dB', '比最近处低 / dB', '声强 / W·m⁻²'],
    rows: [1, 2, 4, 8].map((multiple, index) => {
      const distance = model.distance * multiple
      const reading = at(distance)
      return {
        step: index,
        values: [
          number(distance),
          number(reading.level),
          index === 0 ? '0' : number(base.level - reading.level),
          reading.intensity.toExponential(3),
        ],
      }
    }),
  }
}

/**
 * The noise workspace runtime helper `createNoiseWorkspaceRuntime`.
 * @returns the workspace runtime.
 * @param scene - the physics scene.
 */
export const createNoiseWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new NoiseWorkspaceRuntime(scene)
