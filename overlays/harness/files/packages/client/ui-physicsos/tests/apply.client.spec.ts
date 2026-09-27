// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, PHYSICS_PANEL_IDS } from '@deepseek-ai/dsh-client-ui-physicsos/client'
import {
  createExperimentSceneRef, findExperimentTemplate,
} from '@deepseek-ai/dsh-client-ui-physicsos/src/client/physics/experiment-templates.ts'

afterEach(() => {
  document.title = ''
  vi.unstubAllGlobals()
})

/** The composer-chain owner the Home election reads: a Session at a given
    blankness with the pending-interaction seat empty. */
type ChainOwner = Pick<ComposerChainProps, 'session' | 'pendingInteraction'>

/** `StoredEntry.select` as the slot registry hands it to a test: the inspection
    view erases the owner to `never` on purpose, so a caller must supply the
    contract itself. `ChainOwner` is the same slice the registration site checks
    `homeElection` against, which keeps the two ends of the link tied together. */
type ChainSelect = (owner: ChainOwner) => unknown

/**
 * Build a real chain owner. Home's election reads exactly `session.blank` and
 * the pending-interaction seat, so the fixture is a full `SessionSnapshot`
 * (taken from the contract the slot hands the selector) rather than a loose
 * literal: an upstream rename of `blank` must fail this test, not silently
 * elect Home for every Session.
 * @param blank - whether the Session is still blank.
 * @returns the owner props the composer chain passes to a selector.
 */
function chainOwner(blank: boolean): ChainOwner {
  const session: NonNullable<ComposerChainProps['session']> = {
    sessionId: SessionId('session-1'),
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  }
  return { session, pendingInteraction: undefined }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const workspaces = {
    startSession: vi.fn(),
    create: vi.fn(async () => ({ workspaceId: 'ws-1' })),
    rename: vi.fn(async () => undefined),
    list: { getSnapshot: () => ({ items: [], state: 'ready' }), subscribe: () => () => {} },
  }
  const uiWorkspace = {
    connectWorkspace: vi.fn(async () => 'session-1'),
    openSession: vi.fn(),
    startSession: vi.fn(),
    archiveSession: vi.fn(async () => undefined),
  }
  const panelInfo = {
    getSnapshot: () => ({ activePanelId: null }),
    subscribe: () => () => {},
  }
  const layout = { toggleSidebar: vi.fn(), selectPanel: vi.fn(), panelInfo }
  const sessions = {
    list: {
      getSnapshot: () => ({ ids: [], byId: {} }),
      subscribe: () => () => {},
    },
    scope: () => undefined,
    sessionOf: () => undefined,
  }
  const connection = { api: { agentPresets: { select: vi.fn() } } }
  const conversationEvents = { register: vi.fn(() => () => {}) }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('layout', layout as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('connection', connection as never)
  ctx.provide('conversationEvents', conversationEvents as never)
  ctx.provide('uiConversation', { events: conversationEvents } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      main: { kind: 'keyed', scope: 'root' },
      conversation: { kind: 'single', scope: 'session-maybe' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'conversation',
    children: {
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      /* Home stands in for the whole composer while the Session is blank. */
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
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
      'slots', 'locale', 'workspaces', 'uiWorkspace', 'layout', 'sessions', 'uiConversation',
    ])
  })

  it('registers the product navigation as shell-owned panel rows', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.panellist').map(entry => entry.options.id))
      .toEqual(expect.arrayContaining([
        'physicsos-lab', 'physicsos-notice', 'physicsos-library', 'physicsos-record',
      ]))
    await fiber.dispose()
  })

  it('occupies the declared PhysicsOS holes and sets the document title', async () => {
    document.title = 'DeepSeek Harness'
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(document.title).toBe('PhysicsOS')
    expect(document.head.querySelector('style[data-physicsos-chrome]')).toBeTruthy()
    expect(b.slots.entries('sidebar.brand.mark')).toHaveLength(1)
    expect(b.slots.entries('sidebar.brand.name')).toHaveLength(1)
    expect(b.slots.entries('sidebar.panellist').length).toBeGreaterThanOrEqual(4)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(1)
    const mainPanels = b.slots.entries('main')
    expect(mainPanels).toHaveLength(6)
    expect(mainPanels.map(entry => entry.options.key))
      .toEqual(expect.arrayContaining(Object.values(PHYSICS_PANEL_IDS)))
    expect(b.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)
    /* The Home page claims the composer chain, and only for a blank Session. */
    const homes = b.slots.entries('conversation.composer')
    expect(homes).toHaveLength(1)
    expect(homes[0]!.options.priority).toBe(100)
    const elect = homes[0]!.select as ChainSelect | undefined
    expect(typeof elect).toBe('function')
    expect(elect!(chainOwner(true)))
      .toEqual({ home: true })
    expect(elect!(chainOwner(false)))
      .toBeNull()
    expect(b.slots.entries('conversation.hero.agentPreset')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.agentPreset')[0]!.options.priority).toBe(-1)
    expect(b.slots.entries('conversation.hero.workspace')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.workspace')[0]!.options.priority).toBe(-1)
    expect(b.slots.entries('settings.onboarding')[0]!.options).toMatchObject({
      id: 'physicsos-upstream-onboarding-sink',
      order: -200,
    })
    expect(b.slots.entries('shell.overlay').map(entry => entry.options.id))
      .toEqual(expect.arrayContaining([
        'physicsos-auth-gate',
        'physicsos-workspace-panel',
        'physicsos-platform-notice',
      ]))
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
    const surfaceEntry = mainPanels.find(entry => entry.options.key === PHYSICS_PANEL_IDS.lab)!
    const hooks = (surfaceEntry.inject as () => {
      hooks: { physicsSurface: { getSnapshot: () => { surface: string; sceneRef?: { sceneId: string } } } }
    })().hooks
    expect(hooks.physicsSurface.getSnapshot().surface).toBe('lab')
    expect(hooks.physicsSurface.getSnapshot().sceneRef?.sceneId).toBe(sceneRef.sceneId)
    const footer = b.slots.entries('sidebar.footer.action')[0]!.inject as () => {
      openHome: () => void
      startSession: () => void
    }
    footer().openHome()
    expect(b.workspaces.startSession).not.toHaveBeenCalled()
    footer().startSession()
    const panelEntry = b.slots.entries('shell.overlay')
      .find(entry => entry.options.id === 'physicsos-workspace-panel')!
    const panelInjected = (panelEntry.inject as () => {
      hooks: { panel: { getSnapshot: () => { open: boolean } } }
    })()
    expect(panelInjected.hooks.panel.getSnapshot().open).toBe(true)
    await fiber.dispose()
    expect(document.title).toBe('DeepSeek Harness')
    expect(document.head.querySelector('style[data-physicsos-chrome]')).toBeNull()
    expect(b.slots.entries('sidebar.brand.mark')).toHaveLength(0)
  })
})
