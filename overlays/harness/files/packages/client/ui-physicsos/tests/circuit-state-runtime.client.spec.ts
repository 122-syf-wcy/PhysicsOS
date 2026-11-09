import { describe, expect, it, onTestFinished } from 'vitest'
import { addPart, BUILDER_PARTS, draftToScene, setParams, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

function bench() {
  const owner = createWorkbenchInstanceRuntime({ scene: draftToScene(starterDraft()), source: { kind: 'free-build' },
    buildMode: 'construct', scheduler: null })
  onTestFinished(() => { owner.dispose() })
  return owner
}

describe('circuit editing state transitions', () => {
  it('preserves a surviving selected apparatus across undo, redo and subsequent parameter edits', () => {
    const owner = bench()
    owner.setHighlight(['r0'])
    owner.setComponentParams('r0', { resistance: 20 })
    owner.undo()
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    owner.setComponentParams('r0', { resistance: 30 })
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
    expect(owner.getSnapshot().draft!.components.find(item => item.id === 'r0')!.params.resistance).toBe(30)
    owner.undo()
    owner.redo()
    expect(owner.getSnapshot().workspace.view.highlighted).toEqual(['r0'])
  })

  it('clears selection when undo removes the selected apparatus', () => {
    const owner = bench()
    const part = BUILDER_PARTS.find(item => item.id === 'resistor-10')!
    owner.applyDraftEdit(draft => addPart(draft, part, { x: 0, y: 4 }).draft)
    owner.setHighlight(['r1'])
    owner.undo()
    expect(owner.getSnapshot().draft!.components.some(item => item.id === 'r1')).toBe(false)
    expect(owner.getSnapshot().workspace.view.highlighted ?? []).toEqual([])
  })

  it('clears an old draft rejection when a valid unchanged rating is accepted without a physical edit', () => {
    const owner = bench()
    const revision = owner.getSnapshot().instanceEditRevision
    const invalid = owner.applyDraftEdit(draft => setParams(draft, 'r0', { resistance: -1 }))
    expect(invalid.diagnostics.some(item => item.code === 'INVALID_DRAFT')).toBe(true)
    const accepted = owner.applyDraftEdit(draft => setParams(draft, 'r0', { resistance: 10 }))
    expect(accepted.diagnostics).toEqual([])
    expect(accepted.instanceEditRevision).toBe(revision)
    expect(accepted.workspace.view.overlay.readout).toContain('I = 0.6 A')
  })

  it('ignores delayed wiring actions after leaving construction', () => {
    const owner = bench()
    owner.beginWire({ componentId: 'r0', terminalKey: 'a' })
    owner.leaveBuilder()
    const revision = owner.getSnapshot().instanceEditRevision
    owner.beginWire({ componentId: 'r0', terminalKey: 'a' })
    expect(owner.getSnapshot().pendingWire).toBeUndefined()
    owner.completeWire({ componentId: 'sw', terminalKey: 'a' })
    expect(owner.getSnapshot().buildMode).toBe('inspect')
    expect(owner.getSnapshot().instanceEditRevision).toBe(revision)
    owner.enterBuilder()
    owner.beginWire({ componentId: 'r0', terminalKey: 'a' })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'r0', terminalKey: 'a' })
  })
})
