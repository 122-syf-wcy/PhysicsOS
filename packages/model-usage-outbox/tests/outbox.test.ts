import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ModelUsageOutbox, type ModelReceipt, type ModelUsageOutboxRecord, type ReceiptTable } from '../src/index.ts'
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'model-usage-outbox-')); onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'rows.json'); await writeFile(file, '{}')
  const table = async (): Promise<ReceiptTable> => {
    const rows = new Map<string, ModelUsageOutboxRecord>(Object.entries(JSON.parse(await readFile(file, 'utf8'))))
    const save = async () => { await writeFile(file + '.tmp', JSON.stringify(Object.fromEntries(rows))); await rename(file + '.tmp', file) }
    return { get: id => rows.get(id), entries: () => rows.entries(), put: async (id, value) => { rows.set(id, value); await save() }, delete: async id => { rows.delete(id); await save() } }
  }
  return { table }
}
describe('caller-owned durable model receipts', () => {
  it('retains exact measured usage and original occurrence through an unavailable sink and restart', async () => {
    const f = await fixture(); const errors: string[] = []; const table = await f.table()
    const first = new ModelUsageOutbox({ source: 'moderation', table, sink: () => undefined, onError: phase => errors.push(phase), now: () => new Date('2026-11-10T15:59:00Z'), id: () => 'stable-call' })
    await first.initialize(); const attempt = await first.begin({ provider: 'route', model: 'model' })
    await attempt.finish({ inputTokens: 31, outputTokens: 7, cacheReadTokens: 9 }); await first.close()
    expect(table.get(attempt.id)?.receipt.usage).toEqual({ inputTokens: 31, outputTokens: 7, cacheReadTokens: 9 })
    const delivered: ModelReceipt[] = []
    const restarted = new ModelUsageOutbox({ source: 'moderation', table: await f.table(), sink: () => ({ recordModelReceipt: async receipt => { delivered.push(receipt) } }), onError: phase => errors.push(phase) })
    await restarted.initialize(); await restarted.flush(); await restarted.close()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ id: attempt.id, occurredAt: '2026-11-10T15:59:00.000Z', usage: { inputTokens: 31, outputTokens: 7, cacheReadTokens: 9 } })
    expect(errors).toContain('deliver')
  })
  it('retries a lost sink response with the identical receipt instead of counting another model call', async () => {
    const f = await fixture(); const delivered: ModelReceipt[] = []; let fail = true
    const outbox = new ModelUsageOutbox({ source: 'paper', table: await f.table(), sink: () => ({ recordModelReceipt: async receipt => { delivered.push(receipt); if (fail) throw new Error('Transient response loss') } }), onError: () => undefined })
    await outbox.initialize()
    const attempt = await outbox.withOwner({ schoolId: 'school', userKey: 'teacher' }, () => outbox.begin({ provider: 'route', model: 'vision' }))
    await attempt.finish({ inputTokens: 3, outputTokens: 2 })
    await expect(outbox.flush()).rejects.toThrow('Transient response loss')
    fail = false; await outbox.flush(); await outbox.close()
    expect(delivered.length).toBeGreaterThanOrEqual(2)
    expect(delivered.at(-1)).toEqual(delivered[0])
    expect(delivered[0]?.owner).toEqual({ schoolId: 'school', userKey: 'teacher' })
  })
  it('marks an actually started interrupted call as missing without manufacturing zero tokens', async () => {
    const f = await fixture(); const first = new ModelUsageOutbox({ source: 'paper', table: await f.table(), sink: () => undefined, onError: () => undefined })
    await first.initialize(); const attempt = await first.begin({ provider: 'route', model: 'vision' }); await first.close()
    const delivered: ModelReceipt[] = []
    const next = new ModelUsageOutbox({ source: 'paper', table: await f.table(), sink: () => ({ recordModelReceipt: async receipt => { delivered.push(receipt) } }), onError: () => undefined })
    await next.initialize(); await next.flush(); await next.close()
    expect(delivered).toHaveLength(1); expect(delivered[0]?.id).toBe(attempt.id); expect(delivered[0]?.usage).toBeUndefined()
  })
  it('durably abandons an admitted but undispatched call so restart emits no receipt', async () => {
    const f = await fixture(); const delivered: ModelReceipt[] = []
    const sink = () => ({ recordModelReceipt: async (receipt: ModelReceipt) => { delivered.push(receipt) } })
    const first = new ModelUsageOutbox({ source: 'paper', table: await f.table(), sink, onError: () => undefined })
    await first.initialize(); const attempt = await first.begin({ provider: 'route', model: 'vision' }); await attempt.abandon(); await first.close()
    const next = new ModelUsageOutbox({ source: 'paper', table: await f.table(), sink, onError: () => undefined })
    await next.initialize(); await next.flush(); await next.close()
    expect(delivered).toEqual([])
  })

})
