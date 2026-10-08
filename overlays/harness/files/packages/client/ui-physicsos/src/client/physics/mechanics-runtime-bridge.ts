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
import { runtimeStatusOf } from './verified-result.ts'
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

/** Scene-derived facts that only change when the scene itself changes. */
interface MechanicsSimulationCache {
  readonly sceneRevision: number
  readonly simulation: MechanicsSimulation
  readonly verification: ReturnType<typeof verifyMechanicsSimulation>
  readonly status: RuntimeStatus
}

/* -------------------------------------------------------------- snapshot --- */

/**
 * The mechanics runtime snapshot shape used by the mechanics runtime bridge module.
 */
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

/**
 * The mechanics runtime command outcome shape used by the mechanics runtime bridge module.
 */
export interface MechanicsRuntimeCommandOutcome {
  readonly result: SceneCommandResult
  readonly snapshot: MechanicsRuntimeSnapshot
}

/* --------------------------------------------------------------- helpers --- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPhysicsScene = (value: MechanicsSceneInput | PhysicsScene): value is PhysicsScene =>
  isRecord(value) && value.schemaVersion === 'physics-scene/1.0' && Array.isArray(value.bodies)

/* Models whose run window is nominal — nothing physical terminates at the
   clock edge, so playback loops back to t = 0 and keeps going. Models left out
   end on a real event (projectile impact) or on the finished reading itself
   (the filled v–t area), so they stop instead. */
const CYCLIC_MODELS: ReadonlySet<MechanicsModelId> = new Set([
  'uniform_linear_motion',
  'inclined_plane',
  'newton_second_law',
  /* Oscillators never stop: the period IS the demo, so the playhead wraps. */
  'spring_oscillator',
  'simple_pendulum',
])

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
  /** Simulation of the current scene revision, reused across clock frames. */
  private simulationCache: MechanicsSimulationCache | undefined

  constructor(input: MechanicsSceneInput | PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(
      isPhysicsScene(input) ? input : createMechanicsScene(input),
    )
    this.recompute()
  }

  /**
   * Get snapshot.
   * @returns the mechanics runtime snapshot.
   */
  getSnapshot(): MechanicsRuntimeSnapshot {
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
   * Route an Inspector parameter edit to the matching scene command.
   * @returns the mechanics runtime snapshot.
   * @param value - the new value.
   * @param id - the target row id.
   * @returns the mechanics runtime snapshot.
   */
  editParameter(id: string, value: number): MechanicsRuntimeSnapshot {
    if (!Number.isFinite(value)) return this.snapshot
    switch (id) {
      case 'mass':
      case 'gravity':
      case 'springConstant': {
        /* A statics rig reports the SETTLED state: editing m, g or k moves the
           equilibrium, so re-seat the body there as a second auditable command
           instead of leaving it stranded off-balance and unverified. */
        const primary =
          id === 'mass'
            ? this.setBodyMass(value)
            : id === 'gravity'
              ? this.setGravity(value)
              : this.setSpringConstant(value)
        if (primary.result.ok && this.modelId() === 'spring_statics') {
          const reseat = this.resettleStatics()
          if (reseat !== undefined) return reseat.snapshot
        }
        return primary.snapshot
      }
      case 'height':
        return this.setInitialHeight(value).snapshot
      case 'angle':
        return this.modelId() === 'inclined_plane'
          ? this.setInclineAngle(value).snapshot
          : this.setLaunchAngle(value).snapshot
      case 'speed':
        return this.setInitialSpeed(value, 'x').snapshot
      case 'friction':
        return this.setFriction(value).snapshot
      case 'staticFriction':
        return this.setStaticFriction(value).snapshot
      case 'force':
        return this.setAppliedForce(value).snapshot
      case 'pendulumLength':
        return this.setPendulumLength(value).snapshot
      case 'amplitude':
        return this.setAmplitude(value).snapshot
      default:
        return this.snapshot
    }
  }

  /**
   * Light up canvas primitives (e.g. from a clicked Known)
   * @returns the mechanics runtime snapshot.
   * @param ids - the target row ids.
   * @returns the mechanics runtime snapshot.
   */
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
        commandId: `physicsos-mech-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `physicsos-mech-trace-${this.traceSequence}`,
      }) as SceneCommand,
    )
  }

  /**
   * Discard the branch and return to the scene the question stated.
   * @returns the mechanics runtime snapshot.
   * @param origin - the origin point.
   * @returns the mechanics runtime snapshot.
   */
  restoreOrigin(origin: PhysicsScene): MechanicsRuntimeSnapshot {
    this.sceneRuntime = new SceneRuntime(origin)
    this.simulationCache = undefined
    this.currentTime = 0
    this.running = false
    this.highlighted = []
    return this.recompute()
  }

  /**
   * Set body mass.
   * @param value - the new value.
   * @returns the mechanics runtime command outcome.
   */
  setBodyMass(value: number): MechanicsRuntimeCommandOutcome {
    const bodyId = this.sceneRuntime.getScene().bodies[0]?.id ?? 'body-1'
    return this.command('SetBodyMass', { bodyId, mass: { value, unit: 'kg', dimension: 'mass' } })
  }

  /**
   * Set initial speed.
   * @param value - the new value.
   * @param axis - the axis.
   * @returns the mechanics runtime command outcome.
   */
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

  /**
   * Set initial height.
   * @param value - the new value.
   * @returns the mechanics runtime command outcome.
   */
  setInitialHeight(value: number): MechanicsRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const current = body?.position.vector ?? { x: 0, y: 0, z: 0 }
    return this.command('SetBodyPosition', {
      bodyId: body?.id ?? 'body-1',
      position: { vector: { x: current.x, y: value, z: 0 }, unit: 'm', dimension: 'length' },
    })
  }

  /**
   * Set gravity.
   * @param value - the new value.
   * @returns the mechanics runtime command outcome.
   */
  setGravity(value: number): MechanicsRuntimeCommandOutcome {
    const field = this.sceneRuntime.getScene().fields.find(f => f.type === 'uniform_gravity')
    return this.command('SetGravityAcceleration', {
      fieldId: field?.id ?? 'gravity-1',
      acceleration: { vector: { x: 0, y: -Math.abs(value), z: 0 }, unit: 'm/s^2', dimension: 'acceleration' },
    })
  }

  /**
   * Set launch angle.
   * @param degrees - the degrees.
   * @returns the mechanics runtime command outcome.
   */
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

  /**
   * Set incline angle.
   * @param degrees - the degrees.
   * @returns the mechanics runtime command outcome.
   */
  setInclineAngle(degrees: number): MechanicsRuntimeCommandOutcome {
    const obs = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(o => o.parameters?.['kind'] === 'incline')
    if (obs === undefined) return { result: this.noSuchTarget(), snapshot: this.snapshot }
    return this.command('SetInclineAngle', { observableId: obs.id, angleDegrees: degrees })
  }

  /**
   * Set friction.
   * @param coefficient - the coefficient.
   * @returns the mechanics runtime command outcome.
   */
  setFriction(coefficient: number): MechanicsRuntimeCommandOutcome {
    const bodyId = this.sceneRuntime.getScene().bodies[0]?.id ?? 'body-1'
    return this.command('SetFrictionCoefficient', { bodyId, coefficient })
  }

  /**
   * Set static friction.
   * @param coefficient - the coefficient.
   * @returns the mechanics runtime command outcome.
   */
  setStaticFriction(coefficient: number): MechanicsRuntimeCommandOutcome {
    const bodyId = this.sceneRuntime.getScene().bodies[0]?.id ?? 'body-1'
    return this.command('SetStaticFrictionCoefficient', { bodyId, coefficient })
  }

  /**
   * Set spring constant.
   * @param constant - the constant.
   * @returns the mechanics runtime command outcome.
   */
  setSpringConstant(constant: number): MechanicsRuntimeCommandOutcome {
    const spring = this.sceneRuntime.getScene().constraints.find(c => c.type === 'spring')
    if (spring === undefined) return { result: this.noSuchTarget(), snapshot: this.snapshot }
    return this.command('SetSpringConstant', { constraintId: spring.id, constant })
  }

  /* On a vertical statics rig the drawn position IS the equilibrium claim:
     after m, g or k changes, move the body to x_eq = anchor − L0 − mg/k so the
     scene stays a verified balance instead of an off-equilibrium contradiction. */
  private resettleStatics(): MechanicsRuntimeCommandOutcome | undefined {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const spring = scene.constraints.find(c => c.type === 'spring')
    const field = scene.fields.find(f => f.type === 'uniform_gravity')
    if (body === undefined || spring === undefined || field === undefined) {
      return undefined
    }
    const anchor = spring.parameters['anchor'] as { x?: number; y?: number } | undefined
    const natural = Number(spring.parameters['naturalLength'] ?? 0)
    const stiffness = Number(spring.parameters['stiffness'] ?? 0)
    if (stiffness <= 0) return undefined
    const g = Math.abs(field.acceleration.vector.y)
    const extension = (body.mass.value * g) / stiffness
    const position = {
      x: anchor?.x ?? 0,
      y: (anchor?.y ?? 0) - natural - extension,
      z: 0,
    }
    const current = body.position.vector
    if (Math.hypot(position.x - current.x, position.y - current.y) < 1e-9) {
      return undefined
    }
    return this.command('SetBodyPosition', {
      bodyId: body.id,
      position: { vector: position, unit: 'm', dimension: 'length' },
    })
  }

  /**
   * Set pendulum length.
   * @param length - the length.
   * @returns the mechanics runtime command outcome.
   */
  setPendulumLength(length: number): MechanicsRuntimeCommandOutcome {
    const rope = this.sceneRuntime.getScene().constraints.find(c => c.type === 'rope')
    if (rope === undefined) return { result: this.noSuchTarget(), snapshot: this.snapshot }
    return this.command('SetPendulumLength', { constraintId: rope.id, length })
  }

  /**
   * Release offset: where the oscillator/bob starts, read off the constraint axis
   * @returns the mechanics runtime command outcome.
   * @param offset - the offset.
   * @returns the mechanics runtime command outcome.
   */
  setAmplitude(offset: number): MechanicsRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const body = scene.bodies[0]
    const spring = scene.constraints.find(c => c.type === 'spring')
    const rope = scene.constraints.find(c => c.type === 'rope')
    if (body === undefined) return { result: this.noSuchTarget(), snapshot: this.snapshot }
    if (spring !== undefined) {
      const anchor = spring.parameters['anchor'] as { x?: number; y?: number } | undefined
      const natural = Number(spring.parameters['naturalLength'] ?? 0)
      const ax = anchor?.x ?? 0
      const ay = anchor?.y ?? 0
      const position =
        spring.parameters['axis'] === 'vertical'
          ? { x: ax, y: ay - natural - offset, z: 0 }
          : { x: ax + natural + offset, y: ay, z: 0 }
      return this.command('SetBodyPosition', {
        bodyId: body.id,
        position: { vector: position, unit: 'm', dimension: 'length' },
      })
    }
    if (rope !== undefined) {
      /* Pendulum amplitude is an angle: swing the bob to `offset` degrees from
         vertical while keeping it on the string circle. */
      const pivot = rope.parameters['pivot'] as { x?: number; y?: number } | undefined
      const length = Number(rope.parameters['length'] ?? 1)
      const radians = (offset * Math.PI) / 180
      const px = pivot?.x ?? 0
      const py = pivot?.y ?? 0
      return this.command('SetBodyPosition', {
        bodyId: body.id,
        position: {
          vector: {
            x: px + length * Math.sin(radians),
            y: py - length * Math.cos(radians),
            z: 0,
          },
          unit: 'm',
          dimension: 'length',
        },
      })
    }
    return { result: this.noSuchTarget(), snapshot: this.snapshot }
  }

  /**
   * Set applied force.
   * @param value - the new value.
   * @returns the mechanics runtime command outcome.
   */
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

  /**
   * Set observable enabled.
   * @param key - the key.
   * @param enabled - the enabled.
   * @returns the mechanics runtime snapshot.
   */
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

  /**
   * Set running.
   * @param running - the running.
   * @returns the mechanics runtime snapshot.
   */
  setRunning(running: boolean): MechanicsRuntimeSnapshot {
    const total = this.snapshot.clock.total
    /* Replay contract shared with every finite runtime: pressing run after the
       clock reached the end restarts from t = 0 instead of dead-ending on the
       first advanced frame. */
    if (running && total > 0 && this.currentTime >= total) this.currentTime = 0
    this.running = running
    return this.recompute()
  }

  /**
   * Set playback rate.
   * @param rate - the rate.
   * @returns the mechanics runtime snapshot.
   */
  setPlaybackRate(rate: number): MechanicsRuntimeSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.playbackRate = rate
    return this.recompute()
  }

  /**
   * The seek of the mechanics runtime bridge module.
   * @param seconds - the time in seconds.
   * @returns the mechanics runtime snapshot.
   */
  seek(seconds: number): MechanicsRuntimeSnapshot {
    const total = this.snapshot.clock.total
    this.currentTime = Number.isFinite(seconds) ? Math.min(total, Math.max(0, seconds)) : 0
    this.running = false
    return this.recompute()
  }

  /**
   * The step of the mechanics runtime bridge module.
   * @param deltaSeconds - the delta seconds.
   * @returns the mechanics runtime snapshot.
   */
  step(deltaSeconds: number): MechanicsRuntimeSnapshot {
    return this.seek(this.currentTime + deltaSeconds)
  }

  /**
   * The advance of the mechanics runtime bridge module.
   * @param wallClockSeconds - the wall clock seconds.
   * @returns the mechanics runtime snapshot.
   */
  advance(wallClockSeconds: number): MechanicsRuntimeSnapshot {
    const total = this.snapshot.clock.total
    if (this.running && Number.isFinite(wallClockSeconds) && total > 0) {
      const next = this.currentTime + wallClockSeconds * this.playbackRate
      if (next >= total) {
        /* Nominal-window demos (linear / incline / newton) loop: nothing physical
           ends at the clock edge, so the bench keeps breathing. A projectile
           stops at impact — it does not restart in mid-air — and a uniformly
           accelerated run stops too, because the finished v–t area IS the
           reading the student takes. */
        if (CYCLIC_MODELS.has(this.snapshot.modelId)) {
          this.currentTime = next % total
        } else {
          this.currentTime = total
          this.running = false
        }
      } else {
        this.currentTime = next
      }
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

  /**
   * The recompute of the mechanics runtime bridge module.
   * @returns the mechanics runtime snapshot.
   */
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

      /* One simulation per scene revision: the analytical engine is exact at any
         t, so replaying it every animation frame recomputed 65 states, derived
         quantities and the verification for identical values. That per-frame work
         — not the renderer — is what made playback stutter. A command bumps the
         revision and misses the cache. */
      const cached = this.simulationCache
      const fresh = cached === undefined || cached.sceneRevision !== scene.revision
      const simulation = fresh
        ? this.engine.simulate(
          scene,
          createMechanicsSimulationRequest(
            scene,
            `mech-sim-${scene.revision}`,
            `physicsos-mech-${scene.revision}-${this.traceSequence}`,
          ),
        )
        : cached.simulation
      const verification = fresh ? verifyMechanicsSimulation(scene, simulation) : cached.verification
      /* Both the engine's own verification and the mechanics verifier must
         reach the verified floor from their checks; either one failing fails the
         frame, and anything weaker than a real passed check warns rather than
         painting a green verified badge over unsupported evidence. */
      const engineStatus = runtimeStatusOf(simulation.verification)
      const verifierStatus = runtimeStatusOf(verification)
      const status: RuntimeStatus =
        engineStatus === 'failed' || verifierStatus === 'failed'
          ? 'failed'
          : engineStatus === 'verified' && verifierStatus === 'verified'
            ? 'verified'
            : 'warning'
      this.simulationCache = { sceneRevision: scene.revision, simulation, verification, status }

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

/**
 * The mechanics runtime bridge helper `createMechanicsRuntime`.
 * @returns the mechanics runtime bridge.
 * @param input - the caller-supplied fields.
 */
export const createMechanicsRuntime = (
  input: MechanicsSceneInput | PhysicsScene,
): MechanicsRuntimeBridge => new MechanicsRuntimeBridge(input)
