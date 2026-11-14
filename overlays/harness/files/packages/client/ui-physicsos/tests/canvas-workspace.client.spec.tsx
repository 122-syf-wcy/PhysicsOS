// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'
import type { ReactFlow } from '@xyflow/react'
import { createManifest } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type { CanvasNode } from '@physicsos/physics-workbench/types'

import { CanvasWorkspace } from '../src/client/canvas/CanvasWorkspace.tsx'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { canvasCallbacks } from '../src/client/canvas/callbacks.ts'
import type { CanvasFlowNode, CanvasWorkbenchProps } from '../src/client/canvas/contract.ts'
import type { CanvasDocumentState } from '../src/client/canvas/types.ts'
import { canvasTestDocument, createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'

const observed = vi.hoisted((): { current: unknown } => ({ current: undefined }))

vi.mock('@xyflow/react', () => {
  const Flow = (props: { readonly children?: ReactNode; readonly nodes: readonly { id: string; data: { canvasId: string; nodeId: string }; position: { x: number; y: number }; parentId?: string; hidden?: boolean; draggable?: boolean; selected?: boolean }[] }) => {
    observed.current = props
    return <div data-testid="controlled-canvas-flow">{props.nodes.map(node => <div key={node.id} data-testid={`flow-node-${node.id}`}
      data-parent={node.parentId ?? ''} data-x={String(node.position.x)} data-y={String(node.position.y)}
      data-hidden={String(node.hidden ?? false)} data-draggable={String(node.draggable ?? false)} data-selected={String(node.selected ?? false)} />)}{props.children}</div>
  }
  return {
    ReactFlow: Flow, Background: () => null, MiniMap: () => <div data-testid="canvas-minimap" />,
    Panel: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
    BackgroundVariant: { Dots: 'dots' }, SelectionMode: { Partial: 'partial' },
  }
})
vi.mock('../src/client/canvas/CanvasNodes.tsx', () => ({
  CanvasExperimentNode: () => null, CanvasResultNode: () => null, CanvasNoteNode: () => null,
  CanvasComparisonNode: () => null, CanvasGroupNode: () => null,
}))

function useUnrenderedFactorySlot(): () => null { return () => null }
function rootFixture(document: CanvasDocumentState = canvasTestDocument()) {
  const local = createCanvasNodeTestProps('experiment', { document })
  local.commands.open.mockResolvedValue(document)
  local.commands.updateLayout.mockResolvedValue(undefined)
  local.commands.updateViewport.mockResolvedValue(undefined)
  local.commands.undo.mockResolvedValue(undefined)
  local.commands.redo.mockResolvedValue(undefined)
  local.commands.copyNodes.mockResolvedValue(undefined)
  local.commands.removeNodes.mockResolvedValue(undefined)
  local.commands.flush.mockResolvedValue(undefined)
  local.commands.sync.mockResolvedValue(undefined)
  const openCanvasView = vi.fn<CanvasWorkbenchProps['openCanvasView']>()
  const factorySlots: Record<string, () => null> = {}
  const useFactorySlot: CanvasWorkbenchProps['useFactorySlot'] = (name) => factorySlots[name] ?? (factorySlots[name] = useUnrenderedFactorySlot())
  const props = { ...local.props, canvasId: document.canvasId, useFactorySlot, openCanvasView } satisfies CanvasWorkbenchProps
  return { ...local, props, openCanvasView }
}

type FlowProps = ComponentProps<typeof ReactFlow<CanvasFlowNode>>
function currentFlow(): FlowProps {
  if (observed.current === undefined) throw new Error('The canvas flow has not rendered.')
  return observed.current as FlowProps
}
function nodeAt(id: string): CanvasFlowNode {
  const node = currentFlow().nodes?.find(node => node.id === id)
  if (node === undefined) throw new Error(`Missing displayed node ${id}`)
  return node
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred promise has not been initialized.') }
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}
function groupDocument(): CanvasDocumentState {
  const base = canvasTestDocument()
  const layout = { x: 100, y: 200, width: 800, height: 600, zIndex: 0 }
  const nodes: readonly CanvasNode[] = [
    { id: 'group', kind: 'group', title: 'Physical investigation', collapsed: false, layout },
    { id: 'child', kind: 'note', title: 'Measured conditions', body: 'The scene coordinates are independent.', format: 'plain', groupId: 'group',
      layout: { x: 150, y: 260, width: 340, height: 240, zIndex: 1 } },
  ]
  const manifest = { ...createManifest({ id: base.canvasId, title: 'Grouped investigation', now: '2026-11-08T10:00:00.000Z' }), nodes }
  return { ...base, manifest, objects: {}, canUndo: true, canRedo: true }
}

afterEach(() => { cleanup(); observed.current = undefined; vi.restoreAllMocks() })

describe('controlled experiment canvas workspace', () => {
  it('offers pen and bounded shape tools while keeping the Agent panel optional', () => {
    const fixture = rootFixture()
    render(<CanvasWorkspace {...fixture.props} />)
    expect(screen.queryByRole('complementary', { name: 'Canvas Agent' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }))
    expect(fixture.view.getSnapshot().tool).toBe('pen')
    expect(currentFlow().nodesDraggable).toBe(false)
    expect(screen.getByRole('button', { name: 'Rectangle' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(screen.getByRole('complementary', { name: 'Canvas Agent' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check canvas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Draw with AI' })).toBeTruthy()
  })

  it('starts in single-finger canvas movement on a touch tablet and keeps an explicit editing mode', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    onTestFinished(() => { vi.unstubAllGlobals() })
    const fixture = rootFixture()
    render(<CanvasWorkspace {...fixture.props} />)
    expect(fixture.view.getSnapshot().tool).toBe('hand')
    expect(currentFlow().panOnDrag).toBe(true)
    expect(currentFlow().selectionOnDrag).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(fixture.view.getSnapshot().tool).toBe('select')
  })
  it('opens the sole experiment from the toolbar so a narrow board remains editable', () => {
    const fixture = rootFixture()
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByTestId('canvas-edit-experiment'))
    const instance = canvasTestDocument().manifest!.instances[0]!
    expect(fixture.view.getSnapshot().focusedInstanceKey).toBe(fixture.props.canvasInstanceKey(fixture.props.canvasId, instance.instanceId))
  })

  it('opens a new apparatus bench directly from the board with a usable construction layout', async () => {
    const fixture = rootFixture()
    fixture.commands.addExperiment.mockResolvedValue('new-bench-instance')
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByText('New apparatus bench'))
    await waitFor(() => expect(fixture.commands.addExperiment).toHaveBeenCalledOnce())
    const [id, input] = fixture.commands.addExperiment.mock.calls[0]!
    expect(id).toBe(fixture.props.canvasId)
    expect(input.buildMode).toBe('construct')
    expect(input.source.kind).toBe('free-build')
    expect(input.layout).toMatchObject({ width: 1080, height: 700 })
    expect(input.scene.circuits[0]?.components).toHaveLength(3)
  })

  it('gives legacy construction cards room for a shelf and stage without rewriting stored layouts', () => {
    const original = canvasTestDocument()
    const manifest = original.manifest!
    const fixture = rootFixture({ ...original, manifest: { ...manifest,
      instances: manifest.instances.map(instance => ({ ...instance, buildMode: 'construct' as const })) } })
    render(<CanvasWorkspace {...fixture.props} />)
    const displayed = currentFlow().nodes?.find(node => node.type === 'experiment')
    expect(displayed?.width).toBe(480)
    expect(displayed?.height).toBe(640)
    expect(manifest.nodes.find(node => node.kind === 'experiment')!.layout.width).toBe(360)
    expect(fixture.commands.updateLayout).not.toHaveBeenCalled()
  })

  it('moves a locked descendant with its unlocked group and keeps the relative layout durable', async () => {
    const name = `canvas-group-lock-${randomUUID()}`
    const hash = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
    const persistence = createCanvasPersistence({ name, hash })
    let id = 0
    const controller = createCanvasController({ persistence, hash, api: createCanvasApi(async () => { throw new Error('Group layout tests must remain offline.') }),
      getAccount: () => undefined, online: () => false, createRuntime: async () => { throw new Error('A note group must not instantiate an experiment.') },
      id: prefix => `${prefix}-${name}-${++id}`, window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined,
    })
    onTestFinished(async () => { await controller.dispose(); await deleteDB(name) })
    const canvasId = await controller.create('Locked group relation')
    const left = await controller.addNote(canvasId, { body: 'Left', layout: { x: 40, y: 60, width: 320, height: 220 } })
    const locked = await controller.addNote(canvasId, { body: 'Locked child', layout: { x: 400, y: 60, width: 320, height: 220 } })
    const group = await controller.group(canvasId, [left, locked], 'Move together')
    await controller.setLocked(canvasId, [locked], true)
    const source = controller.documentSource(canvasId)
    const before = source.getSnapshot().manifest!
    const originalGroup = before.nodes.find(node => node.id === group)!
    const originalLocked = before.nodes.find(node => node.id === locked)!
    const fixture = rootFixture(source.getSnapshot())
    const props = { ...fixture.props, canvasId, canvasCommands: canvasCallbacks(controller),
      useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === canvasId ? source : undefined) } satisfies CanvasWorkbenchProps
    render(<CanvasWorkspace {...props} />)
    act(() => {
      const displayed = nodeAt(group)
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), displayed, [displayed])
      currentFlow().onNodesChange?.([{ type: 'position', id: group,
        position: { x: originalGroup.layout.x + 100, y: originalGroup.layout.y + 50 }, dragging: true }])
    })
    expect(fixture.view.getSnapshot().transientLayouts[locked]).toMatchObject({ x: originalLocked.layout.x + 100, y: originalLocked.layout.y + 50 })
    act(() => { const displayed = nodeAt(group); currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), displayed, [displayed]) })
    await waitFor(() => expect(source.getSnapshot().manifest!.nodes.find(node => node.id === group)?.layout.x).toBe(originalGroup.layout.x + 100))
    const moved = source.getSnapshot().manifest!.nodes.find(node => node.id === locked)!
    expect(moved.layout).toMatchObject({ x: originalLocked.layout.x + 100, y: originalLocked.layout.y + 50 })
    expect(moved.locked).toBe(true)
    const saved = await persistence.read(source.getSnapshot().namespace!, canvasId)
    expect(saved?.working.nodes.find(node => node.id === locked)?.layout).toEqual(moved.layout)
    await controller.updateLayout(canvasId, [{ id: locked, layout: { ...moved.layout, x: moved.layout.x + 7 } }])
    expect(source.getSnapshot().manifest!.nodes.find(node => node.id === locked)?.layout).toEqual(moved.layout)
    await controller.undo(canvasId)
    expect(source.getSnapshot().manifest!.nodes.find(node => node.id === group)?.layout).toEqual(originalGroup.layout)
    expect(source.getSnapshot().manifest!.nodes.find(node => node.id === locked)?.layout).toEqual(originalLocked.layout)
  })

  it('releases the conflict dialog when its owner namespace changes during a request', async () => {
    const original = { ...groupDocument(), status: 'conflict' as const }
    const fixture = rootFixture(original)
    const pending = deferred<void>()
    fixture.commands.resolveConflict.mockImplementationOnce(async () => { await pending.promise; throw new Error('The authenticated account changed.') })
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit local version' }))
    const dialog = screen.getByRole('dialog', { name: 'Submit local version' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    const { namespace: _namespace, manifest: _manifest, ...paused } = fixture.document.getSnapshot()
    await act(async () => {
      fixture.document.set({ ...paused, objects: {}, status: 'auth-required' })
      pending.resolve(); await pending.promise
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Submit local version' })).toBeNull())
    act(() => { fixture.document.set({ ...original, namespace: 'new-account' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Submit local version' }))
    expect((within(screen.getByRole('dialog', { name: 'Submit local version' })).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('confirms the retained local version and submits the current working manifest before syncing', async () => {
    const fixture = rootFixture({ ...groupDocument(), status: 'conflict' })
    fixture.commands.resolveConflict.mockImplementation(async (_id, manifest) => {
      fixture.document.set({ ...fixture.document.getSnapshot(), manifest, status: 'local-saved', conflicts: [] })
    })
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit local version' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit local version' })
    expect(fixture.commands.resolveConflict).not.toHaveBeenCalled()
    const latest = { ...fixture.document.getSnapshot().manifest!, nodes: fixture.document.getSnapshot().manifest!.nodes.map(node =>
      node.kind === 'note' ? { ...node, body: 'The latest retained local conclusion.' } : node) }
    act(() => { fixture.document.set({ ...fixture.document.getSnapshot(), manifest: latest }) })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(fixture.commands.resolveConflict).toHaveBeenCalledWith(fixture.props.canvasId, latest))
    await waitFor(() => expect(fixture.commands.sync).toHaveBeenCalledWith(fixture.props.canvasId))
    expect(fixture.commands.resolveConflict.mock.invocationCallOrder[0]).toBeLessThan(fixture.commands.sync.mock.invocationCallOrder[0]!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Submit local version' })).toBeNull())
    expect(fixture.document.getSnapshot().manifest?.nodes.find(node => node.kind === 'note')).toMatchObject({ body: 'The latest retained local conclusion.' })
  })

  it('keeps a rejected local conflict resolution available for an explicit retry', async () => {
    const original = { ...groupDocument(), status: 'conflict' as const }
    const fixture = rootFixture(original)
    fixture.commands.resolveConflict.mockRejectedValueOnce(new Error('The local commit failed.'))
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit local version' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit local version' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('The local commit failed.'))
    expect(fixture.document.getSnapshot().manifest).toBe(original.manifest)
    expect(fixture.commands.sync).not.toHaveBeenCalled()
    fixture.commands.resolveConflict.mockResolvedValue(undefined)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(fixture.commands.resolveConflict).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Submit local version' })).toBeNull())
    expect(fixture.commands.sync).toHaveBeenCalledWith(fixture.props.canvasId)
  })

  it('does not offer local conflict submission for a remotely deleted document', () => {
    const base = groupDocument()
    const fixture = rootFixture({ ...base, status: 'conflict', head: {
      id: base.canvasId, title: 'Deleted investigation', version: 2, generation: 2, changeSeq: 2,
      manifestDigest: 'a'.repeat(64), createdAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-09T10:00:00.000Z', deletedAt: '2026-11-09T10:00:00.000Z',
    } })
    render(<CanvasWorkspace {...fixture.props} />)
    expect(screen.queryByRole('button', { name: 'Submit local version' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use server version' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep local as a new workbench' })).toBeTruthy()
    expect(fixture.commands.resolveConflict).not.toHaveBeenCalled()
  })

  it('renders absolute document layouts as group-relative Flow positions with ID-only node data', () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    expect(screen.getByRole('heading', { name: 'Grouped investigation' })).toBeTruthy()
    expect(screen.getByTestId('flow-node-group').dataset.x).toBe('100')
    expect(screen.getByTestId('flow-node-child').dataset.x).toBe('50')
    expect(screen.getByTestId('flow-node-child').dataset.y).toBe('60')
    expect(nodeAt('child').data).toEqual({ canvasId: fixture.props.canvasId, nodeId: 'child' })
    expect(nodeAt('child').parentId).toBe('group')
    expect(fixture.commands.updateLayout).not.toHaveBeenCalled()
  })

  it('uses stable bound node types across selection and never passes runtime state in node data', () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    const bindings = currentFlow().nodeTypes
    act(() => { currentFlow().onNodesChange?.([{ type: 'select', id: 'child', selected: true }]) })
    expect(fixture.view.getSnapshot().selected).toEqual(['child'])
    expect(currentFlow().nodeTypes).toBe(bindings)
    expect(Object.keys(nodeAt('child').data).sort()).toEqual(['canvasId', 'nodeId'])
  })

  it('previews group drag without persistence and submits final world positions once', async () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    const group = nodeAt('group')
    act(() => {
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), group, [group])
      currentFlow().onNodesChange?.([{ type: 'position', id: 'group', position: { x: 120, y: 230 }, dragging: true }])
    })
    expect(fixture.commands.updateLayout).not.toHaveBeenCalled()
    expect(fixture.view.getSnapshot().transientLayouts.child).toMatchObject({ x: 170, y: 290 })
    act(() => {
      const finalGroup = { ...nodeAt('group'), position: { x: 130, y: 240 } }
      currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), finalGroup, [finalGroup])
    })
    await waitFor(() => expect(fixture.commands.updateLayout).toHaveBeenCalledTimes(1))
    expect(fixture.commands.updateLayout).toHaveBeenCalledWith(fixture.props.canvasId, [
      { id: 'group', layout: { x: 130, y: 240, width: 800, height: 600, zIndex: 0 } },
      { id: 'child', layout: { x: 180, y: 300, width: 340, height: 240, zIndex: 1 } },
    ])
    await waitFor(() => expect(fixture.view.getSnapshot().transientLayouts).toEqual({}))
  })

  it('commits a child drag in absolute coordinates while retaining its parent membership', async () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    const child = nodeAt('child')
    act(() => {
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), child, [child])
      const moved = { ...child, position: { x: 75, y: 90 } }
      currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), moved, [moved])
    })
    await waitFor(() => expect(fixture.commands.updateLayout).toHaveBeenCalledWith(fixture.props.canvasId, [
      { id: 'child', layout: { x: 175, y: 290, width: 340, height: 240, zIndex: 1 } },
    ]))
    expect(nodeAt('child').parentId).toBe('group')
  })

  it('does not clear a newer drag or viewport preview when an older layout write settles', async () => {
    const fixture = rootFixture(groupDocument())
    const first = deferred<void>()
    fixture.commands.updateLayout.mockImplementationOnce(() => first.promise)
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      const child = nodeAt('child')
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), child, [child])
      const completed = { ...child, position: { x: 75, y: 90 } }
      currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), completed, [completed])
    })
    expect(fixture.commands.updateLayout).toHaveBeenCalledTimes(1)
    act(() => {
      const child = nodeAt('child')
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), child, [child])
      currentFlow().onNodesChange?.([{ type: 'position', id: 'child', position: { x: 95, y: 120 }, dragging: true }])
      fixture.view.actions.previewViewport({ x: -30, y: 40, zoom: 0.8 })
    })
    await act(async () => { first.resolve(undefined); await first.promise })
    expect(fixture.view.getSnapshot().transientLayouts.child).toMatchObject({ x: 195, y: 320 })
    expect(fixture.view.getSnapshot().transientViewport).toEqual({ x: -30, y: 40, zoom: 0.8 })
    act(() => {
      const child = nodeAt('child')
      currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), child, [child])
    })
    await waitFor(() => expect(fixture.commands.updateLayout).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fixture.view.getSnapshot().transientLayouts.child).toBeUndefined())
    expect(fixture.view.getSnapshot().transientViewport).toEqual({ x: -30, y: 40, zoom: 0.8 })
  })

  it('retains readonly and locked nodes while keeping selections available', () => {
    const base = groupDocument()
    const fixture = rootFixture({ ...base, manifest: { ...base.manifest!, nodes: base.manifest!.nodes.map(node => ({ ...node, locked: true })) } })
    render(<CanvasWorkspace {...fixture.props} />)
    expect(nodeAt('child').draggable).toBe(false)
    act(() => { currentFlow().onNodesChange?.([{ type: 'select', id: 'child', selected: true }]) })
    fireEvent.keyDown(screen.getByRole('main'), { key: 'Delete' })
    expect(fixture.commands.removeNodes).not.toHaveBeenCalled()
    expect(fixture.view.getSnapshot().selected).toEqual(['child'])
  })

  it('previews viewport updates and persists only when the gesture ends', async () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      currentFlow().onMoveStart?.(new MouseEvent('mousedown'), { x: 0, y: 0, zoom: 1 })
      currentFlow().onViewportChange?.({ x: -24, y: 40, zoom: 0.8 })
    })
    expect(fixture.commands.updateViewport).not.toHaveBeenCalled()
    act(() => { currentFlow().onMoveEnd?.(new MouseEvent('mouseup'), { x: -24, y: 40, zoom: 0.8 }) })
    await waitFor(() => expect(fixture.commands.updateViewport).toHaveBeenCalledWith(fixture.props.canvasId, { x: -24, y: 40, zoom: 0.8 }))
    expect(fixture.commands.updateLayout).not.toHaveBeenCalled()
  })

  it('keeps a newer viewport and node resize preview after an older viewport write settles', async () => {
    const fixture = rootFixture(groupDocument())
    const first = deferred<void>()
    fixture.commands.updateViewport.mockImplementationOnce(() => first.promise)
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      currentFlow().onMoveStart?.(new MouseEvent('mousedown'), { x: 0, y: 0, zoom: 1 })
      currentFlow().onMoveEnd?.(new MouseEvent('mouseup'), { x: 10, y: 20, zoom: 0.9 })
    })
    act(() => {
      currentFlow().onMoveStart?.(new MouseEvent('mousedown'), { x: 10, y: 20, zoom: 0.9 })
      currentFlow().onViewportChange?.({ x: 40, y: 60, zoom: 0.7 })
      fixture.view.actions.previewLayout('child', { x: 150, y: 260, width: 400, height: 280, zIndex: 1 })
    })
    await act(async () => { first.resolve(undefined); await first.promise })
    expect(fixture.view.getSnapshot().transientViewport).toEqual({ x: 40, y: 60, zoom: 0.7 })
    expect(fixture.view.getSnapshot().transientLayouts.child?.width).toBe(400)
    act(() => { currentFlow().onMoveEnd?.(new MouseEvent('mouseup'), { x: 40, y: 60, zoom: 0.7 }) })
    await waitFor(() => expect(fixture.commands.updateViewport).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fixture.view.getSnapshot().transientViewport).toBeUndefined())
    expect(fixture.view.getSnapshot().transientLayouts.child?.width).toBe(400)
  })

  it('does not treat programmatic viewport callbacks as a second user commit', () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      currentFlow().onMoveStart?.(null, { x: 0, y: 0, zoom: 1 })
      currentFlow().onViewportChange?.({ x: 10, y: 20, zoom: 1.1 })
      currentFlow().onMoveEnd?.(null, { x: 10, y: 20, zoom: 1.1 })
    })
    expect(fixture.commands.updateViewport).not.toHaveBeenCalled()
  })

  it('keeps a deleted document viewport as a viewing-only gesture', () => {
    const fixture = rootFixture({ ...groupDocument(), status: 'deleted' })
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      currentFlow().onMoveStart?.(new MouseEvent('mousedown'), { x: 0, y: 0, zoom: 1 })
      currentFlow().onViewportChange?.({ x: 10, y: 20, zoom: 1.1 })
      currentFlow().onMoveEnd?.(new MouseEvent('mouseup'), { x: 10, y: 20, zoom: 1.1 })
    })
    expect(fixture.commands.updateViewport).not.toHaveBeenCalled()
    expect(fixture.view.getSnapshot().transientViewport).toEqual({ x: 10, y: 20, zoom: 1.1 })
  })

  it('routes outer undo and ignores text-input shortcuts', async () => {
    const fixture = rootFixture(groupDocument())
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.keyDown(screen.getByRole('main'), { key: 'z', ctrlKey: true })
    await waitFor(() => expect(fixture.commands.undo).toHaveBeenCalledWith(fixture.props.canvasId))
    const textbox = document.createElement('textarea')
    screen.getByRole('main').append(textbox)
    fireEvent.keyDown(textbox, { key: 'z', ctrlKey: true })
    expect(fixture.commands.undo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(textbox, { key: 'Delete' })
    expect(fixture.commands.removeNodes).not.toHaveBeenCalled()
  })

  it('opens the real library, adds a persistent note, and invokes account save callbacks', async () => {
    const fixture = rootFixture(groupDocument())
    fixture.commands.addNote.mockResolvedValue('created-note')
    render(<CanvasWorkspace {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add experiment' }))
    expect(fixture.view.getSnapshot().libraryOpen).toBe(true)
    act(() => { fixture.view.actions.setLibraryOpen(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(fixture.commands.addNote).toHaveBeenCalledWith(fixture.props.canvasId, { title: 'Note', format: 'markdown', body: '' }))
    expect(fixture.view.getSnapshot().selected).toEqual(['created-note'])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fixture.commands.flush).toHaveBeenCalledWith(fixture.props.canvasId))
    await waitFor(() => expect(fixture.commands.sync).toHaveBeenCalledWith(fixture.props.canvasId))
  })

  it('keeps content visible and clears transient gestures after a failed layout commit', async () => {
    const fixture = rootFixture(groupDocument())
    fixture.commands.updateLayout.mockRejectedValue(new Error('Local storage is unavailable'))
    render(<CanvasWorkspace {...fixture.props} />)
    act(() => {
      const child = nodeAt('child')
      currentFlow().onNodeDragStart?.(new MouseEvent('mousedown'), child, [child])
      const finalChild = { ...child, position: { x: 90, y: 100 } }
      currentFlow().onNodeDragStop?.(new MouseEvent('mouseup'), finalChild, [finalChild])
    })
    await waitFor(() => expect(fixture.view.getSnapshot().toast?.error).toBe(true))
    expect(screen.getByTestId('flow-node-child')).toBeTruthy()
    expect(fixture.view.getSnapshot().transientLayouts).toEqual({})
    expect(fixture.document.getSnapshot().manifest?.nodes[1]!.layout.x).toBe(150)
  })

  it('hides descendants of collapsed groups without deleting document content', () => {
    const base = groupDocument()
    const fixture = rootFixture({ ...base, manifest: { ...base.manifest!, nodes: base.manifest!.nodes.map(node => node.kind === 'group' ? { ...node, collapsed: true } : node) } })
    render(<CanvasWorkspace {...fixture.props} />)
    expect(nodeAt('child').hidden).toBe(true)
    expect(fixture.document.getSnapshot().manifest?.nodes).toHaveLength(2)
    expect(fixture.commands.removeNodes).not.toHaveBeenCalled()
  })
})
