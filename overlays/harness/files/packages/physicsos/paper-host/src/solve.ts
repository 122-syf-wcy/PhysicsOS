/**
 * Independent solving — a second model call per question that sees the stem
 * but never the draft's answer, so agreement is evidence rather than echo.
 * Disagreements become `solve-mismatch` findings; model agreement is still
 * NOT correctness — the plan reserves the verdict for teacher review.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PaperQuestion, SolveResult } from '@physicsos/question-paper'
import type { PaperModelRoute } from './draft.ts'

const SOLVER_SYSTEM = `你是一名严格的高中物理/化学解题者。只看题面独立求解，给出最终结果的简洁表达（数值含单位，选择题给字母）。
只输出一行 JSON：{"answer":"…","note":"…"}。note 可空。不要复述题面，不要写过程。`

/** A hung provider stream must not park the job in 'checking' forever. */
const SOLVE_TIMEOUT_MS = 120_000

async function solveOne(
  ctx: Context,
  route: PaperModelRoute,
  question: PaperQuestion,
  signal: AbortSignal,
): Promise<string> {
  const stem = [
    question.stem,
    ...(question.options ?? []),
    ...(question.subQuestions ?? []).map(sub => `（${sub.no}）${sub.text}`),
  ].join('\n')
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: SOLVER_SYSTEM,
    messages: [createUserMessage({
      content: [{ type: 'text', text: `第${question.number}题（${question.score} 分）\n${stem}` }],
      source: { kind: 'user' },
    })],
    /* Room for the reasoning prelude plus the answer — a 4000 cap on a
       thinking model can be spent entirely on reasoning, leaving empty
       content that parses as nothing. */
    maxTokens: 8192,
    temperature: 0.2,
    signal,
  })) {
    assembler.push(chunk)
  }
  /* Adapter failures arrive as a finish chunk, not a throw — an unchecked
     error finish turns into empty text and a misleading JSON.parse error. */
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`模型流未正常结束：${JSON.stringify(finish)}`)
  }
  return assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Loose equality: same trimmed text, or one contains the other. */
const answersAgree = (a: string, b: string): boolean => {
  const strip = (s: string): string => s.replace(/\s/g, '').replace(/[。；;,.，]/g, '')
  const na = strip(a)
  const nb = strip(b)
  return na.length > 0 && nb.length > 0 && (na === nb || na.includes(nb) || nb.includes(na))
}

/**
 * Solve every question independently and compare with the draft answer.
 * @param ctx - plugin context carrying `llm`.
 * @param route - model route.
 * @param questions - the drafted questions.
 * @returns one SolveResult per question; failures report as inconsistent.
 */
export async function independentSolve(
  ctx: Context,
  route: PaperModelRoute,
  questions: readonly PaperQuestion[],
  delayMs = 0,
  timeoutMs = SOLVE_TIMEOUT_MS,
): Promise<SolveResult[]> {
  const results: SolveResult[] = []
  let first = true
  for (const question of questions) {
    /* Rate-limited relays cut connections after a few back-to-back calls —
       spacing serial solves keeps every question inside the window. */
    if (!first && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    first = false
    const draftAnswer = question.answer?.result ?? ''
    /* One retry absorbs transient endpoint flakes; the timeout race bounds
       each attempt so a dead stream cannot park the job in 'checking'. */
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const raw = await Promise.race([
          solveOne(ctx, route, question, controller.signal),
          new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error('solve-timeout')), timeoutMs)),
        ])
        const parsed = JSON.parse(raw.replace(/```(?:json)?/g, '').trim()) as { answer?: string; note?: string }
        const solved = parsed.answer ?? ''
        results.push({
          questionNo: question.number,
          draftAnswer,
          solvedAnswer: solved,
          consistent: answersAgree(draftAnswer, solved),
          note: parsed.note,
        })
        lastError = undefined
        break
      } catch (error) {
        lastError = timedOut
          ? new Error(`独立解题超时（${timeoutMs / 1000}s）`)
          : error instanceof Error ? error : new Error(String(error))
      } finally {
        clearTimeout(timeout)
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
