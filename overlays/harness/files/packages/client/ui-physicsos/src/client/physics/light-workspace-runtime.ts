/**
 * Pinhole rig → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + LightEngine for a pure light-propagation scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape. Parameter edits
 * (物高 / 物距 / 屏距) go through real scene commands, so a change is an auditable
 * revision bump rather than local component state.
 *
 * There is NO timeline: the object, the hole and the screen do not move, so the
 * image is the same at every instant and the clock says so with `total: 0`.
 */

import {
  LightEngine,
  createLightSimulationRequest,
  pinholeReadingOf,
  refractionReadingOf,
  resolveLightModel,
  type ResolvedLightModel,
} from '@physicsos/engine-optics'
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

import { lightObservableKeyOf, lightRigText, lightSceneVisual } from './light-visual-bridge.ts'
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

const OBSERVABLE_LABELS: Record<'rays' | 'image', string> = {
  rays: '过孔的两条光线',
  image: '屏上的像',
}

const DERIVED_LABELS: Record<string, string> = {
  object_height: '物高 h',
  object_distance: '物距 u',
  screen_distance: '像距 v',
  magnification: '放大率 m = v/u',
  image_height: '像高 h′',
  inverted: '是否倒立',
}

const VERIFICATION_LABELS: Record<string, string> = {
  image_from_straight_rays: '光的直线传播：像点落在物点过孔的直线上，h′ = h·v/u',
  image_is_inverted: '小孔成的像一定是倒立的',
  image_scales_with_both_distances: '像的大小由 v/u 决定：屏越远像越大、物越远像越小',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  light_bench_dimensions: '光具台量纲正确',
  light_bench_values: '光具台数值有效（物高与两个距离都 > 0）',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

const cmText = (metres: number): string => `${fmtFluidValue(metres * 100, 4)} cm`

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedLightModel
}

/**
 * The light workspace runtime — see the module doc for its role.
 */
export class LightWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new LightEngine()
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
        createLightSimulationRequest(
          scene,
          `light-lab-${String(scene.id)}-${scene.revision}`,
          `light-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      this.failure = undefined
      this.computed = { simulation, model: resolveLightModel(scene) }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '光的直线传播 Runtime 无法启动。'
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
        commandId: `light-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `light-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '光的直线传播'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'optics',
        title,
        subtitle: scene.metadata.description ?? '真实光传播 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('optics'),
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
          code: 'LIGHT_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Light Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const view = lightSceneVisual({ scene, model })
    const status = runtimeStatusOf(simulation.verification)

    return {
      domain: 'optics',
      title,
      subtitle: scene.metadata.description ?? '真实光传播 Runtime',
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
        const key = lightObservableKeyOf(definition)
        if (key === undefined) return []
        const subKey = key === 'lightRays' ? 'rays' : 'image'
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
        label: lightRigText(),
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: 'light-bench',
            label: '小孔、物与屏',
            secondary: '光的直线传播',
            icon: 'ground' as const,
            kind: 'object' as const,
          },
        ],
      },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(model: ResolvedLightModel | undefined): readonly InspectorSection[] {
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
    /* The three textbook layouts, one tap apart: the image smaller than the
       object, the same size, and larger — which is the whole of h′ = h·v/u. */
    if (id === 'pinhole-layout' && model.type === 'pinhole') {
      const layout = PINHOLE_LAYOUTS[value]
      if (layout !== undefined && Math.abs(layout - model.screenDistance) > 1e-9) {
        this.command('SetScreenDistance', {
          benchId: model.benchId,
          distance: quantity(layout * 100, 'cm', 'length'),
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => lightObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  /* The apparatus does not move: there is no clock to start, stop or scrub. */
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

/** Screen distances (m) for the three layouts the switch offers. */
const PINHOLE_LAYOUTS: Readonly<Record<string, number>> = {
  smaller: 0.15,
  same: 0.3,
  larger: 0.45,
}

/* -------------------------------------------------------------- inspector -- */

const parametersOf = (model: ResolvedLightModel): InspectorSection => {
  if (model.type === 'total_reflection') {
    const reading = refractionReadingOf(model)
    return {
      id: 'light-parameters',
      title: '介质与入射角',
      parameters: [
        {
          id: 'incident-index',
          label: '入射介质折射率',
          symbol: 'n₁',
          unit: '',
          value: reading.incidentIndex,
          min: 1,
          max: 2.5,
          step: 0.05,
        },
        {
          id: 'refracted-index',
          label: '折射介质折射率',
          symbol: 'n₂',
          unit: '',
          value: reading.refractedIndex,
          min: 0.5,
          max: 2.5,
          step: 0.05,
        },
        {
          id: 'incident-angle',
          label: '入射角',
          symbol: 'θ₁',
          unit: '°',
          value: (reading.incidentAngle * 180) / Math.PI,
          min: 0,
          max: 85,
          step: 1,
        },
      ],
      choices: [
        {
          id: 'refraction-angle',
          label: '入射角',
          value:
            reading.criticalAngle !== undefined &&
            Math.abs(reading.incidentAngle - reading.criticalAngle) < 1e-9
              ? 'critical'
              : reading.totalInternalReflection
                ? 'past'
                : 'under',
          options: [
            { value: 'under', label: '小于临界角：有折射光线' },
            { value: 'critical', label: '正好临界角：折射角 90°' },
            { value: 'past', label: '超过临界角：全反射' },
          ],
        },
      ],
    }
  }
  const reading = pinholeReadingOf(model)
  return {
    id: 'light-parameters',
    title: '小孔与屏',
    parameters: [
      {
        id: 'object-height',
        label: '物高',
        symbol: 'h',
        unit: 'cm',
        value: reading.objectHeight * 100,
        min: 1,
        max: 40,
        step: 0.5,
      },
      {
        id: 'object-distance',
        label: '物距',
        symbol: 'u',
        unit: 'cm',
        value: reading.objectDistance * 100,
        min: 5,
        max: 150,
        step: 5,
      },
      {
        id: 'screen-distance',
        label: '像距',
        symbol: 'v',
        unit: 'cm',
        value: reading.screenDistance * 100,
        min: 5,
        max: 150,
        step: 5,
      },
    ],
    choices: [
      {
        id: 'pinhole-layout',
        label: '屏的位置',
        value:
          Math.abs(reading.screenDistance - reading.objectDistance) < 1e-9
            ? 'same'
            : reading.screenDistance < reading.objectDistance
              ? 'smaller'
              : 'larger',
        options: [
          { value: 'smaller', label: 'v < u：缩小的像' },
          { value: 'same', label: 'v = u：等大的像' },
          { value: 'larger', label: 'v > u：放大的像' },
        ],
      },
    ],
  }
}

const PARAMETER_COMMANDS: readonly [
  string,
  (
    model: ResolvedLightModel,
    value: number,
  ) => { type: SceneCommandType; payload: SceneCommandPayloadMap[SceneCommandType] } | undefined,
][] = [
  [
    'object-height',
    (model, value) => ({
      type: 'SetObjectHeight',
      payload: { benchId: model.benchId, height: quantity(value, 'cm', 'length') },
    }),
  ],
  [
    'object-distance',
    (model, value) => ({
      type: 'SetObjectDistance',
      payload: { benchId: model.benchId, distance: quantity(value, 'cm', 'length') },
    }),
  ],
  [
    'screen-distance',
    (model, value) =>
      model.type === 'pinhole'
        ? {
          type: 'SetScreenDistance',
          payload: { benchId: model.benchId, distance: quantity(value, 'cm', 'length') },
        }
        : undefined,
  ],
  [
    'incident-index',
    (model, value) => ({
      type: 'SetIncidentIndex',
      payload: { benchId: model.benchId, index: quantity(value, '', 'dimensionless') },
    }),
  ],
  [
    'refracted-index',
    (model, value) => ({
      type: 'SetRefractedIndex',
      payload: { benchId: model.benchId, index: quantity(value, '', 'dimensionless') },
    }),
  ],
  [
    'incident-angle',
    (model, value) => ({
      type: 'SetIncidentAngle',
      payload: { benchId: model.benchId, angle: quantity(value, 'deg', 'angle') },
    }),
  ],
]

const derivedSectionOf = (
  computed: Computed | undefined,
  model: ResolvedLightModel,
): InspectorSection => {
  const refraction = model.type === 'total_reflection' ? refractionReadingOf(model) : undefined
  const reading = model.type === 'pinhole' ? pinholeReadingOf(model) : undefined
  const readings: DerivedQuantityView[] = [
    {
      id: 'instrument-reading',
      label: '仪器读数',
      symbol: '',
      value:
        refraction === undefined || reading !== undefined
          ? `${cmText(reading?.objectHeight ?? 0)} → ${cmText(reading?.imageHeight ?? 0)}（倒立）`
          : refraction.totalInternalReflection
            ? `全反射（θ₁ = ${fmtFluidValue((refraction.incidentAngle * 180) / Math.PI, 4)}° > θ_c）`
            : `θ₂ = ${fmtFluidValue(((refraction.refractedAngle ?? 0) * 180) / Math.PI, 4)}°`,
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
  return { id: 'light-derived', title: '读数', derived: [...readings, ...derived] }
}

const tableOf = (model: ResolvedLightModel): DataTableView => {
  const number = (value: number) => fmtFluidValue(value, 4)
  if (model.type === 'total_reflection') {
    const reading = refractionReadingOf(model)
    const degrees = (radians: number) => number((radians * 180) / Math.PI)
    return {
      columns: ['量', '符号', '数值'],
      rows: [
        { step: 0, values: ['入射介质折射率', 'n₁', number(reading.incidentIndex)] },
        { step: 1, values: ['折射介质折射率', 'n₂', number(reading.refractedIndex)] },
        { step: 2, values: ['入射角 / °', 'θ₁', degrees(reading.incidentAngle)] },
        {
          step: 3,
          values: [
            '临界角 / °',
            'θ_c',
            reading.criticalAngle === undefined ? '不存在（光疏→光密）' : degrees(reading.criticalAngle),
          ],
        },
        {
          step: 4,
          values: [
            '折射角 / °',
            'θ₂',
            reading.refractedAngle === undefined ? '全反射，无折射光线' : degrees(reading.refractedAngle),
          ],
        },
      ],
    }
  }
  const reading = pinholeReadingOf(model)
  return {
    columns: ['量', '符号', '数值 / cm'],
    rows: [
      { step: 0, values: ['物高', 'h', number(reading.objectHeight * 100)] },
      { step: 1, values: ['物距', 'u', number(reading.objectDistance * 100)] },
      { step: 2, values: ['像距', 'v', number(reading.screenDistance * 100)] },
      { step: 3, values: ['像高', 'h′', number(reading.imageHeight * 100)] },
      { step: 4, values: ['放大率', 'v/u', number(reading.magnification)] },
    ],
  }
}

/**
 * The light workspace runtime helper `createLightWorkspaceRuntime`.
 * @returns the workspace runtime.
 * @param scene - the physics scene.
 */
export const createLightWorkspaceRuntime = (scene: PhysicsScene): WorkspaceRuntime =>
  new LightWorkspaceRuntime(scene)
