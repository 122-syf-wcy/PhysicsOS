/**
 * Magnetic → WorkspaceRuntime adapter.
 *
 * The verified {@link MagneticRuntimeBridge} is left completely untouched — its
 * command/verify/observe path is accepted and must not regress. This adapter only
 * MAPS its `LabCanvasViewModel` output into the shared {@link SceneVisualModel} so
 * the magnetic scene renders through the same PhysicsCanvas + MagneticRenderer as
 * every other domain. No physics is recomputed here.
 */

import {
  createMagneticRuntime,
  type MagneticRuntimeBridge,
  type MagneticRuntimeSnapshot,
} from '../physics-runtime-bridge.ts'
import {
  MAGNETIC_SCENE_INPUT,
  MAGNETIC_SCENE_SUBTITLE,
  MAGNETIC_SCENE_TITLE,
  MAGNETIC_FIELD_DIRECTION_OPTIONS,
} from '../prototype/magnetic-scene.ts'
import type { LabCanvasViewModel, LabFieldDirection, LabObservableId, LabTreeNode } from '../lab-view-model.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { magneticPhysicalDelta } from '../animation-clock.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ChartSeries,
  InspectorSection,
  ObservableKey,
  SceneTreeNode,
  SceneVisualModel,
  VerificationCheckView,
} from './scene-visual-model.ts'

const TREE_ICON: Record<LabTreeNode['icon'], SceneTreeNode['icon']> = {
  field: 'field',
  particle: 'particle',
  velocity: 'velocity',
  observable: 'observable',
  folder: 'folder',
}

const CHART_ROLE: Record<string, ChartSeries['role']> = {
  speed: 'velocity',
  force: 'force',
  radius: 'measurement',
}

const CHART_AXIS: Record<string, { x: string; y: string }> = {
  speed: { x: 't / s', y: '|v| / (m/s)' },
  force: { x: 't / s', y: '|F| / N' },
  radius: { x: 't / s', y: 'R / cm' },
}

/** Map the magnetic canvas view model into the shared scene visual model. */
const toVisualModel = (
  view: LabCanvasViewModel,
  highlighted: readonly string[],
): SceneVisualModel => ({
  domain: 'magnetic',
  extent: view.extent,
  origin: { x: 0, y: 0 },
  grid: view.grid,
  axes: view.axes,
  bodies: [],
  particles: view.particles.map(p => ({
    id: p.id,
    at: p.at,
    sign: p.sign,
    radius: p.radius,
    symbol: p.symbol,
  })),
  vectors: view.vectors.map(v => ({
    id: v.id,
    role: v.observable === 'velocity' ? 'velocity' : 'force',
    observable: v.observable as ObservableKey,
    from: v.from,
    to: v.to,
    symbol: v.symbol,
  })),
  trajectories: view.trajectories.map(t => ({
    id: t.id,
    kind: t.kind,
    points: t.points,
    direction: t.direction,
  })),
  keyPoints: [],
  angles: [],
  dimensions: [],
  labels: [],
  guides: view.guides.map(guide => ({
    id: guide.id,
    observable: guide.observable as ObservableKey,
    from: guide.from,
    to: guide.to,
    ...(guide.label === undefined ? {} : { label: guide.label }),
  })),
  ...(view.center === undefined ? {} : { center: view.center }),
  field: { direction: view.field.direction, spacing: view.field.spacing },
  overlay: { readout: view.overlay.field, scale: view.overlay.scale },
  visible: view.visible,
  ...(highlighted.length === 0 ? {} : { highlighted }),
})

const mapTree = (nodes: readonly LabTreeNode[]): readonly SceneTreeNode[] =>
  nodes.map(node => ({
    id: node.id,
    label: node.label,
    ...(node.secondary === undefined ? {} : { secondary: node.secondary }),
    icon: TREE_ICON[node.icon],
    kind: node.kind,
    ...(node.observable === undefined ? {} : { observable: node.observable }),
    ...(node.children === undefined ? {} : { children: mapTree(node.children) }),
  }))

const verificationOf = (snapshot: MagneticRuntimeSnapshot): readonly VerificationCheckView[] => {
  const checks = snapshot.verification?.checks ?? []
  const labels: Record<string, string> = {
    velocity_perpendicular_field: '速度垂直于磁场',
    lorentz_force_centripetal: '洛伦兹力提供向心力',
    speed_conserved: '速率守恒（洛伦兹力不做功）',
    circular_motion: '匀速圆周运动',
  }
  return checks.slice(0, 6).map(check => ({
    id: check.id,
    label: labels[check.id] ?? check.id,
    status: check.passed ? 'passed' : 'failed',
    ...(check.message === undefined ? {} : { detail: check.message }),
  }))
}

export class MagneticWorkspaceRuntime implements WorkspaceRuntime {
  private readonly bridge: MagneticRuntimeBridge
  private highlighted: readonly string[] = []

  constructor(input: PhysicsScene | typeof MAGNETIC_SCENE_INPUT = MAGNETIC_SCENE_INPUT) {
    this.bridge = createMagneticRuntime(input)
  }

  private toWorkspace(snapshot: MagneticRuntimeSnapshot): WorkspaceSnapshot {
    const title = snapshot.scene.metadata.title ?? MAGNETIC_SCENE_TITLE
    const inspector: InspectorSection[] = [
      {
        id: 'particle',
        title: '粒子属性',
        parameters: snapshot.particleParameters.map(p => ({
          id: p.id,
          label: p.label,
          symbol: p.symbol,
          unit: p.unit,
          value: p.value,
        })),
      },
      {
        id: 'field',
        title: '磁场',
        parameters: snapshot.fieldParameters.map(p => ({
          id: p.id,
          label: p.label,
          symbol: p.symbol,
          unit: p.unit,
          value: p.value,
        })),
        choices: [
          {
            id: 'direction',
            label: '方向',
            value: snapshot.view.field.direction,
            options: [
              { value: 'into-page', label: MAGNETIC_FIELD_DIRECTION_OPTIONS[0] },
              { value: 'out-of-page', label: MAGNETIC_FIELD_DIRECTION_OPTIONS[1] },
            ],
          },
        ],
      },
      {
        id: 'derived',
        title: '派生量',
        derived: snapshot.derived.items.map(item => ({
          id: item.id,
          label: item.label,
          symbol: item.symbol,
          value: item.value,
          unit: item.unit,
        })),
      },
    ]

    const charts: ChartSeries[] = snapshot.data.series.map(series => ({
      id: series.id,
      title: series.title,
      xLabel: CHART_AXIS[series.id]?.x ?? 't / s',
      yLabel: CHART_AXIS[series.id]?.y ?? '',
      role: CHART_ROLE[series.id] ?? 'neutral',
      points: series.points.map(point => ({ t: point.t, value: point.value })),
    }))

    return {
      domain: 'magnetic',
      title,
      subtitle: snapshot.scene.metadata.description ?? MAGNETIC_SCENE_SUBTITLE,
      status: snapshot.status,
      sceneRevision: snapshot.sceneRevision,
      view: snapshot.status === 'failed' ? emptyVisualModel('magnetic') : toVisualModel(snapshot.view, this.highlighted),
      ariaLabel: title,
      tree: mapTree(snapshot.tree),
      inspector,
      charts,
      table: {
        columns: ['Step', 't / s', 'θ / °', '|v|', '|F|', 'R / cm'],
        rows: snapshot.data.samples.map(sample => ({
          step: sample.step,
          values: [String(sample.step), sample.t, sample.theta, sample.speed, sample.force, sample.radius],
        })),
      },
      derivation: [],
      verification: verificationOf(snapshot),
      events: [],
      clock: snapshot.clock,
      trajectoryTimes: [],
      ...(snapshot.error === undefined
        ? {}
        : {
          error: {
            code: snapshot.error.code,
            message: snapshot.error.message,
            retryable: snapshot.error.retryable,
          },
        }),
    }
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.getSnapshot())
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const outcome =
      id === 'q'
        ? this.bridge.setParticleCharge(value)
        : id === 'm'
          ? this.bridge.setParticleMass(value)
          : id === 'v0'
            ? this.bridge.setParticleSpeed(value)
            : this.bridge.setMagneticFieldStrength(value)
    return this.toWorkspace(outcome.snapshot)
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id !== 'direction') return this.toWorkspace(this.bridge.getSnapshot())
    const direction: LabFieldDirection = value === 'out-of-page' ? 'out-of-page' : 'into-page'
    return this.toWorkspace(this.bridge.setMagneticFieldDirection(direction).snapshot)
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    return this.toWorkspace(this.bridge.setObservableEnabled(key as LabObservableId, enabled))
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
    /* A cyclotron period is ~1e-7 s, so raw wall-clock seconds would jump the
       particle millions of orbits per frame. `magneticPhysicalDelta` maps one
       display cycle (5 s) onto one physical period, which is what makes the orbit
       watchable without faking the physics: the clock still advances real scene
       time, only the mapping from wall time is scaled. */
    const total = this.bridge.getSnapshot().clock.total
    return this.toWorkspace(this.bridge.advance(magneticPhysicalDelta(wallClockSeconds, total)))
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.toWorkspace(this.bridge.getSnapshot())
  }
}

export const createMagneticWorkspaceRuntime = (
  input?: PhysicsScene,
): MagneticWorkspaceRuntime => new MagneticWorkspaceRuntime(input ?? MAGNETIC_SCENE_INPUT)
