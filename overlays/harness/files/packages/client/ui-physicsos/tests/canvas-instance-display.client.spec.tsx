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
  const frame = (displayKey: string) => ({ ...base.props, canvasId, instanceId, instanceKey, displayKey,
    presentation: displayKey === 'focus' ? 'focus' as const : 'card' as const } satisfies CanvasFrameProps)
  return { controller, manager, instanceKey, frame,
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

describe('native instance preview display ownership', () => {
  it('restores a rejected selected rating and accepts a valid unchanged correction in the real canvas owner', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const component = owned.summary().draft!.components.find(item => item.type === 'resistor')!
    const original = component.params.resistance!
    const revision = owned.summary().instanceEditRevision
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} presentation="card" renderSlot={renderSlot} />)
    fireEvent.click(view.getByTestId(`builder-row-${component.id}`))
    const field = await view.findByTestId<HTMLInputElement>(`builder-resistance-${component.id}`)
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
    const view = render(<CanvasInstanceView {...base} presentation="card" useCanvasDocument={useCanvasDocument} renderSlot={renderSlot} />)
    expect(view.getByTestId('builder-add-resistor-20').matches(':disabled')).toBe(true)
    expect(view.getByText('Back to inspection').matches(':disabled')).toBe(true)
  })

  it('assembles apparatus directly in a card and keeps the committed circuit undoable', async () => {
    const owned = await displays()
    await owned.controller.instanceAction(owned.instanceKey, 'enterBuilder')
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<CanvasInstanceView {...owned.frame('card')} presentation="card" renderSlot={renderSlot} />)
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
    const view = render(<CanvasInstanceView {...owned.frame('card')} presentation="card" renderSlot={renderSlot} />)
    fireEvent.click(view.getByText('Build with apparatus'))
    expect(await view.findByTestId('circuit-builder')).toBeTruthy()
    expect(owned.summary().buildMode).toBe('construct')
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('offers deployed slow playback and applies its rate to the same card and focused owner', async () => {
    const owned = await displays('magnetic')
    const renderSlot: CanvasInstanceProps['renderSlot'] = (_position, values) => <CanvasFrameStage {...owned.frame('card')} {...values} />
    const view = render(<><CanvasInstanceView {...owned.frame('card')} presentation="card" renderSlot={renderSlot} />
      <CanvasInstanceView {...owned.frame('focus')} presentation="focus" renderSlot={renderSlot} /></>)
    const rates = view.getAllByRole<HTMLSelectElement>('combobox', { name: 'Playback rate' })
    expect(within(rates[0]!).getByRole('option', { name: '0.01×' }).getAttribute('value')).toBe('0.01')
    fireEvent.change(rates[0]!, { target: { value: '0.01' } })
    await waitFor(() => expect(owned.summary().clock.rate).toBe(0.01))
    expect(rates[1]?.value).toBe('0.01')
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
    const object = within(focus).getByRole<SVGGElement>('slider', { name: '拖动物体' })
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
    const screenHandle = within(focus).getByRole<SVGGElement>('slider', { name: '拖动光屏' })
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
