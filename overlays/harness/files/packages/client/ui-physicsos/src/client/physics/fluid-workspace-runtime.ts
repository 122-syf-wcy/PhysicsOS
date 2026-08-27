/**
 * Fluid statics → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + FluidEngine for a pure single-tank buoyancy scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the fluid
 * domain renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas`
 * as every other domain. Parameter edits (液体密度 / 物块质量) go through real
 * scene commands, so a change is an auditable revision bump rather than local
 * component state.
 *
 * Lowering the block HAS a real timeline: the hook descends at a steady rate
 * and the run ends when the block settles, so playback is genuine — the clock
 * advances scene seconds and every frame is the closed-form immersion state at
 * that instant. No physics is computed here; the reading comes from the
 * engine's verified solution.
 */

import {
  FluidEngine,
  createFluidSimulationRequest,
  equilibriumOf,
  immersionStateAt,
  resolveBuoyancy,
  type ResolvedFluidModel,
} from '@physicsos/engine-fluid'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  fluidTankOf,
  type FluidTank,
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
  fluidObservableKeyOf,
  fluidSceneVisual,
  fmtFluidValue,
  immersionPhaseText,
} from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ChartSeries,
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<string, string> = {
  forces: '受力分析',
  displaced: '液面与排开体积',
}

const DERIVED_LABELS: Record<string, string> = {
  block_weight: '物重 G',
  block_density: '物块密度 ρ_物',
  liquid_density: '液体密度 ρ_液',
  displaced_volume: '排开液体体积 V_排',
  displaced_weight: '排开液体所受重力 G_排',
  buoyant_force: '浮力 F_浮',
  scale_reading: '测力计读数 F_示',
}

/**
 * Verification labels. The engine folds the scene checks in (per-target ids
 * like `fluid_tank_values:fluid-tank-1`), so labels resolve by prefix.
 */
const VERIFICATION_LABELS: Record<string, string> = {
  archimedes_principle: '阿基米德原理 F_浮 = ρ_液·g·V_排',
  scale_reading_balance: '称重法自洽：F_示 + F_浮 = G',
  buoyancy_depth_independent: '浮力与深度无关',
  float_equilibrium: '漂浮平衡：F_浮 = G',
  scene_schema_version: '场景结构有效',
  scene_revision_valid: '场景修订有效',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率有效',
  timeline_dimensions_valid: '时间线量纲正确',
  fluid_tank_dimensions: '实验台量纲正确',
  fluid_tank_values: '质量 · 体积 · 密度均为正',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ?? VERIFICATION_LABELS[id.split(':')[0] ?? ''] ?? id

const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

/** Timeline markers for the engine events, in the shell's own kinds. */
const EVENT_VIEW: Record<string, { label: string; kind: TimelineEvent['kind'] }> = {
  BlockEntersLiquid: { label: '底面接触液面', kind: 'launch' },
  BlockFullySubmerged: { label: '完全浸没', kind: 'apex' },
  BlockFloats: { label: '漂浮平衡', kind: 'apex' },
  DescentComplete: { label: '下放结束', kind: 'impact' },
}

/** Liquid presets for the one-tap 换液体 switch; the numeric field stays free. */
const LIQUID_DENSITIES: Record<string, number> = {
  water: 1000,
  brine: 1100,
  alcohol: 800,
}

interface Computed {
  readonly simulation: SimulationResult
  readonly model: ResolvedFluidModel
}

export class FluidWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new FluidEngine()
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
        createFluidSimulationRequest(
          scene,
          `fluid-lab-${String(scene.id)}-${scene.revision}`,
          `fluid-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const model = resolveBuoyancy(scene)
      /* A parameter edit re-times the descent; clamp the clock into the new
         window so a floater does not park past the moment it settles. */
      this.currentTime = Math.min(this.currentTime, equilibriumOf(model).settleTime)
      this.failure = undefined
      this.computed = { simulation, model }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '浮力 Runtime 无法启动。'
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
        commandId: `fluid-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `fluid-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '浮力实验'
    const badge = branchBadgeOf(scene)
    const tank = fluidTankOf(scene)

    if (this.computed === undefined || tank === undefined) {
      return {
        domain: 'fluid',
        title,
        subtitle: scene.metadata.description ?? '真实浮力 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('fluid'),
        ariaLabel: title,
        tree: tank === undefined ? [] : this.treeOf(scene, tank),
        inspector: tank === undefined ? [] : this.inspectorOf(tank, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'FLUID_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Fluid Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, model } = this.computed
    const { settleTime } = equilibriumOf(model)
    const immersion = immersionStateAt(model, this.currentTime)
    const view = fluidSceneVisual({ scene, model, immersion, time: this.currentTime })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'fluid',
      title,
      subtitle: scene.metadata.description ?? '真实浮力 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, tank),
      inspector: this.inspectorOf(tank, model),
      charts: chartsOf(simulation, model),
      table: tableOf(simulation, model),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? fmtFluidValue(derived.value.value) : '—',
            unit: derived.value.unit,
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: simulation.events.flatMap((event) => {
        const viewOf = EVENT_VIEW[event.type]
        if (viewOf === undefined || typeof event.time !== 'number') return []
        return [{ id: String(event.eventId), time: event.time, label: viewOf.label, kind: viewOf.kind }]
      }),
      clock: {
        time: this.currentTime,
        total: settleTime,
        running: this.running,
        rate: this.rate,
      },
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

  private treeOf(scene: PhysicsScene, tank: FluidTank): readonly SceneTreeNode[] {
    const model = this.computed?.model
    const rigChildren: SceneTreeNode[] = [
      {
        id: tank.block.id,
        label: tank.block.name ?? '物块',
        secondary: model === undefined
          ? ''
          : `m = ${fmtFluidValue(model.blockMass * 1000)} g · V = ${fmtFluidValue(model.blockVolume * 1e6)} cm³`,
        icon: 'body' as const,
        kind: 'object' as const,
      },
      {
        id: tank.liquid.id,
        label: tank.liquid.name ?? '液体',
        secondary: model === undefined
          ? ''
          : `ρ = ${fmtFluidValue(model.liquidDensity)} kg/m³`,
        icon: 'field' as const,
        kind: 'object' as const,
      },
      {
        id: tank.id,
        label: '弹簧测力计',
        secondary: model === undefined
          ? ''
          : `${immersionStateAt(model, this.currentTime).scaleReading.toFixed(2)} N`,
        icon: 'ground' as const,
        kind: 'object' as const,
      },
    ]
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = fluidObservableKeyOf(definition)
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
      { id: 'rig', label: '浮力实验台', icon: 'folder', kind: 'group', children: rigChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    tank: FluidTank,
    model: ResolvedFluidModel | undefined,
  ): readonly InspectorSection[] {
    const sections: InspectorSection[] = []
    const liquidDensity = model?.liquidDensity ?? canonicalValue(tank.liquid.density)

    /* One-tap 换液体: the same block in water, brine or alcohol — the point of
       the lesson is that buoyancy belongs to the liquid. The numeric field
       stays for free-form densities; a non-preset density reads as 自定义. */
    const liquidValue =
      Object.entries(LIQUID_DENSITIES).find(
        ([, density]) => Math.abs(density - liquidDensity) < 1e-9,
      )?.[0] ?? 'custom'

    sections.push({
      id: 'rig',
      title: '浮力实验台',
      parameters: [
        {
          id: 'block-mass',
          label: '物块质量',
          symbol: 'm',
          unit: 'g',
          value: model === undefined
            ? Number.NaN
            : Number.parseFloat((model.blockMass * 1000).toFixed(2)),
          min: 1,
          step: 10,
          highlights: tank.block.id,
        },
        {
          id: 'liquid-density',
          label: '液体密度',
          symbol: 'ρ',
          unit: 'kg/m³',
          value: Number.parseFloat(liquidDensity.toFixed(2)),
          min: 1,
          step: 50,
          highlights: tank.liquid.id,
        },
      ],
      choices: [
        {
          id: 'liquid',
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
    })

    if (this.computed !== undefined && model !== undefined) {
      const derived: DerivedQuantityView[] = this.computed.simulation.derivedQuantities
        .filter(entry => isScalarQuantity(entry.value))
        .map(entry => ({
          id: entry.key,
          label: derivedLabelOf(entry.key),
          symbol: '',
          value: isScalarQuantity(entry.value) ? fmtFluidValue(entry.value.value) : '—',
          unit: entry.value.unit,
          ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
        }))
      /* The frame's own readings: where the block is right now, and whether it
         is heading for the bottom or for equilibrium. */
      const immersion = immersionStateAt(model, this.currentTime)
      derived.push({
        id: 'immersion-phase',
        label: '浸入状态',
        symbol: '',
        value: immersionPhaseText(immersion.phase),
        unit: '',
        highlights: model.blockId,
      })
      derived.push({
        id: 'sink-or-float',
        label: '浮沉判断',
        symbol: '',
        value:
          model.blockDensity > model.liquidDensity
            ? 'ρ_物 > ρ_液 · 下沉'
            : model.blockDensity < model.liquidDensity
              ? 'ρ_物 < ρ_液 · 漂浮'
              : 'ρ_物 = ρ_液 · 悬浮',
        unit: '',
        highlights: model.blockId,
      })
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const tank = fluidTankOf(scene)
    if (tank === undefined) return this.getSnapshot()

    if (id === 'block-mass') {
      this.command('SetBlockMass', { tankId: tank.id, mass: quantity(value, 'g', 'mass') })
    } else if (id === 'liquid-density') {
      this.command('SetLiquidDensity', {
        tankId: tank.id,
        density: quantity(value, 'kg/m^3', 'density'),
      })
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'liquid') {
      const density = LIQUID_DENSITIES[value]
      const tank = fluidTankOf(this.sceneRuntime.getScene())
      /* `custom` is a display state, not a command — the numeric field owns it. */
      if (density !== undefined && tank !== undefined) {
        if (Math.abs(canonicalValue(tank.liquid.density) - density) > 1e-9) {
          this.command('SetLiquidDensity', {
            tankId: tank.id,
            density: quantity(density, 'kg/m^3', 'density'),
          })
        }
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => fluidObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    /* Restarting the finished experiment lifts the block back out of the water. */
    if (running && this.computed !== undefined) {
      const { settleTime } = equilibriumOf(this.computed.model)
      if (this.currentTime >= settleTime) this.currentTime = 0
    }
    this.running = running
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const total = this.computed === undefined ? 0 : equilibriumOf(this.computed.model).settleTime
    this.currentTime = Number.isFinite(time) ? Math.min(total, Math.max(0, time)) : 0
    this.running = false
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    /* Lowering runs at human seconds, so wall time maps 1:1 onto scene time.
       The run stops where the block settles rather than looping: the steady
       reading IS the measurement. */
    if (this.running && this.computed !== undefined && Number.isFinite(wallClockSeconds)) {
      const { settleTime } = equilibriumOf(this.computed.model)
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= settleTime ? settleTime : next
      if (this.currentTime >= settleTime) this.running = false
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

/* -------------------------------------------------------------- projections -- */

/** Scale reading against depth — the curve that bends and then goes flat. */
const chartsOf = (
  simulation: SimulationResult,
  model: ResolvedFluidModel,
): readonly ChartSeries[] => {
  const points = simulation.states.flatMap((state) => {
    const tankValues = state.objects.find(object => object.id === model.tankId)?.values
    const reading = tankValues?.['scale_reading']
    if (reading === undefined || !isScalarQuantity(reading)) return []
    return [{ t: canonicalValue(state.time), value: reading.value }]
  })
  if (points.length === 0) return []
  return [{
    id: 'scale-reading',
    title: '测力计读数 F–t 图（浸入段下降，浸没后水平）',
    xLabel: 't / s',
    yLabel: 'F / N',
    role: 'trajectory',
    points,
  }]
}

/** Sampled readings across the descent: t, depth, V_排, F_浮, F_示. */
const tableOf = (
  simulation: SimulationResult,
  model: ResolvedFluidModel,
): DataTableView => {
  const stride = 8
  const rows = simulation.states.flatMap((state, index) => {
    if (index % stride !== 0 && index !== simulation.states.length - 1) return []
    const timeSeconds = canonicalValue(state.time)
    const immersion = immersionStateAt(model, timeSeconds)
    return [{
      step: index,
      values: [
        timeSeconds.toFixed(2),
        fmtFluidValue(immersion.depth * 100, 3),
        fmtFluidValue(immersion.displacedVolume * 1e6, 4),
        immersion.buoyantForce.toFixed(3),
        immersion.scaleReading.toFixed(3),
      ],
    }]
  })
  return {
    columns: ['t / s', '深度 / cm', 'V_排 / cm³', 'F_浮 / N', 'F_示 / N'],
    rows,
  }
}

export const createFluidWorkspaceRuntime = (scene: PhysicsScene): FluidWorkspaceRuntime =>
  new FluidWorkspaceRuntime(scene)
