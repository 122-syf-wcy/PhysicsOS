// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HomeActions } from '../src/client/HomeActions.tsx'
import { HomeHero, type HomeHeroProps } from '../src/client/HomeHero.tsx'
import { PhysicsProfileSeat } from '../src/client/PhysicsProfileSeat.tsx'
import { createPhysicsProfileController, readStoredProfile } from '../src/client/profile-store.ts'
import { STUDENT_PROFILES, TEACHER_PROFILES, runtimePresetOf } from '../src/client/profiles.ts'
import { HomeBrand, HomeBrandMark } from '../src/client/HomeBrand.tsx'
import { PhysicsOSMark } from '../src/client/PhysicsOSMark.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { SceneChatCard } from '../src/client/SceneChatCard.tsx'
import { RecentSpaces, type RecentSpacesProps } from '../src/client/RecentSpaces.tsx'
import { SidebarBrandMark, SidebarBrandName } from '../src/client/SidebarBrand.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import {
  AdminPanelIcon, LabPanelIcon, LibraryPanelIcon, NoticePanelIcon,
  PaperPanelIcon, RecordPanelIcon,
} from '../src/client/SidebarPanels.tsx'
import type { AuthUser } from '../src/client/auth-api.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { fillComposerDraft } from '../src/client/fill-draft.ts'
import { createPhysicsSurfaceController, type PhysicsSceneRef } from '../src/client/surface-store.ts'
import {
  createExperimentSceneRef,
  EXPERIMENT_TEMPLATES,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { formatUpdatedAt, workspaceKnowledge } from '../src/client/workspaceMeta.ts'
import { en, zh } from '../src/client/locales.ts'
import { processQuestion } from '@physicsos/question-core'
import { cardSession, solvedCardData } from './solved-card-fixture.client.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

/** A bound auth store for one role, for the surfaces that gate on it. */
const useAuthAs = (role?: AuthUser['role']) => {
  const state: AuthState = role === undefined
    ? { status: 'guest' }
    : {
      status: 'authed',
      user: {
        id: 'u-spec', schoolId: 'sch-spec', schoolName: '规格中学',
        username: 'spec', displayName: '规格用户', role,
      },
    }
  return function boundAuth<T>(selector: (snapshot: AuthState) => T): T { return selector(state) }
}

/* Live hooks for tests that render the experiment picker: the library home
   reads both stores (继续上次实验 / 为你推荐). Workspace-only renders keep
   neverHook so an unexpected read still fails loudly. */
const emptyRecent: PhysicsSurfaceProps['useRecentExperiments'] =
  selector => selector({ items: [] })
const emptyRecord: PhysicsSurfaceProps['useLearningRecord'] =
  selector => selector({ attempts: [] })

/** Session-list hook backed by a fixed snapshot, for sidebar history specs. */
const sessionsHook = (state: {
  ids: string[]
  byId: Record<string, {
    id: string
    displayTitle: string
    updatedAt: number
    blank: boolean
    running: boolean
    retainedBy: Readonly<Record<string, number>>
    origin?: 'subagent'
  }>
  current?: string
}): RecentSpacesProps['useSessions'] =>
  ((selector: (snapshot: never) => unknown) => selector({
    ids: state.ids,
    byId: state.byId,
    current: state.current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as never)) as never
const emptySessions = sessionsHook({ ids: [], byId: {} })
/** Workspaces hook exposing only the archive set the history list reads. */
const workspacesHook = (archivedSessionIds: string[] = []): RecentSpacesProps['useWorkspaces'] =>
  ((selector: (snapshot: { archivedSessionIds: string[] }) => unknown) =>
    selector({ archivedSessionIds })) as never
const emptyWorkspaces = workspacesHook()

/**
 * Open the Lab on a template's real scene.
 *
 * The Lab no longer auto-loads a demo when it has no scene — it shows the
 * experiment picker — so a test that wants a workspace has to pick an experiment,
 * exactly as a student does. Built through the registry so the test exercises the
 * production scene, not a fixture that can drift from it.
 */
const openLabOnTemplate = (
  surface: ReturnType<typeof createPhysicsSurfaceController>,
  templateId: string,
): void => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown experiment template: ${templateId}`)
  surface.open('lab', createExperimentSceneRef(template, t(template.label)))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})


/** Render the card a `physics_solve_question` turn leaves in the chat, driven
    by a golden question through the real Question Runtime. */
const renderSolved = (
  questionId: string,
  openSceneInLab: (ref: PhysicsSceneRef) => void = vi.fn(),
) =>
  render(
    <SceneChatCard {...({
      node: {
        key: `card:${questionId}`, kind: 'physics-scene-card', anchorSeq: 1.9,
        data: solvedCardData(questionId),
      },
      t,
      openSceneInLab,
      useChat: cardSession(),
    } as unknown as Parameters<typeof SceneChatCard>[0])} />,
  )

describe('PhysicsOS overlay presentation', () => {
  it('renders the generated orbital-lens mark', () => {
    const { container } = render(<PhysicsOSMark />)
    const mark = container.querySelector('img')
    expect(mark?.getAttribute('src')).toBe('/physicsos/brand/physicsos-mark-128.png')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders the wide wordmark with the school tenant', () => {
    render(
      <SidebarBrandName
        useAuth={useAuthAs('STUDENT')}
        t={t}
      />,
    )
    expect(screen.getByText('PhysicsOS')).toBeTruthy()
    expect(screen.getByText('规格中学')).toBeTruthy()
  })

  /* The shell owns the brand row, the New Session control, and the panel rows
     in 0.1.7, so the product contributes occupants rather than a private rail:
     the mark at the shell's requested edge, and one glyph per surface. */
  it('renders the brand mark at the shell-requested edge', () => {
    const { container } = render(<SidebarBrandMark size={24} />)
    expect(container.querySelector('img')?.getAttribute('src'))
      .toBe('/physicsos/brand/physicsos-mark-128.png')
    expect(container.querySelector('img')?.getAttribute('width')).toBe('24')
  })

  it('renders one product glyph per panellist row at the requested edge', () => {
    for (const [Glyph, label] of [
      [LabPanelIcon, '物理实验室'],
      [NoticePanelIcon, '反馈'],
      [LibraryPanelIcon, '资源库'],
      [RecordPanelIcon, '学习记录'],
      [PaperPanelIcon, '出卷专区'],
      [AdminPanelIcon, '管理后台'],
    ] as const) {
      const { container } = render(<Glyph size={18} active={false} />)
      const svg = container.querySelector('svg')
      expect(svg, label).not.toBeNull()
      expect(svg?.getAttribute('width'), label).toBe('18')
      /* The shell owns the row's accessible name; the glyph is decorative. */
      expect(container.querySelector('button'), label).toBeNull()
      cleanup()
    }
  })

  it('scopes the hero mark to the shell headline without adding chrome', () => {
    const { container } = render(<HomeBrandMark size={34} className="headline-mark" />)
    const mark = container.querySelector('img')
    expect(mark?.getAttribute('src')).toBe('/physicsos/brand/physicsos-mark-128.png')
    expect(mark?.getAttribute('class')).toContain('headline-mark')
  })

  it('keeps unavailable footer destinations disabled', () => {
    const startSession = vi.fn()
    render(
      <SidebarFooter
        wide
        startSession={startSession}
        openHome={vi.fn()}
        logout={vi.fn(async () => {})}
        useAuth={selector => selector({ status: 'guest' })}
        t={t}
      />,
    )
    /* 学习记录 is a live destination (the learning-record surface); the footer
       carries no 资源库 row at all — the live entry lives in the nav rail. */
    fireEvent.click(screen.getByRole('button', { name: '学习记录' }))
    expect(screen.getByRole('button', { name: '学习记录' }).getAttribute('disabled')).toBeNull()
    expect(screen.queryByRole('button', { name: '资源库' })).toBeNull()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('renders the home brand copy', () => {
    render(<HomeBrand t={t} />)
    expect(screen.getByText('PhysicsOS')).toBeTruthy()
    expect(screen.getByText('探索一个物理世界')).toBeTruthy()
    expect(screen.getByText('描述一个物理现象、创建实验，或直接输入一道试题。')).toBeTruthy()
  })

  it('lists recent real scenes as a compact row and restores one on click', () => {
    const startSession = vi.fn()
    const template = findExperimentTemplate('magnetic-circular')
    if (template === undefined) throw new Error('magnetic-circular template missing')
    const ref = createExperimentSceneRef(template, '磁场实验')
    const useRecentExperiments = ((
      selector: (s: {
        items: {
          sceneId: string
          title: string
          domain: string
          kind: string
          updatedAt: string
          scene: unknown
        }[]
      }) => unknown,
    ) =>
      selector({
        items: [{
          sceneId: ref.sceneId,
          title: '磁场实验',
          domain: 'magnetic',
          kind: 'experiment',
          updatedAt: '2026-08-01T00:00:00.000Z',
          scene: ref.scene,
        }],
      })) as never
    const openSurface = vi.fn()
    render(
      <HomeActions
        startSession={startSession}
        openSurface={openSurface}
        useRecentExperiments={useRecentExperiments}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建物理实验' }))
    fireEvent.click(screen.getByRole('button', { name: '题目练习' }))
    fireEvent.click(screen.getByRole('button', { name: '打开场景' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览实验模板' }))
    expect(screen.getByText('电磁学 / 磁场与洛伦兹力 · 实验')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /磁场实验/ }))
    expect(openSurface).toHaveBeenNthCalledWith(1, 'lab')
    expect(openSurface).toHaveBeenNthCalledWith(2, 'record')
    /* The recent row restores the REAL stored scene, not a session. */
    expect(openSurface).toHaveBeenLastCalledWith('lab', { sceneId: ref.sceneId, scene: ref.scene })
    expect(screen.getByRole('button', { name: '打开场景' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: '浏览实验模板' }).getAttribute('disabled')).not.toBeNull()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('shows the empty physics-world state', () => {
    const startSession = vi.fn()
    const openSurface = vi.fn()
    const useRecentExperiments = ((selector: (s: { items: never[] }) => unknown) =>
      selector({ items: [] })) as never
    render(
      <HomeActions
        startSession={startSession}
        openSurface={openSurface}
        useRecentExperiments={useRecentExperiments}
        t={t}
      />,
    )
    expect(screen.getByText('正电粒子垂直进入匀强磁场')).toBeTruthy()
    expect(screen.getByText('比较不同角度的平抛轨迹')).toBeTruthy()
    expect(screen.getByText('为什么洛伦兹力不做功？')).toBeTruthy()
    expect(screen.getByText('最近空间')).toBeTruthy()
    expect(screen.getByText('还没有创建物理世界')).toBeTruthy()
    expect(screen.getByText(/PhysicsOS 会为你建立对应的物理世界/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建物理实验' }))
    expect(openSurface).toHaveBeenCalledWith('lab')
    expect(startSession).not.toHaveBeenCalled()
  })

  it('derives knowledge labels without claiming Engine output', () => {
    expect(workspaceKnowledge('磁场实验')).toEqual({ subject: '电磁学', topic: '磁场与洛伦兹力' })
    expect(workspaceKnowledge('untitled')).toEqual({ subject: '物理', topic: '待标注知识点' })
    expect(
      formatUpdatedAt('2026-08-16T06:29:00.000Z', Date.parse('2026-08-16T06:29:30.000Z')),
    ).toBe('刚刚')
  })

  it('keeps the English dictionary aligned with Chinese keys', () => {
    expect(Object.keys(en)).toEqual(Object.keys(zh))
  })

  it('maps student profiles onto Harness presets without exposing coding ids', () => {
    expect(STUDENT_PROFILES.map(profile => profile.id)).toEqual([
      'physics-experiment',
      'physics-question',
      'physics-tutor',
    ])
    expect(TEACHER_PROFILES.map(profile => profile.id)).toEqual(['physics-teacher'])
    expect(STUDENT_PROFILES.every(profile => runtimePresetOf(profile.id) === 'physics-student')).toBe(
      true,
    )
    expect(TEACHER_PROFILES.map(profile => profile.runtimePreset)).toEqual(['standard'])
    expect(readStoredProfile({ getItem: () => 'physics-question' })).toBe('physics-question')
    expect(readStoredProfile({ getItem: () => 'standard' })).toBe('physics-experiment')
  })

  it('keeps the product choice locally until the Harness host attaches', async () => {
    const select = vi.fn(async () => ({
      result: { ok: true as const, value: { agentPreset: 'physics-student' } },
    }))
    const controller = createPhysicsProfileController()
    await controller.select('physics-tutor')
    expect(controller.store.getSnapshot().current).toBe('physics-tutor')
    expect(select).not.toHaveBeenCalled()
    controller.attach({ agentPresets: { select } }, () => ({ id: 's2', blank: true }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ sessionId: 's2', agentPreset: 'physics-student' })
    })
  })

  /* `新建` is the shell's New Session control now (it starts a session, the
     way every other Harness product does). "新建物理实验" is a product creation
     intent, so it lives with the other product entrances on the blank-Session
     hero; the hero itself must disappear once the Session is engaged. */
  const heroProps = (
    blank: boolean,
    openSurface: (id: 'home' | 'lab' | 'record', sceneRef?: never) => void,
  ): HomeHeroProps => ({
    useSession: <S,>(selector: (snapshot: { blank: boolean }) => S): S => selector({ blank }),
    useRecentExperiments: (selector: (snapshot: { items: never[] }) => unknown) =>
      selector({ items: [] }),
    openSurface,
    t,
  }) as unknown as HomeHeroProps

  it('shows the product front page on a blank Session and creates through the picker', () => {
    const openSurface = vi.fn()
    render(
      <HomeHero {...heroProps(true, openSurface)} />,
    )
    expect(screen.getByText('探索一个物理世界')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建物理实验' }))
    expect(openSurface).toHaveBeenCalledWith('lab')
  })

  it('keeps the front page out of an engaged Session', () => {
    const { container } = render(
      <HomeHero {...heroProps(false, vi.fn())} />,
    )
    expect(container.querySelector('[data-physicsos-home]')).toBeNull()
  })

  it('offers only PhysicsOS profiles and selects the mapped Harness preset', async () => {
    const select = vi.fn(async () => ({
      result: { ok: true as const, value: { agentPreset: 'physics-student' } },
    }))
    const controller = createPhysicsProfileController({ agentPresets: { select } }, () => ({
      id: 's1',
      blank: true,
    }))
    render(
      <PhysicsProfileSeat
        usePhysicsProfile={selector => selector(controller.store.getSnapshot())}
        select={id => controller.select(id)}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '学习模式' }))
    expect(screen.getByRole('menuitem', { name: /探索模式/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /解题模式/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /引导模式/ })).toBeTruthy()
    expect(screen.queryByText('标准模式')).toBeNull()
    expect(screen.queryByText(/bash|Code Mode|str_replace_editor|SDK/)).toBeNull()
    expect(screen.getByText('自由实验、修改参数、观察规律。')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /解题模式/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ sessionId: 's1', agentPreset: 'physics-student' })
    })
  })

  it('fills the composer from an example chip', () => {
    const area = document.createElement('textarea')
    document.body.append(area)
    fillComposerDraft('正电粒子垂直进入匀强磁场')
    expect(area.value).toBe('正电粒子垂直进入匀强磁场')
    area.remove()
  })

  it('keeps the sidebar recent list compact when empty', () => {
    const useRecentExperiments = ((selector: (s: { items: never[] }) => unknown) =>
      selector({ items: [] })) as never
    render(
      <RecentSpaces
        wide
        openSurface={vi.fn()}
        removeRecent={vi.fn()}
        openSession={vi.fn()}
        archiveSession={vi.fn()}
        useRecentExperiments={useRecentExperiments}
        t={t}
        useSessions={emptySessions}
        useWorkspaces={emptyWorkspaces}
      />,
    )
    expect(screen.getByText('最近空间')).toBeTruthy()
    expect(screen.getByText('暂无最近空间')).toBeTruthy()
    expect(screen.getByText('历史对话')).toBeTruthy()
    expect(screen.getByText('暂无历史对话')).toBeTruthy()
    expect(screen.queryByText('工作区')).toBeNull()
  })

  it('lists real scenes in 最近空间 and restores one on click', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'velocity-selector')
    surface.open('home')
    const items = surface.recent.getSnapshot().items
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('速度选择器')
    expect(items[0]!.kind).toBe('experiment')

    const openSurface = vi.fn()
    const removeRecent = vi.fn()
    const useRecentExperiments = ((
      selector: (s: ReturnType<typeof surface.recent.getSnapshot>) => unknown,
    ) => selector(surface.recent.getSnapshot())) as never
    render(
      <RecentSpaces
        wide
        openSurface={openSurface}
        removeRecent={removeRecent}
        openSession={vi.fn()}
        archiveSession={vi.fn()}
        useRecentExperiments={useRecentExperiments}
        t={t}
        useSessions={emptySessions}
        useWorkspaces={emptyWorkspaces}
      />,
    )
    expect(screen.getByText('速度选择器')).toBeTruthy()
    expect(screen.getByText('实验')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /速度选择器/ }))
    expect(openSurface).toHaveBeenCalledWith('lab', {
      sceneId: items[0]!.sceneId,
      scene: items[0]!.scene,
    })
    fireEvent.click(screen.getByRole('button', { name: '从列表移除' }))
    expect(removeRecent).toHaveBeenCalledWith(items[0]!.sceneId)
  })

  it('lists past conversations in 历史对话 and reopens one on click', () => {
    const now = Date.now()
    const useSessions = sessionsHook({
      ids: ['s1', 's2', 's3', 's4'],
      byId: {
        s1: {
          id: 's1', displayTitle: '磁场题解答', updatedAt: now - 120_000,
          blank: false, running: false, retainedBy: { mainView: 1 },
        },
        s2: {
          id: 's2', displayTitle: '平抛运动讨论', updatedAt: now - 60_000,
          blank: false, running: false, retainedBy: {},
        },
        s3: {
          id: 's3', displayTitle: '空白会话', updatedAt: now,
          blank: true, running: false, retainedBy: {},
        },
        s4: {
          id: 's4', displayTitle: '子代理运行', updatedAt: now - 30_000,
          blank: false, running: false, retainedBy: {}, origin: 'subagent',
        },
        s5: {
          id: 's5', displayTitle: '已归档会话', updatedAt: now - 10_000,
          blank: false, running: false, retainedBy: {},
        },
      },
      current: 's1',
    })
    const openSession = vi.fn()
    const archiveSession = vi.fn()
    render(
      <RecentSpaces
        wide
        openSurface={vi.fn()}
        removeRecent={vi.fn()}
        openSession={openSession}
        archiveSession={archiveSession}
        useRecentExperiments={emptyRecent}
        t={t}
        useSessions={useSessions}
        useWorkspaces={workspacesHook(['s5'])}
      />,
    )
    /* Newest first; the blank session, the subagent run, and the archived row
       are not listed. */
    const names = screen.getAllByRole('button').map(b => b.textContent)
    expect(names.some(n => n?.includes('平抛运动讨论'))).toBe(true)
    expect(names.some(n => n?.includes('磁场题解答'))).toBe(true)
    expect(names.some(n => n?.includes('空白会话'))).toBe(false)
    expect(names.some(n => n?.includes('子代理运行'))).toBe(false)
    expect(names.some(n => n?.includes('已归档会话'))).toBe(false)
    expect(screen.getByRole('button', { name: /磁场题解答/ }).getAttribute('aria-current')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /平抛运动讨论/ }))
    expect(openSession).toHaveBeenCalledWith('s2')

    fireEvent.click(screen.getAllByRole('button', { name: '归档' })[1]!)
    expect(archiveSession).toHaveBeenCalledWith('s1')
  })

  it('persists recent scenes through storage so a reload can restore them', () => {
    const backing = new Map<string, string>()
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
    }
    const first = createPhysicsSurfaceController(storage)
    openLabOnTemplate(first, 'mass-spectrometer')

    const reloaded = createPhysicsSurfaceController(storage)
    const items = reloaded.recent.getSnapshot().items
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('质谱仪基础模型')
    expect(items[0]!.scene.schemaVersion).toBe('physics-scene/1.0')

    /* Removing persists too: a reload must not resurrect the entry. */
    reloaded.removeRecent(items[0]!.sceneId)
    expect(reloaded.recent.getSnapshot().items).toHaveLength(0)
    const again = createPhysicsSurfaceController(storage)
    expect(again.recent.getSnapshot().items).toHaveLength(0)
  })

  it('keeps the active scene across navigation and resumable behind the picker', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'projectile-horizontal')
    const opened = surface.store.getSnapshot().sceneRef
    expect(opened).toBeDefined()

    /* Leaving for Home and coming back resumes the same experiment. */
    surface.open('home')
    surface.open('lab')
    expect(surface.store.getSnapshot().sceneRef?.sceneId).toBe(opened!.sceneId)
    expect(surface.store.getSnapshot().experimentPicker).toBeUndefined()

    /* 切换实验 opens the chooser OVER the scene: flag set, scene kept. */
    surface.openExperimentPicker()
    const choosing = surface.store.getSnapshot()
    expect(choosing.experimentPicker).toBe(true)
    expect(choosing.sceneRef?.sceneId).toBe(opened!.sceneId)

    /* Resuming (plain lab open) clears the flag without losing the scene. */
    surface.open('lab')
    const resumed = surface.store.getSnapshot()
    expect(resumed.experimentPicker).toBeUndefined()
    expect(resumed.sceneRef?.sceneId).toBe(opened!.sceneId)
  })

  it('covers the conversation column with the Physics Lab workspace', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'magnetic-circular')
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(screen.getByText('磁场中的带电粒子运动')).toBeTruthy()
    expect(screen.getByText('场景与对象')).toBeTruthy()
    expect(screen.getByRole('img', { name: '磁场中的带电粒子运动' })).toBeTruthy()

    // Scene tree is a hierarchy, and formulas stay out of it.
    expect(screen.getByRole('button', { name: '场景' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /磁场区域/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /正电粒子/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /初始条件/ })).toBeTruthy()
    expect(screen.queryByText('r = mv / qB')).toBeNull()
    expect(screen.queryByText('F = qv × B')).toBeNull()

    // Inspector separates editable parameters from read-only derived values.
    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    expect(screen.getByText('粒子属性')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '读数' }))
    expect(screen.getByText('派生量由引擎计算，只读。')).toBeTruthy()
    expect(screen.getByText(/轨道半径/)).toBeTruthy()

    // Timeline transport and rate. The clock reads in the run window's own
    // engineering unit — a cyclotron period is ~1e-7 s, so it opens at 0.00 ns
    // rather than a rounded "0.00s".
    expect(screen.getByRole('button', { name: '后退一步' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '播放倍速' })).toBeTruthy()
    expect(screen.getByText(/^0\.00 (s|ms|µs|ns)$/)).toBeTruthy()

    // Toolbar run button is the only 运行 control; the timeline one is labelled.
    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()

    // Regression: an L-shaped grid path with no explicit fill tiles into a
    // black/white checkerboard, because SVG paths default to a black fill.
    const gridPaths = [...container.querySelectorAll('pattern path')]
    expect(gridPaths.length).toBeGreaterThan(0)
    expect(gridPaths.every(path => path.getAttribute('fill') === 'none')).toBe(true)
  })

  it('toggles observables from the scene tree', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'magnetic-circular')
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    const velocityLabels = () =>
      [...container.querySelectorAll('svg text')].filter(node => node.textContent === 'v').length
    expect(velocityLabels()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^速度$/ }))
    expect(velocityLabels()).toBe(0)
  })

  it('routes Inspector edits through a revisioned SceneCommand', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'magnetic-circular')
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')

    const input = screen.getByLabelText(/磁感应强度/)
    if (!(input instanceof HTMLInputElement)) throw new Error('B editor is not an input.')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)

    expect(lab?.getAttribute('data-scene-revision')).toBe('1')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(screen.getByRole('button', { name: /1.00 T/ })).toBeTruthy()
  })

  it('renders the real Question Runtime as a solved card in the conversation', () => {
    renderSolved('01-proton-basic')

    expect(screen.getByText('题目理解')).toBeTruthy()
    expect(screen.getAllByText('质子垂直进入匀强磁场').length).toBeGreaterThan(0)
    expect(screen.getByText('已验证')).toBeTruthy()
    expect(screen.getAllByText(/轨道半径/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('renders every mechanics question family through the shared verified canvas', () => {
    for (const [questionId, title] of [
      ['mech-01-uniform-acceleration', '匀加速直线运动'],
      ['mech-02-projectile-horizontal', '平抛运动'],
      ['mech-03-projectile-oblique', '斜抛运动'],
      ['mech-04-newton-second-law', '牛顿第二定律'],
      ['mech-05-incline-no-friction', '无摩擦斜面'],
    ] as const) {
      const view = renderSolved(questionId)
      expect(screen.getByText('已验证')).toBeTruthy()
      const canvas = screen.getByRole('img')
      expect(canvas.getAttribute('aria-label')).toContain('可验证物理画布')
      const viewBox = canvas.getAttribute('viewBox')?.split(' ').map(Number)
      expect(viewBox).toBeDefined()
      expect((viewBox?.[2] ?? 1) / (viewBox?.[3] ?? 1), title).toBeLessThan(2.2)
      expect(screen.getByRole('button', { name: '播放 / 暂停' })).toBeTruthy()
      view.unmount()
    }
  })

  it('advances a solved card between simulation samples on animation frames', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrameId += 1
      frames.set(nextFrameId, callback)
      return nextFrameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    renderSolved('mech-01-uniform-acceleration')

    fireEvent.click(screen.getByRole('button', { name: '播放 / 暂停' }))
    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(116.67) })

    /* The question states 运动 5 s — the scene timeline ends there, not at the
       engine's old default 10 s. The scrubber reports it via aria-valuetext. */
    const scrubber = screen.getByRole('slider', { name: '时间轴' })
    expect(scrubber.getAttribute('aria-valuetext')).toBe('0.02 s / 5.00 s')
    expect(screen.getByText('5.00 s')).toBeTruthy()
  })

  it('renders the derivation in exam steps: formula, substitution, result', () => {
    const { container } = renderSolved('mech-01-uniform-acceleration')

    /* Step rows carry the original formula, the substituted values (with
       units — the marking standard requires them), then the result. KaTeX
       splits each expression into spans, so match on the row's textContent. */
    expect(screen.getByText('解题步骤')).toBeTruthy()
    const substitutions = container.querySelectorAll('[class*="stepSubstitution"]')
    const strip = (text: string) => text.replace(/\s+/g, '')
    const substitutionText = strip(
      Array.from(substitutions, el => el.textContent ?? '').join('\n'),
    )
    expect(substitutionText).toContain('v=(10m/s)+(2m/s2)×(5s)')
    expect(substitutionText).toContain('s=(10m/s)×(5s)')
    /* 答案：every sought quantity restated with symbol, value and unit. */
    const answers = container.querySelectorAll('[class*="answerList"] li')
    const answerText = strip(Array.from(answers, el => el.textContent ?? '').join('\n'))
    expect(answerText).toContain('20.00m/s')
    expect(answerText).toContain('75.00m')
  })

  it('opens the exact verified mechanics Scene in the full Physics Lab', () => {
    const surface = createPhysicsSurfaceController()
    let opened: PhysicsSceneRef | undefined
    const questionView = renderSolved('mech-01-uniform-acceleration', (ref) => { opened = ref })

    const openButton = screen.getByRole('button', { name: '在物理世界中打开' })
    fireEvent.click(openButton)
    expect(opened).toBeDefined()
    expect(opened!.sceneId).toBe(opened!.scene.id)
    questionView.unmount()
    surface.open('lab', opened)

    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '匀加速直线运动' })).toBeTruthy()
    expect(screen.getByText('引擎已验证')).toBeTruthy()
    expect(screen.getByRole('img', { name: '匀加速直线运动的可验证物理画布' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放 / 暂停' })).toBeTruthy()

    /* A question scene is editable in the Lab: continuing the same revisioned
       Scene is what keeps solve and experiment in one physical world, and an edit
       is a new revision rather than a second source of truth. */
    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const massInput = screen.getByRole('textbox', { name: '质量' })
    if (!(massInput instanceof HTMLInputElement)) throw new Error('mass editor is not an input.')
    fireEvent.change(massInput, { target: { value: '3' } })
    fireEvent.blur(massInput)
    expect(
      container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-scene-revision'),
    ).toBe('1')
  })

  it('rejects a question text that names no physics, honestly', () => {
    const result = processQuestion({
      id: 'junk-question',
      content: { source: 'text', rawText: '这是一个没有物理条件的题目', extractedText: '这是一个没有物理条件的题目', status: 'EXTRACTED' },
      metadata: { title: 'junk', tags: [], difficulty: 'standard' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never)
    /* Text naming no physics subject surfaces an honest parse failure — no
       scene, no fabricated IR — so the tutor can ask for clarification. */
    expect(result.scene).toBeNull()
    expect(result.workflowState).not.toBe('READY')
  })

  it('builds a real mechanics Scene from a template in the experiment picker', () => {
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    /* The picker lists every domain; mechanics is reachable from 全部. The
       recommendation rail repeats a few names, so match all and click the first. */
    expect(container.querySelector('[data-physicsos-state="picker"]')).toBeTruthy()
    expect(screen.getByText('实验中心')).toBeTruthy()
    const projectiles = screen.getAllByRole('button', { name: /平抛运动/ })
    expect(projectiles.length).toBeGreaterThan(0)
    fireEvent.click(projectiles[0]!)

    const state = surface.store.getSnapshot()
    expect(state.surface).toBe('lab')
    expect(state.sceneRef).toBeDefined()
    expect(state.sceneRef?.sceneId).toBeTruthy()
    /* A freshly created scene gets a unique id (base + timestamp), never the
       stale fixture id the old popover pinned. */
    expect(state.sceneRef?.sceneId).not.toBe('mechanics-projectile-horizontal')
    const mechanics = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(mechanics.container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
  })

  it('exposes every experiment domain in the picker, not just mechanics', () => {
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(container.querySelector('[data-physicsos-state="picker"]')).toBeTruthy()
    /* The four domains the runtime dispatch supports, all as pickable entries.
       Some names repeat on the recommendation rail, so presence means ≥ 1 button. */
    for (const name of [/匀速直线运动/, /单点电荷电场/, /磁场中的带电粒子运动/, /速度选择器/, /质谱仪基础模型/]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }
    /* The cyclotron became creatable when the composite engine learned the
       time-varying gap; the picker offers it like any other experiment. */
    const cyclotron = screen.getByRole('button', { name: /回旋加速器/ })
    expect(cyclotron.getAttribute('disabled')).toBeNull()
  })

  it('declares a 学段 on every template and fills both partitions', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      expect(['junior', 'senior'], `template ${template.id} needs a 学段`)
        .toContain(template.stage)
    }
    /* Both partitions hold real, creatable experiments — 初中 is a curriculum,
       not a token entry next to the senior list. */
    const creatable = (stage: 'junior' | 'senior') => EXPERIMENT_TEMPLATES.filter(
      template => template.stage === stage && template.comingSoon !== true,
    )
    expect(creatable('junior').length).toBeGreaterThanOrEqual(7)
    expect(creatable('senior').length).toBeGreaterThanOrEqual(10)
    /* The named 初中 staples exist, sit in the junior partition and create. */
    for (const id of [
      'average-speed', 'series-circuit', 'parallel-circuit', 'rheostat-circuit',
      'va-resistance', 'bulb-power', 'lever-balance',
    ]) {
      const template = findExperimentTemplate(id)
      expect(template?.stage, id).toBe('junior')
      expect(template?.comingSoon, id).toBeUndefined()
    }
  })

  it('partitions the grid by 学段 and badges every card with its stage', () => {
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    /* Grid entries (and only they) carry data-stage; the rail stays personal. */
    const gridStages = () => new Set(
      [...container.querySelectorAll('button[data-stage]')]
        .map(entry => entry.getAttribute('data-stage')),
    )
    expect(gridStages()).toEqual(new Set(['junior', 'senior']))
    for (const entry of container.querySelectorAll('button[data-stage]')) {
      expect(entry.textContent).toContain(
        entry.getAttribute('data-stage') === 'junior' ? '初中' : '高中',
      )
    }

    /* 初中 keeps the junior curriculum only: the staples surface, the
       senior-only rigs leave the grid (the classics rail is not a partition). */
    fireEvent.click(screen.getByRole('tab', { name: '初中' }))
    expect(gridStages()).toEqual(new Set(['junior']))
    for (const name of [/测量平均速度/, /伏安法测电阻/, /测量小灯泡的电功率/, /串联电路/]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }
    expect(
      [...container.querySelectorAll('button[data-stage]')]
        .some(entry => (entry.textContent ?? '').includes('测电源电动势与内阻')),
    ).toBe(false)

    /* 高中 flips the partition. */
    fireEvent.click(screen.getByRole('tab', { name: '高中' }))
    expect(gridStages()).toEqual(new Set(['senior']))

    /* 全学段 restores the union. */
    fireEvent.click(screen.getByRole('tab', { name: '全学段' }))
    expect(gridStages()).toEqual(new Set(['junior', 'senior']))
  })

  it('creates a junior circuit experiment straight from the 初中 partition', () => {
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '初中' }))
    fireEvent.click(screen.getByRole('button', { name: /伏安法测电阻/ }))
    const state = surface.store.getSnapshot()
    expect(state.surface).toBe('lab')
    /* A real stamped scene from the registry, in the circuit domain. */
    expect(state.sceneRef?.sceneId).toMatch(/^circuit-va-resistance-/)
  })

  it('offers 继续上次实验 from the persisted recent scene and restores it', () => {
    /* Two controllers over one storage simulate a reload: the first session
       creates the scene, the second finds it persisted. */
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
    }
    const first = createPhysicsSurfaceController(storage)
    openLabOnTemplate(first, 'velocity-selector')
    const created = first.store.getSnapshot().sceneRef
    expect(created).toBeDefined()

    const reloaded = createPhysicsSurfaceController(storage)
    reloaded.open('lab')
    render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={selector => selector(reloaded.recent.getSnapshot())}
        usePhysicsSurface={selector => selector(reloaded.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          reloaded.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    const card = screen.getByRole('button', { name: /继续上次实验/ })
    expect(card.getAttribute('data-physicsos-continue')).toBe('stored')
    expect(card.textContent).toContain('速度选择器')
    expect(card.textContent).toContain('复合场')

    /* Restoring hands the STORED scene back to the Lab — same scene id, not a
       fresh template instantiation. */
    fireEvent.click(card)
    const state = reloaded.store.getSnapshot()
    expect(state.surface).toBe('lab')
    expect(state.sceneRef?.sceneId).toBe(created!.sceneId)
  })

  it('recommends weakness-targeted experiments from the learning record', () => {
    globalThis.localStorage?.removeItem('physicsos.recent-experiments')
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    /* One wrong self-check on 洛伦兹力 + 圆周运动: both nodes map to the same
       experiment, so the rail shows ONE weakness card plus classic fill. */
    const attempts = [{
      id: 'attempt-1',
      questionId: '01-proton-basic',
      questionTitle: '质子垂直进入匀强磁场',
      selfCheckId: 'sc-1',
      prompt: '洛伦兹力做功吗？',
      answerId: 'wrong',
      answerLabel: '做正功',
      correct: false,
      mistakeType: 'concept' as const,
      knowledge: ['em-lorentz', 'em-circular'],
      at: new Date().toISOString(),
    }]
    render(
      <PhysicsSurface
        useLearningRecord={selector => selector({ attempts })}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(screen.getByText('为你推荐')).toBeTruthy()
    const reason = screen.getByText(/针对薄弱点 · 洛伦兹力/)
    const card = reason.closest('button')
    expect(card?.getAttribute('data-template-id')).toBe('magnetic-circular')
    expect(card?.getAttribute('data-reason')).toBe('weakness')
    expect(screen.getAllByText('经典实验')).toHaveLength(2)

    /* Picking the weakness card creates the real targeted experiment. */
    fireEvent.click(card!)
    const state = surface.store.getSnapshot()
    expect(state.surface).toBe('lab')
    expect(state.sceneRef?.sceneId).toContain('magnetic-circular')
  })

  it('shows the Lab chooser whenever the Lab has no scene, by navigation or new experiment', () => {
    const surface = createPhysicsSurfaceController()
    /* Plain navigation to the Lab (no picker flag) still lands on the chooser
       rather than auto-loading the magnetic demo. */
    surface.open('lab')
    const view = render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(view.container.querySelector('[data-physicsos-state="picker"]')).toBeTruthy()
    expect(screen.getByText('实验中心')).toBeTruthy()
    expect(screen.queryByText('暂无内容')).toBeNull()

    /* Picking a template from the chooser builds a real scene and mounts the
       matching runtime — the demo is reached through the chooser, not silently. */
    fireEvent.click(screen.getAllByRole('button', { name: /磁场中的带电粒子运动/ })[0]!)
    expect(surface.store.getSnapshot().sceneRef).toBeDefined()
    view.unmount()

    const navigated = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(navigated.container.querySelector('[data-physicsos-state="picker"]')).toBeNull()
    expect(navigated.container.querySelector('[data-physicsos-domain="magnetic"]')).toBeTruthy()
  })
})
