// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-physicsos/client'
import {
  createExperimentSceneRef, findExperimentTemplate,
} from '@deepseek-ai/dsh-client-ui-physicsos/src/client/physics/experiment-templates.ts'

afterEach(() => {
  document.title = ''
  vi.unstubAllGlobals()
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const workspaces = { startSession: vi.fn() }
  const layout = { toggleSidebar: vi.fn() }
  /* conversation.surface registers inside ctx.inject(connection, sessions,
     workspaces) — its upload hand-off genuinely needs them, so the bench must
     stand them up even though the assertions only count slot entries. */
  const sessions = {
    list: {
      getSnapshot: () => ({ current: undefined, byId: {} }),
      subscribe: () => () => {},
    },
    scope: () => undefined,
    sessionOf: () => undefined,
  }
  const connection = { api: { agentPresets: { select: vi.fn() } } }
  const conversationEvents = { register: vi.fn(() => () => {}) }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('layout', layout as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('connection', connection as never)
  ctx.provide('conversationEvents', conversationEvents as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      conversation: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: {
      'sidebar.brand': { kind: 'single', scope: 'root' },
      'sidebar.nav': { kind: 'list', scope: 'root' },
      'sidebar.new': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'conversation',
    children: {
      'conversation.hero.brand': { kind: 'single', scope: 'root' },
      'conversation.hero.actions': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
      'conversation.surface': { kind: 'single', scope: 'root' },
      /* Declared by the chat view in the real tree; the bench declares it so
         the deferred keyed registration fires and can be counted. */
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, workspaces, layout, conversationEvents }
}

describe('ui-physicsos apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'workspaces', 'layout', 'sessions', 'conversationEvents',
    ])
  })

  it('closes the navigation drawer after selecting a surface on a narrow viewport', async () => {
    vi.stubGlobal('innerWidth', 390)
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const nav = b.slots.entries('sidebar.nav')[0]!.inject as () => {
      openSurface: (id: 'home' | 'lab' | 'questions', drawerOpen: boolean) => void
    }

    /* The narrow sidebar rests collapsed to a rail. A tap there navigates and
       must leave the rail alone — toggling would open the drawer over the
       surface the tap just asked for. */
    nav().openSurface('questions', false)
    expect(b.layout.toggleSidebar).not.toHaveBeenCalled()

    /* Tapping from the expanded drawer is the case that closes it. */
    nav().openSurface('questions', true)
    expect(b.layout.toggleSidebar).toHaveBeenCalledTimes(1)
    await fiber.dispose()
  })

  it('leaves a wide sidebar alone, which has its own collapse control', async () => {
    vi.stubGlobal('innerWidth', 1440)
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const nav = b.slots.entries('sidebar.nav')[0]!.inject as () => {
      openSurface: (id: 'home' | 'lab' | 'questions', drawerOpen: boolean) => void
    }

    nav().openSurface('lab', true)

    expect(b.layout.toggleSidebar).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('occupies the declared PhysicsOS holes and sets the document title', async () => {
    document.title = 'DeepSeek Harness'
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(document.title).toBe('PhysicsOS')
    expect(document.head.querySelector('style[data-physicsos-chrome]')).toBeTruthy()
    expect(b.slots.entries('sidebar.brand')).toHaveLength(1)
    expect(b.slots.entries('sidebar.nav')).toHaveLength(1)
    expect(b.slots.entries('sidebar.new')).toHaveLength(1)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(b.slots.entries('conversation.surface')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.brand')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.actions')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.agentPreset')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.agentPreset')[0]!.options.priority).toBe(-1)
    /* The scene card: definition on the conversation registry, keyed renderer
       on the chat node slot. */
    expect(b.conversationEvents.register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'physics-scene-card', target: 'chat' }),
    )
    const sceneCard = b.slots.entries('conversation.chat.node')
      .find(entry => entry.options.key === 'physics-scene-card')
    expect(sceneCard).toBeTruthy()
    const openSceneInLab = (sceneCard!.inject as () => {
      openSceneInLab: (ref: { sceneId: string; scene: object }) => void
    })().openSceneInLab
    const template = findExperimentTemplate('projectile-oblique')
    if (template === undefined) throw new Error('missing projectile-oblique template')
    const sceneRef = createExperimentSceneRef(template, '斜抛运动')
    openSceneInLab(sceneRef)
    /* Opening a scene card lands in the Lab and records it in 最近空间 —
       observable via the physicsSurface store, not the fake workspaces. */
    const surfaceEntry = b.slots.entries('conversation.surface')[0]!
    const hooks = (surfaceEntry.inject as () => {
      hooks: { physicsSurface: { getSnapshot: () => { surface: string; sceneRef?: { sceneId: string } } } }
    })().hooks
    expect(hooks.physicsSurface.getSnapshot().surface).toBe('lab')
    expect(hooks.physicsSurface.getSnapshot().sceneRef?.sceneId).toBe(sceneRef.sceneId)
    const brand = b.slots.entries('sidebar.brand')[0]!.inject as () => { openHome: () => void }
    brand().openHome()
    expect(b.workspaces.startSession).not.toHaveBeenCalled()
    const actions = b.slots.entries('conversation.hero.actions')[0]!.inject as () => {
      startSession: (id?: string) => void
    }
    actions().startSession('ws-1')
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith('ws-1')
    await fiber.dispose()
    expect(document.title).toBe('DeepSeek Harness')
    expect(document.head.querySelector('style[data-physicsos-chrome]')).toBeNull()
    expect(b.slots.entries('sidebar.brand')).toHaveLength(0)
  })
})
