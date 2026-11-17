// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudyProjects, effectiveProjectOf, sessionProjectOf } from '../src/client/StudyProjects.tsx'
import { collectLearningPages, type ProjectProductState, type SessionProjectAssignment } from '../src/client/learning-api.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
const t = (key: keyof typeof zh) => zh[key]
const project = (projectId: string, state: ProjectProductState['state']): ProjectProductState => ({ projectId, state, generation: state === 'deleted' ? 1 : 0, version: state === 'deleted' ? 1 : 0, updatedAt: '2026-11-17T00:00:00.000Z' })
function fixture(writable = true) {
  let states = [project('momentum', 'deleted'), project('energy', 'live')]
  let assignments: SessionProjectAssignment[] = [
    { sessionId: 's1', projectId: 'momentum', assigned: false, version: 0, updatedAt: '1970-01-01T00:00:00.000Z' },
    { sessionId: 's2', projectId: 'energy', assigned: false, version: 0, updatedAt: '1970-01-01T00:00:00.000Z' },
    { sessionId: 's3', projectId: null, assigned: false, version: 0, updatedAt: '1970-01-01T00:00:00.000Z' },
  ]
  const listeners = new Set<() => void>()
  const api = {
    listProjectStates: vi.fn(async () => ({ items: states })),
    listSessionAssignments: vi.fn(async () => ({ items: assignments })),
    getProjectState: vi.fn(), getSessionAssignment: vi.fn(),
    mutateProjectState: vi.fn(async (id: string, mutation: any) => {
      const current = states.find(value => value.projectId === id)!
      const next = { ...current, state: mutation.action === 'delete' ? 'deleted' as const : 'live' as const, generation: current.generation + 1, version: current.version + 1 }
      states = states.map(value => value.projectId === id ? next : value)
      return { state: next }
    }),
    assignSessionProject: vi.fn(async (id: string, mutation: any) => {
      const assignment = { sessionId: id, projectId: mutation.projectId, version: mutation.expectedVersion + 1, updatedAt: '2026-11-17T01:00:00.000Z' }
      assignments = [...assignments.filter(value => value.sessionId !== id), assignment]
      return { assignment }
    }),
  }
  return { api, listeners, props: {
    t, projectState: { api, enabled: () => writable, readable: () => true, ready: () => true, accountKey: () => 'GZU:alice', subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    useWorkspaces: (select: any) => select({ items: [{ workspaceId: 'momentum', title: '动量', sessionIds: ['s1'] }, { workspaceId: 'energy', title: '能量', sessionIds: ['s2'] }], archivedSessionIds: [] }),
    useSessions: (select: any) => select({ ids: ['s1', 's2', 's3'], byId: { s1: { id: 's1', displayTitle: '碰撞分析', blank: false, origin: 'user', updatedAt: 3 }, s2: { id: 's2', displayTitle: '弹簧做功', blank: false, origin: 'user', updatedAt: 2 }, s3: { id: 's3', displayTitle: '未归组问题', blank: false, origin: 'user', updatedAt: 1 } } }),
    createProject: vi.fn(), renameProject: vi.fn(), openConversation: vi.fn(), newConversation: vi.fn(), renameConversation: vi.fn(), addConversation: vi.fn(),
    listBoards: vi.fn(async () => [{ id: 'board-1', title: '碰撞画布', projectId: 'momentum' }, { id: 'board-2', title: '自由画布' }]), assignBoard: vi.fn(), newBoard: vi.fn(), openBoard: vi.fn(),
  } }
}
describe('project soft-delete UI projection', () => {
  it('makes deleted-project sessions and canvases reachable through real ungrouped navigation', async () => {
    const f = fixture(), view = render(<StudyProjects {...f.props as any} />)
    await waitFor(() => { expect(f.api.listProjectStates).toHaveBeenCalled() })
    await waitFor(() => { expect(view.getByRole('button', { name: /未分组.*资料/ }).hasAttribute('disabled')).toBe(false) })
    expect(view.queryByRole('button', { name: /^动量/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /未分组.*资料/ }))
    expect(view.getByText('碰撞分析')).toBeTruthy()
    expect(view.getByText('未归组问题')).toBeTruthy()
    expect(view.queryByText('弹簧做功')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['projects.boards'] }))
    await waitFor(() => { expect(view.getByText('碰撞画布')).toBeTruthy() })
    fireEvent.click(view.getByText('碰撞画布'))
    expect(f.props.openBoard).toHaveBeenCalledWith('board-1')
  })
  it('explicitly moves a session via product override, and restore does not reclaim it', async () => {
    const f = fixture(), view = render(<StudyProjects {...f.props as any} />)
    await waitFor(() => { expect(view.getByRole('button', { name: /未分组.*资料/ }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(view.getByRole('button', { name: /未分组.*资料/ }))
    fireEvent.click(view.getByRole('button', { name: '移动对话 · 碰撞分析' }))
    fireEvent.change(screen.getByRole('combobox', { name: '目标项目' }), { target: { value: 'energy' } })
    fireEvent.click(screen.getByRole('button', { name: zh['projects.save'] }))
    await waitFor(() => { expect(f.api.assignSessionProject).toHaveBeenCalledWith('s1', expect.objectContaining({ projectId: 'energy', expectedVersion: 0 })) })
    expect(f.props.addConversation).not.toHaveBeenCalled() // Native insertSessionBefore is only ordering.
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await waitFor(() => { expect(view.getByRole('button', { name: zh['projects.title'] })).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: zh['projects.title'] }))
    fireEvent.change(view.getByRole('combobox', { name: '项目状态' }), { target: { value: 'deleted' } })
    fireEvent.click(view.getByRole('button', { name: '恢复项目 · 动量' }))
    await waitFor(() => { expect(f.api.mutateProjectState).toHaveBeenCalledWith('momentum', expect.objectContaining({ action: 'restore', expectedGeneration: 1 })) })
    const assignment = { sessionId: 's1', projectId: 'energy', version: 1, updatedAt: '2026-11-17T01:00:00.000Z' }
    expect(sessionProjectOf('s1', 'momentum', [assignment])).toBe('energy')
    expect(effectiveProjectOf('momentum', new Set(['energy']))).toBeUndefined()
  })
  it('bridge still reads deleted states without exposing restore/delete mutation buttons', async () => {
    const f = fixture(false), view = render(<StudyProjects {...f.props as any} />)
    await waitFor(() => { expect(view.getByRole('button', { name: /未分组.*资料/ }).hasAttribute('disabled')).toBe(false) })
    expect(view.queryByRole('button', { name: /^动量/ })).toBeNull()
    fireEvent.change(view.getByRole('combobox', { name: '项目状态' }), { target: { value: 'deleted' } })
    expect(view.getByText('动量')).toBeTruthy()
    expect(view.queryByRole('button', { name: '恢复项目 · 动量' })).toBeNull()
    expect(f.api.mutateProjectState).not.toHaveBeenCalled()
  })
  it('exhausts >100 rows and rejects repeating cursors rather than silently truncating', async () => {
    const values = Array.from({ length: 205 }, (_, index) => index)
    const read = vi.fn(async (cursor?: string) => {
      const start = Number(cursor ?? 0), items = values.slice(start, start + 100)
      return { items, ...(start + 100 >= values.length ? {} : { nextCursor: String(start + 100) }) }
    })
    expect(await collectLearningPages(read)).toEqual(values)
    expect(read).toHaveBeenCalledTimes(3)
    await expect(collectLearningPages(async () => ({ items: [1], nextCursor: 'same' }))).rejects.toThrow('repeated a cursor')
  })
})
