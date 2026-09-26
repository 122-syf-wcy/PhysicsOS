/**
 * PaperService — the 出卷 workflow's business core over the durable domain.
 *
 * Every rule in the plan lands at the operation that enforces it: source
 * records stay `pending` until reviewed; blueprints enter `verified` only
 * behind verified source papers; editing a document mints a new version and
 * voids approval; export refuses anything whose approval hash does not match
 * the current document hash.
 */

import { createHash } from 'node:crypto'
import {
  blueprintById, documentHash, planPaper, proposeSpecTable, runChecks, stemFingerprint,
  type BankItem, type BankSelectionPolicy, type BankUsage, type CheckFinding,
  type ExamBlueprint, type ExportBundle, type KnowledgeAnnotation, type KnowledgePoolEntry,
  type PaperApproval, type PaperDocument, type PaperJob, type PaperJobStatus,
  type PaperRequest, type PaperVersion, type ReviewRecord, type ReviewStatus,
  type RowPlan, type SolveResult, type SourcePaper, type SpecRow,
} from '@physicsos/question-paper'
import type { PaperDomain } from './domain.ts'

/** Structured failure the route layer maps to status codes. */
export class PaperError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PaperError'
  }
}

const now = (): string => new Date().toISOString()

const recordInSchoolScope = (recordSchoolId: string | null | undefined, schoolId: string | null | undefined): boolean =>
  schoolId === undefined || schoolId === null || recordSchoolId == null || recordSchoolId === schoolId

const jobInSchoolScope = (jobSchoolId: string | null | undefined, schoolId: string | null | undefined): boolean =>
  schoolId === undefined || schoolId === null || jobSchoolId == null || jobSchoolId === schoolId

const recordWritableInScope = (
  recordSchoolId: string | null | undefined,
  schoolId: string | null | undefined,
): boolean => schoolId === undefined || schoolId === null || recordSchoolId === schoolId

/** Inputs for a paper job: the request plus the blueprint it draws from. */
export interface JobCreateInput {
  readonly request: PaperRequest
  readonly blueprintId: string
  readonly schoolId?: string | null
}

/**
 * The paper workflow service. Holds the open domain; callers go through
 * methods, never the tables, so the invariants live exactly once.
 */
export class PaperService {
  constructor(private readonly domain: PaperDomain) {}

  /* ----------------------------------------------------- source intake -- */

  /**
   * Register a real exam paper on file (starts `pending`).
   * @param input - the paper metadata; `status`/`enteredAt` are service-owned.
   * @returns the stored source row.
   */
  async addSource(input: Omit<SourcePaper, 'status' | 'enteredAt'>): Promise<SourcePaper> {
    if (this.domain.table('source_papers').get(input.id) !== undefined) {
      throw new PaperError(409, 'DUPLICATE_SOURCE', `source '${input.id}' already exists`)
    }
    const record: SourcePaper = { ...input, status: 'pending', enteredAt: now() }
    await this.domain.table('source_papers').put(record.id, record)
    return record
  }

  /**
   * All source papers on file, in insertion order.
   * @returns every source paper row.
   */
  listSources(): SourcePaper[] {
    return [...this.domain.table('source_papers').entries()].map(([, record]) => record)
  }

  /**
   * Add one per-question annotation to a source paper.
   * @param input - the annotation fields; `status` is service-owned (starts `pending`).
   * @returns the stored annotation row.
   */
  async addAnnotation(input: Omit<KnowledgeAnnotation, 'status'>): Promise<KnowledgeAnnotation> {
    const source = this.domain.table('source_papers').get(input.sourcePaperId)
    if (source === undefined) {
      throw new PaperError(404, 'SOURCE_NOT_FOUND', `source '${input.sourcePaperId}' not found`)
    }
    const record: KnowledgeAnnotation = { ...input, status: 'pending' }
    await this.domain.table('annotations').put(record.id, record)
    return record
  }

  /**
   * List annotation rows, optionally narrowed to one source paper.
   * @param sourcePaperId - narrow to one source; absent returns all annotations.
   * @returns the annotation rows in insertion order.
   */
  listAnnotations(sourcePaperId?: string): KnowledgeAnnotation[] {
    const all = [...this.domain.table('annotations').entries()].map(([, record]) => record)
    return sourcePaperId === undefined
      ? all
      : all.filter(entry => entry.sourcePaperId === sourcePaperId)
  }

  /**
   * Flip a record's review status; stats/templates only count `verified`.
   * @param id - the source paper id.
   * @param status - the new review status.
   * @param reviewer - the reviewing teacher (recorded by the caller's audit trail).
   * @returns the updated source row.
   */
  async reviewSource(id: string, status: ReviewStatus, reviewer: string): Promise<SourcePaper> {
    const source = this.requireSource(id)
    const next: SourcePaper = { ...source, status }
    await this.domain.table('source_papers').put(id, next)
    void reviewer
    return next
  }

  /**
   * Flip one annotation's review status.
   * @param id - the annotation id.
   * @param status - the new review status.
   * @returns the updated annotation row.
   */
  async reviewAnnotation(id: string, status: ReviewStatus): Promise<KnowledgeAnnotation> {
    const record = this.domain.table('annotations').get(id)
    if (record === undefined) throw new PaperError(404, 'NOT_FOUND', `annotation '${id}' not found`)
    const next = { ...record, status }
    await this.domain.table('annotations').put(id, next)
    return next
  }

  /**
   * Knowledge-point statistics over VERIFIED annotations only.
   * @param sourcePaperId - narrow the evidence to one source; absent scans all.
   * @param schoolId - include platform and one school; `null` or absence includes all.
   * @returns per-knowledge-point `{count, score, papers}` totals.
   */
  annotationStats(
    sourcePaperId?: string, schoolId?: string | null,
  ): Record<string, { count: number; score: number; papers: number }> {
    const stats: Record<string, { count: number; score: number; papers: Set<string> }> = {}
    for (const entry of this.listAnnotations(sourcePaperId).filter(row => recordInSchoolScope(row.schoolId, schoolId))) {
      /* 网采/回忆版只进题库不進統計 — stats stay anchored on real evidence. */
      if (entry.status !== 'verified' || entry.answerSource === 'recalled' || entry.answerSource === 'web-public') continue
      const bucket = (stats[entry.knowledgePrimary] ??= { count: 0, score: 0, papers: new Set() })
      bucket.count++
      /* Multi-knowledge questions count once at the primary point. */
      bucket.score += entry.score
      bucket.papers.add(entry.sourcePaperId)
    }
    return Object.fromEntries(Object.entries(stats).map(([key, value]) => [
      key, { count: value.count, score: value.score, papers: value.papers.size },
    ]))
  }

  /* ------------------------------------------------------- blueprints -- */

  /**
   * All stored blueprint rows (built-in templates surface as pending).
   * @returns every blueprint row.
   */
  listBlueprints(): ExamBlueprint[] {
    const stored = [...this.domain.table('blueprints').entries()].map(([, record]) => record)
    /* Built-in templates register on first sight as pending rows. */
    return stored
  }

  /**
   * Verify a structure template: every `basedOn` source paper must itself be
   * verified first — the plan's release gate, enforced here.
   * @param id - the blueprint id.
   * @returns the blueprint now marked `verified`.
   */
  async verifyBlueprint(id: string): Promise<ExamBlueprint> {
    const blueprint = this.domain.table('blueprints').get(id) ?? blueprintById(id)
    if (blueprint === undefined) throw new PaperError(404, 'NOT_FOUND', `blueprint '${id}' not found`)
    const unverified = blueprint.basedOn.filter(sourceId =>
      this.domain.table('source_papers').get(sourceId)?.status !== 'verified')
    if (unverified.length > 0) {
      throw new PaperError(409, 'UNVERIFIED_SOURCES',
        `blueprint '${id}' waits on unverified source papers: ${unverified.join(', ')}`)
    }
    const next: ExamBlueprint = { ...blueprint, status: 'verified' }
    await this.domain.table('blueprints').put(id, next)
    return next
  }

  /**
   * Register an additional structure template (starts `pending`).
   * @param input - the blueprint fields; `status` is service-owned.
   * @returns the stored blueprint row.
   */
  async addBlueprint(input: Omit<ExamBlueprint, 'status'>): Promise<ExamBlueprint> {
    const record: ExamBlueprint = { ...input, status: 'pending' }
    await this.domain.table('blueprints').put(record.id, record)
    return record
  }

  /* ------------------------------------------------------ question bank -- */

  private bankItemById(id: string): BankItem | undefined {
    return this.domain.table('bank_items').get(id)
  }

  /**
   * Store one bank item (ingested draft or teacher-entered). The stem
   * fingerprint is computed here — the wire never supplies it — and a live
   * item with the same fingerprint rejects the write as a duplicate.
   * @param input - the item fields; `id` may pin a stable id, the rest is service-owned.
   * @returns the stored bank item.
   */
  async addBankItem(input: Omit<BankItem, 'status' | 'enteredAt' | 'stemHash' | 'id'> & { id?: string }): Promise<BankItem> {
    const stemHash = stemFingerprint(input.stem)
    const existing = [...this.domain.table('bank_items').entries()]
      .find(([, item]) => item.stemHash === stemHash)
    if (existing !== undefined) {
      throw new PaperError(409, 'DUPLICATE_ITEM',
        `same stem already in bank as '${existing[0]}' (${existing[1].sourceLabel ?? 'no source'})`)
    }
    const record: BankItem = {
      ...input,
      id: input.id ?? `bank-${stemHash.slice(0, 12)}`,
      stemHash,
      status: 'pending',
      enteredAt: now(),
    }
    await this.domain.table('bank_items').put(record.id, record)
    return record
  }

  /**
   * Idempotent ingest write: duplicates are skipped and reported, not thrown.
   * @param drafts - parsed import rows minus the service-owned fields.
   * @returns the created items plus a duplicate report per skipped draft.
   */
  async ingestBankItems(
    drafts: readonly Omit<BankItem, 'id' | 'status' | 'enteredAt' | 'stemHash' | 'verifiedBy'>[],
  ): Promise<{ created: BankItem[]; duplicates: string[] }> {
    const created: BankItem[] = []
    const duplicates: string[] = []
    for (const draft of drafts) {
      const stemHash = stemFingerprint(draft.stem)
      const existing = [...this.domain.table('bank_items').entries()]
        .find(([, item]) => item.stemHash === stemHash)
      if (existing !== undefined) {
        duplicates.push(`${draft.sourceLabel ?? '无来源'} T${draft.stem.slice(0, 12)}… → 已在库 '${existing[0]}'`)
        continue
      }
      const record: BankItem = {
        ...draft,
        id: `bank-${stemHash.slice(0, 12)}-${created.length}`,
        stemHash,
        status: 'pending',
        enteredAt: now(),
      }
      await this.domain.table('bank_items').put(record.id, record)
      created.push(record)
    }
    return { created, duplicates }
  }

  /**
   * List bank items with optional ANDed filters.
   * @param filter - optional `status`, `level`, `kind` filters, all ANDed.
   * @param schoolId - include platform and one school; `null` or absence includes all.
   * @returns the matching bank items in insertion order.
   */
  listBankItems(
    filter?: { status?: ReviewStatus; level?: string; kind?: string },
    schoolId?: string | null,
  ): BankItem[] {
    let all = [...this.domain.table('bank_items').entries()].map(([, item]) => item)
    if (schoolId !== undefined && schoolId !== null) {
      all = all.filter(item => recordInSchoolScope(item.schoolId, schoolId))
    }
    if (filter?.status !== undefined) all = all.filter(item => item.status === filter.status)
    if (filter?.level !== undefined) all = all.filter(item => item.level === filter.level)
    if (filter?.kind !== undefined) all = all.filter(item => item.kind === filter.kind)
    return all
  }

  /**
   * Fetch one bank item or throw.
   * @param id - the bank item id.
   * @returns the item; throws 404 when absent.
   */
  getBankItem(id: string): BankItem {
    const item = this.bankItemById(id)
    if (item === undefined) throw new PaperError(404, 'NOT_FOUND', `bank item '${id}' not found`)
    return item
  }

  /**
   * Teacher edits a pending item — verified rows are frozen evidence.
   * @param id - the bank item id.
   * @param patch - mutable fields; a stem change re-fingerprints and re-checks duplicates.
   * @returns the updated item.
   */
  async updateBankItem(id: string, patch: Partial<Omit<BankItem, 'id' | 'stemHash' | 'status' | 'enteredAt' | 'enteredBy' | 'verifiedBy'>>): Promise<BankItem> {
    const item = this.bankItemById(id)
    if (item === undefined) throw new PaperError(404, 'NOT_FOUND', `bank item '${id}' not found`)
    if (item.status === 'verified') {
      throw new PaperError(409, 'FROZEN', `bank item '${id}' is verified — reject it to change it`)
    }
    const stemHash = patch.stem === undefined ? item.stemHash : stemFingerprint(patch.stem)
    /* A stem edit re-fingerprints; the new hash must not collide with a
       different stored item or the bank silently holds a duplicate. */
    if (stemHash !== item.stemHash) {
      const existing = [...this.domain.table('bank_items').entries()]
        .find(([key, other]) => key !== id && other.stemHash === stemHash)
      if (existing !== undefined) {
        throw new PaperError(409, 'DUPLICATE_ITEM',
          `same stem already in bank as '${existing[0]}' (${existing[1].sourceLabel ?? 'no source'})`)
      }
    }
    const next: BankItem = { ...item, ...patch, stemHash }
    await this.domain.table('bank_items').put(id, next)
    return next
  }

  /**
   * Review a bank item; only `verified` items enter the candidate pool.
   * @param id - the bank item id.
   * @param status - the new review status.
   * @param reviewer - stamped on `verifiedBy` when the status is `verified`.
   * @returns the updated item.
   */
  async reviewBankItem(id: string, status: ReviewStatus, reviewer: string): Promise<BankItem> {
    const item = this.bankItemById(id)
    if (item === undefined) throw new PaperError(404, 'NOT_FOUND', `bank item '${id}' not found`)
    const next: BankItem = {
      ...item, status,
      verifiedBy: status === 'verified' ? reviewer : item.verifiedBy,
    }
    await this.domain.table('bank_items').put(id, next)
    return next
  }

  /**
   * Apply one review verdict to many items.
   *
   * This exists because bulk imports land hundreds of `pending` rows at once
   * (`scripts/ingest-ceval-physics.mjs` brought in 388) while the assembler only
   * ever reads `verified` ones — with per-card review only, imported data is
   * inert, because clicking through hundreds of cards is not a real teacher
   * workflow.
   *
   * It does NOT weaken the gate: the caller still names a reviewer, each row
   * keeps its own `anomalies` for the record, and ids that do not exist are
   * reported back rather than silently skipped. The UI additionally requires an
   * explicit confirmation naming what a batch verdict does and does not attest.
   * @param ids - the bank item ids to review.
   * @param status - the verdict applied to each.
   * @param reviewer - stamped on `verifiedBy` for items that verify.
   * @returns how many rows changed plus the ids that did not exist.
   */
  async reviewBankItems(
    ids: readonly string[], status: ReviewStatus, reviewer: string,
  ): Promise<{ updated: number; missing: string[] }> {
    const missing: string[] = []
    let updated = 0
    for (const id of ids) {
      if (this.bankItemById(id) === undefined) { missing.push(id); continue }
      await this.reviewBankItem(id, status, reviewer)
      updated += 1
    }
    return { updated, missing }
  }

  /**
   * Pick the pending rows an engine triage pass should solve, without touching
   * them. Verification stays a human verdict; triage only annotates.
   * @param input - explicit `ids` narrow the pool (non-pending ids come back in
   *   `skipped`); `limit` caps one run so a review session stays bounded.
   * @param schoolId - include platform and one school; `null` or absence includes all.
   * @returns the rows to solve plus the ids that were requested but not pending.
   */
  planBankTriage(input: { ids?: readonly string[]; limit?: number }, schoolId?: string | null): {
    targets: BankItem[]
    missing: string[]
    skipped: string[]
  } {
    const pending = this.listBankItems({ status: 'pending' })
      .filter(item => recordWritableInScope(item.schoolId, schoolId))
    if (input.ids === undefined) {
      return { targets: pending.slice(0, input.limit ?? pending.length), missing: [], skipped: [] }
    }
    const wanted = new Set(input.ids)
    const targets = pending.filter(item => wanted.has(item.id))
    const missing: string[] = []
    const skipped: string[] = []
    for (const id of wanted) {
      if (targets.some(item => item.id === id)) continue
      const existing = this.bankItemById(id)
      if (existing === undefined || !recordWritableInScope(existing.schoolId, schoolId)) missing.push(id)
      else skipped.push(id)
    }
    return { targets: targets.slice(0, input.limit ?? targets.length), missing, skipped }
  }

  /**
   * Record one engine-triage verdict on a pending item's `anomalies` as a
   * single `engine-check:*` entry — re-running triage replaces, never stacks.
   * The verdict is evidence for the reviewer; it does not change `status`.
   * @param id - the bank item id.
   * @param check - `agreed` when the blind solve matched the recorded answer,
   *   `mismatch` when it produced a different one, `unresolved` when the solve
   *   itself failed or returned nothing comparable.
   * @param detail - the engine's answer on a mismatch, truncated for the row.
   * @returns the updated item.
   */
  async noteBankTriage(id: string, check: 'agreed' | 'mismatch' | 'unresolved', detail?: string): Promise<BankItem> {
    const item = this.bankItemById(id)
    if (item === undefined) throw new PaperError(404, 'NOT_FOUND', `bank item '${id}' not found`)
    if (item.status !== 'pending') {
      throw new PaperError(409, 'REVIEWED', `bank item '${id}' is already ${item.status} — triage annotates pending rows only`)
    }
    const tag = detail === undefined
      ? `engine-check:${check}`
      : `engine-check:${check}(${detail.slice(0, 60)})`
    const next: BankItem = {
      ...item,
      anomalies: [...item.anomalies.filter(a => !a.startsWith('engine-check:')), tag],
    }
    await this.domain.table('bank_items').put(id, next)
    return next
  }

  /**
   * The anti-repeat ledger: every assembled placement writes one row.
   * @param itemId - the placed bank item.
   * @param paperId - the job/paper it landed on.
   * @param mode - how the item was used (e.g. verbatim vs adapted).
   */
  async recordBankUsage(itemId: string, paperId: string, mode: BankUsage['mode']): Promise<void> {
    const usage: BankUsage = { itemId, paperId, usedAt: now(), mode }
    await this.domain.table('bank_usage').put(`${itemId}@${paperId}`, usage)
  }

  /**
   * Recent uses of an item — the assembly engine's freshness window.
   * @param itemId - the bank item id.
   * @param schoolId - include platform and one school; `null` or absence includes all.
   * @returns every usage row for the item.
   */
  bankUsageFor(itemId: string, schoolId?: string | null): BankUsage[] {
    return [...this.domain.table('bank_usage').entries()]
      .map(([, row]) => row)
      .filter((row) => {
        if (row.itemId !== itemId) return false
        if (schoolId === undefined || schoolId === null) return true
        const job = this.domain.table('jobs').get(row.paperId)
        return jobInSchoolScope(job?.schoolId, schoolId)
      })
  }

  /**
   * The assembly plan for one spec table over the current bank. The
   * freshness window counts the N most recent produced papers (approved or
   * exported); spec/draft jobs don't consume freshness.
   * @param specTable - the job's 双向细目表 rows being filled.
   * @param request - the paper request (subjects, level, exclusions).
   * @param policy - the bank-selection policy (freshness window etc.).
   * @param schoolId - include platform and one school; `null` or absence includes all.
   * @returns one plan row per spec row, in spec order.
   */
  bankPlanFor(
    specTable: readonly SpecRow[],
    request: PaperRequest,
    policy: BankSelectionPolicy,
    schoolId?: string | null,
  ): RowPlan[] {
    const recentPaperIds = new Set(
      this.listJobs(undefined, schoolId)
        .filter(job => job.status === 'approved' || job.status === 'exported')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, policy.freshnessPapers)
        .map(job => job.id),
    )
    return planPaper(specTable, request, this.listBankItems({ status: 'verified' }, schoolId), {
      recentPaperIds,
      usageOf: itemId => this.bankUsageFor(itemId, schoolId),
      sourceOf: (id) => {
        const source = this.domain.table('source_papers').get(id)
        return source !== undefined && recordInSchoolScope(source.schoolId, schoolId) ? source : undefined
      },
      policy,
    })
  }

  /**
   * Record the plan the draft ran with — audit trail for 出题依据.
   * @param id - the job id.
   * @param plans - the resolved plan rows from `bankPlanFor`.
   */
  async stampBankPlan(id: string, plans: readonly RowPlan[]): Promise<void> {
    const job = this.requireJob(id)
    await this.domain.table('jobs').put(id, {
      ...job,
      bankPlan: plans.map(plan => ({
        questionNo: plan.row.questionNo,
        mode: plan.mode,
        bankItemId: plan.item?.id,
        candidates: plan.candidates,
      })),
      updatedAt: now(),
    })
  }

  /* ----------------------------------------------------------- the job -- */

  private requireSource(id: string): SourcePaper {
    const source = this.domain.table('source_papers').get(id)
    if (source === undefined) throw new PaperError(404, 'NOT_FOUND', `source '${id}' not found`)
    return source
  }

  private requireJob(id: string): PaperJob {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined) throw new PaperError(404, 'NOT_FOUND', `job '${id}' not found`)
    return job
  }

  private requireVerifiedBlueprint(id: string): ExamBlueprint {
    const blueprint = this.domain.table('blueprints').get(id) ?? blueprintById(id)
    if (blueprint === undefined) throw new PaperError(404, 'NOT_FOUND', `blueprint '${id}' not found`)
    if (blueprint.status !== 'verified') {
      throw new PaperError(409, 'BLUEPRINT_UNVERIFIED',
        `blueprint '${id}' is not verified — verify its source papers first`)
    }
    return blueprint
  }

  /**
   * Verified-annotation knowledge points for spec seeding, ranked by the
   * score weight they carry in verified sources matching the blueprint's
   * level and subject. In-chapter entries lead; `exclude` filters them out.
   * Historical hotspots stay a soft weight — the teacher still confirms.
   */
  private knowledgePoolFor(
    blueprint: ExamBlueprint, request: PaperRequest, schoolId?: string | null,
  ): KnowledgePoolEntry[] {
    const stats = this.annotationStats(undefined, schoolId)
    const seen = new Set<string>()
    const inChapter: KnowledgePoolEntry[] = []
    const rest: KnowledgePoolEntry[] = []
    for (const entry of this.listAnnotations().filter(row => recordInSchoolScope(row.schoolId, schoolId))) {
      if (entry.status !== 'verified' || entry.answerSource === 'recalled' || entry.answerSource === 'web-public') continue
      const source = this.domain.table('source_papers').get(entry.sourcePaperId)
      if (source === undefined || !recordInSchoolScope(source.schoolId, schoolId)
        || source.status !== 'verified' || source.level !== blueprint.level) continue
      if (entry.subject !== blueprint.subject) continue
      if (seen.has(entry.knowledgePrimary)) continue
      if (request.exclude.some(banned =>
        entry.knowledgePrimary.includes(banned) || banned.includes(entry.knowledgePrimary))) continue
      seen.add(entry.knowledgePrimary)
      const pooled: KnowledgePoolEntry = { knowledge: entry.knowledgePrimary, chapter: entry.chapter }
      const chapter = entry.chapter
      const inScope = chapter !== undefined && request.chapters.some(scope =>
        chapter.includes(scope) || scope.includes(chapter))
      ;(inScope ? inChapter : rest).push(pooled)
    }
    const weight = (entry: KnowledgePoolEntry) => stats[entry.knowledge]?.score ?? 0
    inChapter.sort((a, b) => weight(b) - weight(a))
    rest.sort((a, b) => weight(b) - weight(a))
    return [...inChapter, ...rest]
  }

  /**
   * Create a job and propose its 双向细目表 against a verified blueprint.
   * @param input - the request plus the blueprint it draws from.
   * @returns the new job in `spec` status.
   */
  async createJob(input: JobCreateInput): Promise<PaperJob> {
    const blueprint = this.requireVerifiedBlueprint(input.blueprintId)
    if (!recordInSchoolScope(blueprint.schoolId, input.schoolId)) {
      throw new PaperError(404, 'NOT_FOUND', 'not found')
    }
    const job: PaperJob = {
      id: `paper-${createHash('sha256').update(`${input.blueprintId}:${now()}`).digest('hex').slice(0, 12)}`,
      ...input.schoolId === undefined ? {} : { schoolId: input.schoolId },
      blueprintId: input.blueprintId,
      request: input.request,
      specTable: proposeSpecTable(blueprint, input.request, this.knowledgePoolFor(blueprint, input.request, input.schoolId)),
      versions: [],
      reviews: [],
      findings: [],
      solveReport: [],
      repairRounds: 0,
      status: 'spec',
      createdAt: now(),
      updatedAt: now(),
    }
    await this.domain.table('jobs').put(job.id, job)
    return job
  }

  /**
   * Fetch one job or throw.
   * @param id - the job id.
   * @returns the job; throws 404 when absent.
   */
  getJob(id: string): PaperJob {
    return this.requireJob(id)
  }

  /**
   * List jobs, optionally narrowed to one lifecycle stage.
   * @param status - narrow to one stage; absent returns every stage.
   * @param schoolId - narrow to one school and platform jobs; `null` or absence includes all.
   * @returns the matching job rows.
   */
  listJobs(status?: PaperJobStatus, schoolId?: string | null): PaperJob[] {
    let all = [...this.domain.table('jobs').entries()].map(([, record]) => record)
    if (schoolId !== undefined && schoolId !== null) {
      all = all.filter(job => jobInSchoolScope(job.schoolId, schoolId))
    }
    return status === undefined ? all : all.filter(job => job.status === status)
  }

  /**
   * Teacher confirms or edits the spec table; required before drafting.
   * @param id - the job id.
   * @param specTable - the confirmed 双向细目表 rows.
   * @returns the updated job (repair budget reset).
   */
  async confirmSpec(id: string, specTable: readonly SpecRow[]): Promise<PaperJob> {
    const job = this.requireJob(id)
    /* A failed draft goes back through spec so the teacher can retry. */
    if (job.status !== 'spec' && job.status !== 'failed')
      throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not 'spec'`)
    const next: PaperJob = {
      ...job, specTable, status: 'spec', lastError: undefined,
      /* Re-confirming resets the repair budget — the cap binds one confirmed
         spec, not the job's whole lifetime. */
      repairRounds: 0,
      updatedAt: now(),
    }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Commit a drafted document as the next version (voids approval).
   * @param id - the job id.
   * @param document - the paper document being committed.
   * @param summary - one-line change summary for the version row.
   * @param expectedVersion - optimistic concurrency check against `versions.length`.
   * @returns the updated job in `review` status.
   */
  async commitDocument(id: string, document: PaperDocument, summary: string, expectedVersion?: number): Promise<PaperJob> {
    const job = this.requireJob(id)
    if (job.status !== 'drafting' && job.status !== 'review') {
      throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not editable`)
    }
    if (expectedVersion !== undefined && expectedVersion !== job.versions.length) {
      throw new PaperError(409, 'VERSION_CONFLICT',
        `job ${id} is at version ${job.versions.length}, caller assumed ${expectedVersion}`)
    }
    const version: PaperVersion = {
      version: job.versions.length + 1,
      hash: documentHash(document),
      at: now(),
      summary,
    }
    const next: PaperJob = {
      ...job,
      document,
      versions: [...job.versions, version],
      /* Any edit voids the previous approval — it bound an older hash — and
         the check findings describe the superseded document, so they reset
         too; the next /check run repopulates them for this version. */
      approval: undefined,
      findings: [],
      status: 'review',
      updatedAt: now(),
    }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Record auto-check findings and the independent-solve report.
   * @param id - the job id.
   * @param findings - the mechanical-check findings for the current version.
   * @param solve - the per-question solve comparison report.
   * @returns the updated job in `review` status.
   */
  async recordCheckResults(id: string, findings: readonly CheckFinding[], solve: readonly SolveResult[]): Promise<PaperJob> {
    const job = this.requireJob(id)
    if (job.status !== 'checking') {
      throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not checking`)
    }
    const next: PaperJob = {
      ...job,
      findings: [...findings],
      solveReport: [...solve],
      /* Checks always hand the paper to the teacher: `findings` carries the
         severities, so even an error-free run needs a human verdict before
         approval. This was a ternary whose two branches were identical. */
      status: 'review',
      updatedAt: now(),
    }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Teacher verdict on one question of the current version.
   * @param id - the job id.
   * @param questionNo - the question's printed number.
   * @param verdict - `approved` or `changes-requested`.
   * @param reviewer - the reviewing teacher.
   * @param note - optional verdict note stored on the question.
   * @returns the updated job.
   */
  async reviewQuestion(id: string, questionNo: number, verdict: ReviewRecord['verdict'], reviewer: string, note?: string): Promise<PaperJob> {
    const job = this.requireJob(id)
    if (job.status !== 'review') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not review`)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document yet`)
    const current = job.versions.at(-1)
    if (current === undefined) throw new PaperError(409, 'NO_VERSION', `job ${id} has no committed version`)
    const record: ReviewRecord = {
      paperId: id, version: current.version, questionNo, verdict, note, reviewer, at: now(),
    }
    const question = job.document.sections.flatMap(s => s.items).find(q => q.number === questionNo)
    if (question !== undefined) {
      question.status = verdict === 'approved' ? 'approved' : 'rejected'
      if (note !== undefined) question.reviewNote = note
    }
    /* Approving a question is the teacher's adjudication of its judgment-call
       findings — solve/engine mismatches and spec drift the teacher accepts.
       Mechanical facts (score totals, missing answers/knowledge, bad option
       letters, duplicates, numbering) are not adjudicable this way and stay
       until the document changes. */
    const adjudicable = new Set(['solve-mismatch', 'engine-mismatch', 'spec-mismatch'])
    const findings = verdict === 'approved'
      ? job.findings.filter(f =>
        !(f.questionNo === questionNo && adjudicable.has(f.code)))
      : job.findings
    const next: PaperJob = { ...job, reviews: [...job.reviews, record], findings, updatedAt: now() }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Whole-paper approval, bound to the current document hash. Every question
   * must carry an `approved` verdict on this version, and no error finding
   * may be unresolved. Combined papers need both subject halves.
   * @param id - the job id.
   * @param reviewer - the approving teacher.
   * @param subject - which half is being approved on a combined paper.
   * @returns the approved job.
   */
  async approve(id: string, reviewer: string, subject?: 'physics' | 'chemistry'): Promise<PaperJob> {
    const job = this.requireJob(id)
    if (job.status !== 'review') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not review`)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
    const current = job.versions.at(-1)
    if (current === undefined) throw new PaperError(409, 'NO_VERSION', `job ${id} has no version`)

    const errors = job.findings.filter(f => f.severity === 'error')
    if (errors.length > 0) {
      throw new PaperError(409, 'UNRESOLVED_FINDINGS',
        `${errors.length} error findings unresolved: ${errors.map(f => f.code).join(', ')}`)
    }
    const pending = job.document.sections.flatMap(s => s.items).filter(q => q.status !== 'approved')
    if (pending.length > 0) {
      throw new PaperError(409, 'QUESTIONS_UNREVIEWED',
        `questions not approved: ${pending.map(q => q.number).join(', ')}`)
    }

    const prior = job.approval?.versionHash === current.hash ? job.approval : undefined
    const approval: PaperApproval = {
      versionHash: current.hash,
      reviewer,
      at: now(),
      physics: subject === 'physics' ? { reviewer, at: now() } : prior?.physics ?? { reviewer, at: now() },
      chemistry: job.request.subjects.includes('chemistry')
        ? (subject === 'chemistry' ? { reviewer, at: now() } : prior?.chemistry)
        : prior?.chemistry,
    }
    const needsChemistry = job.request.subjects.includes('chemistry')
    if (needsChemistry && approval.chemistry === undefined) {
      await this.domain.table('jobs').put(id, { ...job, approval, updatedAt: now() })
      throw new PaperError(409, 'AWAITING_CHEMISTRY', 'physics half approved; chemistry half pending')
    }
    const next: PaperJob = { ...job, approval, status: 'approved', updatedAt: now() }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Export gate: the approval must bind the CURRENT document hash, or the
   * export refuses — this is the server-side check the plan demands.
   * @param id - the job id.
   * @returns the approved document for rendering.
   */
  requireApprovedDocument(id: string): { job: PaperJob; document: PaperDocument } {
    const job = this.requireJob(id)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
    const current = job.versions.at(-1)
    const hash = current === undefined ? undefined : documentHash(job.document)
    if (job.approval === undefined || job.approval.versionHash !== current?.hash || hash !== job.approval.versionHash) {
      throw new PaperError(409, 'NOT_APPROVED', `job ${id} has no approval bound to the current version`)
    }
    return { job, document: job.document }
  }

  /**
   * Run the mechanical checks against the job's current document. When a
   * freshness window is given, provenance checks also fire: stamped source
   * items resolve against the bank and verbatim reuse on recent papers is
   * flagged — the job's own just-recorded usage never self-flags.
   * @param id - the job.
   * @param recentWindow - papers back that count as "recent" for bank-reuse.
   * @returns findings in document order.
   */
  runJobChecks(id: string, recentWindow = 0): CheckFinding[] {
    const job = this.requireJob(id)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
    const recentPaperIds = new Set(
      this.listJobs(undefined, job.schoolId)
        .filter(other => other.id !== id && (other.status === 'approved' || other.status === 'exported'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, recentWindow)
        .map(other => other.id),
    )
    return runChecks(job.document, job.request, {
      itemOf: (itemId) => {
        const item = this.domain.table('bank_items').get(itemId)
        return item !== undefined && recordInSchoolScope(item.schoolId, job.schoolId) ? item : undefined
      },
      usedRecently: itemId => this.bankUsageFor(itemId, job.schoolId).some(u => recentPaperIds.has(u.paperId)),
    })
  }

  /**
   * Move a job into an async stage; clears a prior failure.
   * @param id - the job id.
   * @param status - the stage being entered.
   */
  async markStage(id: string, status: 'drafting' | 'checking'): Promise<void> {
    const job = this.requireJob(id)
    const allowed = status === 'drafting'
      ? ['spec', 'review', 'failed']
      : ['checking', 'review', 'failed']
    if (!allowed.includes(job.status)) {
      throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not ready for ${status}`)
    }
    await this.domain.table('jobs').put(id, { ...job, status, lastError: undefined, updatedAt: now() })
  }

  /**
   * Mark a job failed with its error — the async drivers' terminal state.
   * @param id - the job id.
   * @param message - the failure text stored on `lastError`.
   */
  async failJob(id: string, message: string): Promise<void> {
    const job = this.requireJob(id)
    if (job.status !== 'drafting' && job.status !== 'checking') {
      throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not running`)
    }
    await this.domain.table('jobs').put(id, { ...job, status: 'failed', lastError: message, updatedAt: now() })
  }

  /**
   * Bump the repair-round counter; beyond 2 the job stays a draft.
   * @param id - the job id.
   * @returns the new round count.
   */
  async spendRepairRound(id: string): Promise<number> {
    const job = this.requireJob(id)
    const rounds = job.repairRounds + 1
    await this.domain.table('jobs').put(id, { ...job, repairRounds: rounds, updatedAt: now() })
    return rounds
  }

  /**
   * Record a produced export bundle.
   * @param id - the job id; must carry a current-version approval.
   * @param files - produced file names by kind.
   */
  async recordExport(id: string, files: { paperPdf?: string; paperDocx?: string; answerPdf?: string; answerDocx?: string }): Promise<void> {
    const { job } = this.requireApprovedDocument(id)
    const current = job.versions.at(-1)
    if (current === undefined) {
      throw new PaperError(409, 'NO_VERSION', `试卷 ${id} 没有任何已提交版本`)
    }
    await this.domain.table('exports').put(`${id}@${current.version}`, {
      paperId: id, version: current.version, hash: current.hash, files, exportedAt: now(),
    })
    await this.domain.table('jobs').put(id, { ...job, status: 'exported', updatedAt: now() })
  }

  /**
   * List recorded export bundles, optionally narrowed to one job.
   * @param paperId - narrow to one job's bundles; absent returns all exports.
   * @returns the export bundles.
   */
  listExports(paperId?: string): ExportBundle[] {
    const all = [...this.domain.table('exports').entries()].map(([, record]) => record)
    return paperId === undefined ? all : all.filter(bundle => bundle.paperId === paperId)
  }
}
