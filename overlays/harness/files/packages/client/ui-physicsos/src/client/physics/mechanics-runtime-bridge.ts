import {
  createMechanicsSimulationRequest,
  MechanicsEngine,
  detectMechanicsModel,
  resolveMechanicsModel,
  type MechanicsModel,
} from '@physicsos/engine-mechanics'
import {
  createMechanicsScene,
  createSceneCommand,
  SceneRuntime,
  type MechanicsModelId,
  type MechanicsSceneInput,
  type PhysicsEvent,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandResult,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { observeMechanicsScene } from '@physicsos/physics-observation'
import { verifyMechanicsSimulation } from '@physicsos/physics-verifier'

import { emptyVisualModel, type SceneVisualModel } from './scene-visual-model.ts'
import { forkExperimentalScene, requiresExperimentalFork } from './experimental-branch.ts'
import { buildSnapshot, inspectorOf, treeOf } from './mechanics-view-builders.ts'
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

type MechanicsSimulation = ReturnType<MechanicsEngine['simulate']>

/* -------------------------------------------------------------- snapshot --- */

export interface MechanicsRuntimeSnapshot {
  readonly scene: PhysicsScene
  readonly sceneRevision: number
  readonly modelId: MechanicsModelId
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
  /** Scene time in seconds at each trajectory sample, parallel to view path. */
  readonly trajectoryTimes: readonly number[]
  readonly error?: RuntimeErrorView
}

export interface MechanicsRuntimeCommandOutcome {
  readonly result: SceneCommandResult
  readonly snapshot: MechanicsRuntimeSnapshot
}

/* --------------------------------------------------------------- helpers --- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPhysicsScene = (value: MechanicsSceneInput | PhysicsScene): value is PhysicsScene =>
  isRecord(value) && value.schemaVersion === 'physics-scene/1.0' && Array.isArray(value.bodies)

const runtimeErrorOf = (error: unknown, model: MechanicsModelId): RuntimeErrorView => {
  const base = isRecord(error) && isRecord(error.domainError) ? error.domainError : error
  const code =
    isRecord(base) && typeof base.code === 'string' ? base.code : 'MECHANICS_RUNTIME_FAILED'
  const message =
    isRecord(base) && typeof base.message === 'string'
      ? base.message
      : '力学引擎无法处理当前场景。'
  /* Turn the raw engine code into something a student can act on, and always
     say WHAT model is affected rather than dumping the exception. */
  const explained =
    code === 'UNSUPPORTED_MODEL' || code === 'MODEL_UNSUPPORTED'
      ? unsupportedMessage(model)
      : code === 'INVALID_MODEL_CONDITION'
        ? '当前参数不满足该力学模型的前提条件，请检查质量、角度或初速度。'
        : message
  return {
    code,
    message: explained,
    retryable: isRecord(base) && base.retryable === true,
  }
}

const unsupportedMessage = (model: MechanicsModelId): string => {
  switch (model) {
    case 'inclined_plane':
      return '当前 V1 力学引擎暂不支持静摩擦平衡模型；请确认斜面上的物体处于运动或临界状态。'
    case 'projectile_motion':
      return '当前抛体参数超出 V1 力学引擎的支持范围，请检查初速度、抛射角与重力方向。'
    default:
      return '当前 V1 力学引擎暂不支持该运动模型。'
  }
}

/* ---------------------------------------------------------- observable id -- */

/**
 * Map a scene observable definition to a UI observable key.
 *
 * Every toggle the student can flip has a definition in the scene, so switching a
 * layer is a `SetObservableEnabled` command and an auditable event — never a CSS
 * hide that would leave the scene claiming something the canvas is not showing.
 */
const observableKeyOf = (type: string, kind?: unknown): ObservableKey | undefined => {
  if (type === 'velocity') return 'velocity'
  if (type === 'acceleration') return 'acceleration'
  if (type === 'trajectory') return 'trajectory'
  if (type === 'force') return 'forces'
  if (type === 'geometry') {
    if (kind === 'keypoints') return 'keyPoints'
    if (kind === 'velocity_components') return 'components'
    if (kind === 'force_decomposition') return 'decomposition'
  }
  return undefined
}

/* ----------------------------------------------------------------- bridge -- */

/**
 * The sole domain entry point for the Mechanics Physics Lab and mechanics
 * Question Space. UI components receive only the plain snapshot and callbacks;
 * they never import an engine, and every physical fact here comes from a
 * verified MechanicsEngine simulation.
 */
export class MechanicsRuntimeBridge {
  private sceneRuntime: SceneRuntime
  private readonly engine = new MechanicsEngine()
  private currentTime = 0
  private playbackRate = 1
  private running = false
  private commandSequence = 0
  private traceSequence = 0
  private highlighted: readonly string[] = []
  private snapshot!: MechanicsRuntimeSnapshot

  constructor(input: MechanicsSceneInput | PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(
      isPhysicsScene(input) ? input : createMechanicsScene(input),
    )
    this.recompute()
  }

  getSnapshot(): MechanicsRuntimeSnapshot {
    return this.snapshot
  }

  getEvents(): readonly PhysicsEvent[] {
    return this.sceneRuntime.getEvents()
  }

  /** Route an Inspector parameter edit to the matching scene command. */
  editParameter(id: string, value: number): MechanicsRuntimeSnapshot {
    if (!Number.isFinite(value)) return this.snapshot
    switch (id) {
      case 'mass':
        return this.setBodyMass(value).snapshot
      case 'height':
        return this.setInitialHeight(value).snapshot
      case 'gravity':
        return this.setGravity(value).snapshot
      case 'angle':
        return this.modelId() === 'inclined_plane'
          ? this.setInclineAngle(value).snapshot
          : this.setLaunchAngle(value).snapshot
      case 'speed':
        return this.setInitialSpeed(value, 'x').snapshot
      case 'friction':
        return this.setFriction(value).snapshot
      case 'force':
        return this.setAppliedForce(value).snapshot
      default:
        return this.snapshot
    }
  }

  /** Light up canvas primitives (e.g. from a clicked Known). */
  setHighlight(ids: readonly string[]): MechanicsRuntimeSnapshot {
    this.highlighted = ids
    return this.recompute()
  }

  private modelId(): MechanicsModelId {
    return detectMechanicsModel(this.sceneRuntime.getScene()) ?? 'uniform_linear_motion'
  }

  private dispatch(command: SceneCommand): MechanicsRuntimeCommandOutcome {
    const result = this.sceneRuntime.execute(command)
    if (result.ok) this.recompute()
    return { result, snapshot: this.snapshot }
  }

  private command<T extends SceneCommandType>(
    type: T,
    payload: SceneCommandPayloadMap[T],
  ): MechanicsRuntimeCommandOutcome {
    /* Changing a fact on a question scene forks first: the solution the student
       just read was verified against the original conditions. */
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
      this.currentTime = 0
      this.running = false
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    this.traceSequence += 1
    return this.dispatch(
      createSceneCommand<T>({
        commandId: `physicsos-mech-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `physicsos-mech-trace-${this.traceSequence}`,
      }) as SceneCommand,
    )
  }

  /** Discard the branch and return to the scene the question stated. */
  restoreOrigin(origin: PhysicsScene): MechanicsRuntimeSnapshot {
    this.sceneRuntime = new SceneRuntime(origin)
    this.currentTime = 0
    this.running = false
    this.highlighted = []
    return this.recompute()
  }

  setBodyMass(value: number): MechanicsRuntimeCommandOutcome {
    const bodyId = this.sceneRuntime.getScene().bodies[0]?.id ?? 'body-1'
    return this.command('SetBodyMass', { bodyId, mass: { value, unit: 'kg', dimension: 'mass' } })
  }

  setInitialSpeed(value: number, axis: 'x' | 'y'): MechanicsRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const current = body?.velocity.vector ?? { x: 0, y: 0, z: 0 }
    const vector = axis === 'x' ? { x: value, y: current.y, z: 0 } : { x: current.x, y: value, z: 0 }
    return this.command('SetBodyVelocity', {
      bodyId: body?.id ?? 'body-1',
      velocity: { vector, unit: 'm/s', dimension: 'velocity' },
    })
  }

  setInitialHeight(value: number): MechanicsRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const current = body?.position.vector ?? { x: 0, y: 0, z: 0 }
    return this.command('SetBodyPosition', {
      bodyId: body?.id ?? 'body-1',
      position: { vector: { x: current.x, y: value, z: 0 }, unit: 'm', dimension: 'length' },
    })
  }

  setGravity(value: number): MechanicsRuntimeCommandOutcome {
    const field = this.sceneRuntime.getScene().fields.find(f => f.type === 'uniform_gravity')
    return this.command('SetGravityAcceleration', {
      fieldId: field?.id ?? 'gravity-1',
      acceleration: { vector: { x: 0, y: -Math.abs(value), z: 0 }, unit: 'm/s^2', dimension: 'acceleration' },
    })
  }

  setLaunchAngle(degrees: number): MechanicsRuntimeCommandOutcome {
    /* Angle edits the velocity direction while keeping the current speed, so the
       change is a physical rotation of v₀, not an unrelated field. */
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const current = body?.velocity.vector ?? { x: 1, y: 0, z: 0 }
    const speed = Math.hypot(current.x, current.y) || 1
    const radians = (degrees * Math.PI) / 180
    return this.command('SetBodyVelocity', {
      bodyId: body?.id ?? 'body-1',
      velocity: {
        vector: { x: speed * Math.cos(radians), y: speed * Math.sin(radians), z: 0 },
        unit: 'm/s',
        dimension: 'velocity',
      },
    })
  }

  setInclineAngle(degrees: number): MechanicsRuntimeCommandOutcome {
    const obs = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(o => o.parameters?.['kind'] === 'incline')
    if (obs === undefined) return { result: this.noSuchTarget(), snapshot: this.snapshot }
    return this.command('SetInclineAngle', { observableId: obs.id, angleDegrees: degrees })
  }

  setFriction(coefficient: number): MechanicsRuntimeCommandOutcome {
    const bodyId = this.sceneRuntime.getScene().bodies[0]?.id ?? 'body-1'
    return this.command('SetFrictionCoefficient', { bodyId, coefficient })
  }

  setAppliedForce(value: number): MechanicsRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const existing = scene.forces.find(f => f.type === 'custom')
    return this.command('SetAppliedForce', {
      forceId: existing?.id ?? 'force-applied',
      targetId: body?.id ?? 'body-1',
      vector: { vector: { x: value, y: 0, z: 0 }, unit: 'N', dimension: 'force' },
    })
  }

  setObservableEnabled(key: ObservableKey, enabled: boolean): MechanicsRuntimeSnapshot {
    /* Every layer, including velocity components and force decomposition, is a
       scene observable, so the toggle goes through the command gate and produces
       an ObservableEnabled/Disabled event. */
    const scene = this.sceneRuntime.getScene()
    const definition = scene.observableDefinitions.find(
      o => observableKeyOf(o.type, o.parameters?.['kind']) === key,
    )
    if (definition === undefined) return this.snapshot
    this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    return this.snapshot
  }

  setRunning(running: boolean): MechanicsRuntimeSnapshot {
    this.running = running
    return this.recompute()
  }

  setPlaybackRate(rate: number): MechanicsRuntimeSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.playbackRate = rate
    return this.recompute()
  }

  seek(seconds: number): MechanicsRuntimeSnapshot {
    const total = this.snapshot.clock.total
    this.currentTime = Number.isFinite(seconds) ? Math.min(total, Math.max(0, seconds)) : 0
    this.running = false
    return this.recompute()
  }

  step(deltaSeconds: number): MechanicsRuntimeSnapshot {
    return this.seek(this.currentTime + deltaSeconds)
  }

  advance(wallClockSeconds: number): MechanicsRuntimeSnapshot {
    const total = this.snapshot.clock.total
    if (this.running && Number.isFinite(wallClockSeconds) && total > 0) {
      const next = this.currentTime + wallClockSeconds * this.playbackRate
      /* Motion stops at impact rather than looping: a projectile does not restart
         in mid-air. Cyclic models (linear/incline over a nominal window) loop. */
      this.currentTime = next >= total ? total : next
      if (this.currentTime >= total) this.running = false
    }
    return this.recompute()
  }

  private noSuchTarget(): SceneCommandResult {
    return {
      ok: false,
      error: {
        code: 'MECHANICS_TARGET_ABSENT',
        message: 'The scene has no target for this parameter.',
        category: 'not_found',
        retryable: false,
        details: {},
      },
      traceId: 'physicsos-mech-trace-0' as never,
    }
  }

  recompute(): MechanicsRuntimeSnapshot {
    const scene = this.sceneRuntime.getScene()
    const modelId = detectMechanicsModel(scene) ?? 'uniform_linear_motion'
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.snapshot = this.failedSnapshot(scene, modelId, {
          code: 'UNSUPPORTED_MODEL',
          message: unsupportedMessage(modelId),
          retryable: false,
        })
        return this.snapshot
      }

      const request = createMechanicsSimulationRequest(
        scene,
        `mech-sim-${scene.revision}`,
        `physicsos-mech-${scene.revision}-${this.traceSequence}`,
      )
      const simulation = this.engine.simulate(scene, request)
      const verification = verifyMechanicsSimulation(scene, simulation)
      const status: RuntimeStatus =
        simulation.verification.status === 'failed' || verification.status === 'failed'
          ? 'failed'
          : simulation.verification.status === 'passed_with_warnings' ||
              verification.status === 'passed_with_warnings'
            ? 'warning'
            : 'verified'

      if (status === 'failed') {
        this.snapshot = this.failedSnapshot(scene, modelId, {
          code: 'PHYSICS_VERIFICATION_FAILED',
          message: '力学仿真未通过物理一致性校验。',
          retryable: false,
        })
        return this.snapshot
      }

      const model = resolveMechanicsModel(scene)
      const total = this.durationOf(model, simulation)
      if (this.currentTime > total) this.currentTime = total

      const state = this.engine.stateAt(scene, { value: this.currentTime, unit: 's', dimension: 'time' })
      const observations = observeMechanicsScene({ scene, simulation, state })
      const visibility = this.visibilityOf(scene)

      const built = buildSnapshot({
        scene,
        modelId,
        model,
        simulation,
        state,
        observations,
        verification,
        visibility,
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
      this.snapshot = this.failedSnapshot(scene, modelId, runtimeErrorOf(error, modelId))
      return this.snapshot
    }
  }

  private durationOf(model: MechanicsModel, simulation: MechanicsSimulation): number {
    if (model.modelId === 'projectile_motion') return model.flightTime > 0 ? model.flightTime : 10
    const last = simulation.states[simulation.states.length - 1]
    return last?.time.value ?? 10
  }

  private visibilityOf(scene: PhysicsScene): Partial<Record<ObservableKey, boolean>> {
    const visibility: Partial<Record<ObservableKey, boolean>> = {}
    for (const definition of scene.observableDefinitions) {
      const key = observableKeyOf(definition.type, definition.parameters?.['kind'])
      if (key !== undefined) visibility[key] = definition.visible
    }
    return visibility
  }

  private failedSnapshot(
    scene: PhysicsScene,
    modelId: MechanicsModelId,
    error: RuntimeErrorView,
  ): MechanicsRuntimeSnapshot {
    return {
      scene,
      sceneRevision: scene.revision,
      modelId,
      status: 'failed',
      view: emptyVisualModel('mechanics'),
      tree: treeOf(scene, modelId),
      inspector: inspectorOf(scene, modelId, undefined),
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

export const createMechanicsRuntime = (
  input: MechanicsSceneInput | PhysicsScene,
): MechanicsRuntimeBridge => new MechanicsRuntimeBridge(input)
