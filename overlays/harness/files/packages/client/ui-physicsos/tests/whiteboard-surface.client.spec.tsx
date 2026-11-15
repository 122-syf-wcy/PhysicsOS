// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { WhiteboardSurface } from '../src/client/whiteboard/WhiteboardSurface.tsx'
import { createWhiteboardController, type WhiteboardState } from '../src/client/whiteboard/controller.ts'
import type { WhiteboardApi, WhiteboardSummary } from '../src/client/whiteboard/api.ts'
import type { WhiteboardSurfaceProps } from '../src/client/whiteboard/contract.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function unused(): never { throw new Error('This catalog test does not use the editor or unrelated framework seats.') }
function fixture(documents: readonly WhiteboardSummary[] = []) {
  let namespace: string | undefined = 'whiteboard-catalog-test'
  const list = vi.fn<WhiteboardApi['list']>().mockResolvedValue(documents)
  const create = vi.fn<WhiteboardApi['create']>(async input => ({
    document: { schemaVersion: 1, id: 'created-board', title: input.title, scene: { elements: [], appState: {} }, sourceImages: [], appliedGenerationIds: [] },
    revision: 1, updatedAt: '2026-11-16T08:00:00Z',
  }))
  const api: WhiteboardApi = { list, create, read: unused, save: unused, uploadImage: unused, readImage: unused, startGeneration: unused, readGeneration: unused, cancelGeneration: unused }
  const controller = createWhiteboardController({ api, getNamespace: () => namespace, id: () => 'catalog-create-operation', schedule: () => undefined, cancelSchedule: () => undefined })
  onTestFinished(() => { controller.dispose() })
  const openWhiteboardView = vi.fn()
  const returnToExperiments = vi.fn()
  const useWhiteboardState: WhiteboardSurfaceProps['useWhiteboardState'] = <T,>(select: (state: WhiteboardState) => T): T =>
    select(useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot))
  const props = {
    whiteboardController: controller, useWhiteboardState, openWhiteboardView, returnToExperiments,
    t: (key: keyof typeof en) => en[key], renderFactorySlot: unused,
    useSessions: unused, useSessionStatus: unused, useSessionRetainInfo: unused,
    useWorkspaces: unused, usePanelInfo: unused, useResource: unused,
  } satisfies WhiteboardSurfaceProps
  return { props, list, create, openWhiteboardView, returnToExperiments, logout: () => { namespace = undefined; controller.resetNamespace() } }
}

describe('classroom whiteboard catalog', () => {
  it('offers truthful help and creates a named board through the existing empty-state modal', async () => {
    const f = fixture()
    render(<WhiteboardSurface {...f.props} />)
    expect(await screen.findByRole('heading', { name: en['whiteboard.empty'] })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en['whiteboard.new'] })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en['whiteboard.catalog.help'] }))
    const help = screen.getByRole('dialog', { name: en['whiteboard.catalog.help'] })
    expect(within(help).getByText(en['whiteboard.upload'])).toBeTruthy()
    expect(within(help).getByText(en['whiteboard.sourceEmpty'])).toBeTruthy()
    fireEvent.click(within(help).getByRole('button', { name: en['whiteboard.close'] }))
    fireEvent.click(screen.getByRole('button', { name: en['whiteboard.new'] }))
    const dialog = screen.getByRole('dialog', { name: en['whiteboard.new'] })
    fireEvent.change(within(dialog).getByRole('textbox', { name: en['whiteboard.name'] }), { target: { value: 'Incline lesson' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: en['whiteboard.confirm'] })) })
    expect(f.create).toHaveBeenCalledOnce()
    expect(f.create.mock.calls[0]?.[0].title).toBe('Incline lesson')
    expect(f.openWhiteboardView).toHaveBeenCalledWith('created-board')
    expect(screen.queryByRole('dialog', { name: en['whiteboard.new'] })).toBeNull()
  })

  it('distinguishes no search results from an empty library and preserves clear and return actions', async () => {
    const f = fixture([{ id: 'saved-board', title: 'Incline lesson', revision: 2, updatedAt: '2026-11-16T08:00:00Z' }])
    render(<WhiteboardSurface {...f.props} />)
    expect(await screen.findByRole('button', { name: 'Incline lesson' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: en['whiteboard.search'] }), { target: { value: 'unmatched topic' } })
    expect(screen.getByRole('heading', { name: en['whiteboard.catalog.noResults'] })).toBeTruthy()
    expect(screen.queryByText(en['whiteboard.empty'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['whiteboard.catalog.clearSearch'] }))
    expect(screen.getByRole('button', { name: 'Incline lesson' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Incline lesson' }))
    expect(f.openWhiteboardView).toHaveBeenCalledWith('saved-board')
    fireEvent.click(screen.getByRole('button', { name: en['whiteboard.backExperiments'] }))
    expect(f.returnToExperiments).toHaveBeenCalledOnce()
  })

  it('keeps loading, list failures and account requirements separate from the empty state', async () => {
    const f = fixture()
    let reject!: (reason: Error) => void
    f.list.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    render(<WhiteboardSurface {...f.props} />)
    expect(screen.getByRole('status').textContent).toContain(en['whiteboard.catalog.loading'])
    expect(screen.queryByText(en['whiteboard.empty'])).toBeNull()
    await act(async () => { reject(new Error('Whiteboard list unavailable')) })
    expect(screen.getByRole('alert').textContent).toBe('Whiteboard list unavailable')
    expect(screen.queryByText(en['whiteboard.empty'])).toBeNull()
    act(() => { f.logout() })
    expect(screen.getByText(en['whiteboard.loginRequired'])).toBeTruthy()
    expect((screen.getByRole('button', { name: en['whiteboard.new'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(en['whiteboard.empty'])).toBeNull()
  })
})
