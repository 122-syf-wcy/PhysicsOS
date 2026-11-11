import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { ModelUsageOutbox, type ModelReceipt } from '@physicsos/model-usage-outbox'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { openAuthDomain } from '../src/domain.ts'
import { createModerationReviewer } from '../src/moderation/model.ts'
const input = { text: 'Explain Newton laws', context: '', textTruncated: false, contextTruncated: false }
const allowed = { risk: 'allow', category: 'none', severity: 'none', confidence: 0.98, reason: 'Physics education', evidence: [] }
describe('durable moderation usage integration', () => {
  it('preserves successful classification and exact usage through sink failure and auth-domain restart without rerunning the model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moderation-outbox-'))
    let available = false, calls = 0
    const delivered: ModelReceipt[] = []
    const setup = async () => {
      const ctx = new Context(); await ctx.plugin(Storage)
      const backend = new JsonStorageBackend(directory); ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
      const domain = await openAuthDomain(ctx)
      const outbox = new ModelUsageOutbox({ source: 'moderation', table: domain.table('usage_receipts'), sink: () => available ? { recordModelReceipt: async receipt => { delivered.push(receipt) } } : undefined, onError: () => undefined })
      await outbox.initialize()
      return { outbox, domain, close: async () => { await outbox.close(); await domain.close(); await backend.close(); await ctx.fiber.dispose() } }
    }
    let mounted = await setup(); onTestFinished(async () => { await mounted.close(); await rm(directory, { recursive: true, force: true }) })
    const reviewer = createModerationReviewer({ async *stream() { calls++; yield { type: 'text-delta', index: 0, text: JSON.stringify(allowed) }; yield { type: 'usage', usage: { inputTokens: 51, outputTokens: 13, cacheReadTokens: 8 } }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never,
      { provider: 'review-route', model: 'review-model' }, { receiptOutbox: mounted.outbox })
    expect(await reviewer(input, new AbortController().signal)).toEqual(allowed)
    const pending = [...mounted.domain.table('usage_receipts').entries()]
    expect(pending).toHaveLength(1); expect(pending[0]?.[1].receipt.usage).toEqual({ inputTokens: 51, outputTokens: 13, cacheReadTokens: 8 })
    await expect(reviewer({ ...input, text: 'x'.repeat(12001) }, new AbortController().signal)).rejects.toMatchObject({ code: 'REVIEW_INVALID_INPUT' })
    expect(calls).toBe(1); expect([...mounted.domain.table('usage_receipts').entries()]).toHaveLength(1)
    const identity = pending[0]?.[1].receipt.id
    await mounted.close(); available = true; mounted = await setup(); await mounted.outbox.flush()
    expect(calls).toBe(1); expect(delivered).toHaveLength(1); expect(delivered[0]?.id).toBe(identity); expect(delivered[0]?.usage).toEqual({ inputTokens: 51, outputTokens: 13, cacheReadTokens: 8 })
  })
  it.each(['cancel', 'deadline'] as const)('abandons late durable admission after %s without a model call or restart receipt', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'moderation-late-admission-'))
    let calls = 0; const delivered: ModelReceipt[] = []
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void; const entering = new Promise<void>(resolve => { entered = resolve })
    let committed!: () => void; const commitDone = new Promise<void>(resolve => { committed = resolve })
    let delay = true
    const setup = async () => {
      const ctx = new Context(); await ctx.plugin(Storage)
      const backend = new JsonStorageBackend(directory); ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
      const domain = await openAuthDomain(ctx); const table = domain.table('usage_receipts')
      const outbox = new ModelUsageOutbox({ source: 'moderation', table: { get: id => table.get(id), entries: () => table.entries(), delete: id => table.delete(id),
        put: async (id, row) => { if (delay && row.state === 'started') { delay = false; entered(); await gate; await table.put(id, row); committed(); return }; await table.put(id, row) } },
        sink: () => ({ recordModelReceipt: async receipt => { delivered.push(receipt) } }), onError: () => undefined })
      await outbox.initialize()
      return { outbox, close: async () => { await outbox.close(); await domain.close(); await backend.close(); await ctx.fiber.dispose() } }
    }
    let mounted = await setup()
    onTestFinished(async () => { vi.useRealTimers(); release(); await mounted.close(); await rm(directory, { recursive: true, force: true }) })
    const reviewer = createModerationReviewer({ async *stream() { calls++; yield { type: 'text-delta', index: 0, text: JSON.stringify(allowed) }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never,
      { provider: 'review-route', model: 'review-model' }, { receiptOutbox: mounted.outbox })
    const parent = new AbortController()
    if (mode === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reviewing = reviewer(input, parent.signal)
    const refused = expect(reviewing).rejects.toMatchObject({ code: mode === 'deadline' ? 'REVIEW_TIMEOUT' : 'REVIEW_ABORTED' })
    await entering
    if (mode === 'deadline') await vi.advanceTimersByTimeAsync(45001); else parent.abort()
    await refused; vi.useRealTimers()
    release(); await commitDone; await mounted.outbox.flush(); await mounted.close()
    mounted = await setup(); await mounted.outbox.flush()
    expect(calls).toBe(0); expect(delivered).toEqual([])
  })

})
