/**
 * Automated draft checks — the mechanical gate before teacher review.
 *
 * Every check is a pure function over the PaperDocument and its request:
 * score arithmetic, numbering, answer presence, figure references, scope
 * discipline and duplicate stems. Findings are evidence, not verdicts —
 * `error` findings block approval until resolved or rebutted in review.
 */

import { DIFFICULTY_COEFFICIENT } from './difficulty.ts'
import type { BankItem, CheckFinding, PaperDocument, PaperQuestion } from './paper.ts'

/** Normalize a stem for duplicate comparison: lowercase, strip markup/spaces. */
const normalizeStem = (stem: string): string =>
  stem.toLowerCase().replace(/\$[^$]*\$/g, '').replace(/[^\p{Letter}\p{Number}]/gu, '')

/** Token-set Jaccard similarity between two normalized stems. */
function similarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared++
  return shared / (ga.size + gb.size - shared)
}

const allQuestions = (doc: PaperDocument): PaperQuestion[] =>
  doc.sections.flatMap(section => section.items)

/**
 * Run every mechanical check over a draft.
 * @param doc - the drafted document.
 * @param request - what the teacher asked for (scope and totals gate).
 * @param bank - optional bank context for provenance checks: resolves the
 *   stamped source item and whether it was placed on a recent paper.
 * @returns findings in document order; empty means the draft is clean.
 */
export function runChecks(doc: PaperDocument, request: {
  readonly totalScore: number
  readonly chapters: readonly string[]
  readonly exclude: readonly string[]
  readonly difficulty?: { readonly basic: number; readonly medium: number; readonly hard: number }
}, bank?: {
  readonly itemOf: (id: string) => BankItem | undefined
  readonly usedRecently: (itemId: string) => boolean
}): CheckFinding[] {
  const findings: CheckFinding[] = []
  const questions = allQuestions(doc)

  /* Score arithmetic: per-question vs spec, sub-question split, and total. */
  const specByNo = new Map(doc.specTable.map(row => [row.questionNo, row]))
  let total = 0
  for (const question of questions) {
    total += question.score
    const spec = specByNo.get(question.number)
    if (spec !== undefined && spec.score !== question.score) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'score-mismatch',
        detail: `细目表分值 ${spec.score} 分，题面标注 ${question.score} 分`,
      })
    }
    if (question.subQuestions !== undefined && question.subQuestions.length > 0) {
      const subTotal = question.subQuestions.reduce((sum, sub) => sum + sub.score, 0)
      if (subTotal !== question.score) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'score-mismatch',
          detail: `小问分值合计 ${subTotal} 分，与题面 ${question.score} 分不符`,
        })
      }
    }
    /* Spec fidelity: the drafted question must deliver the confirmed row's
       kind, difficulty, ability and knowledge points — a draft that drifts
       off the 双向细目表 is off-spec even if it reads well. */
    if (spec !== undefined) {
      const drifts: string[] = []
      if (spec.kind !== question.kind) drifts.push(`题型 ${spec.kind}→${question.kind}`)
      if (spec.difficulty !== question.difficulty) drifts.push(`难度 ${spec.difficulty}→${question.difficulty}`)
      if (spec.ability !== question.ability) drifts.push(`能力 ${spec.ability}→${question.ability}`)
      const missing = spec.knowledge.filter(point => !question.knowledge.includes(point))
      if (missing.length > 0) drifts.push(`考点缺失 ${missing.join('、')}`)
      if (drifts.length > 0) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'spec-mismatch',
          detail: `偏离细目表：${drifts.join('；')}`,
        })
      }
    }
  }
  if (total !== request.totalScore) {
    findings.push({
      severity: 'error', code: 'score-mismatch',
      detail: `卷面合计 ${total} 分，目标总分 ${request.totalScore} 分`,
    })
  }

  /* Numbering: printed numbers must be a contiguous 1..N sequence. */
  const numbers = questions.map(question => question.number).sort((a, b) => a - b)
  for (let index = 0; index < numbers.length; index++) {
    if (numbers[index] !== index + 1) {
      findings.push({
        severity: 'error', code: 'numbering',
        detail: `题号断档：第 ${index + 1} 位实际是 ${numbers[index]} 题`,
      })
      break
    }
  }

  for (const question of questions) {
    /* Every scored question needs an answer with grading points. */
    if (question.answer === undefined || question.answer.gradingPoints.length === 0) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'missing-answer',
        detail: '缺少参考答案或评分点',
      })
    } else {
      /* Grading points must sum to the question score — the rubric IS the
         score, a mismatch makes marking impossible. */
      const pointTotal = question.answer.gradingPoints.reduce((sum, point) => sum + point.score, 0)
      if (pointTotal !== question.score) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'score-mismatch',
          detail: `评分点合计 ${pointTotal} 分，与题面 ${question.score} 分不符`,
        })
      }
      /* Choice answers must name letters that exist — single takes exactly
         one, multi takes two or more. */
      const letters = question.answer.result.trim().match(/[A-Z]/g) ?? []
      const optionCount = question.options?.length ?? 0
      if (question.kind === 'choice-single' && (letters.length !== 1 || (letters[0]!.charCodeAt(0) - 65) >= optionCount)) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'answer-format',
          detail: `单选题答案「${question.answer.result}」不是唯一的有效选项字母`,
        })
      }
      if (question.kind === 'choice-multi' && (letters.length < 2 || letters.some(l => l.charCodeAt(0) - 65 >= optionCount))) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'answer-format',
          detail: `多选题答案「${question.answer.result}」不是两个以上有效选项字母`,
        })
      }
    }
    /* Knowledge points are the question's stated 命题依据 — a question
       without them cannot be audited against the spec or source bank. */
    if (question.knowledge.length === 0) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'missing-knowledge',
        detail: '未标注考点，命题依据缺失',
      })
    }
    /* Stems that say 如图/右图 must carry a figure — but "图中未画出" is a
       disclaimer, not a reference, so it never triggers this check. The
       disclaimer must name the figure (图…未画出/未给出); bare "未画出" also
       matches tape conventions like "相邻两点间还有四个点未画出". */
    const disclaimsFigure = /图(中|里|上|示)?未(画出|给出|标出|显示)/.test(question.stem)
    if (!disclaimsFigure && /如图|右图|左图|下图|上图|图所示|图中/.test(question.stem) && question.figure === undefined) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'missing-figure',
        detail: '题面引用图示但未配图',
      })
    }
    /* The inverse contradiction: a figure attached to a stem that says none
       is drawn. One of the two must be repaired, not approved away. */
    if (disclaimsFigure && question.figure !== undefined) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'format',
        detail: '题面注明「图中未画出」却配了题图，题干与配图矛盾',
      })
    }
    /* Scope discipline: excluded content and out-of-range chapters. */
    for (const banned of request.exclude) {
      if (question.knowledge.includes(banned) || question.stem.includes(banned)) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'out-of-scope',
          detail: `命中排除内容「${banned}」`,
        })
      }
    }
    /* Choice format: options present, exactly one/multi answers as declared. */
    if ((question.kind === 'choice-single' || question.kind === 'choice-multi')
      && (question.options === undefined || question.options.length < 2)) {
      findings.push({
        questionNo: question.number, severity: 'error', code: 'format',
        detail: '选择题缺少选项',
      })
    }
  }

  /* Near-duplicate stems inside the same paper. */
  const normalized = questions.map(question => normalizeStem(question.stem))
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const score = similarity(normalized[i] ?? '', normalized[j] ?? '')
      if (score > 0.6) {
        findings.push({
          questionNo: questions[j]?.number, severity: 'warning', code: 'duplicate',
          detail: `与第 ${questions[i]?.number} 题题面相似度 ${(score * 100).toFixed(0)}%`,
        })
      }
    }
  }

  /* Difficulty drift: the draft's score-weighted coefficient vs the
     request's target mix — a >0.05 gap means the paper will not feel like
     the difficulty the teacher selected. */
  if (request.difficulty !== undefined && total > 0) {
    const target = request.difficulty.basic * DIFFICULTY_COEFFICIENT.basic
      + request.difficulty.medium * DIFFICULTY_COEFFICIENT.medium
      + request.difficulty.hard * DIFFICULTY_COEFFICIENT.hard
    const actual = questions.reduce((sum, q) => sum + q.score * DIFFICULTY_COEFFICIENT[q.difficulty], 0) / total
    if (Math.abs(actual - target) > 0.05) {
      findings.push({
        severity: 'warning', code: 'difficulty-drift',
        detail: `卷面预估难度系数 ${actual.toFixed(2)}，偏离目标 ${target.toFixed(2)}`,
      })
    }
  }

  /* Bank provenance: the stamped source mode must match what is actually
     printed, the source item must exist, weak answer evidence stays
     visible, and verbatim reuse inside the freshness window is flagged. */
  if (bank !== undefined) {
    for (const question of questions) {
      const provenance = question.provenance
      if (provenance?.bankItemId === undefined) continue
      const item = bank.itemOf(provenance.bankItemId)
      if (item === undefined) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'provenance-mismatch',
          detail: `标注来源题库条目 ${provenance.bankItemId} 不存在或已删除`,
        })
        continue
      }
      if (provenance.mode === 'verbatim' && question.stem !== item.stem) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'provenance-mismatch',
          detail: `标注「原题」但题干与题库条目（${item.sourceLabel ?? item.id}）不一致`,
        })
      }
      if (provenance.mode === 'adapted' && question.stem === item.stem) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'provenance-mismatch',
          detail: `标注「改编」但题干与原题逐字相同（${item.sourceLabel ?? item.id}）`,
        })
      }
      if (item.answerTier === 'recalled' || item.answerTier === 'web-public') {
        findings.push({
          questionNo: question.number, severity: 'warning', code: 'answer-source',
          detail: `来源 ${item.sourceLabel ?? item.id} 的答案证据等级为「${item.answerTier}」，建议教研复核答案`,
        })
      }
      if (provenance.mode === 'verbatim' && bank.usedRecently(item.id)) {
        findings.push({
          questionNo: question.number, severity: 'error', code: 'bank-reuse',
          detail: `原题近期已使用（${item.sourceLabel ?? item.id}），学生可能刷过`,
        })
      }
    }
  }

  return findings
}

/**
 * Fold an independent solving report into findings.
 * @param solved - per-question solver results.
 * @returns `solve-mismatch` findings for every disagreement.
 */
export function solveFindings(solved: readonly {
  questionNo: number
  consistent: boolean
  note?: string
}[]): CheckFinding[] {
  return solved
    .filter(result => !result.consistent)
    .map(result => ({
      questionNo: result.questionNo, severity: 'error' as const, code: 'solve-mismatch' as const,
      detail: `独立解题与起草答案不一致${result.note === undefined ? '' : `：${result.note}`}`,
    }))
}
