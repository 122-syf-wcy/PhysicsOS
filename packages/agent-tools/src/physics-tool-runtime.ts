/**
 * PhysicsToolRuntime — the model-facing physics surface.
 *
 * Owns a registry of live scenes (each behind a real SceneRuntime, so every edit
 * is an auditable revision) and exposes the six operations an agent needs:
 * solve a question text, open a catalogued experiment, describe a scene, apply
 * a SceneCommand, simulate + verify, and read the state at a time. Every number
 * it returns was produced by an engine or by the Question Runtime; this class
 * only routes, normalizes and formats. It has no idea which agent harness is
 * calling it — that binding lives one package up.
 */

import type {
  DerivedQuantity,
  PhysicsEventLike,
  SimulationResult,
  SimulationState,
  VerificationResult,
} from '@physicsos/physics-core'
import {
  SceneRuntime,
  createSceneCommand,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { asQuestionId } from '@physicsos/shared'
import {
  createGoldenQuestionDocument,
  GOLDEN_QUESTIONS,
  processQuestion,
  type QuestionDocument,
  type QuestionRuntimeResult,
} from '@physicsos/question-core'

import { domainOfEngine, pickEngine, simulateScene, type EngineEntry } from './engines.ts'
import { EXPERIMENT_CATALOG, findExperiment } from './experiment-catalog.ts'
import {
  COMMAND_SPECS,
  CommandPayloadError,
  normalizeCommandPayload,
} from './scene-commands.ts'

/* --------------------------------------------------------------- results -- */

/** A scalar the model may quote. `value` is null when the engine published a non-finite number. */
export interface ToolScalar {
  readonly key: string
  readonly value: number | null
  readonly unit: string
  readonly formula?: string
  readonly targetId?: string
}

export interface ToolCheck {
  readonly id: string
  readonly passed: boolean
  readonly message?: string
}

export interface ToolVerification {
  readonly status: VerificationResult['status']
  readonly checks: readonly ToolCheck[]
  readonly errors: readonly string[]
}

export interface SceneObjectSummary {
  readonly id: string
  readonly kind: string
  readonly name?: string
}

export interface SceneObservableSummary {
  readonly id: string
  readonly type: string
  readonly visible: boolean
}

export interface SceneDescription {
  readonly sceneId: string
  readonly revision: number
  readonly title: string
  readonly description?: string
  readonly domain: string
  readonly engineId: string
  readonly sourceQuestionId?: string
  readonly timeline: { readonly start: number; readonly end: number | null }
  readonly objects: readonly SceneObjectSummary[]
  readonly observables: readonly SceneObservableSummary[]
  /** SceneCommand types whose declared domain covers this scene's engine domain. */
  readonly commands: readonly string[]
}

export interface ExperimentListing {
  readonly id: string
  readonly domain: string
  readonly stage: string
  readonly title: string
  readonly description: string
}

export interface QuestionKnown {
  readonly key: string
  readonly label: string
  readonly symbol: string
  /** Null when the parser produced a non-finite number; `-0` canonicalizes to `0`. */
  readonly value: number | null
  readonly unit: string
}

export interface QuestionAnswer {
  readonly key: string
  readonly label: string
  readonly symbol: string
  readonly value: string
  readonly unit: string
}

export interface QuestionStep {
  readonly index: number
  readonly title: string
  readonly description: string
  /** Exam-format substitution row: the formula with knowns plugged in. */
  readonly substitution?: string
  readonly result?: string
}

export interface QuestionIssue {
  readonly code: string
  readonly message: string
  readonly severity: string
}

export interface SolveQuestionResult {
  readonly status: 'solved' | 'rejected'
  readonly workflowState: string
  readonly domain?: string
  readonly model?: string
  readonly knowns: readonly QuestionKnown[]
  readonly targets: readonly string[]
  readonly answers: readonly QuestionAnswer[]
  readonly steps: readonly QuestionStep[]
  readonly verification?: ToolVerification
  readonly issues: readonly QuestionIssue[]
  /** Present when the question built a runnable scene; it is registered for follow-up tools. */
  readonly scene?: SceneDescription
  /** Set when the text matched a built-in golden question. */
  readonly goldenQuestionId?: string
  /** True when the same normalized text was already solved and the existing scene is reused. */
  readonly reusedScene?: boolean
}

export interface CommandResult {
  readonly ok: boolean
  readonly sceneId: string
  readonly revision: number
  readonly error?: { readonly code: string; readonly message: string }
  readonly eventType?: string
}

export interface SimulateResult {
  readonly sceneId: string
  readonly revision: number
  readonly engineId: string
  readonly domain: string
  readonly verification: ToolVerification
  readonly derived: readonly ToolScalar[]
  readonly events: readonly { readonly kind: string; readonly time: number | null; readonly targetId?: string }[]
  readonly sampleCount: number
  readonly startTime: number | null
  readonly endTime: number | null
}

export interface ObservedObject {
  readonly id: string
  /** Non-finite components become null; `-0` canonicalizes to `0` for the lossless-JSON boundary. */
  readonly position?: { readonly x: number | null; readonly y: number | null; readonly z: number | null; readonly unit: string }
  readonly velocity?: { readonly x: number | null; readonly y: number | null; readonly z: number | null; readonly unit: string }
  readonly values: readonly ToolScalar[]
}

export interface ObserveResult {
  readonly sceneId: string
  readonly revision: number
  readonly time: number
  readonly objects: readonly ObservedObject[]
  readonly derived: readonly ToolScalar[]
}

/* ---------------------------------------------------------------- errors -- */

export class ToolRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ToolRuntimeError'
  }
}

/* --------------------------------------------------------------- helpers -- */

/**
 * Canonicalize an engine number for the tool-result boundary: non-finite
 * values become null, and `-0` becomes `0` because the Harness tool registry
 * only accepts lossless JSON (JSON cannot distinguish `-0` from `0`).
 */
const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value + 0 : null)

const scalarsOf = (derived: readonly DerivedQuantity[]): ToolScalar[] =>
  derived.flatMap((entry) => {
    if ('vector' in entry.value) return []
    return [{
      key: entry.key,
      value: finiteOrNull(entry.value.value),
      unit: entry.value.unit,
      ...(entry.formula?.expression === undefined ? {} : { formula: entry.formula.expression }),
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
    }]
  })

const verificationOf = (verification: VerificationResult): ToolVerification => ({
  status: verification.status,
  checks: verification.checks.map((check) => ({
    id: check.id,
    passed: check.passed,
    ...(check.message === undefined ? {} : { message: check.message }),
  })),
  errors: verification.errors.map((issue) => `${issue.code}: ${issue.message}`),
})

const objectsOf = (scene: PhysicsScene): SceneObjectSummary[] => {
  const objects: SceneObjectSummary[] = []
  const add = (id: string, kind: string, name?: string): void => {
    objects.push({ id, kind, ...(name === undefined ? {} : { name }) })
  }
  for (const body of scene.bodies) add(body.id, 'body', body.name)
  for (const particle of scene.particles) add(particle.id, 'particle', particle.name)
  for (const field of scene.fields) add(field.id, field.type, field.name)
  for (const force of scene.forces) add(force.id, `force:${force.type}`, force.name)
  for (const region of scene.regions) add(region.id, 'region', region.name)
  for (const circuit of scene.circuits) {
    add(circuit.id, 'circuit', circuit.name)
    for (const component of circuit.components) add(component.id, `circuit:${component.type}`, component.name)
  }
  for (const bench of scene.opticalBenches ?? []) {
    add(bench.id, 'optical_bench', bench.name)
    add(bench.object.id, 'optical_object', bench.object.name)
    for (const element of bench.elements) add(element.id, `optical:${element.type}`, element.name)
    if (bench.screen !== undefined) add(bench.screen.id, 'optical_screen', bench.screen.name)
  }
  for (const bench of scene.acousticBenches ?? []) {
    add(bench.id, 'acoustic_bench', bench.name)
    add(bench.source.id, 'acoustic_source', bench.source.name)
    add(bench.reflector.id, 'acoustic_reflector', bench.reflector.name)
  }
  for (const tank of scene.fluidTanks ?? []) {
    add(tank.id, 'fluid_tank', tank.name)
    add(tank.block.id, 'submerged_block', tank.block.name)
    add(tank.liquid.id, 'tank_liquid', tank.liquid.name)
  }
  for (const bench of scene.thermalBenches ?? []) {
    add(bench.id, 'thermal_bench', bench.name)
    add(bench.sample.id, 'thermal_sample', bench.sample.name)
    if (bench.comparisonSample !== undefined) add(bench.comparisonSample.id, 'thermal_sample', bench.comparisonSample.name)
  }
  for (const bench of scene.leverBenches ?? []) {
    add(bench.id, 'lever_bench', bench.name)
    for (const hanger of bench.hangers) add(hanger.id, `lever_hanger:${hanger.side}`, hanger.name)
  }
  for (const bench of scene.inductionBenches ?? []) add(bench.id, `induction_bench:${bench.type}`, bench.name)
  for (const bench of scene.waveBenches ?? []) add(bench.id, `wave_bench:${bench.type}`, bench.name)
  for (const bench of scene.pressureBenches ?? []) add(bench.id, `pressure_bench:${bench.type}`, bench.name)
  return objects
}

/**
 * Commands whose declared domain mentions the engine's domain. `SetObservableEnabled`
 * applies everywhere; the lever engine reports `mechanics`, so its hanger
 * commands surface with the mechanics ones.
 */
const commandsForDomain = (domain: string): string[] =>
  (Object.keys(COMMAND_SPECS) as SceneCommandType[]).filter((type) => {
    const spec = COMMAND_SPECS[type]
    return spec.domain === '所有领域' || spec.domain.includes(domain)
  })

/* --------------------------------------------------------------- runtime -- */

interface LiveScene {
  readonly runtime: SceneRuntime
  readonly engine: EngineEntry
}

/**
 * The runtime is per process by default; a harness can create one per session
 * if scenes must not leak between students. Scene ids are the ones the model
 * receives back from `solveQuestion` / `createExperiment`.
 */
export interface PhysicsToolRuntimeOptions {
  /** Upper bound on live scenes; the oldest is dropped when a new one would exceed it. */
  readonly maxScenes?: number
}

export const DEFAULT_MAX_SCENES = 64

export class PhysicsToolRuntime {
  private readonly scenes = new Map<string, LiveScene>()
  private readonly solvedQuestions = new Map<string, SolveQuestionResult>()
  private readonly maxScenes: number
  private serial = 0

  constructor(options: PhysicsToolRuntimeOptions = {}) {
    const limit = options.maxScenes ?? DEFAULT_MAX_SCENES
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ToolRuntimeError('INVALID_OPTIONS', 'maxScenes 必须是正整数。')
    }
    this.maxScenes = limit
  }

  private nextId(prefix: string): string {
    this.serial += 1
    return `${prefix}-${Date.now().toString(36)}-${this.serial.toString(36)}`
  }

  /** Register a scene under its own id, binding it to the engine that accepts it. */
  private register(scene: PhysicsScene): LiveScene {
    const picked = pickEngine(scene)
    if (picked.entry === undefined) {
      throw new ToolRuntimeError(
        'NO_ENGINE_FOR_SCENE',
        `没有引擎能处理这个场景：${picked.reasons.join('；')}`,
      )
    }
    const live: LiveScene = { runtime: new SceneRuntime(scene), engine: picked.entry }
    const sceneId = String(scene.id)
    this.scenes.delete(sceneId)
    while (this.scenes.size >= this.maxScenes) {
      const oldest = this.scenes.keys().next().value
      if (oldest === undefined) break
      this.scenes.delete(oldest)
    }
    this.scenes.set(sceneId, live)
    return live
  }

  private live(sceneId: string): LiveScene {
    const live = this.scenes.get(sceneId)
    if (live === undefined) {
      throw new ToolRuntimeError(
        'SCENE_NOT_FOUND',
        `场景 ${sceneId} 不存在；先用 physics_create_experiment 或 physics_solve_question 得到一个 sceneId。`,
      )
    }
    return live
  }

  /** Every scene currently held, newest last. */
  listScenes(): readonly SceneDescription[] {
    return [...this.scenes.keys()].map((sceneId) => this.describeScene(sceneId))
  }

  listExperiments(): readonly ExperimentListing[] {
    return EXPERIMENT_CATALOG.map((entry) => ({
      id: entry.id,
      domain: entry.domain,
      stage: entry.stage,
      title: entry.title,
      description: entry.description,
    }))
  }

  /** Open a catalogued experiment as a fresh scene. */
  createExperiment(templateId: string, title?: string): SceneDescription {
    const entry = findExperiment(templateId)
    if (entry === undefined) {
      throw new ToolRuntimeError(
        'UNKNOWN_EXPERIMENT',
        `没有 id 为 ${templateId} 的实验；用 physics_list_experiments 查看可用实验。`,
      )
    }
    const scene = entry.build(this.nextId(`agent-${entry.id}`), title ?? entry.title)
    const live = this.register(scene)
    return this.describe(String(scene.id), live)
  }

  /**
   * Run a question text through the Question Runtime. A READY result also
   * registers the built scene so the agent can keep exploring it with commands.
   *
   * `questionId` is the practice hand-off: when it resolves to a golden bank
   * entry the canonical stem replaces the passed text, so a paraphrased stem
   * still links the attempt back to the bank (self-checks, learning record).
   */
  solveQuestion(text: string, questionId?: string): SolveQuestionResult {
    const byId = questionId === undefined
      ? undefined
      : GOLDEN_QUESTIONS.find((candidate) => candidate.id === questionId)
    const trimmed = (byId?.text ?? text).trim()
    if (trimmed.length === 0) {
      throw new ToolRuntimeError('EMPTY_QUESTION', '题面为空。')
    }
    /* 同一题面重复求解复用已注册场景，避免重试时向学生重复刷"新建实验"。
       场景被容量上限淘汰后照常重新求解。 */
    const dedupeKey = trimmed.replace(/\s+/g, ' ')
    const cached = this.solvedQuestions.get(dedupeKey)
    if (
      cached !== undefined &&
      cached.status === 'solved' &&
      cached.scene !== undefined &&
      this.scenes.has(cached.scene.sceneId)
    ) {
      return { ...cached, reusedScene: true }
    }
    const golden = byId ?? GOLDEN_QUESTIONS.find((candidate) => candidate.text.trim() === trimmed)
    const document: QuestionDocument =
      golden !== undefined
        ? createGoldenQuestionDocument(golden)
        : {
            id: asQuestionId(this.nextId('agent-question')),
            content: { source: 'text', rawText: trimmed, extractedText: trimmed, status: 'EXTRACTED' },
            metadata: { title: trimmed.slice(0, 40), tags: ['agent'], difficulty: 'standard' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as unknown as QuestionDocument
    const result = processQuestion(document)
    const solved = this.solveResultOf(result, String(document.id), golden?.id)
    if (solved.status === 'solved') this.solvedQuestions.set(dedupeKey, solved)
    return solved
  }

  private solveResultOf(
    result: QuestionRuntimeResult,
    questionId: string,
    goldenQuestionId?: string,
  ): SolveQuestionResult {
    const ir = result.ir
    const knowns: QuestionKnown[] = (ir?.knowns ?? []).map((known) => ({
      key: known.key,
      label: known.label,
      symbol: known.symbol,
      value: finiteOrNull(known.value),
      unit: known.unit,
    }))
    const issues: QuestionIssue[] = [
      ...(result.validation?.issues ?? []).map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
      // An ambiguity is a question back to the student, not a defect in the text.
      ...(result.validation?.ambiguities ?? []).map((ambiguity) => ({
        code: `AMBIGUOUS_${ambiguity.field}`,
        message: `${ambiguity.message}（可选：${ambiguity.options.join(' / ')}）`,
        severity: 'ambiguity',
      })),
    ]
    if (result.workflowState !== 'READY' || result.scene === null || result.simulation === null || result.solution === null) {
      const fallback =
        issues.length === 0 && result.error !== undefined
          ? [{ code: result.workflowState, message: result.error, severity: 'error' }]
          : issues
      return {
        status: 'rejected',
        workflowState: result.workflowState,
        ...(ir === null ? {} : { domain: ir.domain, model: ir.model }),
        knowns,
        targets: ir?.targets ?? [],
        answers: [],
        steps: [],
        issues: fallback,
        ...(goldenQuestionId === undefined ? {} : { goldenQuestionId }),
      }
    }

    // Older scene builders do not stamp the question on the scene; the tool
    // knows which document it just processed, so the link never goes missing.
    const scene: PhysicsScene =
      result.scene.metadata.sourceQuestionId === undefined
        ? { ...result.scene, metadata: { ...result.scene.metadata, sourceQuestionId: asQuestionId(questionId) } }
        : result.scene
    const live = this.register(scene)
    const answers: QuestionAnswer[] = Object.entries(result.solution.results).map(([key, answer]) => ({
      key,
      label: answer.label,
      symbol: answer.symbol,
      value: answer.value,
      unit: answer.unit,
    }))
    const steps: QuestionStep[] = result.solution.steps.map((step) => ({
      index: step.index,
      title: step.title,
      description: step.description,
      ...(step.substitution === undefined ? {} : { substitution: step.substitution }),
      ...(step.resultValue === undefined
        ? {}
        : { result: `${step.resultSymbol ?? ''} = ${step.resultValue} ${step.resultUnit ?? ''}`.trim() }),
    }))
    return {
      status: 'solved',
      workflowState: result.workflowState,
      ...(ir?.domain === undefined ? {} : { domain: ir.domain }),
      ...(ir?.model === undefined ? {} : { model: ir.model }),
      knowns,
      targets: ir?.targets ?? [],
      answers,
      steps,
      verification: verificationOf(result.simulation.verification),
      issues,
      scene: this.describe(String(scene.id), live),
      ...(goldenQuestionId === undefined ? {} : { goldenQuestionId }),
    }
  }

  describeScene(sceneId: string): SceneDescription {
    return this.describe(sceneId, this.live(sceneId))
  }

  /**
   * Deep copy of a live scene at its current revision. For consumers that
   * mirror the scene elsewhere (a harness binding pushing it to the Lab canvas);
   * the copy cannot bypass the SceneRuntime's command gate.
   */
  sceneSnapshot(sceneId: string): PhysicsScene {
    return this.live(sceneId).runtime.getScene()
  }

  private describe(sceneId: string, live: LiveScene): SceneDescription {
    const scene = live.runtime.getScene()
    const domain = domainOfEngine(live.engine.engine)
    return {
      sceneId,
      revision: scene.revision,
      title: scene.metadata.title ?? sceneId,
      ...(scene.metadata.description === undefined ? {} : { description: scene.metadata.description }),
      domain,
      engineId: live.engine.engine.engineId,
      ...(scene.metadata.sourceQuestionId === undefined
        ? {}
        : { sourceQuestionId: String(scene.metadata.sourceQuestionId) }),
      timeline: {
        start: scene.timeline.startTime === undefined ? 0 : (finiteOrNull(scene.timeline.startTime.value) ?? 0),
        end: scene.timeline.endTime === undefined ? null : finiteOrNull(scene.timeline.endTime.value),
      },
      objects: objectsOf(scene),
      observables: scene.observableDefinitions.map((definition) => ({
        id: String(definition.id),
        type: definition.type,
        visible: definition.visible,
      })),
      commands: commandsForDomain(domain),
    }
  }

  /**
   * Apply one SceneCommand. The payload is completed from the command table and
   * validated by the SceneRuntime; a refusal comes back as `ok: false` with the
   * domain error, never as a thrown exception, because a refused edit is a
   * legitimate physics answer ("B must stay > 0"), not an infrastructure fault.
   */
  applyCommand(sceneId: string, type: string, payload: unknown): CommandResult {
    const live = this.live(sceneId)
    if (!(type in COMMAND_SPECS)) {
      return {
        ok: false,
        sceneId,
        revision: live.runtime.getScene().revision,
        error: { code: 'UNKNOWN_COMMAND', message: `未知的命令类型 ${type}。` },
      }
    }
    const commandType = type as SceneCommandType
    let normalized: Record<string, unknown>
    try {
      normalized = normalizeCommandPayload(commandType, payload)
    } catch (error: unknown) {
      const code = error instanceof CommandPayloadError ? error.code : 'INVALID_PAYLOAD'
      return {
        ok: false,
        sceneId,
        revision: live.runtime.getScene().revision,
        error: { code, message: error instanceof Error ? error.message : String(error) },
      }
    }
    const scene = live.runtime.getScene()
    this.serial += 1
    const result = live.runtime.execute(
      createSceneCommand({
        commandId: `agent-cmd-${this.serial}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: commandType,
        payload: normalized as never,
        traceId: `agent-trace-${this.serial}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      return {
        ok: false,
        sceneId,
        revision: live.runtime.getScene().revision,
        error: { code: result.error.code, message: result.error.message },
      }
    }
    const events = live.runtime.getEvents()
    const latest = events.find((event) => result.eventIds.includes(event.eventId)) ?? events.at(-1)
    return {
      ok: true,
      sceneId,
      revision: result.newRevision,
      ...(latest === undefined ? {} : { eventType: latest.type }),
    }
  }

  /** Simulate and verify the scene's current revision with its engine. */
  simulate(sceneId: string): SimulateResult {
    const live = this.live(sceneId)
    const scene = live.runtime.getScene()
    const support = live.engine.engine.canHandle(scene)
    if (!support.supported) {
      throw new ToolRuntimeError(
        'ENGINE_REJECTED_SCENE',
        `引擎 ${live.engine.engine.engineId} 拒绝当前场景：${support.failedConditions.map((failure) => failure.message).join(' ')}`,
      )
    }
    this.serial += 1
    const simulated = simulateScene(scene, live.engine, `agent-sim-${this.serial}`, `agent-sim-trace-${this.serial}`)
    return this.simulateResultOf(sceneId, scene.revision, simulated.engineId, simulated.domain, simulated.simulation)
  }

  private simulateResultOf(
    sceneId: string,
    revision: number,
    engineId: string,
    domain: string,
    simulation: SimulationResult<PhysicsEventLike>,
  ): SimulateResult {
    const first = simulation.states[0]
    const last = simulation.states.at(-1)
    return {
      sceneId,
      revision,
      engineId,
      domain,
      verification: verificationOf(simulation.verification),
      derived: scalarsOf(simulation.derivedQuantities),
      events: simulation.events.map((event) => {
        const record = event as unknown as { kind?: unknown; type?: unknown; time?: unknown; targetId?: unknown }
        const kind = typeof record.kind === 'string' ? record.kind : typeof record.type === 'string' ? record.type : 'event'
        const timeValue = record.time
        const time =
          typeof timeValue === 'number'
            ? finiteOrNull(timeValue)
            : typeof timeValue === 'object' && timeValue !== null && 'value' in timeValue
              ? finiteOrNull(Number((timeValue as { value: unknown }).value))
              : null
        return {
          kind,
          time,
          ...(typeof record.targetId === 'string' ? { targetId: record.targetId } : {}),
        }
      }),
      sampleCount: simulation.states.length,
      startTime: first === undefined ? null : finiteOrNull(first.time.value),
      endTime: last === undefined ? null : finiteOrNull(last.time.value),
    }
  }

  /** The engine's state at a scene time: object positions / velocities / values plus derived scalars. */
  observe(sceneId: string, time: number): ObserveResult {
    const live = this.live(sceneId)
    if (!Number.isFinite(time) || time < 0) {
      throw new ToolRuntimeError('INVALID_TIME', '时间必须是非负有限秒数。')
    }
    const scene = live.runtime.getScene()
    const state: SimulationState = live.engine.engine.stateAt(scene, { value: time, unit: 's', dimension: 'time' })
    return {
      sceneId,
      revision: scene.revision,
      time,
      objects: state.objects.map((object) => ({
        id: object.id,
        ...(object.position === undefined
          ? {}
          : {
            position: {
              x: finiteOrNull(object.position.vector.x),
              y: finiteOrNull(object.position.vector.y),
              z: finiteOrNull(object.position.vector.z),
              unit: object.position.unit,
            },
          }),
        ...(object.velocity === undefined
          ? {}
          : {
            velocity: {
              x: finiteOrNull(object.velocity.vector.x),
              y: finiteOrNull(object.velocity.vector.y),
              z: finiteOrNull(object.velocity.vector.z),
              unit: object.velocity.unit,
            },
          }),
        values: Object.entries(object.values ?? {}).flatMap(([key, value]) =>
          'vector' in value
            ? []
            : [{ key, value: finiteOrNull(value.value), unit: value.unit }],
        ),
      })),
      derived: scalarsOf(state.derived),
    }
  }
}

export const createPhysicsToolRuntime = (options: PhysicsToolRuntimeOptions = {}): PhysicsToolRuntime =>
  new PhysicsToolRuntime(options)
