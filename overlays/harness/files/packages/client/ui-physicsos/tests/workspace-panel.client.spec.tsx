// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspacePanel, type WorkspacePanelProps } from '../src/client/WorkspacePanel.tsx'
import type { WorkspaceId } from '../src/client/runtime-compat.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const workspace = (over: { workspaceId: string; title: string } = {
  workspaceId: 'ws-1',
  title: 'a1b2c3d4e5f60718293a4b5c',
}) => over

const mount = (
  items: ReturnType<typeof workspace>[] = [],
  options: { open?: boolean; selectedId?: WorkspaceId } = {},
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

  render(
    <WorkspacePanel
      open={options.open ?? true}
      selectedId={options.selectedId}
      onPick={onPick}
      onClose={onClose}
      useWorkspaces={useWorkspaces as unknown as WorkspacePanelProps['useWorkspaces']}
      createWorkspace={createWorkspace}
      renameWorkspace={renameWorkspace}
      t={t as never}
      /* The seat's root-scope standard hooks; the panel reads none of them. */
      usePanelInfo={(() => undefined) as never}
      useSessions={(() => undefined) as never}
      useSessionStatus={(() => undefined) as never}
      useSessionRetainInfo={() => undefined}
      useResource={(() => undefined) as never}
    />,
  )
  return { createWorkspace, renameWorkspace, onPick, onClose }
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
