/**
 * Engine-derived solving — a second, independent determination per question
 * that runs through our own physics runtime instead of a second model call.
 *
 * The model may propose: the drafted `answer` is a model proposal. The engine
 * decides: `solveQuestion` parses the stem, selects an engine, simulates and
 * verifies it, and the number it returns is what the paper carries. A model
 * answer that contradicts the engine is flagged, never accepted; agreement is
 * still evidence rather than permission — the verdict stays with teacher
 * review. When the engine cannot cover a question the outcome is an explicit
 * refusal (`UNSUPPORTED_MODEL` and friends), never a fabricated number and
 * never a silent pass.
 */

import type { CheckFinding, PaperDocument, PaperQuestion, SolveResult } from '@physicsos/question-paper'
import {
  createPhysicsToolRuntime,
  type PhysicsToolRuntime,
  type SolveQuestionResult,
} from '@physicsos/agent-tools'

/** A hung solve must not park the job in 'checking' forever. */
const SOLVE_TIMEOUT_MS = 120_000

/* One process-wide runtime: the engines are stateless and the runtime bounds
   its own live-scene cache, so a paper of questions never grows unbounded. */
const sharedRuntime = createPhysicsToolRuntime()

/** The stem text the engine parses: stem, options, then sub-question text. */
const stemTextOf = (question: PaperQuestion): string => [
  question.stem,
  ...(question.options ?? []),
  ...(question.subQuestions ?? []).map(sub => `（${sub.no}）${sub.text}`),
].join('\n')

/** The engine's answers as the one line a paper prints. */
const engineAnswerText = (result: SolveQuestionResult): string =>
  result.answers
    .map(a => `${a.label}${a.symbol === '' ? '' : ` ${a.symbol}`} = ${a.value}${a.unit === '' ? '' : ` ${a.unit}`}`)
    .join('；')

/**
 * One engine attempt's conclusion. `solvedAnswer` is non-empty only when the
 * engine produced an answer its own verifier passed — an unverified or refused
 * attempt carries no number, so nothing can silently print.
 */
interface EngineOutcome {
  readonly solvedAnswer: string
  readonly note: string
}

/** Run one question through the engine. A refusal is a result; a fault a throw. */
function engineSolveOne(runtime: PhysicsToolRuntime, question: PaperQuestion): EngineOutcome {
  const result = runtime.solveQuestion(stemTextOf(question))
  const reasons = result.issues.map(issue => `${issue.code}: ${issue.message}`).join('；')
  if (result.status !== 'solved') {
    return {
      solvedAnswer: '',
      note: `引擎无法判定（${result.workflowState}）${reasons === '' ? '' : `：${reasons}`}`,
    }
  }
  const answer = engineAnswerText(result)
  if (answer === '') {
    return { solvedAnswer: '', note: '引擎判定为已解但未产出任何答案值' }
  }
  const verification = result.verification
  if (verification === undefined || verification.status !== 'passed') {
    /* The number is real but unverified — record it as the reason, never as an answer. */
    const detail = verification === undefined
      ? '引擎未返回校验结果'
      : `${verification.status}：${verification.errors.join('；') || '无错误明细'}`
    return { solvedAnswer: '', note: `引擎校验未通过（${detail}）；引擎答案 ${answer} 未经确认` }
  }
  return { solvedAnswer: answer, note: '' }
}

/** Race the (synchronous) engine attempt against the per-attempt deadline. */
async function solveWithDeadline(
  runtime: PhysicsToolRuntime,
  question: PaperQuestion,
  timeoutMs: number,
  elapsed: { timedOut: boolean },
): Promise<EngineOutcome> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { elapsed.timedOut = true; reject(new Error('solve-timeout')) }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => engineSolveOne(runtime, question)), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Loose equality: same trimmed text, or one contains the other. */
/**
 * Whether the draft and the engine agree.
 *
 * Substring containment is not comparison: "2" is a substring of "20", of
 * "2.00 m/s", and of every quantity that merely starts with the same digit, so
 * a draft answering 2 m/s "agreed" with an engine answering 20 m. Compare the
 * numbers instead — each value the engine reports must appear in the draft
 * within a relative tolerance, and the draft must not carry a different set.
 * @param a - the draft answer, as the model wrote it.
 * @param b - the engine's rendered answer.
 * @returns true when every engine magnitude is present in the draft.
 */
const answersAgree = (a: string, b: string): boolean => {
  const numbersOf = (s: string): number[] =>
    (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite)
  const draft = numbersOf(a)
  const engine = numbersOf(b)
  if (draft.length === 0 || engine.length === 0) return false
  /* Tolerance: the engine prints 2.00 where a draft may write 2 or 2.0. The
     band is relative so it works for a 0.078 m radius and a 7656 m/s speed
     alike; 2% is far wider than either prints and far narrower than a wrong
     answer's distance. */
  return engine.every(value => draft.some(candidate => {
    const scale = Math.max(Math.abs(value), Math.abs(candidate), 1)
    return Math.abs(candidate - value) / scale <= 0.02
  }))
}

/* Numbers the engine reports, as written. Two decimals and scientific notation
   both appear in its output; the comparison only needs the magnitudes. */
const engineNumbers = (answer: string): number[] =>
  (answer.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter(value => Number.isFinite(value) && value !== 0)

/**
 * Whether the engine's answer can be compared with this question at all.
 *
 * A choice question's answer is a letter while the engine reports physical
 * quantities, so `answersAgree` can never match them — measured over a full
 * paper, every engine verdict on a choice question disagreed with the draft,
 * and an eighth-grade kinematics solve returned 200 m where the options were
 * 20/40/80/160. Deciding whether the engine solved the question that was asked
 * needs the options: an answer is comparable only when at least one of its
 * magnitudes appears among them. Anything else is the engine solving a
 * different question, and reporting that as a model error blames the draft for
 * the engine's mistake.
 * @param question - the drafted question, for its options.
 * @param solvedAnswer - the engine's rendered answer.
 * @returns true when comparing the two answers is meaningful.
 */
export const engineAnswerComparable = (question: PaperQuestion, solvedAnswer: string): boolean => {
  if (solvedAnswer === '') return false
  const options = question.options ?? []
  /* A calculation question has no options to cross-check against; its stem is
     the only description of what was asked, so the answer is taken at face
     value and compared as text. */
  if (options.length === 0) return true
  const optionText = options.join(' ').replace(/[{}$\\]/g, '')
  return engineNumbers(solvedAnswer).some(value =>
    optionText.includes(String(value))
    /* Rounding: the engine prints 2.00 where an option says 2.0. */
    || optionText.includes(value.toFixed(1))
    || optionText.includes(value.toFixed(0)))
}

/**
 * Solve every question with the engine and compare its verdict with the draft
 * answer. Serial by construction (the runtime holds shared scene state), one
 * retry absorbs a transient fault, and the timeout race bounds each attempt.
 * @param questions - the drafted questions; `answer.result` is the model's proposal.
 * @param delayMs - spacing between serial solves; retained for the serial contract.
 * @param timeoutMs - per-attempt deadline; default `SOLVE_TIMEOUT_MS`.
 * @param runtime - the physics runtime; defaults to the shared process runtime.
 * @param onProgress - optional per-question telemetry hook (done count, total,
 *   the question number about to be solved); fires before each solve.
 * @returns one SolveResult per question; refusals and failures report as inconsistent.
 */
export async function independentSolve(
  questions: readonly PaperQuestion[],
  delayMs = 0,
  timeoutMs = SOLVE_TIMEOUT_MS,
  runtime: PhysicsToolRuntime = sharedRuntime,
  onProgress?: (done: number, total: number, questionNo: number) => void,
): Promise<SolveResult[]> {
  const results: SolveResult[] = []
  let first = true
  for (const [index, question] of questions.entries()) {
    if (!first && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    first = false
    onProgress?.(index, questions.length, question.number)
    const draftAnswer = question.answer?.result ?? ''
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      /* A holder object, not a `let`: assigning it inside a promise executor
         still defeats control-flow narrowing on a plain boolean. */
      const elapsed = { timedOut: false }
      try {
        const outcome = await solveWithDeadline(runtime, question, timeoutMs, elapsed)
        /* An engine answer that cannot be matched to the question's options is
           not evidence about the draft — the engine solved something else.
           Recording it as a disagreement made every choice question fail its
           check, so `comparable` travels with the result and the finding layer
           decides what to report. */
        const comparable = engineAnswerComparable(question, outcome.solvedAnswer)
        results.push({
          questionNo: question.number,
          draftAnswer,
          solvedAnswer: outcome.solvedAnswer,
          consistent: comparable && answersAgree(draftAnswer, outcome.solvedAnswer),
          comparable,
          note: outcome.note === '' ? undefined : outcome.note,
        })
        lastError = undefined
        break
      } catch (error) {
        lastError = elapsed.timedOut
          ? new Error(`独立解题超时（${timeoutMs / 1000}s）`)
          : error instanceof Error ? error : new Error(String(error))
      }
    }
    if (lastError !== undefined) {
      results.push({
        questionNo: question.number,
        draftAnswer,
        solvedAnswer: '',
        consistent: false,
        note: `独立解题失败：${lastError.message}`,
      })
    }
  }
  return results
}

/**
 * Stamp the engine's answer onto every question whose engine verdict was
 * verified: the value the paper prints is the engine's, not the model's
 * proposal. Refused or unverified questions are left untouched — their draft
 * answer stands but is flagged by {@link engineRefusalFindings}, so a
 * never-verified draft can never reach approval unnoticed.
 * @param document - the committed document.
 * @param solve - the engine solve report.
 * @returns the corrected document, or `undefined` when the engine changed nothing.
 */
/**
 * Stamp the engine's answer onto the questions it can actually answer.
 *
 * A choice question's answer is a letter set; the engine reports physical
 * quantities. Writing "速度 v = 2.00 m/s" over "B" produced an answer that no
 * longer names an option, which the paper's own answer-format check then
 * rejected — the engine's disagreement became a malformed paper. The rewrite is
 * therefore limited to questions whose answer the engine could be compared
 * against at all (`comparable`); everything else keeps the draft and carries
 * its finding instead of being overwritten.
 * @param document - the committed document.
 * @param solve - the engine solve report.
 * @returns the corrected document, or `undefined` when the engine changed nothing.
 */
export function applyEngineAnswers(
  document: PaperDocument,
  solve: readonly SolveResult[],
): PaperDocument | undefined {
  const byNo = new Map(solve.map(result => [result.questionNo, result]))
  /* A holder object, not a `let`: the flag is set inside a callback, which
     control-flow analysis cannot see, so a plain boolean would read as dead. */
  const state = { changed: false }
  const sections = document.sections.map(section => ({
    ...section,
    items: section.items.map((question) => {
      const result = byNo.get(question.number)
      const answer = question.answer
      if (result === undefined || result.solvedAnswer === '' || answer === undefined) return question
      /* Choice answers are letters, not quantities: the engine cannot supply
         one without an option-by-option comparison, which this pipeline does
         not perform. Keep the draft answer and let the finding describe the
         disagreement. */
      if (question.kind === 'choice-single' || question.kind === 'choice-multi') return question
      /* `comparable === false` means the engine's quantities were never matched
         to what the question asked; its number is not an answer to this stem. */
      if (result.comparable === false) return question
      if (answer.result === result.solvedAnswer) return question
      state.changed = true
      return { ...question, answer: { ...answer, result: result.solvedAnswer } }
    }),
  }))
  return state.changed ? { ...document, sections } : undefined
}

/**
 * Findings for questions the engine could not decide — a refusal
 * (`UNSUPPORTED_MODEL`, unparseable stem) or an answer its own verifier did
 * not pass. `engine-mismatch` at error severity makes the gap explicit and
 * adjudicable, so an unsupported question surfaces as a refusal rather than a
 * number or a silent pass.
 *
 * Severity follows the question's kind, not the refusal: a CONCEPT choice
 * question is outside the engine's scope by design (the honesty contract —
 * it must refuse rather than improvise), so its refusal is a warning the
 * reviewer reads, never a blocker; a CALCULATION refusal means a question that
 * SHOULD be re-solvable wasn't (missing knowns, unparseable stem) and stays an
 * error.
 *
 * `experiment` belongs with the concept kinds. Its data lives in a markdown
 * table and its answer is a conclusion drawn from that table — a 伏安法 stem
 * that lists six 电流/电压 pairs and the apparatus has every known it needs,
 * yet the engine reads it as a circuit with no source and no resistance and
 * refuses. Treating that refusal as an error blocked every paper containing
 * one experiment question.
 * @param solve - the engine solve report.
 * @param kindByNo - question number → kind, from the document being checked.
 * @returns one finding per undecided question.
 */
export function engineRefusalFindings(
  solve: readonly SolveResult[],
  kindByNo: ReadonlyMap<number, string>,
): CheckFinding[] {
  return solve
    .filter(result => result.solvedAnswer === '')
    .map((result) => {
      const kind = kindByNo.get(result.questionNo)
      const note = result.note ?? ''
      /* An unrecognised stem or a table-driven experiment question is outside
         what the parser models — the engine refusing says nothing about the
         draft. A missing known is different: it means the question as written
         cannot be solved by anything, which is a defect the author must fix. */
      const outOfScope = kind === 'choice-single' || kind === 'choice-multi'
        || kind === 'short-answer' || kind === 'drawing' || kind === 'experiment'
        || /UNSUPPORTED_MODEL|PARSE_FAILED/.test(note)
      return {
        questionNo: result.questionNo,
        severity: outOfScope ? 'warning' as const : 'error' as const,
        code: 'engine-mismatch' as const,
        detail: outOfScope
          ? `本题不在引擎可复核的题型内，需人工审阅。${note}`
          : `题干缺少可解所需的条件：${note}`,
      }
    })
}
