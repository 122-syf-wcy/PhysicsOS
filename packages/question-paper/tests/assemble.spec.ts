import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BANK_POLICY,
  planPaper,
  planRow,
  questionFromBankItem,
  rankCandidates,
  stemFingerprint,
} from '../src/index.ts'
import type { BankItem, BankUsage, PaperRequest, SourcePaper, SpecRow } from '../src/index.ts'

/* ---------------------------------------------------------- fixtures -- */

const request: PaperRequest = {
  level: 'gaokao',
  subjects: ['physics'],
  kind: 'mock',
  totalScore: 100,
  minutes: 75,
  chapters: [],
  exclude: [],
  difficulty: { basic: 0.5, medium: 0.35, hard: 0.15 },
  targetYear: 2027,
  textbook: '人教版',
}

const row = (overrides: Partial<SpecRow> = {}): SpecRow => ({
  questionNo: 1,
  sectionTitle: '一、选择题',
  kind: 'choice-single',
  score: 4,
  knowledge: ['牛顿第二定律'],
  ability: '应用',
  difficulty: 'medium',
  ...overrides,
})

const item = (overrides: Partial<BankItem> = {}): BankItem => ({
  id: 'item-1',
  level: 'gaokao',
  subject: 'physics',
  kind: 'choice-single',
  knowledge: ['牛顿第二定律'],
  ability: '应用',
  difficulty: 'medium',
  score: 4,
  stem: '物块在水平面上受拉力作用，求加速度。',
  options: ['A. 1', 'B. 2', 'C. 3', 'D. 4'],
  answer: {
    result: 'B',
    steps: ['$F-\\mu mg=ma$'],
    gradingPoints: [{ text: '选对', score: 4 }],
  },
  answerTier: 'manual-transcript',
  stemHash: 'h1',
  sourceLabel: '2024·贵阳一中高三月考',
  anomalies: [],
  reuseModes: ['verbatim', 'adapt'],
  status: 'verified',
  enteredBy: 'test',
  enteredAt: '2026-09-01T00:00:00Z',
  ...overrides,
})

const realPaper: SourcePaper = {
  id: 'sp-1',
  examName: '贵阳一中高三月考',
  level: 'gaokao',
  subject: 'physics',
  year: 2024,
  kind: 'real',
  featured: true,
  evidenceTier: 'original-scan',
  sourceRef: 'scan-2024-gy1z.pdf',
  status: 'verified',
  enteredBy: 'tester',
  enteredAt: '2026-09-01T00:00:00Z',
}

const ctx = (
  overrides: Partial<{
    taken: Set<string>
    recentPaperIds: Set<string>
    usages: BankUsage[]
    sources: Map<string, SourcePaper>
    verbatimSpent: number
    policy: typeof DEFAULT_BANK_POLICY
  }> = {},
) => ({
  taken: overrides.taken ?? new Set<string>(),
  recentPaperIds: overrides.recentPaperIds ?? new Set<string>(),
  usageOf: (itemId: string) => (overrides.usages ?? []).filter((u) => u.itemId === itemId),
  sourceOf: (id: string) => (overrides.sources ?? new Map()).get(id),
  verbatimSpent: overrides.verbatimSpent ?? 0,
  policy: overrides.policy ?? DEFAULT_BANK_POLICY,
})

/* ------------------------------------------------------ rankCandidates -- */

describe('rankCandidates', () => {
  it('drops items that fail hard constraints', () => {
    const items = [
      item({ id: 'ok' }),
      item({ id: 'pending', status: 'pending' }),
      item({ id: 'wrong-kind', kind: 'calculation' }),
      item({ id: 'wrong-subject', subject: 'chemistry' }),
      item({ id: 'wrong-level', level: 'zhongkao' }),
      item({ id: 'no-verbatim', reuseModes: ['adapt'] }),
    ]
    const ranked = rankCandidates(row(), request, items, { ...ctx(), mode: 'verbatim' })
    expect(ranked.map((c) => c.item.id)).toEqual(['ok'])
    /* The adapt-only item becomes eligible under the adapt mode. */
    const adaptRanked = rankCandidates(row(), request, items, { ...ctx(), mode: 'adapt' })
    expect(adaptRanked.map((c) => c.item.id).sort()).toEqual(['no-verbatim', 'ok'])
  })

  it('requires score equality for verbatim but not for adapt', () => {
    const items = [item({ id: 'off-score', score: 6 })]
    expect(rankCandidates(row(), request, items, { ...ctx(), mode: 'verbatim' })).toHaveLength(0)
    expect(rankCandidates(row(), request, items, { ...ctx(), mode: 'adapt' })).toHaveLength(1)
  })

  it('excludes items used on recent papers', () => {
    const usages: BankUsage[] = [
      { itemId: 'item-1', paperId: 'paper-old', usedAt: '2026-09-01T00:00:00Z', mode: 'verbatim' },
    ]
    const recent = new Set(['paper-old'])
    expect(
      rankCandidates(row(), request, [item()], {
        ...ctx({ usages, recentPaperIds: recent }),
        mode: 'adapt',
      }),
    ).toHaveLength(0)
    /* Usage on a paper outside the window does not count. */
    expect(
      rankCandidates(row(), request, [item()], { ...ctx({ usages }), mode: 'adapt' }),
    ).toHaveLength(1)
  })

  it('excludes banned knowledge and out-of-scope tagged chapters', () => {
    const banned = rankCandidates(row(), { ...request, exclude: ['牛顿第二定律'] }, [item()], {
      ...ctx(),
      mode: 'adapt',
    })
    expect(banned).toHaveLength(0)
    const scoped = { ...request, chapters: ['必修一'] }
    const outOfScope = rankCandidates(row(), scoped, [item({ chapter: '选修三' })], {
      ...ctx(),
      mode: 'adapt',
    })
    expect(outOfScope).toHaveLength(0)
    /* An untagged chapter stays eligible — the tag may simply be missing. */
    const untagged = rankCandidates(row(), scoped, [item()], { ...ctx(), mode: 'adapt' })
    expect(untagged).toHaveLength(1)
  })

  it('ranks primary-knowledge, matching difficulty and verified-real sources highest', () => {
    const sources = new Map([['sp-1', realPaper]])
    const best = item({ id: 'best', sourcePaperId: 'sp-1', answerTier: 'original-scan' })
    const weaker = item({
      id: 'weaker',
      knowledge: ['其他考点', '牛顿第二定律'],
      difficulty: 'hard',
      ability: '识记',
      answerTier: 'web-public',
    })
    const ranked = rankCandidates(row(), request, [weaker, best], {
      ...ctx({ sources }),
      mode: 'adapt',
    })
    expect(ranked[0]?.item.id).toBe('best')
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    expect(ranked[0]!.breakdown.knowledge).toBeGreaterThan(ranked[1]!.breakdown.knowledge)
    expect(ranked[0]!.breakdown.source).toBeGreaterThan(ranked[1]!.breakdown.source)
  })
})

/* ------------------------------------------------------------ planRow -- */

describe('planRow', () => {
  it('serves a strong verified match verbatim', () => {
    /* manual-transcript caps source at 0.7 — only original-scan evidence
       on a verified real paper clears the verbatim threshold. */
    const sources = new Map([['sp-1', realPaper]])
    const strong = planRow(
      row(),
      request,
      [item({ sourcePaperId: 'sp-1', answerTier: 'original-scan' })],
      ctx({ sources }),
    )
    expect(strong.mode).toBe('verbatim')
    expect(strong.item?.id).toBe('item-1')
  })

  it('falls to adapt when the verbatim quota is spent', () => {
    const sources = new Map([['sp-1', realPaper]])
    const strong = item({ sourcePaperId: 'sp-1', answerTier: 'original-scan' })
    const plan = planRow(row(), request, [strong], ctx({ sources, verbatimSpent: 99 }))
    expect(plan.mode).toBe('adapt')
    expect(plan.item?.id).toBe('item-1')
  })

  it('reports a gap when nothing is eligible', () => {
    const plan = planRow(row(), request, [item({ status: 'pending' })], ctx())
    expect(plan.mode).toBe('gap')
    expect(plan.candidates).toBe(0)
    expect(plan.item).toBeUndefined()
  })

  it('chooses generate when candidates exist but score below the adapt threshold', () => {
    const weak = item({
      knowledge: ['完全不同的考点'],
      difficulty: 'basic',
      ability: '识记',
      answerTier: 'web-public',
    })
    const plan = planRow(row(), request, [weak], ctx())
    expect(plan.mode).toBe('generate')
    expect(plan.candidates).toBe(1)
    expect(plan.exemplars.map((e) => e.id)).toEqual(['item-1'])
  })
})

/* ----------------------------------------------------------- planPaper -- */

describe('planPaper', () => {
  it('never places one item on two rows', () => {
    const sources = new Map([['sp-1', realPaper]])
    const strong = item({ sourcePaperId: 'sp-1', answerTier: 'original-scan' })
    const rows = [row({ questionNo: 1 }), row({ questionNo: 2 })]
    const plans = planPaper(rows, request, [strong], {
      recentPaperIds: new Set(),
      usageOf: () => [],
      sourceOf: (id) => sources.get(id),
      policy: DEFAULT_BANK_POLICY,
    })
    const served = plans.filter((p) => p.item !== undefined)
    expect(served).toHaveLength(1)
    /* The second row falls to adapt/generate — same item may not repeat. */
    expect(plans[1]?.item).toBeUndefined()
  })
})

/* -------------------------------------------------- questionFromBankItem -- */

describe('questionFromBankItem', () => {
  it('materializes a verbatim placement with provenance stamped', () => {
    const q = questionFromBankItem(row({ questionNo: 7, score: 4 }), item())
    expect(q.number).toBe(7)
    expect(q.stem).toBe(item().stem)
    expect(q.provenance).toEqual({
      bankItemId: 'item-1',
      mode: 'verbatim',
      sourceLabel: '2024·贵阳一中高三月考',
    })
    expect(q.status).toBe('draft')
  })
})

/* ------------------------------------------------------- stemFingerprint -- */

describe('stemFingerprint', () => {
  it('is stable across formatting noise and differs on real edits', () => {
    const a = stemFingerprint('物块在 $F=ma$ 作用下运动。')
    const noisy = stemFingerprint('物块在$F=ma$作用下运动。')
    expect(noisy).toBe(a)
    const other = stemFingerprint('物块在 F=kv 作用下运动。')
    expect(other).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{24}$/)
  })
})
