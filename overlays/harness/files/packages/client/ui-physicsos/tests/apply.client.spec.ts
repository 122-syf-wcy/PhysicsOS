// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-physicsos/client'

afterEach(() => {
  document.title = ''
  vi.unstubAllGlobals()
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const workspaces = { startSession: vi.fn() }
  const layout = { toggleSidebar: vi.fn() }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('layout', layout as never)
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
    },
  } as never, () => null)
  return { ctx, slots, workspaces, layout }
}

describe('ui-physicsos apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'workspaces', 'layout'])
  })

  it('closes the navigation drawer after selecting a surface on a narrow viewport', async () => {
    vi.stubGlobal('innerWidth', 390)
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const nav = b.slots.entries('sidebar.nav')[0]!.inject as () => {
      openSurface: (id: 'home' | 'lab' | 'questions') => void
    }

    nav().openSurface('questions')

    expect(b.layout.toggleSidebar).toHaveBeenCalledTimes(1)
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
