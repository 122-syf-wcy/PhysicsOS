// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspacePanel, type WorkspacePanelProps } from '../src/client/WorkspacePanel.tsx'
import type { WorkspaceId } from '../src/client/runtime-compat.ts'
import type { ProjectStateBridge } from '../src/client/StudyProjects.tsx'
import type { ProductStateMutation, ProjectProductState } from '../src/client/learning-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const workspace = (over: { workspaceId: string; title: string } = {
  workspaceId: 'ws-1',
  title: 'a1b2c3d4e5f60718293a4b5c',
}) => over

const mount = (
  items: ReturnType<typeof workspace>[] = [],
  options: { open?: boolean; selectedId?: WorkspaceId; projectState?: ProjectStateBridge } = {},
) => {
  const createWorkspace = vi.fn().mockImplementation(async (name: string) => ({
    id: 'ws-new',
    name,
  }))
  const renameWorkspace = vi.fn().mockResolvedValue(undefined)
  const onPick = vi.fn()
  const onClose = vi.fn()
  const useWorkspaces = <T,>(
    selector: (state: {
      items: readonly ReturnType<typeof workspace>[]
      state: 'ready'
    }) => T,
  ): T => selector({ items, state: 'ready' })

  const panel = (open: boolean) => (
    <WorkspacePanel
      open={open}
      selectedId={options.selectedId}
      onPick={onPick}
      onClose={onClose}
      useWorkspaces={useWorkspaces as unknown as WorkspacePanelProps['useWorkspaces']}
      createWorkspace={createWorkspace}
      renameWorkspace={renameWorkspace}
      {...(options.projectState === undefined ? {} : { projectState: options.projectState })}
      t={t as never}
      /* The seat's root-scope standard hooks; the panel reads none of them. */
      usePanelInfo={(() => undefined) as never}
      useSessions={(() => undefined) as never}
      useSessionStatus={(() => undefined) as never}
      useSessionRetainInfo={() => undefined}
      useResource={(() => undefined) as never}
    />
  )
  const view = render(panel(options.open ?? true))
  return { createWorkspace, renameWorkspace, onPick, onClose, setOpen: (open: boolean) => view.rerender(panel(open)) }
}

describe('WorkspacePanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('renders nothing until the shell opens the seat', () => {
    mount([workspace()], { open: false })
    expect(screen.queryByText('我的工作区')).toBeNull()
  })

  it('offers creation when the account has no workspace', async () => {
    const flow = mount([])
    expect(await screen.findByText('还没有工作区')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：高一物理备课'), {
      target: { value: '高一物理' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    await waitFor(() => { expect(flow.createWorkspace).toHaveBeenCalledWith('高一物理') })
    /* Creating enters through the shell's own pick, so the chip's label and the
       open Session can never disagree. */
    await waitFor(() => { expect(flow.onPick).toHaveBeenCalledWith('ws-new') })
    expect(flow.onClose).toHaveBeenCalled()
  })

  it("opens another workspace through the shell's pick and closes", async () => {
    const flow = mount([
      workspace({ workspaceId: 'ws-2', title: '高一物理' }),
      workspace({ workspaceId: 'ws-1', title: '高二物理' }),
    ], { selectedId: 'ws-1' as WorkspaceId })

    /* The current workspace is marked, and its own Open is not offered. */
    expect(screen.getByText('当前')).toBeTruthy()
    const rows = screen.getAllByRole('button', { name: '打开' })
    expect(rows).toHaveLength(1)

    fireEvent.click(rows[0]!)
    expect(flow.onPick).toHaveBeenCalledWith('ws-2')
    expect(flow.onClose).toHaveBeenCalled()
  })

  it('shows only human names and can rename the current account workspace', async () => {
    const flow = mount([workspace()])
    await waitFor(() => {
      expect(screen.getAllByText('我的工作区').length).toBeGreaterThanOrEqual(2)
    })
    expect(screen.queryByText(/a1b2c3d4e5f60718293a4b5c/)).toBeNull()
    expect(screen.queryByText(/srv/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = screen.getByDisplayValue('我的工作区')
    fireEvent.change(input, { target: { value: '高一物理' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(flow.renameWorkspace).toHaveBeenCalledWith('ws-1', '高一物理') })
  })

  it('only renders workspaces present in the current account feed', () => {
    mount([workspace({ workspaceId: 'mine', title: '我的工作区' })])
    expect(screen.queryByText('另一个账号的工作区')).toBeNull()
  })

  it('reports the account failure instead of hiding it', async () => {
    const flow = mount([workspace({ workspaceId: 'ws-1', title: '高一物理' })])
    flow.createWorkspace.mockRejectedValueOnce(new Error('workspace limit reached (20)'))

    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }))
    fireEvent.change(screen.getByPlaceholderText('例如：高一物理备课'), {
      target: { value: '第三个' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    expect(await screen.findByText('workspace limit reached (20)')).toBeTruthy()
  })
})


it('owns initial focus and traps Tab, then restores focus on close', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  mount([])
  const dialog = screen.getByRole('dialog')
  expect(dialog.contains(document.activeElement)).toBe(true)
  const buttons = dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
  const first = buttons[0]!
  first.focus()
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(first)
  cleanup()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})


it('Escape closes the new workspace seat through its onClose callback', () => {
  try {
    const flow = mount([])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(flow.onClose).toHaveBeenCalledTimes(1)
  } finally {
    cleanup()
  }
})

function lifecycleFixture(enabled = true, notifyOnCommit = true) {
  let account = 'school:alice'
  const listeners = new Set<() => void>()
  const heads = new Map<string, ProjectProductState>(['ws-1', 'ws-2'].map(projectId => [projectId,
    { projectId, state: 'live', version: 0, generation: 0, updatedAt: '2026-11-17T00:00:00.000Z' }]))
  const receipts = new Map<string, { id: string; body: string; state: ProjectProductState }>()
  const notify = () => { for (const listener of listeners) listener() }
  const mutate = vi.fn(async (id: string, mutation: ProductStateMutation) => {
    const replay = receipts.get(mutation.operationId)
    if (replay) {
      if (replay.id !== id || replay.body !== JSON.stringify(mutation)) throw new Error('operation conflict')
      return { state: replay.state }
    }
    const head = heads.get(id)
    if (!enabled || !head || head.version !== mutation.expectedVersion || head.generation !== mutation.expectedGeneration) throw new Error('工作区状态已变化，请刷新后重试')
    const next: ProjectProductState = { ...head, generation: head.generation + 1, version: head.version + 1,
      state: mutation.action === 'delete' ? 'deleted' : mutation.action === 'restore' ? head.restoreState ?? 'live' : 'live',
      ...(mutation.action === 'delete' ? { restoreState: head.state === 'archived' ? 'archived' as const : 'live' as const } : {}),
      updatedAt: '2026-11-17T01:00:00.000Z' }
    heads.set(id, next); receipts.set(mutation.operationId, { id, body: JSON.stringify(mutation), state: next }); if (notifyOnCommit) notify()
    return { state: next }
  })
  const bridge: ProjectStateBridge = {
    enabled: () => enabled, readable: () => true, ready: () => true, accountKey: () => account,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    api: {
      listProjectStates: async () => ({ items: account === 'school:alice' ? [...heads.values()] : [] }),
      getProjectState: async id => { const state = heads.get(id); if (!state) throw new Error('not found'); return { state } },
      mutateProjectState: mutate,
      listSessionAssignments: async () => ({ items: [] }),
      getSessionAssignment: async () => { throw new Error('not used by workspace deletion') },
      assignSessionProject: async () => { throw new Error('must not move or delete conversations') },
    },
  }
  const rows = [workspace({ workspaceId: 'ws-1', title: '高一物理' }), workspace({ workspaceId: 'ws-2', title: '高二物理' })]
  return { bridge, heads, mutate, rows, notify,
    switchAccount: (value: string) => { account = value; notify() },
    archived: (id: string) => { const head = heads.get(id)!; heads.set(id, { ...head, state: 'archived' }); notify() },
  }
}

describe('workspace popup recoverable deletion', () => {
  afterEach(cleanup)
  it('requires confirmation, explains current-workspace retention, and cancels without a request', async () => {
    const f = lifecycleFixture(), flow = mount(f.rows, { selectedId: 'ws-1' as WorkspaceId, projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(zh['workspacePanel.deleteBody'])).toBeTruthy()
    expect(screen.getByText(zh['workspacePanel.deleteCurrent'])).toBeTruthy()
    expect(f.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(f.mutate).not.toHaveBeenCalled()
    expect(flow.onPick).not.toHaveBeenCalled()
    expect(flow.onClose).not.toHaveBeenCalled()
  })
  it('deletes the current group via exact CAS and restores it from the popup recycle bin without native deletion', async () => {
    const f = lifecycleFixture(), flow = mount(f.rows, { selectedId: 'ws-1' as WorkspaceId, projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await screen.findByRole('button', { name: '撤销删除' })
    expect(f.mutate).toHaveBeenCalledWith('ws-1', expect.objectContaining({ action: 'delete', expectedVersion: 0, expectedGeneration: 0 }))
    expect(f.rows).toHaveLength(2)
    expect(flow.createWorkspace).not.toHaveBeenCalled(); expect(flow.renameWorkspace).not.toHaveBeenCalled(); expect(flow.onPick).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('工作区状态'), { target: { value: 'deleted' } })
    const restore = await screen.findByRole('button', { name: '恢复工作区 · 高一物理' })
    expect(screen.queryByRole('button', { name: '打开' })).toBeNull()
    fireEvent.click(restore)
    await waitFor(() => { expect(f.heads.get('ws-1')?.state).toBe('live') })
    expect(f.mutate).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ action: 'restore', expectedVersion: 1, expectedGeneration: 1 }))
    expect(await screen.findByRole('button', { name: '删除 · 高一物理' })).toBeTruthy()
  })
  it('replays the same delete operation after an unconfirmed response instead of adopting a newer version', async () => {
    const f = lifecycleFixture(), original = f.mutate.getMockImplementation()!
    f.mutate.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('保存结果尚未确认') })
    mount(f.rows, { projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await screen.findByText('保存结果尚未确认')
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await screen.findByRole('button', { name: '撤销删除' })
    expect(f.mutate.mock.calls[1]).toEqual(f.mutate.mock.calls[0])
    expect(f.heads.get('ws-1')?.generation).toBe(1)
  })
  it.each(['restore', 'unarchive'] as const)('retries an unconfirmed %s with the original operation id and CAS', async action => {
    const f = lifecycleFixture(true, false), original = f.mutate.getMockImplementation()!, head = f.heads.get('ws-1')!
    f.heads.set('ws-1', { ...head, state: action === 'restore' ? 'deleted' : 'archived', generation: 2, version: 2 })
    f.mutate.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('恢复结果尚未确认') })
    mount(f.rows, { projectState: f.bridge })
    fireEvent.change(await screen.findByLabelText('工作区状态'), { target: { value: action === 'restore' ? 'deleted' : 'archived' } })
    fireEvent.click(await screen.findByRole('button', { name: '恢复工作区 · 高一物理' }))
    await screen.findByText('恢复结果尚未确认')
    fireEvent.click(screen.getByRole('button', { name: '恢复工作区 · 高一物理' }))
    await screen.findByText(zh['workspacePanel.restoredNotice'])
    expect(f.mutate.mock.calls[1]).toEqual(f.mutate.mock.calls[0])
    expect(f.heads.get('ws-1')?.generation).toBe(3)
  })
  it('preserves an archived state when deletion is undone', async () => {
    const f = lifecycleFixture(); f.archived('ws-1')
    mount(f.rows, { projectState: f.bridge })
    fireEvent.change(await screen.findByLabelText('工作区状态'), { target: { value: 'archived' } })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    fireEvent.click(await screen.findByRole('button', { name: '撤销删除' }))
    await screen.findByText(zh['workspacePanel.restoredArchived'])
    expect(f.heads.get('ws-1')?.state).toBe('archived')
  })
  it('rejects a stale confirmation rather than deleting the newer group state', async () => {
    const f = lifecycleFixture(); mount(f.rows, { projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    const head = f.heads.get('ws-1')!; f.heads.set('ws-1', { ...head, generation: 1, version: 1 })
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await screen.findByText('工作区状态已变化，请刷新后重试')
    expect(f.heads.get('ws-1')?.state).toBe('live')
    expect(screen.queryByRole('button', { name: '撤销删除' })).toBeNull()
  })
  it('keeps bridge-mode deleted groups visible only in the recycle bin without allowing writes', async () => {
    const f = lifecycleFixture(false), head = f.heads.get('ws-1')!
    f.heads.set('ws-1', { ...head, state: 'deleted', generation: 1, version: 1 })
    mount(f.rows, { projectState: f.bridge })
    fireEvent.change(await screen.findByLabelText('工作区状态'), { target: { value: 'deleted' } })
    await screen.findByText('高一物理')
    expect(screen.queryByRole('button', { name: /删除 ·/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /恢复工作区 ·/ })).toBeNull()
    expect(f.mutate).not.toHaveBeenCalled()
  })
  it('does not leave the reopened popup busy or publish a closed operation acknowledgement', async () => {
    const f = lifecycleFixture(true, false), original = f.mutate.getMockImplementation()!
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve })
    f.mutate.mockImplementationOnce(async (...args) => { const response = await original(...args); await blocked; return response })
    const flow = mount(f.rows, { projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await waitFor(() => { expect(f.mutate).toHaveBeenCalledOnce() })
    flow.setOpen(false); flow.setOpen(true)
    await screen.findByRole('button', { name: '删除 · 高二物理' })
    await act(async () => { release(); await blocked })
    expect(screen.queryByRole('button', { name: '撤销删除' })).toBeNull()
    expect(screen.getByRole('button', { name: '删除 · 高二物理' }).hasAttribute('disabled')).toBe(false)
  })
  it('isolates an old delete acknowledgement across an A→B→A identity change', async () => {
    const f = lifecycleFixture(), original = f.mutate.getMockImplementation()!
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve })
    f.mutate.mockImplementationOnce(async (...args) => { const response = await original(...args); await blocked; return response })
    mount(f.rows, { projectState: f.bridge })
    fireEvent.click(await screen.findByRole('button', { name: '删除 · 高一物理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除工作区' }))
    await waitFor(() => { expect(f.mutate).toHaveBeenCalledOnce() })
    act(() => { f.switchAccount('school:bob'); f.switchAccount('school:alice') })
    await act(async () => { release(); await blocked })
    expect(screen.queryByRole('button', { name: '撤销删除' })).toBeNull()
    expect(screen.queryByText(zh['workspacePanel.deletedNotice'])).toBeNull()
  })
})
