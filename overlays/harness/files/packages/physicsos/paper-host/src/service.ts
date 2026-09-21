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
  type ExamBlueprint, type KnowledgeAnnotation, type KnowledgePoolEntry,
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

/** Inputs for a paper job: the request plus the blueprint it draws from. */
export interface JobCreateInput {
  readonly request: PaperRequest
  readonly blueprintId: string
}

/**
 * The paper workflow service. Holds the open domain; callers go through
 * methods, never the tables, so the invariants live exactly once.
 */
export class PaperService {
  constructor(private readonly domain: PaperDomain) {}

  /* ----------------------------------------------------- source intake -- */

  /** Register a real exam paper on file (starts `pending`). */
  async addSource(input: Omit<SourcePaper, 'status' | 'enteredAt'>): Promise<SourcePaper> {
    if (this.domain.table('source_papers').get(input.id) !== undefined) {
      throw new PaperError(409, 'DUPLICATE_SOURCE', `source '${input.id}' already exists`)
    }
    const record: SourcePaper = { ...input, status: 'pending', enteredAt: now() }
    await this.domain.table('source_papers').put(record.id, record)
    return record
  }

  listSources(): SourcePaper[] {
    return [...this.domain.table('source_papers').entries()].map(([, record]) => record)
  }

  /** Add one per-question annotation to a source paper. */
  async addAnnotation(input: Omit<KnowledgeAnnotation, 'status'>): Promise<KnowledgeAnnotation> {
    const source = this.domain.table('source_papers').get(input.sourcePaperId)
    if (source === undefined) {
      throw new PaperError(404, 'SOURCE_NOT_FOUND', `source '${input.sourcePaperId}' not found`)
    }
    const record: KnowledgeAnnotation = { ...input, status: 'pending' }
    await this.domain.table('annotations').put(record.id, record)
    return record
  }

  listAnnotations(sourcePaperId?: string): KnowledgeAnnotation[] {
    const all = [...this.domain.table('annotations').entries()].map(([, record]) => record)
    return sourcePaperId === undefined
      ? all
      : all.filter(entry => entry.sourcePaperId === sourcePaperId)
  }

  /** Flip a record's review status; stats/templates only count `verified`. */
  async reviewSource(id: string, status: ReviewStatus, reviewer: string): Promise<SourcePaper> {
    const source = this.requireSource(id)
    const next: SourcePaper = { ...source, status }
    await this.domain.table('source_papers').put(id, next)
    void reviewer
    return next
  }

  async reviewAnnotation(id: string, status: ReviewStatus): Promise<KnowledgeAnnotation> {
    const record = this.domain.table('annotations').get(id)
    if (record === undefined) throw new PaperError(404, 'NOT_FOUND', `annotation '${id}' not found`)
    const next = { ...record, status }
    await this.domain.table('annotations').put(id, next)
    return next
  }

  /** Knowledge-point statistics over VERIFIED annotations only. */
  annotationStats(sourcePaperId?: string): Record<string, { count: number; score: number; papers: number }> {
    const stats: Record<string, { count: number; score: number; papers: Set<string> }> = {}
    for (const entry of this.listAnnotations(sourcePaperId)) {
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

  listBlueprints(): ExamBlueprint[] {
    const stored = [...this.domain.table('blueprints').entries()].map(([, record]) => record)
    /* Built-in templates register on first sight as pending rows. */
    return stored
  }

  /**
   * Verify a structure template: every `basedOn` source paper must itself be
   * verified first — the plan's release gate, enforced here.
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

  /** Register an additional structure template (starts `pending`). */
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

  /** Idempotent ingest write: duplicates are skipped and reported, not thrown. */
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

  listBankItems(filter?: { status?: ReviewStatus; level?: string; kind?: string }): BankItem[] {
    let all = [...this.domain.table('bank_items').entries()].map(([, item]) => item)
    if (filter?.status !== undefined) all = all.filter(item => item.status === filter.status)
    if (filter?.level !== undefined) all = all.filter(item => item.level === filter.level)
    if (filter?.kind !== undefined) all = all.filter(item => item.kind === filter.kind)
    return all
  }

  getBankItem(id: string): BankItem {
    const item = this.bankItemById(id)
    if (item === undefined) throw new PaperError(404, 'NOT_FOUND', `bank item '${id}' not found`)
    return item
  }

  /** Teacher edits a pending item — verified rows are frozen evidence. */
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

  /** Review a bank item; only `verified` items enter the candidate pool. */
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

  /** The anti-repeat ledger: every assembled placement writes one row. */
  async recordBankUsage(itemId: string, paperId: string, mode: BankUsage['mode']): Promise<void> {
    const usage: BankUsage = { itemId, paperId, usedAt: now(), mode }
    await this.domain.table('bank_usage').put(`${itemId}@${paperId}`, usage)
  }

  /** Recent uses of an item — the assembly engine's freshness window. */
  bankUsageFor(itemId: string): BankUsage[] {
    return [...this.domain.table('bank_usage').entries()]
      .map(([, row]) => row)
      .filter(row => row.itemId === itemId)
  }

  /**
   * The assembly plan for one spec table over the current bank. The
   * freshness window counts the N most recent produced papers (approved or
   * exported); spec/draft jobs don't consume freshness.
   */
  bankPlanFor(
    specTable: readonly SpecRow[],
    request: PaperRequest,
    policy: BankSelectionPolicy,
  ): RowPlan[] {
    const recentPaperIds = new Set(
      this.listJobs()
        .filter(job => job.status === 'approved' || job.status === 'exported')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, policy.freshnessPapers)
        .map(job => job.id),
    )
    return planPaper(specTable, request, this.listBankItems({ status: 'verified' }), {
      recentPaperIds,
      usageOf: itemId => this.bankUsageFor(itemId),
      sourceOf: id => this.domain.table('source_papers').get(id),
      policy,
    })
  }

  /** Record the plan the draft ran with — audit trail for 出题依据. */
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
  private knowledgePoolFor(blueprint: ExamBlueprint, request: PaperRequest): KnowledgePoolEntry[] {
    const stats = this.annotationStats()
    const seen = new Set<string>()
    const inChapter: KnowledgePoolEntry[] = []
    const rest: KnowledgePoolEntry[] = []
    for (const entry of this.listAnnotations()) {
      if (entry.status !== 'verified' || entry.answerSource === 'recalled' || entry.answerSource === 'web-public') continue
      const source = this.domain.table('source_papers').get(entry.sourcePaperId)
      if (source === undefined || source.status !== 'verified' || source.level !== blueprint.level) continue
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

  /** Create a job and propose its 双向细目表 against a verified blueprint. */
  async createJob(input: JobCreateInput): Promise<PaperJob> {
    const blueprint = this.requireVerifiedBlueprint(input.blueprintId)
    const job: PaperJob = {
      id: `paper-${createHash('sha256').update(`${input.blueprintId}:${now()}`).digest('hex').slice(0, 12)}`,
      blueprintId: input.blueprintId,
      request: input.request,
      specTable: proposeSpecTable(blueprint, input.request, this.knowledgePoolFor(blueprint, input.request)),
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

  getJob(id: string): PaperJob {
    return this.requireJob(id)
  }

  listJobs(status?: PaperJobStatus): PaperJob[] {
    const all = [...this.domain.table('jobs').entries()].map(([, record]) => record)
    return status === undefined ? all : all.filter(job => job.status === status)
  }

  /** Teacher confirms or edits the spec table; required before drafting. */
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

  /** Commit a drafted document as the next version (voids approval). */
  async commitDocument(id: string, document: PaperDocument, summary: string, expectedVersion?: number): Promise<PaperJob> {
    const job = this.requireJob(id)
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

  /** Record auto-check findings and the independent-solve report. */
  async recordCheckResults(id: string, findings: readonly CheckFinding[], solve: readonly SolveResult[]): Promise<PaperJob> {
    const job = this.requireJob(id)
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

  /** Teacher verdict on one question of the current version. */
  async reviewQuestion(id: string, questionNo: number, verdict: ReviewRecord['verdict'], reviewer: string, note?: string): Promise<PaperJob> {
    const job = this.requireJob(id)
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
   */
  async approve(id: string, reviewer: string, subject?: 'physics' | 'chemistry'): Promise<PaperJob> {
    const job = this.requireJob(id)
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
      this.listJobs()
        .filter(other => other.id !== id && (other.status === 'approved' || other.status === 'exported'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, recentWindow)
        .map(other => other.id),
    )
    return runChecks(job.document, job.request, {
      itemOf: itemId => this.domain.table('bank_items').get(itemId),
      usedRecently: itemId => this.bankUsageFor(itemId).some(u => recentPaperIds.has(u.paperId)),
    })
  }

  /** Move a job into an async stage; clears a prior failure. */
  async markStage(id: string, status: 'drafting' | 'checking'): Promise<void> {
    const job = this.requireJob(id)
    await this.domain.table('jobs').put(id, { ...job, status, lastError: undefined, updatedAt: now() })
  }

  /** Mark a job failed with its error — the async drivers' terminal state. */
  async failJob(id: string, message: string): Promise<void> {
    const job = this.requireJob(id)
    await this.domain.table('jobs').put(id, { ...job, status: 'failed', lastError: message, updatedAt: now() })
  }

  /** Bump the repair-round counter; beyond 2 the job stays a draft. */
  async spendRepairRound(id: string): Promise<number> {
    const job = this.requireJob(id)
    const rounds = job.repairRounds + 1
    await this.domain.table('jobs').put(id, { ...job, repairRounds: rounds, updatedAt: now() })
    return rounds
  }

  /** Record a produced export bundle. */
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

  listExports(paperId?: string) {
    const all = [...this.domain.table('exports').entries()].map(([, record]) => record)
    return paperId === undefined ? all : all.filter(bundle => bundle.paperId === paperId)
  }
}
