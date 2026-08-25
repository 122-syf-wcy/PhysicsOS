/**
 * Electric → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + ElectricEngine for a uniform-field scene and reports
 * frames in the shared {@link WorkspaceSnapshot} shape, so the electric domain
 * renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas` as every
 * other domain. Parameter edits go through real scene commands, so a change is an
 * auditable revision bump rather than local component state.
 */

import {
  ElectricEngine,
  createElectricSimulationRequest,
  evaluateUniformElectricState,
  resolveUniformElectricModel,
} from '@physicsos/engine-electric'
import {
  createElectricRegionSimulationRequest,
  electricRegionEngine,
  resolveParallelPlateModel,
  type ParallelPlateModel,
} from '@physicsos/engine-electric-region'
import {
  derivedScalar,
  isQuantityVector,
  toCanonicalVector,
  type DerivedQuantity,
  type PhysicsEventLike,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { observeElectricScene } from '@physicsos/physics-observation'
import {
  SceneRuntime,
  createSceneCommand,
  fieldSamplePointOf,
  isParallelPlateScene,
  plateLengthOf,
  plateSeparationOf,
  probeParticleOf,
  sourceChargesOf,
  validateScene,
  type Boundary,
  type ElectricFieldDirection,
  type ObservableDefinition,
  type Particle,
  type PhysicsScene,
  type Region,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import { microWindowPhysicalDelta } from '../animation-clock.ts'
import { electricSampleReadout, electricSceneVisualAt } from './electric-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
  requiresExperimentalForkForFact,
} from './experimental-branch.ts'
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

const fmt = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(digits)
    : value.toFixed(digits)
}

const derivedText = (derived: DerivedQuantity): string =>
  isQuantityVector(derived.value)
    ? `(${fmt(toCanonicalVector(derived.value).vectorSI.x)}, ${fmt(toCanonicalVector(derived.value).vectorSI.y)})`
    : fmt(derived.value.value)

const derivedUnit = (derived: DerivedQuantity): string => derived.value.unit

const DERIVED_LABELS: Record<string, string> = {
  electric_force: '电场力',
  acceleration: '加速度',
  speed: '速率',
  kinetic_energy: '动能',
  work_done: '电场力做功',
  deflection: '偏转位移',
  exit_velocity: '出射速度',
  /* Point-charge model derived keys (point-charge-model.ts): the uniform-field
     labels above do not cover them, so without these entries the Inspector and
     the Agent's findDerived('电场强度'/'电场力') would fall back to the raw English
     key and the Agent would never find the facts it is supposed to cite. */
  electric_field_vector: '电场强度',
  electric_field_magnitude: '电场强度',
  electric_force_vector: '电场力',
  electric_force_magnitude: '电场力',
  potential: '电势',
  acceleration_vector: '加速度',
  /* Uniform-field kinematics keys (electric-engine.ts) that previously fell back
     to the raw English key. Giving them Chinese labels surfaces them in the
     Inspector in the same language as the rest, and lets the Agent's
     findDerived cite 位移 / 末速度 / 电场力做功 / 动能变化. */
  acceleration_magnitude: '加速度',
  displacement_vector: '位移',
  electric_potential_change: '电势变化',
  electric_potential_energy_change: '电势能变化',
  work_by_electric_field: '电场力做功',
  kinetic_energy_change: '动能变化',
  /* Bounded-field key (electric-region-engine.ts) that the uniform-field and
     point-charge labels do not cover. `exit_velocity` and `deflection` already
     have entries above. Kept clear of 速率 / 出射速度 / 位移 so the Agent's
     findDerived lookups keep resolving to the rows they were written against. */
  hit_velocity: '打板速度',
}

const OBSERVABLE_LABELS: Record<string, string> = {
  velocity: '速度',
  force: '电场力',
  trajectory: '运动轨迹',
  acceleration: '加速度',
}

const observableKeyOf = (definition: ObservableDefinition): ObservableKey | undefined => {
  if (definition.type === 'velocity') return 'velocity'
  if (definition.type === 'force') return 'forces'
  if (definition.type === 'trajectory') return 'trajectory'
  if (definition.type === 'acceleration') return 'acceleration'
  if (definition.type === 'electric_field') return 'electricField'
  return undefined
}

/**
 * Observable rows for the scene tree, shared by the uniform-field and the
 * parallel-plate trees so a toggle means the same thing in both.
 */
const observableTreeChildren = (scene: PhysicsScene): readonly SceneTreeNode[] =>
  scene.observableDefinitions.flatMap((definition) => {
    const key = observableKeyOf(definition)
    if (key === undefined) return []
    return [{
      id: String(definition.id),
      label: OBSERVABLE_LABELS[definition.type] ?? definition.type,
      icon: definition.type === 'velocity'
        ? 'velocity'
        : definition.type === 'force'
          ? 'force'
          : definition.type === 'trajectory'
            ? 'trajectory'
            : 'observable',
      kind: 'observable' as const,
      observable: key,
    }]
  })

const fieldDirectionOf = (scene: PhysicsScene): ElectricFieldDirection => {
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  if (field?.type !== 'uniform_electric') return 'up'
  const { x, y } = field.fieldStrength.vector
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'right' : 'left'
  return y >= 0 ? 'up' : 'down'
}

const DIRECTION_OPTIONS: readonly { value: ElectricFieldDirection; label: string }[] = [
  { value: 'right', label: '水平向右' },
  { value: 'left', label: '水平向左' },
  { value: 'up', label: '竖直向上' },
  { value: 'down', label: '竖直向下' },
]

interface Computed {
  readonly simulation: SimulationResult
  readonly state: SimulationState
  readonly startTime: number
  readonly endTime: number
}

const isPointChargeScene = (scene: PhysicsScene): boolean =>
  scene.fields.some(field => field.type === 'point_charge')

/* Whether the scene is a bounded (parallel-plate) field scene, routed to the
   Electric Region Engine instead of the unbounded ElectricEngine. */
const isRegionScene = (scene: PhysicsScene): boolean => isParallelPlateScene(scene)

export class ElectricWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new ElectricEngine()
  private currentTime = 0
  private rate = 1
  private running = false
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
      /* Parallel-plate (bounded field) scenes route to the Electric Region Engine,
         which is mutually exclusive with the unbounded ElectricEngine. */
      if (isRegionScene(scene)) {
        this.recomputeRegion(scene)
        return
      }
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const simulation = this.engine.simulate(
        scene,
        createElectricSimulationRequest(
          scene,
          `electric-lab-${String(scene.id)}-${scene.revision}`,
          `electric-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      if (isPointChargeScene(scene)) {
        /* Static world: one instantaneous state, no timeline to advance. */
        const state = simulation.states[0]
        if (state === undefined) {
          this.failure = '点电荷场景未产生仿真状态。'
          this.computed = undefined
          return
        }
        this.failure = undefined
        this.computed = { simulation, state, startTime: state.time.value, endTime: state.time.value }
        return
      }
      const startTime = simulation.states[0]?.time.value ?? 0
      const endTime = simulation.states.at(-1)?.time.value ?? 0
      if (this.currentTime > endTime) this.currentTime = endTime
      const model = resolveUniformElectricModel(scene)
      const state = evaluateUniformElectricState(
        model,
        Math.min(endTime, Math.max(startTime, this.currentTime)),
      )
      this.failure = undefined
      this.computed = { simulation, state, startTime, endTime }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '电场 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  /** Region-engine recompute: bounded (parallel-plate) uniform field scenes. */
  private recomputeRegion(scene: PhysicsScene): void {
    const support = electricRegionEngine.canHandle(scene)
    if (!support.supported) {
      this.failure = support.failedConditions.map(entry => entry.message).join(' ')
      this.computed = undefined
      return
    }
    const simulation = electricRegionEngine.simulate(
      scene,
      createElectricRegionSimulationRequest(
        scene,
        `electric-region-${String(scene.id)}-${scene.revision}`,
        `electric-region-trace-${String(scene.id)}-${scene.revision}`,
      ),
    )
    if (simulation.verification.status === 'failed') {
      this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
      this.computed = undefined
      return
    }
    const startTime = simulation.states[0]?.time.value ?? 0
    const endTime = simulation.states.at(-1)?.time.value ?? 0
    if (this.currentTime > endTime) this.currentTime = endTime
    const state = electricRegionEngine.stateAtSeconds(
      scene,
      Math.min(endTime, Math.max(startTime, this.currentTime)),
    )
    this.failure = undefined
    this.computed = { simulation, state, startTime, endTime }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the solution the
       student just read was verified against the original conditions. Playback,
       seeking and observable toggles are NOT facts and never fork (experimental-branch.ts). */
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
      this.currentTime = 0
      this.running = false
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    const result = this.sceneRuntime.execute(
      createSceneCommand<T>({
        commandId: `electric-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `electric-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    /* A parameter change makes the previous playhead physically meaningless. */
    this.currentTime = 0
    this.running = false
    this.recompute()
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const computed = this.computed
    const pointCharge = isPointChargeScene(scene)
    const region = isRegionScene(scene)
    const title = scene.metadata.title ?? (pointCharge ? '点电荷电场' : region ? '平行板电场中的带电粒子' : '匀强电场中的带电粒子')
    const badge = branchBadgeOf(scene)

    if (computed === undefined) {
      return {
        domain: 'electric',
        title,
        subtitle: '真实电场 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('electric'),
        ariaLabel: title,
        tree: this.treeOf(scene),
        inspector: this.inspectorOf(scene, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'ELECTRIC_RUNTIME_FAILED',
          message: this.failure ?? '当前电场场景不满足 V1 电场模型的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, state, endTime } = computed
    const observations = observeElectricScene({ scene, simulation, state })
    const view = electricSceneVisualAt({
      scene,
      simulation,
      observations: observations.observations,
      state,
    })
    const status =
      simulation.verification.status === 'passed_with_warnings' ? 'warning' : 'verified'

    if (pointCharge) {
      /* Point-charge world is instantaneous: no trajectory, so charts/table sample a
         single point and hover/seek are inert. */
      const sources = sourceChargesOf(scene.particles, scene.fields)
      const probe = probeParticleOf(scene.particles, scene.fields)
      const tree = this.treeOf(scene)
      const inspector = this.inspectorOf(scene, simulation)
      return {
        domain: 'electric',
        title,
        subtitle: scene.metadata.description ?? '真实电场 Runtime',
        status,
        sceneRevision: scene.revision,
        view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
        ariaLabel: `${title}的可验证物理画布`,
        tree,
        inspector,
        charts: pointChargeChartsOf(simulation, sources, probe),
        table: pointChargeTableOf(simulation, sources, probe),
        derivation: simulation.derivedQuantities
          .filter(derived => derived.formula !== undefined || derived.targetId !== undefined)
          .map(derived => ({
            id: derived.key,
            title: DERIVED_LABELS[derived.key] ?? derived.key,
            expression: derived.formula?.expression ?? '',
            result: {
              symbol: DERIVED_LABELS[derived.key] ?? derived.key,
              value: derivedText(derived),
              unit: derivedUnit(derived),
            },
          })),
        verification: verificationOf(simulation, true),
        events: [],
        clock: { time: state.time.value, total: endTime, running: false, rate: this.rate },
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

    const particle = scene.particles[0]
    if (particle === undefined) {
      return {
        domain: 'electric',
        title,
        subtitle: '真实电场 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('electric'),
        ariaLabel: title,
        tree: this.treeOf(scene),
        inspector: this.inspectorOf(scene, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'ELECTRIC_RUNTIME_FAILED',
          message: '当前电场场景缺少带电粒子。',
          retryable: false,
        },
      }
    }

    return {
      domain: 'electric',
      title,
      subtitle: scene.metadata.description ?? '真实电场 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene),
      inspector: this.inspectorOf(scene, simulation, state),
      charts: chartsOf(simulation, particle.id),
      table: tableOf(simulation, particle.id),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined)
        .map(derived => ({
          id: derived.key,
          title: DERIVED_LABELS[derived.key] ?? derived.key,
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: DERIVED_LABELS[derived.key] ?? derived.key,
            value: derivedText(derived),
            unit: derivedUnit(derived),
          },
        })),
      verification: verificationOf(simulation, false),
      events: region ? regionEventsOf(simulation, scene) : [],
      clock: { time: this.currentTime, total: endTime, running: this.running, rate: this.rate },
      trajectoryTimes: simulation.states.map(sample => sample.time.value),
      sampleReadout: index => electricSampleReadout(simulation, particle.id, index),
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
    if (isPointChargeScene(scene)) return pointChargeTreeOf(scene)
    if (isRegionScene(scene)) return regionTreeOf(scene)
    const particle = scene.particles[0]
    const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
    const speed =
      particle === undefined
        ? 0
        : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
    return [
      {
        id: 'scene',
        label: '场景',
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: particle?.id ?? 'particle',
            label: (particle?.charge?.value ?? 0) >= 0 ? '正电粒子' : '负电粒子',
            secondary: particle?.charge === undefined ? '—' : `${particle.charge.value.toExponential(2)} C`,
            icon: 'particle',
            kind: 'object',
          },
          {
            id: field?.id ?? 'field',
            label: '匀强电场',
            secondary:
              field?.type === 'uniform_electric'
                ? `${fmt(Math.hypot(field.fieldStrength.vector.x, field.fieldStrength.vector.y))} V/m`
                : '—',
            icon: 'field',
            kind: 'object',
          },
        ],
      },
      {
        id: 'initial',
        label: '初始条件',
        icon: 'folder',
        kind: 'group',
        children: [
          { id: 'init-velocity', label: '初速度', secondary: `${fmt(speed)} m/s`, icon: 'velocity', kind: 'object' },
        ],
      },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: observableTreeChildren(scene),
      },
    ]
  }

  private inspectorOf(
    scene: PhysicsScene,
    simulation: SimulationResult | undefined,
    state?: SimulationState,
  ): readonly InspectorSection[] {
    if (isPointChargeScene(scene)) return pointChargeInspectorOf(scene, simulation)
    if (isRegionScene(scene)) return regionInspectorOf(scene, simulation, state)
    const particle = scene.particles[0]
    const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
    const speed =
      particle === undefined
        ? 0
        : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
    const strength =
      field?.type === 'uniform_electric'
        ? Math.hypot(field.fieldStrength.vector.x, field.fieldStrength.vector.y)
        : 0
    const derived: DerivedQuantityView[] = (simulation?.derivedQuantities ?? []).map(entry => ({
      id: entry.key,
      label: DERIVED_LABELS[entry.key] ?? entry.key,
      symbol: '',
      value: derivedText(entry),
      unit: derivedUnit(entry),
    }))
    return [
      {
        id: 'particle',
        title: '粒子属性',
        parameters: [
          { id: 'q', label: '电荷量', symbol: 'q', unit: 'C', value: particle?.charge?.value ?? 0, step: 1e-19, highlights: 'electric-force' },
          { id: 'm', label: '质量', symbol: 'm', unit: 'kg', value: particle?.mass.value ?? 0, min: 1e-32, step: 1e-27 },
          { id: 'v0', label: '初速度', symbol: 'v_0', unit: 'm/s', value: speed, min: 0, step: 1e5, highlights: 'velocity' },
        ],
      },
      {
        id: 'field',
        title: '电场',
        parameters: [
          { id: 'E', label: '场强', symbol: 'E', unit: 'V/m', value: strength, min: 0, step: 100, highlights: 'electric-force' },
        ],
        choices: [
          {
            id: 'direction',
            label: '电场方向',
            value: fieldDirectionOf(scene),
            options: DIRECTION_OPTIONS.map(option => ({ value: option.value, label: option.label })),
          },
        ],
      },
      { id: 'derived', title: '派生量', derived },
    ]
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    /* Point-charge parameters use the particle id directly for the source charge
       and `probe-q`/`probe-m` for the probe. They must not fall through to the
       uniform-field branch below, which assumes a single particle `q`/`m`/`v0`. */
    if (isPointChargeScene(scene)) {
      const sources = sourceChargesOf(scene.particles, scene.fields)
      const probe = probeParticleOf(scene.particles, scene.fields)
      if (sources.some(source => source.id === id)) {
        this.command('SetParticleCharge', {
          particleId: id,
          charge: { value, unit: 'C', dimension: 'electric_charge' },
        })
      } else if (id === 'probe-q' && probe !== undefined) {
        this.command('SetParticleCharge', {
          particleId: probe.id,
          charge: { value, unit: 'C', dimension: 'electric_charge' },
        })
      } else if (id === 'probe-m' && probe !== undefined) {
        this.command('SetParticleMass', {
          particleId: probe.id,
          mass: { value, unit: 'kg', dimension: 'mass' },
        })
      }
      return this.getSnapshot()
    }
    const particle = scene.particles[0]
    const particleId = particle?.id ?? 'particle-1'
    const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
    /* Parallel-plate rows carry semantic ids and add the two plate-geometry
       parameters, so they cannot share the uniform field's short `q`/`m`/`v0`/`E`
       ladder below. */
    if (isRegionScene(scene)) {
      if (id === 'particleCharge') {
        this.command('SetParticleCharge', {
          particleId,
          charge: { value, unit: 'C', dimension: 'electric_charge' },
        })
      } else if (id === 'particleMass') {
        this.command('SetParticleMass', { particleId, mass: { value, unit: 'kg', dimension: 'mass' } })
      } else if (id === 'initialSpeed') {
        this.command('SetParticleVelocity', {
          particleId,
          velocity: velocityAtSpeed(particle?.velocity.vector, value),
        })
      } else if (id === 'electricFieldStrength') {
        this.command('SetElectricFieldStrength', {
          fieldId: field?.id ?? 'parallel-plate-field-1',
          strength: { value, unit: 'V/m', dimension: 'electric_field' },
        })
      } else if (id === 'plateSeparation') {
        this.setPlateGeometry({ plateSeparation: value })
      } else if (id === 'plateLength') {
        this.setPlateGeometry({ plateLength: value })
      }
      return this.getSnapshot()
    }
    if (id === 'q') {
      this.command('SetParticleCharge', {
        particleId,
        charge: { value, unit: 'C', dimension: 'electric_charge' },
      })
    } else if (id === 'm') {
      this.command('SetParticleMass', { particleId, mass: { value, unit: 'kg', dimension: 'mass' } })
    } else if (id === 'v0') {
      this.command('SetParticleVelocity', {
        particleId,
        velocity: velocityAtSpeed(particle?.velocity.vector, value),
      })
    } else if (id === 'E') {
      this.command('SetElectricFieldStrength', {
        fieldId: field?.id ?? 'electric-field-1',
        strength: { value, unit: 'V/m', dimension: 'electric_field' },
      })
    }
    return this.getSnapshot()
  }

  /**
   * Rewrite the plate geometry (gap height / plate length) as the next revision.
   *
   * Plate geometry has no SceneCommand of its own — the command vocabulary is
   * frozen (docs/03 §69) and only names particle, field and body facts — so the
   * geometry is rewritten on a cloned scene instead of dispatched. It still gets
   * everything a command would give it, because the geometry IS a physical fact:
   * the same experimental-fork policy, a revision bump, `validateScene`, and a
   * fresh Region-Engine simulate + verify through {@link recompute}. The one thing
   * it does not produce is a PhysicsEvent in the scene's own event log; making
   * plate edits fully auditable needs `SetPlateSeparation`/`SetPlateLength` added
   * to the frozen command set, which is a spec decision, not an adapter one.
   */
  private setPlateGeometry(next: { plateSeparation?: number; plateLength?: number }): void {
    const current = requiresExperimentalForkForFact(this.sceneRuntime.getScene())
      ? forkExperimentalScene({ scene: this.sceneRuntime.getScene() })
      : this.sceneRuntime.getScene()
    const region = current.regions[0]
    if (region === undefined || region.shape.type !== 'rectangle') {
      this.failure = '平行板场景缺少矩形场区，无法修改极板几何。'
      return
    }
    /* Everything below stays in the scene's own stated units: the region shape,
       its centre and the plate segments are all read and written raw, so no unit
       conversion can drift between the geometry and the plates. */
    const separation = next.plateSeparation ?? region.shape.height.value
    const length = next.plateLength ?? region.shape.width.value
    if (!(separation > 0) || !(length > 0) || !Number.isFinite(separation) || !Number.isFinite(length)) {
      this.failure = '板间距与板长必须为有限正数。'
      return
    }
    const center = region.center.vector
    const nextRegion: Region = {
      ...region,
      shape: {
        ...region.shape,
        width: { ...region.shape.width, value: length },
        height: { ...region.shape.height, value: separation },
      },
    }
    const nextScene: PhysicsScene = {
      ...current,
      revision: current.revision + 1,
      regions: [nextRegion, ...current.regions.slice(1)],
      boundaries: current.boundaries.map(boundary =>
        replatedBoundary(boundary, center, length, separation),
      ),
    }
    const validation = validateScene(nextScene)
    if (validation.status === 'failed') {
      this.failure = validation.errors.map(entry => entry.message).join(' ')
      return
    }
    this.sceneRuntime = new SceneRuntime(nextScene)
    this.currentTime = 0
    this.running = false
    this.recompute()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'direction') {
      const scene = this.sceneRuntime.getScene()
      const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
      this.command('SetElectricFieldDirection', {
        fieldId: field?.id ?? 'electric-field-1',
        direction: value as ElectricFieldDirection,
      })
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => observableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    this.running = running && (this.computed?.endTime ?? 0) > 0
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const end = this.computed?.endTime ?? 0
    this.currentTime = Number.isFinite(time) ? Math.min(end, Math.max(0, time)) : 0
    this.running = false
    this.recompute()
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    const end = this.computed?.endTime ?? 0
    if (this.running && Number.isFinite(wallClockSeconds) && end > 0) {
      /* An electron transits the plates in ~1e-8 s, so raw wall seconds would end
         the run inside the first frame. The wall→scene mapping paces the full
         window over MICRO_WINDOW_WALL_SECONDS — the same presentation-only scaling
         the magnetic runtime applies per period. */
      const next = this.currentTime + microWindowPhysicalDelta(wallClockSeconds, end) * this.rate
      this.currentTime = next >= end ? end : next
      if (this.currentTime >= end) this.running = false
      this.recompute()
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

const chartsOf = (simulation: SimulationResult, particleId: string): readonly ChartSeries[] => {
  const samples = simulation.states.map((sample) => {
    const object = sample.objects.find(candidate => candidate.id === particleId)
    const position = object?.position === undefined
      ? { x: 0, y: 0 }
      : toCanonicalVector(object.position).vectorSI
    return {
      t: sample.time.value,
      x: position.x,
      y: position.y,
      speed: safeScalar(sample, 'speed'),
      kinetic: safeScalar(sample, 'kinetic_energy'),
    }
  })
  const series = (
    id: string,
    title: string,
    yLabel: string,
    pick: (sample: (typeof samples)[number]) => number,
    role: ChartSeries['role'],
  ): ChartSeries => ({
    id,
    title,
    xLabel: 't / s',
    yLabel,
    role,
    points: samples.map(sample => ({ t: sample.t, value: pick(sample) })),
  })
  return [
    series('x-t', 'x - t', 'x / m', sample => sample.x, 'trajectory'),
    series('y-t', 'y - t', 'y / m', sample => sample.y, 'trajectory'),
    series('v-t', '|v| - t', 'v / (m/s)', sample => sample.speed, 'velocity'),
    series('ek-t', 'Eₖ - t', 'Eₖ / J', sample => sample.kinetic, 'force'),
  ]
}

const safeScalar = (state: SimulationState, key: string): number => {
  try {
    return derivedScalar(state.derived, key).value
  } catch {
    return Number.NaN
  }
}

const tableOf = (simulation: SimulationResult, particleId: string): DataTableView => {
  const stride = Math.max(1, Math.floor((simulation.states.length - 1) / 12))
  const rows = simulation.states
    .filter((_, index) => index % stride === 0 || index === simulation.states.length - 1)
    .map((sample, index) => {
      const object = sample.objects.find(candidate => candidate.id === particleId)
      const position = object?.position === undefined
        ? { x: 0, y: 0 }
        : toCanonicalVector(object.position).vectorSI
      return {
        step: index,
        values: [
          fmt(sample.time.value, 3),
          fmt(position.x),
          fmt(position.y),
          fmt(safeScalar(sample, 'speed')),
          fmt(safeScalar(sample, 'kinetic_energy')),
        ],
      }
    })
  return { columns: ['t / s', 'x / m', 'y / m', '|v|', 'Eₖ / J'], rows }
}

const VERIFICATION_LABELS: Record<string, string> = {
  electric_force_direction: '电场力方向与场强一致',
  work_energy_theorem: '动能定理一致',
  uniform_acceleration: '匀加速运动一致',
  scene_valid: '场景结构有效',
  /* Point-charge model checks (electric-verifier.ts): without these labels the
     Agent's findCheck would cite the raw English id, and the Inspector would
     show untranslated check names. */
  electric_scene_2d: '场景为二维',
  point_charge_field_present: '存在点电荷场',
  point_charge_fields_only: '仅含点电荷场',
  charges_only: '仅含电荷（无刚体/电路）',
  electric_force_only: '仅电场力（无边界/约束）',
  field_source_exists: '点电荷场有对应粒子',
  source_charge_defined: '源电荷已定义',
  source_charge_finite: '源电荷有限',
  static_sources: '源电荷静止',
  electric_result_schema: '仿真结果结构有效',
  electric_result_scene_id: '场景 ID 一致',
  electric_result_scene_revision: '场景修订号一致',
  electric_result_states_present: '仿真状态存在',
  electric_field_1_over_r2: '电场 1/r² 律',
  electric_field_direction: '电场方向',
  electric_field_superposition: '电场叠加',
  electric_field_vector_present: '电场向量存在',
  electric_field_vector_matches: '电场向量匹配',
  electric_field_magnitude_present: '电场大小存在',
  electric_field_magnitude_matches: '电场大小匹配',
  electric_potential_present: '电势存在',
  electric_potential_matches: '电势匹配',
  probe_mass_positive: '探针质量为正',
  probe_not_on_source: '探针不在源电荷上',
  electric_force_vector_present: '电场力向量存在',
  electric_force_qE: '电场力 F = qE',
  electric_force_magnitude_present: '电场力大小存在',
  electric_force_magnitude_matches: '电场力大小匹配',
  electric_acceleration_qE_over_m: '加速度 a = qE/m',
  sample_point_declared: '采样点已声明',
  /* Bounded-field checks (electric-region-engine.ts). The region engine drops the
     `electric_` prefix, which is exactly what keeps these ids distinct from the
     unbounded ones above — so they need their own entries or the Inspector shows
     the raw English id and the Agent cites it verbatim to a student. */
  bounded_field_geometry: '有界场区几何有效',
  electric_force_consistency: '电场力 F = qE 一致',
  kinematic_consistency: '运动学一致',
  energy_consistency: '能量一致（W = ΔK）',
  events_present: '场区进出事件已产出',
}

const verificationOf = (simulation: SimulationResult, _pointCharge: boolean): readonly VerificationCheckView[] =>
  /* Both models surface every check. The uniform-field model carries scene
     preconditions plus four dynamics checks (kinematic / force / acceleration /
     energy consistency); the point-charge model carries ~20 (scene preconditions
     plus 1/r² / direction / F=qE / superposition). An 8-check cap sized for the
     uniform field hid the very dynamics checks the Agent cites for a uniform-
     field scene, so both models show the full set — the Inspector list is short
     enough either way, and the Agent's isUniformElectricField keys off the
     kinematic-consistency check that the cap used to truncate. */
  simulation.verification.checks
    .map(check => ({
      id: check.id,
      label: VERIFICATION_LABELS[check.id] ?? check.id,
      status: check.passed ? 'passed' : 'failed',
      ...(check.message === undefined ? {} : { detail: check.message }),
    }))

/* ------------------------------------------------- scene-edit primitives -- */

/**
 * Rescale a velocity to a new magnitude, keeping its direction.
 *
 * A zero velocity carries no direction to keep, so it becomes +x — the same
 * convention the electric scene factories use for an initial velocity.
 */
const velocityAtSpeed = (
  raw: { readonly x: number; readonly y: number; readonly z: number } | undefined,
  speed: number,
): SceneCommandPayloadMap['SetParticleVelocity']['velocity'] => {
  const vector = raw ?? { x: 1, y: 0, z: 0 }
  const magnitude = Math.hypot(vector.x, vector.y, vector.z)
  const direction = magnitude === 0
    ? { x: 1, y: 0, z: 0 }
    : { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
  return {
    vector: { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
    unit: 'm/s',
    dimension: 'velocity',
  }
}

/**
 * Re-place one plate boundary for a new gap height and plate length.
 *
 * Only segment boundaries are plates; anything else is returned untouched. Which
 * plate a segment is comes from which side of the field region's centre it sits
 * on — the same rule `electric-visual-bridge.ts` uses to draw them — so the
 * canvas, the scene tree and this edit can never disagree about which plate moved.
 */
const replatedBoundary = (
  boundary: Boundary,
  center: { readonly x: number; readonly y: number },
  plateLength: number,
  plateSeparation: number,
): Boundary => {
  const geometry = boundary.geometry
  if (geometry.type !== 'segment') return boundary
  const top = (geometry.start.vector.y + geometry.end.vector.y) / 2 > center.y
  const plateY = center.y + (top ? plateSeparation / 2 : -plateSeparation / 2)
  return {
    ...boundary,
    geometry: {
      ...geometry,
      start: { ...geometry.start, vector: { x: center.x - plateLength / 2, y: plateY, z: 0 } },
      end: { ...geometry.end, vector: { x: center.x + plateLength / 2, y: plateY, z: 0 } },
    },
  }
}

/* --------------------------------------- parallel-plate panel views -- */
/*
 * A parallel-plate scene is a BOUNDED field, and the panels have to say so: the
 * field is not "匀强电场" filling the world but a rectangular region between two
 * named plates, and the gap geometry (d, L) is as much a physical fact a student
 * can change as the field strength or the charge.
 *
 * Every number below is read straight off the scene — nothing here computes
 * physics, and the derived rows only restate what the Region Engine already
 * verified.
 */

/** Smallest plate dimension the Inspector will accept, in metres. */
const MIN_PLATE_METRES = 1e-4

/** Nudge step scaled to the dimension, so a 4 cm gap and a 4 m gap both read well. */
const plateStepOf = (value: number): number => (value > 0 ? value / 10 : MIN_PLATE_METRES)

/** Field region centre in the scene's own length units, `(0, 0)` when absent. */
const regionCenterOf = (scene: PhysicsScene): { x: number; y: number } => {
  const center = scene.regions[0]?.center.vector
  return { x: center?.x ?? 0, y: center?.y ?? 0 }
}

/** One tree row per plate, read from the scene's segment boundaries. */
const plateTreeRowsOf = (scene: PhysicsScene): readonly SceneTreeNode[] => {
  const center = regionCenterOf(scene)
  return scene.boundaries.flatMap((boundary) => {
    const geometry = boundary.geometry
    if (geometry.type !== 'segment') return []
    const plateY = (geometry.start.vector.y + geometry.end.vector.y) / 2
    return [{
      id: boundary.id,
      label: plateY > center.y ? '上极板' : '下极板',
      secondary: `y = ${fmt(plateY, 3)} m`,
      icon: 'ground' as const,
      kind: 'object' as const,
    }]
  })
}

const regionTreeOf = (scene: PhysicsScene): readonly SceneTreeNode[] => {
  const particle = scene.particles[0]
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  const region = scene.regions[0]
  const separation = plateSeparationOf(scene)
  const length = plateLengthOf(scene)
  const speed =
    particle === undefined
      ? 0
      : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
  return [
    {
      id: 'scene',
      label: '场景',
      icon: 'folder',
      kind: 'group',
      children: [
        {
          id: particle?.id ?? 'particle',
          label: (particle?.charge?.value ?? 0) >= 0 ? '正电粒子' : '负电粒子',
          secondary: particle?.charge === undefined ? '—' : `${particle.charge.value.toExponential(2)} C`,
          icon: 'particle',
          kind: 'object',
        },
        {
          id: field?.id ?? 'field',
          label: '平行板电场',
          secondary:
            field?.type === 'uniform_electric'
              ? `${fmt(Math.hypot(field.fieldStrength.vector.x, field.fieldStrength.vector.y))} V/m`
              : '—',
          icon: 'field',
          kind: 'object',
        },
        {
          id: region?.id ?? 'field-region',
          label: '场区',
          secondary: `${fmt(length, 3)} m × ${fmt(separation, 3)} m`,
          icon: 'field',
          kind: 'object',
        },
        ...plateTreeRowsOf(scene),
      ],
    },
    {
      id: 'initial',
      label: '初始条件',
      icon: 'folder',
      kind: 'group',
      children: [
        { id: 'init-velocity', label: '初速度', secondary: `${fmt(speed)} m/s`, icon: 'velocity', kind: 'object' },
      ],
    },
    {
      id: 'observables',
      label: '可观察量',
      icon: 'folder',
      kind: 'group',
      children: observableTreeChildren(scene),
    },
  ]
}

const regionInspectorOf = (
  scene: PhysicsScene,
  simulation: SimulationResult | undefined,
  state?: SimulationState,
): readonly InspectorSection[] => {
  const particle = scene.particles[0]
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  const separation = plateSeparationOf(scene)
  const length = plateLengthOf(scene)
  const strength =
    field?.type === 'uniform_electric'
      ? Math.hypot(field.fieldStrength.vector.x, field.fieldStrength.vector.y)
      : 0
  const speed =
    particle === undefined
      ? 0
      : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
  /* Bounded field: read the derived rows from the CURRENT frame, not from the
     simulation's end-of-run set. The engine publishes `derivedQuantities` at the
     final time, where the particle has already left the plates and E, F and a are
     all zero — so an end-of-run Inspector would contradict the canvas readout the
     moment a student seeks into the gap. Every other domain's field is unbounded,
     so this only shows up here. */
  const derivedSource = state?.derived ?? simulation?.derivedQuantities ?? []
  const derived: DerivedQuantityView[] = derivedSource.map(entry => ({
    id: entry.key,
    label: DERIVED_LABELS[entry.key] ?? entry.key,
    symbol: '',
    value: derivedText(entry),
    unit: derivedUnit(entry),
  }))
  return [
    {
      id: 'plates',
      title: '平行板',
      parameters: [
        {
          id: 'plateSeparation',
          label: '板间距',
          symbol: 'd',
          unit: 'm',
          value: separation,
          min: MIN_PLATE_METRES,
          step: plateStepOf(separation),
        },
        {
          id: 'plateLength',
          label: '板长',
          symbol: 'L',
          unit: 'm',
          value: length,
          min: MIN_PLATE_METRES,
          step: plateStepOf(length),
        },
      ],
    },
    {
      id: 'field',
      title: '电场',
      parameters: [
        {
          id: 'electricFieldStrength',
          label: '场强',
          symbol: 'E',
          unit: 'V/m',
          value: strength,
          min: 0,
          step: 100,
          highlights: 'electric-field-vector',
        },
      ],
      choices: [
        {
          id: 'direction',
          label: '电场方向',
          value: fieldDirectionOf(scene),
          options: DIRECTION_OPTIONS.map(option => ({ value: option.value, label: option.label })),
        },
      ],
    },
    {
      id: 'particle',
      title: '粒子属性',
      parameters: [
        {
          id: 'particleCharge',
          label: '电荷量',
          symbol: 'q',
          unit: 'C',
          value: particle?.charge?.value ?? 0,
          step: 1e-19,
          highlights: 'electric-force-vector',
        },
        {
          id: 'particleMass',
          label: '质量',
          symbol: 'm',
          unit: 'kg',
          value: particle?.mass.value ?? 0,
          min: 1e-32,
          step: 1e-31,
        },
        {
          id: 'initialSpeed',
          label: '初速度',
          symbol: 'v_0',
          unit: 'm/s',
          value: speed,
          min: 0,
          step: 1e6,
          highlights: 'electric-velocity-vector',
        },
      ],
    },
    { id: 'derived', title: '派生量', derived },
  ]
}

/* --------------------------------------------- point-charge panel views -- */
/*
 * The point-charge model is static (one state, no trajectory), so charts carry a
 * single point, the table a single row, and the tree/inspector show source charges
 * and the probe with their derived field/force values. These return empty (never
 * throw) when there is no probe, so a "what is E at 20cm" scene still mounts.
 */

const pointChargeChartsOf = (
  simulation: SimulationResult,
  _sources: readonly Particle[],
  probe: Particle | undefined,
): readonly ChartSeries[] => {
  if (probe === undefined) return []
  const state = simulation.states[0]
  if (state === undefined) return []
  const probeState = state.objects.find(candidate => candidate.id === probe.id)
  const position = probeState?.position === undefined
    ? { x: 0, y: 0 }
    : toCanonicalVector(probeState.position).vectorSI
  const t = state.time.value
  const series = (id: string, title: string, yLabel: string, value: number, role: ChartSeries['role']): ChartSeries => ({
    id,
    title,
    xLabel: 't / s',
    yLabel,
    role,
    points: [{ t, value }],
  })
  return [
    series('pc-x', '探针 x', 'x / m', position.x, 'trajectory'),
    series('pc-y', '探针 y', 'y / m', position.y, 'trajectory'),
    series('pc-E', '|E| - t', '|E| / (V/m)', safeScalar(state, 'electric_field_magnitude'), 'force'),
    series('pc-F', '|F| - t', '|F| / N', safeScalar(state, 'electric_force_magnitude'), 'force'),
  ]
}

const pointChargeTableOf = (
  simulation: SimulationResult,
  _sources: readonly Particle[],
  probe: Particle | undefined,
): DataTableView => {
  const state = simulation.states[0]
  if (state === undefined) return { columns: [], rows: [] }
  const probeId = probe?.id ?? 'probe-1'
  const probeState = state.objects.find(candidate => candidate.id === probeId)
  const position = probeState?.position === undefined
    ? { x: 0, y: 0 }
    : toCanonicalVector(probeState.position).vectorSI
  const hasProbe = probe !== undefined
  const row = {
    step: 0,
    values: [
      fmt(state.time.value, 3),
      fmt(position.x),
      fmt(position.y),
      fmt(safeScalar(state, 'electric_field_magnitude')),
      ...(hasProbe ? [fmt(safeScalar(state, 'electric_force_magnitude'))] : []),
    ],
  }
  const columns = ['t / s', 'x / m', 'y / m', '|E|', ...(hasProbe ? ['|F| / N'] : [])]
  return { columns, rows: [row] }
}

const pointChargeTreeOf = (scene: PhysicsScene): readonly SceneTreeNode[] => {
  const sources = sourceChargesOf(scene.particles, scene.fields)
  const probe = probeParticleOf(scene.particles, scene.fields)
  const sample = fieldSamplePointOf(scene)
  const children: SceneTreeNode[] = sources.map(source => ({
    id: source.id,
    label: (source.charge?.value ?? 0) >= 0 ? '正点电荷' : '负点电荷',
    secondary: source.charge === undefined ? '—' : `${source.charge.value.toExponential(2)} C`,
    icon: 'particle' as const,
    kind: 'object' as const,
  }))
  if (probe !== undefined) {
    children.push({
      id: probe.id,
      label: '探针粒子',
      secondary: probe.charge === undefined ? '—' : `${probe.charge.value.toExponential(2)} C`,
      icon: 'particle' as const,
      kind: 'object' as const,
    })
  }
  const observableChildren: SceneTreeNode[] = scene.observableDefinitions
    .map((definition): SceneTreeNode | undefined => {
      const key = observableKeyOf(definition)
      if (key === undefined) return undefined
      return {
        id: definition.id,
        label: OBSERVABLE_LABELS[definition.type] ?? definition.id,
        icon: 'observable' as const,
        kind: 'observable' as const,
        observable: key,
      }
    })
    .filter((entry): entry is SceneTreeNode => entry !== undefined)
  if (sample !== undefined) {
    children.push({
      id: 'field-sample',
      label: '采样点',
      secondary: `(${fmt(sample.x)}, ${fmt(sample.y)}) m`,
      icon: 'observable' as const,
      kind: 'object' as const,
    })
  }
  const tree: SceneTreeNode[] = [
    { id: 'scene', label: '场景', icon: 'folder', kind: 'group', children },
  ]
  if (observableChildren.length > 0) {
    tree.push({ id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren })
  }
  return tree
}

const pointChargeInspectorOf = (
  scene: PhysicsScene,
  simulation: SimulationResult | undefined,
): readonly InspectorSection[] => {
  const sources = sourceChargesOf(scene.particles, scene.fields)
  const probe = probeParticleOf(scene.particles, scene.fields)
  const state = simulation?.states[0]
  const derived: DerivedQuantityView[] = (simulation?.derivedQuantities ?? []).map(entry => ({
    id: entry.key,
    label: DERIVED_LABELS[entry.key] ?? entry.key,
    symbol: '',
    value: derivedText(entry),
    unit: derivedUnit(entry),
  }))
  const sections: InspectorSection[] = [
    {
      id: 'sources',
      title: '源电荷',
      parameters: sources.map(source => ({
        id: source.id,
        label: (source.charge?.value ?? 0) >= 0 ? '正电荷' : '负电荷',
        symbol: 'q',
        unit: 'C',
        value: source.charge?.value ?? 0,
        step: 1e-6,
        highlights: source.id,
      })),
    },
  ]
  if (probe !== undefined) {
    sections.push({
      id: 'probe',
      title: '探针',
      parameters: [
        { id: 'probe-q', label: '探针电荷', symbol: "q'", unit: 'C', value: probe.charge?.value ?? 0, step: 1e-19, highlights: 'electric-force' },
        { id: 'probe-m', label: '探针质量', symbol: 'm', unit: 'kg', value: probe.mass.value, min: 1e-32, step: 1e-27 },
      ],
    })
  }
  if (state !== undefined) {
    sections.push({
      id: 'derived',
      title: '派生量',
      derived,
    })
  }
  return sections
}

/* -------------------------------------------------------- region events -- */
/*
 * The Electric Region Engine produces PhysicsEventLike events (EnterField,
 * ExitField, HitPlate) without a time field — the time is implicit in the
 * event ordering and the model geometry. These helpers reconstruct the
 * deterministic event times from the already-verified ParallelPlateModel
 * (xLeft/xRight/yTop/yBottom + kinematics), which is a pure geometric
 * projection of the model the engine already asserted — not new physics.
 */

const computeRegionPhases = (model: ParallelPlateModel): {
  enterTime: number
  exitTime: number | null
  hitTime: number | null
  hitPlate: 'top' | 'bottom' | null
} => {
  const { position: p0, velocity: v0, acceleration: a, xLeft, xRight, yTop, yBottom } = model
  const vx = v0.x

  /* Enter time: when the particle first reaches the left edge of the field. */
  let enterTime: number
  if (vx > 0 && p0.x < xLeft) {
    enterTime = (xLeft - p0.x) / vx
  } else if (p0.x >= xLeft && p0.x <= xRight) {
    enterTime = 0
  } else {
    enterTime = Number.NaN
  }
  if (!Number.isFinite(enterTime) || enterTime < 0) {
    enterTime = 0
  }

  /* Time inside the field region (entry to exit at x = xRight). */
  const tInside = vx !== 0 ? (xRight - xLeft) / vx : Infinity

  /* Solve for plate hit: y(t_in) = yTarget inside [0, tInside]. */
  const aY = a.y
  const vyEntry = v0.y
  const yEntry = p0.y + v0.y * enterTime

  const solveHit = (yTarget: number): number | null => {
    if (Math.abs(aY) < 1e-30) {
      if (Math.abs(vyEntry) < 1e-30) return null
      const t = (yTarget - yEntry) / vyEntry
      return t >= 0 && t <= tInside ? t : null
    }
    const halfA = 0.5 * aY
    const b = vyEntry
    const c = yEntry - yTarget
    const disc = b * b - 4 * halfA * c
    if (disc < 0) return null
    const sqrtDisc = Math.sqrt(disc)
    const t1 = (-b + sqrtDisc) / (2 * halfA)
    const t2 = (-b - sqrtDisc) / (2 * halfA)
    let earliest: number | null = null
    for (const t of [t1, t2]) {
      if (t >= 0 && t <= tInside) {
        if (earliest === null || t < earliest) earliest = t
      }
    }
    return earliest
  }

  let hitPlate: 'top' | 'bottom' | null = null
  let hitTimeInside = Infinity

  const tHitTop = solveHit(yTop)
  const tHitBottom = solveHit(yBottom)
  if (tHitTop !== null && tHitTop < hitTimeInside) {
    hitTimeInside = tHitTop
    hitPlate = 'top'
  }
  if (tHitBottom !== null && tHitBottom < hitTimeInside) {
    hitTimeInside = tHitBottom
    hitPlate = 'bottom'
  }

  const hitTime = hitPlate !== null ? enterTime + hitTimeInside : null
  const exitTime = hitPlate === null ? enterTime + tInside : null

  return { enterTime, exitTime, hitTime, hitPlate }
}

/**
 * Map the Electric Region Engine's PhysicsEventLike[] to TimelineEvent[] for
 * the timeline panel. Event times are derived deterministically from the
 * already-verified ParallelPlateModel geometry + kinematics.
 */
const regionEventsOf = (
  simulation: SimulationResult,
  scene: PhysicsScene,
): readonly TimelineEvent[] => {
  if (simulation.events.length === 0) return []
  const model = resolveParallelPlateModel(scene)
  const phases = computeRegionPhases(model)
  const events: TimelineEvent[] = []
  for (const event of simulation.events as readonly PhysicsEventLike[]) {
    if (event.type === 'EnterField') {
      events.push({ id: 'event-enter-field', time: phases.enterTime, label: '进入电场', kind: 'enter' })
    } else if (event.type === 'ExitField' && phases.exitTime !== null) {
      events.push({ id: 'event-exit-field', time: phases.exitTime, label: '离开电场', kind: 'exit' })
    } else if (event.type === 'HitPlate' && phases.hitTime !== null) {
      const plate = phases.hitPlate ?? 'top'
      events.push({
        id: `event-hit-plate-${plate}`,
        time: phases.hitTime,
        label: '打到极板',
        kind: 'plate-impact',
      })
    }
  }
  return events
}

export const createElectricWorkspaceRuntime = (scene: PhysicsScene): ElectricWorkspaceRuntime =>
  new ElectricWorkspaceRuntime(scene)
