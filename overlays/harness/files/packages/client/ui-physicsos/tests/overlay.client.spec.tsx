// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HomeActions } from '../src/client/HomeActions.tsx'
import { PhysicsProfileSeat } from '../src/client/PhysicsProfileSeat.tsx'
import { SidebarNew } from '../src/client/SidebarNew.tsx'
import { createPhysicsProfileController, readStoredProfile } from '../src/client/profile-store.ts'
import { STUDENT_PROFILES, TEACHER_PROFILES, runtimePresetOf } from '../src/client/profiles.ts'
import { HomeBrand } from '../src/client/HomeBrand.tsx'
import { PhysicsOSMark } from '../src/client/PhysicsOSMark.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { QuestionWorkspace } from '../src/client/QuestionWorkspace.tsx'
import { RecentSpaces } from '../src/client/RecentSpaces.tsx'
import { SidebarBrand } from '../src/client/SidebarBrand.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import { SidebarNav } from '../src/client/SidebarNav.tsx'
import { fillComposerDraft } from '../src/client/fill-draft.ts'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { formatUpdatedAt, workspaceKnowledge } from '../src/client/workspaceMeta.ts'
import { en, zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

/* Live hooks for tests that render the experiment picker: the library home
   reads both stores (继续上次实验 / 为你推荐). Workspace-only renders keep
   neverHook so an unexpected read still fails loudly. */
const emptyRecent: PhysicsSurfaceProps['useRecentExperiments'] =
  selector => selector({ items: [] })
const emptyRecord: PhysicsSurfaceProps['useLearningRecord'] =
  selector => selector({ attempts: [] })

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

describe('PhysicsOS overlay presentation', () => {
  it('renders the blue geometric mark', () => {
    const { container } = render(<PhysicsOSMark />)
    expect(container.querySelector('linearGradient')).toBeTruthy()
    expect(container.querySelector('stop')).toBeTruthy()
  })

  it('renders the wide wordmark and returns Home', () => {
    const openHome = vi.fn()
    render(
      <SidebarBrand
        wide
        openHome={openHome}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '回到首页' }))
    expect(openHome).toHaveBeenCalledOnce()
  })

  it('renders the rail mark without a button', () => {
    const { container } = render(
      <SidebarBrand
        wide={false}
        openHome={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('keeps explore seats clickable with secondary copy', () => {
    const openSurface = vi.fn()
    const surface = createPhysicsSurfaceController()
    render(
      <SidebarNav
        wide
        openSurface={openSurface}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getByText('主页')).toBeTruthy()
    expect(screen.getByText('探索')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '首页' }))
    fireEvent.click(screen.getByRole('button', { name: '物理实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '试题空间' }))
    expect(openSurface).toHaveBeenCalledTimes(3)
    expect(openSurface).toHaveBeenNthCalledWith(2, 'lab')
    expect(screen.getByRole('button', { name: '物理实验室' }).getAttribute('disabled')).toBeNull()
    expect(screen.getByRole('button', { name: '试题空间' }).getAttribute('disabled')).toBeNull()
  })

  it('renders rail navigation without labels', () => {
    render(
      <SidebarNav
        wide={false}
        openSurface={vi.fn()}
        usePhysicsSurface={selector => selector({ surface: 'home' })}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.queryByText('首页')).toBeNull()
    expect(screen.queryByText('主页')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'PhysicsOS' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '首页' }).getAttribute('title')).toBe('首页')
    expect(screen.getByRole('button', { name: '物理实验室' }).getAttribute('title')).toBe('物理实验室')
    expect(screen.getByRole('button', { name: '试题空间' }).getAttribute('title')).toBe('试题空间')
  })

  it('keeps unavailable footer destinations disabled', () => {
    const startSession = vi.fn()
    render(
      <SidebarFooter
        wide
        startSession={startSession}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    /* 学习记录 is a live destination now (the learning-record surface);
       资源库 stays a disabled placeholder. */
    fireEvent.click(screen.getByRole('button', { name: '学习记录' }))
    fireEvent.click(screen.getByRole('button', { name: '资源库' }))
    expect(screen.getByRole('button', { name: '学习记录' }).getAttribute('disabled')).toBeNull()
    expect(screen.getByRole('button', { name: '资源库' }).getAttribute('disabled')).not.toBeNull()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('renders the home brand copy', () => {
    render(<HomeBrand t={t} useSessions={neverHook} useWorkspaces={neverHook} />)
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
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建物理实验' }))
    fireEvent.click(screen.getByRole('button', { name: '输入试题' }))
    fireEvent.click(screen.getByRole('button', { name: '打开场景' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览实验模板' }))
    expect(screen.getByText('电磁学 / 磁场与洛伦兹力 · 实验')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /磁场实验/ }))
    expect(openSurface).toHaveBeenNthCalledWith(1, 'lab')
    expect(openSurface).toHaveBeenNthCalledWith(2, 'questions')
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
        useSessions={neverHook}
        useWorkspaces={neverHook}
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
    expect(STUDENT_PROFILES.every(profile => runtimePresetOf(profile.id) === 'standard')).toBe(
      true,
    )
    expect(readStoredProfile({ getItem: () => 'physics-question' })).toBe('physics-question')
    expect(readStoredProfile({ getItem: () => 'standard' })).toBe('physics-experiment')
  })

  it('keeps the product choice locally until the Harness host attaches', async () => {
    const select = vi.fn(async () => ({
      result: { ok: true as const, value: { agentPreset: 'standard' } },
    }))
    const controller = createPhysicsProfileController()
    await controller.select('physics-tutor')
    expect(controller.store.getSnapshot().current).toBe('physics-tutor')
    expect(select).not.toHaveBeenCalled()
    controller.attach({ agentPresets: { select } }, () => ({ id: 's2', blank: true }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ sessionId: 's2', agentPreset: 'standard' })
    })
  })

  it('opens a create menu from 新建 instead of starting a session immediately', () => {
    const startSession = vi.fn()
    const openSurface = vi.fn()
    render(
      <SidebarNew
        wide
        startSession={startSession}
        openSurface={openSurface}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(startSession).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: '新建物理实验' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '输入试题' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '新建空白场景' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '导入场景' }).getAttribute('disabled')).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '新建物理实验' }))
    expect(openSurface).toHaveBeenCalledWith('lab')
    expect(startSession).not.toHaveBeenCalled()
  })

  it('offers only PhysicsOS profiles and selects the mapped Harness preset', async () => {
    const select = vi.fn(async () => ({
      result: { ok: true as const, value: { agentPreset: 'standard' } },
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
        useSessions={neverHook}
        useWorkspaces={neverHook}
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
      expect(select).toHaveBeenCalledWith({ sessionId: 's1', agentPreset: 'standard' })
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
        useRecentExperiments={useRecentExperiments}
        expandSidebar={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getByText('最近空间')).toBeTruthy()
    expect(screen.getByText('暂无最近空间')).toBeTruthy()
    expect(screen.queryByText('暂无会话')).toBeNull()
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
    const useRecentExperiments = ((
      selector: (s: ReturnType<typeof surface.recent.getSnapshot>) => unknown,
    ) => selector(surface.recent.getSnapshot())) as never
    render(
      <RecentSpaces
        wide
        openSurface={openSurface}
        useRecentExperiments={useRecentExperiments}
        expandSidebar={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getByText('速度选择器')).toBeTruthy()
    expect(screen.getByText('实验')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /速度选择器/ }))
    expect(openSurface).toHaveBeenCalledWith('lab', {
      sceneId: items[0]!.sceneId,
      scene: items[0]!.scene,
    })
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
      />,
    )
    expect(screen.getByText('磁场中的带电粒子运动')).toBeTruthy()
    expect(screen.getByText('场景与对象')).toBeTruthy()
    expect(screen.getByRole('img', { name: '磁场中的带电粒子运动' })).toBeTruthy()

    // Scene tree is a hierarchy, and formulas stay out of it.
    expect(screen.getByRole('button', { name: /场景/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /磁场区域/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /正电粒子/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /初始条件/ })).toBeTruthy()
    expect(screen.queryByText('r = mv / qB')).toBeNull()
    expect(screen.queryByText('F = qv × B')).toBeNull()

    // Inspector separates editable parameters from read-only derived values.
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    expect(screen.getByText('粒子属性')).toBeTruthy()
    expect(screen.getByText('派生量')).toBeTruthy()
    expect(screen.getByText('派生量由引擎计算，只读。')).toBeTruthy()
    expect(screen.getByText(/轨道半径/)).toBeTruthy()

    // Timeline transport and rate.
    expect(screen.getByRole('button', { name: '后退一步' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '播放倍速' })).toBeTruthy()
    expect(screen.getByText('0.00s')).toBeTruthy()

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

  it('renders the real Question Runtime in Question Space', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    expect(screen.getByText('题目理解')).toBeTruthy()
    expect(screen.getAllByText('质子垂直进入匀强磁场').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('已完成求解')).toBeTruthy()
    expect(screen.getByText('验证通过')).toBeTruthy()
    expect(screen.getAllByText('轨道半径').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('img', { name: '磁场中的带电粒子运动' })).toBeTruthy()
  })

  it('renders every mechanics question family through the shared verified canvas', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    for (const title of [
      '匀加速直线运动',
      '平抛运动',
      '斜抛运动',
      '牛顿第二定律',
      '无摩擦斜面',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
      expect(screen.getByText('Mechanics Engine · Verified')).toBeTruthy()
      const canvas = screen.getByRole('img', { name: `${title}的可验证物理图` })
      expect(canvas).toBeTruthy()
      const viewBox = canvas.getAttribute('viewBox')?.split(' ').map(Number)
      expect(viewBox).toBeDefined()
      expect((viewBox?.[2] ?? 1) / (viewBox?.[3] ?? 1)).toBeLessThan(2.2)
      expect(screen.getByRole('button', { name: '播放动画' })).toBeTruthy()
    }
  })

  it('advances the mechanics question preview between simulation samples on animation frames', () => {
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
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /匀加速直线运动/ }))
    fireEvent.click(screen.getByRole('button', { name: '播放动画' }))
    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(116.67) })

    expect(screen.getByText('0.02 / 10.00 s')).toBeTruthy()
    expect(screen.getByText('v = 10.03 m/s')).toBeTruthy()
  })

  it('opens the exact verified mechanics Scene in the full Physics Lab', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    const openSurface = vi.fn()
    const questionView = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={openSurface}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /匀加速直线运动/ }))
    const openButton = screen.getByRole('button', { name: '在物理世界中打开' })
    expect(openButton.getAttribute('disabled')).toBeNull()
    fireEvent.click(openButton)

    const [id, sceneRef] = openSurface.mock.calls[0] as [
      'lab',
      { sceneId: string; scene: Parameters<typeof surface.open>[1] extends infer T ? T extends { scene: infer S } ? S : never : never },
    ]
    expect(id).toBe('lab')
    questionView.unmount()
    surface.open('lab', sceneRef)

    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
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
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const massInput = screen.getByRole('textbox', { name: '质量' })
    if (!(massInput instanceof HTMLInputElement)) throw new Error('mass editor is not an input.')
    fireEvent.change(massInput, { target: { value: '3' } })
    fireEvent.blur(massInput)
    expect(
      container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-scene-revision'),
    ).toBe('1')
  })

  it('passes the exact Question Scene to Physics World', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    const openSurface = vi.fn()
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={openSurface}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '在物理世界中打开' }))
    expect(openSurface).toHaveBeenCalledTimes(1)
    const [id, sceneRef] = openSurface.mock.calls[0] as ['lab', { sceneId: string; scene: { id: string } }]
    expect(id).toBe('lab')
    expect(sceneRef.sceneId).toBe(sceneRef.scene.id)
  })

  it('keeps an invalid Question Runtime recoverable', () => {
    const openSurface = vi.fn()
    render(
      <QuestionWorkspace
        openSurface={openSurface}
        usePhysicsSurface={selector => selector({ surface: 'questions' })}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    const input = screen.getByRole('textbox', { name: '题目文本' })
    fireEvent.change(input, { target: { value: '这是一个没有物理条件的题目' } })
    fireEvent.click(screen.getByRole('button', { name: '解析这道题' }))
    /* Text naming no physics subject must surface an honest parse failure —
       not a magnetic IR fabricated by a fallback parser. */
    expect(screen.getAllByText('无法识别题目').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: '在物理世界中打开' }).getAttribute('disabled')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByText('已完成求解')).toBeTruthy()
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
      />,
    )
    expect(container.querySelector('[data-physicsos-state="picker"]')).toBeTruthy()
    /* The four domains the runtime dispatch supports, all as pickable entries.
       Some names repeat on the recommendation rail, so presence means ≥ 1 button. */
    for (const name of [/匀速直线运动/, /单点电荷电场/, /磁场中的带电粒子运动/, /速度选择器/, /质谱仪基础模型/]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }
    /* Cyclotron is surfaced as coming-soon, never as a creatable experiment. */
    const cyclotron = screen.getByRole('button', { name: /回旋加速器/ })
    expect(cyclotron.getAttribute('disabled')).not.toBeNull()
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
          reloaded.open(id, sceneRef as Parameters<typeof reloaded.open>[1])
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
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
          surface.open(id, sceneRef as { sceneId: string; scene: never } | undefined)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
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
      />,
    )
    expect(navigated.container.querySelector('[data-physicsos-state="picker"]')).toBeNull()
    expect(navigated.container.querySelector('[data-physicsos-domain="magnetic"]')).toBeTruthy()
  })
})
