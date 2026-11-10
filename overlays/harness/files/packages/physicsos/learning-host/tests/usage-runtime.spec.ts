import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionObservationReader } from '@deepseek-ai/dsh-session-query/src/observation.ts'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openUsageDomain } from '../src/usage-domain.ts'
import { UsageService } from '../src/usage-service.ts'
import { UsageRuntime, type UsageOwnership } from '../src/usage-runtime.ts'
import type { UsageOwner } from '../src/usage-types.ts'

const a = { schoolId: 's', userKey: 's:a', username: 'a', role: 'STUDENT' as const }
const b = { ...a, userKey: 's:b', username: 'b' }
function final(session: Session, turn = 1) {
  const usage = { inputTokens: 3, outputTokens: 1 }
  session.append('assistant/message', { turn, step: 1, stream: [{ type: 'chunk', time: Date.now(), chunk: { type: 'usage', usage } }],
    message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'physics' } }), usage }, { surfaceOp: 'append' })
}
function agent(ctx: Context, session: Session): Agent {
  return { id: session.id, session, ctx, options: {}, inbox: { nextTurn: [], nextStep: [] } as never, status: 'idle', send: () => {}, followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }), inject: () => {}, cancel: () => {}, runMaintenance: task => task(new AbortController().signal), whenIdle: async () => {} }
}
async function fixture() {
  const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(SessionStore); await ctx.plugin(AgentRegistry)
  const path = await mkdtemp(join(tmpdir(), 'usage-runtime-')), backend = new JsonStorageBackend(path)
  ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  const reader = new SessionObservationReader(ctx)
  ctx.provide('sessionQuery', { observeSession: reader.read.bind(reader) } as never)
  const service = new UsageService(await openUsageDomain(ctx)), owners = new Map<string, UsageOwner>()
  const ownership: UsageOwnership = { ownerForSession: id => owners.get(id), ownedSessions: () => [...owners].map(([sessionId, owner]) => ({ sessionId, ...owner })) }
  let runtime = await UsageRuntime.create(ctx, service, ownership)
  onTestFinished(async () => { await runtime.dispose(); await service.dispose(); await service.domain.close(); await backend.close(); await ctx.fiber.dispose(); await rm(path, { recursive: true, force: true }) })
  return { ctx, service, owners, get runtime() { return runtime }, restart: async () => { await runtime.dispose(); runtime = await UsageRuntime.create(ctx, service, ownership) } }
}
describe('owned usage runtime', () => {
  it('supplements a late exact account claim and does not duplicate a replayed settlement', async () => {
    const f = await fixture(), session = f.ctx.sessions.create(SessionId('late-claim'))
    final(session); await f.runtime.flush()
    expect((await f.service.summary(a)).tokens.totalTokens).toBe(0)
    f.owners.set(session.id, a); await f.runtime.flush(); await f.runtime.flush()
    expect((await f.service.summary(a)).tokens.totalTokens).toBe(4)
  })
  it('binds actual Agent descendants, preserves foreign exact owners and ignores a forged parent header', async () => {
    const f = await fixture(), parent = f.ctx.sessions.create(SessionId('root'))
    f.owners.set(parent.id, a)
    const root = agent(f.ctx, parent), detachRoot = f.ctx.agents.enter(root, undefined)
    const childSession = f.ctx.sessions.create(SessionId('child')), child = agent(f.ctx, childSession), detachChild = f.ctx.agents.enter(child, root)
    const foreignSession = f.ctx.sessions.create(SessionId('foreign')), foreign = agent(f.ctx, foreignSession), detachForeign = f.ctx.agents.enter(foreign, root)
    f.owners.set(foreign.id, b)
    const forged = f.ctx.sessions.create(SessionId('forged'), { meta: { parentSession: parent.id } })
    for (const session of [childSession, foreignSession, forged]) final(session)
    await f.runtime.flush()
    expect((await f.service.summary(a)).tokens.totalTokens).toBe(4)
    expect((await f.service.summary(b)).tokens.totalTokens).toBe(4)
    expect(f.service.childBindings().map(row => row.sessionId)).toEqual([child.id])
    detachChild(); detachForeign(); detachRoot()
    await f.restart(); final(childSession, 2); await f.runtime.flush()
    expect((await f.service.summary(a)).tokens.totalTokens).toBe(8)
  })

  it('retains valid account totals and reports an unreadable owned session without blocking other accounts', async () => {
    const f = await fixture(), session = f.ctx.sessions.create(SessionId('readable'))
    f.owners.set(session.id, a); f.owners.set('missing-session', b)
    final(session)
    await expect(f.runtime.flush()).resolves.toBeUndefined()
    expect(await f.service.summary(a)).toMatchObject({ tokens: { totalTokens: 4 }, coverage: { unavailableSessions: 0 } })
    expect(await f.service.summary(b)).toMatchObject({ tokens: { totalTokens: 0 }, coverage: { reportedCalls: 0, missingCalls: 0, unavailableSessions: 1 } })
  })
})
