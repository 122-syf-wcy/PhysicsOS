import {
  LIGHT_SPEED,
  ModernPhysicsEngine,
  createModernSimulationRequest,
} from '@physicsos/engine-modern'
import type { SimulationRequest, SimulationResult, SimulationState } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createSceneCommand,
  deepFreeze,
  type ModernPhysicsBench,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import type { CapturedResult, JsonObject } from '@physicsos/physics-workbench/types'

import { branchBadgeOf, forkExperimentalScene, requiresExperimentalFork } from './experimental-branch.ts'
import { modernDerivedRows, modernSceneVisual } from './modern-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import { runtimeStatusOf } from './verified-result.ts'
import type { InspectorSection, ObservableKey, RuntimeErrorView, SceneTreeNode } from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const staticClock = () => ({ time: 0, total: 0, running: false, rate: 1 })

const quantityLabel = (value: unknown): string => {
  if (value === null || typeof value !== 'object' || !('value' in value) || !('unit' in value)) return '—'
  return typeof value.value === 'number' && Number.isFinite(value.value) && typeof value.unit === 'string'
    ? `${value.value.toExponential(2)} ${value.unit}`
    : '—'
}

const observableKeyOf = (type: string): ObservableKey | undefined => {
  if (type === 'energy') return 'photonEnergy'
  if (type === 'current') return 'photocurrent'
  if (type === 'voltage') return 'stoppingPotential'
  return undefined
}

const errorOf = (error: unknown, fallbackCode: string): RuntimeErrorView => ({
  code: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallbackCode,
  message: error instanceof Error ? error.message : 'Modern physics runtime failed.',
  retryable: false,
})

export class ModernPhysicsWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new ModernPhysicsEngine()
  private readonly origin: PhysicsScene | undefined
  private heldScene: PhysicsScene
  private request: SimulationRequest | undefined
  private simulation: SimulationResult | undefined
  private state: SimulationState | undefined
  private modelId: string | undefined
  private failure: RuntimeErrorView | undefined
  private commandFailure: RuntimeErrorView | undefined
  private diagnostics: readonly JsonObject[] = []
  private sequence = 0
  private highestRevision: number
  private highlighted: readonly string[] = []

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    this.heldScene = this.sceneRuntime.peekScene()
    this.origin = scene.metadata.sourceQuestionId === undefined || branchBadgeOf(scene) !== undefined
      ? undefined
      : deepFreeze(structuredClone(scene))
    this.highestRevision = scene.revision
    this.recompute()
  }

  private recompute(): void {
    const scene = this.sceneRuntime.peekScene()
    this.heldScene = scene
    this.request = undefined
    this.simulation = undefined
    this.state = undefined
    this.modelId = undefined
    this.failure = undefined
    this.diagnostics = []
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = {
          code: 'MODERN_UNSUPPORTED_SCENE',
          message: support.failedConditions.map(entry => entry.message).join(' '),
          retryable: false,
        }
        this.diagnostics = support.failedConditions.map(entry => ({
          code: entry.condition,
          message: entry.message,
        }))
        return
      }
      this.modelId = support.modelId
      const request = createModernSimulationRequest(
        scene,
        `modern-lab-${String(scene.id)}-${scene.revision}`,
        `modern-lab-trace-${String(scene.id)}-${scene.revision}`,
      )
      // A static operating point is not a time history. These are the real options sent to the engine.
      request.options = { startTime: quantity(0, 's', 'time'), endTime: quantity(0, 's', 'time') }
      this.request = request
      const simulation = this.engine.simulate(scene, request)
      this.simulation = deepFreeze(structuredClone(simulation))
      this.request = deepFreeze(structuredClone(request))
      this.state = Array.isArray(this.simulation.states) ? this.simulation.states[0] : undefined
      const identityMatches =
        request.schemaVersion === 'simulation-request/1.0' &&
        request.sceneId === scene.id && request.sceneRevision === scene.revision &&
        (request.trace.sceneId === undefined || request.trace.sceneId === scene.id) &&
        (request.trace.sceneRevision === undefined || request.trace.sceneRevision === scene.revision) &&
        simulation.schemaVersion === 'simulation-result/1.0' &&
        simulation.simulationId === request.simulationId &&
        simulation.sceneId === scene.id &&
        simulation.sceneRevision === scene.revision &&
        simulation.trace?.traceId === request.trace.traceId &&
        (simulation.trace.sceneId === undefined || simulation.trace.sceneId === scene.id) &&
        (simulation.trace.sceneRevision === undefined || simulation.trace.sceneRevision === scene.revision) &&
        simulation.metadata?.engineId === this.engine.engineId &&
        simulation.metadata.engineVersion === this.engine.engineVersion &&
        Array.isArray(simulation.states) &&
        Array.isArray(simulation.events) &&
        Array.isArray(simulation.measurements) &&
        Array.isArray(simulation.derivedQuantities) &&
        Array.isArray(simulation.verification?.checks) &&
        simulation.verification.checks.every(check => check !== null && typeof check === 'object' && typeof check.id === 'string' && typeof check.type === 'string' && typeof check.passed === 'boolean') &&
        Array.isArray(simulation.verification.warnings) &&
        simulation.verification.warnings.every(issue => issue !== null && typeof issue === 'object' && typeof issue.code === 'string' && typeof issue.message === 'string' && issue.severity === 'warning') &&
        Array.isArray(simulation.verification.errors) &&
        simulation.verification.errors.every(issue => issue !== null && typeof issue === 'object' && typeof issue.code === 'string' && typeof issue.message === 'string' && issue.severity === 'error') &&
        ['passed', 'passed_with_warnings', 'failed'].includes(simulation.verification.status)
      if (!identityMatches) {
        this.failure = {
          code: 'MODERN_SIMULATION_IDENTITY_MISMATCH',
          message: 'Modern SimulationResult does not match its scene, request, trace or engine.',
          retryable: false,
        }
        this.diagnostics = [{
          code: this.failure.code,
          expectedSceneId: String(scene.id),
          expectedSceneRevision: scene.revision,
          expectedSimulationId: String(request.simulationId),
        }]
      } else if (
        simulation.verification.status === 'failed' ||
        simulation.verification.errors.length > 0 ||
        simulation.verification.checks.some(check => !check.passed)
      ) {
        this.failure = {
          code: 'MODERN_SIMULATION_FAILED',
          message: simulation.verification.errors.map(entry => entry.message).join(' ') ||
            simulation.verification.checks.filter(entry => !entry.passed).map(entry => entry.message ?? entry.id).join(' '),
          retryable: false,
        }
        this.diagnostics = [{ code: this.failure.code, verificationStatus: simulation.verification.status }]
      }
    } catch (error: unknown) {
      this.failure = errorOf(error, 'MODERN_RUNTIME_FAILED')
      this.diagnostics = [{ code: this.failure.code, message: this.failure.message }]
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    const current = this.sceneRuntime.peekScene()
    const target = requiresExperimentalFork(current, type)
      ? new SceneRuntime(forkExperimentalScene({ scene: current }))
      : this.sceneRuntime
    const scene = target.peekScene()
    this.sequence += 1
    const result = target.execute(createSceneCommand<T>({
      commandId: `modern-ui-command-${this.sequence}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `modern-ui-trace-${this.sequence}`,
    }) as SceneCommand)
    if (!result.ok) {
      this.commandFailure = {
        code: result.error.code,
        message: result.error.message,
        retryable: result.error.retryable,
      }
      return
    }
    // Rejection must leave both the original identity and its held evidence untouched.
    this.sceneRuntime = target
    this.highestRevision = Math.max(this.highestRevision, result.newRevision)
    this.commandFailure = undefined
    this.recompute()
  }

  private treeOf(scene: PhysicsScene): readonly SceneTreeNode[] {
    const bench = scene.modernPhysicsBenches?.[0]
    if (bench === undefined) return []
    return [
      {
        id: 'bench',
        label: '光电效应装置',
        icon: 'folder',
        kind: 'group',
        children: [
          {
            id: bench.id,
            label: '金属阴极与单色光',
            secondary: `W = ${quantityLabel(bench.workFunction)} · λ = ${quantityLabel(bench.photonWavelength)}`,
            icon: 'field',
            kind: 'object',
          },
        ],
      },
      {
        id: 'observables',
        label: '可观察量',
        icon: 'folder',
        kind: 'group',
        children: scene.observableDefinitions.map(definition => {
          const observable = observableKeyOf(definition.type)
          return {
            id: String(definition.id),
            label: String(definition.id),
            icon: 'observable' as const,
            kind: 'observable' as const,
            ...(observable === undefined ? {} : { observable }),
          }
        }),
      },
    ]
  }

  private inspectorOf(bench: ModernPhysicsBench | undefined): readonly InspectorSection[] {
    if (bench === undefined) return []
    try {
      const wavelength = canonicalValue(bench.photonWavelength)
      const frequency = LIGHT_SPEED / wavelength
      return [{
        id: 'photoelectric-conditions',
        title: '光电效应条件',
        parameters: [
          { id: 'workFunction', label: '阴极逸出功', symbol: 'W', unit: 'J', value: canonicalValue(bench.workFunction), min: Number.MIN_VALUE, step: 1e-20 },
          { id: 'photonWavelength', label: '入射光波长', symbol: 'λ', unit: 'm', value: wavelength, min: Number.MIN_VALUE, step: 1e-9 },
          ...(Number.isFinite(frequency) && frequency > 0 ? [
            { id: 'photonFrequency', label: '入射光频率', symbol: 'f', unit: 'Hz', value: frequency, min: Number.MIN_VALUE, step: 1e12 },
          ] : []),
          { id: 'lightIntensity', label: '入射光强', symbol: 'I', unit: 'W/m²', value: canonicalValue(bench.lightIntensity), min: Number.MIN_VALUE, step: 0.1 },
          { id: 'cathodeArea', label: '受光阴极面积', symbol: 'A', unit: 'm²', value: canonicalValue(bench.cathodeArea), min: Number.MIN_VALUE, step: 1e-5 },
          { id: 'quantumEfficiency', label: '量子效率', symbol: 'η', unit: '', value: bench.quantumEfficiency, min: 0, max: 1, step: 0.01 },
        ],
      }]
    } catch {
      return []
    }
  }

  getScene(): PhysicsScene {
    return this.sceneRuntime.getScene()
  }

  captureRaw(): CapturedResult {
    const scene = this.heldScene
    return deepFreeze(structuredClone({
      scene,
      ...(this.request === undefined ? {} : { request: this.request }),
      ...(this.simulation === undefined ? {} : { result: this.simulation }),
      ...(this.state === undefined ? {} : { state: this.state }),
      clock: staticClock(),
      cursor: { kind: 'static' as const, identity: `${String(scene.id)}@${scene.revision}` },
      engineInfo: {
        id: this.engine.engineId,
        version: this.engine.engineVersion,
        ...(this.modelId === undefined ? {} : { model: this.modelId }),
        ...(scene.metadata.experimentRelease === undefined ? {} : { release: scene.metadata.experimentRelease }),
      },
      diagnostics: [
        ...this.diagnostics,
        ...(this.commandFailure === undefined ? [] : [{ code: this.commandFailure.code, message: this.commandFailure.message }]),
      ],
    }))
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.peekScene()
    const title = scene.metadata.title ?? '光电效应'
    const badge = branchBadgeOf(scene)
    const error = this.commandFailure ?? this.failure
    const simulation = this.simulation
    const base = {
      domain: 'modern' as const,
      title,
      subtitle: scene.metadata.description ?? '真实近代物理 Runtime',
      sceneRevision: scene.revision,
      tree: this.treeOf(scene),
      inspector: this.inspectorOf(scene.modernPhysicsBenches?.[0]),
      charts: [],
      table: { columns: [], rows: [] },
      verification: simulation !== undefined && Array.isArray(simulation.verification?.checks) ? simulation.verification.checks.filter(check => check !== null && typeof check === 'object').map(check => ({
        id: check.id,
        label: check.id,
        status: (check.passed ? 'passed' : 'failed') as 'passed' | 'failed',
        ...(check.message === undefined ? {} : { detail: check.message }),
      })) : [],
      events: [],
      clock: staticClock(),
      trajectoryTimes: [],
      ...(badge === undefined ? {} : {
        branch: {
          originQuestionTitle: this.origin?.metadata.title,
          parentRevision: badge.parentRevision,
          canRestore: this.origin !== undefined,
        },
      }),
    }
    if (simulation === undefined || this.failure !== undefined) {
      return {
        ...base,
        status: 'failed',
        view: emptyVisualModel('modern'),
        ariaLabel: title,
        derivation: [],
        error: error ?? {
          code: 'MODERN_RUNTIME_FAILED',
          message: '当前场景不满足 Modern Physics Engine 的前提条件。',
          retryable: false,
        },
      }
    }
    // The bridge labels SI magnitudes; only this presentation copy is canonicalized.
    const visualScene = {
      ...scene,
      modernPhysicsBenches: (scene.modernPhysicsBenches ?? []).map(bench => ({
        ...bench,
        workFunction: quantity(canonicalValue(bench.workFunction), 'J', 'energy'),
        photonWavelength: quantity(canonicalValue(bench.photonWavelength), 'm', 'length'),
      })),
    }
    return {
      ...base,
      status: error === undefined ? runtimeStatusOf(simulation.verification) : 'failed',
      view: {
        ...modernSceneVisual(visualScene, simulation),
        ...(this.highlighted.length === 0 ? {} : { highlighted: this.highlighted }),
      },
      ariaLabel: `${title}的可验证物理画布`,
      derivation: modernDerivedRows(simulation),
      ...(error === undefined ? {} : { error }),
    }
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const bench = this.sceneRuntime.peekScene().modernPhysicsBenches?.[0]
    if (bench === undefined) return this.getSnapshot()
    try {
      if (id === 'workFunction') {
        this.command('SetPhotoelectricWorkFunction', { benchId: bench.id, workFunction: quantity(value, 'J', 'energy') })
      } else if (id === 'photonWavelength' || id === 'wavelength') {
        this.command('SetPhotonWavelength', { benchId: bench.id, wavelength: quantity(value, 'm', 'length') })
      } else if (id === 'photonFrequency' || id === 'frequency') {
        if (!Number.isFinite(value) || value <= 0) throw new RangeError('Photon frequency must be finite and > 0.')
        this.command('SetPhotonWavelength', { benchId: bench.id, wavelength: quantity(LIGHT_SPEED / value, 'm', 'length') })
      } else if (id === 'lightIntensity' || id === 'intensity') {
        this.command('SetLightIntensity', { benchId: bench.id, intensity: quantity(value, 'W/m²', 'intensity') })
      } else if (id === 'cathodeArea' || id === 'area') {
        this.command('SetCathodeArea', { benchId: bench.id, area: quantity(value, 'm²', 'area') })
      } else if (id === 'quantumEfficiency') {
        this.command('SetQuantumEfficiency', { benchId: bench.id, efficiency: value })
      } else {
        throw new RangeError(`Unknown modern-physics parameter "${id}".`)
      }
    } catch (error: unknown) {
      this.commandFailure = errorOf(error, 'INVALID_MODERN_PARAMETER')
    }
    return this.getSnapshot()
  }

  setChoice(_id: string, _value: string): WorkspaceSnapshot {
    // The model has measured work function and efficiency, not an invented material catalogue.
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime.peekScene().observableDefinitions.find(candidate => observableKeyOf(candidate.type) === key)
    if (definition !== undefined) this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    return this.getSnapshot()
  }

  setRunning(_running: boolean): WorkspaceSnapshot { return this.getSnapshot() }
  setRate(_rate: number): WorkspaceSnapshot { return this.getSnapshot() }
  seek(_time: number): WorkspaceSnapshot { return this.getSnapshot() }
  step(_delta: number): WorkspaceSnapshot { return this.getSnapshot() }
  advance(_wallClockSeconds: number): WorkspaceSnapshot { return this.getSnapshot() }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = [...ids]
    return this.getSnapshot()
  }

  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin === undefined || branchBadgeOf(this.sceneRuntime.peekScene()) === undefined) return this.getSnapshot()
    const revision = Math.max(this.highestRevision, this.sceneRuntime.peekScene().revision, this.origin.revision) + 1
    const restored = structuredClone(this.origin)
    restored.revision = revision
    restored.metadata.updatedAt = new Date().toISOString()
    this.sceneRuntime = new SceneRuntime(restored)
    this.highestRevision = revision
    this.highlighted = []
    this.commandFailure = undefined
    this.recompute()
    return this.getSnapshot()
  }
}

export const createModernPhysicsWorkspaceRuntime = (
  scene: PhysicsScene,
): ModernPhysicsWorkspaceRuntime => new ModernPhysicsWorkspaceRuntime(scene)
