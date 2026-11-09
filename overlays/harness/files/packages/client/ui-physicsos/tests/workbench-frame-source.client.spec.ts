import { describe, expect, it, vi } from 'vitest'
import { adaptFrameSource, createFrameSource } from '../src/client/physics/frame-source.ts'
import { parseCircuitDraft, parseWorkbenchHistory } from '../src/client/physics/workbench-history-codec.ts'
import { addComponent, draftToScene, removeComponent, starterDraft, synchronizeDraftWithScene, type CircuitDraft } from '../src/client/physics/circuit-builder.ts'
import { asComponentId, asObservableId } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'

describe('React-free workbench frame source', () => {
  it('keeps getSnapshot/get/subscribe references and the snapshot stable until a publish', () => {
    const initial = { time: 0 }
    const source = createFrameSource(initial)
    const getter = source.getSnapshot
    const subscribe = source.subscribe
    expect(source.get).toBe(getter)
    expect(source.getSnapshot()).toBe(initial)
    source.set(initial)
    expect(source.getSnapshot).toBe(getter)
    expect(source.subscribe).toBe(subscribe)
    const next = { time: 1 }
    source.set(next)
    expect(source.getSnapshot()).toBe(next)
  })

  it('contains observer failures and snapshots the callback roster', () => {
    const errors: unknown[] = []
    const source = createFrameSource(0, { onListenerError: error => { errors.push(error) } })
    const seen: number[] = []
    source.subscribe(() => { throw new Error('display disconnected') })
    source.subscribe(() => {
      seen.push(source.get())
      source.subscribe(() => { seen.push(100 + source.get()) })
    })
    source.set(1)
    expect(seen).toEqual([1])
    expect(errors).toHaveLength(1)
    source.set(2)
    expect(seen).toEqual([1, 2, 102])
  })

  it('closes callbacks before disposal and rejects later publications', () => {
    const source = createFrameSource(0)
    const called = vi.fn()
    source.subscribe(() => { source.dispose() })
    source.subscribe(called)
    source.set(1)
    expect(called).not.toHaveBeenCalled()
    source.set(2)
    source.subscribe(called)
    expect(source.get()).toBe(1)
    expect(called).not.toHaveBeenCalled()
  })

  it('adapts bare get sources without disposing the upstream', () => {
    let value = 0
    const callbacks = new Set<() => void>()
    const unsubscribe = vi.fn()
    const upstream = {
      get: () => value,
      set: (next: number) => { value = next; for (const callback of callbacks) callback() },
      subscribe: (callback: () => void) => { callbacks.add(callback); return () => { callbacks.delete(callback); unsubscribe() } },
    }
    const source = adaptFrameSource(upstream)
    const getSnapshot = source.getSnapshot
    upstream.set(2)
    expect(source.get()).toBe(2)
    source.set(3)
    expect(value).toBe(3)
    expect(source.getSnapshot).toBe(getSnapshot)
    source.dispose()
    upstream.set(4)
    expect(source.get()).toBe(3)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps the last frame when an upstream read fails', () => {
    let fail = false
    let callback = () => undefined
    const errors = vi.fn()
    const source = adaptFrameSource({
      getSnapshot: () => { if (fail) throw new Error('not ready'); return 10 },
      subscribe: listener => { callback = listener; return () => undefined },
    }, { onListenerError: errors })
    fail = true
    callback()
    expect(source.get()).toBe(10)
    expect(errors).toHaveBeenCalledOnce()
  })
})

describe('persisted physical authoring state', () => {
  it('round-trips valid disconnected circuit drafts and rejects corrupt facts', () => {
    const initial = starterDraft()
    const restored = parseCircuitDraft(JSON.parse(JSON.stringify(initial)))
    expect(restored).toEqual(initial)
    expect(parseCircuitDraft({ ...initial, nextNet: 1 })).toBeUndefined()
    expect(parseCircuitDraft({ ...initial, extra: true })).toBeUndefined()
    expect(parseCircuitDraft({ ...initial, components: [{ ...initial.components[0], placement: { x: Number.NaN, y: 0, rotation: 0 } }] })).toBeUndefined()
    expect(parseCircuitDraft({ ...initial, components: [{ ...initial.components[0], params: { resistance: 10 } }] })).toBeUndefined()
    expect(parseCircuitDraft({ ...initial, components: [{ ...initial.components[0], params: { voltage: () => 6 } }] })).toBeUndefined()
  })

  it('preserves surviving apparatus metadata and prunes deleted authoring references', () => {
    const current = starterDraft()
    const scene = draftToScene(current, { sceneId: 'authored', revision: 8 })
    const circuit = scene.circuits[0]!
    const resistor = circuit.components.find(component => String(component.id) === 'r0')!
    resistor.enabled = false
    resistor.name = 'student load'
    scene.measurementDefinitions = [
      { id: 'keep', type: 'voltage', targetId: 'bat', componentId: asComponentId('bat'), enabled: true },
      { id: 'drop', type: 'current', targetId: 'r0', componentId: asComponentId('r0'), enabled: true },
    ]
    scene.annotations = [
      { id: 'keep-note', type: 'teacher_note', targetId: 'bat', content: 'source', visible: true },
      { id: 'drop-note', type: 'label', targetId: 'r0', content: 'load', visible: true },
    ]
    const moved: CircuitDraft = { ...current, components: current.components.map(component => component.id === 'r0'
      ? { ...component, placement: { ...component.placement, x: 7 } } : component) }
    const projected = draftToScene(moved, { sceneId: 'authored', revision: 9, baseScene: scene })
    const surviving = projected.circuits[0]!.components.find(component => String(component.id) === 'r0')!
    expect(surviving).toMatchObject({ enabled: false, name: 'student load' })
    const deleted = draftToScene(removeComponent(moved, 'r0'), { sceneId: 'authored', revision: 10, baseScene: projected })
    expect(deleted.measurementDefinitions.map(definition => definition.id)).toEqual(['keep'])
    expect(deleted.annotations.map(annotation => annotation.id)).toEqual(['keep-note'])
    expect(scene.measurementDefinitions).toHaveLength(2)
    expect(scene.annotations).toHaveLength(2)
  })

  it('keeps authored sweep timing and imported observable identity through a structural placement edit', () => {
    const initial = addComponent(starterDraft(), 'variable_resistor').draft
    const scene = draftToScene(initial, { sceneId: 'timed-circuit', revision: 3 })
    scene.timeline.endTime = quantity(30, 's', 'time')
    scene.timeline.simulationTimeStep = quantity(0.2, 's', 'time')
    const current = scene.observableDefinitions.find(definition => definition.type === 'current')!
    current.id = asObservableId('authored-current')
    current.visible = false
    const moved: CircuitDraft = { ...initial, components: initial.components.map(component => component.id === 'bat'
      ? { ...component, placement: { ...component.placement, x: 6 } } : component) }
    const projected = draftToScene(moved, { sceneId: 'timed-circuit', revision: 4, baseScene: scene })
    expect(projected.timeline).toEqual(scene.timeline)
    const currents = projected.observableDefinitions.filter(definition => definition.type === 'current')
    expect(currents).toHaveLength(1)
    expect(currents[0]).toMatchObject({ id: asObservableId('authored-current'), visible: false })
    const runtime = createCircuitWorkspaceRuntime(projected)
    expect(runtime.getSnapshot().view.visible.current).toBe(false)
    runtime.setObservable('current', true)
    expect(runtime.getSnapshot().view.visible.current).toBe(true)
  })

  it('restores the committed frame after rejecting a preview commit', () => {
    const scene = draftToScene(starterDraft())
    const owner = createWorkbenchInstanceRuntime({ scene, source: { kind: 'free-build' }, scheduler: null })
    const original = owner.getScene()
    owner.previewParameter('emf', 12)
    expect(owner.getSnapshot().previewing).toBe(true)
    owner.commitParameter('emf', Number.NaN)
    expect(owner.getSnapshot().previewing).toBe(false)
    expect(owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'emf')?.value).toBe(6)
    expect(owner.getScene()).toEqual(original)
    expect(owner.getSnapshot().history.canUndo).toBe(false)
    expect(owner.captureRaw().result?.sceneRevision).toBe(original.revision)
    owner.dispose()
  })

  it('publishes a diagnostic circuit frame for schema-valid unsupported electrical components', () => {
    const scene = draftToScene(starterDraft())
    scene.circuits[0]!.components.push({ id: asComponentId('c1'), type: 'capacitor', capacitance: quantity(1e-6, 'F', 'capacitance') })
    const runtime = createCircuitWorkspaceRuntime(scene)
    expect(() => runtime.getSnapshot()).not.toThrow()
    expect(runtime.getSnapshot().status).toBe('failed')
    expect(runtime.getSnapshot().error?.code).toBe('CIRCUIT_RUNTIME_FAILED')
    expect(runtime.captureRaw().result).toBeUndefined()
    expect(runtime.captureRaw().diagnostics?.length).toBeGreaterThan(0)
  })

  it('refreshes the actual held operating point when replay starts at the end', () => {
    const scene = draftToScene(addComponent(starterDraft(), 'variable_resistor').draft)
    const runtime = createCircuitWorkspaceRuntime(scene)
    runtime.seek(runtime.getSnapshot().clock.total)
    runtime.setRunning(true)
    expect(runtime.getSnapshot().clock.time).toBe(0)
    expect(runtime.captureRaw().state?.time.value).toBe(0)
  })

  it('keeps a deleted net allocation cursor when an inspector change synchronizes the draft', () => {
    const initial = starterDraft()
    const allocated = addComponent(initial, 'resistor').draft
    const removed = removeComponent(allocated, 'r1')
    expect(removed.nextNet).toBeGreaterThan(initial.nextNet)
    const scene = draftToScene(removed)
    const source = scene.circuits[0]!.components.find(component => component.type === 'voltage_source')!
    if (source.type !== 'voltage_source') throw new Error('source missing')
    source.voltage = { value: 12, unit: 'V', dimension: 'electric_potential' }
    const synchronized = synchronizeDraftWithScene(removed, scene)
    expect(synchronized.nextNet).toBe(removed.nextNet)
    expect(synchronized.components.find(component => component.id === 'bat')?.params.voltage).toBe(12)
    expect(synchronized.components.map(component => component.nets)).toEqual(removed.components.map(component => component.nets))
  })

  it('does not silently wipe an invalid history', () => {
    expect(parseWorkbenchHistory({ past: [], future: [] })).toEqual({ past: [], future: [] })
    expect(parseWorkbenchHistory({ past: [{ id: 'e', label: 'edit', before: {}, after: {} }], future: [] })).toBeUndefined()
    expect(parseWorkbenchHistory({ past: [], future: [], runtime: {} })).toBeUndefined()
  })
})
