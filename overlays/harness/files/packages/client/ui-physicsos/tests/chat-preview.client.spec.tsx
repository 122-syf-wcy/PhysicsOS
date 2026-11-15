// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { PhysicsScenesProjection, PhysicsSceneSnapshot } from '@deepseek-ai/dsh-tool-physicsos/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applySidebar, inject as sidebarInject } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/index.ts'
import { ChatPreview, ChatPreviewEntry, CHAT_PREVIEW_ID, CHAT_PREVIEW_KIND, previewCardData, type ChatPreviewInjected, type ChatPreviewProps, type ChatPreviewEntryProps } from '../src/client/ChatPreview.tsx'
import { chatPreviewOwner, createChatPreviewStore } from '../src/client/chat-preview-store.ts'
import { SceneCardBody } from '../src/client/SceneChatCard.tsx'
import type { AuthState } from '../src/client/auth-store.ts'
import { createQuestionCodeOwnerStore } from '../src/client/experiments/question-code-context.ts'
import { questionCodeSceneSha256 } from '../src/client/experiments/question-code-api.ts'
import { parsePhysicsScene } from '@physicsos/physics-scene'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'
import { solvedCardData } from './solved-card-fixture.client.ts'

vi.mock('../src/client/optional-surfaces.tsx', async () => ({
  OptionalSceneCardBody: (await import('../src/client/SceneChatCard.tsx')).SceneCardBody,
}))
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const t: TranslateNS<'physicsos'> = (key, params) => Object.entries(params ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)), Object.hasOwn(zh, key) ? String(zh[key as PhysicsosKey]) : key,
)
const student: AuthState = { status: 'authed', user: {
  id: 'student-a', schoolId: 'school-a', schoolName: 'School', username: 'student', displayName: 'Student', role: 'STUDENT',
} }
function hook<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))
}
function published(questionId: string): PhysicsSceneSnapshot {
  const data = solvedCardData(questionId)
  return { sceneId: data.sceneId, title: data.title, revision: data.revision, domain: data.domain,
    cause: data.cause, engineId: `engine-${data.domain}`, scene: data.scene,
    ...(data.solve === undefined ? {} : { solve: data.solve }) }
}
function fixture(initial?: PhysicsSceneSnapshot) {
  const sessionId = 'preview-session-a' as SessionId
  const view = createChatPreviewStore().create()
  const auth = createSnapshotStore(student)
  const mounted = createSnapshotStore<SessionId | undefined>(sessionId)
  const projection = createSnapshotStore<PhysicsScenesProjection>({ latest: initial?.sceneId ?? null,
    scenes: initial === undefined ? {} : { [initial.sceneId]: initial } })
  const useProjection = ((_key: string, selector?: (value: PhysicsScenesProjection) => unknown) => {
    const value = useSyncExternalStore(projection.subscribe, projection.getSnapshot, projection.getSnapshot)
    return selector === undefined ? value : selector(value)
  }) as ChatPreviewProps['useProjection']
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set(sessionId)
  const revealPreview = vi.fn(() => true)
  const closePreview = vi.fn()
  const signal = new AbortController().signal
  const useTabInfo = (): SidebarRightTabInfo => ({
    sidebar: { expanded: true, fullscreen: false }, panel: { id: 'preview-pane' as SidebarRightTabInfo['panel']['id'] },
    tab: { id: 'preview-tab' as SidebarRightTabInfo['tab']['id'], kind: 'physicsos-experiment-preview', contentId: 'preview', title: '实验预览',
      visible: mounted.getSnapshot() === sessionId, navigation: { address: 'preview', params: undefined, revision: 0 }, signal,
      actions: { close: closePreview, bindCommands: () => () => {}, openResource: () => {}, openTab: () => {} } },
  })
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const used = { sessionId, useStore: hook(view), actions: view.actions, useProjection, useTabInfo,
    useAuth: hook(auth), usePreviewSession: hook(mounted), revealPreview, questionCodeOwner, regenerateQuestionCode,
    openSceneInLab: vi.fn(), requestSceneInCanvas: vi.fn(), t }
  function Screen({ collapsed = false, showPreview = true }: { collapsed?: boolean; showPreview?: boolean }) {
    // This focused fixture omits unused SessionStandard hooks; the real-slot test below supplies them.
    return <><ChatPreviewEntry {...used as unknown as ChatPreviewEntryProps} />
      {showPreview ? <aside hidden={collapsed}><ChatPreview {...used as ChatPreviewProps} /></aside> : null}</>
  }
  const publish = (scene: PhysicsSceneSnapshot, latest = scene.sceneId) => projection.set({ latest, scenes: { ...projection.getSnapshot().scenes, [scene.sceneId]: scene } })
  return { sessionId, view, auth, mounted, projection, questionCodeOwner, revealPreview, closePreview, regenerateQuestionCode, Screen, publish }
}

describe('single conversation experiment preview', () => {
  it('does not render on a session with no experiment and opens the latest published scene automatically', () => {
    const f = fixture(), screen = render(<f.Screen />)
    expect(screen.queryByRole('button', { name: '打开实验预览' })).toBeNull()
    expect(screen.container.querySelector('[data-chat-preview]')).toBeNull()
    const first = published('mech-01-uniform-acceleration')
    act(() => { f.publish(first) })
    expect(f.revealPreview).toHaveBeenCalledWith(true)
    expect(screen.container.querySelectorAll('[data-chat-preview]')).toHaveLength(1)
    expect(screen.container.querySelector('[data-preview-scene]')?.getAttribute('data-preview-scene')).toBe(first.sceneId)
    expect(f.regenerateQuestionCode).not.toHaveBeenCalled()
    expect(screen.getByText('这段历史记录还没有本题代码实验')).toBeTruthy()
  })

  it('selects historical attachments, follows a new scene, and does not steal selection for same-scene lifecycle updates', () => {
    const first = published('mech-01-uniform-acceleration'), second = published('01-proton-basic')
    const f = fixture(first), screen = render(<f.Screen />)
    act(() => { f.publish(second) })
    expect(f.view.getSnapshot().selectedSceneId).toBe(second.sceneId)
    const open = vi.fn((id: string) => { f.view.actions.select(id); f.revealPreview() })
    const attachments = render(<><SceneCardBody data={previewCardData(first)} presentation="attachment" t={t} openSceneInLab={vi.fn()} openScenePreview={open} />
      <SceneCardBody data={previewCardData(second)} presentation="attachment" t={t} openSceneInLab={vi.fn()} openScenePreview={open} /></>)
    expect(attachments.container.querySelectorAll('[data-scene-attachment]')).toHaveLength(2)
    expect(attachments.container.querySelectorAll('iframe, [data-code-experiment-shell]')).toHaveLength(0)
    expect(within(attachments.container).getAllByText('物理验证')).toHaveLength(2)
    fireEvent.click(within(attachments.container).getByRole('button', { name: `预览实验：${first.title}` }))
    expect(screen.container.querySelector('[data-preview-scene]')?.getAttribute('data-preview-scene')).toBe(first.sceneId)
    act(() => { f.publish({ ...second, visualization: { status: 'failed', jobId: 'job-second', ownerSessionId: f.sessionId,
      sceneId: second.sceneId, sceneRevision: second.revision, code: 'VALIDATION_FAILED', message: '实验未通过校验' } }) })
    expect(f.view.getSnapshot().selectedSceneId).toBe(first.sceneId)
    fireEvent.click(within(screen.container).getByRole('combobox', { name: '切换历史实验' }))
    fireEvent.click(screen.getByRole('option', { name: second.title }))
    expect(screen.getByText('实验未通过校验')).toBeTruthy()
    expect(screen.container.querySelectorAll('[data-code-experiment-shell]')).toHaveLength(1)
    expect(f.regenerateQuestionCode).not.toHaveBeenCalled()
  })

  it('keeps runtime, branch, and iframe through collapse or notes, and restores notes after removal', async () => {
    const first = published('mech-01-uniform-acceleration')
    const parsed = parsePhysicsScene(first.scene)
    if (!parsed.ok) throw new Error('Invalid solver fixture')
    const ready = { status: 'ready' as const, rendererKind: 'independent' as const,
      artifactId: 'qcode_' + 'a'.repeat(32), ownerSessionId: 'preview-session-a', childSessionId: 'child-a',
      sceneId: first.sceneId, sceneRevision: first.revision, sceneSha256: await questionCodeSceneSha256(parsed.value),
      experimentId: 'uniform-acceleration', sha256: 'b'.repeat(64), title: '条件与运动', createdAt: '2026-11-15T00:00:00Z' }
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/preview?')
      ? { entryUrl: '/physicsos/experiment-assets/embed/question/private/dist/index.html', expiresAt: Date.now() + 60_000 }
      : { ref: ready, source: { title: ready.title, summary: '观察运动', rendererJs: 'export function render() {}', stylesheet: '' } } }))
    vi.stubGlobal('fetch', fetch)
    const f = fixture({ ...first, visualization: ready }), screen = render(<f.Screen />)
    await waitFor(() => { expect(screen.container.querySelector('iframe')).not.toBeNull() })
    const iframe = screen.container.querySelector('iframe')
    const editor = screen.getAllByRole('spinbutton')[0] as HTMLInputElement
    const original = editor.value
    const next = String(Number(original) + 1)
    fireEvent.change(editor, { target: { value: next } }); fireEvent.blur(editor)
    expect((screen.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(false)
    const play = screen.getByRole('button', { name: '播放 / 暂停' })
    fireEvent.click(play)
    expect(play.getAttribute('aria-pressed')).toBe('true')
    screen.rerender(<f.Screen collapsed />)
    expect(screen.container.querySelector('iframe')).toBe(iframe)
    screen.rerender(<f.Screen />)
    expect(screen.getByRole('button', { name: '播放 / 暂停' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe(next)
    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))
    fireEvent.change(screen.getByRole('textbox', { name: '观察与思考' }), { target: { value: '速度正在变化' } })
    expect(screen.container.querySelector('iframe')).toBe(iframe)
    fireEvent.click(screen.getByRole('tab', { name: '实验' }))
    expect(screen.container.querySelector('iframe')).toBe(iframe)
    expect(screen.getByText('本题实验代码').closest('details')?.open).toBe(false)
    screen.rerender(<f.Screen showPreview={false} />)
    fireEvent.click(screen.getByRole('button', { name: '打开实验预览' }))
    expect(f.revealPreview).toHaveBeenCalled()
    screen.rerender(<f.Screen />)
    expect(screen.container.querySelectorAll('[data-chat-preview]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))
    expect((screen.getByRole('textbox', { name: '观察与思考' }) as HTMLTextAreaElement).value).toBe('速度正在变化')
  })

  it('refreshes the selected failed generation without a new turn and leaves recovery explicit', () => {
    const first = published('mech-01-uniform-acceleration'), f = fixture(first), screen = render(<f.Screen />)
    const base = { jobId: 'job-1', ownerSessionId: f.sessionId, sceneId: first.sceneId, sceneRevision: first.revision }
    act(() => { f.publish({ ...first, visualization: { ...base, status: 'failed', code: 'VALIDATION_FAILED', message: '参数修改没有通过验收' } }) })
    expect(screen.getByText('参数修改没有通过验收')).toBeTruthy()
    expect(f.regenerateQuestionCode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新生成本题实验' }))
    expect(f.regenerateQuestionCode).toHaveBeenCalledWith(first.sceneId)
    act(() => { f.publish({ ...first, visualization: { ...base, status: 'generating', deadlineAt: Date.now() + 600_000 } }) })
    expect(screen.getByText('正在生成本题实验')).toBeTruthy()
    expect(screen.queryByText('参数修改没有通过验收')).toBeNull()
  })

  it('keeps iframe, playback time and branch through real sidebar collapse, and closes only its own occurrence', async () => {
    const runtime = await SlotTestRuntime.create()
    const animations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] })
    try {
      runtime.ctx.provide('layout', { openRightbar: () => {}, closeRightbar: () => {} } as never)
      runtime.ctx.provide('resources', { pin: () => {} } as never)
      const locale = new LocaleRuntime(runtime.ctx)
      runtime.ctx.provide('locale', locale)
      runtime.slots.installLocale(locale)
      locale.register('physicsos', { zh, en: zh })
      runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore([]) } as never)
      await runtime.declare({
        rightbar: { kind: 'single', scope: 'root' },
        'conversation.session.header.corner': { kind: 'single', scope: 'session' },
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      })
      const sessionId = 'actual-preview-session' as SessionId
      await runtime.sessions.add({ id: sessionId })
      const reference = runtime.sessions.retainFor(runtime.ctx, sessionId, { source: 'mainView' })
      await reference.ready
      await runtime.mount({ inject: [...sidebarInject], apply: applySidebar })
      const first = published('mech-01-uniform-acceleration')
      const parsed = parsePhysicsScene(first.scene)
      if (!parsed.ok) throw new Error('Invalid solver fixture')
      const ready = { status: 'ready' as const, rendererKind: 'independent' as const,
        artifactId: 'qcode_' + 'c'.repeat(32), ownerSessionId: sessionId, childSessionId: 'actual-preview-child',
        sceneId: first.sceneId, sceneRevision: first.revision, sceneSha256: await questionCodeSceneSha256(parsed.value),
        experimentId: 'uniform-acceleration', sha256: 'd'.repeat(64), title: '条件与运动', createdAt: '2026-11-15T00:00:00Z' }
      const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/preview?')
        ? { entryUrl: '/physicsos/experiment-assets/embed/question/private/dist/index.html', expiresAt: Date.now() + 60_000 }
        : { ref: ready, source: { title: ready.title, summary: '观察运动', rendererJs: 'export function render() {}', stylesheet: '' } } }))
      vi.stubGlobal('fetch', fetch)
      await runtime.sessions.setProjection(sessionId, 'physicsScenes', { latest: first.sceneId, scenes: {
        [first.sceneId]: { ...first, visualization: ready },
      } })
      const auth = createSnapshotStore(student), store = createChatPreviewStore()
      const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set(sessionId)
      const face = (): ChatPreviewInjected => ({
        hooks: { auth, previewSession: runtime.ctx.sidebarRight.mounted },
        questionCodeOwner,
        revealPreview: () => {
          if (runtime.ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return false
          runtime.ctx.sidebarRight.openTab(CHAT_PREVIEW_KIND)
          return true
        },
        openSceneInLab: () => {},
      })
      act(() => {
        runtime.ctx.sidebarRightTabs.register({ id: CHAT_PREVIEW_ID, kind: CHAT_PREVIEW_KIND, keepMounted: true, title: () => '实验预览' })
        runtime.slots.register({ name: 'sidebar.right.pane.tab', key: CHAT_PREVIEW_ID, locale: 'physicsos', store, inject: face }, ChatPreview)
        runtime.slots.register({ name: 'conversation.session.header.utilities', id: 'actual-preview-entry', locale: 'physicsos', store, inject: face }, ChatPreviewEntry)
      })
      runtime.renderSlot('rightbar', { width: 420, viewportWidth: 1360, canShow: true })
      runtime.renderSlot('conversation.session.header.utilities', {}, { session: reference })
      await runtime.flush()
      const host = within(document.body)
      await waitFor(() => { expect(document.querySelector('[data-chat-preview] iframe')).not.toBeNull() })
      const iframe = document.querySelector('[data-chat-preview] iframe')
      const preview = document.querySelector<HTMLElement>('[data-chat-preview]')!
      const record = runtime.ctx.sidebarRight.openTabs.getSnapshot().find(row => row.kind === CHAT_PREVIEW_KIND)!
      const editor = host.getAllByRole('spinbutton')[0] as HTMLInputElement
      const next = String(Number(editor.value) + 1)
      fireEvent.change(editor, { target: { value: next } }); fireEvent.blur(editor)
      const resetBranch = host.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement
      expect(resetBranch.disabled).toBe(false)
      const timeline = host.getByRole('slider', { name: '时间轴' }) as HTMLInputElement
      fireEvent.keyDown(timeline, { key: 'PageUp' })
      const time = timeline.value
      expect(Number(time)).toBeGreaterThan(0)
      const play = host.getByRole('button', { name: '播放 / 暂停' })
      fireEvent.click(play)
      expect(play.getAttribute('aria-pressed')).toBe('true')
      const collapse = document.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]')!
      fireEvent.click(collapse)
      await runtime.flush()
      expect(runtime.ctx.sidebarRight.isExpanded()).toBe(false)
      expect(runtime.ctx.sidebarRight.openTabs.getSnapshot().filter(row => row.kind === CHAT_PREVIEW_KIND)).toHaveLength(1)
      expect(document.querySelector('[data-chat-preview] iframe')).toBe(iframe)
      fireEvent.click(host.getByRole('button', { name: '打开实验预览' }))
      await runtime.flush()
      expect(runtime.ctx.sidebarRight.isExpanded()).toBe(true)
      expect(runtime.ctx.sidebarRight.openTabs.getSnapshot().find(row => row.kind === CHAT_PREVIEW_KIND)?.tabId).toBe(record.tabId)
      expect(document.querySelector('[data-chat-preview]')).toBe(preview)
      expect(document.querySelector('[data-chat-preview] iframe')).toBe(iframe)
      expect(host.getAllByRole('spinbutton')[0]).toBe(editor)
      expect(editor.value).toBe(next)
      expect(resetBranch.disabled).toBe(false)
      expect(host.getByRole('button', { name: '播放 / 暂停' })).toBe(play)
      expect(play.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(play)
      const pausedTime = timeline.value
      expect(Number(pausedTime)).toBeGreaterThanOrEqual(Number(time))
      fireEvent.click(host.getByRole('tab', { name: '笔记' }))
      const note = host.getByRole('textbox', { name: '观察与思考' }) as HTMLTextAreaElement
      fireEvent.change(note, { target: { value: '实际宿主中的笔记' } })
      fireEvent.click(collapse)
      await runtime.flush()
      fireEvent.click(host.getByRole('button', { name: '打开实验预览' }))
      await runtime.flush()
      expect(host.getByRole('textbox', { name: '观察与思考' })).toBe(note)
      expect(note.value).toBe('实际宿主中的笔记')
      expect(document.querySelector('[data-chat-preview] iframe')).toBe(iframe)
      fireEvent.click(host.getByRole('tab', { name: '实验' }))
      expect(host.getByRole('slider', { name: '时间轴' })).toBe(timeline)
      expect(timeline.value).toBe(pausedTime)
      expect(editor.value).toBe(next)
      expect(play.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(host.getByRole('tab', { name: '笔记' }))
      fireEvent.keyDown(note, { key: 'Escape' })
      expect(runtime.ctx.sidebarRight.openTabs.getSnapshot().filter(row => row.kind === CHAT_PREVIEW_KIND)).toHaveLength(0)
      await runtime.flush()
      fireEvent.click(host.getByRole('button', { name: '打开实验预览' }))
      await runtime.flush()
      expect(runtime.ctx.sidebarRight.openTabs.getSnapshot().filter(row => row.kind === CHAT_PREVIEW_KIND)).toHaveLength(1)
      expect((host.getByRole('textbox', { name: '观察与思考' }) as HTMLTextAreaElement).value).toBe('实际宿主中的笔记')
    } finally {
      await runtime.dispose()
      if (animations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
      else Object.defineProperty(Element.prototype, 'getAnimations', animations)
    }
  })

  it('routes one unmodified Escape to its own tab without consuming IME, repeats or child cancellation', () => {
    const f = fixture(published('mech-01-uniform-acceleration')), screen = render(<f.Screen />)
    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))
    const note = screen.getByRole('textbox', { name: '观察与思考' })
    fireEvent.compositionStart(note)
    fireEvent.keyDown(note, { key: 'Escape' })
    fireEvent.compositionEnd(note)
    fireEvent.keyDown(note, { key: 'Escape' })
    fireEvent.keyUp(note, { key: 'Escape' })
    fireEvent.keyDown(note, { key: 'Escape', shiftKey: true })
    fireEvent.keyDown(note, { key: 'Escape', repeat: true })
    const cancel = (event: KeyboardEvent) => { event.preventDefault() }
    note.addEventListener('keydown', cancel)
    fireEvent.keyDown(note, { key: 'Escape' })
    note.removeEventListener('keydown', cancel)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(f.closePreview).not.toHaveBeenCalled()
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(f.closePreview).toHaveBeenCalledTimes(1)
  })

  it('drops the old preview when another session or product panel is active', () => {
    const f = fixture(published('mech-01-uniform-acceleration')), screen = render(<f.Screen />)
    expect(screen.container.querySelector('[data-chat-preview]')).not.toBeNull()
    act(() => { f.mounted.set('another-session' as SessionId) })
    expect(screen.container.querySelector('[data-chat-preview]')).toBeNull()
    act(() => { f.mounted.set(undefined) })
    expect(screen.container.querySelector('iframe')).toBeNull()
    act(() => { f.mounted.set(f.sessionId) })
    expect(screen.container.querySelector('[data-chat-preview]')).not.toBeNull()
    const other = createChatPreviewStore().create()
    expect(other.getSnapshot().selectedSceneId).toBeUndefined()
    expect(other.getSnapshot().notes).toEqual({})
  })

  it.each(['account', 'role', 'guest', 'loading'] as const)('clears private viewing state at %s changes and permits the original account to return', change => {
    const first = published('mech-01-uniform-acceleration'), f = fixture(first), screen = render(<f.Screen />)
    act(() => { f.view.actions.writeNote(first.sceneId, '私有笔记') })
    if (student.user === undefined) throw new Error('Missing test account')
    act(() => { f.auth.set(change === 'guest' || change === 'loading' ? { status: change } : { status: 'authed', user: {
      ...student.user!, ...(change === 'account' ? { id: 'student-b' } : { role: 'TEACHER' as const }),
    } }) })
    expect(screen.container.querySelector('[data-chat-preview]') === null).toBe(change !== 'role')
    expect(f.view.getSnapshot().notes).toEqual({})
    expect(f.view.getSnapshot().revoked).toBe(change === 'account')
    expect(chatPreviewOwner(f.auth.getSnapshot())).not.toBe(chatPreviewOwner(student))
    act(() => { f.auth.set(student) })
    expect(screen.container.querySelector('[data-chat-preview]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '打开实验预览' })).toBeTruthy()
  })
})
