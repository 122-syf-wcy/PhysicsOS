/**
 * Composite → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + CompositeEngine for a crossed-field scene (velocity
 * selector, mass spectrometer, E+B(+g) composite) and reports frames in the
 * shared {@link WorkspaceSnapshot} shape, so the composite domain renders through
 * the same `PhysicsWorkspace` shell and `PhysicsCanvas` as every other domain.
 * Parameter edits go through real scene commands, so a change is an auditable
 * revision bump rather than local component state.
 *
 * The composite engine's phase decomposition already produces the EnterRegion /
 * ExitRegion / SwitchField events the timeline marks; this adapter only
 * translates them into {@link TimelineEvent}s. No physics is recomputed here —
 * every vector and scalar comes from the simulation state or the derived
 * quantities the engine already published, projected by the visual bridge.
 */

import {
  CompositeEngine,
  createCompositeSimulationRequest,
} from '@physicsos/engine-composite'
import {
  derivedScalar,
  isQuantityVector,
  toCanonicalVector,
  type DerivedQuantity,
  type PhysicsEventLike,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { observeCompositeScene } from '@physicsos/physics-observation'
import { verifyCompositeApparatus } from '@physicsos/physics-verifier'
import {
  SceneRuntime,
  createSceneCommand,
  sampleFieldsAt,
  type ElectricFieldDirection,
  type ObservableDefinition,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import { compositeSceneVisualAt, compositeSampleReadout } from './composite-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
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
  electric_force_vector: '电场力',
  electric_force_magnitude: '电场力大小',
  magnetic_force_vector: '洛伦兹力',
  magnetic_force_magnitude: '洛伦兹力大小',
  gravity_force_vector: '重力',
  gravity_force_magnitude: '重力大小',
  net_force_vector: '合力',
  net_force_magnitude: '合力大小',
  acceleration_vector: '加速度',
  acceleration_magnitude: '加速度大小',
  velocity_vector: '速度',
  speed: '速率',
  kinetic_energy: '动能',
  kinetic_energy_change: '动能变化',
  drift_velocity: '漂移速度',
  gyro_radius: '回旋半径',
  cyclotron_period: '回旋周期',
  selected_velocity: '选择速度',
}

const OBSERVABLE_LABELS: Record<string, string> = {
  velocity: '速度',
  force: '力',
  trajectory: '运动轨迹',
  electric_field: '电场',
  magnetic_field: '磁场',
}

const observableKeyOf = (definition: ObservableDefinition): ObservableKey | undefined => {
  if (definition.type === 'velocity') return 'velocity'
  if (definition.type === 'force') {
    const kind = definition.parameters?.['kind']
    if (kind === 'electric') return 'electricForce'
    if (kind === 'magnetic') return 'magneticForce'
    if (kind === 'gravity') return 'gravityForce'
    if (kind === 'net') return 'netForce'
    return undefined
  }
  if (definition.type === 'trajectory') return 'trajectory'
  if (definition.type === 'electric_field') return 'electricField'
  if (definition.type === 'magnetic_field') return 'magneticField'
  return undefined
}

const observableTreeChildren = (scene: PhysicsScene): readonly SceneTreeNode[] =>
  scene.observableDefinitions.flatMap((definition) => {
    const key = observableKeyOf(definition)
    if (key === undefined) return []
    const label =
      definition.type === 'force'
        ? ((OBSERVABLE_LABELS.force ?? '力') +
          (definition.parameters?.['kind'] === 'electric'
            ? '·电场力'
            : definition.parameters?.['kind'] === 'magnetic'
              ? '·洛伦兹力'
              : definition.parameters?.['kind'] === 'gravity'
                ? '·重力'
                : definition.parameters?.['kind'] === 'net'
                  ? '·合力'
                  : ''))
        : OBSERVABLE_LABELS[definition.type] ?? definition.type
    return [{
      id: String(definition.id),
      label,
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

const DIRECTION_OPTIONS: readonly { value: ElectricFieldDirection; label: string }[] = [
  { value: 'right', label: '水平向右' },
  { value: 'left', label: '水平向左' },
  { value: 'up', label: '竖直向上' },
  { value: 'down', label: '竖直向下' },
]

const fieldDirectionOf = (scene: PhysicsScene): ElectricFieldDirection => {
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  if (field?.type !== 'uniform_electric') return 'up'
  const { x, y } = field.fieldStrength.vector
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'right' : 'left'
  return y >= 0 ? 'up' : 'down'
}

interface Computed {
  readonly simulation: SimulationResult
  readonly state: SimulationState
  readonly startTime: number
  readonly endTime: number
}

/** Region role label for the scene tree, read from the region's bound fields. */
const regionKindLabel = (scene: PhysicsScene, regionId: string): string => {
  const fields = scene.fields.filter(field => field.regionId === regionId)
  const hasE = fields.some(field => field.type === 'uniform_electric')
  const hasB = fields.some(field => field.type === 'uniform_magnetic')
  if (hasE && hasB) return '选择器区 E+B'
  if (hasB && !hasE) return '磁偏转区 B'
  if (!hasE && !hasB) return '无场过渡区'
  return '场区'
}

export class CompositeWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new CompositeEngine()
  private currentTime = 0
  /** True once the opening playhead has been chosen, so a seek is never overridden. */
  private playheadInitialised = false
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
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const simulation = this.engine.simulate(
        scene,
        createCompositeSimulationRequest(
          scene,
          `composite-lab-${String(scene.id)}-${scene.revision}`,
          `composite-lab-trace-${String(scene.id)}-${scene.revision}`,
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
      /* Open the playhead on the first frame where a field actually acts.
         A composite apparatus is posed with the particle entering from OUTSIDE the
         region ("从左端进入"), so at t = 0 every field is zero and the canvas shows a
         velocity arrow and nothing else — the student opens 速度选择器 and sees no
         selection happening. The timeline still starts at 0 and stays scrubbable;
         only the frame first shown moves to where the apparatus is doing its job.
         Set once, on the first solve, so a student's own seek is never overridden. */
      if (!this.playheadInitialised) {
        this.playheadInitialised = true
        const active = openingPlayheadTime(scene, simulation)
        if (active !== undefined) this.currentTime = active
      }
      /* The engine's stateAtSeconds reads the phase decomposition at the current
         playhead — derived rows therefore describe the frame the canvas is showing,
         not an end-of-run summary where the particle has left every region. */
      const state = this.engine.stateAtSeconds(
        scene,
        Math.min(endTime, Math.max(startTime, this.currentTime)),
      )
      this.failure = undefined
      this.computed = { simulation, state, startTime, endTime }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '复合场 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the solution the
       student just read was verified against the original conditions. Playback,
       seeking and observable toggles are NOT facts and never fork. */
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
        commandId: `composite-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `composite-ui-trace-${this.commandSequence}`,
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
    const title = scene.metadata.title ?? '复合场中的带电粒子'
    const badge = branchBadgeOf(scene)

    if (this.computed === undefined) {
      return {
        domain: 'composite',
        title,
        subtitle: scene.metadata.description ?? '真实复合场 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('composite'),
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
          code: 'COMPOSITE_RUNTIME_FAILED',
          message: this.failure ?? '当前复合场场景不满足 Composite Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, state, endTime } = this.computed
    const observations = observeCompositeScene({ scene, simulation, state })
    const view = compositeSceneVisualAt({
      scene,
      simulation,
      observations: observations.observations,
      state,
    })
    const particle = scene.particles[0]
    if (particle === undefined) {
      return {
        domain: 'composite',
        title,
        subtitle: scene.metadata.description ?? '真实复合场 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('composite'),
        ariaLabel: title,
        tree: this.treeOf(scene),
        inspector: this.inspectorOf(scene, simulation, state),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'COMPOSITE_RUNTIME_FAILED',
          message: '当前复合场场景缺少带电粒子。',
          retryable: false,
        },
      }
    }

    /* Status comes from the engine's LAW verification only. A failed law check is
       a real failure and must read as one — mapping anything that is not
       `passed_with_warnings` to "verified" once painted a green badge over a scene
       whose observables did not resolve. The apparatus checks below (selection
       condition) are a readout and deliberately excluded from this. */
    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'composite',
      title,
      subtitle: scene.metadata.description ?? '真实复合场 Runtime',
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
      verification: verificationOf(scene, simulation),
      events: compositeEventsOf(simulation, scene),
      clock: { time: this.currentTime, total: endTime, running: this.running, rate: this.rate },
      trajectoryTimes: simulation.states.map(sample => sample.time.value),
      sampleReadout: index => compositeSampleReadout(simulation, particle.id, index),
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
    const particle = scene.particles[0]
    const speed =
      particle === undefined
        ? 0
        : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
    const regionChildren: SceneTreeNode[] = scene.regions.map((region) => {
      const width = region.shape.type === 'rectangle' ? region.shape.width.value : 0
      const height = region.shape.type === 'rectangle' ? region.shape.height.value : 0
      return {
        id: region.id,
        label: regionKindLabel(scene, region.id),
        secondary: `${fmt(width, 3)} m × ${fmt(height, 3)} m`,
        icon: 'field' as const,
        kind: 'object' as const,
      }
    })
    const fieldChildren: SceneTreeNode[] = scene.fields
      .filter(field => field.type !== 'point_charge')
      .map((field) => {
        if (field.type === 'uniform_electric') {
          const { x, y } = field.fieldStrength.vector
          return {
            id: field.id,
            label: '匀强电场',
            secondary: `${fmt(Math.hypot(x, y))} V/m`,
            icon: 'field' as const,
            kind: 'object' as const,
          }
        }
        if (field.type === 'uniform_magnetic') {
          const bz = field.magneticFluxDensity.vector.z
          return {
            id: field.id,
            label: bz < 0 ? '磁场 ⊗（向里）' : '磁场 ⊙（向外）',
            secondary: `${fmt(Math.abs(bz))} T`,
            icon: 'field' as const,
            kind: 'object' as const,
          }
        }
        /* point_charge is filtered out above and electric/magnetic returned, so
           the remaining field kind is exactly uniform gravity. */
        const g = field.acceleration.vector
        return {
          id: field.id,
          label: '重力场',
          secondary: `${fmt(Math.hypot(g.x, g.y, g.z))} m/s²`,
          icon: 'field' as const,
          kind: 'object' as const,
        }
      })
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
          ...fieldChildren,
          ...regionChildren,
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
    const particle = scene.particles[0]
    const electricField = scene.fields.find(candidate => candidate.type === 'uniform_electric')
    const magneticField = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
    const speed =
      particle === undefined
        ? 0
        : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
    const electricStrength =
      electricField?.type === 'uniform_electric'
        ? Math.hypot(electricField.fieldStrength.vector.x, electricField.fieldStrength.vector.y)
        : 0
    const magneticStrength =
      magneticField?.type === 'uniform_magnetic'
        ? Math.abs(magneticField.magneticFluxDensity.vector.z)
        : 0
    /* Read derived rows from the CURRENT frame, not the simulation's end-of-run
       set: outside a field region every contribution is zero, and an end-of-run
       summary would contradict the canvas readout the moment a student seeks. */
    const derivedSource = state?.derived ?? simulation?.derivedQuantities ?? []
    const derived: DerivedQuantityView[] = derivedSource.map(entry => ({
      id: entry.key,
      label: DERIVED_LABELS[entry.key] ?? entry.key,
      symbol: '',
      value: derivedText(entry),
      unit: derivedUnit(entry),
    }))
    const sections: InspectorSection[] = [
      {
        id: 'particle',
        title: '粒子属性',
        parameters: [
          { id: 'q', label: '电荷量', symbol: 'q', unit: 'C', value: particle?.charge?.value ?? 0, step: 1e-19, highlights: 'electric-force-vector' },
          { id: 'm', label: '质量', symbol: 'm', unit: 'kg', value: particle?.mass.value ?? 0, min: 1e-32, step: 1e-27 },
          { id: 'v0', label: '初速度', symbol: 'v_0', unit: 'm/s', value: speed, min: 0, step: 1e4, highlights: 'velocity-vector' },
        ],
      },
      {
        id: 'fields',
        title: '场',
        parameters: [
          { id: 'E', label: '电场强度', symbol: 'E', unit: 'V/m', value: electricStrength, min: 0, step: 1e3, highlights: 'electric-field-vector' },
          { id: 'B', label: '磁感应强度', symbol: 'B', unit: 'T', value: magneticStrength, min: 0, step: 0.01, highlights: 'magnetic-field' },
        ],
        ...(electricField === undefined ? {} : {
          choices: [
            {
              id: 'direction',
              label: '电场方向',
              value: fieldDirectionOf(scene),
              options: DIRECTION_OPTIONS.map(option => ({ value: option.value, label: option.label })),
            },
          ],
        }),
      },
    ]
    if (derived.length > 0) {
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const particle = scene.particles[0]
    const particleId = particle?.id ?? 'particle-1'
    const electricField = scene.fields.find(candidate => candidate.type === 'uniform_electric')
    const magneticField = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
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
    } else if (id === 'E' && electricField?.type === 'uniform_electric') {
      this.command('SetElectricFieldStrength', {
        fieldId: electricField.id,
        strength: { value, unit: 'V/m', dimension: 'electric_field' },
      })
    } else if (id === 'B' && magneticField?.type === 'uniform_magnetic') {
      this.command('SetMagneticFieldStrength', {
        fieldId: magneticField.id,
        strength: { value, unit: 'T', dimension: 'magnetic_flux_density' },
      })
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'direction') {
      const scene = this.sceneRuntime.getScene()
      const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
      if (field?.type === 'uniform_electric') {
        this.command('SetElectricFieldDirection', {
          fieldId: field.id,
          direction: value as ElectricFieldDirection,
        })
      }
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
      const next = this.currentTime + wallClockSeconds * this.rate
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

/**
 * The instant the Lab should open on: the middle of the first span where a field
 * acts on the particle.
 *
 * Read by sampling the SCENE at each simulated position — the same
 * `sampleFieldsAt` the engine and the verifier use — so this never invents a field
 * the scene does not declare. The MIDPOINT is deliberate: at exactly the region
 * boundary the engine's phase is still the field-free one, so the entry instant
 * itself reports zero forces, and opening there would show an apparatus that looks
 * switched off. `undefined` when a field acts from the first frame (nothing to
 * move) or never acts at all.
 */
const openingPlayheadTime = (
  scene: PhysicsScene,
  simulation: SimulationResult,
): number | undefined => {
  const particle = scene.particles[0]
  if (particle === undefined) return undefined
  const actsAt = (index: number): boolean => {
    const state = simulation.states[index]
    const object = state?.objects.find(entry => entry.id === particle.id) ?? state?.objects[0]
    if (object?.position === undefined) return false
    const sample = sampleFieldsAt(scene, toCanonicalVector(object.position).vectorSI)
    return (
      sample.electricField.x !== 0 || sample.electricField.y !== 0 ||
      sample.magneticFluxDensity.z !== 0 ||
      sample.gravity.x !== 0 || sample.gravity.y !== 0
    )
  }
  /* Already inside a field region: the opening frame is already informative. */
  if (simulation.states.length === 0 || actsAt(0)) return undefined
  const start = simulation.states.findIndex((_state, index) => actsAt(index))
  if (start < 0) return undefined
  let end = start
  while (end + 1 < simulation.states.length && actsAt(end + 1)) end += 1
  return simulation.states[Math.floor((start + end) / 2)]?.time.value
}

const VERIFICATION_LABELS: Record<string, string> = {
  scene_valid: '场景结构有效',
  composite_force_superposition: '合力为三力矢量和',
  magnetic_force_does_no_work: '洛伦兹力不做功',
  speed_conserved_in_pure_magnetic: '纯磁场区速率守恒',
  energy_consistency: '能量一致（W = ΔK）',
  cyclotron_period_independent_of_speed: '回旋周期与速度无关',
  /* Apparatus checks from the composite verifier: a READOUT, not a law. */
  velocity_selection_condition: '速度选择条件',
  electric_force_magnitude_consistent: '电场力大小',
  magnetic_force_magnitude_consistent: '洛伦兹力大小',
  magnetic_deflection_radius_defined: '磁偏转半径',
}

/**
 * Verification rows the Lab shows.
 *
 * Two sources, deliberately concatenated rather than merged: the engine's own law
 * checks (superposition, no magnetic work, energy) followed by the composite
 * verifier's apparatus checks (is the selector selecting, is the arc defined).
 *
 * The apparatus checks are a readout. `v ≠ E/B` makes the selection condition FAIL
 * while the physics stays correct — the beam simply deflects — so these rows must
 * never feed the runtime status. The status is derived from
 * `simulation.verification.status` alone.
 */
const verificationOf = (
  scene: PhysicsScene,
  simulation: SimulationResult,
): readonly VerificationCheckView[] => {
  const engineChecks = simulation.verification.checks.map(check => ({
    id: check.id,
    label: VERIFICATION_LABELS[check.id] ?? check.id,
    status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
    ...(check.message === undefined ? {} : { detail: check.message }),
  }))
  const apparatus = verifyCompositeApparatus(scene, simulation).checks.map(check => ({
    id: check.id,
    label: VERIFICATION_LABELS[check.id] ?? check.id,
    status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
    ...(check.message === undefined ? {} : { detail: check.message }),
  }))
  return [...engineChecks, ...apparatus]
}

/**
 * Map the Composite Engine's EnterRegion / ExitRegion / SwitchField events to
 * TimelineEvent markers. Event times come straight from the engine's phase
 * decomposition — every phase boundary is the exact crossing instant, so the
 * timeline markers are the same instants the engine used to restart a phase.
 *
 * The engine encodes the region id inside the eventId
 * (`event-enter-region-<id>-p<phase>`) rather than as a dedicated field, so the
 * region a marker refers to is recovered by parsing that. A marker without a
 * matched region (the engine stopped emitting before the region existed, or an
 * unknown region id) still shows, labelled generically.
 */
const regionIdOfEvent = (event: PhysicsEventLike): string | undefined => {
  const id = String(event.eventId)
  const match = /^event-(?:enter|exit)-region-(.+)-p\d+$/.exec(id)
  return match?.[1]
}

const compositeEventsOf = (
  simulation: SimulationResult,
  scene: PhysicsScene,
): readonly TimelineEvent[] => {
  if (simulation.events.length === 0) return []
  const events: TimelineEvent[] = []
  let enterCount = 0
  let exitCount = 0
  let switchCount = 0
  for (const event of simulation.events as readonly PhysicsEventLike[]) {
    const time = event.time ?? 0
    if (event.type === 'EnterRegion') {
      enterCount += 1
      const regionId = regionIdOfEvent(event)
      const region = regionId === undefined ? undefined : scene.regions.find(candidate => candidate.id === regionId)
      events.push({
        id: `event-enter-${enterCount}`,
        time,
        label: `进入${region === undefined ? '场区' : regionKindLabel(scene, region.id)}`,
        kind: 'enter',
      })
    } else if (event.type === 'ExitRegion') {
      exitCount += 1
      const regionId = regionIdOfEvent(event)
      const region = regionId === undefined ? undefined : scene.regions.find(candidate => candidate.id === regionId)
      events.push({
        id: `event-exit-${exitCount}`,
        time,
        label: `离开${region === undefined ? '场区' : regionKindLabel(scene, region.id)}`,
        kind: 'exit',
      })
    } else if (event.type === 'SwitchField') {
      switchCount += 1
      events.push({
        id: `event-switch-${switchCount}`,
        time,
        label: '场区切换',
        kind: 'generic',
      })
    }
  }
  return events
}

/**
 * Rescale a velocity to a new magnitude, keeping its direction.
 *
 * A zero velocity carries no direction to keep, so it becomes +x — the same
 * convention the composite scene factories use for an initial velocity.
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

export const createCompositeWorkspaceRuntime = (scene: PhysicsScene): CompositeWorkspaceRuntime =>
  new CompositeWorkspaceRuntime(scene)
