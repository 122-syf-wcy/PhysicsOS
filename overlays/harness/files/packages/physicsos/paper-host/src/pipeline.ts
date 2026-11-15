/** Bounded server-owned continuation. HTTP/page lifetime never owns checks. */
import type { PaperService } from './service.ts'
import { PaperError } from './service.ts'
import { operationFence, type ManagedPaperJob, type PaperOperationFence,
  type PaperOperationKind } from './workflow-state.ts'

export interface PaperPipelineDrivers {
  readonly draft: (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob) => Promise<PaperOperationFence>
  readonly check: (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob) => Promise<void>
  readonly repair: (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob) => Promise<PaperOperationFence>
  readonly replace: (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob) => Promise<PaperOperationFence>
}

export interface AcceptedPaperOperation {
  readonly job: ManagedPaperJob
  readonly completion: Promise<void>
}

export class PaperPipeline {
  private readonly running = new Map<string, Promise<void>>()
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>()
  private closed = false

  constructor(private readonly service: PaperService, private readonly drivers: PaperPipelineDrivers,
    private readonly onFailure: (jobId: string, code: string) => void = () => undefined,
    private readonly operationTimeoutMs = 45 * 60_000) {}

  /** Durable reservation and state validation finish before callers answer 202. */
  async start(jobId: string, kind: PaperOperationKind,
    input: { questionNo?: number; suggestion?: string; reviewer?: string; expectedVersion?: number; resume?: boolean } = {}): Promise<AcceptedPaperOperation> {
    if (this.closed) throw new PaperError(503, 'PIPELINE_STOPPED', '服务正在停止，当前阶段未启动')
    const job = await this.service.beginOperation(jobId, kind, input)
    let fence = operationFence(job)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { reject(new PaperError(504, 'STAGE_TIMEOUT',
        '当前操作超时，已停止接续并保留原稿；可明确重试当前阶段，不会自动重放生成')) }, this.operationTimeoutMs)
    })
    if (timeout !== undefined) this.deadlines.set(jobId, timeout)
    const work = Promise.resolve().then(async () => {
      try {
        if (this.closed) throw new PaperError(503, 'PIPELINE_STOPPED', '服务停止中断了本次操作，可显式重试')
        if (kind === 'draft') fence = await this.drivers.draft(jobId, fence, job)
        else if (kind === 'repair') fence = await this.drivers.repair(jobId, fence, job)
        else if (kind === 'replace') fence = await this.drivers.replace(jobId, fence, job)
        if (this.closed) throw new PaperError(503, 'PIPELINE_STOPPED', '原稿已保留，可仅重试检查')
        const checking = await this.service.operationPhase(jobId, 'check', fence)
        fence = operationFence(checking)
        await this.drivers.check(jobId, fence, checking)
      } catch (error) {
        const code = error instanceof PaperError ? error.code : 'STAGE_FAILED'
        /* Never log private prompts/stems, or silently lose a rejected stage. */
        this.onFailure(jobId, code)
        const detail = error instanceof PaperError ? error.message : '当前阶段未完成，原稿已保留；可显式重试失败阶段或仅重试检查'
        await this.service.failJob(jobId, detail, fence)
      }
    })
    const completion = Promise.race([work, deadline]).catch(async (error: unknown) => {
      this.onFailure(jobId, error instanceof PaperError ? error.code : 'STAGE_FAILED')
      await this.service.failJob(jobId, error instanceof PaperError ? error.message
        : '当前阶段失败，原稿保留，可显式重试', fence)
    }).finally(() => { clearTimeout(timeout); if (this.deadlines.get(jobId) === timeout) this.deadlines.delete(jobId) })
    this.running.set(jobId, completion)
    void completion.finally(() => { if (this.running.get(jobId) === completion) this.running.delete(jobId) }).catch(() => undefined)
    return { job, completion }
  }

  retry(jobId: string, expectedVersion?: number): Promise<AcceptedPaperOperation> {
    const failed = this.service.retryableOperation(jobId)
    return this.start(jobId, failed.kind, { ...failed, expectedVersion, resume: true })
  }

  async close(): Promise<void> {
    this.closed = true
    for (const timeout of this.deadlines.values()) clearTimeout(timeout)
    this.deadlines.clear()
    /* Settle running rows before the domain closes. Fences make any late model
       response harmless; no wait/replay of a potentially billable request. */
    await this.service.settleInterrupted()
  }
}
