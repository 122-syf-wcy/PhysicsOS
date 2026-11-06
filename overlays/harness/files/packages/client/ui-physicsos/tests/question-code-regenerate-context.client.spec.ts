// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { createSnapshotStore, type SnapshotStore } from '../src/client/runtime-compat.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import type { QuestionCodeRegenerate } from '../src/client/experiments/question-code-api.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function regenerationBench() {
  const user = { id: 'student-a', schoolId: 'school-a', schoolName: 'School', username: 'student', displayName: 'Student', role: 'STUDENT' as const }
  localStorage.setItem('physicsos.auth.user', JSON.stringify({ id: user.id, schoolId: user.schoolId }))
  let finishDirect!: (response: Response) => void
  const direct = new Promise<Response>(resolve => { finishDirect = resolve })
  const fetch = vi.fn(async (input: string) => {
    if (input === '/physicsos/question-code/regenerate') return direct
    if (input === '/physicsos/auth/me') return new Response(JSON.stringify({ user }), { status: 200 })
    return new Response(JSON.stringify({ attempts: [], scenes: [] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const scene = { sceneId: 'scene-a' }
  const row = (id: string, active: boolean, scenes: Record<string, unknown>) => ({
    id, blank: false, retainedBy: { mainView: active ? 1 : 0 },
    projectionValues: { agentPreset: 'student', physicsScenes: { latest: null, scenes } },
  })
  const sessionsList = createSnapshotStore({ ids: ['session-a', 'session-b'], byId: {
    'session-a': row('session-a', true, { 'scene-a': scene }),
    'session-b': row('session-b', false, {}),
  } })
  const prompts = { 'session-a': vi.fn(async () => ({ ok: true, value: { accepted: true } })), 'session-b': vi.fn(async () => ({ ok: true, value: { accepted: true } })) }
  ctx.provide('sessions', {
    list: sessionsList,
    scope: (id: keyof typeof prompts) => ({ id }),
    sessionOf: ({ id }: { id: keyof typeof prompts }) => ({ prompt: prompts[id] }),
  } as never)
  ctx.provide('workspaces', { create: vi.fn(), rename: vi.fn(), list: { getSnapshot: () => ({ items: [], state: 'ready' }), subscribe: () => () => {} } } as never)
  ctx.provide('uiWorkspace', { connectWorkspace: vi.fn(), openSession: vi.fn(), startSession: vi.fn(), archiveSession: vi.fn() } as never)
  ctx.provide('layout', { toggleSidebar: vi.fn(), selectPanel: vi.fn(), panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } } as never)
  ctx.provide('connection', { api: { agentPresets: { select: vi.fn(async () => ({ result: { ok: true, value: { agentPreset: 'student' } } })) } } } as never)
  ctx.provide('uiConversation', { events: { register: vi.fn(() => () => {}) }, binding: () => { throw new Error('No mounted conversation') } } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const authEntry = slots.entries('shell.overlay').find(entry => entry.options.id === 'physicsos-auth-gate')!
  const auth = (authEntry.inject as () => { hooks: { auth: SnapshotStore<AuthState> } })().hooks.auth
  await vi.waitFor(() => { expect(auth.getSnapshot().status).toBe('authed') })
  const sceneCard = slots.entries('conversation.chat.node').find(entry => entry.options.key === 'physics-scene-card')!
  const regenerate = (sceneCard.inject as () => { regenerateQuestionCode: QuestionCodeRegenerate })().regenerateQuestionCode
  return { user, auth, prompts, regenerate, fetch,
    finishDirect: () => { finishDirect(new Response(null, { status: 404 })) },
    switchSession: () => { sessionsList.set({ ids: ['session-a', 'session-b'], byId: {
      'session-a': row('session-a', false, { 'scene-a': scene }), 'session-b': row('session-b', true, {}),
    } }) },
    removeScene: () => { sessionsList.set({ ids: ['session-a', 'session-b'], byId: {
      'session-a': row('session-a', true, {}), 'session-b': row('session-b', false, {}),
    } }) },
  }
}

describe('question-code regeneration fallback ownership', () => {
  it('keeps the legacy fallback in the original active account and session', async () => {
    const b = await regenerationBench()
    const pending = b.regenerate('scene-a')
    b.finishDirect()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(b.prompts['session-a']).toHaveBeenCalledWith([{ type: 'text', text: expect.stringContaining('"scene-a"') }], 'queue')
    expect(b.prompts['session-b']).not.toHaveBeenCalled()
  })

  it.each(['session', 'logout', 'account', 'school', 'scene'] as const)('does not send a stale fallback after %s changes during the direct request', async (change) => {
    const b = await regenerationBench()
    const pending = b.regenerate('scene-a')
    expect(b.fetch.mock.calls.some(([path]) => path === '/physicsos/question-code/regenerate')).toBe(true)
    if (change === 'session') b.switchSession()
    if (change === 'logout') b.auth.set({ status: 'guest' })
    if (change === 'account') {
      b.auth.set({ status: 'guest' })
      b.auth.set({ status: 'authed', user: { ...b.user, id: 'student-b' } })
    }
    if (change === 'school') b.auth.set({ status: 'authed', user: { ...b.user, schoolId: 'school-b' } })
    if (change === 'scene') b.removeScene()
    b.finishDirect()
    await expect(pending).resolves.toMatchObject({ ok: false })
    expect(b.prompts['session-a']).not.toHaveBeenCalled()
    expect(b.prompts['session-b']).not.toHaveBeenCalled()
  })
})
