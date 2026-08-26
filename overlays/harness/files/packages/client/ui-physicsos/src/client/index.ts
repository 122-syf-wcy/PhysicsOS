/**
 * PhysicsOS Web Client overlay. Occupies declared sidebar / hero holes.
 * Does not replace ConversationRoot, Agent Loop, Session, or Tools.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { mountPhysicsOSChrome } from './chrome.ts'
import { HomeActions } from './HomeActions.tsx'
import { HomeBrand } from './HomeBrand.tsx'
import { createLearningRecordController } from './learning-record-store.ts'
import { PhysicsSurface } from './LabWorkspace.tsx'
import { PhysicsProfileLabel } from './PhysicsProfileLabel.tsx'
import { PhysicsProfileSeat } from './PhysicsProfileSeat.tsx'
import { createPhysicsProfileController } from './profile-store.ts'
import { RecentSpaces } from './RecentSpaces.tsx'
import { SidebarBrand } from './SidebarBrand.tsx'
import { SidebarFooter } from './SidebarFooter.tsx'
import { SidebarNav } from './SidebarNav.tsx'
import { SidebarNew } from './SidebarNew.tsx'
import { createPhysicsSurfaceController } from './surface-store.ts'
import { en, zh, type PhysicsosKey } from './locales.ts'

export type { PhysicsosKey } from './locales.ts'
export type { HomeActionsInjected, HomeActionsProps } from './HomeActions.tsx'
export type { HomeBrandProps } from './HomeBrand.tsx'
export type { PhysicsProfileLabelInjected, PhysicsProfileLabelProps } from './PhysicsProfileLabel.tsx'
export type { PhysicsProfileSeatInjected, PhysicsProfileSeatProps } from './PhysicsProfileSeat.tsx'
export type { SidebarBrandInjected, SidebarBrandProps } from './SidebarBrand.tsx'
export type { SidebarFooterInjected, SidebarFooterProps } from './SidebarFooter.tsx'
export type { SidebarNavInjected, SidebarNavProps } from './SidebarNav.tsx'
export type { SidebarNewInjected, SidebarNewProps } from './SidebarNew.tsx'
export type { RecentSpacesInjected, RecentSpacesProps } from './RecentSpaces.tsx'
export type { PhysicsSurfaceInjected, PhysicsSurfaceProps } from './LabWorkspace.tsx'
export type { PhysicsProfileId } from './profiles.ts'
export type { PhysicsSurfaceId } from './surface-store.ts'
export {
  STUDENT_PROFILES, TEACHER_PROFILES, isStudentProfile, runtimePresetOf,
} from './profiles.ts'
export {
  PHYSICS_PROFILE_STORAGE_KEY, createPhysicsProfileController, persistProfile, readStoredProfile,
} from './profile-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    physicsos: PhysicsosKey
  }
}

const NS = 'physicsos'
const PRODUCT_TITLE = 'PhysicsOS'

/** Services required by the PhysicsOS overlay. */
export const inject = ['slots', 'locale', 'workspaces', 'layout']

/**
 * Register PhysicsOS brand, sidebar navigation, home workspace, and the
 * student profile adapter that maps onto Harness presets.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-physicsos: dictionaries')
  ctx.effect(() => mountPhysicsOSChrome(), 'ui-physicsos: chrome')

  ctx.effect(() => {
    const previous = document.title
    document.title = PRODUCT_TITLE
    return () => { document.title = previous }
  }, 'ui-physicsos: document title')

  const startSession = (workspaceId?: WorkspaceId) => {
    ctx.workspaces.startSession(workspaceId)
  }
  /* localStorage-backed so 最近空间 survives a reload with restorable scenes. */
  const surface = createPhysicsSurfaceController(globalThis.localStorage)
  /* The student's attempt history: written by Question Space self-checks, read
     by the 学习记录 surface. Persisted so the record survives a reload. */
  const learningRecord = createLearningRecordController(globalThis.localStorage)

  ctx.slots.inject('sidebar.brand', () => ctx.slots.register({
    name: 'sidebar.brand',
    locale: NS,
    inject: () => ({ openHome: () => { surface.open('home') } }),
  }, SidebarBrand))

  ctx.slots.inject('sidebar.new', () => ctx.slots.register({
    name: 'sidebar.new',
    locale: NS,
    inject: () => ({
      startSession: () => { startSession() },
      openSurface: (
        id: 'lab' | 'questions' | 'home',
        sceneRef?: { sceneId: string; scene: PhysicsScene },
      ) => {
        /* “新建物理实验” asks for a NEW experiment, so it lands on the picker
           (the active scene stays resumable from inside it); a handover with a
           scene continues that scene directly. */
        if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
        else surface.open(id, sceneRef)
      },
    }),
  }, SidebarNew))

  ctx.slots.inject('sidebar.nav', () => ctx.slots.register({
    name: 'sidebar.nav',
    id: 'physicsos-nav',
    locale: NS,
    inject: () => ({
      hooks: { physicsSurface: surface.store },
      openSurface: (id: Parameters<typeof surface.open>[0]) => {
        surface.open(id)
        // Below the layout shell's 1024px auto-collapse breakpoint, a manual
        // expansion behaves as a navigation drawer and should close after use.
        if (window.innerWidth < 1024) ctx.layout.toggleSidebar()
      },
    }),
  }, SidebarNav))

  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -1,
    locale: NS,
    /* 最近空间 lists real scenes; a click restores the PhysicsScene in the Lab. */
    inject: () => ({
      hooks: { recentExperiments: surface.recent },
      openSurface: (
        id: Parameters<typeof surface.open>[0],
        sceneRef?: Parameters<typeof surface.open>[1],
      ) => { surface.open(id, sceneRef) },
    }),
  }, RecentSpaces))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'physicsos-footer',
    locale: NS,
    inject: () => ({
      startSession: () => { startSession() },
      /* 学习记录 is a real surface now: attempts, mistakes, mastery. */
      openRecord: () => { surface.open('record') },
    }),
  }, SidebarFooter))

  ctx.slots.inject('conversation.hero.brand', () => ctx.slots.register({
    name: 'conversation.hero.brand',
    locale: NS,
  }, HomeBrand))

  ctx.slots.inject('conversation.hero.actions', () => ctx.slots.register({
    name: 'conversation.hero.actions',
    locale: NS,
    inject: () => ({
      startSession,
      hooks: { recentExperiments: surface.recent },
      /* "新建物理实验" is a creation intent, so it lands on the picker rather
         than on the magnetic demo — the same chooser the sidebar uses. A recent
         entry hands its stored scene over and restores it directly. */
      openSurface: (
        id: 'home' | 'lab' | 'questions',
        sceneRef?: Parameters<typeof surface.open>[1],
      ) => {
        if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
        else surface.open(id, sceneRef)
      },
    }),
  }, HomeActions))

  const controller = createPhysicsProfileController(undefined, undefined, globalThis.localStorage)

  ctx.slots.inject('conversation.surface', () => ctx.slots.register({
    name: 'conversation.surface',
    locale: NS,
    inject: () => ({
      hooks: {
        physicsSurface: surface.store,
        learningRecord: learningRecord.store,
        /* 继续上次实验 on the library home restores the newest persisted scene. */
        recentExperiments: surface.recent,
      },
      openSurface: (
        id: 'home' | 'lab' | 'questions' | 'record',
        sceneRef?: Parameters<typeof surface.open>[1],
      ) => {
        /* A handover with a scene always lands in the Lab, whatever surface the
           caller was on when it created the scene. */
        if (sceneRef === undefined) surface.open(id)
        else surface.open('lab', sceneRef)
      },
      /* Toolbar 切换实验: chooser over the running scene, resumable. */
      openExperimentPicker: () => { surface.openExperimentPicker() },
      /* Question Space 自测 → 学习记录; 学习记录 → 重新练习 → Question Space. */
      recordAttempt: (attempt: Parameters<typeof learningRecord.record>[0]) => {
        learningRecord.record(attempt)
      },
      openQuestion: (questionId: string) => { surface.openQuestion(questionId) },
      consumeQuestion: () => { surface.consumeQuestion() },
    }),
  }, PhysicsSurface))

  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -1,
    locale: NS,
    inject: () => ({
      hooks: { physicsProfile: controller.store },
      select: (id: Parameters<typeof controller.select>[0]) => controller.select(id),
    }),
  }, PhysicsProfileSeat))

  ctx.inject(['connection', 'sessions'], (scope: ClientContext) => {
    const connection = scope.get('connection') as {
      api: {
        agentPresets: {
          select: (payload: { sessionId: string; agentPreset: string }) => Promise<{
            result: { ok: true; value: { agentPreset: string } } | { ok: false; error: { message: string } }
          }>
        }
      }
    }
    controller.attach(connection.api, () => {
      const state = scope.sessions.list.getSnapshot() as {
        current?: string
        byId: Record<string, { id: string; blank: boolean; agentPreset?: string }>
      }
      const summary = state.current === undefined ? undefined : state.byId[state.current]
      return summary === undefined
        ? undefined
        : {
          id: summary.id,
          blank: summary.blank,
          ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
        }
    })

    scope.effect(() => {
      const stop = scope.sessions.list.subscribe(() => { void controller.apply() })
      return () => { stop() }
    }, 'ui-physicsos: apply mapped preset')

    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-preset',
      priority: -1,
      order: -10,
      locale: NS,
      inject: () => ({ hooks: { physicsProfile: controller.store } }),
    }, PhysicsProfileLabel))
  })
}
