/**
 * Mechanics → WorkspaceRuntime adapter.
 *
 * Wraps the verified {@link MechanicsRuntimeBridge} so the shared PhysicsWorkspace
 * can drive it without knowing it is mechanics. The bridge already produces the
 * scene visual model, tree, inspector, charts and verification; this only adds
 * the title/subtitle and the sample-readout closure.
 */

import { MechanicsRuntimeBridge, type MechanicsRuntimeSnapshot } from './mechanics-runtime-bridge.ts'
import { branchBadgeOf } from './experimental-branch.ts'
import type { PhysicsScene, MechanicsSceneInput } from '@physicsos/physics-scene'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'
import type { ObservableKey } from './scene-visual-model.ts'

const MODEL_SUBTITLE: Record<string, string> = {
  uniform_linear_motion: '运动学 · 匀速直线运动',
  uniformly_accelerated_motion: '运动学 · 匀变速直线运动',
  projectile_motion: '抛体运动 · 水平/斜抛',
  newton_second_law: '力与运动 · 牛顿第二定律',
  inclined_plane: '力与运动 · 斜面',
}

const fmt = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—'

export class MechanicsWorkspaceRuntime implements WorkspaceRuntime {
  private readonly bridge: MechanicsRuntimeBridge
  /** The scene as the source stated it, kept so a branch can be discarded. */
  private readonly origin: PhysicsScene | undefined

  constructor(input: MechanicsSceneInput | PhysicsScene) {
    this.bridge = new MechanicsRuntimeBridge(input)
    const initial = this.bridge.getSnapshot().scene
    this.origin = initial.metadata.sourceQuestionId === undefined ? undefined : initial
  }

  private toWorkspace(snapshot: MechanicsRuntimeSnapshot): WorkspaceSnapshot {
    const title = snapshot.scene.metadata.title ?? '力学实验'
    const badge = branchBadgeOf(snapshot.scene)
    return {
      domain: 'mechanics',
      title,
      subtitle: MODEL_SUBTITLE[snapshot.modelId] ?? '力学工作台',
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

  /** Trajectory hover rows for a projectile sample. */
  private readoutAt(
    snapshot: MechanicsRuntimeSnapshot,
    index: number,
  ): readonly { label: string; value: string }[] {
    const trajectory = snapshot.view.trajectories.find(t => t.kind === 'history')
    const point = trajectory?.points[index]
    const time = snapshot.trajectoryTimes[index]
    if (point === undefined || time === undefined) return []
    /* vx is constant in a projectile; vy from the clock derivative. Read from the
       chart series so the hover matches the plotted data exactly. */
    const vx = snapshot.charts.find(c => c.id === 'vx-t')?.points[index]?.value
    const vy = snapshot.charts.find(c => c.id === 'vy-t')?.points[index]?.value
    const rows: { label: string; value: string }[] = [
      { label: 't', value: `${fmt(time)} s` },
      { label: 'x', value: `${fmt(point.x)} m` },
      { label: 'y', value: `${fmt(point.y)} m` },
    ]
    if (vx !== undefined) rows.push({ label: 'vₓ', value: `${fmt(vx)} m/s` })
    if (vy !== undefined) rows.push({ label: 'v_y', value: `${fmt(vy)} m/s` })
    if (vx !== undefined && vy !== undefined) {
      rows.push({ label: '|v|', value: `${fmt(Math.hypot(vx, vy))} m/s` })
    }
    return rows
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.getSnapshot())
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.editParameter(id, value))
  }

  setChoice(): WorkspaceSnapshot {
    /* Mechanics has no enumerated choices yet; ignore and return current frame. */
    return this.toWorkspace(this.bridge.getSnapshot())
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
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
    const origin = this.origin
    if (origin === undefined) return this.getSnapshot()
    return this.toWorkspace(this.bridge.restoreOrigin(origin))
  }
}

export const createMechanicsWorkspaceRuntime = (
  input: MechanicsSceneInput | PhysicsScene,
): MechanicsWorkspaceRuntime => new MechanicsWorkspaceRuntime(input)
