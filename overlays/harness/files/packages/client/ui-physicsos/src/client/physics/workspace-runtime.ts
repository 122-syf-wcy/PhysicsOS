/**
 * Workspace runtime contract.
 *
 * `PhysicsWorkspace` is domain-agnostic: it renders whatever a `WorkspaceRuntime`
 * reports and calls back through this interface. Both the magnetic and mechanics
 * bridges are wrapped to satisfy it, so there is ONE workspace shell and one
 * shared canvas, not a workspace per experiment.
 */

import type {
  ChartSeries,
  DataTableView,
  DerivationStepView,
  InspectorSection,
  ObservableKey,
  PhysicsDomainId,
  PlaybackClock,
  RuntimeErrorView,
  RuntimeStatus,
  SceneTreeNode,
  SceneVisualModel,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'

/** Everything the shell needs to render one frame. Plain data only. */
export interface WorkspaceSnapshot {
  domain: PhysicsDomainId
  title: string
  subtitle: string
  status: RuntimeStatus
  /** Scene revision this frame was computed from; surfaced for E2E/debugging. */
  sceneRevision: number
  view: SceneVisualModel
  ariaLabel: string
  tree: readonly SceneTreeNode[]
  inspector: readonly InspectorSection[]
  charts: readonly ChartSeries[]
  table: DataTableView
  derivation: readonly DerivationStepView[]
  verification: readonly VerificationCheckView[]
  events: readonly TimelineEvent[]
  clock: PlaybackClock
  /** Scene time in seconds at each trajectory sample, for hover / seek. */
  trajectoryTimes: readonly number[]
  /** Hover readout rows for a trajectory sample. */
  sampleReadout?: (index: number) => readonly { label: string; value: string }[]
  /**
   * Present once the student has diverged from a question's stated conditions.
   * The shell shows provenance and a way back; it does not diff scenes.
   */
  branch?: {
    readonly originQuestionTitle: string | undefined
    readonly parentRevision: number
    readonly canRestore: boolean
  }
  error?: RuntimeErrorView
}

/** Imperative surface the shell drives; every method returns the next frame. */
export interface WorkspaceRuntime {
  getSnapshot(): WorkspaceSnapshot
  editParameter(id: string, value: number): WorkspaceSnapshot
  setChoice(id: string, value: string): WorkspaceSnapshot
  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot
  setRunning(running: boolean): WorkspaceSnapshot
  setRate(rate: number): WorkspaceSnapshot
  seek(time: number): WorkspaceSnapshot
  step(delta: number): WorkspaceSnapshot
  advance(wallClockSeconds: number): WorkspaceSnapshot
  setHighlight(ids: readonly string[]): WorkspaceSnapshot
  /**
   * Discard an experimental branch and return to the conditions the source stated.
   * A no-op on a scene that was never forked.
   */
  restoreOrigin?(): WorkspaceSnapshot
}
