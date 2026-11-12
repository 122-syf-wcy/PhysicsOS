import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, createPersonalExports, PERSONAL_EXPORTS_SERVICE } from '../src/index.ts'

const actor = { userId: 'u_immutable', userKey: 'school:alice', schoolId: 'school', username: 'alice', role: 'SUPER_ADMIN' as const }

function fixture() {
  const resources = [{ kind: 'session' as const, resourceId: 'owned' }, { kind: 'workspace' as const, resourceId: 'owned-workspace' }]
  const auth = {
    accountResources: vi.fn((value: typeof actor) => {
      if (value.userId !== actor.userId || value.userKey !== actor.userKey) throw new Error('UNAUTHENTICATED')
      return resources
    }),
    accountProfile: vi.fn(() => ({ userId: actor.userId, userKey: actor.userKey, username: actor.username, displayName: 'Alice' })),
  }
  const learning = {
    exportWhiteboardIndex: vi.fn(async () => [{ id: 'board-1', title: 'Board' }]),
    exportWhiteboard: vi.fn(async () => ({ id: 'board-1', title: 'Board', objects: [] })),
    exportUsage: vi.fn(async () => [{ id: 'usage-1', seconds: 2 }]),
  }
  const persistence = {
    list: vi.fn(async () => [
      { header: { id: 'owned', createdAt: 7 } },
      { header: { id: 'unrelated', createdAt: 99 } },
    ]),
    open: vi.fn(async (id: string) => ({
      header: { id, createdAt: 7 },
      read: async () => ({ events: [
        { type: 'request/context', time: 1, data: { apiKey: 'HOST_SECRET' } },
        { type: 'user/message', time: 2, data: { content: [{ type: 'text', text: 'Question' }], password: 'NOT_CONTENT' } },
        { type: 'assistant/message', time: 3, data: { message: { content: [{ type: 'text', text: 'Answer' }] }, stream: [{ secret: 'STREAM_SECRET' }] } },
        { type: 'tool/result', time: 4, data: { message: { content: [{ type: 'text', text: 'TOOL_SECRET' }] } } },
      ] }),
      close: vi.fn(async () => {}),
    })),
  }
  const services = new Map<string, unknown>([
    ['physicsosAccountErasureAuth', auth], ['physicsosLearningPersonalData', learning], ['sessionPersistence', persistence],
  ])
  return { sections: createPersonalExports(name => services.get(name)).sections(), auth, learning, persistence, services }
}

describe('independent account-sync exports', () => {
  it('publishes exactly one service and requires neither erasure, attachment, fence nor query hooks', () => {
    const provided = new Map<string, unknown>()
    const services = new Map<string, unknown>()
    const ctx = {
      get: (name: string) => services.get(name),
      provide: (name: string, value: unknown) => { provided.set(name, value) },
    } as unknown as Context
    apply(ctx)
    expect([...provided.keys()]).toEqual([PERSONAL_EXPORTS_SERVICE])
    expect(provided.has('physicsosAccountErasure')).toBe(false)
    expect(provided.has('physicsosHarnessAccountData')).toBe(false)
  })

  it('builds every required personal section from exact account ownership', async () => {
    const f = fixture()
    expect(f.sections.map(section => section.id)).toEqual(['account.profile', 'account.sessions', 'learning.whiteboards', 'learning.usage'])
    const profile = f.sections.find(section => section.id === 'account.profile')!
    expect(await profile.rows(actor)).toEqual([{ userId: actor.userId, userKey: actor.userKey, username: actor.username, displayName: 'Alice' }])
    const sessions = f.sections.find(section => section.id === 'account.sessions')!
    expect(await sessions.rows(actor)).toEqual([{ id: 'owned', createdAt: 7 }])
    expect(f.auth.accountResources).toHaveBeenCalledWith(actor)
    expect(f.auth.accountProfile).toHaveBeenCalledWith(actor)
  })

  it('exports first-party conversation text only, without request, tool, stream or out-of-band fields', async () => {
    const f = fixture()
    const sessions = f.sections.find(section => section.id === 'account.sessions')!
    const exported = await sessions.load!(actor, { id: 'owned' })
    expect(exported).toEqual({ id: 'owned', createdAt: 7, snapshot: 'persistence', messages: [
      { role: 'user', time: 2, text: 'Question' }, { role: 'assistant', time: 3, text: 'Answer' },
    ] })
    expect(JSON.stringify(exported)).not.toMatch(/SECRET|NOT_CONTENT|unrelated|apiKey|password/)
  })

  it('does not grant an administrator access to a resource outside the exact ownership ledger', async () => {
    const f = fixture()
    const sessions = f.sections.find(section => section.id === 'account.sessions')!
    await expect(sessions.load!(actor, { id: 'unrelated' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(f.persistence.open).not.toHaveBeenCalled()
    await expect(sessions.load!(actor, { id: '../unrelated' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('revalidates ownership after a read and refuses a replaced account rather than returning old data', async () => {
    const f = fixture()
    f.persistence.list.mockImplementationOnce(async () => {
      f.auth.accountResources.mockImplementation(() => { throw new Error('UNAUTHENTICATED') })
      return [{ header: { id: 'owned', createdAt: 7 } }]
    })
    const sessions = f.sections.find(section => section.id === 'account.sessions')!
    await expect(sessions.rows(actor)).rejects.toThrow('UNAUTHENTICATED')
  })

  it('fails closed when persistence is unavailable instead of returning an empty successful account', async () => {
    const f = fixture()
    f.services.delete('sessionPersistence')
    const sessions = f.sections.find(section => section.id === 'account.sessions')!
    await expect(sessions.rows(actor)).rejects.toMatchObject({ code: 'EXPORT_UNAVAILABLE' })
  })

  it('honors an optional persisted erasure fence without requiring one', async () => {
    const f = fixture()
    f.services.set('sessionPersistence', {
      ...f.persistence,
      accountErasure: { isFenced: async (id: string) => id === 'owned' },
    })
    const sections = createPersonalExports(name => f.services.get(name)).sections()
    const sessions = sections.find(section => section.id === 'account.sessions')!
    expect(await sessions.rows(actor)).toEqual([])
    expect(f.persistence.list).toHaveBeenCalledOnce()
  })

  it('uses the full Harness factory when it works and falls back to read-only persistence when its erasure hooks are absent', async () => {
    const f = fixture()
    const unavailable = Object.assign(new Error('erasure hooks absent'), { code: 'ERASURE_UNAVAILABLE' })
    f.services.set('physicsosHarnessAccountData', {
      accountSessions: vi.fn(async () => { throw unavailable }),
      exportSession: vi.fn(async () => { throw unavailable }),
    })
    const sections = createPersonalExports(name => f.services.get(name)).sections()
    const sessions = sections.find(section => section.id === 'account.sessions')!
    expect(await sessions.rows(actor)).toEqual([{ id: 'owned', createdAt: 7 }])
    expect(await sessions.load!(actor, { id: 'owned' })).toMatchObject({ id: 'owned', messages: [
      { role: 'user', text: 'Question' }, { role: 'assistant', text: 'Answer' },
    ] })
  })
})
