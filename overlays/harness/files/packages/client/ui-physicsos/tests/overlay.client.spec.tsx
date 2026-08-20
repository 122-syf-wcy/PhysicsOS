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
import { formatUpdatedAt, workspaceKnowledge } from '../src/client/workspaceMeta.ts'
import { en, zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

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
    fireEvent.click(screen.getByRole('button', { name: '学习记录' }))
    fireEvent.click(screen.getByRole('button', { name: '资源库' }))
    expect(screen.getByRole('button', { name: '学习记录' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: '资源库' }).getAttribute('disabled')).not.toBeNull()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('renders the home brand copy', () => {
    render(<HomeBrand t={t} useSessions={neverHook} useWorkspaces={neverHook} />)
    expect(screen.getByText('PhysicsOS')).toBeTruthy()
    expect(screen.getByText('探索一个物理世界')).toBeTruthy()
    expect(screen.getByText('描述一个物理现象、创建实验，或直接输入一道试题。')).toBeTruthy()
  })

  it('lists recent workspaces as a compact row', () => {
    const startSession = vi.fn()
    const useWorkspaces = ((
      selector: (s: {
        items: { workspaceId: string; title: string; updatedAt: string }[]
      }) => unknown,
    ) =>
      selector({
        items: [{ workspaceId: 'w1', title: '磁场实验', updatedAt: '2026-08-01T00:00:00.000Z' }],
      })) as never
    const openSurface = vi.fn()
    render(
      <HomeActions
        startSession={startSession}
        openSurface={openSurface}
        t={t}
        useSessions={neverHook}
        useWorkspaces={useWorkspaces}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建物理实验' }))
    fireEvent.click(screen.getByRole('button', { name: '输入试题' }))
    fireEvent.click(screen.getByRole('button', { name: '打开场景' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览实验模板' }))
    expect(screen.getByText('电磁学 / 磁场与洛伦兹力')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /磁场实验/ }))
    expect(openSurface).toHaveBeenNthCalledWith(1, 'lab')
    expect(openSurface).toHaveBeenNthCalledWith(2, 'questions')
    expect(screen.getByRole('button', { name: '打开场景' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: '浏览实验模板' }).getAttribute('disabled')).not.toBeNull()
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenLastCalledWith('w1')
  })

  it('shows the empty physics-world state', () => {
    const startSession = vi.fn()
    const openSurface = vi.fn()
    const useWorkspaces = ((selector: (s: { items: never[] }) => unknown) =>
      selector({ items: [] })) as never
    render(
      <HomeActions
        startSession={startSession}
        openSurface={openSurface}
        t={t}
        useSessions={neverHook}
        useWorkspaces={useWorkspaces}
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
    const useWorkspaces = ((selector: (s: { items: never[] }) => unknown) =>
      selector({ items: [] })) as never
    render(
      <RecentSpaces
        wide
        startSession={vi.fn()}
        expandSidebar={vi.fn()}
        t={t}
        useSessions={neverHook}
        useWorkspaces={useWorkspaces}
      />,
    )
    expect(screen.getByText('最近空间')).toBeTruthy()
    expect(screen.getByText('暂无最近空间')).toBeTruthy()
    expect(screen.queryByText('暂无会话')).toBeNull()
    expect(screen.queryByText('工作区')).toBeNull()
  })

  it('covers the conversation column with the Physics Lab workspace', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('lab')
    const { container } = render(
      <PhysicsSurface
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
    expect(screen.getByText('基础参数')).toBeTruthy()
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
    surface.open('lab')
    const { container } = render(
      <PhysicsSurface
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
    surface.open('lab')
    const { container } = render(
      <PhysicsSurface
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
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
    expect(screen.getAllByText('匀加速直线运动').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Mechanics Engine · Verified')).toBeTruthy()
    expect(screen.getByRole('img', { name: '匀加速直线运动的可验证物理画布' })).toBeTruthy()
    expect(screen.getByText(/参数保持只读/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放 / 暂停' })).toBeTruthy()
  })

  it('passes the exact Question Scene to Physics World', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('questions')
    const openSurface = vi.fn()
    render(
      <PhysicsSurface
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
    expect(screen.getAllByText('需要补充条件').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: '在物理世界中打开' }).getAttribute('disabled')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByText('已完成求解')).toBeTruthy()
  })
})
