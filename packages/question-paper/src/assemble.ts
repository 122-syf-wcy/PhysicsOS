/**
 * Bank assembly — pick which confirmed-spec row a verified bank item serves.
 *
 * Pure functions over the durable tables: the host passes items, usages and
 * source papers in; this module answers one {@link RowPlan} per spec row.
 * The three-supply chain per row is verbatim → adapt → generate, and a row
 * with no eligible candidate reports a gap honestly instead of forcing one.
 */

import type {
  BankItem,
  BankUsage,
  Difficulty,
  PaperQuestion,
  PaperRequest,
  SourcePaper,
  SpecRow,
} from './paper.ts'

/** Deployment-tunable selection policy. */
export interface BankSelectionPolicy {
  /** Max verbatim placements on one paper; surplus falls to adapt. */
  readonly verbatimMax: number
  /** Items used on any of the N most recent papers are ineligible. */
  readonly freshnessPapers: number
  /** Top-K candidates handed to the generator as exemplars. */
  readonly exemplarCount: number
}

/** Defaults: mock-paper safety first — adaptation over verbatim reuse. */
export const DEFAULT_BANK_POLICY: BankSelectionPolicy = {
  verbatimMax: 3,
  freshnessPapers: 3,
  exemplarCount: 3,
}

/* Score thresholds on the weighted candidate total (0..1): ≥ τ_VERBATIM may
   print as-is, ≥ τ_ADAPT may serve as the adaptation skeleton, lower feeds
   the generator only as an exemplar. */
const T_VERBATIM = 0.85
const T_ADAPT = 0.55

/** One ranked eligible candidate with its score breakdown. */
export interface ScoredCandidate {
  readonly item: BankItem
  readonly score: number
  readonly breakdown: {
    readonly knowledge: number
    readonly difficulty: number
    readonly ability: number
    readonly source: number
  }
}

/** What one spec row gets from the bank. */
export interface RowPlan {
  readonly row: SpecRow
  readonly mode: 'verbatim' | 'adapt' | 'generate' | 'gap'
  /** The chosen item for verbatim/adapt modes. */
  readonly item?: BankItem
  readonly candidateScore?: number
  /** Eligible candidate count — zero means the bank cannot serve this row. */
  readonly candidates: number
  /** Top candidates offered to the generator as style exemplars. */
  readonly exemplars: readonly BankItem[]
}

const DIFF_RANK: Record<Difficulty, number> = { basic: 0, medium: 1, hard: 2 }

/**
 * Source trust weight: questions lifted from a verified 真题 paper outrank
 * curated 名校/联考 items, which outrank loose web captures. Unverifiable
 * evidence tiers cap at 0.6 no matter where they came from.
 */
function sourceWeight(item: BankItem, sourceOf: (id: string) => SourcePaper | undefined): number {
  if (item.answerTier === 'recalled' || item.answerTier === 'web-public') {
    const loose = item.sourcePaperId === undefined ? 0.6 : 0.7
    return loose
  }
  if (item.sourcePaperId === undefined) return 0.7
  const paper = sourceOf(item.sourcePaperId)
  if (paper === undefined) return 0.7
  if (paper.kind === 'real') return 1.0
  if (paper.featured === true) return 0.9
  return 0.85
}

/** Knowledge coverage: primary-point hit counts most, secondary overlaps fill. */
function knowledgeScore(row: SpecRow, item: BankItem): number {
  if (row.knowledge.length === 0) return item.knowledge.length > 0 ? 0.7 : 0.3
  const wanted = new Set(row.knowledge)
  const primaryHit = item.knowledge[0] !== undefined && wanted.has(item.knowledge[0])
  const overlap = item.knowledge.filter((k) => wanted.has(k)).length
  return Math.min(1, (primaryHit ? 0.6 : 0) + 0.4 * (overlap / wanted.size))
}

const difficultyScore = (row: SpecRow, item: BankItem): number => {
  const gap = Math.abs(DIFF_RANK[row.difficulty] - DIFF_RANK[item.difficulty])
  return gap === 0 ? 1 : gap === 1 ? 0.6 : 0.2
}

const abilityScore = (row: SpecRow, item: BankItem): number =>
  row.ability === item.ability ? 1 : 0.5

const scopeHit = (itemChapter: string | undefined, scope: string): boolean =>
  itemChapter !== undefined && (itemChapter.includes(scope) || scope.includes(itemChapter))

/**
 * Hard eligibility for one row. A candidate must be verified, match the
 * row's kind and subject, fall inside the taught chapter range when the row
 * pins one, dodge every exclusion, clear the freshness window, permit the
 * intended reuse mode, and not already sit on this paper.
 */
function eligible(
  row: SpecRow,
  request: PaperRequest,
  item: BankItem,
  ctx: {
    taken: ReadonlySet<string>
    recentPaperIds: ReadonlySet<string>
    usageOf: (itemId: string) => readonly BankUsage[]
    mode: 'verbatim' | 'adapt'
  },
): boolean {
  if (item.status !== 'verified') return false
  if (item.level !== request.level) return false
  if (item.kind !== row.kind) return false
  if (item.subject !== rowSubject(request, row)) return false
  if (!item.reuseModes.includes(ctx.mode)) return false
  /* Verbatim prints as-is — a differently-weighted question would break the
     section total, so an off-score item may only serve through adaptation. */
  if (ctx.mode === 'verbatim' && Math.abs(item.score - row.score) > 0.01) return false
  if (ctx.taken.has(item.id)) return false
  if (
    request.exclude.some((banned) =>
      item.knowledge.some((k) => k.includes(banned) || banned.includes(k)),
    )
  )
    return false
  /* An untagged chapter stays eligible — the tag may simply be missing;
     a tagged out-of-scope one is a real mismatch. */
  if (
    request.chapters.length > 0 &&
    item.chapter !== undefined &&
    item.chapter.length > 0 &&
    !request.chapters.some((scope) => scopeHit(item.chapter, scope))
  ) {
    return false
  }
  if (ctx.usageOf(item.id).some((u) => ctx.recentPaperIds.has(u.paperId))) return false
  return true
}

/** The subject a spec row exercises — combined papers carry it per question. */
function rowSubject(request: PaperRequest, _row: SpecRow): BankItem['subject'] {
  /* Combined papers: physics rows stay physics until blueprint rows carry a
     subject field; chemistry rows land in a later pass. */
  return request.subjects[0] ?? 'physics'
}

/**
 * Rank eligible candidates for one row by the weighted total
 * `0.45·knowledge + 0.25·difficulty + 0.15·ability + 0.15·source`.
 * @returns candidates sorted best-first.
 */
export function rankCandidates(
  row: SpecRow,
  request: PaperRequest,
  items: readonly BankItem[],
  ctx: {
    taken: ReadonlySet<string>
    recentPaperIds: ReadonlySet<string>
    usageOf: (itemId: string) => readonly BankUsage[]
    sourceOf: (id: string) => SourcePaper | undefined
    mode: 'verbatim' | 'adapt'
  },
): ScoredCandidate[] {
  const scored: ScoredCandidate[] = []
  for (const item of items) {
    if (!eligible(row, request, item, ctx)) continue
    const breakdown = {
      knowledge: knowledgeScore(row, item),
      difficulty: difficultyScore(row, item),
      ability: abilityScore(row, item),
      source: sourceWeight(item, ctx.sourceOf),
    }
    scored.push({
      item,
      score:
        0.45 * breakdown.knowledge +
        0.25 * breakdown.difficulty +
        0.15 * breakdown.ability +
        0.15 * breakdown.source,
      breakdown,
    })
  }
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  return scored
}

/**
 * Plan one spec row: verbatim ≥ τ_verbatim (and inside the verbatim quota),
 * adapt ≥ τ_adapt, otherwise generate with the best candidates as exemplars
 * — or gap when nothing is eligible.
 */
export function planRow(
  row: SpecRow,
  request: PaperRequest,
  items: readonly BankItem[],
  ctx: {
    taken: ReadonlySet<string>
    recentPaperIds: ReadonlySet<string>
    usageOf: (itemId: string) => readonly BankUsage[]
    sourceOf: (id: string) => SourcePaper | undefined
    verbatimSpent: number
    policy: BankSelectionPolicy
  },
): RowPlan {
  const base = {
    taken: ctx.taken,
    recentPaperIds: ctx.recentPaperIds,
    usageOf: ctx.usageOf,
    sourceOf: ctx.sourceOf,
  }
  const verbatimRanked = rankCandidates(row, request, items, { ...base, mode: 'verbatim' })
  const adaptRanked = rankCandidates(row, request, items, { ...base, mode: 'adapt' })
  /* The candidate count reports the wider pool — a row the bank can only
     adapt still counts as served. */
  const candidates = Math.max(verbatimRanked.length, adaptRanked.length)
  const exemplars = adaptRanked.slice(0, ctx.policy.exemplarCount).map((c) => c.item)

  const top = verbatimRanked[0]
  if (top !== undefined && top.score >= T_VERBATIM && ctx.verbatimSpent < ctx.policy.verbatimMax) {
    return {
      row,
      mode: 'verbatim',
      item: top.item,
      candidateScore: top.score,
      candidates,
      exemplars,
    }
  }
  const topAdapt = adaptRanked[0]
  if (topAdapt !== undefined && topAdapt.score >= T_ADAPT) {
    return {
      row,
      mode: 'adapt',
      item: topAdapt.item,
      candidateScore: topAdapt.score,
      candidates,
      exemplars,
    }
  }
  if (candidates === 0) {
    return { row, mode: 'gap', candidates: 0, exemplars }
  }
  return { row, mode: 'generate', candidates, exemplars }
}

/**
 * Plan a whole paper: rows in spec order, each choice marking its item as
 * taken so two rows never print the same question.
 * @returns the per-row plans and the verbatim placements spent.
 */
export function planPaper(
  specTable: readonly SpecRow[],
  request: PaperRequest,
  items: readonly BankItem[],
  ctx: {
    recentPaperIds: ReadonlySet<string>
    usageOf: (itemId: string) => readonly BankUsage[]
    sourceOf: (id: string) => SourcePaper | undefined
    policy: BankSelectionPolicy
  },
): RowPlan[] {
  const taken = new Set<string>()
  let verbatimSpent = 0
  return specTable.map((row) => {
    const plan = planRow(row, request, items, { ...ctx, taken, verbatimSpent })
    if (plan.mode === 'verbatim' && plan.item !== undefined) {
      taken.add(plan.item.id)
      verbatimSpent += 1
    } else if (plan.mode === 'adapt' && plan.item !== undefined) {
      taken.add(plan.item.id)
    }
    return plan
  })
}

/**
 * Materialize a verbatim placement: the bank item's content prints as-is,
 * renumbered to the spec row. Spec-bound fields (kind, score) are already
 * equal by eligibility; knowledge/ability/difficulty stay the item's own —
 * they are the true labels of the question as reviewed.
 */
export function questionFromBankItem(row: SpecRow, item: BankItem): PaperQuestion {
  return {
    number: row.questionNo,
    subject: item.subject,
    kind: item.kind,
    score: row.score,
    stem: item.stem,
    ...(item.options !== undefined ? { options: item.options } : {}),
    ...(item.subQuestions !== undefined ? { subQuestions: item.subQuestions } : {}),
    ...(item.figure !== undefined ? { figure: item.figure } : {}),
    answer: item.answer,
    knowledge: item.knowledge,
    ability: item.ability,
    difficulty: item.difficulty,
    provenance: {
      bankItemId: item.id,
      mode: 'verbatim',
      ...(item.sourceLabel !== undefined ? { sourceLabel: item.sourceLabel } : {}),
    },
    status: 'draft',
  }
}
