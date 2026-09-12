/**
 * Collision 域 → WorkspaceRuntime 适配器。
 *
 * Wraps the verified {@link CollisionRuntimeBridge} so the shared
 * PhysicsWorkspace can drive it without knowing it is a collision experiment.
 * The bridge already produces the scene visual model, tree, inspector, charts
 * and verification; this only adds the title/subtitle and the sample-readout
 * closure.
 */

import { COLLISION_MODEL_LABELS, detectCollisionModel } from '@physicsos/engine-collision'
import type { PhysicsScene, CollisionSceneInput } from '@physicsos/physics-scene'

import { CollisionRuntimeBridge, type CollisionRuntimeSnapshot } from './collision-runtime-bridge.ts'
import { branchBadgeOf } from './experimental-branch.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'
import { formatSignificant } from './number-format.ts'

const MODEL_SUBTITLE: Readonly<Record<string, string>> = {
  elastic_collision: '动量守恒 · 弹性碰撞',
  inelastic_collision: '动量守恒 · 非弹性碰撞',
  perfectly_inelastic_collision: '动量守恒 · 完全非弹性碰撞',
}

const fmt = formatSignificant

export class CollisionWorkspaceRuntime implements WorkspaceRuntime {
  private readonly bridge: CollisionRuntimeBridge
  /** The scene as the source stated it, kept so a branch can be discarded. */
  private readonly origin: PhysicsScene | undefined

  constructor(input: CollisionSceneInput | PhysicsScene) {
    this.bridge = new CollisionRuntimeBridge(input)
    const initial = this.bridge.getSnapshot().scene
    this.origin = initial.metadata.sourceQuestionId === undefined ? undefined : initial
  }

  private toWorkspace(snapshot: CollisionRuntimeSnapshot): WorkspaceSnapshot {
    const title = snapshot.scene.metadata.title ?? '碰撞实验'
    const badge = branchBadgeOf(snapshot.scene)
    return {
      domain: 'mechanics',
      title,
      subtitle: MODEL_SUBTITLE[snapshot.modelId] ?? '碰撞工作台',
      status: snapshot.status,
      sceneRevision: snapshot.sceneRevision,
      view: snapshot.view,
      ariaLabel: `${title}的可验证物理画布`,
      tree: snapshot.tree,
      inspector: snapshot.inspector,
      charts: snapshot.charts,
      table: snapshot.table,
      derivation: snapshot.derivation,
      verification: snapshot.verification,
      events: snapshot.events,
      clock: snapshot.clock,
      trajectoryTimes: snapshot.trajectoryTimes,
      sampleReadout: index => this.readoutAt(snapshot, index),
      ...(badge === undefined
        ? {}
        : {
          branch: {
            originQuestionTitle: this.origin?.metadata.title,
            parentRevision: badge.parentRevision,
            canRestore: this.origin !== undefined,
          },
        }),
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    }
  }

  /** Trajectory hover rows for a body sample. */
  private readoutAt(
    snapshot: CollisionRuntimeSnapshot,
    index: number,
  ): readonly { label: string; value: string }[] {
    const state = snapshot.view
    const time = snapshot.trajectoryTimes[index]
    if (time === undefined) return []
    const rows: { label: string; value: string }[] = [{ label: 't', value: `${fmt(time)} s` }]
    for (const body of snapshot.scene.bodies) {
      const point = state.trajectories.find(t => t.id === `trajectory-${body.id}`)?.points[index]
      if (point === undefined) continue
      rows.push({ label: body.id, value: `${fmt(point.x)}, ${fmt(point.y)} m` })
    }
    return rows
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.getSnapshot())
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.editParameter(id, value))
  }

  setChoice(_id: string, _value: string): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setObservable(key: import('./scene-visual-model.ts').ObservableKey, enabled: boolean): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.setObservableEnabled(key, enabled))
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.setRunning(running))
  }

  setRate(rate: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.setPlaybackRate(rate))
  }

  seek(time: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.seek(time))
  }

  step(delta: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.step(delta))
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.advance(wallClockSeconds))
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.setHighlight(ids))
  }

  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin !== undefined) {
      this.bridge.restoreOrigin(this.origin)
    }
    return this.getSnapshot()
  }
}

export const createCollisionWorkspaceRuntime = (
  input: CollisionSceneInput | PhysicsScene,
): CollisionWorkspaceRuntime => new CollisionWorkspaceRuntime(input)

/** 供 LabWorkspace 分派时快速识别碰撞场景。 */
export const isCollisionSceneInput = (scene: PhysicsScene): boolean =>
  detectCollisionModel(scene) !== null && scene.bodies.length >= 2

/** 模型显示名，供侧栏/报告使用。 */
export const collisionModelTitle = (scene: PhysicsScene): string =>
  COLLISION_MODEL_LABELS[detectCollisionModel(scene) ?? 'elastic_collision']
