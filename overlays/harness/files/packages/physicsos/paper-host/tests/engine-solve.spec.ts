/**
 * Engine-derived answer path. These tests pin the property that makes the
 * paper pipeline ours rather than a re-skinned harness: the per-question
 * answer is decided by the PhysicsOS engine (`@physicsos/agent-tools`
 * `solveQuestion`), the model's draft answer is only a proposal, and a
 * question the engine cannot cover surfaces as an explicit refusal instead of
 * a fabricated number or a silent pass.
 */

import { describe, expect, it } from 'vitest'
import { createPhysicsToolRuntime, type PhysicsToolRuntime } from '@physicsos/agent-tools'
import { solveFindings, type PaperDocument, type PaperQuestion, type SpecRow } from '@physicsos/question-paper'
import { applyEngineAnswers, engineRefusalFindings, independentSolve } from '../src/solve.ts'

/* A free-text Lorentz-force question the engine parses, solves and verifies. */
const SUPPORTED_STEM =
  '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期'

/* A modern-physics question the question runtime explicitly refuses as
   UNSUPPORTED_MODEL rather than mis-solving with a classical engine. */
const UNSUPPORTED_STEM = '处于 n = 2 能级的氢原子向低能级跃迁，求辐射光子的能量。'

/** The engine's answer text, formatted exactly as the tool-result boundary does. */
const engineAnswerOf = (runtime: PhysicsToolRuntime, stem: string): string =>
  runtime.solveQuestion(stem).answers
    .map(a => `${a.label}${a.symbol === '' ? '' : ` ${a.symbol}`} = ${a.value}${a.unit === '' ? '' : ` ${a.unit}`}`)
    .join('；')

const question = (stem: string, draftAnswer: string): PaperQuestion => ({
  number: 1,
  subject: 'physics',
  kind: 'calculation',
  score: 8,
  stem,
  knowledge: ['带电粒子在匀强磁场中的运动'],
  ability: '应用',
  difficulty: 'medium',
  answer: { result: draftAnswer, steps: ['洛伦兹力提供向心力'], gradingPoints: [{ text: '受力分析', score: 4 }, { text: '结果', score: 4 }] },
  status: 'draft',
})

const documentOf = (draftAnswer: string): PaperDocument => ({
  id: 'paper-engine',
  title: '引擎定案回归卷',
  level: 'gaokao',
  kind: 'mock',
  header: { examName: '引擎定案回归卷', grade: '高三', subjectLine: '物理', totalScore: 8, minutes: 60, candidateFields: [] },
  sections: [{ title: '二、计算题', items: [question(SUPPORTED_STEM, draftAnswer)] }],
  specTable: [
    { questionNo: 1, sectionTitle: '二、计算题', kind: 'calculation', score: 8, knowledge: ['带电粒子在匀强磁场中的运动'], ability: '应用', difficulty: 'medium' },
  ] satisfies SpecRow[],
})

describe('independentSolve: the engine decides', () => {
  it('invokes the physics runtime for a supported question and carries its answer', async () => {
    const real = createPhysicsToolRuntime()
    const calls: string[] = []
    const spy: PhysicsToolRuntime = {
      solveQuestion: (text: string, questionId?: string) => {
        calls.push(text)
        return real.solveQuestion(text, questionId)
      },
    } as unknown as PhysicsToolRuntime

    /* A deliberately wrong draft: the paper's answer must still be the engine's. */
    const [result] = await independentSolve([question(SUPPORTED_STEM, 'r = 0 m')], 0, 120_000, spy)

    /* Genuinely invoked — asserted, not assumed. */
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(SUPPORTED_STEM)

    expect(result).toBeDefined()
    expect(result!.solvedAnswer).not.toBe('')
    expect(result!.solvedAnswer).toBe(engineAnswerOf(real, SUPPORTED_STEM))
    expect(result!.solvedAnswer).toMatch(/轨道半径 R = 7\.8\d cm/)
    expect(result!.solvedAnswer).toMatch(/运动周期 T =/)
  })

  it('agrees when the draft matches the engine and flags it when the draft contradicts', async () => {
    const runtime = createPhysicsToolRuntime()
    const engineAnswer = engineAnswerOf(runtime, SUPPORTED_STEM)

    const [agreed] = await independentSolve([question(SUPPORTED_STEM, engineAnswer)], 0, 120_000, runtime)
    expect(agreed!.consistent).toBe(true)
    expect(engineRefusalFindings([agreed!], new Map())).toEqual([])
    expect(solveFindings([agreed!])).toEqual([])

    /* A model answer that contradicts the engine is flagged, not accepted. */
    const [contradicted] = await independentSolve([question(SUPPORTED_STEM, 'r = 999 m')], 0, 120_000, runtime)
    expect(contradicted!.consistent).toBe(false)
    expect(contradicted!.solvedAnswer).not.toBe('')
    const mismatches = solveFindings([contradicted!])
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]).toMatchObject({ questionNo: 1, code: 'solve-mismatch', severity: 'error' })
    /* The engine did decide it, so it is a disagreement, not a refusal. */
    expect(engineRefusalFindings([contradicted!], new Map())).toEqual([])
  })

  it('surfaces an unsupported question as an explicit refusal, never a number', async () => {
    const runtime = createPhysicsToolRuntime()
    const [result] = await independentSolve([question(UNSUPPORTED_STEM, '光子能量 E = 10.2 eV')], 0, 120_000, runtime)

    expect(result!.solvedAnswer).toBe('')
    expect(result!.consistent).toBe(false)
    expect(result!.note).toContain('UNSUPPORTED_MODEL')

    const refusals = engineRefusalFindings([result!], new Map([[1, 'experiment']]))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ questionNo: 1, code: 'engine-mismatch', severity: 'error' })
    /* A CONCEPT kind the engine refuses by design is a warning, not a blocker. */
    expect(engineRefusalFindings([result!], new Map([[1, 'choice-single']]))[0])
      .toMatchObject({ severity: 'warning' })

    /* No number is stamped onto the paper for a refused question. */
    const doc = documentOf('光子能量 E = 10.2 eV')
    expect(applyEngineAnswers(doc, [result!])).toBeUndefined()
  })

  it('reports a runtime fault as a failed solve after the retry, not a silent pass', async () => {
    let attempts = 0
    const broken: PhysicsToolRuntime = {
      solveQuestion: () => {
        attempts += 1
        throw new Error('runtime exploded')
      },
    } as unknown as PhysicsToolRuntime

    const [result] = await independentSolve([question(SUPPORTED_STEM, 'r = 0.078 m')], 0, 120_000, broken)
    expect(attempts).toBe(2)
    expect(result!.solvedAnswer).toBe('')
    expect(result!.consistent).toBe(false)
    expect(result!.note).toContain('独立解题失败')
    expect(engineRefusalFindings([result!], new Map([[1, 'calculation']]))[0]).toMatchObject({ code: 'engine-mismatch' })
  })
})

describe('applyEngineAnswers: the engine value lands in the paper', () => {
  it('replaces the drafted answer with the engine verdict', async () => {
    const runtime = createPhysicsToolRuntime()
    const [result] = await independentSolve([question(SUPPORTED_STEM, 'r = 0 m')], 0, 120_000, runtime)
    const corrected = applyEngineAnswers(documentOf('r = 0 m'), [result!])

    expect(corrected).toBeDefined()
    expect(corrected!.sections[0]!.items[0]!.answer!.result).toBe(result!.solvedAnswer)
    /* The rest of the drafted answer survives. */
    expect(corrected!.sections[0]!.items[0]!.answer!.steps).toEqual(['洛伦兹力提供向心力'])
  })

  it('reports no change when the draft already carries the engine answer', async () => {
    const runtime = createPhysicsToolRuntime()
    const engineAnswer = engineAnswerOf(runtime, SUPPORTED_STEM)
    const [result] = await independentSolve([question(SUPPORTED_STEM, engineAnswer)], 0, 120_000, runtime)
    expect(applyEngineAnswers(documentOf(engineAnswer), [result!])).toBeUndefined()
  })
})
