// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WorkspacePanel, WorkspacePickerTrigger, type WorkspacePanelProps,
} from '../src/client/WorkspacePanel.tsx'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const workspace = (over: Partial<WorkspacePanelProps['useWorkspaces'] extends never ? never : {
  workspaceId: string
  title: string
  path: string
}> = {}) => ({
  workspaceId: 'ws-1',
  title: 'a1b2c3d4e5f60718293a4b5c',
  path: '/srv/physicsos-users/a1b2c3d4e5f60718293a4b5c',
  ...over,
})

const mount = (items: ReturnType<typeof workspace>[] = [], names = ['我的工作区']) => {
  const createWorkspace = vi.fn().mockImplementation(async (name: string) => ({
    id: 'ws-new',
    name,
  }))
  const renameWorkspace = vi.fn().mockResolvedValue(undefined)
  const openWorkspace = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn()
  const usePanel = <T,>(selector: (state: { open: boolean }) => T): T => selector({ open: true })
  const useWorkspaces = <T,>(
    selector: (state: {
      items: readonly ReturnType<typeof workspace>[]
      state: 'ready'
    }) => T,
  ): T => selector({ items, state: 'ready' })

  render(
    <WorkspacePanel
      usePanel={usePanel}
      useWorkspaces={useWorkspaces as never}
      createWorkspace={createWorkspace}
      renameWorkspace={renameWorkspace}
      openWorkspace={openWorkspace}
      close={close}
      t={t as never}
    />,
  )
  return { createWorkspace, renameWorkspace, openWorkspace, close, names }
}

describe('WorkspacePanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('offers creation when the account has no workspace', async () => {
    const flow = mount([])
    expect(await screen.findByText('还没有工作区')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：高一物理备课'), {
      target: { value: '高一物理' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    await waitFor(() => { expect(flow.createWorkspace).toHaveBeenCalledWith('高一物理') })
    await waitFor(() => { expect(flow.openWorkspace).toHaveBeenCalledWith('ws-new') })
    expect(flow.close).toHaveBeenCalled()
  })

  it('shows only human names and can rename the current account workspace', async () => {
    const flow = mount([workspace()])
    await waitFor(() => {
      expect(screen.getAllByText('我的工作区').length).toBeGreaterThanOrEqual(2)
    })
    expect(screen.queryByText(/a1b2c3d4e5f60718293a4b5c/)).toBeNull()
    expect(screen.queryByText(/\/srv\/physicsos-users/)).toBeNull()

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
})

describe('WorkspacePickerTrigger', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('opens the product workspace panel instead of the directory browser', () => {
    const openPanel = vi.fn()
    const usePanel = <T,>(selector: (state: { open: boolean }) => T): T => selector({ open: false })
    const useWorkspaces = <T,>(selector: (state: {
      items: readonly ReturnType<typeof workspace>[]
    }) => T): T => selector({ items: [workspace()] })
    render(
      <WorkspacePickerTrigger
        usePanel={usePanel}
        useWorkspaces={useWorkspaces as never}
        openPanel={openPanel}
        t={t as never}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '我的工作区' }))
    expect(openPanel).toHaveBeenCalledTimes(1)
  })
})
