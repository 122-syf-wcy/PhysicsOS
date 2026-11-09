// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { CircuitBuilderPanel } from '../src/client/physics/CircuitBuilderPanel.tsx'
import { CircuitRenderer } from '../src/client/physics/circuit-renderer.tsx'
import { placeBuilderPart } from '../src/client/physics/circuit-part-drag.ts'
import { addComponent, BUILDER_PARTS, draftFromScene, draftToScene, emptyDraft, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import type { RendererProjection } from '../src/client/physics/renderer-registry.tsx'

const t = (key: keyof typeof zh): string => zh[key]
afterEach(cleanup)

function ownerOf(draft = starterDraft()) {
  const owner = createWorkbenchInstanceRuntime({ scene: draftToScene(draft),
    source: { kind: 'free-build' }, buildMode: 'construct', scheduler: null })
  onTestFinished(() => { owner.dispose() })
  return owner
}

function Panel({ owner, selected = 'r0' }: { owner: ReturnType<typeof ownerOf>; selected?: string }) {
  const summary = useSyncExternalStore(owner.summaries.subscribe, owner.summaries.getSnapshot)
  return <CircuitBuilderPanel t={t} draft={summary.draft!} selectedComponentId={selected} onSelectComponent={() => {}}
    editing={{ apply: (edit) => { owner.applyDraftEdit(edit) }, undo: () => { owner.undo() }, redo: () => { owner.redo() },
      canUndo: summary.history.canUndo, canRedo: summary.history.canRedo }} solvable variant="compact" />
}

describe('apparatus numeric drafts', () => {
  it('restores a cleared rating without changing the committed circuit or its current', () => {
    const owner = ownerOf()
    const before = owner.serialize()
    render(<Panel owner={owner} />)
    const field = screen.getByTestId<HTMLInputElement>('builder-resistance-r0')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(field.value).toBe('10')
    expect(owner.serialize().scene.revision).toBe(before.scene.revision)
    expect(owner.serialize().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(10)
    expect(owner.getSnapshot().workspace.view.overlay.readout).toContain('I = 0.6 A')
  })

  it('commits an explicitly typed zero instead of treating it as a blank draft', () => {
    const owner = ownerOf()
    const before = owner.serialize()
    render(<Panel owner={owner} selected="bat" />)
    const field = screen.getByTestId<HTMLInputElement>('builder-voltage-bat')
    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.blur(field)
    expect(owner.serialize().draft!.components.find(part => part.id === 'bat')!.params.voltage).toBe(0)
    expect(owner.serialize().instanceEditRevision).toBe(before.instanceEditRevision + 1)
  })

  it('does not carry an unfinished rating into another equal-rated apparatus', () => {
    const part = BUILDER_PARTS.find(item => item.id === 'resistor-10')!
    const owner = ownerOf(placeBuilderPart(starterDraft(), part, { x: 0, y: 4 }).draft)
    const view = render(<Panel owner={owner} selected="r0" />)
    fireEvent.change(screen.getByTestId('builder-resistance-r0'), { target: { value: '25' } })
    view.rerender(<Panel owner={owner} selected="r1" />)
    const next = screen.getByTestId<HTMLInputElement>('builder-resistance-r1')
    expect(next.value).toBe('10')
    fireEvent.blur(next)
    expect(owner.serialize().draft!.components.filter(item => item.type === 'resistor').map(item => item.params.resistance))
      .toEqual([10, 10])
  })
})

describe('bounded automatic apparatus placement', () => {
  it('places twelve apparatus without overlaps while preserving the existing assembly and scene roundtrip', () => {
    const initial = starterDraft()
    const part = BUILDER_PARTS.find(item => item.id === 'resistor-10')!
    let draft = initial
    for (let index = 0; index < 9; index += 1) draft = placeBuilderPart(draft, part).draft
    expect(draft.components).toHaveLength(12)
    expect(draft.components.slice(0, 3)).toEqual(initial.components)
    expect(new Set(draft.components.map(item => item.id)).size).toBe(12)
    const placed = draft.components.slice(3)
    for (const item of placed) {
      expect([-4, 0, 4]).toContain(item.placement.x)
      expect(item.placement.y % 4).toBe(0)
      for (const neighbor of draft.components.filter(other => other.id !== item.id)) {
        expect(Math.abs(item.placement.x - neighbor.placement.x) >= 2 || Math.abs(item.placement.y - neighbor.placement.y) >= 2).toBe(true)
      }
    }
    expect(Math.max(...placed.map(item => item.placement.y))).toBeLessThanOrEqual(12)
    const restored = draftFromScene(draftToScene(draft))
    expect(restored.components.map(({ id, placement, params }) => ({ id, placement, params })))
      .toEqual(draft.components.map(({ id, placement, params }) => ({ id, placement, params })))
    const source = restored.components.find(item => item.id === 'bat')!
    const switchPart = restored.components.find(item => item.id === 'sw')!
    expect(source.nets.positive).toBe(switchPart.nets.a)
  })

  it('leaves explicit drop placement and source replacement topology unchanged', () => {
    const initial = starterDraft()
    const resistor = BUILDER_PARTS.find(item => item.id === 'resistor-20')!
    const added = placeBuilderPart(initial, resistor, { x: 8.2, y: -4.6 })
    expect(added.draft.components.find(item => item.id === added.componentId)!.placement).toMatchObject({ x: 8, y: -4.5 })
    const supply = BUILDER_PARTS.find(item => item.id === 'supply-12')!
    const changed = placeBuilderPart(added.draft, supply)
    expect(changed.componentId).toBe('bat')
    expect(changed.draft.components.find(item => item.id === 'bat')).toMatchObject({
      placement: initial.components[0]!.placement, nets: initial.components[0]!.nets, params: { voltage: 12 },
    })
  })
})

const smallProjection: RendererProjection = {
  px: point => 100 + point.x * 6, py: point => 100 - point.y * 6,
  sx: x => (x - 100) / 6, sy: y => (100 - y) / 6, scale: 6, uid: 'touch-slop', path: () => '', highlighted: () => false,
}

function twoResistors() {
  const first = addComponent(emptyDraft(), 'resistor', { x: 0, y: 0 })
  return addComponent(first.draft, 'resistor', { x: 3, y: 0 }).draft
}

function TouchBench({ owner }: { owner: ReturnType<typeof ownerOf> }) {
  const summary = useSyncExternalStore(owner.summaries.subscribe, owner.summaries.getSnapshot)
  return <svg viewBox="0 0 400 300"><CircuitRenderer view={summary.workspace.view} projection={smallProjection}
    componentDrag={{ preview: (id, point) => { owner.previewComponentPlacement(id, point) },
      commit: (id, point) => { owner.commitComponentPlacement(id, point) }, cancel: () => { owner.cancelComponentPlacement() } }}
    componentWiring={{ start: (ref) => {
      if (owner.getSnapshot().pendingWire === undefined) owner.beginWire(ref)
      else owner.completeWire(ref)
    }, complete: (ref) => { owner.completeWire(ref) }, cancel: () => { owner.cancelWire() },
    ...(summary.pendingWire === undefined ? {} : { pending: summary.pendingWire }) }} /></svg>
}

function installIdentitySvg(container: HTMLElement) {
  const svg = container.querySelector('svg')!
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }) })
  return svg
}

describe('outward circuit terminal touch targets', () => {
  it.each([
    { rotation: 0, x: 67.5, y: 86 }, { rotation: 90, x: 86, y: 104.5 },
    { rotation: 180, x: 104.5, y: 86 }, { rotation: 270, x: 86, y: 67.5 },
  ] as const)('extends the target away from the body at rotation $rotation', ({ rotation, x, y }) => {
    const draft = twoResistors()
    const owner = ownerOf({ ...draft, components: draft.components.map((item, index) => index === 0
      ? { ...item, placement: { ...item.placement, rotation } } : item) })
    const { container } = render(<TouchBench owner={owner} />)
    const target = container.querySelector('[data-terminal-hit="r0.a"]')!
    expect(Number(target.getAttribute('x'))).toBe(x)
    expect(Number(target.getAttribute('y'))).toBe(y)
  })

  it('provides outward 28px targets while preserving the actual visible posts', () => {
    const owner = ownerOf(twoResistors())
    const { container } = render(<TouchBench owner={owner} />)
    const left = container.querySelector('[data-terminal-hit="r0.a"]')!
    const right = container.querySelector('[data-terminal-hit="r0.b"]')!
    const pole = container.querySelector('[data-terminal="r0.a"]')!
    expect(Number(left.getAttribute('width'))).toBe(28)
    expect(Number(left.getAttribute('height'))).toBe(28)
    expect(Number(left.getAttribute('x')) + 28).toBe(95.5)
    expect(Number(right.getAttribute('x'))).toBe(104.5)
    expect(Number(pole.getAttribute('r'))).toBeCloseTo(1.8)
    expect(Number(left.getAttribute('x')) + 28).toBeLessThan(100)
    expect(Number(right.getAttribute('x'))).toBeGreaterThan(100)
  })

  it('selects the closest terminal when outward touch targets overlap', () => {
    const owner = ownerOf(twoResistors())
    const { container } = render(<TouchBench owner={owner} />)
    installIdentitySvg(container)
    const overlapping = container.querySelector('[data-terminal-hit="r0.b"]')!
    fireEvent.pointerDown(overlapping, { button: 0, pointerType: 'touch', pointerId: 1, clientX: 112, clientY: 113 })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'r1', terminalKey: 'a' })
  })

  it('keeps body dragging above touch-target slop at small scales', () => {
    const owner = ownerOf(twoResistors())
    const { container } = render(<TouchBench owner={owner} />)
    installIdentitySvg(container)
    const layer = container.querySelector('[data-circuit-terminal-hit-layer]')!
    const body = container.querySelector('[data-component-id="r0"]')!
    expect(layer.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.pointerDown(body, { button: 0, pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(body, { pointerId: 2, clientX: 124, clientY: 100 })
    fireEvent.pointerUp(body, { pointerId: 2, clientX: 124, clientY: 100 })
    expect(owner.serialize().draft!.components.find(item => item.id === 'r0')!.placement.x).toBe(4)
    expect(owner.getSnapshot().pendingWire).toBeUndefined()
  })

  it('uses the closest release terminal for captured touch completion', () => {
    const owner = ownerOf(twoResistors())
    const { container } = render(<TouchBench owner={owner} />)
    installIdentitySvg(container)
    const source = container.querySelector('[data-terminal="r0.a"]')!
    const overlap = container.querySelector('[data-terminal-hit="r0.b"]')!
    const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => overlap })
    onTestFinished(() => {
      if (previous === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
      else Object.defineProperty(document, 'elementFromPoint', previous)
    })
    fireEvent.pointerDown(source, { button: 0, pointerType: 'touch', pointerId: 3, clientX: 95.5, clientY: 100 })
    fireEvent.pointerUp(source, { pointerId: 3, clientX: 112, clientY: 113 })
    const parts = owner.serialize().draft!.components
    expect(parts[0]!.nets.a).toBe(parts[1]!.nets.a)
    expect(parts[0]!.nets.b).not.toBe(parts[1]!.nets.a)
    expect(owner.getSnapshot().pendingWire).toBeUndefined()
  })

  it('keeps keyboard activation bound to the named terminal', () => {
    const owner = ownerOf(twoResistors())
    const { container } = render(<TouchBench owner={owner} />)
    fireEvent.keyDown(container.querySelector('[data-terminal="r0.a"]')!, { key: 'Enter' })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'r0', terminalKey: 'a' })
    fireEvent.keyDown(container.querySelector('[data-terminal="r1.b"]')!, { key: ' ' })
    const parts = owner.serialize().draft!.components
    expect(parts[0]!.nets.a).toBe(parts[1]!.nets.b)
  })
})
