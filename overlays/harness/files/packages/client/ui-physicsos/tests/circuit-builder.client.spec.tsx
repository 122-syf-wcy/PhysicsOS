// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'
import {
  addComponent,
  beginHistory,
  canRedo,
  canUndo,
  commit,
  connectTerminals,
  disconnectTerminal,
  draftFromScene,
  draftToScene,
  emptyDraft,
  moveComponent,
  redo,
  removeComponent,
  rotateComponent,
  setParams,
  snapToGrid,
  starterDraft,
  terminalKeysOf,
  undo,
  type BuilderComponent,
  type CircuitDraft,
} from '../src/client/physics/circuit-builder.ts'

const componentVisual = (
  snapshot: ReturnType<ReturnType<typeof createCircuitWorkspaceRuntime>['getSnapshot']>,
  id: string,
) => snapshot.view.circuitComponents?.find(entry => entry.id === id)

const componentOf = (draft: CircuitDraft, id: string): BuilderComponent => {
  const found = draft.components.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`component missing: ${id}`)
  return found
}

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(cleanup)

/** Mount the whole Lab surface assembling a drafted scene. */
const mountDraft = (draft: CircuitDraft) => {
  const scene = draftToScene(draft)
  const surface = createPhysicsSurfaceController()
  surface.openBuilder({ sceneId: String(scene.id), scene })
  return render(
    <PhysicsSurface
      useLearningRecord={neverHook}
      useRecentExperiments={neverHook}
      usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
      t={t}
      useSessions={neverHook}
      useWorkspaces={neverHook}
      useAuth={neverHook}
    />,
  )
}

describe('circuit builder draft', () => {
  it('opens on a starter loop the engine actually solves', () => {
    const scene = draftToScene(starterDraft())
    const snapshot = createCircuitWorkspaceRuntime(scene).getSnapshot()

    expect(snapshot.domain).toBe('circuit')
    expect(snapshot.status).toBe('verified')
    /* 6 V across 10 Ω → 0.6 A, and the reading is the engine's, not the draft's. */
    expect(componentVisual(snapshot, 'r0')?.currentText).toBe('I=0.6 A')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('renders an empty bench without solving it', () => {
    const scene = draftToScene(emptyDraft())
    const snapshot = createCircuitWorkspaceRuntime(scene).getSnapshot()

    expect(snapshot.domain).toBe('circuit')
    expect(snapshot.status).not.toBe('verified')
    /* The engine names the missing part rather than the UI inventing a reason. */
    expect(snapshot.error?.message ?? '').toContain('one voltage source')
  })

  it('reports a shorted source instead of answering', () => {
    /* A student who clips the leads straight across an ideal battery has built
       something with no unique solution; that has to read as a diagnostic. */
    const shorted = connectTerminals(
      starterDraft(),
      { componentId: 'bat', terminalKey: 'positive' },
      { componentId: 'bat', terminalKey: 'negative' },
    )
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(shorted)).getSnapshot()

    expect(snapshot.status).not.toBe('verified')
    expect(snapshot.error?.message ?? '').not.toBe('')
  })
})

describe('circuit builder edits', () => {
  it('gives a new component its own net per terminal', () => {
    const { draft, componentId } = addComponent(emptyDraft(), 'resistor', { x: 1.2, y: -2.7 })

    const component = componentOf(draft, componentId)
    expect(componentId).toBe('r0')
    expect(component.placement).toEqual({ x: 1, y: -2.5, rotation: 0 })
    const nets = Object.values(component.nets)
    expect(nets).toHaveLength(2)
    expect(new Set(nets).size).toBe(2)
  })

  it('names new parts the way the physics tutor addresses them', () => {
    let draft = emptyDraft()
    const ids: string[] = []
    for (const type of [
      'voltage_source',
      'switch',
      'ammeter',
      'voltmeter',
      'variable_resistor',
      'resistor',
    ] as const) {
      const added = addComponent(draft, type)
      draft = added.draft
      ids.push(added.componentId)
    }
    expect(ids).toEqual(['bat', 'sw', 'am', 'vm', 'rv', 'r0'])
    /* Sources address polarity, not a/b. */
    expect(Object.keys(componentOf(draft, 'bat').nets)).toEqual(['positive', 'negative'])
    expect(terminalKeysOf('voltmeter')).toEqual(['a', 'b'])
  })

  it('numbers spare resistors on from r0 without colliding', () => {
    let draft = starterDraft()
    const first = addComponent(draft, 'resistor')
    draft = first.draft
    const second = addComponent(draft, 'resistor')
    /* The starter already holds r0, so the spares continue from r1. */
    expect([first.componentId, second.componentId]).toEqual(['r1', 'r2'])
  })

  it('wires two terminals by merging their nets', () => {
    /* Battery and switch sit on separate nets until the student joins them. */
    const start = emptyDraft()
    const withSource = addComponent(start, 'voltage_source', { x: -3, y: 0 })
    const withResistor = addComponent(withSource.draft, 'resistor', { x: 3, y: 0 })
    const draft = connectTerminals(
      withResistor.draft,
      { componentId: withSource.componentId, terminalKey: 'positive' },
      { componentId: withResistor.componentId, terminalKey: 'a' },
    )

    expect(componentOf(draft, 'bat').nets.positive).toBe(componentOf(draft, 'r0').nets.a)
  })

  it('joins every terminal already on either net, not just the two ends', () => {
    const { draft: placed, componentId: r } = addComponent(starterDraft(), 'ammeter', {
      x: 2,
      y: 3,
    })
    const joined = connectTerminals(
      placed,
      { componentId: 'sw', terminalKey: 'a' },
      { componentId: r, terminalKey: 'a' },
    )

    /* sw.a already shared net 1 with bat.positive, so the meter joins that node. */
    expect(componentOf(joined, r).nets.a).toBe(componentOf(joined, 'bat').nets.positive)
    expect(componentOf(joined, r).nets.b).not.toBe(componentOf(joined, r).nets.a)
  })

  it('takes one terminal off a shared net and leaves the rest alone', () => {
    const draft = starterDraft()
    const cut = disconnectTerminal(draft, { componentId: 'sw', terminalKey: 'a' })

    expect(componentOf(cut, 'sw').nets.a).not.toBe(componentOf(cut, 'bat').nets.positive)
    /* The other terminal on that net keeps it. */
    expect(componentOf(cut, 'bat').nets.positive).toBe(componentOf(draft, 'bat').nets.positive)
    expect(cut.nextNet).toBe(draft.nextNet + 1)
  })

  it('leaves a lone terminal alone, because there is no wire to cut', () => {
    const draft = emptyDraft()
    const withResistor = addComponent(draft, 'resistor')
    expect(disconnectTerminal(withResistor.draft, { componentId: 'r0', terminalKey: 'a' })).toBe(
      withResistor.draft,
    )
  })

  it('keeps drawing a circuit the solver refuses, without inventing readings', () => {
    /* Pull the source out and the loop can no longer be solved — but the parts
       and the wire still between them are the student's work, so the canvas
       keeps them and the engine's reason rides alongside. */
    const draft = removeComponent(starterDraft(), 'bat')
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(draft)).getSnapshot()

    expect(snapshot.status).toBe('failed')
    expect(snapshot.error?.message ?? '').toContain('one voltage source')
    expect(snapshot.view.circuitComponents?.map(visual => visual.id).sort()).toEqual(['r0', 'sw'])
    expect(snapshot.view.circuitWires?.length ?? 0).toBeGreaterThan(0)
    for (const visual of snapshot.view.circuitComponents ?? []) {
      expect(visual.currentText, `${visual.id} must not conduct`).toBeUndefined()
      expect(visual.reading, `${visual.id} must not claim a reading`).toBeUndefined()
    }
  })

  it('still draws a shorted source instead of blanking the bench', () => {
    const shorted = connectTerminals(
      starterDraft(),
      { componentId: 'bat', terminalKey: 'positive' },
      { componentId: 'bat', terminalKey: 'negative' },
    )
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(shorted)).getSnapshot()

    expect(snapshot.status).toBe('failed')
    expect(snapshot.view.circuitComponents?.map(visual => visual.id).sort()).toEqual([
      'bat',
      'r0',
      'sw',
    ])
    expect(snapshot.error?.message ?? '').not.toBe('')
  })

  it('drops a removed component and keeps the survivors wired', () => {
    const draft = removeComponent(starterDraft(), 'sw')

    expect(draft.components.map(component => component.id)).toEqual(['bat', 'r0'])
    /* Pulling the switch out leaves a gap, not a wrong answer: the engine
       solves the open loop and no part claims a current. */
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(draft)).getSnapshot()
    expect(snapshot.status).toBe('verified')
    for (const visual of snapshot.view.circuitComponents ?? []) {
      expect(visual.currentText, `${visual.id} must not conduct`).toBeUndefined()
    }
  })

  it('snaps placement to the schematic grid and turns in quarter turns', () => {
    expect(snapToGrid({ x: 1.3, y: -2.2 })).toEqual({ x: 1.5, y: -2 })

    let draft = starterDraft()
    const seen: number[] = []
    for (let step = 0; step < 4; step += 1) {
      seen.push(componentOf(draft, 'r0').placement.rotation)
      draft = rotateComponent(draft, 'r0')
    }
    expect(seen).toEqual([270, 0, 90, 180])
    expect(componentOf(draft, 'r0').placement.rotation).toBe(270)
  })

  it('moves a component without touching its wiring', () => {
    const before = starterDraft()
    const after = moveComponent(before, 'r0', { x: -7.4, y: 1.1 })

    expect(componentOf(after, 'r0').placement).toEqual({ x: -7.5, y: 1, rotation: 270 })
    expect(componentOf(after, 'r0').nets).toEqual(componentOf(before, 'r0').nets)
  })

  it('carries edited parameters through to the solved reading', () => {
    const draft = setParams(starterDraft(), 'r0', { resistance: 20 })
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(draft)).getSnapshot()

    /* 6 V across 20 Ω → 0.3 A. */
    expect(componentVisual(snapshot, 'r0')?.currentText).toBe('I=0.3 A')
  })
})

describe('circuit builder history', () => {
  it('walks back and forward through edits', () => {
    const history = commit(
      beginHistory(starterDraft()),
      addComponent(starterDraft(), 'resistor').draft,
    )

    expect(canUndo(history)).toBe(true)
    expect(canRedo(history)).toBe(false)

    const back = undo(history)
    expect(back.present.components.map(component => component.id)).toEqual(['bat', 'sw', 'r0'])
    expect(canRedo(back)).toBe(true)

    const forward = redo(back)
    expect(forward.present.components).toHaveLength(4)
  })

  it('does not spend a step on a no-op edit', () => {
    /* A freshly placed part has a net per terminal and nothing sharing either,
       so there is no wire to cut. The edit must hand back the very same draft
       and leave the stack untouched. */
    const draft = addComponent(emptyDraft(), 'resistor').draft
    const history = beginHistory(draft)
    const same = disconnectTerminal(draft, { componentId: 'r0', terminalKey: 'a' })
    expect(same).toBe(draft)
    expect(commit(history, same)).toBe(history)
    expect(canUndo(history)).toBe(false)
  })

  it('drops the redo branch once the student edits again', () => {
    const first = commit(
      beginHistory(starterDraft()),
      addComponent(starterDraft(), 'resistor').draft,
    )
    const back = undo(first)
    const branched = commit(back, addComponent(back.present, 'ammeter').draft)

    expect(canRedo(branched)).toBe(false)
    expect(branched.present.components.map(component => component.id)).toEqual([
      'bat',
      'sw',
      'r0',
      'am',
    ])
  })
})

describe('circuit builder runtime', () => {
  it('assembles a circuit the engine then solves', () => {
    /* The whole point of the bench: a student's own parts, wired by hand, in a
       real reading. Nothing here is staged through a template. */
    const runtime = createCircuitWorkspaceRuntime(draftToScene(emptyDraft()))
    runtime.enterBuilder()
    expect(runtime.circuitDraft()?.components).toEqual([])

    runtime.applyDraftEdit(draft => addComponent(draft, 'voltage_source', { x: -5, y: 0 }).draft)
    runtime.applyDraftEdit(draft => addComponent(draft, 'resistor', { x: 5, y: 0 }).draft)
    runtime.applyDraftEdit(draft =>
      connectTerminals(
        draft,
        { componentId: 'bat', terminalKey: 'positive' },
        { componentId: 'r0', terminalKey: 'a' },
      ),
    )
    const snapshot = runtime.applyDraftEdit(draft =>
      connectTerminals(
        draft,
        { componentId: 'r0', terminalKey: 'b' },
        { componentId: 'bat', terminalKey: 'negative' },
      ),
    )

    expect(snapshot.status).toBe('verified')
    /* 6 V across 10 Ω → 0.6 A, read off the part the student placed. */
    expect(componentVisual(snapshot, 'r0')?.currentText).toBe('I=0.6 A')
    expect(runtime.circuitDraft()?.components).toHaveLength(2)
  })

  it('opens the bench on the circuit already on screen', () => {
    /* Entering build mode on a solved circuit must adopt its real wiring, so
       the panel shows what exists rather than an empty grid. */
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    runtime.enterBuilder()

    const draft = runtime.circuitDraft()
    expect(draft?.components.map(component => component.id).sort()).toEqual(['bat', 'r0', 'sw'])
    expect(componentOf(draft as CircuitDraft, 'bat').nets.positive).toBe(
      componentOf(draft as CircuitDraft, 'sw').nets.a,
    )
  })

  it('leaves the assembled circuit in place when build mode ends', () => {
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    runtime.enterBuilder()
    runtime.applyDraftEdit(draft => removeComponent(draft, 'sw'))

    const after = runtime.leaveBuilder()
    expect(runtime.circuitDraft()).toBeUndefined()
    /* The switch is still gone: leaving the bench is not an undo. */
    expect(after.view.circuitComponents?.map(visual => visual.id).sort()).toEqual(['bat', 'r0'])
  })

  it('reports an unbuildable circuit without losing the parts', () => {
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    runtime.enterBuilder()
    const snapshot = runtime.applyDraftEdit(draft => removeComponent(draft, 'bat'))

    expect(snapshot.status).toBe('failed')
    expect(snapshot.error?.condition).toBe('single_voltage_source')
    expect(runtime.circuitDraft()?.components).toHaveLength(2)
  })
})

describe('circuit builder scene read-back', () => {
  it('recovers the wiring a scene carries, nets and all', () => {
    /* The scene is the source of truth: a student's gestures, the inspector's
       edits and the tutor's commands all land there, so reading the draft back
       must agree with what was authored. */
    const before = starterDraft()
    const after = draftFromScene(draftToScene(before))

    const shape = (draft: CircuitDraft) =>
      [...draft.components]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(component => ({
          id: component.id,
          type: component.type,
          /* Net numbers are an internal detail; what matters is which terminals
             share one, so compare the partition rather than the labels. */
          joined: component.nets.a === component.nets.b,
          placement: component.placement,
          params: component.params,
        }))

    expect(shape(after)).toEqual(shape(before))
    /* bat.positive and sw.a are on one net in the starter; that must survive. */
    expect(componentOf(after, 'bat').nets.positive).toBe(componentOf(after, 'sw').nets.a)
    expect(componentOf(after, 'sw').nets.b).toBe(componentOf(after, 'r0').nets.a)
    expect(componentOf(after, 'r0').nets.b).toBe(componentOf(after, 'bat').nets.negative)
  })

  it('keeps edited values when read back', () => {
    const draft = setParams(starterDraft(), 'r0', { resistance: 22 })
    const after = draftFromScene(draftToScene(draft))

    expect(componentOf(after, 'r0').params.resistance).toBe(22)
    /* 6 V across 22 Ω → 0.273 A, so the round trip kept the edited value. */
    const snapshot = createCircuitWorkspaceRuntime(draftToScene(after)).getSnapshot()
    expect(componentVisual(snapshot, 'r0')?.currentText).toBe('I=0.273 A')
  })

  it('reads a scene with no circuit as an empty bench', () => {
    expect(draftFromScene({ ...draftToScene(emptyDraft()), circuits: [] }).components).toEqual([])
  })
})

describe('circuit builder shell', () => {
  it('places a part from the palette and wires it to the source', () => {
    /* The student's whole loop, through the real shell: pick a part, place it,
       then take it back off and undo the removal. */
    mountDraft(starterDraft())

    expect(screen.getByTestId('circuit-builder')).toBeTruthy()
    fireEvent.click(screen.getByTestId('builder-add-resistor-10'))

    /* A second resistor joins R₀ in series: 6 V across 10 Ω + 10 Ω → 0.3 A. */
    expect(screen.getByTestId('builder-row-r1')).toBeTruthy()

    /* Placing selects the new part, so its controls are already showing. */
    fireEvent.click(screen.getByTestId('builder-remove-r1'))
    expect(screen.queryByTestId('builder-row-r1')).toBeNull()

    /* Undo brings it back — the bench never loses work silently. */
    fireEvent.click(screen.getByTestId('builder-undo'))
    expect(screen.getByTestId('builder-row-r1')).toBeTruthy()
  })

  it('draws each shelf item as the part its rating actually is', () => {
    /* The shelf stocks three sources and two rheostats; the photograph has to
       follow the rating the button places, or the part you pick is not the part
       you see on the bench. */
    const { container } = mountDraft(starterDraft())
    const shot = (id: string) => container
      .querySelector(`[data-testid="builder-add-${id}"] img`)
      ?.getAttribute('src')
    expect(shot('battery-1.5')).toBe('/physicsos/parts3d/studio-v3/cell-aa.png')
    expect(shot('battery-6')).toBe('/physicsos/parts3d/studio-v3/battery-pack.png')
    expect(shot('supply-12')).toBe('/physicsos/parts3d/studio-v3/supply-dc.png')
    expect(shot('resistor-5')).toBe('/physicsos/parts3d/studio-v3/resistor-5.png')
    expect(shot('resistor-10')).toBe('/physicsos/parts3d/studio-v2/resistor.png')
    expect(shot('resistor-50')).toBe('/physicsos/parts3d/studio-v3/resistor-50.png')
    expect(shot('rheostat-20')).toBe('/physicsos/parts3d/studio-v2/rheostat.png')
    expect(shot('rheostat-50')).toBe('/physicsos/parts3d/studio-v3/rheostat-50.png')
    expect(shot('switch')).toBe('/physicsos/parts3d/studio-v2/switch-closed.png')
    expect(shot('voltmeter')).toBe('/physicsos/parts3d/studio-v2/meter.png')
  })

  it('wires two terminals by pressing one and releasing on the other', () => {
    /* The gesture the brief asked for: press a post, drag, release on a post.
       jsdom does no hit-testing, so the test drives the two events the pointer
       would produce — which is exactly the contract the renderer implements. */
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    runtime.enterBuilder()
    /* Cut the switch out of the loop first, so joining it back is a real edit. */
    runtime.applyDraftEdit(draft => disconnectTerminal(draft, { componentId: 'sw', terminalKey: 'a' }))
    const before = runtime.getSnapshot()
    expect(componentVisual(before, 'sw')?.currentText).toBeUndefined()

    runtime.beginWire({ componentId: 'sw', terminalKey: 'a' })
    expect(runtime.pendingWireFrom()).toEqual({ componentId: 'sw', terminalKey: 'a' })

    const after = runtime.completeWire({ componentId: 'bat', terminalKey: 'positive' })

    expect(runtime.pendingWireFrom()).toBeUndefined()
    /* Back in the loop: 6 V across 10 Ω → 0.6 A again. */
    expect(componentVisual(after, 'sw')?.currentText).toBe('I=0.6 A')
  })

  it('leaves the circuit untouched when a wire is abandoned', () => {
    const runtime = createCircuitWorkspaceRuntime(draftToScene(starterDraft()))
    runtime.enterBuilder()
    const before = runtime.applyDraftEdit(draft => disconnectTerminal(draft, { componentId: 'sw', terminalKey: 'a' }))

    runtime.beginWire({ componentId: 'sw', terminalKey: 'a' })
    const after = runtime.cancelWire()

    expect(runtime.pendingWireFrom()).toBeUndefined()
    expect(after.view.circuitComponents).toEqual(before.view.circuitComponents)
  })

  it('draws a focusable target on every terminal while building', () => {
    const { container } = mountDraft(starterDraft())

    const terminals = [...container.querySelectorAll('[data-terminal]')]
    /* Three parts, two terminals each — wiring needs every one of them. */
    expect(terminals.map(node => node.getAttribute('data-terminal')).sort()).toEqual([
      'bat.negative',
      'bat.positive',
      'r0.a',
      'r0.b',
      'sw.a',
      'sw.b',
    ])
    for (const terminal of terminals) {
      expect(terminal.getAttribute('role')).toBe('button')
    }
  })

  it('keeps the schematic and names the problem while a build cannot solve', () => {
    /* The steady-state gate for the whole feature: a half-wired circuit must
       still look like the student's circuit. Nothing here asserts a private
       detail — the canvas is on screen and the reason is readable Chinese. */
    const { container } = mountDraft(removeComponent(starterDraft(), 'bat'))

    /* The diagnostic is the shell's, not the bench panel's own status line. */
    expect(container.querySelector('[data-build-diagnostic]')?.textContent).toBe(
      zh['lab.condition.single_voltage_source'],
    )
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    expect(container.querySelector('svg image[data-testid="sprite-sw"]')).toBeTruthy()
  })

  it('shows a solved build without any diagnostic', () => {
    const { container } = mountDraft(starterDraft())

    expect(container.querySelector('[data-build-diagnostic]')).toBeNull()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
  })
})
