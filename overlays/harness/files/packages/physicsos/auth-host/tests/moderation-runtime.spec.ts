import type { ModerationReview } from '../src/moderation/types.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionObservationReader } from '@deepseek-ai/dsh-session-query/src/observation.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAuthDomain, userKey } from '../src/domain.ts'
import { AuthService, DEFAULT_AUTH_CONFIG } from '../src/service.ts'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt from '../../../core/system-prompt/src/index.ts'
import ToolRuntime from '../../../core/tools/src/index.ts'
import AgentLoop from '../../../core/agent-loop/src/index.ts'
import SessionProjectionRegistry from '../../../session/session-projection/src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { AccountRuns, ModerationRuntime } from '../src/moderation/runtime.ts'
import { school, user } from './security-fixture.ts'
const admin = { userKey: 's:root', schoolId: 's', username: 'root', role: 'SUPER_ADMIN' as const }
const allow: ModerationReview = { risk: 'allow', category: 'none', severity: 'none', confidence: 1, reason: 'education', evidence: [] }
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); vi.useRealTimers() })
async function harness(review = async (_input: any, _signal: AbortSignal): Promise<any> => allow, beforeRuntime?: (ctx: Context, auth: AuthService) => Promise<void>) {
 const ctx = new Context()
 await ctx.plugin(Storage); await ctx.plugin(SessionStore)
 const root = await mkdtemp(join(tmpdir(), 'moderation-runtime-'))
 cleanups.push(() => rm(root, { recursive: true, force: true }))
 const backend = new JsonStorageBackend(root)
 ctx.storage.backend.register('json', backend)
 const facility = new DomainFacility(ctx, { backend: 'json' })
 ctx.provide('storageDomain', facility)
 const reader = new SessionObservationReader(ctx)
 ctx.provide('sessionQuery', { observeSession: reader.read.bind(reader) } as never)
 const domain = await openAuthDomain(ctx)
 await domain.table('schools').put('s', school('s', 'School'))
 for (const name of ['root', 'student']) await domain.table('users').put(userKey('s', name), user('s', name, name === 'root' ? 'SUPER_ADMIN' : 'STUDENT'))
 let runs: AccountRuns
 const auth = new AuthService(domain, DEFAULT_AUTH_CONFIG, { onUserDisabled: owner => runs.disable(owner) })
 runs = new AccountRuns(ctx, domain, auth)
 await beforeRuntime?.(ctx, auth)
 const runtime = await ModerationRuntime.create(ctx, domain, auth, review)
 cleanups.push(async () => { await runtime.dispose(); runs.dispose(); await domain.close(); await backend.close(); await ctx.fiber.dispose() })
 const claim = (id: string) => auth.claimApiResource({ ...admin, userKey: 's:student', username: 'student', role: 'STUDENT' }, 'session', id)
 return { ctx, domain, auth, runtime, claim, runs, service: runtime.service }
}
const human = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
describe('moderation runtime with real Session and domain events', () => {
 it('captures humans, supplements a durable late owner claim, ignores synthetic messages and deduplicates inbox promotion', async () => {
  const { ctx, runtime, service, claim } = await harness()
  const session = ctx.sessions.create(SessionId('late'))
  const message = human('explain a pendulum')
  session.append('user/message', message, { surfaceOp: 'append' })
  await runtime.flush(); expect(service.list(admin, {}).total).toBe(0)
  await claim(session.id); await runtime.flush()
  expect(service.list(admin, {}).total).toBe(1)
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'classifier output' }], source: { kind: 'physicsos-moderation' } }), { surfaceOp: 'append' })
  await runtime.flush(); expect(service.list(admin, {}).total).toBe(1)
 })
 it('skips inherited fork inputs and captures only newly accepted child input', async () => {
  const { ctx, runtime, service, claim } = await harness()
  const parent = ctx.sessions.create(SessionId('parent'))
  parent.append('user/message', human('parent evidence'), { surfaceOp: 'append' })
  const child = ctx.sessions.fork(parent.id, undefined, SessionId('fork'))
  await claim(child.id); await runtime.flush()
  expect(service.list(admin, {}).total).toBe(0)
  child.append('user/message', human('child evidence'), { surfaceOp: 'append' })
  await runtime.flush(); expect(service.list(admin, {}).cases.map(c => c.text)).toEqual(['child evidence'])
 })
 it('bounds historical intake to twenty and resumes beyond captured inputs', async () => {
  const h = await harness()
  await h.claim('history2')
  const history = h.ctx.sessions.create(SessionId('history2'))
  await h.runtime.dispose()
  for (let n = 0; n < 25; n++) history.append('user/message', human('physics ' + n), { surfaceOp: 'append' })
  const active = await ModerationRuntime.create(h.ctx, h.domain, h.auth, async () => allow)
  cleanups.push(() => active.dispose())
  expect(await active.service.scan(admin)).toEqual({ scanned: 20, captured: 20 })
  expect(await active.service.scan(admin)).toEqual({ scanned: 5, captured: 5 })
 })
 it('preserves old evidence and creates a distinct pending case for a same-ID queue edit', async () => {
  let finish!: (value: any) => void
  const reviewed = new Promise<any>(resolve => { finish = resolve })
  const h = await harness(async () => reviewed)
  const session = h.ctx.sessions.create(SessionId('edit')); await h.claim(session.id)
  const message = human('first revision')
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
  await h.runtime.flush()
  const before = h.service.list(admin, {}).cases[0]!
  expect(before).toBeDefined()
  const processing = h.service.processNext()
  await vi.waitFor(() => expect(h.service.detail(admin, before.id).status).toBe('reviewing'))
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [{ ...message, content: [{ type: 'text', text: 'edited evidence' }] }] })
  await h.runtime.flush(); finish(allow); await processing
  expect(h.service.list(admin, {}).total).toBe(2)
  expect(h.service.detail(admin, before.id)).toMatchObject({ text: 'first revision' })
  expect(h.service.list(admin, {}).cases.find(c => c.id !== before.id)).toMatchObject({ text: 'edited evidence', status: 'pending' })
 })
 it('cancels an in-flight reviewer on dispose and restarts exactly one durable pending queue', async () => {
  const calls: AbortSignal[] = []
  const h = await harness(async (_input, signal) => { calls.push(signal); return new Promise(() => {}) })
  const session = h.ctx.sessions.create(SessionId('dispose')); await h.claim(session.id)
  session.append('user/message', human('queued first'), { surfaceOp: 'append' })
  session.append('user/message', human('queued second'), { surfaceOp: 'append' })
  await h.runtime.flush()
  await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 3_000 })
  session.append('user/message', human('accepted at shutdown'), { surfaceOp: 'append' })
  await h.runtime.dispose()
  expect(calls[0]!.aborted).toBe(true)
  const rows = h.service.list(admin, {}).cases
  expect(rows.filter(c => c.status === 'pending')).toHaveLength(2)
  expect(rows.filter(c => c.status === 'error')).toHaveLength(1)
  const runtime = await ModerationRuntime.create(h.ctx, h.domain, h.auth, async () => allow)
  cleanups.push(() => runtime.dispose())
  session.append('user/message', human('after restart'), { surfaceOp: 'append' })
  await runtime.flush()
  expect(runtime.service.list(admin, {}).total).toBe(4)
 })
 it('clears real owned Agent and proven child inboxes and rejects a child published after disable', async () => {
  const h = await harness()
  await h.ctx.plugin(LlmRuntime); await h.ctx.plugin(SessionProjectionRegistry)
  await h.ctx.plugin(SystemPrompt); await h.ctx.plugin(ToolRuntime)
  await h.ctx.plugin(AgentRegistry); await h.ctx.plugin(AgentLoop, { agents: [] })
  h.ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
  const root = await h.ctx.agents.create({ sessionId: SessionId('owned-root'), agentOptions: { provider: 'mock', model: 'mock' } })
  await h.claim(root.agent.id)
  const child = await root.agent.ctx.agents.create({ sessionId: SessionId('owned-child'), parentAgent: root.agent, agentOptions: { provider: 'mock', model: 'mock' } })
  const conflict = await root.agent.ctx.agents.create({ sessionId: SessionId('conflicting-child'), parentAgent: root.agent, agentOptions: { provider: 'mock', model: 'mock' } })
  await h.auth.claimApiResource(admin, 'session', conflict.agent.id)
  const other = await h.ctx.agents.create({ sessionId: SessionId('other-root'), agentOptions: { provider: 'mock', model: 'mock' } })
  await h.auth.claimApiResource(admin, 'session', other.agent.id)
  for (const agent of [root.agent, child.agent, other.agent, conflict.agent]) {
    agent.inbox.append('next-turn', human('queued'))
    agent.inbox.append('next-step', human('steer'))
  }
  let release!: () => void
  let enter!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const paused = new Promise<void>(resolve => { release = resolve })
  const creating = root.agent.ctx.agents.create({ sessionId: SessionId('late-child'), parentAgent: root.agent,
    agentOptions: { provider: 'mock', model: 'mock' }, setup: async () => { enter(); await paused } })
  const rejection = expect(creating).rejects.toThrow('account-disabled')
  await entered
  await h.auth.setUserStatus(admin, 's', 'student', { status: 'disabled' })
  release(); await rejection
  for (const agent of [root.agent, child.agent]) {
    expect(agent.inbox.nextTurn).toHaveLength(0); expect(agent.inbox.nextStep).toHaveLength(0)
  }
  expect(other.agent.inbox.nextTurn).toHaveLength(1)
  expect(conflict.agent.inbox.nextTurn).toHaveLength(1)
  root.agent.inbox.append('next-turn', human('attempt after disable'))
  expect(root.agent.inbox.nextTurn).toHaveLength(0)
 })

 it('replays live intake after a transient case write failure without losing the committed message', async () => {
  const h = await harness()
  const session = h.ctx.sessions.create(SessionId('retry-intake')); await h.claim(session.id); await h.runtime.flush()
  const cases = h.domain.table('moderation_cases'), put = cases.put.bind(cases)
  let fail = true
  cases.put = async (id, value) => { if (fail) { fail = false; throw new Error('test storage unavailable') }; return put(id, value) }
  session.append('user/message', human('retained journal input'), { surfaceOp: 'append' })
  await h.runtime.flush()
  expect(h.service.list(admin, {}).total).toBe(0)
  expect(h.domain.table('moderation_cursors').get('claim:retry-intake')).toMatchObject({ done: false })
  await vi.waitFor(() => expect(h.service.list(admin, {}).total).toBe(1), { timeout: 3_000 })
 })

 it.each([
  { initial: 'completed', restart: false },
  { initial: 'absent', restart: false },
  { initial: 'completed', restart: true },
  { initial: 'absent', restart: true },
 ] as const)('final replay fix: recovers a failed $initial cursor write automatically (reopen=$restart)', async ({ initial, restart }) => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const h = await harness()
  const session = h.ctx.sessions.create(SessionId('cursor-write-failure'))
  const cursorId = 'claim:cursor-write-failure'
  if (initial === 'completed') {
   await h.claim(session.id); await h.runtime.flush()
   expect(h.domain.table('moderation_cursors').get(cursorId)?.done).toBe(true)
  }
  const cursors = h.domain.table('moderation_cursors'), put = cursors.put.bind(cursors)
  let fail = true
  cursors.put = async (id, value) => {
   if (id === cursorId && fail) { fail = false; throw new Error('fixture cursor storage unavailable') }
   return put(id, value)
  }
  // In the absent case, the user input commits before its durable ownership
  // publication. Only that publication attempts (and fails) the first cursor.
  session.append('user/message', human('committed during cursor outage'), { surfaceOp: 'append' })
  if (initial === 'absent') await h.claim(session.id)
  await h.runtime.flush()
  expect(h.auth.sessionOwnerKey(session.id)).toBe('s:student')
  expect(h.service.list(admin, {}).total).toBe(0)
  if (initial === 'completed') expect(cursors.get(cursorId)?.done).toBe(true)
  else expect(cursors.get(cursorId)).toBeUndefined()
  let active = h.runtime
  if (restart) {
   await h.runtime.dispose(); h.runs.dispose(); await h.domain.close()
   const restored = await openAuthDomain(h.ctx)
   if (initial === 'completed') expect(restored.table('moderation_cursors').get(cursorId)?.done).toBe(true)
   else expect(restored.table('moderation_cursors').get(cursorId)).toBeUndefined()
   active = await ModerationRuntime.create(h.ctx, restored, new AuthService(restored, DEFAULT_AUTH_CONFIG), async () => allow)
   cleanups.push(async () => { await active.dispose(); await restored.close() })
  }
  // No further human event, ownership publication or manual scan. The real
  // timer worker must rediscover committed history after storage is available.
  await vi.advanceTimersByTimeAsync(1_000)
  await (active as any).worker
  expect(active.service.list(admin, {}).cases.map(row => row.text)).toEqual(['committed during cursor outage'])
 })

 it('final replay fix: keeps pre-activation history manual while recovering first-cursor failure across reopen', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(10_000)
  const h = await harness(undefined, async (ctx, auth) => {
   const session = ctx.sessions.create(SessionId('pre-existing-owner'))
   await auth.claimApiResource({ ...admin, userKey: 's:student', username: 'student', role: 'STUDENT' }, 'session', session.id)
   session.append('user/message', human('old history needs manual scan'), { surfaceOp: 'append' })
   vi.setSystemTime(20_000)
  })
  const cursors = h.domain.table('moderation_cursors'), put = cursors.put.bind(cursors)
  cursors.put = async (id, value) => {
   if (id === 'claim:pre-existing-owner') throw new Error('fixture first-cursor outage')
   return put(id, value)
  }
  vi.setSystemTime(21_000)
  h.ctx.sessions.get(SessionId('pre-existing-owner'))!.append('user/message', human('new input survives restart'), { surfaceOp: 'append' })
  await h.runtime.flush()
  expect(h.service.list(admin, {}).total).toBe(0)
  expect(cursors.get('claim:pre-existing-owner')).toBeUndefined()
  await h.runtime.dispose(); h.runs.dispose(); await h.domain.close()
  vi.setSystemTime(30_000)
  const restored = await openAuthDomain(h.ctx)
  const active = await ModerationRuntime.create(h.ctx, restored, new AuthService(restored, DEFAULT_AUTH_CONFIG), async () => allow)
  cleanups.push(async () => { await active.dispose(); await restored.close() })
  await vi.advanceTimersByTimeAsync(1_000); await (active as any).worker
  expect(active.service.list(admin, {}).cases.map(row => row.text)).toEqual(['new input survives restart'])
  expect(await active.service.scan(admin)).toEqual({ scanned: 1, captured: 1 })
  expect(active.service.list(admin, {}).total).toBe(2)
 })

 it('final replay fix: reconciles one owned session and at most twenty inputs per automatic pass', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const h = await harness()
  const cursors = h.domain.table('moderation_cursors'), put = cursors.put.bind(cursors)
  cursors.put = async () => { throw new Error('fixture claim-cursor outage') }
  for (const id of ['a-reconcile', 'b-reconcile']) {
   const session = h.ctx.sessions.create(SessionId(id))
   for (let n = 0; n < 25; n++) session.append('user/message', human(id + ' input ' + n), { surfaceOp: 'append' })
   await h.claim(id); await h.runtime.flush()
  }
  cursors.put = put
  expect(h.service.list(admin, {}).total).toBe(0)
  for (const total of [20, 40, 45, 50]) {
   await vi.advanceTimersByTimeAsync(1_000); await (h.runtime as any).worker
   expect(h.service.list(admin, {}).total).toBe(total)
  }
 })

 it('final replay fix: preserves the historical cutoff during live intake after a five-thousand-event pass', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(10_000)
  const h = await harness(undefined, async (ctx, auth) => {
   const session = ctx.sessions.create(SessionId('long-pre-existing-history'))
   await auth.claimApiResource({ ...admin, userKey: 's:student', username: 'student', role: 'STUDENT' }, 'session', session.id)
   for (let n = 0; n < 5_001; n++) session.append('user/message', human('old manual evidence ' + n), { surfaceOp: 'append' })
   vi.setSystemTime(20_000)
  })
  await vi.advanceTimersByTimeAsync(1_000); await (h.runtime as any).worker
  expect(h.service.list(admin, {}).total).toBe(0)
  expect(h.domain.table('moderation_cursors').get('claim:long-pre-existing-history')).toMatchObject({ seq: 5_000, done: false })
  const cases = h.domain.table('moderation_cases'), put = cases.put.bind(cases)
  let fail = true
  cases.put = async (id, value) => {
   if (fail) { fail = false; throw new Error('fixture live case failure') }
   return put(id, value)
  }
  h.ctx.sessions.get(SessionId('long-pre-existing-history'))!.append('user/message', human('new evidence after bounded history pass'), { surfaceOp: 'append' })
  await h.runtime.flush()
  expect(h.service.list(admin, {}).total).toBe(0)
  await vi.advanceTimersByTimeAsync(1_000); await (h.runtime as any).worker
  expect(h.service.list(admin, {}).cases.map(row => row.text)).toEqual(['new evidence after bounded history pass'])
 })

 it('final replay fix: rejects startup when its activation watermark cannot persist', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const h = await harness()
  const session = h.ctx.sessions.create(SessionId('activation-failure'))
  await h.claim(session.id); await h.runtime.flush(); await h.runtime.dispose()
  const cursors = h.domain.table('moderation_cursors'), put = cursors.put.bind(cursors)
  await cursors.delete('activation')
  cursors.put = async (id, value) => {
   if (id === 'activation') throw new Error('fixture activation unavailable')
   return put(id, value)
  }
  await expect(ModerationRuntime.create(h.ctx, h.domain, h.auth, async () => allow)).rejects.toThrow('fixture activation unavailable')
  session.append('user/message', human('no unpublished runtime listener'), { surfaceOp: 'append' })
  await vi.advanceTimersByTimeAsync(1_000)
  expect(h.service.list(admin, {}).total).toBe(0)
  expect(cursors.get('activation')).toBeUndefined()
  cursors.put = put
 })

 it('keeps corrupt history retryable without starving already captured review work', async () => {
  const h = await harness()
  await h.claim('absent-history'); await h.runtime.flush()
  const session = h.ctx.sessions.create(SessionId('valid-history')); await h.claim(session.id)
  session.append('user/message', human('safe lesson'), { surfaceOp: 'append' }); await h.runtime.flush()
  await vi.waitFor(() => expect(h.service.list(admin, {}).cases[0]?.status).toBe('allowed'), { timeout: 3_000 })
  expect(h.domain.table('moderation_cursors').get('claim:absent-history')).toMatchObject({ done: false, seq: 0 })
 })

 it('review fix: preserves failed live intake when an older immutable history cut completes, including restart', async () => {
  const h = await harness()
  const session = h.ctx.sessions.create(SessionId('cursor-race')); await h.claim(session.id); await h.runtime.flush()
  const cursorTable = h.domain.table('moderation_cursors')
  const cursor = cursorTable.get('claim:cursor-race')!
  await cursorTable.put(cursor.id, { ...cursor, done: false })
  const observe = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  let pause = true
  h.ctx.sessionQuery.observeSession = async (...args) => {
    const cut = await observe(...args)
    if (pause) { pause = false; entered.resolve(); await release.promise }
    return cut
  }
  const cases = h.domain.table('moderation_cases'), put = cases.put.bind(cases)
  const warning = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => {})
  try {
    await entered.promise
    cases.put = async () => { throw new Error('review fixture case write failed') }
    session.append('user/message', human('input beyond immutable cut'), { surfaceOp: 'append' })
    await h.runtime.flush()
    expect(h.service.list(admin, {}).total).toBe(0)
    release.resolve(); await (h.runtime as any).history
    expect(cursorTable.get(cursor.id)?.done).toBe(false)
    expect(warning).toHaveBeenCalledWith('moderation: capture deferred; authoritative history retained')
    cases.put = put
    await h.runtime.dispose(); h.runs.dispose(); await h.domain.close()
    const restored = await openAuthDomain(h.ctx)
    expect(restored.table('moderation_cursors').get(cursor.id)?.done).toBe(false)
    const restarted = await ModerationRuntime.create(h.ctx, restored, new AuthService(restored, DEFAULT_AUTH_CONFIG), async () => allow)
    cleanups.push(async () => { await restarted.dispose(); await restored.close() })
    await vi.waitFor(() => expect(restarted.service.list(admin, {}).cases[0]?.text).toBe('input beyond immutable cut'), { timeout: 3_000 })
  } finally { release.resolve(); cases.put = put; warning.mockRestore() }
 })
 it.each(['sessions', 'api_tokens', 'reset_requests'] as const)('review fix: cancels a real active Agent even when disabled-account %s cleanup fails', { timeout: 15_000 }, async tableName => {
  const h = await harness()
  await h.ctx.plugin(LlmRuntime); await h.ctx.plugin(SessionProjectionRegistry)
  await h.ctx.plugin(SystemPrompt); await h.ctx.plugin(ToolRuntime)
  await h.ctx.plugin(AgentRegistry); await h.ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(['hang'])
  h.ctx.llm.registerAdapter(['mock'], adapter)
  const root = await h.ctx.agents.create({ sessionId: SessionId('cleanup-failure'), agentOptions: { provider: 'mock', model: 'mock' } })
  await h.claim(root.agent.id)
  await h.auth.login({ schoolId: 's', username: 'student', password: 'bootstrap-pass' }, '127.0.0.1')
  await h.auth.createApiToken({ ...admin, username: 'student', userKey: 's:student', role: 'STUDENT' }, { name: 'cleanup', scope: 'write' })
  await h.auth.requestPasswordReset({ username: 'student' }, '127.0.0.1')
  root.agent.followup(human('active provider request'))
  await vi.waitFor(() => expect(adapter.requests).toHaveLength(1))
  root.agent.inbox.append('next-turn', human('queued turn')); root.agent.inbox.append('next-step', human('queued steer'))
  const table = h.domain.table(tableName), put = table.put.bind(table)
  table.put = async () => { throw new Error('review fixture durable cleanup failed') }
  const disabled = vi.spyOn(h.runs, 'disable')
  try {
    await expect(h.auth.setUserStatus(admin, 's', 'student', { status: 'disabled' })).rejects.toThrow('review fixture durable cleanup failed')
    expect(h.domain.table('users').get('s:student')?.status).toBe('disabled')
    expect(disabled).toHaveBeenCalledOnce()
    expect(adapter.requests[0]!.signal?.aborted).toBe(true)
    expect(root.agent.inbox.nextTurn).toHaveLength(0); expect(root.agent.inbox.nextStep).toHaveLength(0)
  } finally { table.put = put as never; root.agent.cancel({ kind: 'hook', reason: 'test-cleanup' }, { keepInbox: false }); await root.agent.whenIdle() }
 })

})
