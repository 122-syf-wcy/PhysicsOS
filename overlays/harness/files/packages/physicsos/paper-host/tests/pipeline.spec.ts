import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { PaperPipeline, type PaperPipelineDrivers } from '../src/pipeline.ts'
import { PaperError } from '../src/service.ts'
import { operationFence } from '../src/workflow-state.ts'
import { deferred, fixtureDocument, fixtureJob, fixtureSolves, workflowFixture } from './workflow-fixture.ts'

const driversFor = (service: Awaited<ReturnType<typeof workflowFixture>>['service']): PaperPipelineDrivers => ({
  draft: async (id, fence) => operationFence(await service.commitDocument(id, fixtureDocument(), 'synthetic draft', fence.version, fence)),
  repair: async (id, fence) => operationFence(await service.commitDocument(id, { ...fixtureDocument(), title: 'synthetic repair' }, 'repair', fence.version, fence)),
  replace: async (id, fence) => operationFence(await service.commitDocument(id, { ...fixtureDocument(), title: 'synthetic replace' }, 'replace', fence.version, fence)),
  check: async (id, fence, job) => { await service.recordCheckResults(id, [], fixtureSolves(job.document!), fence) },
})

describe('server-owned paper continuation', () => {
  it('continues draft through checks and review without any client poll/check call', async () => {
    const f = await workflowFixture(fixtureJob({ status: 'spec' })); onTestFinished(f.close)
    const events: string[] = []
    const drivers = driversFor(f.service)
    const pipeline = new PaperPipeline(f.service, { ...drivers,
      draft: async (...args) => { events.push('draft'); return drivers.draft(...args) },
      check: async (...args) => { events.push('check'); return drivers.check(...args) },
    })
    const accepted = await pipeline.start(f.jobId, 'draft', { expectedVersion: 1 })
    expect(accepted.job.status).toBe('drafting')
    // Simulate leaving the page: never observe GET or invoke a second stage.
    await accepted.completion
    expect(events).toEqual(['draft', 'check'])
    expect(f.service.getJob(f.jobId)).toMatchObject({ status: 'review', operation: { state: 'completed' } })
    expect(f.service.getJob(f.jobId).checkBinding).toBeDefined()
  })

  it('reserves at the real write-chain slot and rejects duplicate draft/check before accepting', async () => {
    const f = await workflowFixture(fixtureJob({ status: 'spec' })); onTestFinished(f.close)
    const held = deferred()
    const drivers = driversFor(f.service)
    const pipeline = new PaperPipeline(f.service, { ...drivers, draft: async (...args) => { await held.promise; return drivers.draft(...args) } })
    const results = await Promise.allSettled([pipeline.start(f.jobId, 'draft'), pipeline.start(f.jobId, 'draft')])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({ reason: { code: 'JOB_RUNNING' } })
    await expect(pipeline.start(f.jobId, 'check')).rejects.toMatchObject({ code: 'JOB_RUNNING' })
    held.resolve()
    if (results[0]?.status === 'fulfilled') await results[0].value.completion
    await expect(pipeline.start(f.jobId, 'repair', { questionNo: 99, suggestion: 'synthetic suggestion' }))
      .rejects.toMatchObject({ status: 404, code: 'NO_QUESTION' })
  })

  it.each(['repair', 'replace'] as const)('settles a failed %s and preserves the original document for explicit recovery', async (kind) => {
    const f = await workflowFixture(); onTestFinished(f.close)
    const original = f.service.getJob(f.jobId).document!
    const drivers = driversFor(f.service)
    const pipeline = new PaperPipeline(f.service, { ...drivers, [kind]: async () => { throw new PaperError(422, 'PROPOSAL_FAILED', 'synthetic proposal failed') } })
    const accepted = await pipeline.start(f.jobId, kind, { questionNo: 1, suggestion: 'synthetic correction' })
    await accepted.completion
    const failed = f.service.getJob(f.jobId)
    expect(failed.status).toBe('failed')
    expect(failed.lastError).toBe('synthetic proposal failed')
    expect(failed.document).toEqual(original)
    expect(failed.recovery?.document).toEqual(original)
    expect(failed.operation).toMatchObject({ state: 'failed', phase: kind })
  })

  it('retries only checks after a post-repair check failure, never repeats the paid proposal', async () => {
    const f = await workflowFixture(); onTestFinished(f.close)
    const drivers = driversFor(f.service)
    let paidCalls = 0
    let checks = 0
    const pipeline = new PaperPipeline(f.service, { ...drivers,
      repair: async (...args) => { paidCalls++; return drivers.repair(...args) },
      check: async (...args) => { checks++; if (checks === 1) throw new Error('synthetic check fault'); return drivers.check(...args) },
    })
    await (await pipeline.start(f.jobId, 'repair', { questionNo: 1, suggestion: 'synthetic fix' })).completion
    expect(f.service.getJob(f.jobId)).toMatchObject({ status: 'failed', operation: { phase: 'check' } })
    const retry = await pipeline.retry(f.jobId, f.service.getJob(f.jobId).versions.length)
    await retry.completion
    expect(paidCalls).toBe(1)
    expect(checks).toBe(2)
    expect(f.service.getJob(f.jobId).status).toBe('review')
  })

  it('restart settles an orphan and drops its late result without replaying any driver', async () => {
    const f = await workflowFixture(); onTestFinished(f.close)
    const drivers = driversFor(f.service)
    const held = deferred()
    const repair = vi.fn(async (...args: Parameters<PaperPipelineDrivers['repair']>) => { await held.promise; return drivers.repair(...args) })
    const pipeline = new PaperPipeline(f.service, { ...drivers, repair })
    const started = await pipeline.start(f.jobId, 'repair', { questionNo: 1, suggestion: 'synthetic fix' })
    await f.service.settleInterrupted()
    expect(f.service.getJob(f.jobId).status).toBe('failed')
    expect(repair).toHaveBeenCalledTimes(1)
    held.resolve()
    await started.completion
    expect(f.service.getJob(f.jobId).document?.title).toBe('合成组卷回归试卷')
    expect(f.service.getJob(f.jobId).status).toBe('failed')
    expect(repair).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung operation, settles failed and forbids late writes', async () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    const f = await workflowFixture(); onTestFinished(f.close)
    const drivers = driversFor(f.service)
    const held = deferred()
    const pipeline = new PaperPipeline(f.service, { ...drivers, repair: async (...args) => { await held.promise; return drivers.repair(...args) } }, undefined, 1000)
    const accepted = await pipeline.start(f.jobId, 'repair', { questionNo: 1, suggestion: 'synthetic fix' })
    await vi.advanceTimersByTimeAsync(1001)
    await accepted.completion
    expect(f.service.getJob(f.jobId)).toMatchObject({ status: 'failed', operation: { state: 'failed' } })
    expect(f.service.getJob(f.jobId).lastError).toContain('超时')
    held.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.service.getJob(f.jobId).document?.title).toBe('合成组卷回归试卷')
  })
})
