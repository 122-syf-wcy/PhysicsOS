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
import { formatSignificant } from './number-format.ts'
import { MechanicsEngine, createMechanicsSimulationRequest } from '@physicsos/engine-mechanics'
import type { LabelVisual, TrajectoryVisual, SceneVisualModel } from './scene-visual-model.ts'

const MODEL_SUBTITLE: Record<string, string> = {
  uniform_linear_motion: '运动学 · 匀速直线运动',
  uniformly_accelerated_motion: '运动学 · 匀变速直线运动',
  projectile_motion: '抛体运动 · 水平/斜抛',
  newton_second_law: '力与运动 · 牛顿第二定律',
  inclined_plane: '力与运动 · 斜面',
  spring_oscillator: '机械振动 · 弹簧振子',
  simple_pendulum: '机械振动 · 单摆',
  horizontal_friction: '力与运动 · 水平面摩擦',
  spring_statics: '力与运动 · 胡克定律',
}

const fmt = formatSignificant

/**
 * The mechanics workspace runtime — see the module doc for its role.
 */
export class MechanicsWorkspaceRuntime implements WorkspaceRuntime {
  private readonly bridge: MechanicsRuntimeBridge
  /** The scene as the source stated it, kept so a branch can be discarded. */
  private readonly origin: PhysicsScene | undefined
  private comparison = false
  private comparisonCache: { scene: PhysicsScene; paths: TrajectoryVisual[]; labels: LabelVisual[] } | undefined

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
      view: this.comparisonView(snapshot),
      ariaLabel: `${title}的可验证物理画布`,
      tree: snapshot.tree,
      inspector: snapshot.modelId === 'projectile_motion' ? [...snapshot.inspector, {
        id: 'projectile-comparison', title: '同初速度、同重力对比', choices: [{
          id: 'projectile-comparison', label: '抛射角轨迹', value: this.comparison ? 'angles' : 'single',
          options: [{ value: 'single', label: '当前角度' }, { value: 'angles', label: '同时比较 30° / 45° / 60°' }],
        }],
      }] : snapshot.inspector,
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

  private comparisonView(snapshot: MechanicsRuntimeSnapshot): SceneVisualModel {
    const view = snapshot.view
    if (!this.comparison || snapshot.modelId !== 'projectile_motion' || snapshot.status === 'failed') return view
    if (this.comparisonCache?.scene !== snapshot.scene) {
      const engine = new MechanicsEngine()
      const body = snapshot.scene.bodies[0]
      if (body === undefined) return view
      const speed = Math.hypot(body.velocity.vector.x, body.velocity.vector.y)
      const paths: TrajectoryVisual[] = []
      const labels: LabelVisual[] = []
      for (const angle of [30, 45, 60]) {
        const radians = angle * Math.PI / 180
        const scene: PhysicsScene = { ...snapshot.scene, bodies: snapshot.scene.bodies.map((entry, index) => index === 0 ? {
          ...entry, velocity: { ...entry.velocity, vector: { x: speed * Math.cos(radians), y: speed * Math.sin(radians), z: 0 } },
        } : entry) }
        const result = engine.simulate(scene, createMechanicsSimulationRequest(scene, `comparison-${angle}`, `comparison-${angle}-${scene.revision}`))
        if (result.verification.status === 'failed') continue
        const points = result.states.flatMap((state) => {
          const position = state.objects.find(entry => entry.id === body.id)?.position?.vector
          return position === undefined ? [] : [{ x: position.x, y: position.y }]
        })
        paths.push({ id: `comparison-${angle}`, kind: 'history', points })
        const apex = points.reduce((highest, point) => point.y > highest.y ? point : highest, points[0] ?? { x: 0, y: 0 })
        labels.push({ id: `comparison-label-${angle}`, at: apex, text: `${angle}°`, role: 'trajectory' })
      }
      this.comparisonCache = { scene: snapshot.scene, paths, labels }
    }
    const points = this.comparisonCache.paths.flatMap(path => path.points)
    const left = Math.min(view.origin.x, ...points.map(point => point.x))
    const bottom = Math.min(view.origin.y, ...points.map(point => point.y))
    const right = Math.max(view.origin.x + view.extent.width, ...points.map(point => point.x))
    const top = Math.max(view.origin.y + view.extent.height, ...points.map(point => point.y))
    return { ...view, origin: { x: left, y: bottom }, extent: { width: right - left, height: top - bottom },
      trajectories: [...view.trajectories, ...this.comparisonCache.paths],
      labels: view.visible.trajectory === false ? view.labels : [...view.labels, ...this.comparisonCache.labels],
    }
  }

  /** Trajectory hover rows for a displayed engine sample. */
  private readoutAt(
    snapshot: MechanicsRuntimeSnapshot,
    index: number,
  ): readonly { label: string; value: string }[] {
    const first = snapshot.view.trajectories[0]
    const parts = snapshot.view.trajectories.filter(trajectory => trajectory.id === first?.id)
    const points = [
      ...parts.filter(trajectory => trajectory.kind === 'history').flatMap(trajectory => trajectory.points),
      ...parts.filter(trajectory => trajectory.kind === 'predicted').flatMap(trajectory => trajectory.points),
    ]
    const point = points[index]
    const time = snapshot.trajectoryTimes[index]
    if (point === undefined || time === undefined) return []
    /* vx is constant in a projectile; vy from the clock derivative. Read from the
       chart series so the hover matches the plotted data exactly. */
    const vx = snapshot.charts.find(c => c.id === 'vx-t')?.points.find(sample => sample.t === time)?.value
    const vy = snapshot.charts.find(c => c.id === 'vy-t')?.points.find(sample => sample.t === time)?.value
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

  getScene(): PhysicsScene {
    return this.bridge.getSnapshot().scene
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.getSnapshot())
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.editParameter(id, value))
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'projectile-comparison' && (value === 'single' || value === 'angles')) this.comparison = value === 'angles'
    if (id === 'force-balance') this.bridge.setForceBalance(value)
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

/**
 * The mechanics workspace runtime helper `createMechanicsWorkspaceRuntime`.
 * @returns the mechanics workspace runtime.
 * @param input - the caller-supplied fields.
 */
export const createMechanicsWorkspaceRuntime = (
  input: MechanicsSceneInput | PhysicsScene,
): MechanicsWorkspaceRuntime => new MechanicsWorkspaceRuntime(input)
