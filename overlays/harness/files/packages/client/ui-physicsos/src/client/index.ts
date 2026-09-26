/**
 * PhysicsOS Web Client overlay. Occupies declared sidebar / hero holes.
 * Does not replace ConversationRoot, Agent Loop, Session, or Tools.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PromptContentPart, RpcResult, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { mountPhysicsOSChrome } from './chrome.ts'
import { createAdminApi, createAuthApi } from './auth-api.ts'
import { createClassApi } from './class-api.ts'
import { createLearningApi } from './learning-api.ts'
import { createModelPoolApi } from './model-pool-api.ts'
import { createNoticeApi } from './notice-api.ts'
import { PlatformNoticeDialog, UpstreamOnboardingSink } from './PlatformNoticeDialog.tsx'
import { createAuthController } from './auth-store.ts'
import { AuthGate } from './AuthGate.tsx'
import { HomeActions } from './HomeActions.tsx'
import { HomeBrand } from './HomeBrand.tsx'
import { createLearningRecordController } from './learning-record-store.ts'
import { PhysicsSurface } from './LabWorkspace.tsx'
import { createAgentSceneSync } from './physics/agent-scene-sync.ts'
import { PhysicsProfileLabel } from './PhysicsProfileLabel.tsx'
import { PhysicsProfileSeat } from './PhysicsProfileSeat.tsx'
import { createPhysicsProfileController } from './profile-store.ts'
import { RecentSpaces } from './RecentSpaces.tsx'
import { SceneChatCard } from './SceneChatCard.tsx'
import { physicsSceneCardDefinition, physicsSceneTurnDefinition } from './scene-chat-node.ts'
import { SidebarBrand } from './SidebarBrand.tsx'
import { SidebarFooter } from './SidebarFooter.tsx'
import { SidebarNav } from './SidebarNav.tsx'
import { SidebarNew } from './SidebarNew.tsx'
import { createPaperApi } from './paper-api.ts'
import { createPhysicsSurfaceController, type PhysicsSceneRef } from './surface-store.ts'
import {
  WorkspacePanel, WorkspacePickerTrigger, createWorkspacePanelController,
  type AccountWorkspaceRow,
} from './WorkspacePanel.tsx'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import { en, zh, type PhysicsosKey } from './locales.ts'

export { PHYSICSOS_BUILT_AT, PHYSICSOS_BUILT_DAY, PHYSICSOS_VERSION, buildStamp } from './build-stamp.ts'
export type { PhysicsosKey } from './locales.ts'
export type { AuthApi, AuthUser, SchoolRow } from './auth-api.ts'
export type {
  NoticeApi, FeedbackRow, AnnouncementRow, PlatformNoticeRow,
} from './notice-api.ts'
export type { AuthState } from './auth-store.ts'
export type {
  ModelPoolApi, ModelPoolAuditRecord, ModelPoolChannelView, ModelPoolKeyView,
  ModelPoolProbeResult, ModelPoolState,
} from './model-pool-api.ts'
export type { AuthGateInjected, AuthGateProps } from './AuthGate.tsx'
export type {
  AdminPlatformNoticeTabProps,
} from './AdminPlatformNoticeTab.tsx'
export type { PlatformNoticeDialogInjected, PlatformNoticeDialogProps } from './PlatformNoticeDialog.tsx'
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
export type {
  AccountWorkspaceRow, WorkspacePanelController, WorkspacePanelInjected,
  WorkspacePanelProps, WorkspacePanelState, WorkspacePickerTriggerInjected,
  WorkspacePickerTriggerProps,
} from './WorkspacePanel.tsx'
export { createWorkspacePanelController } from './WorkspacePanel.tsx'
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
export const inject = ['slots', 'locale', 'workspaces', 'layout', 'sessions', 'conversationEvents']

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

  /**
   * 开新会话。
   *
   * 不带工作区时，Harness 会去要一个目录——那是**本机桌面专属**的能力
   * （`host.pickDirectory` / `host.listDirectory` 在服务器部署里被上游的本机
   * 闸门拒绝，公网域名下必然 403）。托管形态下账号在服务端已有自己的工作区：
   * auth-host 会把 `workspace.create` 改写成"该账号自己的那一个"，并且重复调用
   * 是幂等的（存在即返回，不会新建）。所以这里先确保它存在，再开会话，
   * 全程不碰本机目录选择器；失败时退回原行为，不影响单机版。
   */
  const workspacePanel = createWorkspacePanelController()

  const startSession = (workspaceId?: WorkspaceId): void => {
    if (workspaceId !== undefined) {
      ctx.workspaces.startSession(workspaceId)
      return
    }
    workspacePanel.open()
  }

  /* 账户体系 Auth V1: the cookie session resolves through /me; every per-user
     store below binds the account's localStorage namespace, so progress is
     owned by the account, not the browser. boot() runs alongside registration —
     the gate covers the shell until the first answer lands. */
  const authApi = createAuthApi()
  /* 账号同步通路: `/physicsos/learning` holds the signed-in student's own
     attempts and saved scenes, so two devices see the same record. */
  const learningApi = createLearningApi()
  /* `/physicsos/class` serves both faces of the class surface; the host decides
     what each role may read or write on every call. */
  const classApi = createClassApi()
  const auth = createAuthController(authApi, globalThis.localStorage)
  void auth.boot()

  /* 学习上报:每一次自测对错,按知识点各报一格。
     只发知识点 id 与对错 —— 答案原文、题干、账号都不出这台机器;学校与日期
     由服务端决定。尽力而为:上报失败不回滚本地记录,调用方也拿不到异常,
     因为「记下我这次错了」是本地的事,上报只是让学校看到哪个知识点普遍难。 */
  const reportLearning = (attempt: {
    readonly correct: boolean
    readonly knowledge: readonly string[]
  }): void => {
    for (const knowledgeId of attempt.knowledge) {
      void authApi.reportLearning({ knowledgeId, correct: attempt.correct }).catch(() => {
        /* 离线或会话过期:本地记录已经写好,不做补偿也不打扰学生。 */
      })
    }
  }

  /* localStorage-backed so 最近空间 survives a reload with restorable scenes;
     under an account it lands in that user's namespace. */
  const surface = createPhysicsSurfaceController(auth.userStorage, learningApi)
  const paperApi = createPaperApi()
  /* 管理后台: same cookie session, `/physicsos/admin` prefix. The component
     reads the role from the auth store; the host enforces it on every call. */
  const adminApi = createAdminApi()
  /* 反馈与公告: one client for both directions (`/physicsos/notice`). */
  const noticeApi = createNoticeApi()
  /* 模型通道: platform-wide pool and its encrypted upstream credentials. */
  const modelPoolApi = createModelPoolApi()

  const createAccountWorkspace = async (name: string): Promise<AccountWorkspaceRow> => {
    /* The host accepts only this virtual path: the title crosses the seam,
       while auth-host chooses and creates the real per-account directory. */
    const workspace = await ctx.workspaces.create({
      path: `physicsos-workspace://${encodeURIComponent(name)}`,
    })
    return { id: workspace.workspaceId, name }
  }

  const openAccountWorkspace = async (id: string): Promise<void> => {
    const sessionId = await ctx.workspaces.connectWorkspace(id as WorkspaceId)
    ctx.sessions.open(sessionId)
  }

  /* The student's attempt history: written by self-checks (the Lab's 自测 tab
     and golden-question cards), read by the 学习记录 surface. Persisted so the
     record survives a reload. Created before the scene card registers because
     the card's recordAttempt closure writes to it. */
  const learningRecord = createLearningRecordController(auth.userStorage, learningApi)

  /* 登录后对账一次:本地作答与最近场景先落盘,再把账号维度的那一份并回来。
     尽力而为 —— 离线或会话过期时本地记录照常可用,下一次登录再补一次。 */
  const syncLearning = (): void => {
    void learningRecord.sync().catch(() => {})
    void surface.sync().catch(() => {})
  }
  let syncedUserId = auth.store.getSnapshot().user?.id
  ctx.effect(() => {
    if (auth.store.getSnapshot().status === 'authed') syncLearning()
    return auth.store.subscribe(() => {
      const userId = auth.store.getSnapshot().user?.id
      if (userId === undefined || userId === syncedUserId) return
      syncedUserId = userId
      syncLearning()
    })
  }, 'ui-physicsos: learning sync')

  /* The inline scene card: every physics/scene snapshot the agent publishes
     materializes one chat node where the tool call left it (docs/04 §92). The
     card replays the published scene locally — the host's EventStore stays
     authoritative. */
  ctx.effect(
    () => ctx.conversationEvents.register(physicsSceneCardDefinition),
    'ui-physicsos: scene card definition',
  )
  ctx.effect(
    () => ctx.conversationEvents.register(physicsSceneTurnDefinition),
    'ui-physicsos: scene turn definition',
  )
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'physics-scene-card',
    locale: NS,
    inject: () => ({
      openSceneInLab: (ref: PhysicsSceneRef) => { surface.open('lab', ref) },
      recordAttempt: (attempt: Parameters<typeof learningRecord.record>[0]) => {
        learningRecord.record(attempt)
        reportLearning(attempt)
      },
    }),
  }, SceneChatCard))

  /* Account workspace manager: every normal entry that needs a workspace
     opens this panel. The panel reads the auth-host-filtered feed and never
     renders a host path, so the directory browser is not a product surface. */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'physicsos-workspace-panel',
    locale: NS,
    inject: () => ({
      hooks: {
        panel: workspacePanel.store,
        workspaces: ctx.workspaces.list,
      },
      createWorkspace: createAccountWorkspace,
      renameWorkspace: async (id: string, name: string) => {
        await ctx.workspaces.rename(id as WorkspaceId, name)
      },
      openWorkspace: openAccountWorkspace,
      close: workspacePanel.close,
    }),
  }, WorkspacePanel))

  /* Replace the upstream composer workspace picker. That picker's add action
     is the route into `host.listDirectory`; this occupant keeps the same slot
     but opens the account-scoped panel instead. */
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace',
    priority: -1,
    locale: NS,
    inject: () => ({
      hooks: {
        panel: workspacePanel.store,
        workspaces: ctx.workspaces.list,
      },
      openPanel: workspacePanel.open,
    }),
  }, WorkspacePickerTrigger))

  /* The auth gate: one root-scoped overlay entry that covers the shell while
     the session is unresolved, and holds the login/register/forgot flow for
     guests. Authed renders nothing — the shell underneath is the real app. */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'physicsos-auth-gate',
    locale: NS,
    inject: () => ({
      hooks: { auth: auth.store },
      login: auth.login,
      register: auth.register,
      forgotPassword: authApi.forgotPassword,
    }),
  }, AuthGate))

  /* Platform notice: versioned and account-scoped through notice-host. The
     settings.onboarding sink sits ahead of the upstream welcome + API-key
     steps and deliberately never completes, keeping Harness onboarding copy
     out of the PhysicsOS product. */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'physicsos-platform-notice',
    locale: NS,
    inject: () => ({
      api: noticeApi,
      hooks: { auth: auth.store },
    }),
  }, PlatformNoticeDialog))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'physicsos-upstream-onboarding-sink',
    order: -200,
  }, UpstreamOnboardingSink))

  ctx.slots.inject('sidebar.brand', () => ctx.slots.register({
    name: 'sidebar.brand',
    locale: NS,
    inject: () => ({
      hooks: { auth: auth.store },
      openHome: () => { surface.open('home') },
    }),
  }, SidebarBrand))

  ctx.slots.inject('sidebar.new', () => ctx.slots.register({
    name: 'sidebar.new',
    locale: NS,
    inject: () => ({
      startSession: () => { startSession() },
      openSurface: (
        id: 'lab' | 'home',
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
      hooks: { physicsSurface: surface.store, auth: auth.store },
      openSurface: (id: Parameters<typeof surface.open>[0], drawerOpen: boolean) => {
        surface.open(id)
        /* Below the layout shell's 1024px auto-collapse breakpoint the sidebar
           is a drawer. Navigating from the open drawer closes it; a tap on the
           resting rail must navigate without flipping the rail open, which is
           why the caller reports the sidebar's state instead of this reading
           the viewport alone. */
        if (drawerOpen && window.innerWidth < 1024) ctx.layout.toggleSidebar()
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
      removeRecent: (sceneId: string) => { surface.removeRecent(sceneId) },
      /* 历史对话 rows reopen the Harness session itself — the same verb the
         workspace browser uses; conversation state lives server-side. */
      openSession: (sessionId: SessionId) => { ctx.sessions.open(sessionId) },
      /* Archive is Harness's session-removal verb (session logs are durable);
         the row hides when archivedSessionIds echoes back. */
      archiveSession: (sessionId: SessionId) => {
        ctx.workspaces.archiveSession(sessionId)
          .catch((reason: unknown) => { console.warn('archive session failed:', reason) })
      },
    }),
  }, RecentSpaces))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'physicsos-footer',
    locale: NS,
    inject: () => ({
      hooks: { auth: auth.store },
      startSession: () => { startSession() },
      /* 学习记录 is a real surface now: attempts, mistakes, mastery. */
      openRecord: () => { surface.open('record') },
      openHome: () => { surface.open('home') },
      /* 管理后台 — the menu only shows this for admin roles. */
      openAdmin: () => { surface.open('admin') },
      logout: auth.logout,
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
        id: 'home' | 'lab' | 'record',
        sceneRef?: Parameters<typeof surface.open>[1],
      ) => {
        if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
        else surface.open(id, sceneRef)
      },
    }),
  }, HomeActions))

  const controller = createPhysicsProfileController(undefined, undefined, auth.userStorage)

  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -1,
    locale: NS,
    inject: () => ({
      hooks: { physicsProfile: controller.store },
      select: (id: Parameters<typeof controller.select>[0]) => controller.select(id),
    }),
  }, PhysicsProfileSeat))

  ctx.inject(['connection', 'sessions', 'workspaces'], (scope: ClientContext) => {
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

    /* Agent → Lab mirroring (docs/04 §92): the host folds every scene the model
       touches through the physics tools into the session's `physicsScenes`
       projection, which rides the session list rows. The first value seen for
       a session only becomes the active scene; a later revision opens the Lab. */
    const agentScenes = createAgentSceneSync({
      adoptScene: (ref) => { surface.open(surface.store.getSnapshot().surface, ref) },
      showScene: (ref) => { surface.open('lab', ref) },
    })
    const mirrorAgentScene = (): void => {
      const state = scope.sessions.list.getSnapshot() as {
        current?: string
        byId: Record<string, { projectionValues?: Record<string, unknown> }>
      }
      const summary = state.current === undefined ? undefined : state.byId[state.current]
      agentScenes.apply(state.current, summary?.projectionValues?.['physicsScenes'])
    }
    scope.effect(() => {
      mirrorAgentScene()
      const stop = scope.sessions.list.subscribe(mirrorAgentScene)
      return () => { stop() }
    }, 'ui-physicsos: mirror agent scenes')

    /* Practice hand-off: a golden question's stem reaches the tutor agent as one
       queued prompt on the student's current session — the tutor, never the UI,
       owns interpretation; the solved scene card streams back into the chat. */
    const submitToTutor = async (
      text: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      let sessionId = scope.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        /* startSession is asynchronous: the workspace connect resolves, then
           sessions.open publishes the new current id. Wait briefly for it. */
        scope.workspaces.startSession()
        sessionId = await new Promise<SessionId | undefined>((resolve) => {
          const timer = setTimeout(() => { stop(); resolve(undefined) }, 8000)
          const stop = scope.sessions.list.subscribe(() => {
            const current = scope.sessions.list.getSnapshot().current
            if (current !== undefined) {
              clearTimeout(timer)
              stop()
              resolve(current)
            }
          })
        })
        if (sessionId === undefined) {
          return { ok: false, error: '未能创建学习会话——请先在对话页开始一次学习，再上传题目。' }
        }
      }
      const sessionCtx = scope.sessions.scope(sessionId)
      const session = sessionCtx === undefined ? undefined : scope.sessions.sessionOf(sessionCtx)
      if (session === undefined) {
        return { ok: false, error: '学习会话尚未就绪，请稍后重试。' }
      }
      const parts: PromptContentPart[] = [{ type: 'text', text }]
      const result: RpcResult<{ accepted: true }> = await session.prompt(parts, 'queue')
      return result.ok ? { ok: true } : { ok: false, error: result.error.message }
    }

    /* 重新练习 / 题库练习 → the golden stem goes to the tutor; on success the
       surface returns to the conversation so the student watches the solve
       card stream in where the answer lives. */
    const practiceQuestion = async (
      questionId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const golden = GOLDEN_QUESTIONS.find(question => question.id === questionId)
      if (golden === undefined) {
        return { ok: false, error: `题库中找不到这道题（${questionId}）。` }
      }
      const result = await submitToTutor(
        `这是学生要练习的题目：\n\n${golden.text}\n\n请调用 physics_solve_question 求解（text 传上方题干原文，questionId 传 "${golden.id}"），把场景、推导步骤与验证结果展示给学生。`,
      )
      if (result.ok) surface.open('home')
      return result
    }

    scope.slots.inject('conversation.surface', () => scope.slots.register({
      name: 'conversation.surface',
      locale: NS,
      inject: () => ({
        hooks: {
          physicsSurface: surface.store,
          learningRecord: learningRecord.store,
          /* Persisted recent scenes — RecentSpaces, HomeActions and the Lab
            restore the newest scene from here. */
          recentExperiments: surface.recent,
          /* 管理后台 reads the session role from here. */
          auth: auth.store,
        },
        /* 出卷专区 talks to the host's `/physicsos/paper` REST surface; the
           client is one injected callback bag, built once in apply. */
        paperApi,
        adminApi,
        noticeApi,
        classApi,
        modelPoolApi,
        /* 公告离线缓存落在账户命名空间里(方案 2.3 的「缓存上一条」)——
           本校公告不该跟着另一个账号登录出现在下一块屏幕上。 */
        noticeStorage: auth.userStorage,
        openSurface: (
          id: Parameters<typeof surface.open>[0],
          sceneRef?: Parameters<typeof surface.open>[1],
        ) => {
          /* A handover with a scene always lands in the Lab, whatever surface the
            caller was on when it created the scene. */
          if (sceneRef === undefined) surface.open(id)
          else surface.open('lab', sceneRef)
        },
        /* Toolbar 切换实验: chooser over the running scene, resumable. */
        openExperimentPicker: () => { surface.openExperimentPicker() },
        /* 实验中心 → 自由搭建: open the Lab assembling a circuit, not reading one. */
        openBuilder: (sceneRef: Parameters<typeof surface.openBuilder>[0]) => {
          surface.openBuilder(sceneRef)
        },
        /* Lab 自测 / golden-card self-checks → 学习记录;
           学习记录 → 重新练习 → tutor prompt in the conversation. */
        recordAttempt: (attempt: Parameters<typeof learningRecord.record>[0]) => {
          learningRecord.record(attempt)
          reportLearning(attempt)
        },
        practiceQuestion,
      }),
    }, PhysicsSurface))

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
