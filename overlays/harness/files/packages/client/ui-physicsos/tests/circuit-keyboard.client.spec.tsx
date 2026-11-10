// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { addComponent, draftToScene, removeComponent, rotateComponent, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import type { ComponentEditCommand } from '../src/client/physics/renderer-registry.tsx'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

afterEach(cleanup)
function ownerOf(rheostat = false) {
  const draft = rheostat ? addComponent(starterDraft(), 'variable_resistor', { x: 0, y: 4 }).draft : starterDraft()
  const owner = createWorkbenchInstanceRuntime({ scene: draftToScene(draft), source: { kind: 'free-build' },
    buildMode: 'construct', scheduler: null })
  onTestFinished(() => { owner.dispose() })
  return owner
}
function Bench({ owner, edit }: { owner: ReturnType<typeof ownerOf>; edit?: (id: string, command: ComponentEditCommand) => void }) {
  const frame = useSyncExternalStore(owner.frames.subscribe, owner.frames.getSnapshot)
  return <PhysicsCanvas view={frame.view} ariaLabel="apparatus" componentDrag={{ preview: (id, at) => { owner.previewComponentPlacement(id, at) },
    commit: (id, at) => { owner.commitComponentPlacement(id, at) }, cancel: () => { owner.cancelComponentPlacement() } }}
    componentSelection={{ selected: frame.view.highlighted?.[0], select: (id) => { owner.setHighlight([id]) },
      edit: edit ?? ((id, command) => {
        owner.applyDraftEdit(draft => command === 'rotate' ? rotateComponent(draft, id) : removeComponent(draft, id))
        owner.setHighlight(command === 'remove' ? [] : [id])
      }) }} />
}
function partAt(owner: ReturnType<typeof ownerOf>, id = 'r0') { return owner.getSnapshot().draft!.components.find(item => item.id === id)! }
function body(container: HTMLElement, id = 'r0') { return container.querySelector(`[data-component-id="${id}"]`)! }

describe('focused apparatus body keyboard edits', () => {
  it('moves the focused body by the builder grid, selects it and consumes the event', () => {
    const owner = ownerOf()
    owner.setHighlight(['sw'])
    const before = partAt(owner).placement
    const view = render(<Bench owner={owner} />)
    const target = body(view.container)
    const handled = fireEvent.keyDown(target, { key: 'ArrowRight' })
    expect(partAt(owner).placement.x).toBe(before.x + 0.5)
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    expect(handled).toBe(false)
  })

  it('uses a larger shifted grid step without changing a rheostat experiment playhead', () => {
    const owner = ownerOf(true)
    owner.seek(0.5)
    const time = owner.getSnapshot().clock.time
    const before = partAt(owner).placement
    const view = render(<Bench owner={owner} />)
    fireEvent.keyDown(body(view.container), { key: 'ArrowUp', shiftKey: true })
    expect(partAt(owner).placement.y).toBe(before.y + 2)
    expect(owner.getSnapshot().clock.time).toBe(time)
  })

  it('rotates the directly focused body through the same committed edit channel', () => {
    const owner = ownerOf()
    const rotation = partAt(owner).placement.rotation ?? 0
    const view = render(<Bench owner={owner} />)
    fireEvent.keyDown(body(view.container), { key: 'r' })
    expect(partAt(owner).placement.rotation).toBe((rotation + 90) % 360)
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    owner.undo()
    expect(partAt(owner).placement.rotation).toBe(rotation)
  })

  it.each(['Delete', 'Backspace'])('removes only the focused body using %s', (key) => {
    const owner = ownerOf()
    owner.setHighlight(['sw'])
    const view = render(<Bench owner={owner} />)
    fireEvent.keyDown(body(view.container), { key })
    expect(owner.getSnapshot().draft!.components.some(item => item.id === 'r0')).toBe(false)
    expect(owner.getSnapshot().draft!.components.some(item => item.id === 'sw')).toBe(true)
  })

  it('routes Ctrl/Cmd+D for eligible bodies while preventing the browser bookmark command', () => {
    const owner = ownerOf()
    const copy = vi.fn()
    const view = render(<Bench owner={owner} edit={copy} />)
    expect(fireEvent.keyDown(body(view.container), { key: 'd', ctrlKey: true })).toBe(false)
    expect(copy).toHaveBeenLastCalledWith('r0', 'duplicate')
    expect(fireEvent.keyDown(body(view.container, 'bat'), { key: 'd', metaKey: true })).toBe(false)
    expect(copy).toHaveBeenCalledTimes(1)
  })

  it('leaves input descendants, IME and modified arrows untouched', () => {
    const owner = ownerOf()
    const view = render(<Bench owner={owner} />)
    const before = partAt(owner).placement
    const target = body(view.container)
    const input = document.createElement('input')
    target.appendChild(input)
    expect(fireEvent.keyDown(input, { key: 'Delete' })).toBe(true)
    expect(fireEvent.keyDown(target, { key: 'ArrowRight', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(target, { key: 'r', isComposing: true })).toBe(true)
    expect(partAt(owner).placement).toEqual(before)
  })
})
