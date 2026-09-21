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
  ScenePoint,
  SceneTreeNode,
  SceneVisualModel,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { CircuitDraft, TerminalRef } from './circuit-builder.ts'

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
  /**
   * Live preview while a component is dragged: repaints the frame without
   * committing. What `at` commits to is the domain's own call — a circuit
   * part lands as a placement command, the fluid block scrubs the immersion
   * clock. Runtimes that cannot move their visuals leave it undefined and
   * the canvas stays non-draggable.
   */
  previewComponentPlacement?(componentId: string, at: ScenePoint): WorkspaceSnapshot
  /**
   * Drop the dragged component: the position lands through the domain's own
   * settlement path (a scene command on the circuit bench, a seek on the
   * fluid descent) — never as a forkable physical fact.
   */
  commitComponentPlacement?(componentId: string, at: ScenePoint): WorkspaceSnapshot
  /**
   * Abandon an in-flight drag (pointer cancel): drop the preview so the part
   * snaps back to its committed position instead of sticking mid-gesture.
   */
  cancelComponentPlacement?(): WorkspaceSnapshot
  /**
   * Flip a switch on the bench: a real scene command (`SetSwitchState`), so
   * the open loop re-solves to zero current. Circuit domain only.
   */
  setSwitchState?(componentId: string, state: 'open' | 'closed'): WorkspaceSnapshot
  /**
   * Live preview while the rheostat knob is pushed: repaints the schematic and
   * re-solves the operating point for the grabbed position without committing
   * a revision, so meters and annotations track the pointer.
   */
  previewSliderPosition?(componentId: string, position: number): WorkspaceSnapshot
  /**
   * Release the knob: the position lands as a `SetSliderPosition` command —
   * a revisioned physical edit, rewound to t = 0 like every parameter change.
   */
  commitSliderPosition?(componentId: string, position: number): WorkspaceSnapshot
  /** Abandon an in-flight slider push (pointer cancel): drop the preview. */
  cancelSliderPosition?(): WorkspaceSnapshot
  /**
   * Enter free-build mode: the bench panel can now add parts, wire terminals
   * and remove them. Circuit domain only — a domain that cannot be authored
   * leaves these undefined and the shell offers no builder.
   */
  enterBuilder?(): WorkspaceSnapshot
  /** Leave free-build mode, keeping whatever circuit was assembled. */
  leaveBuilder?(): WorkspaceSnapshot
  /**
   * Apply one authoring edit to the circuit being built, returning the next
   * frame. Edits are whole-draft transforms, so the panel composes them from
   * the pure operations in `circuit-builder.ts`.
   */
  applyDraftEdit?(edit: (draft: CircuitDraft) => CircuitDraft): WorkspaceSnapshot
  /** The draft being authored, for the panel to render; undefined outside build mode. */
  circuitDraft?(): CircuitDraft | undefined
  /**
   * Start a wire at a terminal. The bench shows it as pending until a second
   * terminal completes it, or the gesture is abandoned.
   */
  beginWire?(ref: TerminalRef): WorkspaceSnapshot
  /** Finish a pending wire onto a second terminal. */
  completeWire?(ref: TerminalRef): WorkspaceSnapshot
  /** Abandon a pending wire without changing the circuit. */
  cancelWire?(): WorkspaceSnapshot
}
