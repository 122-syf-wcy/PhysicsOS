// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderWorkspace, type HeaderWorkspaceProps } from '../src/client/HeaderWorkspace.tsx'
import type { SessionId, WorkspaceId } from '../src/client/runtime-compat.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: HeaderWorkspaceProps['t'] = key => translations[key] ?? key
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const neverHook = (() => { throw new Error('unused header hook') }) as never

afterEach(cleanup)

function mount(empty = false) {
  const createWorkspace = vi.fn(async (name: string) => ({ id: 'account-new', name }))
  const renameWorkspace = vi.fn(async (_id: string, _name: string) => {})
  const selectWorkspace = vi.fn(async (_id: WorkspaceId) => {})
  const items = empty ? [] : [
    { workspaceId: wid('account-one'), title: '高一物理', sessionIds: [sid('session-one')], path: '/srv/private-account-one' },
    { workspaceId: wid('account-two'), title: '高二物理', sessionIds: [], path: '/srv/private-account-two' },
  ]
  render(<HeaderWorkspace t={t} createWorkspace={createWorkspace} renameWorkspace={renameWorkspace} selectWorkspace={selectWorkspace}
    useWorkspaces={selector => selector({
      items: items.map(item => ({ ...item, createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z' })),
      archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })}
    useSessions={selector => selector({
      ids: empty ? [] : [sid('session-one')],
      byId: empty ? {} : { 'session-one': {
        id: sid('session-one'), displayTitle: '练习', blank: true, running: false, updatedAt: 0, retainedBy: { mainView: 1 },
      } },
      phase: 'ready', projectionsBySession: {},
    })}
    usePanelInfo={neverHook} useSessionStatus={neverHook} useSessionRetainInfo={neverHook} useResource={neverHook} />)
  fireEvent.click(screen.getByRole('button', { name: /^我的工作区/ }))
  return { createWorkspace, renameWorkspace, selectWorkspace }
}

describe('student account header workspace boundary', () => {
  it('selects only account workspaces and never renders host paths or a directory picker', async () => {
    const actions = mount()
    const panel = screen.getByRole('dialog', { name: '我的工作区' })
    expect(panel.closest('header')).toBeNull()
    expect(within(panel).getByText('高一物理')).toBeTruthy()
    expect(within(panel).getByText('高二物理')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/srv/')
    expect(screen.queryByRole('menuitem', { name: /添加工作区|选择文件夹/ })).toBeNull()
    expect(screen.queryByRole('tree')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: '打开' }))
    await waitFor(() => { expect(actions.selectWorkspace).toHaveBeenCalledWith('account-two') })
    expect(actions.createWorkspace).not.toHaveBeenCalled()
  })

  it('keeps a cold start reachable through account-name creation rather than host-directory adoption', async () => {
    const actions = mount(true)
    fireEvent.change(screen.getByPlaceholderText('例如：高一物理备课'), { target: { value: '我的实验' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))
    await waitFor(() => { expect(actions.createWorkspace).toHaveBeenCalledWith('我的实验') })
    await waitFor(() => { expect(actions.selectWorkspace).toHaveBeenCalledWith('account-new') })
    expect(actions.createWorkspace.mock.calls[0]?.[0]).toBeTypeOf('string')
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('renames through the same account action as the existing hero picker', async () => {
    const actions = mount()
    fireEvent.click(screen.getAllByRole('button', { name: '重命名' })[0]!)
    fireEvent.change(screen.getByDisplayValue('高一物理'), { target: { value: '力学实验' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(actions.renameWorkspace).toHaveBeenCalledWith('account-one', '力学实验') })
    expect(actions.selectWorkspace).not.toHaveBeenCalled()
  })
})
