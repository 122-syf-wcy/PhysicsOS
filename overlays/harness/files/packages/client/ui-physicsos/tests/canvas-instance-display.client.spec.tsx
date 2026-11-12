// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createParallelCircuitScene } from '@physicsos/physics-scene'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { CanvasFrameStage, CanvasInstanceView } from '../src/client/canvas/CanvasInstanceViews.tsx'
import type { CanvasFrameProps, CanvasInstanceProps } from '../src/client/canvas/contract.ts'
import type { CanvasDocumentState } from '../src/client/canvas/types.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { canvasCallbacks } from '../src/client/canvas/callbacks.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createCanvasRendererController } from '../src/client/canvas/renderer-controller.ts'
import { createWorkbenchInstanceRuntime, type WorkbenchInstanceSummary } from '../src/client/physics/workbench-instance-runtime.ts'
import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import type { WorkspaceFrame } from '../src/client/physics/workspace-runtime.ts'
import { createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function displays(kind: 'circuit' | 'lens' | 'magnetic' = 'circuit') {
  const name = `canvas-instance-display-${randomUUID()}`
  const hash = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
  let id = 0
  const controller = createCanvasController({ api: createCanvasApi(async () => { throw new Error('Display ownership tests must remain offline.') }),
    persistence: createCanvasPersistence({ name, hash }), hash, getAccount: () => undefined, online: () => false,
    createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
    id: prefix => `${prefix}-${name}-${++id}`, window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined,
  })
  const canvasId = await controller.create('Two displays, one owner')
  const templateId = kind === 'lens' ? 'convex-lens' : kind === 'magnetic' ? 'magnetic-circular' : 'parallel-circuit'
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error('The real display template is missing.')
  const scene = kind === 'circuit' ? createParallelCircuitScene() : createExperimentSceneRef(template,
    kind === 'lens' ? 'Owned lens bench' : 'Owned magnetic experiment').scene
  const instanceId = await controller.addExperiment(canvasId, { scene,
    source: { kind: 'template', id: templateId }, templateId })
  const instanceKey = controller.instanceKey(canvasId, instanceId)
  const manager = createCanvasRendererController(controller, 'http://canvas.test', async () => { throw new Error('A bundled circuit must not discover a renderer.') })
  onTestFinished(async () => { manager.dispose(); await controller.dispose(); await deleteDB(name) })
  const source = controller.documentSource(canvasId)
  const base = createCanvasNodeTestProps('experiment', { document: source.getSnapshot(), commands: canvasCallbacks(controller), overrides: {
    useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === canvasId ? source : undefined),
    useCanvasInstance: keyedSelectorHook<WorkbenchInstanceSummary | undefined>(key => controller.instanceSource(key)),
    useCanvasFrame: keyedSelectorHook<WorkspaceFrame | undefined>(key => controller.frameSource(key)),
    useCanvasRenderer: keyedSelectorHook(key => manager.source(key)), attachCanvasRenderer: manager.attach,
    retryCanvasRenderer: manager.refresh, applyCanvasRendererIntent: manager.applyIntent, cancelCanvasRendererPreview: manager.releasePreview,
    applyCanvasNativeAction: manager.nativeAction, ownsCanvasNativePreview: manager.ownsPreview,
  } })
  const useFactorySlot: CanvasInstanceProps['useFactorySlot'] = () => () => null
  const frame = (displayKey: string) => ({ ...base.props, canvasId, instanceId, instanceKey, displayKey,
    presentation: displayKey === 'focus' ? 'focus' as const : 'card' as const } satisfies CanvasFrameProps)
  return { controller, manager, instanceKey, useFactorySlot, frame,
    summary: () => controller.instanceSource(instanceKey).getSnapshot()!,
  }
}

function beginPlacement(root: HTMLElement) {
  const svg = root.querySelector('svg')!
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }) })
  const group = root.querySelector('[data-component-id="r1"]')!
  const rect = group.querySelector('rect')!
  const clientX = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2
  const clientY = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2
  fireEvent.pointerDown(group, { button: 0, pointerId: 1, clientX, clientY })
  fireEvent.pointerMove(group, { pointerId: 1, clientX: clientX + 50, clientY })
  return group
}

describe('native apparatus keyboard edits in a real canvas instance', () => {
  it('accumulates every queued arrow from the latest placement, including held and shifted keys', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    await owned.controller.instanceAction(owned.instanceKey, 'setHighlight', ['r2'])
    const before = owned.summary()
    const original = before.draft!.components.find(component => component.id === 'r1')!
    const view = render(<CanvasFrameStage {...owned.frame('card')} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="r1"]')!
    body.focus()
    await act(async () => {
      // All events arrive before the real native queue can commit and repaint.
      fireEvent.keyDown(body, { key: 'ArrowRight' })
      fireEvent.keyDown(body, { key: 'ArrowRight', repeat: true })
      fireEvent.keyDown(body, { key: 'ArrowUp', shiftKey: true })
      fireEvent.keyDown(body, { key: 'ArrowUp', shiftKey: true, repeat: true })
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
    })
    const moved = owned.summary().draft!.components.find(component => component.id === 'r1')!
    expect(moved.placement).toEqual({ ...original.placement, x: original.placement.x + 1, y: original.placement.y + 4 })
    expect(moved.params).toEqual(original.params)
    expect(owned.summary().workspace.view.highlighted).toEqual(['r1'])
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision + 4)
    expect(owned.summary().history.past).toHaveLength(before.history.past.length + 4)
    await act(async () => { await owned.controller.instanceAction(owned.instanceKey, 'undo') })
    expect(owned.summary().draft!.components.find(component => component.id === 'r1')!.placement)
      .toEqual({ ...original.placement, x: original.placement.x + 1, y: original.placement.y + 2 })
  })

  it('undoes an immediately preceding body copy without leaving a copied apparatus or phantom selection', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    await owned.controller.instanceAction(owned.instanceKey, 'setHighlight', ['r1'])
    const before = owned.summary()
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="r1"]')!
    body.focus()
    await act(async () => {
      fireEvent.keyDown(body, { key: 'd', ctrlKey: true })
      fireEvent.keyDown(body, { key: 'z', ctrlKey: true })
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
      await owned.controller.flush()
      // Drain post-settlement view callbacks as well as the two user commands.
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
    })
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().history.past).toEqual(before.history.past)
    expect(owned.summary().history.future).toHaveLength(1)
    expect(owned.summary().workspace.view.highlighted ?? []).toEqual([])
    expect(view.container.querySelectorAll('[data-component-id]')).toHaveLength(before.draft!.components.length)
    expect(view.container.querySelector('[data-testid^="builder-inspector-"]')).toBeNull()
  })

  it.each([
    { name: 'Ctrl+D', ctrlKey: true, metaKey: false },
    { name: 'Cmd+D', ctrlKey: false, metaKey: true },
  ])('copies the focused rated apparatus with $name as one undoable edit and selects its unwired copy', async shortcut => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    await owned.controller.instanceAction(owned.instanceKey, 'setComponentParams', 'r1', { resistance: 37 })
    const before = owned.summary().draft!
    const revision = owned.summary().instanceEditRevision
    const past = owned.summary().history.past.length
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="r1"]')!
    body.focus()
    fireEvent.keyDown(body, { key: 'd', ctrlKey: shortcut.ctrlKey, metaKey: shortcut.metaKey })
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(before.components.length + 1))
    const copy = owned.summary().draft!.components.find(component => !before.components.some(original => original.id === component.id))!
    expect(copy.type).toBe('resistor')
    expect(copy.params).toEqual({ resistance: 37 })
    expect(copy.placement.rotation).toBe(270)
    expect({ x: copy.placement.x, y: copy.placement.y }).not.toEqual({ x: -1.5, y: 0 })
    expect(new Set(Object.values(copy.nets)).size).toBe(2)
    const existingNets = new Set(before.components.flatMap(component => Object.values(component.nets)))
    expect(Object.values(copy.nets).some(net => existingNets.has(net))).toBe(false)
    expect(owned.summary().draft!.components.filter(component => component.id !== copy.id)).toEqual(before.components)
    await waitFor(() => expect(owned.summary().workspace.view.highlighted).toEqual([copy.id]))
    expect(await view.findByTestId(`builder-inspector-${copy.id}`)).toBeTruthy()
    expect(owned.summary().instanceEditRevision).toBe(revision + 1)
    expect(owned.summary().history.past).toHaveLength(past + 1)
    fireEvent.click(view.getByTestId('builder-undo'))
    await waitFor(() => expect(owned.summary().draft).toEqual(before))
    expect(owned.summary().workspace.view.highlighted ?? []).toEqual([])
    expect(owned.summary().history.past).toHaveLength(past)
  })

  it.each(['Delete', 'Backspace'])('removes the selected body with %s, clears selection, and restores its wiring on undo', async key => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const before = owned.summary().draft!
    const past = owned.summary().history.past.length
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="r1"]')!
    fireEvent.click(body)
    await waitFor(() => expect(owned.summary().workspace.view.highlighted).toEqual(['r1']))
    body.focus()
    fireEvent.keyDown(body, { key })
    await waitFor(() => expect(owned.summary().draft!.components.some(component => component.id === 'r1')).toBe(false))
    await waitFor(() => expect(owned.summary().workspace.view.highlighted ?? []).toEqual([]))
    expect(view.container.querySelector('[data-component-id="r1"]')).toBeNull()
    expect(owned.summary().history.past).toHaveLength(past + 1)
    fireEvent.click(view.getByTestId('builder-undo'))
    await waitFor(() => expect(owned.summary().draft).toEqual(before))
    expect(owned.summary().workspace.view.highlighted ?? []).toEqual([])
    expect(owned.summary().history.past).toHaveLength(past)
    expect(view.container.querySelector('[data-component-id="r1"]')).not.toBeNull()
  })

  it('keeps one supply when its directly focused body receives copy shortcuts', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const before = owned.summary()
    const view = render(<CanvasFrameStage {...owned.frame('card')} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="bat"]')!
    body.focus()
    await act(async () => {
      fireEvent.keyDown(body, { key: 'd', ctrlKey: true })
      fireEvent.keyDown(body, { key: 'd', metaKey: true })
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
    })
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owned.summary().history).toEqual(before.history)
  })

  it.each(['inspect', 'auth-required', 'deleted', 'loading'] as const)('does not edit apparatus from body keys in a %s display', async state => {
    const owned = await displays()
    if (state !== 'inspect') await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const base = owned.frame('card')
    const document = { ...owned.controller.documentSource(base.canvasId).getSnapshot(),
      ...(state === 'auth-required' || state === 'deleted' ? { status: state } : {}),
      ...(state === 'loading' ? { loading: true } : {}),
    }
    const source = { getSnapshot: () => document, subscribe: () => () => {} }
    const useCanvasDocument = keyedSelectorHook<CanvasDocumentState>(key => key === base.canvasId ? source : undefined)
    const before = owned.summary()
    const view = render(<CanvasFrameStage {...base} useCanvasDocument={useCanvasDocument} />)
    const body = view.container.querySelector<SVGGElement>('[data-component-id="r1"]')!
    await act(async () => {
      for (const key of ['ArrowRight', 'r', 'Delete', 'Backspace']) fireEvent.keyDown(body, { key })
      fireEvent.keyDown(body, { key: 'd', ctrlKey: true })
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
    })
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().buildMode).toBe(before.buildMode)
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owned.summary().history).toEqual(before.history)
  })

  it('blocks another display from rotating, deleting or copying while the focus display owns a placement preview', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const view = render(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div>
      <div data-display="focus"><CanvasFrameStage {...owned.frame('focus')} /></div></>)
    const card = view.container.querySelector<HTMLElement>('[data-display="card"]')!
    const focus = view.container.querySelector<HTMLElement>('[data-display="focus"]')!
    const previewBody = beginPlacement(focus)
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    const before = owned.summary()
    const body = card.querySelector<SVGGElement>('[data-component-id="r2"]')!
    body.focus()
    await act(async () => {
      for (const key of ['r', 'Delete', 'Backspace']) fireEvent.keyDown(body, { key })
      fireEvent.keyDown(body, { key: 'd', ctrlKey: true })
      // Await the real native channel; queued edits must have settled before these checks.
      expect(await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')).toBe(false)
    })
    expect(owned.summary().previewing).toBe(true)
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owned.summary().history).toEqual(before.history)
    expect(owned.summary().workspace.view.highlighted).toEqual(before.workspace.view.highlighted)
    fireEvent.lostPointerCapture(previewBody, { pointerId: 1 })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
    fireEvent.keyDown(body, { key: 'd', ctrlKey: true })
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(before.draft!.components.length + 1))
    const copy = owned.summary().draft!.components.find(component => !before.draft!.components.some(original => original.id === component.id))!
    await waitFor(() => expect(owned.summary().workspace.view.highlighted).toEqual([copy.id]))
  })

  it('reports a rejected native draft as unsuccessful without adding history or changing selection', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    render(<CanvasFrameStage {...owned.frame('card')} />)
    await act(async () => { await owned.controller.instanceAction(owned.instanceKey, 'setHighlight', ['r1']) })
    const before = owned.summary()
    await act(async () => {
      await expect(owned.manager.nativeAction(owned.instanceKey, 'card', 'applyDraftEdit', draft => ({
        ...draft,
        components: draft.components.map(component => component.id === 'r1'
          ? { ...component, params: { resistance: -1 } } : component),
      }))).rejects.toThrow('WORKBENCH_EDIT_REJECTED')
    })
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owned.summary().history).toEqual(before.history)
    expect(owned.summary().workspace.view.highlighted).toEqual(['r1'])
    expect(owned.summary().diagnostics.some(item => item.code === 'INVALID_DRAFT' || item.code === 'WORKBENCH_EDIT_REJECTED')).toBe(true)
  })

  it('preserves the slider and terminal keyboard controls nested inside a focusable apparatus body', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    const count = owned.summary().draft!.components.length
    fireEvent.click(view.getByTestId('builder-add-rheostat-20'))
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(count + 1))
    const added = owned.summary().draft!.components.at(-1)!
    const body = view.container.querySelector<SVGGElement>(`[data-component-id="${added.id}"]`)!
    const slider = body.querySelector<SVGRectElement>('[role="slider"]')!
    slider.focus()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => expect(owned.summary().draft!.components.find(component => component.id === added.id)!.params.sliderPosition).toBe(0.55))
    expect(owned.summary().draft!.components.find(component => component.id === added.id)!.placement).toEqual(added.placement)
    const before = owned.summary()
    const terminal = view.container.querySelector<SVGCircleElement>('[data-terminal="r1.a"]')!
    await act(async () => {
      for (const descendant of [slider, terminal]) {
        descendant.focus()
        for (const key of ['r', 'Delete', 'Backspace']) fireEvent.keyDown(descendant, { key })
        fireEvent.keyDown(descendant, { key: 'd', ctrlKey: true })
      }
      await owned.manager.nativeAction(owned.instanceKey, 'card', 'cancelComponentPlacement')
    })
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owned.summary().history).toEqual(before.history)
    fireEvent.keyDown(terminal, { key: 'Enter' })
    await waitFor(() => expect(owned.summary().pendingWire).toEqual({ componentId: 'r1', terminalKey: 'a' }))
    fireEvent.keyDown(terminal, { key: 'Escape' })
    await waitFor(() => expect(owned.summary().pendingWire).toBeUndefined())
    expect(owned.summary().draft).toEqual(before.draft)
    expect(owned.summary().history).toEqual(before.history)
  })
})

describe('native instance preview display ownership', () => {
  it('restores a rejected selected rating and accepts a valid unchanged correction in the real canvas owner', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const component = owned.summary().draft!.components.find(item => item.type === 'resistor')!
    const original = component.params.resistance!
    const revision = owned.summary().instanceEditRevision
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    fireEvent.click(view.getByTestId(`builder-row-${component.id}`))
    const field = await view.findByTestId(`builder-resistance-${component.id}`) as HTMLInputElement
    fireEvent.change(field, { target: { value: '-1' } })
    fireEvent.blur(field)
    await waitFor(() => expect(field.value).toBe(String(original)))
    expect(owned.summary().instanceEditRevision).toBe(revision)
    expect(await view.findByRole('alert')).toBeTruthy()
    fireEvent.change(field, { target: { value: String(original) } })
    fireEvent.blur(field)
    await waitFor(() => expect(view.getByTestId('circuit-builder').getAttribute('aria-busy')).toBe('false'))
    expect(view.queryByRole('alert')).toBeNull()
    expect(owned.summary().diagnostics).toEqual([])
    expect(owned.summary().instanceEditRevision).toBe(revision)
    fireEvent.change(field, { target: { value: String(original + 5) } })
    fireEvent.blur(field)
    await waitFor(() => expect(owned.summary().draft!.components.find(item => item.id === component.id)!.params.resistance).toBe(original + 5))
    expect(view.getByTestId(`builder-inspector-${component.id}`)).toBeTruthy()
  })

  it('docks all live construction readings outside a narrow diagram and restores the wide overlay without a scene edit', async () => {
    const observers = new Map<Element, () => void>()
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly resized: () => void) {}
      observe(element: Element) { observers.set(element, this.resized) }
      disconnect() {}
    })
    onTestFinished(() => { vi.unstubAllGlobals() })
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const originalRevision = owned.summary().instanceEditRevision
    const readings = owned.summary().workspace.view.overlay.readout
    const view = render(<CanvasFrameStage {...owned.frame('focus')} />)
    const stage = view.container.querySelector<HTMLElement>('[data-canvas-instance-stage]')!
    let stageWidth = 320
    Object.defineProperty(stage, 'clientWidth', { configurable: true, get: () => stageWidth })
    act(() => { observers.get(stage)?.() })
    const dock = view.container.querySelector('[data-canvas-readouts="docked"]')
    expect(dock).not.toBeNull()
    expect([...dock!.querySelectorAll('span')].map(row => row.textContent)).toEqual(readings)
    expect(view.container.querySelector('svg [data-physics-readout]')).toBeNull()
    expect(stage.querySelector('[data-canvas-diagram] svg')).not.toBeNull()
    stageWidth = 720
    act(() => { observers.get(stage)?.() })
    expect(view.container.querySelector('[data-canvas-readouts="docked"]')).toBeNull()
    expect(view.container.querySelector('svg [data-physics-readout]')).not.toBeNull()
    expect(owned.summary().instanceEditRevision).toBe(originalRevision)
  })

  it.each(['auth-required', 'deleted'] as const)('keeps the inline apparatus palette read-only for %s documents', async status => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const base = owned.frame('card')
    const document = { ...owned.controller.documentSource(base.canvasId).getSnapshot(), status }
    const source = { getSnapshot: () => document, subscribe: () => () => {} }
    const useCanvasDocument = keyedSelectorHook<CanvasDocumentState>(key => key === base.canvasId ? source : undefined)
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...base} {...values} useCanvasDocument={useCanvasDocument} />
    const view = render(<CanvasInstanceView {...base} useFactorySlot={owned.useFactorySlot} presentation="card" useCanvasDocument={useCanvasDocument} renderSlot={renderSlot} />)
    expect(view.getByTestId('builder-add-resistor-20').matches(':disabled')).toBe(true)
    expect(view.getByText('Back to inspection').matches(':disabled')).toBe(true)
  })

  it('assembles apparatus directly in a card and keeps the committed circuit undoable', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    const count = owned.summary().draft!.components.length
    fireEvent.click(view.getByTestId('builder-add-resistor-20'))
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(count + 1))
    const added = owned.summary().draft!.components.at(-1)!
    expect(await view.findByTestId(`builder-inspector-${added.id}`)).toBeTruthy()
    expect(owned.summary().draft!.components.at(-1)!.params.resistance).toBe(20)
    fireEvent.click(view.getByTestId(`builder-rotate-${added.id}`))
    await waitFor(() => expect(owned.summary().draft!.components.at(-1)!.placement.rotation).toBe(90))
    fireEvent.click(view.getByTestId(`builder-remove-${added.id}`))
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(count))
    fireEvent.click(view.getByTestId('builder-undo'))
    await waitFor(() => expect(owned.summary().draft!.components).toHaveLength(count + 1))
    expect(owned.summary().draft!.components.at(-1)!.placement.rotation).toBe(90)
  })

  it('enters apparatus construction from an ordinary circuit card without a modal', async () => {
    const owned = await displays()
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />)
    fireEvent.click(view.getByText('Build with apparatus'))
    expect(await view.findByTestId('circuit-builder')).toBeTruthy()
    expect(owned.summary().buildMode).toBe('construct')
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('offers deployed slow playback and applies its rate to the same card and focused owner', async () => {
    const owned = await displays('magnetic')
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<><CanvasInstanceView {...owned.frame('card')} useFactorySlot={owned.useFactorySlot} presentation="card" renderSlot={renderSlot} />
      <CanvasInstanceView {...owned.frame('focus')} useFactorySlot={owned.useFactorySlot} presentation="focus" renderSlot={renderSlot} /></>)
    const rates = view.getAllByRole('combobox', { name: 'Playback rate' })
    expect(within(rates[0]!).getByRole('option', { name: '0.01×' }).getAttribute('value')).toBe('0.01')
    fireEvent.change(rates[0]!, { target: { value: '0.01' } })
    await waitFor(() => expect(owned.summary().clock.rate).toBe(0.01))
    expect((rates[1] as HTMLSelectElement | undefined)?.value).toBe('0.01')
  })

  it('moves the native owned optics object along its rail without changing object height', async () => {
    const owned = await displays('lens')
    const view = render(<CanvasFrameStage {...owned.frame('card')} />)
    const value = (id: string) => owned.summary().workspace.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === id)!.value
    const distance = value('object-distance')
    const height = value('object-height')
    const svg = view.container.querySelector('svg')!
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }) })
    const arrow = view.container.querySelector('[class*="opticalObjectLine"]')!
    const group = arrow.parentElement!
    const clientX = Number(arrow.getAttribute('x1'))
    const clientY = Number(arrow.getAttribute('y1'))
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, clientX, clientY })
    fireEvent.pointerMove(group, { pointerId: 1, clientX: clientX + 40, clientY: clientY + 100 })
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    fireEvent.pointerUp(group, { pointerId: 1, clientX: clientX + 40, clientY: clientY + 100 })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
    expect(value('object-distance')).toBeLessThan(distance)
    expect(value('object-height')).toBe(height)
    expect(owned.summary().history.canUndo).toBe(true)
  })

  it('uses the existing lens bench to preview and commit on the same focused owner as its card', async () => {
    const owned = await displays('lens')
    const view = render(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div><div data-display="focus"><CanvasFrameStage {...owned.frame('focus')} /></div></>)
    const focus = view.container.querySelector<HTMLElement>('[data-display="focus"]')!
    fireEvent.click(within(focus).getByRole('button', { name: '2D lens bench' }))
    const object = within(focus).getByRole('slider', { name: '拖动物体' }) as unknown as SVGGElement
    const svg = object.ownerSVGElement!
    Object.defineProperty(svg, 'setPointerCapture', { value: () => undefined })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
      width: 840, height: 330, right: 840, bottom: 330, toJSON: () => ({}) })
    const original = owned.summary().workspace.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'object-distance')!.value
    const rect = object.querySelector('rect')!
    const clientX = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2
    fireEvent.pointerDown(object, { button: 0, pointerId: 1, clientX, clientY: 170 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: clientX - 50, clientY: 170 })
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: clientX - 50, clientY: 170 })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
    expect(owned.summary().workspace.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'object-distance')!.value).toBeGreaterThan(original)
    expect(owned.summary().history.canUndo).toBe(true)
    expect(owned.controller.getSnapshot().documents).toHaveLength(1)
    expect(owned.controller.documentSource(owned.frame('card').canvasId).getSnapshot().manifest!.instances).toHaveLength(1)
    expect(view.container.querySelectorAll(`[data-canvas-instance-stage]`)).toHaveLength(2)
  })

  it('cancels an existing focused lens screen preview on exit without editing its committed scene', async () => {
    const owned = await displays('lens')
    const view = render(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div><div data-display="focus"><CanvasFrameStage {...owned.frame('focus')} /></div></>)
    const focus = view.container.querySelector<HTMLElement>('[data-display="focus"]')!
    fireEvent.click(within(focus).getByRole('button', { name: '2D lens bench' }))
    const screenHandle = within(focus).getByRole('slider', { name: '拖动光屏' }) as unknown as SVGGElement
    const svg = screenHandle.ownerSVGElement!
    Object.defineProperty(svg, 'setPointerCapture', { value: () => undefined })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
      width: 840, height: 330, right: 840, bottom: 330, toJSON: () => ({}) })
    const revision = owned.summary().instanceEditRevision
    const rect = screenHandle.querySelector('rect')!
    const clientX = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2
    fireEvent.pointerDown(screenHandle, { button: 0, pointerId: 1, clientX, clientY: 170 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: clientX + 40, clientY: 170 })
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    await act(async () => { view.rerender(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div></>) })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
    expect(owned.summary().instanceEditRevision).toBe(revision)
  })

  it('cancels a focus display preview when it unmounts while its card remains attached', async () => {
    const owned = await displays()
    const view = render(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div><div data-display="focus"><CanvasFrameStage {...owned.frame('focus')} /></div></>)
    beginPlacement(view.container.querySelector<HTMLElement>('[data-display="focus"]')!)
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    const revision = owned.summary().instanceEditRevision
    await act(async () => { view.rerender(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div></>) })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
    expect(owned.summary().instanceEditRevision).toBe(revision)
    expect(view.container.querySelector('[data-canvas-instance-stage]')).toBeTruthy()
  })

  it('does not cancel a card preview merely because another focus display closes', async () => {
    const owned = await displays()
    const view = render(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div><div data-display="focus"><CanvasFrameStage {...owned.frame('focus')} /></div></>)
    beginPlacement(view.container.querySelector<HTMLElement>('[data-display="card"]')!)
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    await act(async () => { view.rerender(<><div data-display="card"><CanvasFrameStage {...owned.frame('card')} /></div></>) })
    expect(owned.summary().previewing).toBe(true)
  })

  it('cancels the native preview when its SVG loses pointer capture', async () => {
    const owned = await displays()
    const view = render(<CanvasFrameStage {...owned.frame('card')} />)
    const group = beginPlacement(view.container)
    await waitFor(() => expect(owned.summary().previewing).toBe(true))
    fireEvent.lostPointerCapture(group, { pointerId: 1 })
    await waitFor(() => expect(owned.summary().previewing).toBe(false))
  })
})
