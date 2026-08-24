// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createParallelPlateScene, createElectricScene, createPointChargeScene } from '@physicsos/physics-scene'

import { createElectricWorkspaceRuntime } from '../src/client/physics/electric-workspace-runtime.ts'
import { TimelineMarkers } from '../src/client/workspace-parts.tsx'

afterEach(cleanup)

/* Parallel-plate (bounded field) scene: an electron enters from the left of a
   parallel-plate capacitor and is deflected by the field between the plates.
   The default factory values are a textbook setup: particle starts at
   x = -0.08 m, field region centred at origin with plate length 0.12 m and
   separation 0.04 m. */
const parallelPlateScene = () =>
  createParallelPlateScene({
    sceneId: 'scene-parallel-plate-region',
    title: '平行板电场中的带电粒子',
  })

/* A uniform (unbounded) field scene: should NOT produce region events. */
const uniformFieldScene = () =>
  createElectricScene({
    sceneId: 'scene-electric-uniform',
    charge: 2,
    mass: 4,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 3, y: 0, z: 0 },
    electricFieldStrength: 6,
    electricFieldDirection: 'up',
    duration: 2,
    title: '匀强电场中的带电粒子',
  })

/* A point-charge scene: should NOT produce region events. */
const pointChargeScene = () =>
  createPointChargeScene({
    sceneId: 'scene-point-charge-region-test',
    charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
    probe: { id: 'probe-1', charge: 2e-6, mass: 1, position: { x: 0.2, y: 0, z: 0 } },
    title: '点电荷的电场',
  })

describe('ElectricWorkspaceRuntime — parallel-plate region branch', () => {
  it('routes a parallel-plate scene to the Electric Region Engine and produces events', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    /* The runtime must not fail on a valid parallel-plate scene. */
    expect(snapshot.status).not.toBe('failed')
    expect(snapshot.error).toBeUndefined()

    /* The simulation should produce at least one event (EnterField, and either
       ExitField or HitPlate). */
    expect(snapshot.events.length).toBeGreaterThan(0)

    /* Event kinds must be from the region vocabulary. */
    const validKinds = new Set(['enter', 'exit', 'plate-impact'])
    for (const event of snapshot.events) {
      expect(validKinds.has(event.kind)).toBe(true)
    }
  })

  it('produces an EnterField event with a time within [0, duration]', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()
    const total = snapshot.clock.total

    expect(total).toBeGreaterThan(0)

    const enterEvent = snapshot.events.find(event => event.kind === 'enter')
    expect(enterEvent).toBeDefined()
    expect(enterEvent!.time).toBeGreaterThanOrEqual(0)
    expect(enterEvent!.time).toBeLessThanOrEqual(total)
    expect(enterEvent!.label).toBe('进入电场')
  })

  it('produces either an ExitField or a HitPlate event after EnterField', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()
    const total = snapshot.clock.total

    const enterEvent = snapshot.events.find(event => event.kind === 'enter')
    expect(enterEvent).toBeDefined()

    const afterEvents = snapshot.events.filter(event => event.time > enterEvent!.time)
    expect(afterEvents.length).toBeGreaterThanOrEqual(1)

    /* Each subsequent event must also be within [0, total]. */
    for (const event of afterEvents) {
      expect(event.time).toBeGreaterThanOrEqual(0)
      expect(event.time).toBeLessThanOrEqual(total)
    }
  })

  it('events are ordered by time', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    for (let i = 1; i < snapshot.events.length; i++) {
      expect(snapshot.events[i]!.time).toBeGreaterThanOrEqual(snapshot.events[i - 1]!.time)
    }
  })

  it('event ids are deterministic', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()
    const ids = snapshot.events.map(event => event.id)

    /* At least the enter-field event should have a deterministic id. */
    expect(ids).toContain('event-enter-field')
    /* Exit or hit events should have the expected prefix. */
    const tail = ids.filter(id => id.startsWith('event-exit-field') || id.startsWith('event-hit-plate-'))
    expect(tail.length).toBeGreaterThan(0)
  })

  it('does NOT produce region events for a uniform (unbounded) field scene', () => {
    const runtime = createElectricWorkspaceRuntime(uniformFieldScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).not.toBe('failed')
    /* Uniform field scenes have no region events. */
    expect(snapshot.events).toEqual([])
  })

  it('does NOT produce region events for a point-charge scene', () => {
    const runtime = createElectricWorkspaceRuntime(pointChargeScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).not.toBe('failed')
    /* Point-charge scenes are static; no region events. */
    expect(snapshot.events).toEqual([])
  })

  it('produces trajectory data for the parallel-plate scene', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    /* The region engine produces states, so trajectoryTimes should be non-empty. */
    expect(snapshot.trajectoryTimes.length).toBeGreaterThan(0)
    /* Charts and table should have content. */
    expect(snapshot.charts.length).toBeGreaterThan(0)
    expect(snapshot.table.rows.length).toBeGreaterThan(0)
  })

  it('produces derived quantities for the parallel-plate scene', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    /* The inspector should show derived quantities from the region engine. */
    const derivedSections = snapshot.inspector.filter(section => section.derived && section.derived.length > 0)
    expect(derivedSections.length).toBeGreaterThan(0)
  })

  it('produces verification checks for the parallel-plate scene', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    /* The region engine carries its own verification (bounded_field_geometry,
       electric_force_consistency, kinematic_consistency, etc). */
    expect(snapshot.verification.length).toBeGreaterThan(0)
  })

  it('titles the scene as a parallel-plate scene', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    /* The title should reflect the parallel-plate nature, not "匀强电场中的带电粒子". */
    expect(snapshot.title).toContain('平行板')
  })
})

/* The Inspector and the scene tree are the only place a student reads the plate
   geometry, so they have to name a bounded field as one: "平行板电场" with the two
   plates and the field region, plus editable d / L. */
describe('ElectricWorkspaceRuntime — parallel-plate tree and inspector', () => {
  const paramIds = (snapshot: ReturnType<ReturnType<typeof createElectricWorkspaceRuntime>['getSnapshot']>) =>
    snapshot.inspector.flatMap(section => (section.parameters ?? []).map(parameter => parameter.id))

  const paramOf = (
    snapshot: ReturnType<ReturnType<typeof createElectricWorkspaceRuntime>['getSnapshot']>,
    id: string,
  ) => snapshot.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === id)

  const treeLabels = (nodes: readonly { label: string; children?: readonly unknown[] }[]): string[] =>
    nodes.flatMap(node => [
      node.label,
      ...treeLabels((node.children ?? []) as readonly { label: string; children?: readonly unknown[] }[]),
    ])

  it('shows the plate geometry as editable parameters', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()

    expect(paramIds(snapshot)).toEqual(
      expect.arrayContaining([
        'plateSeparation',
        'plateLength',
        'electricFieldStrength',
        'particleCharge',
        'particleMass',
        'initialSpeed',
      ]),
    )

    /* The values must be the scene's own geometry (factory defaults: d = 0.04 m,
       L = 0.12 m), read from the region rather than recomputed. */
    expect(paramOf(snapshot, 'plateSeparation')?.value).toBeCloseTo(0.04, 12)
    expect(paramOf(snapshot, 'plateSeparation')?.unit).toBe('m')
    expect(paramOf(snapshot, 'plateLength')?.value).toBeCloseTo(0.12, 12)
    expect(paramOf(snapshot, 'plateLength')?.unit).toBe('m')
  })

  it('names the plates and the field region in the scene tree', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const labels = treeLabels(runtime.getSnapshot().tree)

    expect(labels).toContain('平行板电场')
    expect(labels).not.toContain('匀强电场')
    expect(labels).toContain('上极板')
    expect(labels).toContain('下极板')
    expect(labels).toContain('场区')
  })

  it('keeps the uniform (unbounded) field inspector and tree unchanged', () => {
    const runtime = createElectricWorkspaceRuntime(uniformFieldScene())
    const snapshot = runtime.getSnapshot()

    /* Regression guard: the verified uniform-field surface still uses the short
       parameter ids and still calls its field 匀强电场. */
    expect(paramIds(snapshot)).toEqual(expect.arrayContaining(['q', 'm', 'v0', 'E']))
    expect(paramIds(snapshot)).not.toContain('plateSeparation')
    expect(treeLabels(snapshot.tree)).toContain('匀强电场')
  })

  it('bumps the revision and stays verified when the plate separation changes', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const before = runtime.getSnapshot()

    const after = runtime.editParameter('plateSeparation', 0.06)

    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.status).not.toBe('failed')
    expect(after.error).toBeUndefined()
    expect(after.verification.length).toBeGreaterThan(0)
    /* The new geometry must be what the Inspector now reports. */
    expect(paramOf(after, 'plateSeparation')?.value).toBeCloseTo(0.06, 12)
    /* The plates moved with the gap: ±d/2 about the region centre. */
    const plateRows = after.tree
      .flatMap(node => node.children ?? [])
      .filter(node => node.label === '上极板' || node.label === '下极板')
    expect(plateRows).toHaveLength(2)
    expect(plateRows.find(node => node.label === '上极板')?.secondary).toBe('y = 0.030 m')
    expect(plateRows.find(node => node.label === '下极板')?.secondary).toBe('y = -0.030 m')
  })

  it('bumps the revision and stays verified when the plate length changes', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const before = runtime.getSnapshot()

    const after = runtime.editParameter('plateLength', 0.2)

    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.status).not.toBe('failed')
    expect(paramOf(after, 'plateLength')?.value).toBeCloseTo(0.2, 12)
    /* The gap is untouched by a length change. */
    expect(paramOf(after, 'plateSeparation')?.value).toBeCloseTo(0.04, 12)
    /* A longer field region means a longer time inside it, so events still fire. */
    expect(after.events.length).toBeGreaterThan(0)
  })

  it('rejects a non-positive plate separation without touching the scene', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const before = runtime.getSnapshot()

    const after = runtime.editParameter('plateSeparation', 0)

    expect(after.sceneRevision).toBe(before.sceneRevision)
    expect(paramOf(after, 'plateSeparation')?.value).toBeCloseTo(0.04, 12)
  })

  it('routes the semantic field and particle ids through real scene commands', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const base = runtime.getSnapshot().sceneRevision

    const afterField = runtime.editParameter('electricFieldStrength', 3000)
    expect(afterField.sceneRevision).toBe(base + 1)
    expect(paramOf(afterField, 'electricFieldStrength')?.value).toBeCloseTo(3000, 6)

    const afterSpeed = runtime.editParameter('initialSpeed', 4e7)
    expect(afterSpeed.sceneRevision).toBe(base + 2)
    expect(paramOf(afterSpeed, 'initialSpeed')?.value).toBeCloseTo(4e7, 0)
    expect(afterSpeed.status).not.toBe('failed')

    const afterMass = runtime.editParameter('particleMass', 1.8e-30)
    expect(afterMass.sceneRevision).toBe(base + 3)
    expect(paramOf(afterMass, 'particleMass')?.value).toBeCloseTo(1.8e-30, 32)
  })
})

/* Plate geometry is a physical fact, so it must obey the same experimental-branch
   policy as a fact that has a SceneCommand of its own: a question's stated
   conditions are never edited in place. */
describe('parallel-plate plate geometry — experimental branch policy', () => {
  /** A parallel-plate scene that came from a question, at a non-zero revision. */
  const questionScene = () => {
    const scene = createParallelPlateScene({
      sceneId: 'scene-question-plate-001',
      title: '平行板电场中的带电粒子',
      now: '2026-01-01T00:00:00.000Z',
    })
    return {
      ...scene,
      revision: 4,
      /* `@physicsos/shared` is only a transitive dependency here, so the branded id
         is cast rather than imported. */
      metadata: {
        ...scene.metadata,
        sourceQuestionId: 'golden-electric-pp-01' as NonNullable<
          (typeof scene)['metadata']['sourceQuestionId']
        >,
      },
    }
  }

  it('forks the question scene before changing the gap, and leaves the original alone', () => {
    const origin = questionScene()
    const runtime = createElectricWorkspaceRuntime(origin)

    const after = runtime.editParameter('plateSeparation', 0.06)

    /* Forked: revision restarts at 0 and the geometry edit takes it to 1, with the
       question's revision recorded as the parent. */
    expect(after.branch).toBeDefined()
    expect(after.branch?.parentRevision).toBe(4)
    expect(after.sceneRevision).toBe(1)
    expect(after.status).not.toBe('failed')

    /* The question scene the student read is untouched. */
    const originShape = origin.regions[0]?.shape
    expect(originShape?.type === 'rectangle' ? originShape.height.value : undefined).toBeCloseTo(0.04, 12)
  })

  it('does not fork a second time once the student is already on a branch', () => {
    const runtime = createElectricWorkspaceRuntime(questionScene())

    const first = runtime.editParameter('plateLength', 0.2)
    const second = runtime.editParameter('plateSeparation', 0.05)

    expect(first.sceneRevision).toBe(1)
    expect(second.sceneRevision).toBe(2)
    expect(second.branch?.parentRevision).toBe(4)
  })

  it('restores the question scene from a plate-geometry branch', () => {
    const runtime = createElectricWorkspaceRuntime(questionScene())
    runtime.editParameter('plateSeparation', 0.06)

    const restored = runtime.restoreOrigin()

    expect(restored.branch).toBeUndefined()
    expect(restored.sceneRevision).toBe(4)
    expect(
      restored.inspector
        .flatMap(section => section.parameters ?? [])
        .find(parameter => parameter.id === 'plateSeparation')?.value,
    ).toBeCloseTo(0.04, 12)
  })
})

/* The timeline is where a bounded field becomes legible: entering the field,
   leaving it and striking a plate are the three instants a student seeks to. The
   marker layer maps `kind` straight onto a class, so this checks the runtime's
   region kinds actually reach a distinct marker each. */
describe('TimelineMarkers — region event kinds', () => {
  it('renders one seekable marker per region event, classed by kind', () => {
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.getSnapshot()
    const onSeek = vi.fn()

    const { container } = render(
      <TimelineMarkers events={snapshot.events} total={snapshot.clock.total} onSeek={onSeek} />,
    )
    const markers = container.querySelectorAll('button')

    expect(markers.length).toBe(snapshot.events.length)
    snapshot.events.forEach((event, index) => {
      const marker = markers[index]
      const label = marker?.getAttribute('aria-label') ?? ''
      expect(label).toContain(event.label)
      /* A capacitor crossing takes nanoseconds, so the label must not round the
         instant away to "0.00 秒" — a screen reader would announce the wrong time.
         Only a genuinely zero event may read 0.00. */
      if (event.time !== 0) {
        expect(label, `${event.label} must not read as a rounded zero`).not.toContain('0.00 秒')
        const announced = Number.parseFloat(label.replace(/[^\d.eE+-]/g, ''))
        expect(announced).toBeGreaterThan(0)
      }
      /* kind → class: `eventMark_enter` / `eventMark_exit` / `eventMark_plate-impact`
         all exist in LabWorkspace.module.css, so each kind must resolve to a class
         carrying its own name rather than collapsing to the generic mark. */
      expect(marker?.className).toContain(`eventMark_${event.kind}`)
    })
    /* The default geometry lets the electron out the far side. */
    expect(snapshot.events.map(event => event.kind)).toEqual(['enter', 'exit'])
  })

  it('renders a plate-impact marker once the gap is narrow enough to be struck', () => {
    /* Shrinking the gap to 4 mm is the same edit a student makes in the Inspector,
       and it changes the physics outcome: the electron now reaches a plate before
       it can leave the field, so the timeline gains a plate-impact marker. */
    const runtime = createElectricWorkspaceRuntime(parallelPlateScene())
    const snapshot = runtime.editParameter('plateSeparation', 0.004)

    expect(snapshot.status).not.toBe('failed')
    const kinds = snapshot.events.map(event => event.kind)
    expect(kinds).toContain('plate-impact')
    expect(kinds).not.toContain('exit')

    const { container } = render(
      <TimelineMarkers events={snapshot.events} total={snapshot.clock.total} onSeek={vi.fn()} />,
    )
    const impact = Array.from(container.querySelectorAll('button')).find(marker =>
      marker.className.includes('eventMark_plate-impact'),
    )
    expect(impact).toBeDefined()
    expect(impact?.getAttribute('aria-label')).toContain('打到极板')
  })
})
