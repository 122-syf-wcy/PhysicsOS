/**
 * What a `physics_solve_question` call leaves on the session log: the solve
 * summary that rides the scene mirror (READY solves only) and the attempt
 * trace every call appends, solved or rejected. Pure projections of the
 * runtime's result; nothing here computes physics.
 * @module @deepseek-ai/dsh-tool-physicsos/solve-publication
 */

import { isDeepStrictEqual } from 'node:util'
import type { SolveQuestionResult } from '@physicsos/agent-tools'
import type { PhysicsSceneSnapshot, PhysicsSceneSolveSummary, PhysicsSolveTrace } from './types.ts'

/**
 * The solve summary published with a READY scene. Each answer carries the
 * simulation's provenance — engine id/version, scene revision, verifier and
 * checks — so the client names the engine behind the number instead of the
 * scene domain. An answer with no engine behind it forwards the honest null.
 * @param solved - the runtime's result.
 * @returns the summary for the scene snapshot.
 */
export const solveSummaryOf = (solved: SolveQuestionResult): PhysicsSceneSolveSummary => ({
  knowns: solved.knowns,
  targets: solved.targets,
  answers: solved.answers.map(answer => ({
    key: answer.key,
    label: answer.label,
    symbol: answer.symbol,
    value: answer.value,
    unit: answer.unit,
    provenance: answer.provenance,
  })),
  steps: solved.steps,
  ...(solved.verification === undefined ? {} : {
    verification: {
      status: solved.verification.status,
      checks: solved.verification.checks,
    },
  }),
  issues: solved.issues,
  ...(solved.goldenQuestionId === undefined ? {} : { goldenQuestionId: solved.goldenQuestionId }),
})

/**
 * The bounded attempt trace. Without it a rejected attempt (parse failure,
 * verification failure) would vanish from the session log the moment the
 * model re-asks, because the scene mirror only carries READY solves.
 * @param solved - the runtime's result.
 * @param turn - the open turn, when known.
 * @param durationMs - wall time the runtime took.
 * @returns the trace to append.
 */
export const solveTraceOf = (
  solved: SolveQuestionResult,
  turn: number | undefined,
  durationMs: number,
): PhysicsSolveTrace => {
  const failedChecks = (solved.verification?.checks ?? [])
    .filter(check => !check.passed)
    .map(check => ({ id: check.id, ...(check.message === undefined ? {} : { message: check.message }) }))
  const verificationSummary = solved.verification === undefined ? undefined : {
    status: solved.verification.status,
    passed: solved.verification.checks.length - failedChecks.length,
    total: solved.verification.checks.length,
    failed: failedChecks,
  }
  return {
    ...(turn === undefined ? {} : { turn }),
    status: solved.status,
    workflowState: solved.workflowState,
    ...(solved.domain === undefined ? {} : { domain: solved.domain }),
    ...(solved.model === undefined ? {} : { model: solved.model }),
    ...(solved.goldenQuestionId === undefined ? {} : { goldenQuestionId: solved.goldenQuestionId }),
    ...(solved.attempt === undefined ? {} : { attempt: solved.attempt }),
    ...(solved.scene === undefined ? {} : { sceneId: solved.scene.sceneId }),
    ...(solved.reusedScene === true ? { reusedScene: true } : {}),
    ...(verificationSummary === undefined ? {} : { verification: verificationSummary }),
    answers: solved.answers.map(answer => ({ key: answer.key, value: answer.value, unit: answer.unit })),
    issues: solved.issues.map(issue => ({ code: issue.code, severity: issue.severity })),
    retryGuidance: (solved.retryGuidance ?? []).map(hint => ({ code: hint.code })),
    durationMs,
  }
}

/**
 * Whether a cached engine result for this turn may skip publishing: the
 * previous snapshot is this turn's, same scene revision, already carries a
 * visualization owned by this session, and every serialized scene fact is
 * identical. Publishing again would clear this turn's completed or failed
 * code job for no new information.
 * @param previous - the session's snapshot for the scene, if any.
 * @param solvedScene - the scene the runtime just returned.
 * @param currentScene - the runtime's live scene for that id.
 * @param turn - the open turn.
 * @param ownerSessionId - the calling agent's session id.
 * @returns true when the existing snapshot already says everything.
 */
export const sameTurnVisualization = (
  previous: PhysicsSceneSnapshot | undefined,
  solvedScene: { sceneId: string; revision: number },
  currentScene: unknown,
  turn: number | undefined,
  ownerSessionId: string,
): boolean =>
  previous !== undefined
  && previous.turn === turn && previous.sceneId === solvedScene.sceneId
  && previous.revision === solvedScene.revision
  && previous.visualization?.ownerSessionId === ownerSessionId
  && previous.visualization.sceneId === solvedScene.sceneId
  && previous.visualization.sceneRevision === solvedScene.revision
  && isDeepStrictEqual(
    JSON.parse(JSON.stringify(previous.scene)) as unknown,
    JSON.parse(JSON.stringify(currentScene)) as unknown,
  )
