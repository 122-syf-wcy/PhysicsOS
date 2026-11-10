/** Durable draft → engine-check relay. Restart recovery never replays a paid model or image operation. */
import { createHash } from 'node:crypto'
import { documentHash } from '@physicsos/question-paper'
import type { PaperDomain, PaperPipelineStage } from './domain.ts'
import { PaperError, type PaperService } from './service.ts'

export interface PaperPipelineDrivers {
  readonly draft: (jobId: string) => Promise<void>
  readonly check: (jobId: string, allowPaidEffects: boolean) => Promise<void>
}
export interface PaperStageAcceptance { readonly status: string; readonly replayed: boolean }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const now = (): string => new Date().toISOString()

export class PaperPipeline {
  private readonly admissions = new Map<string, Promise<void>>()
  private readonly active = new Map<string, { kind: PaperPipelineStage['kind']; promise: Promise<void> }>()
  private closing = false
  constructor(private readonly domain: PaperDomain, private readonly service: PaperService, private readonly drivers: PaperPipelineDrivers) {}
  private get stages() { return this.domain.table('pipeline_stages') }

  private admit<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new PaperError(503, 'CLOSING', 'Paper pipeline is closing'))
    const result = (this.admissions.get(jobId) ?? Promise.resolve()).then(() => {
      if (this.closing) throw new PaperError(503, 'CLOSING', 'Paper pipeline is closing')
      return operation()
    })
    const settled = result.then(() => {}, () => {})
    this.admissions.set(jobId, settled)
    void settled.then(() => { if (this.admissions.get(jobId) === settled) this.admissions.delete(jobId) })
    return result
  }
  private contentHash(jobId: string): string | undefined {
    const document = this.service.getJob(jobId).document
    return document === undefined ? undefined : documentHash(document)
  }
  private start(jobId: string, kind: PaperPipelineStage['kind'], operation: () => Promise<void>): void {
    const promise = Promise.resolve().then(operation)
    this.active.set(jobId, { kind, promise })
    // The durable stage and job carry errors; every detached promise is contained.
    void promise.catch(() => {}).finally(() => { if (this.active.get(jobId)?.promise === promise) this.active.delete(jobId) })
  }
  private async finish(stage: PaperPipelineStage, status: 'succeeded' | 'failed' | 'interrupted', errorCode?: string): Promise<void> {
    await this.stages.put(stage.id, { ...stage, status, finishedAt: now(), outputHash: this.contentHash(stage.jobId), ...(errorCode === undefined ? {} : { errorCode }) })
  }
  private running(jobId: string, kind: PaperPipelineStage['kind'], inputHash: string, id = `${kind}:${jobId}:${inputHash}`): PaperPipelineStage {
    return { id, jobId, kind, inputHash, baseVersion: this.service.getJob(jobId).versions.length, status: 'running', startedAt: now() }
  }

  /** Admission is durable before HTTP 202. Repeated webpage check calls attach to the same job. */
  enqueueDraft(jobId: string): Promise<PaperStageAcceptance> {
    return this.admit(jobId, async () => {
      const job = this.service.getJob(jobId)
      if (this.active.has(jobId)) return { status: job.status, replayed: true }
      const previous = [...this.stages.entries()].map(([, row]) => row).filter(row => row.jobId === jobId && row.kind === 'draft')
      if (job.status !== 'spec') {
        if (job.document !== undefined && previous.some(row => row.status === 'succeeded')) return { status: job.status, replayed: true }
        throw new PaperError(409, 'SPEC_UNCONFIRMED', 'Confirm the spec table before a new paid draft')
      }
      if (job.specTable.length === 0) throw new PaperError(409, 'SPEC_UNCONFIRMED', 'Confirm a nonempty spec table before drafting')
      const key = hash([job.blueprintId, job.specTable, job.request, job.updatedAt])
      const stage = this.running(jobId, 'draft', key)
      const retained = this.stages.get(stage.id)
      if (retained !== undefined) throw new PaperError(409, 'DRAFT_CONFIRMATION_REQUIRED', 'This paid draft was already attempted; confirm the spec again to authorize another attempt')
      await this.stages.put(stage.id, stage)
      this.start(jobId, 'draft', async () => {
        try {
          await this.drivers.draft(jobId)
          await this.finish(stage, 'succeeded')
        } catch (error) {
          await this.finish(stage, 'failed', 'DRAFT_FAILED')
          throw error
        }
        await this.executeCheck(jobId, true)
      })
      return { status: 'drafting', replayed: false }
    })
  }

  enqueueCheck(jobId: string): Promise<PaperStageAcceptance> {
    return this.admit(jobId, async () => {
      const job = this.service.getJob(jobId)
      const active = this.active.get(jobId)
      if (active !== undefined) {
        if (active.kind !== 'check' && active.kind !== 'draft') throw new PaperError(409, 'STAGE_BUSY', 'A question revision is still running')
        return { status: job.status, replayed: true }
      }
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', 'No committed document to check')
      if (job.checkedVersionHash === documentHash(job.document) && ['review', 'approved', 'exported'].includes(job.status)) return { status: job.status, replayed: true }
      if (job.status === 'drafting' || job.status === 'spec') throw new PaperError(409, 'BAD_STATE', 'Drafting must finish before checks')
      const stage = this.running(jobId, 'check', documentHash(job.document))
      await this.stages.put(stage.id, stage)
      this.start(jobId, 'check', () => this.executeCheck(jobId, true, stage))
      return { status: 'checking', replayed: false }
    })
  }

  private async executeCheck(jobId: string, allowPaidEffects: boolean, claimed?: PaperPipelineStage): Promise<void> {
    const job = this.service.getJob(jobId)
    if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', 'No committed document to check')
    const inputHash = documentHash(job.document)
    if (job.checkedVersionHash === inputHash && ['review', 'approved', 'exported'].includes(job.status)) {
      if (claimed !== undefined) await this.finish(claimed, 'succeeded')
      return
    }
    const stage = claimed ?? this.running(jobId, 'check', inputHash)
    if (claimed === undefined) await this.stages.put(stage.id, stage)
    try {
      await this.drivers.check(jobId, allowPaidEffects)
      await this.finish(stage, 'succeeded')
    } catch (error) {
      await this.finish(stage, 'failed', 'CHECK_FAILED')
      throw error
    }
  }

  /** A persisted image claim is at-most-once, including timeout, crash and lost-response ambiguity. */
  async figuresOnce(jobId: string, operation: () => Promise<void>): Promise<boolean> {
    const inputHash = this.contentHash(jobId)
    if (inputHash === undefined) throw new PaperError(409, 'NO_DOCUMENT', 'No document for figures')
    const stage = this.running(jobId, 'figures', inputHash)
    if (this.stages.get(stage.id) !== undefined) return false
    await this.stages.put(stage.id, stage)
    try { await operation(); await this.finish(stage, 'succeeded') }
    catch (error) { await this.finish(stage, 'failed', 'FIGURES_FAILED'); throw error }
    return true
  }

  /** Explicit teacher repairs/replacements are serialized with checks and are never replayed on boot. */
  enqueueMutation(jobId: string, kind: 'repair' | 'replace', requestKey: string, operation: () => Promise<void>): Promise<PaperStageAcceptance> {
    return this.admit(jobId, async () => {
      if (this.active.has(jobId)) throw new PaperError(409, 'STAGE_BUSY', 'A paper stage is already running')
      const job = this.service.getJob(jobId)
      if (job.status !== 'review' || job.document === undefined) throw new PaperError(409, 'BAD_STATE', 'Paper must be in review before editing questions')
      const stage = this.running(jobId, kind, documentHash(job.document), `${kind}:${jobId}:${hash(requestKey)}`)
      const prior = this.stages.get(stage.id)
      if (prior !== undefined) {
        if (prior.status === 'succeeded') return { status: job.status, replayed: true }
        throw new PaperError(409, 'PAID_CONFIRMATION_REQUIRED', 'This paid operation is not safely repeatable; use a new explicit request id after reviewing its outcome')
      }
      await this.stages.put(stage.id, stage)
      this.start(jobId, kind, async () => {
        try { await operation(); await this.finish(stage, 'succeeded') }
        catch (error) { await this.finish(stage, 'failed', 'REVISION_FAILED'); throw error }
      })
      return { status: kind === 'repair' ? 'repairing' : 'replacing', replayed: false }
    })
  }

  /** Resume committed engine work only; paid drafts without a durable document require teacher confirmation. */
  async recover(): Promise<void> {
    for (const [, stage] of this.stages.entries()) {
      if (stage.status === 'running' && (stage.kind === 'figures' || stage.kind === 'repair' || stage.kind === 'replace')) await this.finish(stage, 'interrupted', 'PAID_OUTCOME_UNKNOWN')
    }
    for (const job of this.service.listJobs()) {
      const stages = [...this.stages.entries()].map(([, row]) => row).filter(row => row.jobId === job.id)
      const draft = stages.find(row => row.kind === 'draft' && row.status === 'running')
      if (draft !== undefined) {
        if (job.document !== undefined && job.versions.length > draft.baseVersion) await this.finish(draft, 'succeeded')
        else {
          await this.finish(draft, 'interrupted', 'PAID_CONFIRMATION_REQUIRED')
          if (job.status === 'drafting' || job.status === 'checking') await this.service.failJob(job.id, '服务重启中断了付费起草；请重新确认细目表后重试，未自动重复调用。')
          continue
        }
      } else if (job.status === 'drafting') {
        await this.service.failJob(job.id, '服务重启中断了起草；请重新确认细目表，未自动重复付费调用。')
        continue
      }
      const current = this.service.getJob(job.id)
      if (current.document === undefined) continue
      const currentHash = documentHash(current.document)
      const checking = stages.find(row => row.kind === 'check' && row.status === 'running')
      if (current.checkedVersionHash === currentHash && ['review', 'approved', 'exported'].includes(current.status)) {
        if (checking !== undefined) await this.finish(checking, 'succeeded')
        continue
      }
      const relay = draft !== undefined || current.status === 'checking' || checking !== undefined || stages.some(row => row.kind === 'draft' && row.status === 'succeeded' && row.outputHash === currentHash)
      if (!relay || !['review', 'checking', 'failed'].includes(current.status)) continue
      const resumed = checking ?? this.running(job.id, 'check', currentHash)
      await this.stages.put(resumed.id, { ...resumed, status: 'running' })
      this.start(job.id, 'check', () => this.executeCheck(job.id, false, resumed))
    }
  }

  async drain(): Promise<void> { await Promise.allSettled([...this.active.values()].map(value => value.promise)) }
  async dispose(): Promise<void> {
    this.closing = true
    await Promise.all([...this.admissions.values()])
    await this.drain()
  }
}
