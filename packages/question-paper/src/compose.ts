/**
 * DRAFT scaffolding — bank sampler from the earlier spike, NOT a production
 * path. Production papers are AI-drafted per confirmed spec tables and pass
 * checks + review before export; this sampler exists only to exercise the
 * item plumbing during development. Its weights and items are unverified.
 */

import { QUESTION_BANK } from './bank.ts'
import { EXAM_BLUEPRINTS } from './blueprints.ts'
import { weightsFor } from './knowledge-weights.ts'
import type {
  BankQuestion, BlueprintSection, PaperKind, PaperLevel,
} from './paper.ts'

/** One compose request: which exam, which product, which scope. */
export interface ComposeRequest {
  readonly level: PaperLevel
  readonly kind: PaperKind
  /** Domains in scope (unit/weekly papers); undefined = full coverage. */
  readonly scope?: readonly string[]
  /** Fix the draw for reproducible papers; omitted = random per call. */
  readonly seed?: number
}

/** Flat section shape the sampler draws against. */
interface SamplerSection {
  readonly title: string
  readonly kind: BankQuestion['kind']
  readonly count: number
  readonly scoreEach: number
}

/** One placed question, numbered as printed. */
export interface DraftItem {
  readonly number: number
  readonly section: SamplerSection
  readonly question: BankQuestion
}

/** A blueprint slot the bank could not fill — reported, never faked. */
export interface DraftGap {
  readonly section: SamplerSection
  readonly needed: number
  readonly available: number
}

/** The assembled draft paper. `gaps` non-empty means it is short. */
export interface DraftPaper {
  readonly id: string
  readonly level: PaperLevel
  readonly kind: PaperKind
  readonly title: string
  readonly totalScore: number
  readonly minutes: number
  readonly items: readonly DraftItem[]
  readonly gaps: readonly DraftGap[]
  readonly scope: readonly string[]
  readonly createdAt: string
}

/* Small deterministic PRNG — mulberry32 — so a seed reproduces the draw. */
const mulberry32 = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pickWeighted = <T>(items: readonly T[], weight: (item: T) => number, next: () => number): T => {
  const total = items.reduce((sum, item) => sum + weight(item), 0)
  let roll = next() * total
  for (const item of items) {
    roll -= weight(item)
    if (roll <= 0) return item
  }
  const last = items.at(-1)
  if (last === undefined) throw new Error('weighted pick on empty pool')
  return last
}

/** Flatten a slot-based structure template into sampler sections. */
const sectionsOf = (level: PaperLevel): readonly SamplerSection[] => {
  const blueprint = EXAM_BLUEPRINTS.find(entry => entry.level === level)
  if (blueprint === undefined) throw new Error(`no blueprint for level ${level}`)
  return blueprint.sections.flatMap((section: BlueprintSection) => {
    const groups = new Map<BankQuestion['kind'], number>()
    for (const slot of section.slots) groups.set(slot.kind, (groups.get(slot.kind) ?? 0) + 1)
    return [...groups.entries()].map(([kind, count]) => ({
      title: section.title, kind, count,
      scoreEach: section.slots.find(slot => slot.kind === kind)?.score ?? 0,
    }))
  })
}

/**
 * Draw a draft paper from the unverified seed bank.
 * @param request - level, kind, optional scope and seed.
 * @param bank - question pool (defaults to the built-in seed).
 * @returns the draft; `gaps` lists every unfilled slot.
 */
export function composePaper(request: ComposeRequest, bank: readonly BankQuestion[] = QUESTION_BANK): DraftPaper {
  const scope = request.scope ?? []
  const inScope = (item: BankQuestion): boolean =>
    item.level === request.level && (scope.length === 0 || scope.includes(item.domain))

  const weights = weightsFor(request.level, request.kind === 'mock')
  const used = new Set<string>()
  const next = mulberry32(request.seed ?? Date.now())
  const items: DraftItem[] = []
  const gaps: DraftGap[] = []
  let number = 1

  for (const section of sectionsOf(request.level)) {
    const pool = bank.filter(item =>
      item.kind === section.kind && inScope(item) && !used.has(item.id))
    const missing = section.count - pool.length
    if (missing > 0) gaps.push({ section, needed: section.count, available: pool.length })

    for (let index = 0; index < Math.min(section.count, pool.length); index++) {
      const item = pickWeighted(
        pool.filter(candidate => !used.has(candidate.id)),
        entry => weights[entry.domain] ?? 0.02,
        next,
      )
      used.add(item.id)
      items.push({ number: number++, section, question: item })
    }
  }

  return {
    id: `draft-${request.level}-${request.kind}-${(request.seed ?? Date.now()).toString(36)}`,
    level: request.level,
    kind: request.kind,
    title: `draft-${request.level}-${request.kind}`,
    totalScore: 0,
    minutes: 0,
    items,
    gaps,
    scope,
    createdAt: new Date().toISOString(),
  }
}
