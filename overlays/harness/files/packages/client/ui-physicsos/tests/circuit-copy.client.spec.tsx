// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { CircuitBuilderPanel, type BuilderEditing } from '../src/client/physics/CircuitBuilderPanel.tsx'
import * as builderParts from '../src/client/physics/circuit-part-drag.ts'
import { addComponent, draftFromScene, draftToScene, starterDraft } from '../src/client/physics/circuit-builder.ts'
import type { BuilderComponentType, BuilderParams, CircuitDraft } from '../src/client/physics/circuit-builder.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

type Duplicate = (draft: CircuitDraft, id: string) => { draft: CircuitDraft; componentId: string } | undefined
const duplicate = (draft: CircuitDraft, id: string) => {
  const operation = Reflect.get(builderParts, 'duplicateBuilderComponent') as Duplicate | undefined
  return operation?.(draft, id)
}
const t = (key: keyof typeof zh): string => zh[key]
afterEach(cleanup)

const specimens = [
  { type: 'resistor', params: { resistance: 37.5 } },
  { type: 'switch', params: { state: 'open' } },
  { type: 'variable_resistor', params: { totalResistance: 73, sliderPosition: 0.25 } },
  { type: 'ammeter', params: { internalResistance: 0.2 } },
  { type: 'voltmeter', params: { internalResistance: 5000 } },
] satisfies readonly { type: Exclude<BuilderComponentType, 'voltage_source'>; params: BuilderParams }[]

describe('copy one apparatus within its circuit', () => {
  it.each(specimens)('preserves the $type rating and rotation while allocating isolated terminals', ({ type, params }) => {
    const placed = addComponent(starterDraft(), type, { x: 8, y: -4 }, params)
    const draft: CircuitDraft = { ...placed.draft, components: placed.draft.components.map(component =>
      component.id === placed.componentId ? { ...component, placement: { ...component.placement, rotation: 180 } } : component) }
    const before = JSON.stringify(draft)
    const result = duplicate(draft, placed.componentId)
    expect(result).toBeDefined()
    const copied = result!.draft.components.find(component => component.id === result!.componentId)!
    expect(copied.id).not.toBe(placed.componentId)
    expect(draft.components.some(component => component.id === copied.id)).toBe(false)
    expect(copied.type).toBe(type)
    expect(copied.params).toEqual(params)
    expect(copied.params).not.toBe(draft.components.find(component => component.id === placed.componentId)!.params)
    expect(copied.placement.rotation).toBe(180)
    expect(copied.placement).not.toMatchObject({ x: 8, y: -4 })
    const oldNets = new Set(draft.components.flatMap(component => Object.values(component.nets)))
    const newNets = Object.values(copied.nets)
    expect(new Set(newNets).size).toBe(2)
    expect(newNets.every(net => !oldNets.has(net))).toBe(true)
    expect(result!.draft.components.slice(0, -1)).toEqual(draft.components)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('does not copy a source or an apparatus that no longer exists', () => {
    const draft = starterDraft()
    const before = JSON.stringify(draft)
    expect(duplicate(draft, 'bat')).toBeUndefined()
    expect(duplicate(draft, 'missing')).toBeUndefined()
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('owns one undo entry and preserves the copied apparatus through redo and scene roundtrip', () => {
    const owner = ownerOf()
    const original = owner.serialize()
    const result = duplicate(original.draft!, 'r0')
    expect(result).toBeDefined()
    owner.applyDraftEdit(() => result!.draft)
    expect(owner.serialize().draft!.components).toHaveLength(4)
    expect(owner.serialize().history.past).toHaveLength(original.history.past.length + 1)
    const copy = owner.serialize().draft!.components.find(component => component.id === result!.componentId)!
    expect(copy.placement.rotation).toBe(270)
    owner.undo()
    expect(owner.serialize().draft!.components).toEqual(original.draft!.components)
    owner.redo()
    const restored = owner.serialize().draft!
    expect(restored.components.find(component => component.id === copy.id)).toEqual(copy)
    const roundtrip = draftFromScene(draftToScene(restored))
    const recovered = roundtrip.components.find(component => component.id === copy.id)!
    expect(recovered).toMatchObject({ id: copy.id, params: copy.params, placement: copy.placement })
    const otherNets = new Set(roundtrip.components.filter(component => component.id !== copy.id)
      .flatMap(component => Object.values(component.nets)))
    expect(Object.values(recovered.nets).every(net => !otherNets.has(net))).toBe(true)
  })
})

function ownerOf(selected = 'r0') {
  const owner = createWorkbenchInstanceRuntime({ scene: draftToScene(starterDraft()),
    source: { kind: 'free-build' }, buildMode: 'construct', scheduler: null })
  owner.setHighlight([selected])
  onTestFinished(() => { owner.dispose() })
  return owner
}

function CopyPanel({ owner, apply }: { owner: ReturnType<typeof ownerOf>; apply?: BuilderEditing['apply'] }) {
  const summary = useSyncExternalStore(owner.summaries.subscribe, owner.summaries.getSnapshot)
  return <CircuitBuilderPanel t={t} draft={summary.draft!} selectedComponentId={summary.workspace.view.highlighted?.[0]}
    onSelectComponent={(id) => { owner.setHighlight(id === undefined ? [] : [id]) }}
    editing={{ apply: apply ?? ((edit) => { owner.applyDraftEdit(edit) }),
      undo: () => { owner.undo() }, redo: () => { owner.redo() }, canUndo: summary.history.canUndo, canRedo: summary.history.canRedo }}
    solvable variant="compact" />
}

describe('copy apparatus controls', () => {
  it('selects the new apparatus after an asynchronous copy settles', async () => {
    const owner = ownerOf()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const apply: BuilderEditing['apply'] = edit => gate.then(() => { owner.applyDraftEdit(edit) })
    render(<CopyPanel owner={owner} apply={apply} />)
    const button = screen.getByTestId('builder-copy-r0') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(owner.serialize().draft!.components).toHaveLength(3)
    expect(screen.getByTestId('builder-inspector-r0')).toBeTruthy()
    await act(async () => { release?.(); await gate })
    expect(owner.serialize().draft!.components).toHaveLength(4)
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r1'])
    expect(await screen.findByTestId('builder-inspector-r1')).toBeTruthy()
    expect(screen.queryByTestId('builder-inspector-r0')).toBeNull()
  })

  it('keeps the original selection when a prepared copy is rejected', async () => {
    const owner = ownerOf()
    const original = owner.serialize()
    let reject: (() => void) | undefined
    const pending = new Promise<void>((_resolve, failure) => { reject = () => { failure(new Error('Copy was not accepted.')) } })
    const apply: BuilderEditing['apply'] = (edit) => {
      edit(owner.serialize().draft!)
      return pending
    }
    render(<CopyPanel owner={owner} apply={apply} />)
    fireEvent.click(screen.getByTestId('builder-copy-r0'))
    await act(async () => { reject?.(); await pending.catch(() => {}) })
    expect(owner.serialize().draft!.components).toEqual(original.draft!.components)
    expect(owner.serialize().history.past).toEqual(original.history.past)
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    expect(screen.getByTestId('builder-inspector-r0')).toBeTruthy()
    expect(screen.queryByTestId('builder-inspector-r1')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(t('lab.builder.editFailed'))
  })

  it('preserves a newer controlled selection when a committed copy acknowledges late', async () => {
    const owner = ownerOf()
    let release: (() => void) | undefined
    const acknowledged = new Promise<void>(resolve => { release = resolve })
    const apply: BuilderEditing['apply'] = edit => {
      owner.applyDraftEdit(edit)
      return acknowledged
    }
    render(<CopyPanel owner={owner} apply={apply} />)
    fireEvent.click(screen.getByTestId('builder-copy-r0'))
    expect(owner.serialize().draft!.components).toHaveLength(4)
    act(() => { owner.setHighlight(['sw']) })
    await act(async () => { release?.(); await acknowledged })
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['sw'])
    expect(screen.getByTestId('builder-inspector-sw')).toBeTruthy()
    expect(screen.queryByTestId('builder-inspector-r1')).toBeNull()
    expect(owner.serialize().history.past).toHaveLength(1)
  })

  it('does not select an already undone copy when its acknowledgement arrives', async () => {
    const owner = ownerOf()
    const before = owner.serialize()
    let release: (() => void) | undefined
    const acknowledged = new Promise<void>(resolve => { release = resolve })
    const apply: BuilderEditing['apply'] = edit => {
      owner.applyDraftEdit(edit)
      return acknowledged
    }
    render(<CopyPanel owner={owner} apply={apply} />)
    fireEvent.click(screen.getByTestId('builder-copy-r0'))
    expect(owner.serialize().draft!.components).toHaveLength(4)
    act(() => { owner.undo() })
    await act(async () => { release?.(); await acknowledged })
    expect(owner.serialize().draft).toEqual(before.draft)
    expect(owner.serialize().history.past).toEqual(before.history.past)
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    expect(screen.getByTestId('builder-inspector-r0')).toBeTruthy()
    expect(screen.queryByTestId('builder-inspector-r1')).toBeNull()
  })

  it('disables source copying without introducing a second supply', () => {
    const owner = ownerOf('bat')
    render(<CopyPanel owner={owner} />)
    const button = screen.getByTestId('builder-copy-bat') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(owner.serialize().draft!.components.filter(component => component.type === 'voltage_source')).toHaveLength(1)
    expect(owner.serialize().draft!.components).toHaveLength(3)
    expect(owner.serialize().history.past).toHaveLength(0)
  })
})
