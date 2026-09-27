/**
 * Collision runtime bridge: wraps the verified CollisionEngine so the shared
 * PhysicsWorkspace can drive a collision experiment. It owns the SceneRuntime
 * (scene edits are auditable commands), runs the engine on demand, and builds
 * the plain snapshot the workspace renders — the UI never imports an engine.
 */

import {
  CollisionEngine,
  createCollisionSimulationRequest,
  detectCollisionModel,
  type CollisionModelId,
} from '@physicsos/engine-collision'
import {
  createCollisionScene,
  createSceneCommand,
  SceneRuntime,
  type CollisionSceneInput,
  type PhysicsEvent,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandResult,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { derivedScalar, derivedVector, toCanonicalVector } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'

import { collisionSceneVisualAt, collisionSampleIndices } from './collision-visual-bridge.ts'
import { emptyVisualModel, type SceneVisualModel } from './scene-visual-model.ts'
import { runtimeStatusOf } from './verified-result.ts'
import { forkExperimentalScene, requiresExperimentalFork } from './experimental-branch.ts'
import type {
  ChartSeries,
  DataTableView,
  DerivationStepView,
  InspectorSection,
  ObservableKey,
  PlaybackClock,
  RuntimeErrorView,
  RuntimeStatus,
  SceneTreeNode,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'

type CollisionSimulation = ReturnType<CollisionEngine['simulate']>

/** Simulation of the current scene revision, reused across playback frames. */
interface CollisionSimulationCache {
  readonly sceneRevision: number
  readonly simulation: CollisionSimulation
  readonly status: RuntimeStatus
}

/**
 * The collision runtime snapshot shape used by the collision runtime bridge module.
 */
export interface CollisionRuntimeSnapshot {
  readonly scene: PhysicsScene
  readonly sceneRevision: number
  readonly modelId: CollisionModelId
  readonly status: RuntimeStatus
  readonly view: SceneVisualModel
  readonly tree: readonly SceneTreeNode[]
  readonly inspector: readonly InspectorSection[]
  readonly charts: readonly ChartSeries[]
  readonly table: DataTableView
  readonly derivation: readonly DerivationStepView[]
  readonly verification: readonly VerificationCheckView[]
  readonly events: readonly TimelineEvent[]
  readonly clock: PlaybackClock
  readonly trajectoryTimes: readonly number[]
  readonly error?: RuntimeErrorView
}

/**
 * The collision runtime command outcome shape used by the collision runtime bridge module.
 */
export interface CollisionRuntimeCommandOutcome {
  readonly result: SceneCommandResult
  readonly snapshot: CollisionRuntimeSnapshot
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCollisionScene = (value: CollisionSceneInput | PhysicsScene): value is PhysicsScene =>
  isRecord(value) && value.schemaVersion === 'physics-scene/1.0' && Array.isArray(value.bodies)

const MODEL_SUBTITLES: Readonly<Record<CollisionModelId, string>> = {
  elastic_collision: '动量守恒 · 弹性碰撞',
  inelastic_collision: '动量守恒 · 非弹性碰撞',
  perfectly_inelastic_collision: '动量守恒 · 完全非弹性碰撞',
}

const runtimeErrorOf = (error: unknown): RuntimeErrorView => {
  const base = isRecord(error) && isRecord(error.domainError) ? error.domainError : error
  const code = isRecord(base) && typeof base.code === 'string' ? base.code : 'COLLISION_RUNTIME_FAILED'
  const message = isRecord(base) && typeof base.message === 'string'
    ? base.message
    : '碰撞引擎无法处理当前场景。'
  const explained =
    code === 'UNSUPPORTED_MODEL' || code === 'MODEL_UNSUPPORTED'
      ? '当前场景不满足碰撞模型的前提：需要至少两个圆形刚体、无电磁场。'
      : code === 'INVALID_MODEL_CONDITION'
        ? '当前参数不满足碰撞模型的前提条件，请检查质量、半径与恢复系数。'
        : message
  return { code, message: explained, retryable: isRecord(base) && base.retryable === true }
}

/* ---------------------------------------------------------- observable id -- */

const observableKeyOf = (type: string): ObservableKey | undefined => {
  if (type === 'velocity') return 'velocity'
  if (type === 'trajectory') return 'trajectory'
  if (type === 'momentum') return 'netForce'
  if (type === 'energy') return 'forces'
  return undefined
}

/* ------------------------------------------------------------------ bridge -- */

/**
 * The collision runtime bridge — see the module doc for its role.
 */
export class CollisionRuntimeBridge {
  private sceneRuntime: SceneRuntime
  private readonly engine = new CollisionEngine()
  private currentTime = 0
  private playbackRate = 1
  private running = false
  private commandSequence = 0
  private traceSequence = 0
  private highlighted: readonly string[] = []
  private snapshot!: CollisionRuntimeSnapshot
  private simulationCache: CollisionSimulationCache | undefined

  constructor(input: CollisionSceneInput | PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(
      isCollisionScene(input) ? input : createCollisionScene(input),
    )
    this.recompute()
  }

  /**
   * Get snapshot.
   * @returns the collision runtime snapshot.
   */
  getSnapshot(): CollisionRuntimeSnapshot {
    return this.snapshot
  }

  /**
   * Get events.
   * @returns the events list.
   */
  getEvents(): readonly PhysicsEvent[] {
    return this.sceneRuntime.getEvents()
  }

  /**
   * The edit parameter of the collision runtime bridge module.
   * @param id - the target row id.
   * @param value - the new value.
   * @returns the collision runtime snapshot.
   */
  editParameter(id: string, value: number): CollisionRuntimeSnapshot {
    if (!Number.isFinite(value)) return this.snapshot
    /* Parameter ids: mass-<bodyId>, speed-<bodyId>, radius-<bodyId>. */
    const [kind, ...rest] = id.split('-')
    const bodyId = rest.join('-')
    if (kind === 'mass') return this.setBodyMass(bodyId, value).snapshot
    if (kind === 'speed') return this.setBodySpeed(bodyId, value).snapshot
    return this.snapshot
  }

  /**
   * Set highlight.
   * @param ids - the target row ids.
   * @returns the collision runtime snapshot.
   */
  setHighlight(ids: readonly string[]): CollisionRuntimeSnapshot {
    this.highlighted = ids
    return this.recompute()
  }

  /**
   * Discard the branch and return to the scene the question stated.
   * @returns the collision runtime snapshot.
   * @param origin - the origin point.
   * @returns the collision runtime snapshot.
   */
  restoreOrigin(origin: PhysicsScene): CollisionRuntimeSnapshot {
    this.sceneRuntime = new SceneRuntime(origin)
    this.simulationCache = undefined
    this.currentTime = 0
    this.running = false
    this.highlighted = []
    return this.recompute()
  }

  private dispatch(command: SceneCommand): CollisionRuntimeCommandOutcome {
    const result = this.sceneRuntime.execute(command)
    if (result.ok) this.recompute()
    return { result, snapshot: this.snapshot }
  }

  private command<T extends SceneCommandType>(
    type: T,
    payload: SceneCommandPayloadMap[T],
  ): CollisionRuntimeCommandOutcome {
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
      /* A fresh SceneRuntime restarts the revision counter, so the cached
         simulation (keyed by revision) must not survive the fork. */
      this.simulationCache = undefined
      this.currentTime = 0
      this.running = false
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    this.traceSequence += 1
    return this.dispatch(
      createSceneCommand<T>({
        commandId: `physicsos-collision-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `physicsos-collision-trace-${this.traceSequence}`,
      }) as SceneCommand,
    )
  }

  /**
   * Set body mass.
   * @param bodyId - the body the symbol attaches to.
   * @param value - the new value.
   * @returns the collision runtime command outcome.
   */
  setBodyMass(bodyId: string, value: number): CollisionRuntimeCommandOutcome {
    return this.command('SetBodyMass', { bodyId, mass: { value, unit: 'kg', dimension: 'mass' } })
  }

  /**
   * Set body speed.
   * @param bodyId - the body the symbol attaches to.
   * @param value - the new value.
   * @returns the collision runtime command outcome.
   */
  setBodySpeed(bodyId: string, value: number): CollisionRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies.find(b => b.id === bodyId)
    const current = body?.velocity.vector ?? { x: 0, y: 0, z: 0 }
    const speed = Math.hypot(current.x, current.y)
    const direction = speed < 1e-9 ? { x: 1, y: 0 } : { x: current.x / speed, y: current.y / speed }
    return this.command('SetBodyVelocity', {
      bodyId,
      velocity: {
        vector: { x: direction.x * value, y: direction.y * value, z: 0 },
        unit: 'm/s',
        dimension: 'velocity',
      },
    })
  }

  /**
   * Set observable enabled.
   * @param key - the key.
   * @param enabled - the enabled.
   * @returns the collision runtime snapshot.
   */
  setObservableEnabled(key: ObservableKey, enabled: boolean): CollisionRuntimeSnapshot {
    const scene = this.sceneRuntime.getScene()
    const definition = scene.observableDefinitions.find(
      o => observableKeyOf(o.type) === key,
    )
    if (definition === undefined) return this.snapshot
    this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    return this.snapshot
  }

  /**
   * Set running.
   * @param running - the running.
   * @returns the collision runtime snapshot.
   */
  setRunning(running: boolean): CollisionRuntimeSnapshot {
    const total = this.snapshot.clock.total
    /* Same replay contract as the other finite runtimes: run pressed at the
       end restarts from t = 0 rather than dead-ending. */
    if (running && total > 0 && this.currentTime >= total) this.currentTime = 0
    this.running = running
    return this.recompute()
  }

  /**
   * Set playback rate.
   * @param rate - the rate.
   * @returns the collision runtime snapshot.
   */
  setPlaybackRate(rate: number): CollisionRuntimeSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.playbackRate = rate
    return this.recompute()
  }

  /**
   * The seek of the collision runtime bridge module.
   * @param seconds - the time in seconds.
   * @returns the collision runtime snapshot.
   */
  seek(seconds: number): CollisionRuntimeSnapshot {
    const total = this.snapshot.clock.total
    this.currentTime = Number.isFinite(seconds) ? Math.min(total, Math.max(0, seconds)) : 0
    this.running = false
    return this.recompute()
  }

  /**
   * The step of the collision runtime bridge module.
   * @param deltaSeconds - the delta seconds.
   * @returns the collision runtime snapshot.
   */
  step(deltaSeconds: number): CollisionRuntimeSnapshot {
    return this.seek(this.currentTime + deltaSeconds)
  }

  /**
   * The advance of the collision runtime bridge module.
   * @param wallClockSeconds - the wall clock seconds.
   * @returns the collision runtime snapshot.
   */
  advance(wallClockSeconds: number): CollisionRuntimeSnapshot {
    const total = this.snapshot.clock.total
    if (this.running && Number.isFinite(wallClockSeconds) && total > 0) {
      const next = this.currentTime + wallClockSeconds * this.playbackRate
      this.currentTime = next >= total ? total : next
      if (this.currentTime >= total) this.running = false
    }
    return this.recompute()
  }

  /**
   * The recompute of the collision runtime bridge module.
   * @returns the collision runtime snapshot.
   */
  recompute(): CollisionRuntimeSnapshot {
    const scene = this.sceneRuntime.getScene()
    const modelId = detectCollisionModel(scene) ?? 'elastic_collision'
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.snapshot = this.failedSnapshot(scene, modelId, {
          code: 'UNSUPPORTED_MODEL',
          message: '当前场景不满足碰撞模型的前提：需要至少两个圆形刚体、无电磁场。',
          retryable: false,
        })
        return this.snapshot
      }

      /* One simulation per scene revision. The solver's states are equally
         sampled (dt ≈ 8 ms — finer than a frame), so playback reads the live
         body from the nearest engine sample instead of re-integrating the
         whole run every animation frame, which is what made collision
         playback stutter. A command bumps the revision and misses the cache. */
      const cached = this.simulationCache
      const fresh = cached === undefined || cached.sceneRevision !== scene.revision
      const simulation = fresh
        ? this.engine.simulate(
          scene,
          createCollisionSimulationRequest(
            scene,
            `collision-sim-${scene.revision}`,
            `physicsos-collision-${scene.revision}-${this.traceSequence}`,
          ),
        )
        : cached.simulation
      const status: RuntimeStatus = runtimeStatusOf(simulation.verification)
      this.simulationCache = { sceneRevision: scene.revision, simulation, status }

      if (status === 'failed') {
        this.snapshot = this.failedSnapshot(scene, modelId, {
          code: 'PHYSICS_VERIFICATION_FAILED',
          message: '碰撞仿真未通过物理一致性校验。',
          retryable: false,
        })
        return this.snapshot
      }

      const total = this.durationOf(simulation)
      if (this.currentTime > total) this.currentTime = total

      const state = this.nearestState(simulation, this.currentTime)

      const built = this.buildSnapshot({
        scene,
        modelId,
        simulation,
        state,
        clock: { time: this.currentTime, total, running: this.running, rate: this.playbackRate },
        status,
      })
      this.snapshot = {
        ...built,
        view:
          this.highlighted.length === 0
            ? built.view
            : { ...built.view, highlighted: this.highlighted },
      }
      return this.snapshot
    } catch (error: unknown) {
      this.currentTime = 0
      this.running = false
      this.snapshot = this.failedSnapshot(scene, modelId, runtimeErrorOf(error))
      return this.snapshot
    }
  }

  private durationOf(simulation: CollisionSimulation): number {
    const last = simulation.states[simulation.states.length - 1]
    return last?.time.value ?? 10
  }

  /**
   * The engine's own state nearest the playhead. Collision states are equally
   * sampled at dt ≈ 8 ms — finer than a 60 Hz frame — so the nearest sample IS
   * the engine's answer for this frame, and playback never re-integrates. The
   * empty-stream arm (unreachable after a successful simulate) is the only path
   * that still asks the engine directly.
   */
  private nearestState(
    simulation: CollisionSimulation,
    time: number,
  ): CollisionSimulation['states'][number] {
    const states = simulation.states
    const first = states[0]
    if (first === undefined) {
      return this.engine.stateAt(this.sceneRuntime.getScene(), { value: time, unit: 's', dimension: 'time' })
    }
    const last = states[states.length - 1] ?? first
    const dt = (last.time.value - first.time.value) / Math.max(1, states.length - 1)
    const index = dt > 0
      ? Math.min(states.length - 1, Math.max(0, Math.round((time - first.time.value) / dt)))
      : 0
    return states[index] ?? last
  }

  private buildSnapshot(input: {
    scene: PhysicsScene
    modelId: CollisionModelId
    simulation: CollisionSimulation
    state: ReturnType<CollisionEngine['stateAt']>
    clock: PlaybackClock
    status: RuntimeStatus
  }): CollisionRuntimeSnapshot {
    const { scene, modelId, simulation, state, clock, status } = input
    const view = collisionSceneVisualAt({
      scene,
      simulation,
      observations: [],
      stateIndex: 0,
      state,
    })

    return {
      scene,
      sceneRevision: scene.revision,
      modelId,
      status,
      view,
      tree: this.treeOf(scene),
      inspector: this.inspectorOf(scene),
      charts: this.chartsOf(simulation),
      table: this.tableOf(simulation),
      derivation: this.derivationOf(modelId),
      verification: this.verificationOf(simulation),
      events: this.eventsOf(simulation),
      clock,
      /* Parallel to the decimated trail points the view bridge emits — the
         canvas requires trajectoryTimes.length === points.length for hover,
         seek and the equal-time strobe ghosts to activate. */
      trajectoryTimes: collisionSampleIndices(simulation.states.length).map(
        index => simulation.states[index]?.time.value ?? 0,
      ),
    }
  }

  private treeOf(scene: PhysicsScene): readonly SceneTreeNode[] {
    return [
      {
        id: 'bodies',
        label: '刚体',
        icon: 'folder',
        kind: 'group',
        children: scene.bodies.map(body => ({
          id: body.id,
          label: body.name ?? body.id,
          secondary: `${canonicalValue(body.mass)} kg`,
          icon: 'body',
          kind: 'object',
        })),
      },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: [
          { id: 'obs-velocity', label: '速度', icon: 'velocity', kind: 'observable', observable: 'velocity' },
          { id: 'obs-trajectory', label: '轨迹', icon: 'trajectory', kind: 'observable', observable: 'trajectory' },
          { id: 'obs-momentum', label: '动量', icon: 'force', kind: 'observable', observable: 'netForce' },
        ],
      },
    ]
  }

  private inspectorOf(scene: PhysicsScene): readonly InspectorSection[] {
    const bodyParams = scene.bodies.map(body => ({
      id: `mass-${body.id}`,
      label: `质量 ${body.id}`,
      symbol: 'm',
      unit: 'kg',
      value: canonicalValue(body.mass),
      min: 0.01,
      max: 100,
      step: 0.1,
      highlights: body.id,
    }))
    const speedParams = scene.bodies.map((body) => {
      const velocity = body.velocity.vector
      return {
        id: `speed-${body.id}`,
        label: `速率 ${body.id}`,
        symbol: 'v',
        unit: 'm/s',
        value: Math.hypot(velocity.x, velocity.y),
        min: 0,
        max: 50,
        step: 0.1,
        highlights: body.id,
      }
    })
    return [
      {
        id: 'bodies',
        title: '碰撞体',
        parameters: [...bodyParams, ...speedParams],
      },
      {
        id: 'model',
        title: '模型',
        derived: [
          {
            id: 'model-name',
            label: '碰撞类型',
            symbol: '模型',
            value: MODEL_SUBTITLES[detectCollisionModel(scene) ?? 'elastic_collision'].replace('动量守恒 · ', ''),
            unit: '',
          },
        ],
      },
    ]
  }

  private chartsOf(simulation: CollisionSimulation): readonly ChartSeries[] {
    const momentumSeries: ChartSeries = {
      id: 'p-t',
      title: '总动量 P(t)',
      xLabel: 't / s',
      yLabel: 'P / (kg·m/s)',
      role: 'net-force',
      points: simulation.states.flatMap((s) => {
        try {
          const p = toCanonicalVector(derivedVector(s.derived, 'total_momentum')).vectorSI
          return [{ t: s.time.value, value: Math.hypot(p.x, p.y) }]
        } catch {
          return []
        }
      }),
    }
    const energySeries: ChartSeries = {
      id: 'K-t',
      title: '总动能 K(t)',
      xLabel: 't / s',
      yLabel: 'K / J',
      role: 'trajectory',
      points: simulation.states.flatMap((s) => {
        try {
          return [{ t: s.time.value, value: derivedScalar(s.derived, 'total_kinetic_energy').value }]
        } catch {
          return []
        }
      }),
    }
    return [momentumSeries, energySeries]
  }

  private tableOf(simulation: CollisionSimulation): DataTableView {
    const columns = ['t / s', ...simulation.states[0]?.objects.map(o => o.id) ?? []]
    const rows = simulation.states.map((s, step) => ({
      step,
      values: [
        s.time.value.toFixed(2),
        ...s.objects.map((o) => {
          try {
            const raw = o.velocity ?? o.position
            if (raw === undefined) return '—'
            const v = toCanonicalVector(raw).vectorSI
            return Math.hypot(v.x, v.y).toFixed(2)
          } catch {
            return '—'
          }
        }),
      ],
    }))
    return { columns, rows }
  }

  private derivationOf(modelId: CollisionModelId): readonly DerivationStepView[] {
    const steps: DerivationStepView[] = [
      {
        id: 'momentum-conservation',
        title: '动量守恒',
        expression: 'm_1 v_1 + m_2 v_2 = \\text{const}',
        detail: '无外力时，碰撞冲量等大反向，系统总动量不变。',
      },
    ]
    if (modelId === 'elastic_collision') {
      steps.push({
        id: 'energy-conservation',
        title: '动能守恒',
        expression: '\\tfrac12 m_1 v_1^2 + \\tfrac12 m_2 v_2^2 = \\text{const}',
        detail: '完全弹性碰撞中无机械能损失。',
      })
    } else if (modelId === 'perfectly_inelastic_collision') {
      steps.push({
        id: 'stick-together',
        title: '完全非弹性碰撞',
        expression: 'v = \\frac{m_1 v_1 + m_2 v_2}{m_1 + m_2}',
        detail: '碰撞后两体粘合以共同速度运动，动能损失最大。',
      })
    } else {
      steps.push({
        id: 'restitution',
        title: '恢复系数',
        expression: 'e = -\\frac{v_1\' - v_2\'}{v_1 - v_2}',
        detail: '0 < e < 1：碰撞后相对速度缩小 e 倍，部分动能转化为内能。',
      })
    }
    return steps
  }

  private verificationOf(simulation: CollisionSimulation): readonly VerificationCheckView[] {
    return simulation.verification.checks.map(c => ({
      id: c.id,
      label: this.checkLabel(c.id),
      status: c.passed ? 'passed' : 'failed',
      ...(c.message === undefined ? {} : { detail: c.message }),
    }))
  }

  private checkLabel(id: string): string {
    switch (id) {
      case 'momentum_conservation':
        return '动量守恒'
      case 'energy_conservation':
        return '动能守恒'
      case 'energy_dissipated':
        return '动能损失'
      case 'restitution_in_range':
        return '恢复系数范围'
      case 'collision_body_valid':
        return '碰撞体参数有效'
      case 'collision_model_supported':
        return '模型前提'
      default:
        return id
    }
  }

  private eventsOf(simulation: CollisionSimulation): readonly TimelineEvent[] {
    return simulation.events.map((e, index) => ({
      id: `collision-${index}`,
      time: e.time ?? 0,
      label: `碰撞 ${e.bodyA} × ${e.bodyB}`,
      kind: 'impact' as const,
    }))
  }

  private failedSnapshot(
    scene: PhysicsScene,
    modelId: CollisionModelId,
    error: RuntimeErrorView,
  ): CollisionRuntimeSnapshot {
    return {
      scene,
      sceneRevision: scene.revision,
      modelId,
      status: 'failed',
      view: emptyVisualModel('mechanics'),
      tree: [],
      inspector: [],
      charts: [],
      table: { columns: [], rows: [] },
      derivation: [],
      verification: [],
      events: [],
      clock: { time: 0, total: 0, running: false, rate: this.playbackRate },
      trajectoryTimes: [],
      error,
    }
  }
}

/**
 * The collision runtime bridge helper `createCollisionRuntime`.
 * @returns the collision runtime bridge.
 * @param input - the caller-supplied fields.
 */
export const createCollisionRuntime = (
  input: CollisionSceneInput | PhysicsScene,
): CollisionRuntimeBridge => new CollisionRuntimeBridge(input)
