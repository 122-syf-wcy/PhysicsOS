// @vitest-environment jsdom
import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from '@testing-library/react'
import type { NodeResizerProps } from '@xyflow/react'
import type { CanvasManifest, CanvasNode } from '@physicsos/physics-workbench/types'

import {
  CanvasComparisonNode, CanvasExperimentNode, CanvasGroupNode, CanvasNoteNode, CanvasResultNode,
} from '../src/client/canvas/CanvasNodes.tsx'
import type { CanvasFlowKind, CanvasNodeProps } from '../src/client/canvas/contract.ts'
import type { CanvasDocumentState } from '../src/client/canvas/types.ts'
import { en } from '../src/client/locales.ts'
import { canvasTestDocument, createCanvasNodeTestProps } from './canvas-ui-fixtures.client.ts'
import { createOwnedNoteUI } from './canvas-note-ui-fixtures.client.ts'

type ResizeEvent = Parameters<NonNullable<NodeResizerProps['onResizeEnd']>>[0]
type ResizeSize = Parameters<NonNullable<NodeResizerProps['onResizeEnd']>>[1]

function unusedResizeSeat(): never {
  throw new Error('Canvas node callbacks must not read unused D3 behavior seats.')
}
function resizeEvent(event: MouseEvent, phase: 'start' | 'drag' | 'end'): ResizeEvent {
  return {
    type: phase, subject: { x: event.clientX, y: event.clientY },
    x: event.clientX, y: event.clientY, dx: 0, dy: 0,
    identifier: 'mouse', active: phase === 'drag' ? 1 : 0, sourceEvent: event,
    get target(): never { return unusedResizeSeat() },
    on: unusedResizeSeat,
  } satisfies ResizeEvent
}

/** Only the ReactFlow context boundary is replaced; the real node owns every resize callback. */
function CanvasNodeResizerTestDouble(props: NodeResizerProps) {
  const active = useRef(false)
  const size = (event: ReactMouseEvent<HTMLButtonElement>): ResizeSize => ({
    x: event.clientX, y: event.clientY,
    width: (props.minWidth ?? 10) + Math.abs(event.clientX),
    height: (props.minHeight ?? 10) + Math.abs(event.clientY),
  })
  if (props.isVisible === false) return null
  return <button type="button" aria-label="Resize node" data-resizer-node-id={props.nodeId}
    onMouseDown={event => {
      active.current = true
      props.onResizeStart?.(resizeEvent(event.nativeEvent, 'start'), size(event))
    }}
    onMouseMove={event => {
      if (active.current) props.onResize?.(resizeEvent(event.nativeEvent, 'drag'), { ...size(event), direction: [-1, -1] })
    }}
    onMouseUp={event => {
      if (!active.current) return
      active.current = false
      props.onResizeEnd?.(resizeEvent(event.nativeEvent, 'end'), size(event))
    }}>Resize node</button>
}

vi.mock('@xyflow/react', () => ({
  NodeResizer: CanvasNodeResizerTestDouble,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function manifestOf(document: CanvasDocumentState): CanvasManifest {
  if (document.manifest === undefined) throw new Error('This node test requires a loaded canvas manifest.')
  return document.manifest
}
function mapNodes(document: CanvasDocumentState, update: (node: CanvasNode) => CanvasNode): CanvasDocumentState {
  const manifest = manifestOf(document)
  return { ...document, editSequence: document.editSequence + 1,
    manifest: { ...manifest, nodes: manifest.nodes.map(update) } }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred promise was not initialized.') }
  let reject: (reason: unknown) => void = () => { throw new Error('Deferred promise was not initialized.') }
  const promise = new Promise<T>((complete, fail) => {
    resolve = value => { complete(value) }
    reject = fail
  })
  return { promise, resolve, reject }
}
function button(name: string): HTMLButtonElement {
  const element = screen.getByRole('button', { name })
  if (!(element instanceof HTMLButtonElement)) throw new Error('Expected a native button.')
  return element
}
function editor(): HTMLTextAreaElement {
  const element = screen.getByRole('textbox', { name: en['canvas.note'] })
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('Expected the real note textarea.')
  return element
}
function chooseMenuItem(name: string): void {
  fireEvent.click(button(en['canvas.more']))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

const renderers = [
  { kind: 'experiment', title: 'Uniform motion', render: (document: CanvasDocumentState, nodeId: string) =>
    render(<CanvasExperimentNode {...createCanvasNodeTestProps('experiment', { document, nodeId }).props} />) },
  { kind: 'result', title: 'Uniform-motion capture', render: (document: CanvasDocumentState, nodeId: string) =>
    render(<CanvasResultNode {...createCanvasNodeTestProps('result', { document, nodeId }).props} />) },
  { kind: 'note', title: 'Motion hypothesis', render: (document: CanvasDocumentState, nodeId: string) =>
    render(<CanvasNoteNode {...createCanvasNodeTestProps('note', { document, nodeId }).props} />) },
  { kind: 'comparison', title: 'Uniform-motion sample comparison', render: (document: CanvasDocumentState, nodeId: string) =>
    render(<CanvasComparisonNode {...createCanvasNodeTestProps('comparison', { document, nodeId }).props} />) },
  { kind: 'group', title: 'Motion investigation', render: (document: CanvasDocumentState, nodeId: string) =>
    render(<CanvasGroupNode {...createCanvasNodeTestProps('group', { document, nodeId }).props} />) },
] satisfies readonly {
  readonly kind: CanvasFlowKind
  readonly title: string
  readonly render: (document: CanvasDocumentState, nodeId: string) => RenderResult
}[]

describe('canvas node identity and chrome', () => {
  it.each(renderers)('renders a real $kind document node without ReactFlow context', entry => {
    const document = canvasTestDocument()
    const node = manifestOf(document).nodes.find(node => node.kind === entry.kind)
    if (node === undefined) throw new Error('Missing baseline node.')
    const view = entry.render(document, node.id)
    const article = screen.getByRole('article')
    expect(article.getAttribute('data-canvas-node-id')).toBe(node.id)
    expect(article.getAttribute('data-canvas-node-kind')).toBe(node.kind)
    const header = article.querySelector('header')
    if (header === null) throw new Error('Missing canvas node header.')
    expect(within(header).getByText(entry.title, { exact: true })).toBeTruthy()
    expect(view.container.contains(article)).toBe(true)
  })

  it.each(renderers)('renders nothing for a missing $kind node', entry => {
    const view = entry.render(canvasTestDocument(), 'missing-node')
    expect(view.container.childElementCount).toBe(0)
    expect(screen.queryByRole('article')).toBeNull()
  })

  it.each(renderers)('does not relabel another kind as $kind', entry => {
    const document = canvasTestDocument()
    const other = manifestOf(document).nodes.find(node => node.kind !== entry.kind)
    if (other === undefined) throw new Error('Missing alternate baseline node.')
    const view = entry.render(document, other.id)
    expect(view.container.childElementCount).toBe(0)
    expect(screen.queryByRole('article')).toBeNull()
  })

  it.each(renderers)('does not invent a $kind while its manifest is unavailable', entry => {
    const original = canvasTestDocument()
    const { manifest: _manifest, ...document } = original
    const view = entry.render({ ...document, objects: {}, loading: true, status: 'loading' }, 'unloaded-node')
    expect(view.container.childElementCount).toBe(0)
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('delegates the experiment with exact owner IDs and focuses through the real view action', () => {
    const renderFactorySlot = vi.fn<CanvasNodeProps<'experiment'>['renderFactorySlot']>(() => null)
    const b = createCanvasNodeTestProps('experiment', { overrides: { renderFactorySlot } })
    const node = manifestOf(b.document.getSnapshot()).nodes.find(node => node.kind === 'experiment')
    if (node?.kind !== 'experiment') throw new Error('Missing experiment node.')
    render(<CanvasExperimentNode {...b.props} />)
    expect(renderFactorySlot).toHaveBeenCalledWith('physicsos.canvas.instance', {
      canvasId: b.props.data.canvasId, instanceId: node.instanceId,
      instanceKey: b.props.canvasInstanceKey(b.props.data.canvasId, node.instanceId), presentation: 'card',
    })
    expect(b.view.getSnapshot().focusedInstanceKey).toBeUndefined()
    fireEvent.click(button(en['canvas.focus']))
    expect(b.view.getSnapshot().focusedInstanceKey).toBe(b.props.canvasInstanceKey(b.props.data.canvasId, node.instanceId))
  })

  it('dismisses the real menu on Escape and outside pointer input without issuing commands', () => {
    const b = createCanvasNodeTestProps('note')
    render(<CanvasNoteNode {...b.props} />)
    fireEvent.click(button(en['canvas.more']))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button(en['canvas.more']))
    fireEvent.click(button(en['canvas.more']))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.commands.renameNode).not.toHaveBeenCalled()
    expect(b.commands.copyNodes).not.toHaveBeenCalled()
    expect(b.commands.setLocked).not.toHaveBeenCalled()
    expect(b.commands.removeNodes).not.toHaveBeenCalled()
  })

  it('locks and unlocks the exact node while retaining interactive experiment content', async () => {
    const activate = vi.fn<() => void>()
    const renderFactorySlot = vi.fn<CanvasNodeProps<'experiment'>['renderFactorySlot']>(() =>
      <button type="button" onClick={activate}>{en['lab.run']}</button>)
    const b = createCanvasNodeTestProps('experiment', { overrides: { renderFactorySlot } })
    b.commands.setLocked.mockImplementation(async (_canvasId, ids, locked) => {
      b.document.set(mapNodes(b.document.getSnapshot(), node => ids.includes(node.id) ? { ...node, locked } : node))
    })
    render(<CanvasExperimentNode {...b.props} />)
    expect(button('Resize node')).toBeTruthy()
    chooseMenuItem(en['canvas.node.lock'])
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Resize node' })).toBeNull() })
    expect(b.commands.setLocked).toHaveBeenCalledWith(b.props.data.canvasId, [b.props.data.nodeId], true)
    expect(screen.getByLabelText(en['canvas.node.lock'])).toBeTruthy()
    expect(screen.getByRole('article').getAttribute('data-canvas-node-locked')).toBe('true')
    expect(button(en['lab.run']).disabled).toBe(false)
    fireEvent.click(button(en['lab.run']))
    expect(activate).toHaveBeenCalledTimes(1)
    fireEvent.click(button(en['canvas.more']))
    const front = screen.getByRole('menuitem', { name: en['canvas.node.front'] })
    expect(front instanceof HTMLButtonElement && front.disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: en['canvas.node.unlock'] }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Resize node' })).toBeTruthy() })
    expect(b.commands.setLocked).toHaveBeenLastCalledWith(b.props.data.canvasId, [b.props.data.nodeId], false)
    expect(screen.queryByLabelText(en['canvas.node.lock'])).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not offer deletion or a successful removal toast for a locked card', () => {
    const document = mapNodes(canvasTestDocument(), node => node.kind === 'experiment' ? { ...node, locked: true } : node)
    const fixture = createCanvasNodeTestProps('experiment', { document })
    fixture.commands.removeNodes.mockResolvedValue(undefined)
    render(<CanvasExperimentNode {...fixture.props} />)
    fireEvent.click(button(en['canvas.more']))
    const remove = screen.getByRole('menuitem', { name: en['canvas.node.delete'] }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    fireEvent.click(remove)
    expect(fixture.commands.removeNodes).not.toHaveBeenCalled()
    expect(fixture.view.getSnapshot().toast).toBeUndefined()
    expect(screen.getByRole('article').getAttribute('data-canvas-node-id')).toBe(fixture.props.data.nodeId)
  })

  it('copies before pasting and selects the actual pasted node IDs', async () => {
    const b = createCanvasNodeTestProps('note')
    const copied = manifestOf(b.document.getSnapshot()).nodes.find(node => node.id === b.props.data.nodeId)
    if (copied?.kind !== 'note') throw new Error('Missing source note.')
    const pasted = { ...copied, id: `${copied.id}-copy`, title: `${copied.title ?? en['canvas.note']} copy` } satisfies CanvasNode
    const copiedRequest = deferred<void>()
    b.commands.copyNodes.mockReturnValue(copiedRequest.promise)
    b.commands.pasteNodes.mockImplementation(async () => {
      const current = b.document.getSnapshot()
      const manifest = manifestOf(current)
      b.document.set({ ...current, manifest: { ...manifest, nodes: [...manifest.nodes, pasted] } })
      return [pasted.id]
    })
    render(<CanvasNoteNode {...b.props} />)
    chooseMenuItem(en['canvas.node.copy'])
    expect(b.commands.copyNodes).toHaveBeenCalledWith(b.props.data.canvasId, [copied.id])
    expect(b.commands.pasteNodes).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
    await act(async () => { copiedRequest.resolve(undefined); await copiedRequest.promise })
    await waitFor(() => { expect(b.view.getSnapshot().selected).toEqual([pasted.id]) })
    expect(b.commands.pasteNodes).toHaveBeenCalledWith(b.props.data.canvasId)
    expect(manifestOf(b.document.getSnapshot()).nodes.some(node => node.id === pasted.id)).toBe(true)
  })

  it('does not paste after a copy failure and reports the retained-content error through real actions', async () => {
    const b = createCanvasNodeTestProps('note')
    b.commands.copyNodes.mockRejectedValue(new Error('Clipboard is unavailable.'))
    render(<CanvasNoteNode {...b.props} />)
    chooseMenuItem(en['canvas.node.copy'])
    await waitFor(() => { expect(b.view.getSnapshot().toast?.error).toBe(true) })
    expect(b.view.getSnapshot().toast).toMatchObject({
      key: 'canvas.error.generic', message: 'Clipboard is unavailable.', error: true,
    })
    expect(b.commands.pasteNodes).not.toHaveBeenCalled()
    expect(screen.getByText('Motion hypothesis', { exact: true })).toBeTruthy()
  })

  it('renames the current card through the real modal and exact trimmed command arguments', async () => {
    const b = createCanvasNodeTestProps('note')
    b.commands.renameNode.mockImplementation(async (_canvasId, id, title) => {
      b.document.set(mapNodes(b.document.getSnapshot(), node => node.id === id ? { ...node, title } : node))
    })
    render(<CanvasNoteNode {...b.props} />)
    chooseMenuItem(en['canvas.node.rename'])
    const dialog = screen.getByRole('dialog', { name: en['canvas.node.rename'] })
    const name = within(dialog).getByRole('textbox', { name: en['canvas.name'] })
    expect(name instanceof HTMLInputElement && name.value).toBe('Motion hypothesis')
    fireEvent.change(name, { target: { value: '   ' } })
    expect(button(en['canvas.confirm']).disabled).toBe(true)
    fireEvent.change(name, { target: { value: '  Shared motion hypothesis  ' } })
    fireEvent.click(button(en['canvas.confirm']))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(b.commands.renameNode).toHaveBeenCalledWith(b.props.data.canvasId, b.props.data.nodeId, 'Shared motion hypothesis')
    expect(screen.getByText('Shared motion hypothesis', { exact: true })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    { status: 'deleted', loading: false },
    { status: 'loading', loading: true },
  ] satisfies readonly Pick<CanvasDocumentState, 'status' | 'loading'>[])('blocks an open rename dialog when the document becomes $status', state => {
    const b = createCanvasNodeTestProps('note')
    render(<CanvasNoteNode {...b.props} />)
    chooseMenuItem(en['canvas.node.rename'])
    const dialog = screen.getByRole('dialog', { name: en['canvas.node.rename'] })
    const name = within(dialog).getByRole('textbox', { name: en['canvas.name'] })
    if (!(name instanceof HTMLInputElement)) throw new Error('Expected the real rename input.')
    const draft = 'Retain the proposed card title.'
    fireEvent.change(name, { target: { value: draft } })
    expect(button(en['canvas.confirm']).disabled).toBe(false)
    act(() => { b.document.set({ ...b.document.getSnapshot(), ...state }) })
    expect(name.value).toBe(draft)
    expect(name.disabled).toBe(true)
    expect(button(en['canvas.confirm']).disabled).toBe(true)
    expect(button(en['canvas.cancel']).disabled).toBe(false)
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.click(button(en['canvas.confirm']))
    expect(b.commands.renameNode).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: en['canvas.node.rename'] })).toBeTruthy()
    fireEvent.click(button(en['canvas.cancel']))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Motion hypothesis', { exact: true })).toBeTruthy()
    expect(b.commands.renameNode).not.toHaveBeenCalled()
  })

  it('routes group collapse, expansion, ungroup, and removal to the current group ID', async () => {
    const original = canvasTestDocument()
    const group = manifestOf(original).nodes.find(node => node.kind === 'group')
    if (group?.kind !== 'group') throw new Error('Missing group.')
    const document = mapNodes(original, node => node.kind === 'note' || node.kind === 'experiment' ? { ...node, groupId: group.id } : node)
    const b = createCanvasNodeTestProps('group', { document })
    b.commands.setGroupCollapsed.mockImplementation(async (_canvasId, id, collapsed) => {
      b.document.set(mapNodes(b.document.getSnapshot(), node => node.id === id && node.kind === 'group' ? { ...node, collapsed } : node))
    })
    b.commands.ungroup.mockResolvedValue(undefined)
    b.commands.removeNodes.mockResolvedValue(undefined)
    render(<CanvasGroupNode {...b.props} />)
    expect(screen.getByText('Motion investigation', { exact: true })).toBeTruthy()
    fireEvent.click(button(en['canvas.node.collapse']))
    await waitFor(() => { expect(screen.getByRole('button', { name: en['canvas.node.expand'] })).toBeTruthy() })
    expect(b.commands.setGroupCollapsed).toHaveBeenCalledWith(b.props.data.canvasId, group.id, true)
    expect(screen.getByText(`${en['canvas.node.groupName']} · 2`, { exact: true })).toBeTruthy()
    act(() => {
      b.document.set(mapNodes(b.document.getSnapshot(), node => node.id === group.id ? { ...node, title: 'Shared motion investigation' } : node))
    })
    expect(screen.getByText('Shared motion investigation', { exact: true })).toBeTruthy()
    fireEvent.click(button(en['canvas.node.expand']))
    await waitFor(() => { expect(screen.getByRole('button', { name: en['canvas.node.collapse'] })).toBeTruthy() })
    expect(b.commands.setGroupCollapsed).toHaveBeenLastCalledWith(b.props.data.canvasId, group.id, false)
    expect(screen.queryByText(`${en['canvas.node.groupName']} · 2`, { exact: true })).toBeNull()
    chooseMenuItem(en['canvas.node.ungroup'])
    await waitFor(() => { expect(b.commands.ungroup).toHaveBeenCalledWith(b.props.data.canvasId, [group.id]) })
    expect(screen.queryByRole('menu')).toBeNull()
    chooseMenuItem(en['canvas.node.delete'])
    await waitFor(() => { expect(b.commands.removeNodes).toHaveBeenCalledWith(b.props.data.canvasId, [group.id]) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each(['front', 'back'] satisfies readonly ('front' | 'back')[])('sends %s layering without changing physics data', async operation => {
    const b = createCanvasNodeTestProps('note')
    b.commands.layer.mockResolvedValue(undefined)
    render(<CanvasNoteNode {...b.props} />)
    chooseMenuItem(en[operation === 'front' ? 'canvas.node.front' : 'canvas.node.back'])
    await waitFor(() => { expect(b.commands.layer).toHaveBeenCalledWith(b.props.data.canvasId, [b.props.data.nodeId], operation) })
    expect(b.commands.updateNote).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('canvas note content and drafts', () => {
  const begin = () => { fireEvent.click(button(en['canvas.noteEdit'])) }
  const waitSaved = async (note: Awaited<ReturnType<typeof createOwnedNoteUI>>, body: string, format: 'plain' | 'markdown' = 'plain') => {
    await waitFor(() => {
      expect(note.note()).toMatchObject({ body, format, dirty: false, saving: false })
      expect(note.source.getSnapshot().localSaved).toBe(true)
    })
    expect(await note.savedBody()).toEqual({ body, format })
  }

  it('renders typed Markdown while rejecting scripts, HTML handlers, and javascript links', async () => {
    const body = '# Motion hypothesis\n\n**Equal displacements** for equal times.\n\n[Project](https://physics.dongsiwei.com)\n\n[Unsafe reference](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)" />'
    const note = await createOwnedNoteUI({ body, format: 'markdown' })
    const view = render(<CanvasNoteNode {...note.props} />)
    expect(screen.getByRole('heading', { name: 'Motion hypothesis', level: 1 })).toBeTruthy()
    expect(screen.getByText('Equal displacements', { exact: true }).tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'Project' }).getAttribute('href')).toBe('https://physics.dongsiwei.com')
    expect(screen.queryByRole('link', { name: 'Unsafe reference' })).toBeNull()
    expect(view.container.querySelector('script, [onerror], [onclick]')).toBeNull()
    expect([...view.container.querySelectorAll('a')].some(link => /^javascript:/i.test(link.getAttribute('href') ?? ''))).toBe(false)
    expect(await note.savedBody()).toEqual({ body, format: 'markdown' })
  })

  it('keeps plain note markup literal rather than inventing Markdown content', async () => {
    const body = '# Hypothesis\n\n**Keep this literal.**'
    const note = await createOwnedNoteUI({ body })
    const view = render(<CanvasNoteNode {...note.props} />)
    expect(view.container.textContent).toContain(body)
    expect(screen.queryByRole('heading', { name: 'Hypothesis' })).toBeNull()
    expect(view.container.querySelector('strong')).toBeNull()
  })

  it('autosaves the latest note after typing pauses without closing its editor', async () => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    const baseline = await note.storedRecord()
    if (baseline === undefined) throw new Error('The note test has no durable baseline.')
    render(<CanvasNoteNode {...note.props} />)
    begin()
    fireEvent.change(editor(), { target: { value: 'An unfinished sentence' } })
    await act(async () => { await note.advance(200) })
    await waitFor(async () => {
      const checkpoint = await note.storedRecord()
      expect(checkpoint?.pendingNoteDrafts?.find(draft => draft.nodeId === note.nodeId)).toMatchObject({
        body: 'An unfinished sentence', format: 'plain', baseBody: 'Saved hypothesis.', baseFormat: 'plain',
      })
      expect(checkpoint?.editSequence).toBe(baseline.editSequence)
      expect(checkpoint?.acknowledgedSequence).toBe(baseline.acknowledgedSequence)
      expect(checkpoint?.documentHistory).toEqual(baseline.documentHistory)
      expect(checkpoint?.working.history).toEqual(baseline.working.history)
      expect(checkpoint?.pending).toEqual(baseline.pending)
    })
    expect(note.note()).toMatchObject({ body: 'An unfinished sentence', format: 'plain', dirty: true })
    const latest = '# The complete hypothesis\n\nKeep every measured sample.'
    fireEvent.change(editor(), { target: { value: latest } })
    fireEvent.click(screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }))
    await act(async () => { await note.advance(1_200) })
    await waitSaved(note, latest, 'markdown')
    const committed = await note.storedRecord()
    expect(committed?.pendingNoteDrafts ?? []).toHaveLength(0)
    expect(committed?.editSequence).toBe(baseline.editSequence + 1)
    expect(committed?.documentHistory?.past.length ?? 0).toBe((baseline.documentHistory?.past.length ?? 0) + 1)
    expect(editor().value).toBe(latest)
    expect(editor().disabled).toBe(false)
  })

  it('allows immediate Save to persist the exact edited string and chosen Markdown format', async () => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    render(<CanvasNoteNode {...note.props} />)
    begin()
    const draft = '  # Revised hypothesis\n\n**Equal time intervals** should yield equal displacements.\n'
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }))
    expect(await note.savedBody()).toEqual({ body: 'Saved hypothesis.', format: 'plain' })
    fireEvent.click(button(en['canvas.save']))
    await waitSaved(note, draft, 'markdown')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Revised hypothesis', level: 1 })).toBeTruthy()
    expect(note.view.getSnapshot().toast?.key).toBe('canvas.sync.local-saved')
  })

  it('cancels unsubmitted body and format edits without changing the durable note', async () => {
    const original = 'Compare horizontal displacement at equal time intervals.'
    const note = await createOwnedNoteUI({ body: original })
    render(<CanvasNoteNode {...note.props} />)
    begin()
    fireEvent.change(editor(), { target: { value: 'An unsaved alternative hypothesis.' } })
    fireEvent.click(screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }))
    fireEvent.click(button(en['canvas.cancel']))
    expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull()
    expect(screen.getByText(original, { exact: true })).toBeTruthy()
    await act(async () => { await note.advance(2_000) })
    expect(await note.savedBody()).toEqual({ body: original, format: 'plain' })
    begin()
    expect(editor().value).toBe(original)
    expect((screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }) as HTMLInputElement).checked).toBe(false)
    expect(button(en['canvas.save']).disabled).toBe(true)
  })

  it.each([
    { status: 'deleted', loading: false }, { status: 'loading', loading: true },
  ] satisfies readonly Pick<CanvasDocumentState, 'status' | 'loading'>[])('retains the owned draft but disables input and Save when the view becomes $status', async state => {
    const original = 'Keep the recorded horizontal displacement measurements.'
    const note = await createOwnedNoteUI({ body: original })
    render(<CanvasNoteNode {...note.props} />)
    begin()
    const draft = '# Retained hypothesis\n\nEqual time intervals should yield equal displacements.'
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }))
    act(() => { note.readonly(state) })
    expect(editor().value).toBe(draft)
    expect(editor().disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: en['canvas.noteMarkdown'] }) as HTMLInputElement).disabled).toBe(true)
    expect(button(en['canvas.save']).disabled).toBe(true)
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true })
    expect(await note.savedBody()).toEqual({ body: original, format: 'plain' })
    expect(note.note()).toMatchObject({ body: draft, format: 'markdown', dirty: true })
    fireEvent.click(button(en['canvas.cancel']))
    expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull()
    expect(screen.getByText(original, { exact: true })).toBeTruthy()
  })

  it('keeps the dirty draft across a real external note update and stops conflicting auto saves', async () => {
    const note = await createOwnedNoteUI({ body: 'The original hypothesis.' })
    await note.prepareExternal()
    render(<CanvasNoteNode {...note.props} />)
    begin()
    const draft = 'My unsaved hypothesis must remain available.'
    fireEvent.change(editor(), { target: { value: draft } })
    const remote = '# Shared hypothesis\n\nAnother editor recorded this.'
    await act(async () => { await note.external(remote, 'markdown', 'Shared hypothesis') })
    expect(editor().value).toBe(draft)
    expect(screen.getByText(en['canvas.noteSaveConflict'])).toBeTruthy()
    expect(button(en['canvas.save']).disabled).toBe(true)
    await act(async () => { await note.advance(2_000) })
    expect(await note.savedBody()).toEqual({ body: remote, format: 'markdown' })
    fireEvent.click(button(en['canvas.cancel']))
    expect(screen.getByRole('heading', { name: 'Shared hypothesis', level: 1 })).toBeTruthy()
    begin()
    expect(editor().value).toBe(remote)
  })

  it('reads real externally updated content while the note is not being edited', async () => {
    const note = await createOwnedNoteUI({ body: 'The original hypothesis.' })
    render(<CanvasNoteNode {...note.props} />)
    await act(async () => { await note.external('The revised shared hypothesis.') })
    expect(screen.getByText('The revised shared hypothesis.', { exact: true })).toBeTruthy()
    expect(screen.queryByText('The original hypothesis.', { exact: true })).toBeNull()
    begin()
    expect(editor().value).toBe('The revised shared hypothesis.')
  })

  it('retains later typing during a real in-flight autosave and saves the newer draft next', async () => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    const first = deferred<void>()
    note.delay('First retained draft.', first.promise)
    render(<CanvasNoteNode {...note.props} />)
    begin()
    fireEvent.change(editor(), { target: { value: 'First retained draft.' } })
    await act(async () => { await note.advance(1_200) })
    await waitFor(() => expect(note.note().saving).toBe(true))
    expect(editor().disabled).toBe(false)
    const latest = 'A later sentence written before the first save finished.'
    fireEvent.change(editor(), { target: { value: latest } })
    await act(async () => { first.resolve(); await first.promise })
    expect(editor().value).toBe(latest)
    await act(async () => { await note.advance(1_200) })
    await waitSaved(note, latest)
    expect(editor().value).toBe(latest)
  })

  it('retains a real failed autosave and retries its latest draft only on explicit Save', async () => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    const draft = 'Retain this complete hypothesis after a storage failure.'
    const fault = note.fault(draft, new Error('Local storage is unavailable.'))
    render(<CanvasNoteNode {...note.props} />)
    begin()
    fireEvent.change(editor(), { target: { value: draft } })
    await act(async () => { await note.advance(1_200) })
    await waitFor(() => expect(note.note().error?.message).toBe('Local storage is unavailable.'))
    expect(editor().value).toBe(draft)
    expect(editor().disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toBe('Local storage is unavailable.')
    const before = await note.savedBody()
    await act(async () => { await note.advance(10_000) })
    expect(await note.savedBody()).toEqual(before)
    expect(button(en['canvas.save']).disabled).toBe(false)
    fault.mockRestore()
    fireEvent.click(button(en['canvas.save']))
    await waitSaved(note, draft)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a draft and reports a non-Error I/O rejection without falsely acknowledging its save', async () => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    const draft = 'Retain this hypothesis.'
    note.fault(draft, { code: 'LOCAL_STORAGE_UNAVAILABLE' })
    render(<CanvasNoteNode {...note.props} />)
    begin()
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(button(en['canvas.save']))
    await waitFor(() => expect(note.note().error).toBeDefined())
    expect(screen.getByRole('alert').textContent).toMatch(/\S/)
    expect(editor().value).toBe(draft)
    expect(note.source.getSnapshot().localSaved).toBe(false)
    expect(button(en['canvas.save']).disabled).toBe(false)
  })

  it.each([
    { modifier: 'Ctrl', ctrlKey: true, metaKey: false }, { modifier: 'Meta', ctrlKey: false, metaKey: true },
  ])('saves on $modifier Enter while ordinary Enter and IME stay in the editor', async keys => {
    const note = await createOwnedNoteUI({ body: 'Saved hypothesis.' })
    render(<CanvasNoteNode {...note.props} />)
    begin()
    const draft = 'A keyboard-authored hypothesis.'
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.keyDown(editor(), { key: 'Enter' })
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: keys.ctrlKey, metaKey: keys.metaKey, isComposing: true })
    expect(await note.savedBody()).toEqual({ body: 'Saved hypothesis.', format: 'plain' })
    expect(editor().value).toBe(draft)
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: keys.ctrlKey, metaKey: keys.metaKey })
    await waitSaved(note, draft)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull())
  })
})

describe('canvas node resize gestures', () => {
  it('previews parent-relative sizes and persists one absolute-world layout only at resize end', async () => {
    const original = canvasTestDocument()
    const parent = manifestOf(original).nodes.find(node => node.kind === 'group')
    if (parent?.kind !== 'group') throw new Error('Missing parent group.')
    const document = mapNodes(original, node => node.kind === 'note'
      ? { ...node, groupId: parent.id, layout: { ...node.layout, x: 140, y: 95, zIndex: 7 } } : node)
    const b = createCanvasNodeTestProps('note', { document })
    const request = deferred<void>()
    b.commands.updateLayout.mockReturnValue(request.promise)
    render(<CanvasNoteNode {...b.props} />)
    const header = screen.getByText('Motion hypothesis', { exact: true }).closest('header')
    if (header === null || b.props.dragHandle === undefined) throw new Error('Missing drag header contract.')
    expect(header.matches(b.props.dragHandle)).toBe(true)
    expect(b.props.parentId).toBe(parent.id)
    const parentPreview = { ...parent.layout, x: 350, y: 220 }
    act(() => { b.view.actions.previewLayout(parent.id, parentPreview) })
    const handle = button('Resize node')
    expect(handle.getAttribute('data-resizer-node-id')).toBe(b.props.id)
    fireEvent.mouseDown(handle, { clientX: 40, clientY: 35 })
    fireEvent.mouseMove(handle, { clientX: 60, clientY: 55 })
    expect(b.commands.updateLayout).not.toHaveBeenCalled()
    expect(b.view.getSnapshot().transientLayouts[b.props.id]).toEqual({ x: 410, y: 275, width: 340, height: 215, zIndex: 7 })
    fireEvent.mouseMove(handle, { clientX: 70, clientY: 65 })
    expect(b.commands.updateLayout).not.toHaveBeenCalled()
    expect(b.view.getSnapshot().transientLayouts[b.props.id]).toEqual({ x: 420, y: 285, width: 350, height: 225, zIndex: 7 })
    fireEvent.mouseUp(handle, { clientX: 85, clientY: 75 })
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(1)
    expect(b.commands.updateLayout).toHaveBeenCalledWith(b.props.data.canvasId, [{
      id: b.props.id, layout: { x: 435, y: 295, width: 365, height: 235, zIndex: 7 },
    }])
    await act(async () => { request.resolve(undefined); await request.promise })
    await waitFor(() => { expect(b.view.getSnapshot().transientLayouts).toEqual({ [parent.id]: parentPreview }) })
    fireEvent.mouseMove(handle, { clientX: 100, clientY: 100 })
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(1)
  })

  it('uses ungrouped world coordinates once and clears a rejected gesture without changing the saved layout', async () => {
    const b = createCanvasNodeTestProps('note')
    const node = manifestOf(b.document.getSnapshot()).nodes.find(node => node.id === b.props.id)
    if (node === undefined) throw new Error('Missing saved note layout.')
    const saved = node.layout
    const request = deferred<void>()
    b.commands.updateLayout.mockReturnValue(request.promise)
    render(<CanvasNoteNode {...b.props} />)
    const handle = button('Resize node')
    fireEvent.mouseDown(handle, { clientX: 120, clientY: 400 })
    fireEvent.mouseMove(handle, { clientX: 145, clientY: 420 })
    expect(b.commands.updateLayout).not.toHaveBeenCalled()
    fireEvent.mouseUp(handle, { clientX: 160, clientY: 430 })
    expect(b.commands.updateLayout).toHaveBeenCalledWith(b.props.data.canvasId, [{
      id: b.props.id, layout: { x: 160, y: 430, width: 440, height: 590, zIndex: saved.zIndex },
    }])
    await act(async () => { request.reject(new Error('Layout could not be saved.')); await request.promise.catch(() => undefined) })
    await waitFor(() => { expect(b.view.getSnapshot().transientLayouts).toEqual({}) })
    expect(manifestOf(b.document.getSnapshot()).nodes.find(node => node.id === b.props.id)?.layout).toEqual(saved)
    expect(b.view.getSnapshot().toast).toMatchObject({ key: 'canvas.error.generic', message: 'Layout could not be saved.', error: true })
  })

  it('retains a newer resize and unrelated previews when an earlier layout save settles', async () => {
    const b = createCanvasNodeTestProps('note')
    const manifest = manifestOf(b.document.getSnapshot())
    const note = manifest.nodes.find(node => node.id === b.props.id)
    const unrelated = manifest.nodes.find(node => node.kind === 'experiment')
    if (note?.kind !== 'note' || unrelated?.kind !== 'experiment') throw new Error('Missing real resize and sibling nodes.')
    const first = deferred<void>()
    const second = deferred<void>()
    b.commands.updateLayout.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<CanvasNoteNode {...b.props} />)
    const handle = button('Resize node')
    fireEvent.mouseDown(handle, { clientX: 120, clientY: 400 })
    fireEvent.mouseMove(handle, { clientX: 145, clientY: 420 })
    fireEvent.mouseUp(handle, { clientX: 160, clientY: 430 })
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(1)
    expect(b.view.getSnapshot().transientLayouts[note.id]).toEqual({
      x: 160, y: 430, width: 440, height: 590, zIndex: note.layout.zIndex,
    })

    fireEvent.mouseDown(handle, { clientX: 160, clientY: 430 })
    fireEvent.mouseMove(handle, { clientX: 180, clientY: 450 })
    const newerPreview = { x: 180, y: 450, width: 460, height: 610, zIndex: note.layout.zIndex }
    const unrelatedPreview = { ...unrelated.layout, x: unrelated.layout.x + 25, y: unrelated.layout.y + 10 }
    const viewportPreview = { x: -34, y: 26, zoom: 0.85 }
    act(() => {
      b.view.actions.previewLayout(unrelated.id, unrelatedPreview)
      b.view.actions.previewViewport(viewportPreview)
    })
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(1)
    expect(b.view.getSnapshot().transientLayouts[note.id]).toEqual(newerPreview)
    await act(async () => { first.resolve(undefined); await first.promise })
    expect(b.view.getSnapshot().transientLayouts).toEqual({
      [note.id]: newerPreview, [unrelated.id]: unrelatedPreview,
    })
    expect(b.view.getSnapshot().transientViewport).toEqual(viewportPreview)
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(1)

    fireEvent.mouseMove(handle, { clientX: 185, clientY: 455 })
    fireEvent.mouseUp(handle, { clientX: 190, clientY: 460 })
    const finalLayout = { x: 190, y: 460, width: 470, height: 620, zIndex: note.layout.zIndex }
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(2)
    expect(b.commands.updateLayout).toHaveBeenLastCalledWith(b.props.data.canvasId, [{ id: note.id, layout: finalLayout }])
    expect(b.view.getSnapshot().transientLayouts[note.id]).toEqual(finalLayout)
    await act(async () => { second.resolve(undefined); await second.promise })
    await waitFor(() => { expect(b.view.getSnapshot().transientLayouts[note.id]).toBeUndefined() })
    expect(b.view.getSnapshot().transientLayouts).toEqual({ [unrelated.id]: unrelatedPreview })
    expect(b.view.getSnapshot().transientViewport).toEqual(viewportPreview)
    expect(b.commands.updateLayout).toHaveBeenCalledTimes(2)
  })

  it('does not expose resize controls on an unselected node', () => {
    const b = createCanvasNodeTestProps('note', { selected: false })
    render(<CanvasNoteNode {...b.props} />)
    expect(screen.queryByRole('button', { name: 'Resize node' })).toBeNull()
    expect(button(en['canvas.noteEdit']).disabled).toBe(false)
  })

  it.each([
    { status: 'deleted', loading: false },
    { status: 'loading', loading: true },
  ] satisfies readonly Pick<CanvasDocumentState, 'status' | 'loading'>[])('disables geometry and note writes for $status documents', state => {
    const b = createCanvasNodeTestProps('note', { document: { ...canvasTestDocument(), ...state } })
    render(<CanvasNoteNode {...b.props} />)
    expect(screen.queryByRole('button', { name: 'Resize node' })).toBeNull()
    expect(button(en['canvas.noteEdit']).disabled).toBe(true)
    expect(screen.getByText(en['canvas.notePreview'], { exact: true })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: en['canvas.note'] })).toBeNull()
    fireEvent.click(button(en['canvas.more']))
    for (const name of [en['canvas.node.rename'], en['canvas.node.copy'], en['canvas.node.lock'], en['canvas.node.delete']]) {
      const item = screen.getByRole('menuitem', { name })
      expect(item instanceof HTMLButtonElement && item.disabled).toBe(true)
    }
    expect(b.commands.updateLayout).not.toHaveBeenCalled()
    expect(b.commands.updateNote).not.toHaveBeenCalled()
  })
})
