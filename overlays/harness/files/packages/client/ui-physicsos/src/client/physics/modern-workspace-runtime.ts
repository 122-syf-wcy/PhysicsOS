import { ModernPhysicsEngine, createModernSimulationRequest } from '@physicsos/engine-modern'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { SceneRuntime, createSceneCommand } from '@physicsos/physics-scene'

import { modernDerivedRows, modernSceneVisual } from './modern-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type { ObservableKey, SceneTreeNode } from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

export class ModernPhysicsWorkspaceRuntime implements WorkspaceRuntime {
  private readonly sceneRuntime: SceneRuntime
  private readonly engine = new ModernPhysicsEngine()
  private readonly simulation
  private readonly failure: string | undefined
  private sequence = 0
  private highlighted: readonly string[] = []

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    const support = this.engine.canHandle(scene)
    if (!support.supported) {
      this.failure = support.failedConditions.map(entry => entry.message).join(' ')
      this.simulation = undefined
      return
    }
    try {
      this.simulation = this.engine.simulate(
        scene,
        createModernSimulationRequest(
          scene,
          `modern-lab-${String(scene.id)}-${scene.revision}`,
          `modern-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      this.failure = undefined
    } catch (error: unknown) {
      this.simulation = undefined
      this.failure = error instanceof Error ? error.message : '近代物理 Runtime 无法启动。'
    }
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
            secondary: `W = ${bench.workFunction.value.toExponential(2)} J · λ = ${bench.photonWavelength.value.toExponential(2)} m`,
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
        children: scene.observableDefinitions.map(definition => ({
          id: String(definition.id),
          label: String(definition.id),
          icon: 'observable',
          kind: 'observable' as const,
          observable:
            definition.type === 'energy'
              ? 'photonEnergy'
              : definition.type === 'current'
                ? 'photocurrent'
                : 'stoppingPotential',
        })),
      },
    ]
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '光电效应'
    if (this.simulation === undefined) {
      return {
        domain: 'modern' as unknown as WorkspaceSnapshot['domain'],
        title,
        subtitle: scene.metadata.description ?? '真实近代物理 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('modern' as unknown as WorkspaceSnapshot['domain']),
        ariaLabel: title,
        tree: this.treeOf(scene),
        inspector: [],
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: 1 },
        trajectoryTimes: [],
        error: {
          code: 'MODERN_RUNTIME_FAILED',
          message: this.failure ?? '当前场景不满足 Modern Physics Engine 的前提条件。',
          retryable: false,
        },
      }
    }
    return {
      domain: 'modern' as unknown as WorkspaceSnapshot['domain'],
      title,
      subtitle: scene.metadata.description ?? '真实近代物理 Runtime',
      status: this.simulation.verification.status === 'failed' ? 'failed' : 'verified',
      sceneRevision: scene.revision,
      view: {
        ...modernSceneVisual(scene, this.simulation),
        ...(this.highlighted.length === 0 ? {} : { highlighted: this.highlighted }),
      },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene),
      inspector: [],
      charts: [],
      table: { columns: [], rows: [] },
      derivation: modernDerivedRows(this.simulation),
      verification: this.simulation.verification.checks.map(check => ({
        id: check.id,
        label: check.id,
        status: check.passed ? 'passed' : 'failed',
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      clock: { time: 0, total: 0, running: false, rate: 1 },
      trajectoryTimes: [],
    }
  }

  editParameter(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setChoice(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime.getScene().observableDefinitions.find((candidate) => {
      if (key === 'photonEnergy') return candidate.type === 'energy'
      if (key === 'photocurrent') return candidate.type === 'current'
      if (key === 'stoppingPotential') return candidate.type === 'voltage'
      return false
    })
    if (definition !== undefined) {
      const scene = this.sceneRuntime.getScene()
      this.sequence += 1
      this.sceneRuntime.execute(
        createSceneCommand({
          commandId: `modern-observable-${this.sequence}`,
          sceneId: scene.id,
          expectedRevision: scene.revision,
          type: 'SetObservableEnabled',
          payload: { observableId: definition.id, enabled },
          traceId: `modern-observable-trace-${this.sequence}`,
        }),
      )
    }
    return this.getSnapshot()
  }

  setRunning(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setRate(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  seek(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  step(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  advance(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.getSnapshot()
  }
}

export const createModernPhysicsWorkspaceRuntime = (
  scene: PhysicsScene,
): ModernPhysicsWorkspaceRuntime => new ModernPhysicsWorkspaceRuntime(scene)
