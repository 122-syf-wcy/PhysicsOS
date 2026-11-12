import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { openUsageDomain } from '../src/usage-domain.ts'
import { UsageService } from '../src/usage-service.ts'

const a = { schoolId: 'school-a', userKey: 'school-a:student', username: 'student', role: 'STUDENT' as const }
const b = { schoolId: 'school-a', userKey: 'school-a:other', username: 'other', role: 'STUDENT' as const }
const c = { schoolId: 'school-b', userKey: 'school-b:student', username: 'student', role: 'STUDENT' as const }
const admin = { ...a, userKey: 'school-a:admin', username: 'admin', role: 'SCHOOL_ADMIN' as const }
const root = { ...admin, role: 'SUPER_ADMIN' as const }

beforeEach(() => {
  // Session events and usage windows must observe the same Shanghai day.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T16:00:01Z'))
})
afterEach(() => { vi.useRealTimers() })

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'physicsos-usage-'))
  let ctx: Context, backend: JsonStorageBackend, service: UsageService
  const open = async () => {
    ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(SessionStore)
    backend = new JsonStorageBackend(path); ctx.storage.backend.register('json', backend)
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    service = new UsageService(await openUsageDomain(ctx))
  }
  const close = async () => { await service.dispose(); await service.domain.close(); await backend.close(); await ctx.fiber.dispose() }
  await open()
  onTestFinished(async () => { await close(); await rm(path, { recursive: true, force: true }) })
  return { get ctx() { return ctx }, get service() { return service }, now: (value: string) => { vi.setSystemTime(new Date(value)) },
    restart: async () => { await close(); await open() } }
}
function final(session: Session, usage?: TokenUsage, turn = 1, step = 1) {
  session.append('assistant/message', { turn, step,
    stream: usage === undefined ? [] : [{ type: 'chunk', time: Date.now(), chunk: { type: 'usage', usage } }],
    message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'physics' } }),
    ...(usage === undefined ? {} : { usage }) }, { surfaceOp: 'append' })
}
describe('durable account usage', () => {
  it('admits chapter-project visits and persists their uses without a bad-request retry', async () => {
    const f = await fixture()
    await expect(f.service.recordEvent(a, { id: 'project-visit', kind: 'visit', surface: 'projects', action: 'view' })).resolves.toMatchObject({ surface: 'projects' })
    await expect(f.service.recordEvent(a, { id: 'project-use', kind: 'use', surface: 'projects', action: 'view' })).resolves.toMatchObject({ surface: 'projects' })
    await f.restart()
    expect(await f.service.summary(a)).toMatchObject({ visits: 1, uses: 1 })
  })
  it('counts one idempotent visit on the Shanghai day and preserves it across restart', async () => {
    const f = await fixture()
    const event = { id: 'navigation-1', kind: 'visit', surface: 'home' }
    await Promise.all([f.service.recordEvent(a, event), f.service.recordEvent(a, event)])
    expect(await f.service.summary(a)).toMatchObject({ visits: 1, uses: 0, daily: [{ date: '2026-11-11', visits: 1 }] })
    await f.restart()
    expect(await f.service.summary(a)).toMatchObject({ visits: 1, coverage: { reportedCalls: 0, missingCalls: 0 } })
  })
  it('refuses forged account/time fields and an id reused for different event content', async () => {
    const f = await fixture()
    await expect(f.service.recordEvent(a, { id: 'forged', kind: 'visit', surface: 'home', userKey: b.userKey, at: '2020-01-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await f.service.recordEvent(a, { id: 'same', kind: 'visit', surface: 'home' })
    await expect(f.service.recordEvent(a, { id: 'same', kind: 'use', surface: 'lab' })).rejects.toMatchObject({ code: 'USAGE_EVENT_CONFLICT' })
  })
  it('keeps a delayed trusted receipt on its original Shanghai day across restart and replay', async () => {
    const f = await fixture()
    const receipt = {
      id: 'delayed-paper-call', source: 'paper' as const, provider: 'mock', model: 'physics',
      owner: { schoolId: a.schoolId, userKey: a.userKey }, occurredAt: '2026-11-09T16:00:01Z',
      usage: { inputTokens: 7, outputTokens: 3 },
    }
    await f.service.recordModelReceipt(receipt)
    await f.restart()
    await f.service.recordModelReceipt(receipt)
    expect(await f.service.summary(a, { from: '2026-11-10', to: '2026-11-10' }))
      .toMatchObject({ tokens: { totalTokens: 10 }, coverage: { reportedCalls: 1 } })
    expect(await f.service.summary(a, { from: '2026-11-11', to: '2026-11-11' }))
      .toMatchObject({ tokens: { totalTokens: 0 }, coverage: { reportedCalls: 0 } })
  })
  it('isolates personal accounts and constrains school-admin aggregates', async () => {
    const f = await fixture()
    for (const actor of [a, b, c]) await f.service.recordEvent(actor, { id: 'entry', kind: 'visit', surface: 'home' })
    expect(await f.service.summary(root)).toMatchObject({ scope: 'account', visits: 0 })
    expect(await f.service.summary(a)).toMatchObject({ scope: 'account', visits: 1 })
    expect(await f.service.adminSummary(admin)).toMatchObject({ scope: 'school', visits: 2 })
    expect(await f.service.adminSummary(root)).toMatchObject({ scope: 'platform', visits: 3 })
    await expect(f.service.adminSummary(admin, { schoolId: c.schoolId })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(f.service.adminSummary(a)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('replaces a same-attempt usage sample, counts a retry once, and reports missing usage explicitly', async () => {
    const f = await fixture(), session = f.ctx.sessions.create(SessionId('accounting'))
    const ingest = () => f.service.ingestSession({ sessionId: session.id, owner: a, inheritedEventCount: session.inheritedEventCount, events: session.snapshotEvents() })
    session.append('assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: Date.now(), chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } } }] })
    final(session, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2, reasoningTokens: 3 })
    await ingest(); await ingest()
    expect(await f.service.summary(a)).toMatchObject({ tokens: { totalTokens: 23, reasoningTokens: 3 }, coverage: { reportedCalls: 1, missingCalls: 0 } })
    session.append('llm/retry-started', { retryId: RetryId('real-retry'), turn: 1, step: 1, retry: 1 })
    final(session, { inputTokens: 1, outputTokens: 2 })
    final(session, undefined, 1, 2)
    await ingest()
    expect(await f.service.summary(a)).toMatchObject({ tokens: { totalTokens: 26 }, coverage: { reportedCalls: 2, missingCalls: 1 } })
  })
  it('charges only newly owned fork events and keeps system work outside personal totals', async () => {
    const f = await fixture(), parent = f.ctx.sessions.create(SessionId('parent'))
    final(parent, { inputTokens: 10, outputTokens: 2 })
    const child = f.ctx.sessions.fork(parent.id, undefined, SessionId('fork'))
    final(child, { inputTokens: 3, outputTokens: 1 }, 2, 1)
    for (const session of [parent, child]) await f.service.ingestSession({ sessionId: session.id, owner: a, inheritedEventCount: session.inheritedEventCount, events: session.snapshotEvents() })
    await f.service.recordModelReceipt({ id: 'background', source: 'moderation', provider: 'mock', model: 'physics', usage: { inputTokens: 5, outputTokens: 1 } })
    expect(await f.service.summary(a)).toMatchObject({ tokens: { totalTokens: 16 }, system: { tokens: { totalTokens: 0 } } })
    expect(await f.service.adminSummary(root)).toMatchObject({ tokens: { totalTokens: 16 }, system: { tokens: { totalTokens: 6 } } })
    await f.restart()
    expect(await f.service.summary(a)).toMatchObject({ tokens: { totalTokens: 16 } })
  })
})
