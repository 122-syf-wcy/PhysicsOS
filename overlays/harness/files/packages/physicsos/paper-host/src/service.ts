/**
 * PaperService — the 出卷 workflow's business core over the durable domain.
 *
 * Every rule in the plan lands at the operation that enforces it: source
 * records stay `pending` until reviewed; blueprints enter `verified` only
 * behind verified source papers; editing a document mints a new version and
 * voids approval; export refuses anything whose approval hash does not match
 * the current document hash.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  EXAM_BLUEPRINTS, blueprintById, documentHash, planPaper, proposePaperPlan, sectionNotesForSpec,
  summarizeSpecTable, runChecks, stemFingerprint,
  type BankItem, type BankSelectionPolicy, type BankUsage, type CheckFinding,
  type ExamBlueprint, type ExportBundle, type KnowledgeAnnotation, type KnowledgePoolEntry,
  type PaperDocument, type PaperJobStatus,
  type PaperRequest, type ReviewRecord, type ReviewStatus,
  type RowPlan, type SourcePaper, type SpecRow,
} from '@physicsos/question-paper'
import type { PaperDomain } from './domain.ts'
import type { ExportFileSet } from './export.ts'
import {
  ANALYSIS_FINDING_PREFIX, checkReportHash, currentChecks, fenceMatches, findingHash,
  invalidateDocument, latestQuestionReview, needsAnalysisReview, operationFence,
  questionCheckHash, questionContentHash, unresolvedFindings, workflowHash,
  type BoundSolveResult, type CheckedFigureAsset, type ManagedPaperJob,
  type PaperOperationFence, type PaperOperationKind,
} from './workflow-state.ts'

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

// Domains expose process-local snapshots. Serialize creation across every service
// sharing that snapshot, including writes whose durable put has not settled yet.
const creationQueues = new WeakMap<PaperDomain, Promise<unknown>>()

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

  private async createExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = creationQueues.get(this.domain) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(operation)
    creationQueues.set(this.domain, pending)
    try { return await pending } finally {
      if (creationQueues.get(this.domain) === pending) creationQueues.delete(this.domain)
    }
  }

  /** All job decisions run at the table's queue slot, never on a stale read. */
  private updateJob(id: string, change: (job: ManagedPaperJob) => ManagedPaperJob): Promise<ManagedPaperJob> {
    this.requireJob(id)
    return this.domain.table('jobs').update(id, (job) => {
      const next = change(job)
      if (next === job) return job
      return { ...next, rowVersion: (job.rowVersion ?? 0) + 1, updatedAt: now() }
    })
  }

  private requireFence(job: ManagedPaperJob, fence?: PaperOperationFence): void {
    if (fence !== undefined && !fenceMatches(job, fence)) {
      throw new PaperError(409, 'STALE_OPERATION', '本次操作已过期，结果未覆盖当前试卷')
    }
    if (fence === undefined && job.operation?.state === 'running') {
      throw new PaperError(409, 'JOB_RUNNING', '该试卷正在处理，请等待当前操作完成')
    }
  }

  private requireExpectedVersion(job: ManagedPaperJob, expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== job.versions.length) {
      throw new PaperError(409, 'VERSION_CONFLICT',
        `job ${job.id} is at version ${job.versions.length}, caller assumed ${expectedVersion}`)
    }
  }

  /* ----------------------------------------------------- source intake -- */

  /**
   * Register a real exam paper on file (starts `pending`).
   * @param input - the paper metadata; `status`/`enteredAt` are service-owned.
   * @returns the stored source row.
   */
  async addSource(input: Omit<SourcePaper, 'status' | 'enteredAt'>): Promise<SourcePaper> {
    return this.createExclusive(async () => {
      if (this.domain.table('source_papers').get(input.id) !== undefined) {
        throw new PaperError(409, 'DUPLICATE_SOURCE', `source '${input.id}' already exists`)
      }
      const record: SourcePaper = { ...input, status: 'pending', enteredAt: now() }
      await this.domain.table('source_papers').put(record.id, record)
      return record
    })
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
    return this.createExclusive(async () => {
      if (this.domain.table('annotations').get(input.id) !== undefined) throw new PaperError(409, 'DUPLICATE_ANNOTATION', 'annotation already exists')
      const source = this.domain.table('source_papers').get(input.sourcePaperId)
      if (source === undefined) {
        throw new PaperError(404, 'SOURCE_NOT_FOUND', `source '${input.sourcePaperId}' not found`)
      }
      const record: KnowledgeAnnotation = { ...input, status: 'pending' }
      await this.domain.table('annotations').put(record.id, record)
      return record
    })
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
    this.requireSource(id)
    void reviewer
    return this.domain.table('source_papers').update(id, source => ({ ...source, status }))
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
    return this.domain.table('annotations').update(id, current => ({ ...current, status }))
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
    /* A built-in template has no row until someone verifies it; list it as
       pending until then so the admin can verify it from the console. Once
       verified, the stored row replaces it. */
    const storedIds = new Set(stored.map(row => row.id))
    return [...stored, ...EXAM_BLUEPRINTS.filter(row => !storedIds.has(row.id))]
  }

  /**
   * Verify a structure template: every `basedOn` source paper must itself be
   * verified first — the plan's release gate, enforced here.
   * @param id - the blueprint id.
   * @returns the blueprint now marked `verified`.
   */
  async verifyBlueprint(id: string): Promise<ExamBlueprint> {
    return this.createExclusive(async () => {
      if (this.domain.table('blueprints').get(id) === undefined) {
        const builtin = blueprintById(id)
        if (builtin === undefined) throw new PaperError(404, 'NOT_FOUND', `blueprint '${id}' not found`)
        await this.domain.table('blueprints').put(id, builtin)
      }
      return this.domain.table('blueprints').update(id, (blueprint) => {
        const unverified = blueprint.basedOn.filter(sourceId =>
          this.domain.table('source_papers').get(sourceId)?.status !== 'verified')
        if (unverified.length > 0) throw new PaperError(409, 'UNVERIFIED_SOURCES',
          `blueprint '${id}' waits on unverified source papers: ${unverified.join(', ')}`)
        return { ...blueprint, status: 'verified' }
      })
    })
  }

  /**
   * Register an additional structure template (starts `pending`).
   * @param input - the blueprint fields; `status` is service-owned.
   * @returns the stored blueprint row.
   */
  async addBlueprint(input: Omit<ExamBlueprint, 'status'>): Promise<ExamBlueprint> {
    return this.createExclusive(async () => {
      if (this.domain.table('blueprints').get(input.id) !== undefined || blueprintById(input.id) !== undefined) throw new PaperError(409, 'DUPLICATE_BLUEPRINT', 'blueprint already exists')
      const record: ExamBlueprint = { ...input, status: 'pending' }
      await this.domain.table('blueprints').put(record.id, record)
      return record
    })
  }

  /* ------------------------------------------------------ question bank -- */

  private bankItemById(id: string): BankItem | undefined {
    return this.domain.table('bank_items').get(id)
  }

  private bankIdFor(stemHash: string, schoolId?: string | null): string {
    const scope = schoolId == null ? 'platform' : createHash('sha256').update(schoolId).digest('hex').slice(0, 12)
    let id = `bank-${scope}-${stemHash.slice(0, 12)}`
    while (this.bankItemById(id) !== undefined) id = `bank-${scope}-${stemHash.slice(0, 12)}-${randomUUID()}`
    return id
  }

  /**
   * Store one bank item (ingested draft or teacher-entered). The stem
   * fingerprint is computed here — the wire never supplies it — and a live
   * item with the same fingerprint rejects the write as a duplicate.
   * @param input - the item fields; `id` may pin a stable id, the rest is service-owned.
   * @returns the stored bank item.
   */
  async addBankItem(input: Omit<BankItem, 'status' | 'enteredAt' | 'stemHash' | 'id'> & { id?: string }): Promise<BankItem> {
    return this.createExclusive(async () => {
      const stemHash = stemFingerprint(input.stem)
      const existing = [...this.domain.table('bank_items').entries()]
        .find(([, item]) => item.stemHash === stemHash && recordInSchoolScope(item.schoolId, input.schoolId))
      if (existing !== undefined) {
        throw new PaperError(409, 'DUPLICATE_ITEM',
          `same stem already in bank as '${existing[0]}' (${existing[1].sourceLabel ?? 'no source'})`)
      }
      const record: BankItem = {
        ...input,
        id: input.id ?? this.bankIdFor(stemHash, input.schoolId),
        stemHash,
        status: 'pending',
        enteredAt: now(),
      }
      if (this.domain.table('bank_items').get(record.id) !== undefined) throw new PaperError(409, 'DUPLICATE_ITEM', 'bank item already exists')
      await this.domain.table('bank_items').put(record.id, record)
      return record
    })
  }

  /**
   * Idempotent ingest write: duplicates are skipped and reported, not thrown.
   * @param drafts - parsed import rows minus the service-owned fields.
   * @returns the created items plus a duplicate report per skipped draft.
   */
  async ingestBankItems(
    drafts: readonly Omit<BankItem, 'id' | 'status' | 'enteredAt' | 'stemHash' | 'verifiedBy'>[],
  ): Promise<{ created: BankItem[]; duplicates: string[] }> {
    return this.createExclusive(async () => {
      const created: BankItem[] = []
      const duplicates: string[] = []
      for (const draft of drafts) {
        const stemHash = stemFingerprint(draft.stem)
        const existing = [...this.domain.table('bank_items').entries()]
          .find(([, item]) => item.stemHash === stemHash && recordInSchoolScope(item.schoolId, draft.schoolId))
        if (existing !== undefined) {
          duplicates.push(`${draft.sourceLabel ?? '无来源'} T${draft.stem.slice(0, 12)}… → 已在库 '${existing[0]}'`)
          continue
        }
        const record: BankItem = {
          ...draft,
          id: this.bankIdFor(stemHash, draft.schoolId),
          stemHash,
          status: 'pending',
          enteredAt: now(),
        }
        if (this.domain.table('bank_items').get(record.id) !== undefined) { duplicates.push(record.id); continue }
        await this.domain.table('bank_items').put(record.id, record)
        created.push(record)
      }
      return { created, duplicates }
    })
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
    return this.createExclusive(async () => {
      this.getBankItem(id)
      return this.domain.table('bank_items').update(id, (item) => {
        if (item.status === 'verified') throw new PaperError(409, 'FROZEN',
          `bank item '${id}' is verified — reject it to change it`)
        const stemHash = patch.stem === undefined ? item.stemHash : stemFingerprint(patch.stem)
        const existing = [...this.domain.table('bank_items').entries()].find(([key, other]) =>
          key !== id && other.stemHash === stemHash && recordInSchoolScope(other.schoolId, item.schoolId))
        if (existing !== undefined) throw new PaperError(409, 'DUPLICATE_ITEM',
          `same stem already in bank as '${existing[0]}' (${existing[1].sourceLabel ?? 'no source'})`)
        return { ...item, ...patch, stemHash }
      })
    })
  }

  /**
   * Review a bank item; only `verified` items enter the candidate pool.
   * @param id - the bank item id.
   * @param status - the new review status.
   * @param reviewer - stamped on `verifiedBy` when the status is `verified`.
   * @returns the updated item.
   */
  async reviewBankItem(id: string, status: ReviewStatus, reviewer: string): Promise<BankItem> {
    this.getBankItem(id)
    return this.domain.table('bank_items').update(id, item => ({
      ...item, status, verifiedBy: status === 'verified' ? reviewer : item.verifiedBy,
    }))
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
  async noteBankTriage(id: string, check: 'agreed' | 'mismatch' | 'unresolved', detail?: string,
    expectedContentHash?: string): Promise<BankItem> {
    this.getBankItem(id)
    return this.domain.table('bank_items').update(id, (item) => {
      if (item.status !== 'pending') throw new PaperError(409, 'REVIEWED',
        `bank item '${id}' is already ${item.status} — triage annotates pending rows only`)
      if (expectedContentHash !== undefined && this.bankContentHash(item) !== expectedContentHash) {
        throw new PaperError(409, 'STALE_OPERATION', '题目已修改，本次初筛结果未写入')
      }
      const tag = detail === undefined ? `engine-check:${check}` : `engine-check:${check}(${detail.slice(0, 60)})`
      return { ...item, anomalies: [...item.anomalies.filter(a => !a.startsWith('engine-check:')), tag] }
    })
  }

  bankContentHash(item: BankItem): string {
    return workflowHash({ stem: item.stem, options: item.options, subQuestions: item.subQuestions,
      figure: item.figure, answer: item.answer, subject: item.subject, kind: item.kind })
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
    // The planner only asks whether an item appeared in this scoped recent
    // set. Index that part of the ledger once instead of scanning it for
    // every candidate in both reuse modes of every question.
    const recentUsageByItem = new Map<string, BankUsage[]>()
    if (specTable.length > 0 && recentPaperIds.size > 0) {
      for (const [, usage] of this.domain.table('bank_usage').entries()) {
        if (!recentPaperIds.has(usage.paperId)) continue
        const existing = recentUsageByItem.get(usage.itemId)
        if (existing === undefined) recentUsageByItem.set(usage.itemId, [usage])
        else existing.push(usage)
      }
    }
    return planPaper(specTable, request, this.listBankItems({ status: 'verified' }, schoolId), {
      recentPaperIds,
      usageOf: itemId => recentUsageByItem.get(itemId) ?? [],
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
  async stampBankPlan(id: string, plans: readonly RowPlan[], fence?: PaperOperationFence): Promise<void> {
    await this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      return { ...job, bankPlan: plans.map(plan => ({
        questionNo: plan.row.questionNo, mode: plan.mode,
        bankItemId: plan.item?.id, candidates: plan.candidates,
      })) }
    })
  }

  /** Each validated batch is durable, so a bounded explicit retry keeps finished work. */
  async checkpointDraft(id: string, title: string, items: readonly import('@physicsos/question-paper').PaperQuestion[],
    fence: PaperOperationFence): Promise<void> {
    await this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      const sections = [...(job.draftCheckpoint?.specHash === fence.specHash ? job.draftCheckpoint.sections : [])]
      const index = sections.findIndex(section => section.title === title)
      const section = { title, items: [...items] }
      if (index < 0) sections.push(section); else sections[index] = section
      return { ...job, draftCheckpoint: { specHash: fence.specHash, sections } }
    })
  }

  async checkpointQuestion(id: string, checkpoint: NonNullable<ManagedPaperJob['questionCheckpoint']>,
    fence: PaperOperationFence): Promise<void> {
    await this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      return { ...job, questionCheckpoint: structuredClone(checkpoint) }
    })
  }

  /* ----------------------------------------------------------- the job -- */

  private requireSource(id: string): SourcePaper {
    const source = this.domain.table('source_papers').get(id)
    if (source === undefined) throw new PaperError(404, 'NOT_FOUND', `source '${id}' not found`)
    return source
  }

  private requireJob(id: string): ManagedPaperJob {
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
  planJob(input: JobCreateInput): ReturnType<typeof proposePaperPlan> {
    const blueprint = this.requireVerifiedBlueprint(input.blueprintId)
    if (!recordInSchoolScope(blueprint.schoolId, input.schoolId)) throw new PaperError(404, 'NOT_FOUND', 'not found')
    return proposePaperPlan(blueprint, input.request, this.knowledgePoolFor(blueprint, input.request, input.schoolId))
  }

  async createJob(input: JobCreateInput): Promise<ManagedPaperJob> {
    const plan = this.planJob(input)
    const blueprint = this.requireVerifiedBlueprint(input.blueprintId)
    const at = now()
    const job: ManagedPaperJob = {
      id: `paper-${randomUUID()}`,
      ...input.schoolId === undefined ? {} : { schoolId: input.schoolId },
      blueprintId: input.blueprintId,
      selectedBlueprint: structuredClone(blueprint),
      request: plan.request,
      specTable: plan.specTable,
      planSummary: { requestedTotalScore: plan.requestedTotalScore, totalScore: plan.totalScore,
        questionCount: plan.questionCount, scorePolicy: plan.scorePolicy, normalized: plan.normalized,
        sections: plan.sections, unassignedQuestionNos: plan.scope.unassignedQuestionNos },
      versions: [], reviews: [], findings: [], solveReport: [], repairRounds: 0,
      rowVersion: 0, status: 'spec', createdAt: at, updatedAt: at,
    }
    await this.domain.table('jobs').put(job.id, job)
    return job
  }

  /** Use the selected stored template, not only a built-in id lookup. */
  blueprintForJob(job: ManagedPaperJob): ExamBlueprint | undefined {
    const blueprint = job.selectedBlueprint ?? this.domain.table('blueprints').get(job.blueprintId) ?? blueprintById(job.blueprintId)
    return blueprint !== undefined && recordInSchoolScope(blueprint.schoolId, job.schoolId) ? blueprint : undefined
  }

  /**
   * Fetch one job or throw.
   * @param id - the job id.
   * @returns the job; throws 404 when absent.
   */
  getJob(id: string): ManagedPaperJob {
    return this.requireJob(id)
  }

  /**
   * List jobs, optionally narrowed to one lifecycle stage.
   * @param status - narrow to one stage; absent returns every stage.
   * @param schoolId - narrow to one school and platform jobs; `null` or absence includes all.
   * @returns the matching job rows.
   */
  listJobs(status?: PaperJobStatus, schoolId?: string | null): ManagedPaperJob[] {
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
  async confirmSpec(id: string, specTable: readonly SpecRow[], expectedVersion?: number): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job)
      this.requireExpectedVersion(job, expectedVersion)
      if (job.status !== 'spec' && job.status !== 'failed') throw new PaperError(409, 'BAD_STATE',
        `job ${id} is '${job.status}', not 'spec'`)
      const totalScore = specTable.reduce((sum, row) => sum + row.score, 0)
      const request = { ...job.request, totalScore }
      const summary = summarizeSpecTable(specTable, request)
      if (summary.findings.some(finding => finding.severity === 'error')) throw new PaperError(409, 'SPEC_INVALID',
        summary.findings.map(finding => finding.detail).join('；'))
      const unchanged = workflowHash(job.specTable) === workflowHash(specTable)
      const blueprint = this.blueprintForJob(job)
      const sections = (blueprint === undefined ? [] : sectionNotesForSpec(blueprint, specTable)).map(section => {
        const rows = specTable.filter(row => row.sectionTitle === section.title)
        return { ...section, questionCount: rows.length, totalScore: rows.reduce((sum, row) => sum + row.score, 0) }
      })
      const requestedTotalScore = job.planSummary?.requestedTotalScore ?? job.request.totalScore
      return { ...job, request, specTable: structuredClone([...specTable]), status: 'spec', lastError: undefined,
        approval: undefined, checkBinding: unchanged ? job.checkBinding : undefined,
        findings: unchanged ? job.findings : [], solveReport: unchanged ? job.solveReport : [],
        draftCheckpoint: unchanged ? job.draftCheckpoint : undefined,
        repairRounds: unchanged ? job.repairRounds : 0,
        planSummary: { requestedTotalScore, totalScore, questionCount: specTable.length,
          scorePolicy: 'blueprint-slot-sum', normalized: requestedTotalScore !== totalScore,
          sections, unassignedQuestionNos: [] } }
    })
  }

  /**
   * Commit a drafted document as the next version (voids approval).
   * @param id - the job id.
   * @param document - the paper document being committed.
   * @param summary - one-line change summary for the version row.
   * @param expectedVersion - optimistic concurrency check against `versions.length`.
   * @returns the updated job in `review` status.
   */
  async commitDocument(id: string, document: PaperDocument, summary: string, expectedVersion?: number,
    fence?: PaperOperationFence): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      this.requireExpectedVersion(job, expectedVersion)
      if (job.status !== 'drafting' && job.status !== 'review' && !(fence !== undefined && job.status === 'checking')
        && job.status !== 'failed') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not editable`)
      if (document.id !== id) throw new PaperError(400, 'DOCUMENT_ID_MISMATCH', 'document must belong to this job')
      const nextDocument = invalidateDocument(job, structuredClone(document))
      const hashes = new Map(nextDocument.sections.flatMap(section => section.items)
        .map(question => [question.number, questionContentHash(question)]))
      const at = now()
      return { ...job, document: nextDocument,
        versions: [...job.versions, { version: job.versions.length + 1, hash: documentHash(nextDocument), at, summary }],
        approval: undefined, checkBinding: undefined, findings: [],
        solveReport: job.solveReport.filter(result => result.questionHash !== undefined
          && hashes.get(result.questionNo) === result.questionHash),
        answerCorrections: job.answerCorrections?.filter(correction => hashes.get(correction.questionNo) === correction.questionHash),
        figureAssets: job.figureAssets?.filter(asset => hashes.get(asset.questionNo) === asset.questionHash),
        draftCheckpoint: undefined, questionCheckpoint: undefined,
        status: fence === undefined ? 'review' : 'checking',
        operation: fence === undefined || job.operation === undefined ? job.operation
          : { ...job.operation, phase: 'check', updatedAt: at },
        lastError: undefined,
      }
    })
  }

  /**
   * Record auto-check findings and the independent-solve report.
   * @param id - the job id.
   * @param findings - the mechanical-check findings for the current version.
   * @param solve - the per-question solve comparison report.
   * @returns the updated job in `review` status.
   */
  async recordCheckResults(id: string, findings: readonly CheckFinding[], solve: readonly BoundSolveResult[],
    fence?: PaperOperationFence, assets: readonly CheckedFigureAsset[] = []): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      if (job.status !== 'checking') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not checking`)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
      const document = job.document
      const questions = document.sections.flatMap(section => section.items)
      const version = job.versions.at(-1)
      const hash = documentHash(document)
      if (version === undefined || version.hash !== hash) throw new PaperError(409, 'VERSION_CONFLICT', '当前文档与版本记录不一致')
      const numbers = new Set(questions.map(question => question.number))
      if (numbers.size !== questions.length || questions.length === 0 || solve.length !== questions.length
        || questions.some(question => solve.filter(result => result.questionNo === question.number).length !== 1)) {
        throw new PaperError(409, 'CHECK_COVERAGE', '独立检查必须覆盖当前卷每一道且仅一道题')
      }
      const results = solve.map((result) => {
        const question = questions.find(item => item.number === result.questionNo)
        if (question === undefined) throw new PaperError(409, 'CHECK_COVERAGE', '检查报告含不存在的题号')
        const questionHash = questionContentHash(question)
        if (result.questionHash !== undefined && result.questionHash !== questionHash) throw new PaperError(409, 'STALE_OPERATION', '解题结果属于旧题目')
        return { ...result, questionHash }
      })
      for (const question of questions) {
        if (question.figure !== undefined && !assets.some(asset => asset.questionNo === question.number
          && asset.questionHash === questionContentHash(question) && asset.sha256 !== '')) {
          throw new PaperError(409, 'FIGURES_UNCHECKED', `第${question.number}题题图尚未验证，可仅重试检查`)
        }
      }
      const analysisFindings: CheckFinding[] = questions.filter(question => needsAnalysisReview(job, question)).map(question => ({
        questionNo: question.number, code: 'engine-mismatch', severity: 'error',
        detail: `${ANALYSIS_FINDING_PREFIX}。请人工核对原解析、评分点及等价答案，不会自动编造步骤。`,
      }))
      const combined = [...findings, ...analysisFindings].filter((finding, index, all) =>
        all.findIndex(other => findingHash(other) === findingHash(finding)) === index)
      const at = now()
      const binding = { documentHash: hash, version: version.version, requestHash: workflowHash(job.request),
        specHash: workflowHash(job.specTable), reportHash: checkReportHash(document, job.request, job.specTable, combined, results, assets),
        questionHashes: Object.fromEntries(questions.map(question => [String(question.number), questionContentHash(question)])),
        questionReports: Object.fromEntries(questions.map(question => [String(question.number), questionCheckHash(question, combined, results, assets)])),
        completedAt: at }
      const checked: ManagedPaperJob = { ...job, findings: combined, solveReport: results,
        figureAssets: [...assets], checkBinding: binding, approval: undefined, status: 'review',
        operation: job.operation?.state === 'running' ? { ...job.operation, state: 'completed', updatedAt: at } : job.operation,
        lastError: undefined, progress: { stage: 'review', done: questions.length, total: questions.length,
          detail: '检查已完成，请逐题审核', updatedAt: at } }
      return { ...checked, document: { ...document, sections: document.sections.map(section => ({ ...section,
        items: section.items.map(question => {
          const review = latestQuestionReview(checked, question, binding)
          return { ...question, status: review?.verdict === 'approved' ? 'approved' as const
            : review?.verdict === 'changes-requested' ? 'rejected' as const : 'checked' as const,
          reviewNote: review?.note }
        }),
      })) } }
    })
  }

  /**
   * Replace the document with the engine-corrected answers as a new version,
   * inside the checking stage. The engine's number is what the paper carries,
   * and minting a version keeps the approval hash bound to the reviewed
   * content instead of silently editing the drafted one in place.
   * @param id - the job id.
   * @param document - the document carrying the engine's verified answers.
   * @returns the updated job, still in `checking`.
   */
  async commitEngineAnswers(id: string, document: PaperDocument, fence?: PaperOperationFence): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      if (job.status !== 'checking') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not checking`)
      const at = now()
      const corrected = invalidateDocument(job, structuredClone(document))
      const previous = new Map(job.document?.sections.flatMap(section => section.items).map(question => [question.number, question]) ?? [])
      const changes = corrected.sections.flatMap(section => section.items).filter(question =>
        previous.get(question.number)?.answer?.result !== question.answer?.result).map(question => ({
        questionNo: question.number, questionHash: questionContentHash(question),
        originalResult: previous.get(question.number)?.answer?.result ?? '', engineResult: question.answer?.result ?? '', at,
      }))
      const hashes = new Map(corrected.sections.flatMap(section => section.items).map(question => [question.number, questionContentHash(question)]))
      return { ...job, document: corrected,
        versions: [...job.versions, { version: job.versions.length + 1, hash: documentHash(corrected), at,
          summary: '引擎定案：答案取自 PhysicsOS 引擎，解析与评分点需重新复核' }],
        approval: undefined, checkBinding: undefined, findings: [],
        solveReport: job.solveReport.filter(result => result.questionHash !== undefined && hashes.get(result.questionNo) === result.questionHash),
        answerCorrections: [...(job.answerCorrections ?? []).filter(correction =>
          hashes.get(correction.questionNo) === correction.questionHash && !changes.some(change => change.questionNo === correction.questionNo)), ...changes],
        figureAssets: job.figureAssets?.filter(asset => hashes.get(asset.questionNo) === asset.questionHash),
      }
    })
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
  async reviewQuestion(id: string, questionNo: number, verdict: ReviewRecord['verdict'], reviewer: string, note?: string,
    expected?: { version?: number; questionHash?: string; checkHash?: string; acknowledgeFindings?: boolean; analysisConfirmed?: boolean }): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job)
      this.requireExpectedVersion(job, expected?.version)
      if (job.status !== 'review') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not review`)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document yet`)
      const question = job.document.sections.flatMap(section => section.items).find(item => item.number === questionNo)
      if (question === undefined) throw new PaperError(404, 'NO_QUESTION', `job ${id} has no question ${questionNo}`)
      const binding = currentChecks(job)
      if (binding === undefined) throw new PaperError(409, 'CHECKS_REQUIRED', '请先对当前版本完成自动检查，审核不能引用旧报告')
      const questionHash = questionContentHash(question)
      const checkHash = binding.questionReports[String(questionNo)]
      if (expected?.questionHash !== undefined && expected.questionHash !== questionHash
        || expected?.checkHash !== undefined && expected.checkHash !== checkHash) {
        throw new PaperError(409, 'VERSION_CONFLICT', '题目或检查报告已更新，请刷新后审核')
      }
      const blocking = job.findings.filter(finding => finding.questionNo === questionNo && finding.severity === 'error')
      const structural = blocking.filter(finding => finding.code !== 'solve-mismatch' && finding.code !== 'engine-mismatch')
      if (verdict === 'approved' && structural.length > 0) throw new PaperError(409, 'UNRESOLVED_FINDINGS',
        `第${questionNo}题仍有不可豁免的结构/范围错误：${structural.map(finding => finding.detail).join('；')}`)
      if (verdict === 'approved' && blocking.length > 0 && (!expected?.acknowledgeFindings || !note?.trim())) {
        throw new PaperError(409, 'REVIEW_REASON_REQUIRED', '请明确确认检查分歧并填写人工裁定理由；不会删除检查证据')
      }
      if (verdict === 'approved' && needsAnalysisReview(job, question) && expected?.analysisConfirmed !== true) {
        throw new PaperError(409, 'ANALYSIS_REVIEW_REQUIRED', '引擎已改答案，须核对解析、评分点及等价答案后再确认')
      }
      const record = { paperId: id, version: binding.version, documentHash: binding.documentHash,
        questionNo, questionHash, checkHash, verdict, note: note?.trim() || undefined, reviewer, at: now(),
        acknowledgedFindings: expected?.acknowledgeFindings ? blocking.map(findingHash) : [],
        analysisConfirmed: expected?.analysisConfirmed === true }
      return { ...job, approval: undefined, reviews: [...job.reviews, record],
        document: { ...job.document, sections: job.document.sections.map(section => ({ ...section,
          items: section.items.map(item => item.number === questionNo ? { ...item,
            status: verdict === 'approved' ? 'approved' as const : 'rejected' as const,
            reviewNote: record.note } : item),
        })) } }
    })
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
  async approve(id: string, reviewer: string, subject?: 'physics' | 'chemistry',
    expected?: { version?: number; documentHash?: string; checkHash?: string }): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job)
      this.requireExpectedVersion(job, expected?.version)
      if (job.status !== 'review') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not review`)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
      const binding = currentChecks(job)
      if (binding === undefined) throw new PaperError(409, 'CHECKS_REQUIRED', '整卷批准需要完整且绑定当前内容的检查报告')
      if (expected?.documentHash !== undefined && expected.documentHash !== binding.documentHash
        || expected?.checkHash !== undefined && expected.checkHash !== binding.reportHash) throw new PaperError(409, 'VERSION_CONFLICT', '文档或检查报告已更新，请刷新后批准')
      const questions = job.document.sections.flatMap(section => section.items)
      const subjects = [...new Set(job.request.subjects)]
      if (questions.some(question => !subjects.includes(question.subject))
        || subjects.some(required => !questions.some(question => question.subject === required))) {
        throw new PaperError(409, 'SUBJECT_COVERAGE', '试卷题目必须覆盖并且只覆盖请求的学科')
      }
      const half = subject ?? (subjects.length === 1 ? subjects[0] : undefined)
      if (half === undefined || !subjects.includes(half)) throw new PaperError(400, 'BAD_SUBJECT', '请明确签署本卷包含的学科')
      const errors = unresolvedFindings(job, binding)
      if (errors.length > 0) throw new PaperError(409, 'UNRESOLVED_FINDINGS',
        `${errors.length} error findings unresolved: ${errors.map(finding => finding.code).join(', ')}`)
      const pending = questions.filter(question => question.status !== 'approved'
        || latestQuestionReview(job, question, binding)?.verdict !== 'approved')
      if (pending.length > 0) throw new PaperError(409, 'QUESTIONS_UNREVIEWED',
        `questions not approved against current checks: ${pending.map(question => question.number).join(', ')}`)
      const prior = job.approval?.versionHash === binding.documentHash && job.approval.checkHash === binding.reportHash
        ? job.approval : undefined
      const at = now()
      const approval: NonNullable<ManagedPaperJob['approval']> = { versionHash: binding.documentHash,
        checkHash: binding.reportHash, reviewer, at,
        physics: half === 'physics' ? { reviewer, at } : prior?.physics,
        chemistry: half === 'chemistry' ? { reviewer, at } : prior?.chemistry }
      const complete = subjects.every(required => approval[required] !== undefined)
      return { ...job, approval, status: complete ? 'approved' : 'review' }
    })
  }

  /**
   * Export gate: the approval must bind the CURRENT document hash, or the
   * export refuses — this is the server-side check the plan demands.
   * @param id - the job id.
   * @returns the approved document for rendering.
   */
  requireApprovedDocument(id: string): { job: ManagedPaperJob; document: PaperDocument } {
    const job = this.requireJob(id)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
    const current = job.versions.at(-1)
    const hash = current === undefined ? undefined : documentHash(job.document)
    if (job.approval === undefined || job.approval.versionHash !== current?.hash || hash !== job.approval.versionHash) {
      throw new PaperError(409, 'NOT_APPROVED', `job ${id} has no approval bound to the current version`)
    }
    if (job.status !== 'approved' && job.status !== 'exported') throw new PaperError(409, 'NOT_APPROVED', '试卷尚未完成当前学科签署')
    /* Historical finalized rows retain the existing hash-bound export contract.
       Do not invent a report for them; new approvals always carry checkHash. */
    if (job.approval.checkHash !== undefined) {
      const checks = currentChecks(job)
      if (checks === undefined || checks.reportHash !== job.approval.checkHash || unresolvedFindings(job, checks).length > 0
        || job.request.subjects.some(subject => job.approval?.[subject] === undefined)) {
        throw new PaperError(409, 'NOT_APPROVED', '当前检查或学科签署已失效')
      }
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
  async markStage(id: string, status: 'drafting' | 'checking', fence?: PaperOperationFence): Promise<void> {
    await this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      const allowed = status === 'drafting' ? ['spec', 'review', 'failed'] : ['review', 'failed']
      if (!(fence !== undefined && job.status === 'checking') && !allowed.includes(job.status)) {
        throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not ready for ${status}`)
      }
      return { ...job, status, lastError: undefined, approval: undefined }
    })
  }

  /** Reserve work before answering 202. All entry points share this single-flight gate. */
  async beginOperation(id: string, kind: PaperOperationKind,
    input: { questionNo?: number; suggestion?: string; reviewer?: string; expectedVersion?: number; resume?: boolean } = {}): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job)
      this.requireExpectedVersion(job, input.expectedVersion)
      if (job.status === 'drafting' || job.status === 'checking' || job.status === 'approved' || job.status === 'exported') {
        throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not ready for ${kind}`)
      }
      if (kind === 'draft') {
        const checked = summarizeSpecTable(job.specTable, job.request)
        if (checked.findings.length > 0) throw new PaperError(409, 'SPEC_INVALID', checked.findings.map(finding => finding.detail).join('；'))
      } else if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${id} has no document`)
      if (kind === 'repair' || kind === 'replace') {
        if (!Number.isSafeInteger(input.questionNo) || (input.questionNo ?? 0) <= 0) throw new PaperError(400, 'BAD_QUESTION', '题号必须是正整数')
        if (!job.document?.sections.some(section => section.items.some(question => question.number === input.questionNo))) {
          throw new PaperError(404, 'NO_QUESTION', `job ${id} has no question ${input.questionNo}`)
        }
        if (!job.specTable.some(row => row.questionNo === input.questionNo)) throw new PaperError(404, 'NO_SPEC_ROW', '未找到对应细目表题号')
        if (kind === 'repair' && !input.suggestion?.trim()) throw new PaperError(400, 'BAD_REQUEST', 'repair needs a suggestion')
      }
      if (input.resume && (job.status !== 'failed' || job.operation?.state !== 'failed')) throw new PaperError(409, 'NOT_RETRYABLE', '没有已失败阶段可重试')
      const at = now()
      const recovery = kind === 'check' || input.resume ? job.recovery : job.document === undefined ? undefined
        : { document: structuredClone(job.document), hash: documentHash(job.document), at }
      return { ...job, operation: { id: randomUUID(), kind, phase: kind, state: 'running',
        questionNo: input.questionNo, suggestion: input.suggestion?.trim(), reviewer: input.reviewer,
        startedAt: at, updatedAt: at },
        status: kind === 'draft' ? 'drafting' : 'checking', lastError: undefined, approval: undefined,
        checkBinding: kind === 'check' ? undefined : job.checkBinding,
        recovery, draftCheckpoint: kind === 'draft' && !input.resume ? undefined : job.draftCheckpoint,
        questionCheckpoint: input.resume ? job.questionCheckpoint : undefined,
        repairRounds: kind === 'draft' && !input.resume ? 0 : job.repairRounds,
        progress: { stage: kind, done: 0, total: 1, detail: kind === 'repair' ? `修订第${input.questionNo}题`
          : kind === 'replace' ? `更换第${input.questionNo}题` : kind === 'check' ? '仅重新检查当前稿，不重新起草' : '准备起草', updatedAt: at },
      }
    })
  }

  async operationPhase(id: string, phase: 'check' | 'figure', fence: PaperOperationFence): Promise<ManagedPaperJob> {
    return this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      if (job.operation === undefined) throw new PaperError(409, 'STALE_OPERATION', 'operation missing')
      return { ...job, status: 'checking', operation: { ...job.operation, phase, updatedAt: now() } }
    })
  }

  retryableOperation(id: string): { kind: PaperOperationKind; questionNo?: number; suggestion?: string; reviewer?: string } {
    const job = this.requireJob(id)
    if (job.status !== 'failed' || job.operation?.state !== 'failed') throw new PaperError(409, 'NOT_RETRYABLE', '没有已失败阶段可重试')
    const { phase, kind, questionNo, suggestion, reviewer } = job.operation
    return { kind: phase === 'check' || phase === 'figure' ? 'check' : kind, questionNo, suggestion, reviewer }
  }

  /** A service restart settles abandoned work; it never replays paid generation. */
  async settleInterrupted(): Promise<void> {
    for (const [id, candidate] of this.domain.table('jobs').entries()) {
      if (candidate.status !== 'drafting' && candidate.status !== 'checking' && candidate.operation?.state !== 'running') continue
      await this.updateJob(id, (job) => {
        if (job.status !== 'drafting' && job.status !== 'checking' && job.operation?.state !== 'running') return job
        const at = now()
        return { ...job, status: 'failed', lastError: '服务重启中断了当前阶段；原稿和已完成批次已保留，可仅重试检查或显式重试失败阶段，不会自动重新生成',
          operation: job.operation === undefined ? undefined : { ...job.operation, state: 'failed', updatedAt: at } }
      })
    }
  }

  async restoreDraft(id: string, expectedVersion?: number): Promise<ManagedPaperJob> {
    const job = this.requireJob(id)
    if (job.status !== 'failed') throw new PaperError(409, 'BAD_STATE', '只有已失败任务可恢复原稿')
    if (job.recovery === undefined) throw new PaperError(409, 'NO_RECOVERY', '本任务没有更改前原稿')
    return this.commitDocument(id, job.recovery.document, '恢复更改前原稿（需重新检查）', expectedVersion ?? job.versions.length)
  }

  /**
   * Mark a job failed with its error — the async drivers' terminal state.
   * @param id - the job id.
   * @param message - the failure text stored on `lastError`.
   */
  async failJob(id: string, message: string, fence?: PaperOperationFence): Promise<void> {
    await this.updateJob(id, (job) => {
      /* Failure/progress may settle after a content edit or restart: only their
         operation id matters, and never lets an old worker fail a newer run. */
      if (fence !== undefined && (job.operation?.id !== fence.operationId || job.operation.state !== 'running')) return job
      this.requireFence(job, fence === undefined ? undefined : operationFence(job))
      if (job.status !== 'drafting' && job.status !== 'checking') throw new PaperError(409, 'BAD_STATE', `job ${id} is '${job.status}', not running`)
      const at = now()
      return { ...job, status: 'failed', lastError: message,
        operation: job.operation === undefined ? undefined : { ...job.operation, state: 'failed', updatedAt: at },
        progress: { stage: job.operation?.phase ?? job.progress?.stage ?? 'check', detail: message,
          done: job.progress?.done ?? 0, total: job.progress?.total ?? 1, updatedAt: at } }
    })
  }

  /**
   * Publish live driver telemetry onto the job row so the workspace can show
   * WHAT the pipeline is doing (planning, drafting section i/n, solving
   * question k/m, drawing figure j/m) instead of a bare stage label. Best
   * effort by design: a put failure must never fail the pipeline itself.
   * @param id - the job id.
   * @param stage - machine phase (plan | draft | adapt | assemble | check | solve | figure | export).
   * @param done - completed steps within the phase.
   * @param total - total steps in the phase.
   * @param detail - one human line describing the current step.
   */
  async reportProgress(
    id: string,
    stage: string,
    done: number,
    total: number,
    detail?: string,
    fence?: PaperOperationFence,
  ): Promise<void> {
    try {
      await this.updateJob(id, (job) => {
        if (fence !== undefined && (!fenceMatches(job, fence)
          || job.operation?.phase === 'figure' && stage !== 'figure')) return job
        if (fence === undefined && job.operation?.state === 'running') return job
        if (fence === undefined && !['approved', 'exported', 'drafting', 'checking'].includes(job.status)) return job
        return { ...job, progress: { stage, ...(detail === undefined ? {} : { detail }),
          done, total, updatedAt: now() } }
      })
    } catch {
      /* telemetry only — the driver keeps going */
    }
  }

  /**
   * Bump the repair-round counter; beyond 2 the job stays a draft.
   * @param id - the job id.
   * @returns the new round count.
   */
  async spendRepairRound(id: string, fence?: PaperOperationFence): Promise<number> {
    const updated = await this.updateJob(id, (job) => {
      this.requireFence(job, fence)
      return { ...job, repairRounds: job.repairRounds + 1 }
    })
    return updated.repairRounds
  }

  /**
   * Record a produced export bundle.
   * @param id - the job id; must carry a current-version approval.
   * @param files - produced file names by kind.
   */
  async recordExport(id: string, produced: ExportFileSet): Promise<void> {
    const { job } = this.requireApprovedDocument(id)
    const current = job.versions.at(-1)
    if (current === undefined) throw new PaperError(409, 'NO_VERSION', `试卷 ${id} 没有任何已提交版本`)
    if (produced.documentHash !== current.hash || produced.manifest.documentHash !== current.hash
      || produced.manifest.paperId !== id || produced.manifest.contentHash !== produced.contentHash
      || !/^[0-9a-f]{64}$/.test(produced.contentHash)) throw new PaperError(409, 'STALE_EXPORT', '导出产物或清单不属于当前文档，未标为定稿')
    const files = { paperPdf: produced.paperPdf, paperDocx: produced.paperDocx,
      answerPdf: produced.answerPdf, answerDocx: produced.answerDocx }
    await this.domain.table('exports').put(`${id}@${current.version}@${produced.contentHash}`, {
      paperId: id, version: current.version, hash: current.hash, files, exportedAt: now(),
      contentHash: produced.contentHash, manifestPath: produced.manifestPath, manifest: produced.manifest,
    } as ExportBundle)
    await this.updateJob(id, (latest) => {
      if (latest.versions.at(-1)?.hash !== current.hash || latest.approval?.versionHash !== current.hash
        || latest.document === undefined || documentHash(latest.document) !== current.hash
        || latest.operation?.state === 'running') throw new PaperError(409, 'STALE_EXPORT', '试卷已更新，旧产物保留但未覆盖新状态')
      return { ...latest, status: 'exported' }
    })
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
