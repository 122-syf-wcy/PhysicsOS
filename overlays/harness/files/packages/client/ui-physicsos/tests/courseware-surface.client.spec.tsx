// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoursewareSurface } from '../src/client/courseware/CoursewareSurface.tsx'
import { coursewareClientFixture, cwPresentation } from './courseware-fixture.client.ts'
vi.mock('../src/client/courseware/CoursewarePlayer.tsx', async () => {
  const React = await import('react')
  return { CoursewarePlayer: React.forwardRef((_props, ref) => { React.useImperativeHandle(ref, () => ({ command: async () => {} })); return <iframe title="protocol boundary only" /> }) }
})
let restoreDialogs: (() => void) | undefined
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const prototype = HTMLDialogElement.prototype
  const originals = (['showModal', 'close'] as const).map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const)
  // jsdom may omit both methods. This fixture models open/close only, not the browser top layer or focus.
  Object.defineProperties(prototype, {
    showModal: { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.open = true } },
    close: { configurable: true, writable: true, value: function (this: HTMLDialogElement) { this.open = false } },
  })
  restoreDialogs = () => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(prototype, name, descriptor); else Reflect.deleteProperty(prototype, name) } }
})
afterEach(() => {
  try { cleanup() } finally { vi.restoreAllMocks(); restoreDialogs?.(); restoreDialogs = undefined; vi.unstubAllGlobals() }
})
describe('courseware management and classroom surface contract (not browser CSS evidence)', () => {
  it('offers the complete classroom tools, clear confirmation, draft export and a real lesson selector', async () => {
    const f = coursewareClientFixture()
    const view = render(<CoursewareSurface controller={f.controller} deckId="deck_1" />)
    await screen.findByRole('heading', { name: '声音的特性', exact: true })
    await act(async () => { f.controller.setPresentation(cwPresentation()); await f.controller.startLesson('lesson_1') })
    for (const name of [/^交互：/, /^画笔：/, /^荧光：/, /^橡皮：/, /^直线：/, /^箭头：/, /^矩形：/, /^椭圆：/, /^激光：/, /^聚光：/]) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '恢复已有授课' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^聚光：/ })); expect(screen.getByRole('slider', { name: '聚光灯半径' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空本页', exact: true }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '版本与来源', exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '草稿', exact: true }))
    expect(screen.getByRole('textbox', { name: '完整课件批注草稿 JSON' })).toBeTruthy()
    const dialog = screen.getByRole('dialog', { name: '导出本页草稿', exact: true }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框', exact: true }))
    expect(dialog.open).toBe(false); expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount(); f.controller.dispose()
  })
  it('does not expose import/write tools as enabled in bridge mode and scopes library search/status controls', async () => {
    const f = coursewareClientFixture({ capabilities: async () => ({ capability: 'courseware-v1', schemaVersion: 1, enabled: true, writesEnabled: false, canImport: false, canTeach: false, limits: { maxFileBytes: 16777216, maxAnnotationBytes: 4194304, maxVersionsPerDeck: 20 } }) })
    const view = render(<CoursewareSurface controller={f.controller} />)
    await waitFor(() => expect(screen.getByText(/当前为兼容只读模式/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: '导入 HTML 课件', exact: true })).toBeNull()
    expect(screen.getByRole('textbox', { name: '搜索课件' })).toBeTruthy(); expect(screen.getByRole('combobox', { name: '课件状态' })).toBeTruthy(); expect(screen.getByRole('combobox', { name: '课件范围' })).toBeTruthy()
    view.unmount(); f.controller.dispose()
  })
})
