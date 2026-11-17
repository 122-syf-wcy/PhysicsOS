// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeActions } from '../src/client/HomeActions.tsx'
import { RecentSpaces } from '../src/client/RecentSpaces.tsx'
import { zh } from '../src/client/locales.ts'
const entry = { sceneId: 'motion', title: '匀速运动', kind: 'experiment', updatedAt: '2026-11-17T00:00:00.000Z', scene: { metadata: { title: '匀速运动' } } }
const t = (key: keyof typeof zh) => zh[key]
afterEach(cleanup)
const face = () => ({
  t, useRecentExperiments: (select: any) => select({ items: [entry], deletedItems: [], lifecycleEnabled: true, lifecycleReadable: true, accountKey: 'GZU:alice' }),
  openSurface: vi.fn(), requestSceneInCanvas: vi.fn(), removeRecent: vi.fn(), restoreRecent: vi.fn(), archiveRecent: vi.fn(), unarchiveRecent: vi.fn(),
  openCanvasView: vi.fn(), newCanvas: vi.fn(async () => 'board'),
})
describe('recent actions are independent keyboard/touch targets', () => {
  it.each(['home', 'history'] as const)('%s exposes canvas/remove separately and confirms before removal', target => {
    const props = face()
    const view = target === 'home' ? render(<HomeActions {...props as any} />) : render(<RecentSpaces {...{ ...props, wide: true,
      useSessions: (select: any) => select({ ids: [], byId: {} }), useWorkspaces: (select: any) => select({ archivedSessionIds: [] }), openSession: vi.fn(), archiveSession: vi.fn(),
    } as any} />)
    const canvas = view.getByRole('button', { name: `${zh['canvas.addToCanvas']} · 匀速运动` })
    const remove = view.getByRole('button', { name: `${zh['recent.remove']} · 匀速运动` })
    expect(canvas).not.toBe(remove)
    expect(canvas.tabIndex).toBe(0); expect(remove.tabIndex).toBe(0)
    expect(canvas.closest('button')?.contains(remove)).toBe(false)
    canvas.focus(); expect(document.activeElement).toBe(canvas)
    fireEvent.click(canvas)
    expect(props.requestSceneInCanvas).toHaveBeenCalledOnce()
    expect(props.removeRecent).not.toHaveBeenCalled()
    remove.focus(); expect(document.activeElement).toBe(remove)
    fireEvent.click(remove)
    expect(props.removeRecent).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
    expect(props.removeRecent).toHaveBeenCalledWith('motion')
    expect(props.openSurface).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '撤销' }))
    expect(props.restoreRecent).toHaveBeenCalledWith('motion')
  })
  it('makes deleted records reachable but not directly openable and bridge read-only', () => {
    const props = face()
    props.useRecentExperiments = select => select({ items: [], deletedItems: [entry], lifecycleEnabled: false, lifecycleReadable: true, accountKey: 'GZU:alice' })
    const view = render(<HomeActions {...props as any} />)
    fireEvent.change(view.getByRole('combobox', { name: '最近记录状态' }), { target: { value: 'deleted' } })
    expect(view.getByText('匀速运动')).toBeTruthy()
    expect(view.queryByRole('button', { name: /恢复最近记录/ })).toBeNull()
    expect(view.queryByRole('button', { name: /移除.*匀速运动/ })).toBeNull()
  })
  it('cancels the removal dialog without mutating anything', () => {
    const props = face()
    const view = render(<HomeActions {...props as any} />)
    fireEvent.click(view.getByRole('button', { name: `${zh['recent.remove']} · 匀速运动` }))
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)
    expect(props.removeRecent).not.toHaveBeenCalled()
  })
})
