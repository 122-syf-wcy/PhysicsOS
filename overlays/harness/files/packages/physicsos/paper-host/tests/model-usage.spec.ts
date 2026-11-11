import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PaperService } from '../src/service.ts'
import { paperRoutes } from '../src/routes.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { ModelUsageOutbox, type ModelReceipt } from '@physicsos/model-usage-outbox'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openPaperDomain } from '../src/domain.ts'
import { callModel } from '../src/draft.ts'
import { transcribeQuestionImages } from '../src/transcribe.ts'
async function fixture(onBegin?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'paper-outbox-')); const ctx = new Context(); await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(directory); ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  const domain = await openPaperDomain(ctx); const delivered: ModelReceipt[] = []
  const outbox = new ModelUsageOutbox({ source: 'paper', table: { get: id => domain.table('usage_receipts').get(id), entries: () => domain.table('usage_receipts').entries(), delete: id => domain.table('usage_receipts').delete(id), put: async (id, row) => { if (row.state === 'started') await onBegin?.(); return domain.table('usage_receipts').put(id, row) } }, sink: () => ({ recordModelReceipt: async receipt => { delivered.push(receipt) } }), onError: () => undefined })
  await outbox.initialize(); onTestFinished(async () => { await outbox.close(); await domain.close(); await backend.close(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { ctx, domain, outbox, delivered, route: { provider: 'paper-route', model: 'vision', receipts: outbox } }
}
describe('actual paper stream receipts', () => {
  it('records a drafting call as the captured server owner and retains actual disjoint usage numbers', async () => {
    const f = await fixture()
    f.ctx.provide('llm', { async *stream() { yield { type: 'text-delta', index: 0, text: '[]' }; yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 5, cacheReadTokens: 9 } }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const result = await f.outbox.withOwner({ schoolId: 'school', userKey: 'authenticated-teacher' }, () => callModel(f.ctx, f.route, 'system', 'draft a question'))
    expect(result).toBe('[]'); await f.outbox.flush()
    expect(f.delivered).toHaveLength(1); expect(f.delivered[0]).toMatchObject({ source: 'paper', owner: { schoolId: 'school', userKey: 'authenticated-teacher' }, usage: { inputTokens: 17, outputTokens: 5, cacheReadTokens: 9 } })
  })
  it('records actual image transcription and omits usage for an unreported system call without recording rejected image preflight', async () => {
    const f = await fixture(); let calls = 0; let reported = false
    f.ctx.provide('attachments', { imageLimits: { maxImagesPerMessage: 2 }, validateImage: async () => undefined, saveImage: async () => ({ attachmentId: 'image', mediaType: 'image/png', width: 1, height: 1, bytes: 1 }) } as never)
    f.ctx.provide('llm', { async *stream() { calls++; yield { type: 'text-delta', index: 0, text: 'The label is R7.' }; if (reported) yield { type: 'usage', usage: { inputTokens: 23, outputTokens: 4, cacheWriteTokens: 7 } }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    await expect(transcribeQuestionImages(f.ctx, f.route, [])).rejects.toThrow('at least one image')
    expect(f.delivered).toEqual([])
    expect(await transcribeQuestionImages(f.ctx, f.route, [{ data: new Uint8Array([1]), mediaType: 'image/png' }])).toBe('The label is R7.')
    await f.outbox.flush(); expect(calls).toBe(1); expect(f.delivered).toHaveLength(1); expect(f.delivered[0]?.owner).toBeUndefined(); expect(f.delivered[0]?.usage).toBeUndefined()
    reported = true
    await f.outbox.withOwner({ schoolId: 'school', userKey: 'teacher' }, () => transcribeQuestionImages(f.ctx, f.route, [{ data: new Uint8Array([1]), mediaType: 'image/png' }]))
    await f.outbox.flush(); expect(calls).toBe(2); expect(f.delivered[1]).toMatchObject({ owner: { schoolId: 'school', userKey: 'teacher' }, usage: { inputTokens: 23, outputTokens: 4, cacheWriteTokens: 7 } })
  })
  it('accounts each actual EMPTY_RESPONSE retry separately, retaining missing coverage and later numbers', async () => {
    const f = await fixture(); let calls = 0
    f.ctx.provide('llm', { async *stream() { calls++; if (calls === 1) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE', message: 'empty' } } }; return }; yield { type: 'text-delta', index: 0, text: '[]' }; yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    expect(await callModel(f.ctx, f.route, 'system', 'draft')).toBe('[]'); await f.outbox.flush()
    expect(calls).toBe(2); expect(f.delivered).toHaveLength(2); expect(f.delivered[0]?.id).not.toBe(f.delivered[1]?.id)
    expect(f.delivered[0]?.usage).toBeUndefined(); expect(f.delivered[1]?.usage).toEqual({ inputTokens: 4, outputTokens: 2 })
  })
  it('captures HTTP server identity for ingestion instead of forged body account fields', async () => {
    const f = await fixture()
    f.ctx.provide('llm', { async *stream() { yield { type: 'text-delta', index: 0, text: '[]' }; yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const handler = paperRoutes({ service: new PaperService(f.domain), exportDir: '/tmp',
      identity: () => ({ actorOf: () => ({ schoolId: 'authenticated-school', userKey: 'authenticated-teacher', username: 'teacher', role: 'TEACHER' }), record: async () => undefined }),
      withUsageOwner: (actor: { schoolId: string; userKey: string }, operation: () => Promise<void>) => f.outbox.withOwner(actor, operation),
      runIngest: async () => { await callModel(f.ctx, f.route, 'system', 'draft'); return { created: [], duplicates: [] } },
    } as never)
    const server = createServer((req, res) => { void handler(req, res) }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())))
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/physicsos/paper/bank/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'question', schoolId: 'forged-school', userKey: 'forged-user', enteredBy: 'forged-user' }) })
    expect(response.status).toBe(200); await f.outbox.flush()
    expect(f.delivered).toHaveLength(1); expect(f.delivered[0]?.owner).toEqual({ schoolId: 'authenticated-school', userKey: 'authenticated-teacher' })
  })

  it.each(['draft', 'transcription'] as const)('abandons %s admission cancelled during persistence before any stream dispatch', async kind => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void; const entering = new Promise<void>(resolve => { entered = resolve })
    const f = await fixture(async () => { entered(); await gate }); let calls = 0
    onTestFinished(() => { release() })
    f.ctx.provide('attachments', { imageLimits: { maxImagesPerMessage: 2 }, validateImage: async () => undefined, saveImage: async () => ({ attachmentId: 'image', mediaType: 'image/png', width: 1, height: 1, bytes: 1 }) } as never)
    f.ctx.provide('llm', { async *stream() { calls++; yield { type: 'text-delta', index: 0, text: 'should not run' }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const running = kind === 'draft' ? callModel(f.ctx, f.route, 'system', 'draft') : transcribeQuestionImages(f.ctx, f.route, [{ data: new Uint8Array([1]), mediaType: 'image/png' }])
    const refused = expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await entering; const closing = f.outbox.close(); release(); await refused; await closing
    expect(calls).toBe(0); expect(f.delivered).toEqual([]); expect([...f.domain.table('usage_receipts').entries()]).toEqual([])
  })

})
