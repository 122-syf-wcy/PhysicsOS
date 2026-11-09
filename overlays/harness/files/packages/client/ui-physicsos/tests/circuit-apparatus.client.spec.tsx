// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { zh } from '../src/client/locales.ts'
import { CircuitBuilderPanel, type BuilderEditing } from '../src/client/physics/CircuitBuilderPanel.tsx'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { CircuitRenderer } from '../src/client/physics/circuit-renderer.tsx'
import { addPart, BUILDER_PARTS, draftToScene, starterDraft, type CircuitDraft, type TerminalRef } from '../src/client/physics/circuit-builder.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { placeBuilderPart } from '../src/client/physics/circuit-part-drag.ts'
import type { RendererProjection } from '../src/client/physics/renderer-registry.tsx'

const translations: Readonly<Record<string, string>> = zh
const t = (key: keyof typeof zh): string => translations[key] ?? key
const PART_MIME = 'application/x-physicsos-circuit-part'
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('inline apparatus palette', () => {
  it('changes the source rating while preserving its connected terminals and placement', () => {
    const initial = starterDraft()
    const source = initial.components.find(part => part.type === 'voltage_source')!
    let committed = initial
    function Bench() {
      const [draft, setDraft] = useState(initial)
      const current = createCircuitWorkspaceRuntime(draftToScene(draft)).getSnapshot().view.circuitComponents?.find(part => part.id === 'r0')?.currentText
      return <><CircuitBuilderPanel t={t} draft={draft} editing={{ apply: (edit) => {
        committed = edit(committed); setDraft(committed)
      }, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false }} solvable variant="compact" />
      <output data-testid="source-loop-current">{current ?? 'unavailable'}</output></>
    }
    render(<Bench />)
    fireEvent.click(screen.getByTestId('builder-add-battery-1.5'))
    expect(committed.components.filter(part => part.type === 'voltage_source')).toHaveLength(1)
    expect(committed.components.find(part => part.id === source.id)).toMatchObject({
      nets: source.nets, placement: source.placement, params: { voltage: 1.5 },
    })
    expect(screen.getByTestId(`builder-inspector-${source.id}`)).toBeTruthy()
    expect(screen.getByTestId('source-loop-current').textContent).toBe('I=0.15 A')
  })

  it('selects the newly placed apparatus after an asynchronous committed edit', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    function Bench() {
      const [draft, setDraft] = useState(starterDraft())
      const [selected, select] = useState<string | undefined>()
      const editing: BuilderEditing = {
        apply: async (edit) => { await gate; setDraft(current => edit(current)) },
        undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
      }
      return <CircuitBuilderPanel t={t} draft={draft} editing={editing} solvable selectedComponentId={selected} onSelectComponent={select} variant="compact" />
    }
    render(<Bench />)
    fireEvent.click(screen.getByTestId('builder-add-resistor-20'))
    expect(screen.queryByTestId('builder-inspector-r1')).toBeNull()
    await act(async () => { release?.() })
    expect(await screen.findByTestId('builder-inspector-r1')).toBeTruthy()
    expect(screen.getByTestId<HTMLInputElement>('builder-resistance-r1').value).toBe('20')
  })

  it('puts a catalog id in the apparatus drag payload', () => {
    render(<CircuitBuilderPanel t={t} draft={starterDraft()} editing={{ apply: () => {}, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false }} solvable variant="compact" />)
    const values: Record<string, string> = {}
    fireEvent.dragStart(screen.getByTestId('builder-add-ammeter'), { dataTransfer: { setData: (kind: string, value: string) => { values[kind] = value }, effectAllowed: 'none' } })
    expect(values[PART_MIME]).toBe('ammeter')
  })

  it('cuts only the selected terminal and recomputes the actual loop current', () => {
    let committed = starterDraft()
    function Bench() {
      const [draft, setDraft] = useState(committed)
      committed = draft
      const runtime = createCircuitWorkspaceRuntime(draftToScene(draft))
      const snapshot = runtime.getSnapshot()
      const current = snapshot.view.overlay?.readout.find(line => line.startsWith('I ='))
      return <><CircuitBuilderPanel t={t} draft={draft} editing={{
        apply: (edit) => { setDraft(previous => edit(previous)) },
        undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
      }}
      solvable selectedComponentId="sw" onSelectComponent={() => {}} variant="compact" /><output data-testid="loop-current">{current ?? 'unavailable'}</output></>
    }
    render(<Bench />)
    expect(screen.getByTestId('loop-current').textContent).toBe('I = 0.6 A')
    fireEvent.click(screen.getByTestId('builder-disconnect-sw-a'))
    expect(screen.getByTestId('loop-current').textContent).toBe('I = 0 A')
    const switchPart = committed.components.find(part => part.id === 'sw')!
    const source = committed.components.find(part => part.id === 'bat')!
    const load = committed.components.find(part => part.id === 'r0')!
    expect(switchPart.nets.a).not.toBe(source.nets.positive)
    expect(switchPart.nets.b).toBe(load.nets.a)
    expect(load.nets.b).toBe(source.nets.negative)
  })
})

describe('apparatus canvas placement', () => {
  it('makes edge terminal targets reachable in the schematic gutter while reading-only scenes retain their plot clip', () => {
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(starterDraft())).getSnapshot()
    const mounted = render(<PhysicsCanvas view={snapshot.view} ariaLabel="apparatus" />)
    expect(mounted.container.querySelector('[data-component-id="r0"]')!.closest('[clip-path]')).not.toBeNull()
    mounted.rerender(<PhysicsCanvas view={snapshot.view} ariaLabel="apparatus" componentWiring={{ start: () => {} }} />)
    expect(mounted.container.querySelector('[data-component-id="r0"]')!.closest('[clip-path]')).toBeNull()
  })

  it('drops a replacement source at the new position while retaining the existing electrical connections', () => {
    const initial = starterDraft()
    const source = initial.components.find(part => part.type === 'voltage_source')!
    const part = BUILDER_PARTS.find(item => item.id === 'supply-12')!
    const dropped = placeBuilderPart(initial, part, { x: 3, y: -2 })
    expect(dropped.componentId).toBe(source.id)
    expect(dropped.draft.components.filter(item => item.type === 'voltage_source')).toHaveLength(1)
    expect(dropped.draft.components.find(item => item.id === source.id)).toMatchObject({
      nets: source.nets, placement: { x: 3, y: -2 }, params: { voltage: 12 },
    })
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(dropped.draft)).getSnapshot()
    expect(snapshot.view.circuitComponents?.find(item => item.id === 'r0')?.currentText).toBe('I=1.2 A')
  })

  it('drops a rated part at the inverse SVG point when the outer canvas is zoomed', () => {
    let placed: CircuitDraft = starterDraft()
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(placed)).getSnapshot()
    const view = { ...snapshot.view, origin: { x: -10, y: -6 }, extent: { width: 20, height: 12 } }
    const mounted = render(<PhysicsCanvas view={view} ariaLabel="apparatus" onDropPart={(id, at) => {
      const part = BUILDER_PARTS.find(item => item.id === id)
      if (part !== undefined) placed = addPart(placed, part, at).draft
    }} />)
    const svg = mounted.container.querySelector('svg')!
    // SVG pixel (406, 220.5) is scene (0, 0). The outer flow has scaled it 2x and translated (100, 50).
    Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50,
      inverse: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: -50, f: -25 }) }) })
    const drop = createEvent.drop(svg, { dataTransfer: { types: [PART_MIME], getData: (kind: string) => kind === PART_MIME ? 'resistor-20' : '' } })
    Object.defineProperties(drop, { clientX: { value: 912 }, clientY: { value: 491 } })
    fireEvent(svg, drop)
    expect(placed.components.find(part => part.id === 'r1')).toMatchObject({ placement: { x: 0, y: 0 }, params: { resistance: 20 } })
  })

  it('rejects a dropped payload outside the apparatus catalog', () => {
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(starterDraft())).getSnapshot()
    let added = 0
    const mounted = render(<PhysicsCanvas view={snapshot.view} ariaLabel="apparatus" onDropPart={() => { added += 1 }} />)
    const svg = mounted.container.querySelector('svg')!
    fireEvent.drop(svg, { clientX: 100, clientY: 100, dataTransfer: { types: [PART_MIME], getData: () => 'not-a-catalog-part' } })
    expect(added).toBe(0)
  })

  it('selects an apparatus body on the canvas for its parameter inspector', () => {
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(starterDraft())).getSnapshot()
    function Bench() {
      const [selected, select] = useState<string | undefined>()
      return <><PhysicsCanvas view={snapshot.view} ariaLabel="apparatus" componentSelection={{ ...(selected === undefined ? {} : { selected }), select }} />
        <output data-testid="selected-apparatus">{selected}</output></>
    }
    const mounted = render(<Bench />)
    fireEvent.click(mounted.container.querySelector('[data-component-id="r0"]')!)
    expect(screen.getByTestId('selected-apparatus').textContent).toBe('r0')
    expect(mounted.container.querySelector('[data-component-id="r0"]')?.getAttribute('data-component-selected')).toBe('true')
  })
})

describe('pending circuit lead', () => {
  it('follows the pointer without committing a wire or changing the scene revision', () => {
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    const snapshot = runtime.getSnapshot()
    const projection: RendererProjection = { px: at => 200 + at.x * 30, py: at => 200 - at.y * 30,
      sx: x => (x - 200) / 30, sy: y => (200 - y) / 30, scale: 30, uid: 'lead-test', path: () => '', highlighted: () => false }
    function Bench() {
      const [pending, setPending] = useState<TerminalRef | undefined>()
      return <svg viewBox="0 0 600 400"><CircuitRenderer view={snapshot.view} projection={projection}
        componentWiring={{
          ...(pending === undefined ? {} : { pending }), start: setPending, cancel: () => { setPending(undefined) },
        }} /></svg>
    }
    const mounted = render(<Bench />)
    const svg = mounted.container.querySelector('svg')!
    Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }) })
    const terminal = mounted.container.querySelector('[data-terminal="sw.a"]')!
    const down = createEvent.pointerDown(terminal)
    Object.defineProperties(down, {
      button: { value: 0 }, pointerId: { value: 9 }, pointerType: { value: 'mouse' }, clientX: { value: 180 }, clientY: { value: 180 },
    })
    fireEvent(terminal, down)
    const move = createEvent.pointerMove(window)
    Object.defineProperties(move, { pointerId: { value: 9 }, clientX: { value: 350 }, clientY: { value: 160 } })
    fireEvent(window, move)
    const lead = mounted.container.querySelector('[data-circuit-wire-preview]')
    expect(lead?.getAttribute('d')).toContain('350.00 160.00')
    expect(runtime.getScene().revision).toBe(snapshot.sceneRevision)
    fireEvent.keyDown(terminal, { key: 'Escape' })
    expect(mounted.container.querySelector('[data-circuit-wire-preview]')).toBeNull()
  })
})
