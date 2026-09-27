/** Test fixture: run a golden question through the real solver and shape the
    result as the PhysicsSceneCardData a `physics/scene` event would carry,
    mirroring the `publish` projection the tool layer applies to a solve. */
import {
  GOLDEN_QUESTIONS, createGoldenQuestionDocument, processQuestion,
} from '@physicsos/question-core'
import {
  PHYSICS_VERIFIER_ID, engineVerifierId, provenanceForSimulation,
} from '@physicsos/physics-verifier'
import type { QuantityProvenance } from '@physicsos/physics-core'
import type { PhysicsSceneCardData } from '../src/client/scene-chat-node.ts'

/** The verifier behind an engine — the external Physics Verifier owns the
    magnetic team's checks, every other engine verifies its own output. Mirrors
    `PhysicsToolRuntime`'s `verifierIdFor`. */
const verifierIdFor = (engineId: string): string =>
  engineId === 'engine-magnetic' ? PHYSICS_VERIFIER_ID : engineVerifierId(engineId)

export const solvedCardData = (questionId: string): PhysicsSceneCardData => {
  const golden = GOLDEN_QUESTIONS.find(entry => entry.id === questionId)
  if (golden === undefined) throw new Error(`missing golden question ${questionId}`)
  const result = processQuestion(createGoldenQuestionDocument(golden))
  const ir = result.ir
  const knowns = (ir?.knowns ?? []).map(known => ({
    key: known.key,
    label: known.label,
    symbol: known.symbol,
    value: Number.isFinite(known.value) ? known.value : null,
    unit: known.unit,
  }))
  const issues = [
    ...(result.validation?.issues ?? []).map(issue => ({
      code: issue.code, message: issue.message, severity: issue.severity,
    })),
    ...(result.validation?.ambiguities ?? []).map(ambiguity => ({
      code: `AMBIGUOUS_${ambiguity.field}`,
      message: `${ambiguity.message}（可选：${ambiguity.options.join(' / ')}）`,
      severity: 'ambiguity',
    })),
  ]
  const solution = result.solution
  const simulation = result.simulation
  /* The tool layer forwards each answer WITH the simulation's provenance, so
     the client can name the engine and verifier behind the number. */
  const provenance: QuantityProvenance | null = simulation === null
    ? null
    : provenanceForSimulation(simulation, {
      verifierId: verifierIdFor(simulation.metadata.engineId),
    })
  const answers = solution === null
    ? []
    : Object.entries(solution.results).map(([key, answer]) => ({
      key, label: answer.label, symbol: answer.symbol, value: answer.value, unit: answer.unit, provenance,
    }))
  const steps = (solution?.steps ?? []).map(step => ({
    index: step.index,
    title: step.title,
    description: step.description,
    ...(step.substitution === undefined ? {} : { substitution: step.substitution }),
    ...(step.resultValue === undefined
      ? {}
      : { result: `${step.resultSymbol ?? ''} = ${step.resultValue} ${step.resultUnit ?? ''}`.trim() }),
  }))
  const scene = result.scene
  return {
    sceneId: scene === null ? `question:${golden.id}` : String(scene.id),
    revision: scene?.revision ?? 0,
    title: golden.title,
    domain: ir?.domain ?? 'mechanics',
    cause: 'solved',
    commandType: undefined,
    solve: {
      knowns,
      targets: ir?.targets ?? [],
      answers,
      steps,
      ...(result.simulation?.verification === undefined ? {} : {
        verification: {
          status: result.simulation.verification.status,
          checks: result.simulation.verification.checks.map(check => ({
            id: check.id, passed: check.passed,
            ...(check.message === undefined ? {} : { message: check.message }),
          })),
        },
      }),
      issues,
      goldenQuestionId: golden.id,
    },
    scene: scene as never,
  }
}

/** Minimal Chat-target snapshot the card's supersede selector reads. */
export const cardSession = () => {
  const nodes = new Map()
  return (selector: (snapshot: { nodes: typeof nodes }) => unknown) =>
    selector({ nodes })
}
