/**
 * Experiment capability manifest — what each experiment can honestly do.
 *
 * `PhysicsWorkspace` renders controls from this, so an experiment only shows a
 * transport it can actually back: a scene with no run window (`clock.total` is
 * 0) no longer grows a row of greyed-out buttons, and an experiment that keeps
 * its transport keeps it untouched.
 *
 * Two sources, deliberately separated so neither can silently drift:
 *
 * - `model` — the KIND of model the engine really is. This cannot be read off a
 *   frame, so it is an explicit table. The table is complete on purpose: the
 *   coverage test fails when a template id has no entry, so a new experiment
 *   cannot ship without naming its engine kind.
 * - everything else — DERIVED from the runtime frame (`clock.total > 0` gives
 *   `timeline`, the inspector's editable rows give `editable`, the verification
 *   checks give `verifiable`, the observable layers give `observations`), never
 *   hand-copied. Deriving is what keeps the manifest equal to the runtime.
 *
 * The `model` kinds and what each one means for the runtime:
 *
 * - `dynamic` — a numerical integrator: the state at t is stepped forward, not
 *   solved. Today only `engine-collision` (the collision family).
 * - `analytical` — a closed-form physical state at every t.
 * - `quasi-static` — a run window whose displayed quantity is a steady-state or
 *   display profile rather than an integrated/closed-form trajectory (the
 *   rheostat sweep, the spring sitting at its equilibrium).
 * - `static` — the runtime exposes no run window (`clock.total === 0`).
 *
 * Invariants the test proves against the real runtimes: `static` exactly when
 * `clock.total === 0`, and every other kind has a real run window.
 */

import { EXPERIMENT_TEMPLATES, type ExperimentTemplate } from './experiment-templates.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

/** The kind of model an experiment's engine really is (see the module header). */
export type ExperimentModelKind = 'dynamic' | 'analytical' | 'quasi-static' | 'static'

/** The capabilities a live frame can back — what the shell renders controls from. */
export interface WorkspaceCapabilities {
  /** A real run window exists (`clock.total > 0`), so a transport is meaningful. */
  readonly timeline: boolean
  /** Scrubbing to an arbitrary t reconstructs the frame at t. */
  readonly seek: boolean
  /** A finished run can be replayed from t = 0. */
  readonly replay: boolean
  /** Parameters (or enumerated choices) can be edited and recompute the scene. */
  readonly editable: boolean
  /** An interactive measurement tool can read a value off the scene. */
  readonly measurable: boolean
  /** The engine independently checks the numbers it reports. */
  readonly verifiable: boolean
  /** Observable layers this scene exposes for switching on and off. */
  readonly observations: readonly string[]
  /** The quantities an interactive measurement tool could read (empty until I7). */
  readonly measurements: readonly string[]
}

/** One experiment template's declared capability, plus its engine kind. */
export interface ExperimentCapabilities extends WorkspaceCapabilities {
  readonly id: string
  readonly model: ExperimentModelKind
  /** The runtime forks an experimental branch from this scene. */
  readonly branchable: boolean
}

/** The runtime facts a capability set is derived from. Plain data, no template. */
export interface CapabilityFrame {
  readonly clockTotal: number
  readonly observations: readonly string[]
  readonly editable: boolean
  readonly verifiable: boolean
}

/**
 * The engine kind of every template. Hand-written BECAUSE it is not derivable,
 * and complete so the coverage test can forbid a template without a kind.
 *
 * Grouped by domain, in the order `EXPERIMENT_TEMPLATES` lists them.
 */
export const EXPERIMENT_MODEL_KINDS: Readonly<Record<string, ExperimentModelKind>> = {
  // mechanics — closed-form motion, except the collision integrator, the
  // time-independent ledgers, the lever at its balanced rest and the spring at
  // rest.
  'uniform-linear': 'analytical',
  'average-speed': 'analytical',
  'uniform-acceleration': 'analytical',
  'projectile-horizontal': 'analytical',
  'projectile-oblique': 'analytical',
  'newton-second-law': 'analytical',
  incline: 'analytical',
  'mechanical-energy': 'static',
  'ramp-friction': 'static',
  'lever-balance': 'static',
  'collision-elastic': 'dynamic',
  'collision-inelastic': 'dynamic',
  'collision-perfectly-inelastic': 'dynamic',
  'vt-area': 'analytical',
  'force-composition': 'analytical',
  'concurrent-equilibrium': 'analytical',
  'apparent-weight': 'analytical',
  'chase-meeting': 'dynamic',
  'hooke-law': 'quasi-static',
  'spring-oscillator': 'analytical',
  'circular-orbit': 'analytical',
  'simple-pendulum': 'analytical',
  'friction-static': 'analytical',
  'friction-mu': 'analytical',
  // electric — the point-charge field is time-independent; the uniform-field
  // benches move under the closed-form mechanics solutions.
  'point-charge': 'static',
  'multi-point-charge': 'static',
  'uniform-electric': 'analytical',
  'parallel-plate': 'analytical',
  // magnetic — steady fields; only the Lorentz orbit is a closed-form path.
  'straight-wire-field': 'static',
  'solenoid-field': 'static',
  electromagnet: 'static',
  motor: 'static',
  'magnetic-circular': 'analytical',
  // circuit — a DC operating point has no run window; the rheostat benches
  // sweep a sequence of operating points over the shared timeline.
  'series-circuit': 'static',
  'parallel-circuit': 'static',
  'mixed-circuit': 'static',
  'short-circuit': 'static',
  'rheostat-circuit': 'quasi-static',
  'va-resistance': 'quasi-static',
  'bulb-power': 'quasi-static',
  'emf-measurement': 'quasi-static',
  // optics — geometric images, the same at every instant.
  pinhole: 'static',
  'total-reflection': 'static',
  'plane-mirror': 'static',
  'convex-lens': 'static',
  'concave-mirror': 'static',
  'convex-mirror': 'static',
  // acoustics — the echo is closed-form round-trip kinematics; the noise rig
  // is a time-independent level.
  'echo-ranging': 'analytical',
  noise: 'static',
  // fluid — the buoyancy tank settles over a run window; the pressure rigs do
  // not move.
  buoyancy: 'analytical',
  'solid-pressure': 'static',
  'liquid-pressure': 'static',
  'atmospheric-pressure': 'static',
  // thermal — the heating curves are closed-form; the thermometer is a
  // calibration against a fixed scale.
  thermometer: 'static',
  'crystal-melting': 'analytical',
  'boiling-water': 'analytical',
  'heat-capacity-comparison': 'analytical',
  // composite — all closed-form paths through the fields.
  'velocity-selector': 'analytical',
  'mass-spectrometer': 'analytical',
  'composite-eb': 'analytical',
  'composite-ebg': 'analytical',
  'multi-region-field': 'analytical',
  cyclotron: 'analytical',
  // induction — closed-form EMF/current laws; the transformer is a fixed ratio.
  'induction-bar-motion': 'analytical',
  transformer: 'static',
  'induction-double-bar-momentum': 'analytical',
  'induction-double-bar-force': 'analytical',
  'induction-flux-change': 'analytical',
  // wave — closed-form travelling/standing profiles.
  'wave-travelling': 'analytical',
  'wave-interference': 'analytical',
  'wave-standing': 'analytical',
  'wave-longitudinal': 'analytical',
  'wave-reflection-refraction': 'analytical',
  'wave-diffraction': 'analytical',
  'wave-doppler': 'analytical',
  // modern — a single-photon equation plotted against a static curve.
  'photoelectric-effect': 'static',
}

/**
 * The two runtimes that never fork an experimental branch, so the branch badge
 * and its restore entry point stay unreachable for them. Every other runtime
 * goes through `forkExperimentalScene`.
 */
const NON_BRANCHABLE_IDS: ReadonlySet<string> = new Set([
  'magnetic-circular',
  'photoelectric-effect',
])

/**
 * Interactive measurement tools (caliper, protractor, stopwatch readout) do not
 * exist yet — plan item I7. Until one ships, every experiment is honestly
 * declared unmeasurable rather than claiming a capability the product cannot
 * back; flip this single flag when the tool lands.
 */
const MEASUREMENT_TOOLS_AVAILABLE = false

/** Shared empty list: nothing is measurable yet, so there are no quantities. */
const NO_MEASUREMENTS = [] as const

/**
 * Resolve a template's engine kind.
 * @returns the declared kind.
 * @param id - the experiment template id.
 */
export const modelKindOf = (id: string): ExperimentModelKind => {
  const kind = EXPERIMENT_MODEL_KINDS[id]
  if (kind === undefined) {
    /* The coverage test keeps this unreachable for the shipped registry — a new
       template must declare its kind before it can be resolved. Fail loudly
       rather than guess an engine kind. */
    throw new Error(`experiment-capabilities: no model kind declared for '${id}'`)
  }
  return kind
}

/** The observable layers a frame exposes, sorted for a stable declaration. */
const observableLayersOf = (snapshot: WorkspaceSnapshot): readonly string[] =>
  Object.keys(snapshot.view.visible).sort()

/** Whether the inspector offers any editable parameter or enumerated choice. */
const hasEditableParameters = (snapshot: WorkspaceSnapshot): boolean =>
  snapshot.inspector.some(
    section => (section.parameters?.length ?? 0) > 0 || (section.choices?.length ?? 0) > 0,
  )

/**
 * Read the runtime facts a capability set is derived from.
 * @returns the capability frame.
 * @param snapshot - the frame to read.
 */
export const capabilityFrameOf = (snapshot: WorkspaceSnapshot): CapabilityFrame => ({
  clockTotal: snapshot.clock.total,
  observations: observableLayersOf(snapshot),
  editable: hasEditableParameters(snapshot),
  verifiable: snapshot.verification.length > 0,
})

/** Derive the runtime-backed capabilities from a frame. */
const deriveCapabilities = (frame: CapabilityFrame): WorkspaceCapabilities => {
  /* One run window drives all three: a frame with a window can be scrubbed to
     any t and, once finished, replayed from t = 0. A frame with no window has
     neither, which is exactly why the transport must not render for it. */
  const hasTimeline = frame.clockTotal > 0
  return {
    timeline: hasTimeline,
    seek: hasTimeline,
    replay: hasTimeline,
    editable: frame.editable,
    measurable: MEASUREMENT_TOOLS_AVAILABLE,
    verifiable: frame.verifiable,
    observations: frame.observations,
    measurements: NO_MEASUREMENTS,
  }
}

/**
 * The capabilities a live frame can back. The shell reads this so a scene handed
 * over from Question Space gets the same honest toolbar as its Lab twin — the
 * frame, not the template, decides.
 * @returns the derived capability set.
 * @param snapshot - the frame to read.
 */
export const workspaceCapabilities = (snapshot: WorkspaceSnapshot): WorkspaceCapabilities =>
  deriveCapabilities(capabilityFrameOf(snapshot))

/**
 * Resolve a template's full declared capability against one of its frames.
 * @returns the declared capability.
 * @param id - the experiment template id.
 * @param frame - the runtime facts to derive from.
 */
export const resolveExperimentCapabilities = (
  id: string,
  frame: CapabilityFrame,
): ExperimentCapabilities => ({
  id,
  model: modelKindOf(id),
  branchable: !NON_BRANCHABLE_IDS.has(id),
  ...deriveCapabilities(frame),
})

/**
 * Assemble the declared manifest by running each template's real runtime — the
 * same dispatch the Lab uses, so the manifest can never describe a runtime the
 * product would not build.
 * @returns one entry per template, in registry order.
 * @param runtimeOf - build the runtime for a template (throws for an unknown one).
 */
export const buildExperimentCapabilities = (
  runtimeOf: (template: ExperimentTemplate) => WorkspaceRuntime,
): readonly ExperimentCapabilities[] =>
  EXPERIMENT_TEMPLATES.map((template) => {
    const frame = capabilityFrameOf(runtimeOf(template).getSnapshot())
    return resolveExperimentCapabilities(template.id, frame)
  })
