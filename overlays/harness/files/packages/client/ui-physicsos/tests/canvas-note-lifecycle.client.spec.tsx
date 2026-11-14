// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { CanvasNoteNode } from '../src/client/canvas/CanvasNodes.tsx'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { canvasCallbacks } from '../src/client/canvas/callbacks.ts'
import { createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'
import type { CanvasDocumentState, CanvasNoteDraftState } from '../src/client/canvas/types.ts'

vi.mock('@xyflow/react', () => ({ NodeResizer: () => null, Handle: () => null, Position: { Left: 'left', Right: 'right' } }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function held() {
  let resolve!: () => void
  const promise = new Promise<void>(complete => { resolve = complete })
  return { promise, resolve }
}
function body(document: CanvasDocumentState, id: string): string | undefined {
  const note = document.manifest?.nodes.find(node => node.id === id)
  return note?.kind === 'note' ? note.body : undefined
}
async function fixture() {
  const name = `canvas-note-lifecycle-${randomUUID()}`
  const hash = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
  const persistence = createCanvasPersistence({ name, hash })
  let sequence = 0
  const controller = createCanvasController({ api: createCanvasApi(async () => { throw new Error('The offline note test must not use HTTP.') }),
    persistence, hash, getAccount: () => undefined, online: () => false,
    createRuntime: async () => { throw new Error('A note-only canvas must not create a physics runtime.') },
    id: prefix => `${prefix}-${name}-${++sequence}`, window: null, document: null, channel: null,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    /* The controller hands cancellation handles back as unknown; this harness only schedules numbers. */
    cancel: handle => { if (typeof handle === 'number') window.clearTimeout(handle) },
  })
  onTestFinished(async () => { await controller.dispose(); await deleteDB(name) })
  const canvasId = await controller.create('Owned notebook')
  const nodeId = await controller.addNote(canvasId, { title: 'Notebook', format: 'plain', body: 'Initially saved note.' })
  const source = controller.documentSource(canvasId)
  const ui = createCanvasNodeTestProps('note', { document: source.getSnapshot(), nodeId,
    commands: canvasCallbacks(controller),
    overrides: {
      useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === canvasId ? source : undefined),
      useCanvasNoteDraft: keyedSelectorHook<CanvasNoteDraftState | undefined>(key => key === '' ? undefined : controller.noteDraftSource(key)),
    },
  })
  return { controller, persistence, canvasId, nodeId, source, props: ui.props }
}
const editor = () => screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
const edit = () => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })) }

describe('owned note durability and pane lifecycle', () => {
  it('retries a real failed write candidate before saving the newer note text', async () => {
    const f = await fixture()
    const fail = held()
    const failedWrite = vi.spyOn(f.persistence, 'save').mockImplementationOnce(async () => {
      await fail.promise; throw new Error('Local note storage failed.')
    })
    render(<CanvasNoteNode {...f.props} />)
    edit()
    fireEvent.change(editor(), { target: { value: 'The first pending note.' } })
    await waitFor(() => expect(body(f.source.getSnapshot(), f.nodeId)).toBe('The first pending note.'), { timeout: 3_000 })
    expect(f.source.getSnapshot().localSaved).toBe(false)
    const latest = 'A newer conclusion written while storage was pending.'
    fireEvent.change(editor(), { target: { value: latest } })
    await act(async () => { fail.resolve(); await fail.promise })
    await waitFor(() => expect(f.source.getSnapshot().status).toBe('error'))
    expect(editor().value).toBe(latest)
    expect(screen.queryByText('The note changed elsewhere; the current draft is retained')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    failedWrite.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(body(f.source.getSnapshot(), f.nodeId)).toBe(latest)
      expect(f.source.getSnapshot().localSaved).toBe(true)
    }, { timeout: 5_000 })
    expect(screen.queryByRole('textbox', { name: 'Note' })).toBeNull()
    const stored = await f.persistence.read(f.source.getSnapshot().namespace!, f.canvasId)
    expect(stored?.working.nodes.find(node => node.id === f.nodeId)).toMatchObject({ body: latest })
  })

  it('persists note text when the pane leaves before the autosave delay expires', async () => {
    const f = await fixture()
    const pane = render(<CanvasNoteNode {...f.props} />)
    edit()
    const latest = 'Keep this note when switching workbenches immediately.'
    fireEvent.change(editor(), { target: { value: latest } })
    pane.unmount()
    await waitFor(() => {
      expect(body(f.source.getSnapshot(), f.nodeId)).toBe(latest)
      expect(f.source.getSnapshot().localSaved).toBe(true)
    }, { timeout: 3_000 })
    render(<CanvasNoteNode {...f.props} />)
    expect(screen.getByText(latest, { exact: true })).toBeTruthy()
  })

  it('persists the latest text after an older in-flight autosave finishes with the pane already gone', async () => {
    const f = await fixture()
    const finish = held()
    const save = f.persistence.save
    vi.spyOn(f.persistence, 'save').mockImplementationOnce(async (...args) => { await finish.promise; return save(...args) })
    const pane = render(<CanvasNoteNode {...f.props} />)
    edit()
    fireEvent.change(editor(), { target: { value: 'The first pending note.' } })
    await waitFor(() => expect(body(f.source.getSnapshot(), f.nodeId)).toBe('The first pending note.'), { timeout: 3_000 })
    const latest = 'The latest conclusion belongs to the workbench, not its mounted editor.'
    fireEvent.change(editor(), { target: { value: latest } })
    pane.unmount()
    await act(async () => { finish.resolve(); await finish.promise })
    await waitFor(() => {
      expect(body(f.source.getSnapshot(), f.nodeId)).toBe(latest)
      expect(f.source.getSnapshot().localSaved).toBe(true)
    }, { timeout: 5_000 })
    const stored = await f.persistence.read(f.source.getSnapshot().namespace!, f.canvasId)
    expect(stored?.working.nodes.find(node => node.id === f.nodeId)).toMatchObject({ body: latest })
  })
})
