// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectWorkspaceRows } from '../src/client/project-workspace-view.ts'
import type { ProjectStateBridge } from '../src/client/StudyProjects.tsx'
import type { ProjectProductState } from '../src/client/learning-api.ts'

afterEach(cleanup)
const items = [{ workspaceId: 'live', title: 'Live' }, { workspaceId: 'deleted', title: 'Deleted' }, { workspaceId: 'foreign', title: 'Foreign' }]
const state = (projectId: string, lifecycle: ProjectProductState['state']): ProjectProductState => ({ projectId, state: lifecycle, generation: 1, version: 1, updatedAt: '2026-11-17T00:00:00.000Z' })
function View({ bridge }: { readonly bridge: ProjectStateBridge }) {
  const projected = useProjectWorkspaceRows(items, 'ready', bridge)
  return <div><output>{projected.state}</output>{projected.items.map(item => <span key={item.workspaceId}>{item.title}</span>)}</div>
}
function fixture() {
  const listeners = new Set<() => void>()
  let owner = 'alice', resolved = true
  const read = vi.fn(async () => ({ items: [state('live', 'live'), state('deleted', 'deleted')] }))
  const bridge: ProjectStateBridge = {
    api: { listProjectStates: read } as unknown as ProjectStateBridge['api'],
    enabled: () => false, readable: () => true, ready: () => resolved, accountKey: () => owner,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { bridge, read, notify: () => { for (const listener of listeners) listener() }, switchOwner: (value: string) => { owner = value }, unresolved: () => { resolved = false } }
}
describe('top workspace picker lifecycle projection', () => {
  it('uses the exact authorized live allowlist even when bridge writes are disabled', async () => {
    const f = fixture(); render(<View bridge={f.bridge} />)
    await waitFor(() => { expect(screen.getByText('Live')).toBeTruthy() })
    expect(screen.queryByText('Deleted')).toBeNull()
    expect(screen.queryByText('Foreign')).toBeNull()
    expect(f.read).toHaveBeenCalledWith({ state: 'all', limit: 100 })
  })
  it('hides all unverified native rows while the capability is unknown', () => {
    const f = fixture(); f.unresolved(); render(<View bridge={f.bridge} />)
    expect(screen.getByText('loading')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText('Foreign')).toBeNull()
  })
  it('never turns a failed state read into live native projects', async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error('offline'))
    render(<View bridge={f.bridge} />)
    await waitFor(() => { expect(screen.getByText('error')).toBeTruthy() })
    expect(screen.queryByText('Live')).toBeNull()
  })
  it('re-reads after a lifecycle acknowledgement and removes the now deleted group', async () => {
    const f = fixture(); render(<View bridge={f.bridge} />)
    await waitFor(() => { expect(screen.getByText('Live')).toBeTruthy() })
    f.read.mockResolvedValue({ items: [state('live', 'deleted'), state('deleted', 'deleted')] })
    act(f.notify)
    await waitFor(() => { expect(screen.queryByText('Live')).toBeNull() })
  })
})
