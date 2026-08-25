/**
 * Question Space: problem text → verified physics → a solution a student reads.
 *
 * Three product contracts live here and nowhere else:
 *   - a Known is a CONTROL, not a caption. Clicking it lights the matching
 *     primitive in the canvas through `SceneVisualModel.highlighted`, so the
 *     symbol in the text and the arrow in the picture are the same object.
 *   - a solution is a structured derivation (step, formula, result), never a
 *     chat reply.
 *   - verification is a list of NAMED physical statements. Engine plumbing
 *     (schema versions, id uniqueness, unit-registry membership) collapses into
 *     one row instead of leaking check ids at a student.
 *
 * Playback is owned once, by {@link QuestionVisualization}. Each domain hands it
 * an already-verified `SceneVisualModel` from its own bridge — no physics is
 * computed in this file.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { VerificationCheck } from '@physicsos/physics-core'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import {
  evaluateUniformElectricState,
  isPointChargeScene,
  resolveUniformElectricModel,
} from '@physicsos/engine-electric'
import { electricRegionEngine } from '@physicsos/engine-electric-region'
import { observeElectricScene, observeMechanicsScene } from '@physicsos/physics-observation'
import { isParallelPlateScene, probeParticleOf } from '@physicsos/physics-scene'
import {
  GOLDEN_QUESTIONS,
  QUESTION_KNOWLEDGE,
  createGoldenQuestionDocument,
  knowledgeNodesOfQuestion,
  processQuestion,
  selfChecksOfQuestion,
  type GoldenQuestionDefinition,
  type KnownValue,
  type QuestionRuntimeResult,
  type QuestionSolutionStep,
  type QuestionWorkflowState,
  type SelfCheckItem,
  type SelfCheckOption,
} from '@physicsos/question-core'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import { MathText } from './physics/MathText.tsx'
import type { SceneVisualModel, VerificationCheckView } from './physics/scene-visual-model.ts'
import {
  mechanicsSampleReadout,
  mechanicsSceneVisualAt,
} from './physics/mechanics-visual-bridge.ts'
import {
  electricSampleReadout,
  electricSceneVisualAt,
} from './physics/electric-visual-bridge.ts'
import { IconPhysicsPause, IconPhysicsPlay } from './icons/physics-icons.tsx'
import { createMagneticRuntime, type MagneticRuntimeBridge } from './physics-runtime-bridge.ts'
import {
  MAGNETIC_CYCLE_WALL_SECONDS,
  magneticPhysicalDelta,
  MICRO_WINDOW_WALL_SECONDS,
  nearestTimedStateIndex,
  STEP_FRACTION,
  useAnimationClock,
} from './animation-clock.ts'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import { VerificationList } from './workspace-parts.tsx'
import type { PhysicsosKey } from './locales.ts'
import type { PhysicsSurfaceState, PhysicsSurfaceId } from './surface-store.ts'
import css from './QuestionWorkspace.module.css'

type Translate = QuestionWorkspaceProps['t']

/** One answered self-check, as Question Space reports it to the learning record. */
export interface SelfCheckAttemptInput {
  readonly questionId: string
  readonly questionTitle: string
  readonly selfCheckId: string
  readonly prompt: string
  readonly answerId: string
  readonly answerLabel: string
  readonly correct: boolean
  readonly mistakeType?: 'concept' | 'direction' | 'modeling'
  readonly knowledge: readonly string[]
}

export interface QuestionWorkspaceInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
  }
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: { sceneId: string; scene: unknown }) => void
  /** Write a self-check answer into the learning record. */
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void
  /** Question Space consumed the one-shot 重新练习 question ref. */
  consumeQuestion?: () => void
}

export type QuestionWorkspaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<Pick<QuestionWorkspaceInjected, 'hooks'>> &
  Pick<QuestionWorkspaceInjected, 'openSurface' | 'recordAttempt' | 'consumeQuestion'>

const FIRST_GOLDEN_QUESTION = GOLDEN_QUESTIONS[0]
if (FIRST_GOLDEN_QUESTION === undefined) throw new Error('Question Space requires at least one golden question.')
const INITIAL_DOCUMENT = createGoldenQuestionDocument(
  FIRST_GOLDEN_QUESTION,
  '2026-01-01T00:00:00.000Z',
)

const TARGET_LABELS: Record<string, string> = {
  force: '洛伦兹力',
  radius: '轨道半径',
  period: '运动周期',
  rotation_direction: '运动方向',
  trajectory: '运动轨迹',
  final_velocity: '末速度',
  displacement: '位移',
  range: '水平射程',
  max_height: '最大高度',
  flight_time: '飞行时间',
  /* The mechanics parser emits the bare `time` target for "求落地时间"; without an
     entry the raw key leaks into the student-facing target list. */
  time: '落地时间',
  velocity: '速度',
  acceleration: '加速度',
  normal_force: '支持力',
  net_force: '合力',
  friction_force: '摩擦力',
  electric_force: '电场力',
  electric_potential_change: '电势变化',
  electric_potential_energy_change: '电势能变化',
  kinetic_energy: '动能',
  kinetic_energy_change: '动能变化',
  work_by_electric_field: '电场力做功',
}

/**
 * Some target keys name a different physical quantity per domain: a bare `force`
 * is the Lorentz force in a magnetic question and the resultant in a mechanics
 * one, so labelling it 洛伦兹力 on an incline would be simply wrong.
 */
const DOMAIN_TARGET_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  /* `time` is the flight time for a projectile, so both keys map to one label and
     the de-duplicated target list shows the quantity once. */
  mechanics: { force: '合力', time: '飞行时间' },
  electric: { force: '电场力' },
}

const targetLabel = (target: string, domain: string | undefined): string =>
  (domain === undefined ? undefined : DOMAIN_TARGET_LABELS[domain]?.[target]) ??
  TARGET_LABELS[target] ??
  target

/** Student-facing target list: labelled, de-duplicated, order preserved. */
const targetLabels = (ir: { domain: string; targets: readonly string[] } | null | undefined): readonly string[] =>
  ir === null || ir === undefined
    ? []
    : [...new Set(ir.targets.map(target => targetLabel(target, ir.domain)))]

const WORKFLOW_LABELS: Record<string, string> = {
  READY: '已完成求解',
  PARSE_FAILED: '无法识别题目',
  AMBIGUOUS: '需要补充条件',
  INVALID_SEMANTICS: '题目条件无效',
  UNSUPPORTED_MODEL: '暂不支持该模型',
  VERIFICATION_FAILED: '验证未通过',
}

/* ------------------------------------------------- known → canvas highlight -- */

/**
 * Symbol (or IR key) → visual ids, per domain. Ids are the ones the domain's
 * visual bridge actually emits: `mechanics-visual-bridge.ts` for mechanics,
 * `electric-visual-bridge.ts` for electric, `physics-runtime-bridge.ts` for
 * magnetic. A quantity with no drawn counterpart (`B`, a mass in a point-particle
 * scene, an elapsed time) is deliberately absent — {@link highlightableIds}
 * then renders it as a plain row rather than a button that does nothing.
 */
const MECHANICS_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  h: ['launch-height'],
  height: ['launch-height'],
  v: ['velocity'],
  v0: ['velocity'],
  vx: ['velocity'],
  initial_velocity: ['velocity'],
  horizontal_speed: ['velocity'],
  final_velocity: ['velocity'],
  g: ['net-force', 'acceleration'],
  gravity: ['net-force', 'acceleration'],
  a: ['acceleration'],
  acceleration: ['acceleration'],
  θ: ['launch-angle', 'incline-angle'],
  theta: ['launch-angle', 'incline-angle'],
  launch_angle: ['launch-angle', 'incline-angle'],
  incline_angle: ['launch-angle', 'incline-angle'],
  R: ['range'],
  range: ['range'],
  H: ['apex'],
  max_height: ['apex'],
  t: ['impact'],
  flight_time: ['impact'],
  F: ['net-force'],
  N: ['net-force'],
  net_force: ['net-force'],
  normal_force: ['net-force'],
}

const ELECTRIC_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  E: ['electric-field-vector'],
  electric_field_strength: ['electric-field-vector'],
  q: ['electric-force-vector'],
  charge: ['electric-force-vector'],
  F: ['electric-force-vector'],
  v: ['electric-velocity-vector'],
  v0: ['electric-velocity-vector'],
  initial_velocity: ['electric-velocity-vector'],
  a: ['electric-acceleration-vector'],
  /* Multi-source point-charge: each named source charge highlights its own
     sphere, and the sampling point highlights the probe. Separation (d) has no
     single drawable object so it stays a static known, which is honest. */
  q1: ['source-1'],
  q2: ['source-2'],
  source_charge_1: ['source-1'],
  source_charge_2: ['source-2'],
  P: ['probe-1'],
  sample_position: ['probe-1'],
}

const MAGNETIC_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  v: ['v'],
  velocity: ['v'],
  F: ['F'],
  R: ['radius'],
}

const HIGHLIGHTS_BY_DOMAIN: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  mechanics: MECHANICS_HIGHLIGHTS,
  electric: ELECTRIC_HIGHLIGHTS,
  magnetic: MAGNETIC_HIGHLIGHTS,
}

/** Every id the current frame can actually light up. */
const drawnIds = (view: SceneVisualModel | null): ReadonlySet<string> => {
  if (view === null) return new Set()
  return new Set([
    ...view.bodies.map(entry => entry.id),
    ...view.particles.map(entry => entry.id),
    ...view.vectors.map(entry => entry.id),
    ...view.dimensions.map(entry => entry.id),
    ...view.keyPoints.map(entry => entry.id),
    ...view.angles.map(entry => entry.id),
    ...view.guides.map(entry => entry.id),
    /* Point-charge primitives: the source sphere, streamlines and probe are the
       drawable objects of an electric point-charge frame, so a known-quantity
       highlight must be able to target them — mirroring the Agent's drawnVisualIds. */
    ...(view.pointChargeSources ?? []).map(entry => entry.id),
    ...(view.fieldStreamlines ?? []).map(entry => entry.id),
    ...(view.probe === undefined ? [] : [view.probe.id]),
  ])
}

/**
 * Ids a symbol may highlight, filtered against what is drawn. Returning an empty
 * list is the signal to render a caption instead of a button: a control that
 * changes nothing on screen teaches the student that clicking is pointless.
 */
const highlightableIds = (
  symbols: readonly string[],
  domain: string | undefined,
  bodyId: string | undefined,
  drawn: ReadonlySet<string>,
): readonly string[] => {
  const table = domain === undefined ? undefined : HIGHLIGHTS_BY_DOMAIN[domain]
  const candidates = symbols.flatMap((symbol) => {
    /* A mass has no arrow — it is the body itself, whose id is scene-specific. */
    if (domain === 'mechanics' && (symbol === 'm' || symbol === 'mass')) {
      return bodyId === undefined ? [] : [bodyId]
    }
    return [...(table?.[symbol] ?? [])]
  })
  return [...new Set(candidates)].filter(id => drawn.has(id))
}

/* ----------------------------------------------------- workflow progress ---- */

const WORKFLOW_STEP_KEYS: readonly PhysicsosKey[] = [
  'questions.workflow.understand',
  'questions.workflow.model',
  'questions.workflow.world',
  'questions.workflow.solve',
  'questions.workflow.verify',
]

/** Index of the workflow step each state was inside when it stopped. */
const WORKFLOW_STAGE: Readonly<Partial<Record<QuestionWorkflowState, number>>> = {
  INPUT_RECEIVED: 0,
  DOCUMENT_CREATED: 0,
  UNDERSTANDING: 0,
  PARSE_FAILED: 0,
  SEMANTIC_CANDIDATE: 1,
  AMBIGUOUS: 1,
  INVALID_SEMANTICS: 1,
  SEMANTIC_VALIDATED: 2,
  SCENE_BUILDING: 2,
  SCENE_INVALID: 2,
  UNSUPPORTED_MODEL: 2,
  SCENE_VALIDATED: 3,
  SOLVING: 3,
  SOLVER_FAILED: 3,
  VERIFYING: 4,
  VERIFICATION_FAILED: 4,
}

const WORKFLOW_FAILURES: readonly QuestionWorkflowState[] = [
  'PARSE_FAILED',
  'AMBIGUOUS',
  'INVALID_SEMANTICS',
  'SCENE_INVALID',
  'UNSUPPORTED_MODEL',
  'SOLVER_FAILED',
  'VERIFICATION_FAILED',
]

type WorkflowStepStatus = 'done' | 'failed' | 'pending'

/**
 * `processQuestion` is synchronous, so there is no progress to animate: the list
 * reports where the run ENDED. Faking a spinner would claim work is still
 * happening after the answer already exists.
 */
const workflowStepStatuses = (state: QuestionWorkflowState): readonly WorkflowStepStatus[] => {
  const failedAt = WORKFLOW_FAILURES.includes(state) ? WORKFLOW_STAGE[state] : undefined
  const reached = WORKFLOW_STAGE[state] ?? WORKFLOW_STEP_KEYS.length
  return WORKFLOW_STEP_KEYS.map((_, index) =>
    failedAt === index ? 'failed' : index < reached ? 'done' : 'pending')
}

/* --------------------------------------------------- named verification ------ */

/**
 * Engine plumbing, not physics: schema versions, id uniqueness, unit-registry
 * membership, finiteness of stored vectors, scene/result provenance. Each says
 * the DATA is well formed. A student learns nothing from `body_units_known:body-1`,
 * so the whole family collapses into one `场景结构有效` row.
 *
 * The `particle_*` entries are the point-particle twins of the `body_*` rules;
 * the same reasoning applies to both, so they are dropped together.
 */
const STRUCTURAL_PREFIXES: readonly string[] = [
  'scene_',
  'result_',
  'observable_',
  'timeline_',
  'coordinate_axes_',
  'field_',
  'body_present',
  'body_units_',
  'body_dimensions_',
  'body_position_finite',
  'body_velocity_finite',
  'particle_units_',
  'particle_dimensions_',
  'particle_position_finite',
  'particle_velocity_finite',
]

/** Same families, reached through a domain prefix such as `mechanics_result_schema`. */
const STRUCTURAL_FRAGMENTS: readonly string[] = [
  '_scene_',
  '_result_',
  '_schema',
  'state_objects_complete',
]

const isStructuralCheck = (id: string): boolean =>
  STRUCTURAL_PREFIXES.some(prefix => id.startsWith(prefix)) ||
  STRUCTURAL_FRAGMENTS.some(fragment => id.includes(fragment))

/**
 * Verifier check id → student-readable statement. A key matches an id exactly,
 * as a prefix (per-sample checks append `_<pointId>`) or as a suffix (domain
 * prefixes such as `body_mass_positive`); the longest key wins.
 */
const CHECK_LABEL_KEYS: Readonly<Record<string, PhysicsosKey>> = {
  newton_second_law: 'questions.check.newtonSecondLaw',
  kinematic_consistency: 'questions.check.kinematicConsistency',
  projectile_vx_constant: 'questions.check.projectileVxConstant',
  projectile_ay: 'questions.check.projectileAy',
  projectile_impact: 'questions.check.projectileImpact',
  incline_mg_sin: 'questions.check.inclineMgSin',
  incline_mg_cos: 'questions.check.inclineMgCos',
  incline_normal_force: 'questions.check.inclineNormalForce',
  zero_acceleration: 'questions.check.zeroAcceleration',
  velocity_conservation: 'questions.check.velocityConservation',
  velocity_change: 'questions.check.velocityChange',
  horizontal_velocity_constant: 'questions.check.horizontalVelocityConstant',
  vertical_acceleration: 'questions.check.verticalAcceleration',
  impact_y: 'questions.check.impactY',
  gravity_parallel: 'questions.check.gravityParallel',
  gravity_normal: 'questions.check.gravityNormal',
  normal_force: 'questions.check.normalForce',
  mass_positive: 'questions.check.massPositive',
  model_supported: 'questions.check.modelSupported',
  electric_force_consistency: 'questions.check.electricForce',
  electric_acceleration_consistency: 'questions.check.electricAcceleration',
  electric_kinematic_consistency: 'questions.check.electricKinematic',
  electric_energy_consistency: 'questions.check.electricEnergy',
  all_finite: 'questions.check.allFinite',
  magnetic_model_preconditions: 'questions.check.preconditions',
  model_assumptions: 'questions.check.assumptions',
  assumption: 'questions.check.assumptions',
  radius_consistency: 'questions.check.radius',
  period_consistency: 'questions.check.period',
  angular_velocity_consistency: 'questions.check.angularVelocity',
  force_magnitude: 'questions.check.forceMagnitude',
  orbit_center: 'questions.check.orbitCenter',
  rotation_direction: 'questions.check.rotationDirection',
  trajectory_radius_consistency: 'questions.check.trajectoryRadius',
  lorentz_force_vector: 'questions.check.lorentzForceVector',
  force_velocity_orthogonality: 'questions.check.forceOrthogonality',
  speed_conservation: 'questions.check.speedConservation',
  force_state_representations: 'questions.check.forceStates',
  initial_state_matches_scene: 'questions.check.initialState',
  state_at_period_matches_initial: 'questions.check.periodReturn',
}

const CHECK_LABEL_MATCHES: readonly string[] = Object.keys(CHECK_LABEL_KEYS)
  .sort((left, right) => right.length - left.length)

/** Category names for checks with no dedicated wording — still never a raw id. */
const CHECK_TYPE_KEYS: Readonly<Record<VerificationCheck['type'], PhysicsosKey>> = {
  schema: 'questions.checkType.schema',
  dimension: 'questions.checkType.dimension',
  symbolic: 'questions.checkType.symbolic',
  numerical: 'questions.checkType.numerical',
  constraint: 'questions.checkType.constraint',
  conservation: 'questions.checkType.conservation',
  boundary: 'questions.checkType.boundary',
  trajectory: 'questions.checkType.trajectory',
  continuity: 'questions.checkType.continuity',
  semantic: 'questions.checkType.semantic',
}

const checkLabel = (entry: VerificationCheck, t: Translate): string => {
  /* Verifiers append `:<targetId>` for per-object checks; the object is already
     named by the scene, so the statement is what matters here. */
  const id = entry.id.split(':')[0] ?? entry.id
  const match = CHECK_LABEL_MATCHES.find(key =>
    id === key || id.startsWith(key) || id.endsWith(key))
  const key = match === undefined ? CHECK_TYPE_KEYS[entry.type] : CHECK_LABEL_KEYS[match]
  return t(key ?? CHECK_TYPE_KEYS[entry.type])
}

/**
 * Collapse the verifier's raw checks into named physical statements. Per-sample
 * checks (one per trajectory point) share a statement, so rows are keyed by
 * label and their statuses ANDed — 40 identical PASS rows are noise, not proof.
 */
const namedChecks = (
  checks: readonly VerificationCheck[],
  t: Translate,
): readonly VerificationCheckView[] => {
  const physical = new Map<string, boolean>()
  let structural: boolean | undefined
  for (const entry of checks) {
    if (isStructuralCheck(entry.id)) {
      structural = (structural ?? true) && entry.passed
      continue
    }
    const label = checkLabel(entry, t)
    physical.set(label, (physical.get(label) ?? true) && entry.passed)
  }
  const rows = [...physical].map(([label, passed]): VerificationCheckView => ({
    id: label,
    label,
    status: passed ? 'passed' : 'failed',
  }))
  if (structural === undefined) return rows
  return [...rows, {
    id: 'structural',
    label: t('questions.check.structural'),
    status: structural ? 'passed' : 'failed',
  }]
}

/* ------------------------------------------------------ playback + frames --- */

interface QuestionTimeline {
  readonly start: number
  readonly end: number
  /** Scene times of the sampled states; empty when the domain has no samples. */
  readonly times: readonly number[]
  /** Physical seconds the playback clock advances per wall-clock second at 1x. */
  readonly physicalPerWallSecond: number
}

const questionTimeline = (result: QuestionRuntimeResult): QuestionTimeline => {
  if (result.workflowState !== 'READY' || result.scene === null) {
    return { start: 0, end: 0, times: [], physicalPerWallSecond: 1 }
  }
  /* One magnetic orbit is presented over a fixed wall-clock window; the
     microscopic physical time is derived from it, never used as the slider domain. */
  if (result.ir?.domain === 'magnetic') {
    return { start: 0, end: MAGNETIC_CYCLE_WALL_SECONDS, times: [], physicalPerWallSecond: 1 }
  }
  const states = result.simulation?.states ?? []
  const start = states[0]?.time.value ?? 0
  const end = states.at(-1)?.time.value ?? start
  /* Mechanics runs at human scale and plays 1:1. Every charged-particle domain
     is microscopic (ns–µs windows), so its whole window is paced over the micro
     presentation window instead of vanishing inside the first frame. */
  const physicalPerWallSecond = result.ir?.domain !== 'mechanics' && end > start
    ? (end - start) / MICRO_WINDOW_WALL_SECONDS
    : 1
  return {
    start,
    end,
    times: states.map(state => state.time.value),
    physicalPerWallSecond,
  }
}

interface Playback {
  readonly time: number
  readonly start: number
  readonly end: number
  readonly running: boolean
  readonly toggle: () => void
  readonly stepForward: () => void
  readonly seek: (time: number) => void
}

/**
 * The one playback clock in Question Space. Keyed by scene identity so a new
 * question rewinds during render instead of through an effect that would paint
 * one frame of the previous scene's time on the new scene.
 */
function usePlayback(timeline: QuestionTimeline, sceneKey: string): Playback {
  const { start, end, times, physicalPerWallSecond } = timeline
  const [clock, setClock] = useState({ key: sceneKey, time: start, running: false })
  const current = clock.key === sceneKey ? clock : { key: sceneKey, time: start, running: false }

  useAnimationClock(current.running && end > start, (elapsedSeconds) => {
    setClock((previous) => {
      const next = previous.time + elapsedSeconds * physicalPerWallSecond
      return next >= end
        ? { key: sceneKey, time: end, running: false }
        : { key: sceneKey, time: next, running: true }
    })
  })

  return {
    time: current.time,
    start,
    end,
    running: current.running,
    toggle: () => {
      setClock({
        key: sceneKey,
        time: current.time >= end ? start : current.time,
        running: !current.running,
      })
    },
    stepForward: () => {
      const nextSample = times.find(candidate => candidate > current.time + 1e-9)
      setClock({
        key: sceneKey,
        time: nextSample ?? Math.min(end, current.time + (end - start) * STEP_FRACTION),
        running: false,
      })
    },
    seek: (value: number) => {
      setClock({ key: sceneKey, time: Math.min(end, Math.max(start, value)), running: false })
    },
  }
}

interface QuestionFrames {
  readonly view: SceneVisualModel
  /** Provenance line above the canvas. */
  readonly engineLabel: string
  readonly ariaLabel: string
  readonly timeLabel: string
  /** Scene times parallel to the history trajectory; empty disables hover and seek. */
  readonly trajectoryTimes: readonly number[]
  readonly sampleReadout?: (index: number) => readonly { label: string; value: string }[]
}

interface MagneticFrameSource {
  readonly key: string
  readonly runtime: MagneticRuntimeBridge
}

/**
 * The frame the canvas should show at `time`, whichever domain the question
 * produced. Hooks are unconditional and the domain branch lives inside the memo,
 * so switching question domain never reorders hooks.
 */
function useQuestionFrames(
  result: QuestionRuntimeResult,
  title: string,
  time: number,
): QuestionFrames | null {
  const scene = result.workflowState === 'READY' ? result.scene : null
  const simulation = result.simulation
  const domain = result.ir?.domain
  const engine = useMemo(() => new MechanicsEngine(), [])
  /* resolveUniformElectricModel is the UNBOUNDED uniform-field trajectory solver.
     Two electric scenes must not reach it: a point-charge scene has no uniform
     field and no trajectory ("inputs are incomplete"), and a parallel-plate scene
     binds its field to a region, which that engine's canHandle rejects outright
     ("electric_force_only") — throwing inside a render and blanking the surface.
     Each reads its own solver below. */
  const region = domain === 'electric' && scene !== null && isParallelPlateScene(scene)
  const electricModel = useMemo(
    () => (domain === 'electric' && scene !== null && !isPointChargeScene(scene) && !isParallelPlateScene(scene)
      ? resolveUniformElectricModel(scene)
      : null),
    [domain, scene],
  )

  /* The magnetic bridge is a stateful runtime, not a pure function, so it is
     rebuilt when scene identity changes rather than mutated behind the canvas. */
  const sceneKey = scene === null ? '' : `${String(scene.id)}:${scene.revision}`
  const magneticRef = useRef<MagneticFrameSource | null>(null)
  if (domain === 'magnetic' && scene !== null && magneticRef.current?.key !== sceneKey) {
    magneticRef.current = { key: sceneKey, runtime: createMagneticRuntime(scene) }
  }
  const magnetic = domain === 'magnetic' ? magneticRef.current : null

  return useMemo(() => {
    if (scene === null) return null
    if (magnetic !== null) {
      /* seek() is idempotent — the same scene time always renders the same
         snapshot — so driving it from the shared clock is safe under a re-render. */
      const snapshot = magnetic.runtime.seek(
        magneticPhysicalDelta(time, magnetic.runtime.getSnapshot().clock.total),
      )
      return {
        view: snapshot.visual,
        engineLabel: snapshot.status === 'verified' ? 'Physics Engine · Verified' : '需要检查场景',
        ariaLabel: '磁场中的带电粒子运动',
        timeLabel: `${snapshot.clock.time.toExponential(2)} s`,
        trajectoryTimes: [],
      }
    }
    if (simulation === null) return null
    const start = simulation.states[0]?.time.value ?? 0
    const end = simulation.states.at(-1)?.time.value ?? start
    const at = Math.min(end, Math.max(start, time))
    const trajectoryTimes = simulation.states.map(state => state.time.value)
    const timeLabel = `${at.toFixed(2)} / ${end.toFixed(2)} s`
    if (region) {
      /* Bounded field: the region engine solves each phase analytically (straight
         outside, parabolic inside, stopped at a plate), so any scene time maps to
         a state without re-integrating. The visual bridge routes to the plate
         renderer off the scene's own regions/boundaries. */
      const state = electricRegionEngine.stateAtSeconds(scene, at)
      const observed = observeElectricScene({ scene, simulation, state })
      const particleId = scene.particles[0]?.id ?? 'particle-1'
      return {
        view: electricSceneVisualAt({
          scene,
          simulation,
          observations: observed.observations,
          state,
        }),
        engineLabel: 'Electric Region Engine · Verified',
        ariaLabel: `${title}的可验证平行板电场图`,
        timeLabel,
        trajectoryTimes,
        sampleReadout: (index: number) => electricSampleReadout(simulation, particleId, index),
      }
    }
    if (electricModel !== null) {
      const state = evaluateUniformElectricState(electricModel, at)
      const observed = observeElectricScene({ scene, simulation, state })
      const particleId = scene.particles[0]?.id ?? 'particle-1'
      return {
        view: electricSceneVisualAt({
          scene,
          simulation,
          observations: observed.observations,
          state,
        }),
        engineLabel: 'Electric Engine · Verified',
        ariaLabel: `${title}的可验证电场图`,
        timeLabel,
        trajectoryTimes,
        sampleReadout: (index: number) => electricSampleReadout(simulation, particleId, index),
      }
    }
    if (domain === 'electric') {
      /* Point-charge world: static, one state. The field/force live on the probe
         (or the declared sample point), never on a trajectory integration, so we
         read the verified SimulationState directly and let the visual bridge route
         to electricPointChargeVisualAt. */
      const state = simulation.states[0]
      if (state === undefined) return null
      const observed = observeElectricScene({ scene, simulation, state })
      /* R1: a multi-source scene has several `source-*` particles, so filtering out
         only `source-1` would misidentify `source-2` as the probe. probeParticleOf
         excludes every declared source and returns the probe (or undefined for a
         pure-field question with no probe). */
      const probeId = probeParticleOf(scene.particles, scene.fields)?.id ?? 'probe-1'
      return {
        view: electricSceneVisualAt({
          scene,
          simulation,
          observations: observed.observations,
          state,
        }),
        engineLabel: 'Electric Engine · Verified',
        ariaLabel: `${title}的可验证点电荷电场图`,
        timeLabel,
        trajectoryTimes,
        sampleReadout: (index: number) => electricSampleReadout(simulation, probeId, index),
      }
    }
    if (domain !== 'mechanics') return null
    const state = engine.stateAt(scene, { value: at, unit: 's', dimension: 'time' })
    const observations = observeMechanicsScene({ scene, simulation, state }).observations
    const bodyId = scene.bodies[0]?.id ?? 'body-1'
    return {
      view: mechanicsSceneVisualAt({
        scene,
        simulation,
        observations,
        stateIndex: nearestTimedStateIndex(simulation.states, at),
        state,
      }),
      engineLabel: 'Mechanics Engine · Verified',
      ariaLabel: `${title}的可验证物理图`,
      timeLabel,
      trajectoryTimes,
      sampleReadout: (index: number) => mechanicsSampleReadout(simulation, bodyId, index),
    }
  }, [scene, simulation, domain, engine, electricModel, magnetic, region, time, title])
}

/**
 * The single canvas surface in Question Space: provenance line, the shared
 * PhysicsCanvas, one set of playback controls. Every domain reaches the student
 * through here, so play / step / scrub behave identically everywhere.
 */
function QuestionVisualization({
  frames,
  playback,
  sceneId,
  highlighted,
}: {
  readonly frames: QuestionFrames
  readonly playback: Playback
  readonly sceneId: string
  readonly highlighted: readonly string[]
}) {
  const view = highlighted.length === 0 ? frames.view : { ...frames.view, highlighted }
  return (
    <div className={css.canvasWrap}>
      <div className={css.canvasMeta}>
        <span>{frames.engineLabel}</span>
        <span>{sceneId}</span>
      </div>
      <div className={css.canvas}>
        <PhysicsCanvas
          view={view}
          ariaLabel={frames.ariaLabel}
          trajectoryTimes={frames.trajectoryTimes}
          onSeekTime={playback.seek}
          {...(frames.sampleReadout === undefined ? {} : { sampleReadout: frames.sampleReadout })}
        />
      </div>
      <div className={css.canvasControls}>
        <button
          type="button"
          aria-label={playback.running ? '暂停动画' : '播放动画'}
          /* A single-state question has nothing to play (end === start): the clock
             would never tick, so the button must not flip into a stuck "playing". */
          disabled={playback.end <= playback.start}
          onClick={playback.toggle}
        >
          {playback.running ? <IconPhysicsPause size={13} /> : <IconPhysicsPlay size={13} />}
        </button>
        <button type="button" aria-label="下一步" onClick={playback.stepForward}>
          <IconChevronRightOutline14 size={13} />
        </button>
        <TimelineScrubber
          label="动画时间轴"
          min={playback.start}
          max={playback.end}
          value={playback.time}
          valueText={frames.timeLabel}
          onChange={playback.seek}
        />
        <span>{frames.timeLabel}</span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- the workspace --- */

interface HighlightSelection {
  /** Namespaced control id, so a Known and a step result never claim each other. */
  readonly token: string
  readonly ids: readonly string[]
}

export function QuestionWorkspace({
  t,
  openSurface,
  usePhysicsSurface,
  recordAttempt,
  consumeQuestion,
}: QuestionWorkspaceProps) {
  const [draft, setDraft] = useState(INITIAL_DOCUMENT.content.rawText ?? '')
  const [document, setDocument] = useState(INITIAL_DOCUMENT)
  const [highlight, setHighlight] = useState<HighlightSelection | null>(null)
  const result = useMemo(() => processQuestion(document), [document])
  const scene = result.workflowState === 'READY' ? result.scene : null
  const canOpenInLab = scene !== null
  const title = document.metadata.title ?? '未命名题目'
  const sceneKey = scene === null ? String(document.id) : `${String(scene.id)}:${scene.revision}`
  const timeline = useMemo(() => questionTimeline(result), [result])
  const playback = usePlayback(timeline, sceneKey)
  const frames = useQuestionFrames(result, title, playback.time)
  const drawn = useMemo(() => drawnIds(frames?.view ?? null), [frames])

  const highlightFor = (symbols: readonly string[]): readonly string[] =>
    highlightableIds(symbols, result.ir?.domain, scene?.bodies[0]?.id, drawn)
  const toggleHighlight = (token: string, ids: readonly string[]) => {
    setHighlight(active => (active?.token === token ? null : { token, ids }))
  }

  const selectQuestion = (definition: GoldenQuestionDefinition) => {
    setDraft(definition.text)
    setDocument(createGoldenQuestionDocument(definition))
    setHighlight(null)
  }

  /* 重新练习 deep link: 学习记录 hands over one golden-question id; take it once
     and clear the ref so navigating back later does not re-select it. */
  const requestedQuestionId = usePhysicsSurface(state => state.questionId)
  useEffect(() => {
    if (requestedQuestionId === undefined) return
    const definition = GOLDEN_QUESTIONS.find(entry => entry.id === requestedQuestionId)
    if (definition !== undefined) {
      setDraft(definition.text)
      setDocument(createGoldenQuestionDocument(definition))
      setHighlight(null)
    }
    consumeQuestion?.()
  }, [requestedQuestionId, consumeQuestion])

  /* The golden question the document currently IS — id must match AND the text
     must be untouched, so a custom draft never inherits another question's quiz. */
  const golden = useMemo(() => {
    const id = String(document.id)
    if (!id.startsWith('golden-')) return undefined
    const definition = GOLDEN_QUESTIONS.find(entry => `golden-${entry.id}` === id)
    if (definition === undefined) return undefined
    return definition.text === (document.content.extractedText ?? document.content.rawText)
      ? definition
      : undefined
  }, [document])

  const processDraft = () => {
    const text = draft.trim()
    if (text.length === 0) return
    setHighlight(null)
    setDocument(current => ({
      ...current,
      updatedAt: new Date().toISOString(),
      content: {
        ...current.content,
        rawText: text,
        extractedText: text,
        status: 'EXTRACTED',
      },
      metadata: {
        ...current.metadata,
        title: text.length > 28 ? `${text.slice(0, 28)}…` : text,
      },
    }))
  }

  return (
    <div className={css.cover} data-physicsos-surface="questions" data-workflow={result.workflowState}>
      <header className={css.toolbar}>
        <div className={css.identity}>
          <span className={css.eyebrow}>PhysicsOS / 试题空间</span>
          <h1 className={css.title}>{title}</h1>
        </div>
        <div className={css.toolbarActions}>
          <span className={clsx(css.status, result.workflowState === 'READY' && css.statusReady)}>
            <span className={css.statusDot} />
            {WORKFLOW_LABELS[result.workflowState]}
          </span>
          <button
            type="button"
            className={css.secondaryButton}
            onClick={() => {
              /* Restore the textarea to the initial document's own text, so the
                 input and the document being analyzed never drift apart. */
              setDraft(INITIAL_DOCUMENT.content.rawText ?? '')
              setDocument(INITIAL_DOCUMENT)
              setHighlight(null)
            }}
          >
            <IconRefreshOutline16 size={13} />
            重置
          </button>
          <button
            type="button"
            className={css.primaryButton}
            disabled={!canOpenInLab}
            onClick={() => {
              if (scene !== null) openSurface?.('lab', { sceneId: String(scene.id), scene })
            }}
          >
            <IconChevronRightOutline14 size={13} />
            在物理世界中打开
          </button>
        </div>
      </header>

      <div className={css.layout}>
        <aside className={`${css.panel} ${css.leftRail}`} aria-label="题目输入与历史">
          <div className={css.panelHeader}>
            <h2>题目输入</h2>
            <span className={css.panelMeta}>文字题</span>
          </div>
          <div className={css.panelBody}>
            <textarea
              className={css.questionInput}
              aria-label="题目文本"
              value={draft}
              placeholder="粘贴一道物理题，PhysicsOS 会建立对应的物理场景。"
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button type="button" className={css.processButton} onClick={processDraft} disabled={draft.trim().length === 0}>
              <IconPhysicsPlay size={13} />
              解析这道题
            </button>
            <p className={css.inputNote}>图片和 PDF 输入会在接入识别服务后开放。</p>

            <div className={css.sectionHeader}>
              <h3>示例题目</h3>
              <span>{GOLDEN_QUESTIONS.length}</span>
            </div>
            <div className={css.questionList}>
              {GOLDEN_QUESTIONS.map(definition => (
                <button
                  type="button"
                  key={definition.id}
                  className={clsx(css.questionItem, document.metadata.title === definition.title && css.questionItemActive)}
                  onClick={() => { selectQuestion(definition) }}
                >
                  <span>{definition.title}</span>
                  <span className={css.questionItemArrow}>›</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className={`${css.panel} ${css.mainPanel}`}>
          <div className={css.panelHeader}>
            <div>
              <h2>题目理解</h2>
              <p className={css.panelSubhead}>从文本到可验证的物理模型</p>
            </div>
            {/* The scene revision is the fact worth surfacing here: it is what ties
                the document, the solution and the Lab to one physical world. A
                sliced document id only produced a meaningless word fragment. */}
            <span className={css.revision}>
              {scene === null ? '未建立场景' : `场景修订 r${scene.revision}`}
            </span>
          </div>
          <div className={css.mainBody}>
            <section className={css.stemBlock}>
              <div className={css.stemLabel}>题干</div>
              <div className={css.stemDocument}>
                <p>{document.content.extractedText ?? document.content.rawText ?? '请输入题目文本。'}</p>
              </div>
            </section>

            <div className={css.factGrid}>
              <KnownsBlock
                knowns={result.ir?.knowns ?? []}
                highlight={highlight}
                highlightFor={highlightFor}
                onToggle={toggleHighlight}
                t={t}
              />
              <FactList
                title="求解目标"
                items={
                  /* `time` and `flight_time` are the same quantity for a projectile,
                     and the parser can emit both; a student should see one target,
                     not the parser's internal keys twice. */
                  targetLabels(result.ir)
                }
                empty="等待解析"
              />
              <FactList title="物理关系" items={result.ir?.relations.map(relation => relationLabel(relation)) ?? []} empty="等待解析" />
            </div>

            <section className={css.visualSection}>
              <div className={css.sectionHeader}>
                <div>
                  <h3>可视化验证</h3>
                  <span className={css.sectionHint}>画布只消费 Runtime 输出，不在 UI 中重新计算</span>
                </div>
                {result.validation?.status === 'VALID' ? <span className={css.validBadge}><IconCheckOutline14 size={12} />条件完整</span> : null}
              </div>
              {frames === null || scene === null
                ? <WorkflowProgress state={result.workflowState} t={t} />
                : (
                  <QuestionVisualization
                    frames={frames}
                    playback={playback}
                    sceneId={String(scene.id)}
                    highlighted={highlight?.ids ?? []}
                  />
                )}
            </section>
          </div>
        </main>

        <aside className={`${css.panel} ${css.rightRail}`} aria-label="解题结果与验证">
          <div className={css.panelHeader}>
            <h2>解析结果</h2>
            <span className={css.panelMeta}>{result.validation?.status ?? '等待'}</span>
          </div>
          <div className={css.panelBody}>
            <ResultSummary result={result} t={t} />
            <section className={css.solutionSection}>
              <div className={css.sectionHeader}>
                <h3>解析步骤</h3>
                <span>{result.solution?.steps.length ?? 0} 步</span>
              </div>
              {result.solution === null
                ? <p className={css.muted}>解析成功后显示推导过程。</p>
                : (
                  <SolutionSteps
                    steps={result.solution.steps}
                    highlight={highlight}
                    highlightFor={highlightFor}
                    onToggle={toggleHighlight}
                    t={t}
                  />
                )}
            </section>
            <section className={css.solutionSection}>
              <div className={css.sectionHeader}><h3>验证详情</h3></div>
              {result.simulation !== null
                ? <VerificationDisclosure checks={result.simulation.verification.checks} t={t} />
                : result.validation !== null && result.validation.issues.length > 0
                  ? (
                    <ul className={css.issueList}>
                      {result.validation.issues.map(issue => (
                        <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                      ))}
                    </ul>
                  )
                  : <p className={css.muted}>{validationMessage(result)}</p>}
            </section>
            {golden === undefined ? null : (
              <SelfCheckSection
                key={golden.id}
                golden={golden}
                simulationChecks={result.simulation?.verification.checks ?? []}
                onRecord={recordAttempt}
              />
            )}
            {golden === undefined ? null : <KnowledgeSection questionId={golden.id} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- mistake diagnosis -- */

const MISTAKE_TYPE_LABELS: Record<string, string> = {
  concept: '概念错误',
  direction: '方向错误',
  modeling: '建模错误',
}

/**
 * 错误诊断 · 自测. Each item is a conceptual probe about THIS question; a wrong
 * pick opens a diagnosis card naming the mistake class, explaining it, citing
 * the live Verifier check when one asserts the underlying fact, and pointing at
 * what to review. Every answer is written to the learning record.
 */
function SelfCheckSection({
  golden,
  simulationChecks,
  onRecord,
}: {
  readonly golden: GoldenQuestionDefinition
  readonly simulationChecks: readonly VerificationCheck[]
  readonly onRecord: ((attempt: SelfCheckAttemptInput) => void) | undefined
}) {
  /* Answers keyed by item id; remounted per question via the `key` below. */
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({})
  const items = selfChecksOfQuestion(golden.id)
  if (items.length === 0) return null

  const answer = (item: SelfCheckItem, option: SelfCheckOption) => {
    if (answers[item.id] !== undefined) return
    setAnswers(current => ({ ...current, [item.id]: option.id }))
    onRecord?.({
      questionId: golden.id,
      questionTitle: golden.title,
      selfCheckId: item.id,
      prompt: item.prompt,
      answerId: option.id,
      answerLabel: option.label,
      correct: option.correct === true,
      ...(option.mistake === undefined ? {} : { mistakeType: option.mistake.type }),
      knowledge: QUESTION_KNOWLEDGE[golden.id] ?? [],
    })
  }

  return (
    <section className={css.solutionSection} data-physicsos-selfcheck={golden.id}>
      <div className={css.sectionHeader}>
        <h3>错误诊断 · 自测</h3>
        <span>{items.length} 题</span>
      </div>
      {items.map((item) => {
        const chosenId = answers[item.id]
        const chosen = item.options.find(option => option.id === chosenId)
        return (
          <div key={item.id} className={css.selfCheckItem}>
            <p className={css.selfCheckPrompt}>{item.prompt}</p>
            <div className={css.selfCheckOptions}>
              {item.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={clsx(
                    css.selfCheckOption,
                    chosenId === option.id && option.correct === true && css.selfCheckCorrect,
                    chosenId === option.id && option.correct !== true && css.selfCheckWrong,
                    chosenId !== undefined && chosenId !== option.id && option.correct === true && css.selfCheckReveal,
                  )}
                  disabled={chosenId !== undefined}
                  onClick={() => { answer(item, option) }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {chosen === undefined ? null : chosen.correct === true ? (
              <div className={css.selfCheckTakeaway} data-selfcheck-result="correct">
                <IconCheckOutline14 size={12} />
                {item.takeaway}
              </div>
            ) : (
              <DiagnosisCard option={chosen} simulationChecks={simulationChecks} />
            )}
          </div>
        )
      })}
    </section>
  )
}

/**
 * A self-check evidence id names a physical FACT; each engine asserts it under
 * its own check id. The composite engine checks `magnetic_force_does_no_work`
 * literally, while the magnetic verifier asserts the observable consequence
 * `speed_conservation`. Resolution tries the literal id first, then the
 * equivalents, and the card names both so the citation stays exact.
 */
const EVIDENCE_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  magnetic_force_does_no_work: ['speed_conservation'],
  speed_conserved_in_pure_magnetic: ['speed_conservation'],
}

const resolveEvidence = (
  checks: readonly VerificationCheck[],
  factId: string | undefined,
): VerificationCheck | undefined => {
  if (factId === undefined) return undefined
  const literal = checks.find(check => check.id === factId)
  if (literal !== undefined) return literal
  for (const equivalent of EVIDENCE_EQUIVALENTS[factId] ?? []) {
    const found = checks.find(check => check.id === equivalent)
    if (found !== undefined) return found
  }
  return undefined
}

/** The diagnosis a wrong option opens: 类型 → 解释 → Verifier 证据 → 复习建议. */
function DiagnosisCard({
  option,
  simulationChecks,
}: {
  readonly option: SelfCheckOption
  readonly simulationChecks: readonly VerificationCheck[]
}) {
  const mistake = option.mistake
  if (mistake === undefined) return null
  const evidence = resolveEvidence(simulationChecks, mistake.evidenceCheckId)
  return (
    <div className={css.diagnosisCard} data-selfcheck-result="wrong" data-mistake={mistake.type}>
      <span className={css.diagnosisBadge} data-mistake={mistake.type}>
        {MISTAKE_TYPE_LABELS[mistake.type] ?? mistake.type}
      </span>
      <p className={css.diagnosisExplanation}>{mistake.explanation}</p>
      {evidence === undefined ? null : (
        <p className={css.diagnosisEvidence} data-passed={evidence.passed}>
          Verifier：{mistake.evidenceCheckId}
          {' '}
          {evidence.passed ? 'PASS' : 'FAIL'}
          {evidence.id === mistake.evidenceCheckId ? '' : `（判据：${evidence.id}）`}
        </p>
      )}
      <div className={css.diagnosisReview}>
        <span>建议复习</span>
        {mistake.review.map(topic => (
          <span key={topic} className={css.diagnosisReviewChip}>{topic}</span>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- knowledge summary -- */

/** 知识总结: the curriculum nodes this question exercises, grouped by subject. */
function KnowledgeSection({ questionId }: { readonly questionId: string }) {
  const nodes = knowledgeNodesOfQuestion(questionId)
  if (nodes.length === 0) return null
  return (
    <section className={css.solutionSection} data-physicsos-knowledge={questionId}>
      <div className={css.sectionHeader}><h3>知识总结</h3></div>
      <div className={css.knowledgeChips}>
        {nodes.map(node => (
          <span key={node.id} className={css.knowledgeChip} data-domain={node.domain}>
            {node.label}
          </span>
        ))}
      </div>
      <p className={css.knowledgeNote}>做错的知识点会进入学习记录，可随时回来重新练习。</p>
    </section>
  )
}

/* ------------------------------------------------------------------ knowns -- */

interface HighlightControl {
  readonly highlight: HighlightSelection | null
  readonly highlightFor: (symbols: readonly string[]) => readonly string[]
  readonly onToggle: (token: string, ids: readonly string[]) => void
  readonly t: Translate
}

/**
 * Knowns as controls. A quantity the canvas can point at becomes a button; one it
 * cannot (a magnetic flux density has no arrow) stays a caption, because a button
 * that changes nothing teaches the student that clicking is pointless.
 */
function KnownsBlock({
  knowns,
  highlight,
  highlightFor,
  onToggle,
  t,
}: HighlightControl & { readonly knowns: readonly KnownValue[] }) {
  return (
    <section className={css.factBlock}>
      <h3>已知条件</h3>
      {knowns.length === 0 ? <p className={css.muted}>等待解析</p> : (
        <>
          <ul className={css.knownList}>
            {knowns.map((known) => {
              const ids = highlightFor([known.key, known.symbol])
              const token = `known:${known.key}`
              const active = highlight?.token === token
              const body = (
                <>
                  <MathText expression={mathSymbol(known.symbol)} />
                  <span className={css.knownValue}>{' = '}{knownValueText(known)}</span>
                </>
              )
              return (
                <li key={known.key}>
                  {ids.length === 0
                    ? <span className={css.knownStatic}>{body}</span>
                    : (
                      <button
                        type="button"
                        className={clsx(css.knownButton, active && css.knownButtonActive)}
                        aria-pressed={active}
                        aria-label={t(
                          active ? 'questions.knownHighlightClear' : 'questions.knownHighlight',
                          { symbol: known.symbol },
                        )}
                        onClick={() => { onToggle(token, ids) }}
                      >
                        {body}
                      </button>
                    )}
                </li>
              )
            })}
          </ul>
          <p className={css.factHint}>{t('questions.knownsHint')}</p>
        </>
      )}
    </section>
  )
}

function FactList({ title, items, empty }: { title: string; items: readonly string[]; empty: string }) {
  return (
    <section className={css.factBlock}>
      <h3>{title}</h3>
      {items.length === 0 ? <p className={css.muted}>{empty}</p> : <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>}
    </section>
  )
}

/* ---------------------------------------------------------------- solution --- */

/**
 * The formula for a step. `buildSolution` writes the equation into `title` for
 * computation steps and a sentence for framing steps, so an equation is detected
 * rather than assumed — and `step.formula` wins once the core starts filling it.
 */
const stepFormula = (step: QuestionSolutionStep): string | null =>
  step.formula?.expression ?? (/[=√]/.test(step.title) ? step.title : null)

function SolutionSteps({
  steps,
  highlight,
  highlightFor,
  onToggle,
  t,
}: HighlightControl & { readonly steps: readonly QuestionSolutionStep[] }) {
  return (
    <ol className={css.steps}>
      {steps.map((step) => {
        const formula = stepFormula(step)
        const symbol = step.resultSymbol
        const ids = symbol === undefined ? [] : highlightFor([symbol])
        const token = `step:${step.index}`
        const active = highlight?.token === token
        const value = symbol === undefined || step.resultValue === undefined ? null : (
          <>
            <MathText expression={mathSymbol(symbol)} />
            {' = '}
            {step.resultValue}
            {step.resultUnit === undefined ? '' : ` ${step.resultUnit}`}
          </>
        )
        return (
          <li key={step.index} className={css.step}>
            <span className={css.stepIndex}>
              {t('questions.step', { index: String(step.index).padStart(2, '0') })}
            </span>
            <div className={css.stepBody}>
              {formula === null
                ? <strong>{step.title}</strong>
                : <strong className={css.stepFormula}><MathText expression={formula} /></strong>}
              {step.description === '' ? null : <p>{step.description}</p>}
              {value === null
                ? null
                : ids.length === 0
                  ? <output className={css.stepResult}>{value}</output>
                  : (
                    <button
                      type="button"
                      className={clsx(css.stepResult, css.stepResultButton, active && css.knownButtonActive)}
                      aria-pressed={active}
                      aria-label={t(
                        active ? 'questions.knownHighlightClear' : 'questions.knownHighlight',
                        { symbol },
                      )}
                      onClick={() => { onToggle(token, ids) }}
                    >
                      {value}
                    </button>
                  )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------ verification + workflow --- */

/**
 * `已验证 ✓` that opens onto named physical statements. Collapsed by default:
 * the headline a student needs is that the physics checked out, not 60 rows.
 */
function VerificationDisclosure({
  checks,
  t,
}: {
  readonly checks: readonly VerificationCheck[]
  readonly t: Translate
}) {
  const rows = useMemo(() => namedChecks(checks, t), [checks, t])
  if (rows.length === 0) return <p className={css.muted}>{t('questions.verificationDetails')}</p>
  const passed = rows.filter(row => row.status === 'passed').length
  const allPassed = passed === rows.length
  return (
    <details className={css.verifyBlock}>
      <summary className={css.verifySummary}>
        <span className={clsx(css.verifyMark, allPassed ? css.verifyMarkOk : css.verifyMarkFail)}>
          {allPassed ? <IconCheckOutline14 size={12} /> : <IconCloseOutline16 size={12} />}
        </span>
        <strong>{allPassed ? t('questions.verified') : t('questions.verificationFailed')}</strong>
        <span className={css.verifyCount}>
          {t('questions.verificationCount', { passed, total: rows.length })}
        </span>
      </summary>
      <VerificationList checks={rows} emptyLabel={t('questions.verificationDetails')} />
    </details>
  )
}

/**
 * Where the run stopped, not a spinner. `processQuestion` is synchronous, so an
 * animated indeterminate state would claim work that already finished.
 */
function WorkflowProgress({
  state,
  t,
}: {
  readonly state: QuestionWorkflowState
  readonly t: Translate
}) {
  const statuses = workflowStepStatuses(state)
  return (
    <div className={css.workflow}>
      <div className={css.sectionHeader}>
        <h3>{t('questions.workflow.title')}</h3>
        <span>{WORKFLOW_LABELS[state] ?? state}</span>
      </div>
      <ol className={css.workflowList}>
        {WORKFLOW_STEP_KEYS.map((key, index) => {
          const status = statuses[index] ?? 'pending'
          return (
            <li key={key} className={css.workflowStep} data-status={status}>
              <span className={css.workflowMark}>
                {status === 'done'
                  ? <IconCheckOutline14 size={11} />
                  : status === 'failed'
                    ? <IconCloseOutline16 size={11} />
                    : index + 1}
              </span>
              <span className={css.workflowLabel}>{t(key)}</span>
              <span className={css.workflowStatus}>
                {t(status === 'done'
                  ? 'questions.workflow.done'
                  : status === 'failed' ? 'questions.workflow.failed' : 'questions.workflow.pending')}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ result --- */

function ResultSummary({ result, t }: { readonly result: QuestionRuntimeResult; readonly t: Translate }) {
  if (result.workflowState === 'UNSUPPORTED_MODEL') return <UnsupportedNotice result={result} t={t} />
  if (result.error !== undefined || result.workflowState !== 'READY') {
    return (
      <div className={css.resultWarning}>
        <span className={css.warningMark}><IconCloseOutline16 size={14} /></span>
        <div><strong>{WORKFLOW_LABELS[result.workflowState]}</strong><p>{validationMessage(result)}</p></div>
      </div>
    )
  }
  const values = result.solution === null ? [] : Object.values(result.solution.results)
  return (
    <div className={css.resultReady}>
      <div className={css.resultReadyHeader}>
        <span className={css.successMark}><IconCheckOutline14 size={13} /></span>
        <strong>验证通过</strong>
      </div>
      <div className={css.resultValues}>
        {values.map(value => (
          <div key={value.symbol} className={css.resultValue}>
            <span>{value.label} <em><MathText expression={mathSymbol(value.symbol)} /></em></span>
            <strong>{value.value} <small>{value.unit}</small></strong>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * An unsupported model is a gap in PhysicsOS, not a user mistake: say which part
 * is missing and show what the parser DID read, so the student is not stranded on
 * a generic retry prompt.
 */
function UnsupportedNotice({ result, t }: { readonly result: QuestionRuntimeResult; readonly t: Translate }) {
  const knowns = result.ir?.knowns ?? []
  return (
    <div className={css.resultWarning}>
      <span className={css.warningMark}><IconCloseOutline16 size={14} /></span>
      <div>
        <strong>{t('questions.unsupportedTitle')}</strong>
        <p>{t('questions.unsupportedBody')}</p>
        <details className={css.recognized}>
          <summary>{t('questions.recognized')}</summary>
          {knowns.length === 0
            ? <p className={css.muted}>{t('questions.recognizedEmpty')}</p>
            : (
              <ul className={css.recognizedList}>
                {knowns.map(known => (
                  <li key={known.key}>
                    <span>{known.label}</span>
                    <span>
                      <MathText expression={mathSymbol(known.symbol)} />
                      {' = '}{knownValueText(known)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </details>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- helpers --- */

function relationLabel(relation: string): string {
  const labels: Record<string, string> = {
    velocity_perpendicular_B: '速度垂直于磁场',
    velocity_parallel_B: '速度平行于磁场',
    constant_velocity: '速度保持不变',
    constant_acceleration: '加速度恒定',
    free_flight: '忽略空气阻力',
    on_incline: '物体位于斜面上',
    charged_particle_in_uniform_electric_field: '带电粒子处于匀强电场中',
    velocity_parallel_E: '初速度平行于电场',
    velocity_perpendicular_E: '初速度垂直于电场',
  }
  return labels[relation] ?? relation
}

/** Value plus unit, unless the parser already appended the unit to displayValue. */
const knownValueText = (item: KnownValue): string => {
  const value = item.displayValue ?? String(item.value)
  return item.unit === '' || item.displayValue?.endsWith(item.unit) === true
    ? value
    : `${value} ${item.unit}`
}

/**
 * Presentation only: the IR stores flat symbols (`v0`, `vx`) while MathText wants
 * the script (`v_0`, `v_x`). Two-character quantities are the whole vocabulary
 * here, so this stays a regex rather than a symbol table.
 */
const mathSymbol = (symbol: string): string =>
  /^[A-Za-z][0-9xyz]$/.test(symbol) ? `${symbol[0] ?? ''}_${symbol[1] ?? ''}` : symbol

function validationMessage(result: QuestionRuntimeResult): string {
  const issue = result.validation?.issues[0]
  return issue?.message ?? '请检查题干中的物理量、单位和方向。'
}
