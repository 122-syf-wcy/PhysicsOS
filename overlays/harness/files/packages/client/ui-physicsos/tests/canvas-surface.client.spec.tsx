// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { useSyncExternalStore } from 'react'
import { deleteDB } from 'idb'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { canonicalStringify } from '@physicsos/physics-workbench/json'

import { CanvasSurface } from '../src/client/canvas/CanvasSurface.tsx'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasSurfaceProps } from '../src/client/canvas/contract.ts'
import type { CanvasController, CanvasObservable } from '../src/client/canvas/types.ts'
import type { PhysicsSurfaceState } from '../src/client/surface-store.ts'
import { createCanvasNodeTestProps } from './canvas-ui-fixtures.client.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const controllers: CanvasController[] = []
const databaseNames = new Set<string>()

function selectorHook<T>(source: CanvasObservable<T>): SnapshotSelectorHook<T> {
  return <Selected,>(select: (state: T) => Selected): Selected =>
    select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))
}

/** Only browser bindings are supplied; catalog commands, roster and durable drafts are real. */
async function catalogFixture() {
  const databaseName = `physicsos-canvas-surface-${randomUUID()}`
  databaseNames.add(databaseName)
  let sequence = 0
  let timestamp = '2026-11-01T10:00:00.000Z'
  const controller = createCanvasController({
    api: createCanvasApi(async () => { throw new Error('An offline catalog must not send HTTP.') }),
    persistence: createCanvasPersistence({ name: databaseName, hash }), getAccount: () => undefined,
    createRuntime: async () => { throw new Error('Empty catalog documents must not create experiment runtimes.') },
    hash, id: prefix => `${prefix}-${databaseName}-${++sequence}`, now: () => timestamp, online: () => false,
    window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined,
  })
  controllers.push(controller)
  const oldest = await controller.create('Zulu motion')
  timestamp = '2026-11-02T10:00:00.000Z'
  const middle = await controller.create('Alpha motion')
  timestamp = '2026-11-03T10:00:00.000Z'
  const newest = await controller.create('Mike motion')
  timestamp = '2026-11-04T10:00:00.000Z'
  await controller.rename(oldest, 'Zulu revised motion')
  const bindings = createCanvasNodeTestProps('note')
  const surface = createSnapshotStore<PhysicsSurfaceState>({ surface: 'canvas' })
  const props = {
    ...bindings.props,
    useCanvasRoster: selectorHook(controller), usePhysicsSurface: selectorHook(surface),
    canvasCommands: controller,
  } satisfies CanvasSurfaceProps
  return { controller, props, oldest, middle, newest, at: (value: string) => { timestamp = value } }
}

function displayedIds(): (string | null)[] {
  return screen.queryAllByRole('article').map(card => card.getAttribute('data-canvas-id'))
}

function chooseSort(value: 'title' | 'created' | 'updated'): void {
  fireEvent.change(screen.getByRole('combobox', { name: 'Recently updated' }), { target: { value } })
}

afterEach(async () => {
  cleanup()
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databaseNames].map(name => deleteDB(name)))
  databaseNames.clear()
})

describe('canvas workbench catalog sorting', () => {
  it('orders the rendered cards by name and reorders live local draft changes', async () => {
    const fixture = await catalogFixture()
    render(<CanvasSurface {...fixture.props} />)
    await waitFor(() => expect(displayedIds()).toEqual([fixture.oldest, fixture.newest, fixture.middle]))

    chooseSort('title')
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.newest, fixture.oldest]))
    fixture.at('2026-11-05T10:00:00.000Z')
    await act(async () => { await fixture.controller.rename(fixture.newest, 'Aardvark motion') })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.newest, fixture.middle, fixture.oldest]))
    fixture.at('2026-11-06T10:00:00.000Z')
    let added = ''
    await act(async () => { added = await fixture.controller.create('Bravo motion') })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.newest, fixture.middle, added, fixture.oldest]))
    expect(screen.getByRole('combobox', { name: 'Recently updated' })).toHaveProperty('value', 'title')
  })

  it('orders the rendered cards by creation time without treating an edited offline draft as newly created', async () => {
    const fixture = await catalogFixture()
    render(<CanvasSurface {...fixture.props} />)
    await waitFor(() => expect(displayedIds()).toHaveLength(3))
    chooseSort('created')
    await waitFor(() => expect(displayedIds()).toEqual([fixture.newest, fixture.middle, fixture.oldest]))

    fixture.at('2026-11-05T10:00:00.000Z')
    await act(async () => { await fixture.controller.rename(fixture.middle, 'Alpha edited motion') })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.newest, fixture.middle, fixture.oldest]))
    fixture.at('2026-11-06T10:00:00.000Z')
    let added = ''
    await act(async () => { added = await fixture.controller.create('Bravo motion') })
    await waitFor(() => expect(displayedIds()).toEqual([added, fixture.newest, fixture.middle, fixture.oldest]))
  })

  it('returns to recently updated order and follows edits and newly saved drafts', async () => {
    const fixture = await catalogFixture()
    render(<CanvasSurface {...fixture.props} />)
    chooseSort('title')
    chooseSort('updated')
    await waitFor(() => expect(displayedIds()).toEqual([fixture.oldest, fixture.newest, fixture.middle]))

    fixture.at('2026-11-05T10:00:00.000Z')
    await act(async () => { await fixture.controller.rename(fixture.middle, 'Alpha edited motion') })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.oldest, fixture.newest]))
    fixture.at('2026-11-06T10:00:00.000Z')
    let added = ''
    await act(async () => { added = await fixture.controller.create('Bravo motion') })
    await waitFor(() => expect(displayedIds()).toEqual([added, fixture.middle, fixture.oldest, fixture.newest]))
  })

  it('keeps case-insensitive search filtering reactive while the name order is selected', async () => {
    const fixture = await catalogFixture()
    render(<CanvasSurface {...fixture.props} />)
    chooseSort('title')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workbenches' }), { target: { value: 'MOTION' } })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.newest, fixture.oldest]))

    fixture.at('2026-11-05T10:00:00.000Z')
    await act(async () => {
      await fixture.controller.rename(fixture.newest, 'Unrelated field investigation')
      await fixture.controller.create('Unrelated optics investigation')
    })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.oldest]))
    fixture.at('2026-11-06T10:00:00.000Z')
    let added = ''
    await act(async () => { added = await fixture.controller.create('Bravo motion') })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, added, fixture.oldest]))
    expect(screen.getByRole('textbox', { name: 'Search workbenches' })).toHaveProperty('value', 'MOTION')
  })

  it('keeps live and deleted cards separated in the selected order as local documents are restored', async () => {
    const fixture = await catalogFixture()
    render(<CanvasSurface {...fixture.props} />)
    chooseSort('title')
    await act(async () => {
      await fixture.controller.remove(fixture.oldest)
      await fixture.controller.remove(fixture.middle)
    })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.newest]))
    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.oldest]))

    await act(async () => { await fixture.controller.restore(fixture.middle) })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.oldest]))
    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle, fixture.newest]))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workbenches' }), { target: { value: 'ALPHA' } })
    await waitFor(() => expect(displayedIds()).toEqual([fixture.middle]))
  })
})
