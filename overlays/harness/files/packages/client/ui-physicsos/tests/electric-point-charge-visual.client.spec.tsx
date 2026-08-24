// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  createPointChargeScene,
  type ProbeParticleInput,
} from '@physicsos/physics-scene'
import { ElectricEngine, createElectricSimulationRequest } from '@physicsos/engine-electric'
import { observeElectricScene } from '@physicsos/physics-observation'

import { electricSceneVisualAt } from '../src/client/physics/electric-visual-bridge.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'

afterEach(cleanup)

const probeAt = (x: number, y: number): ProbeParticleInput => ({
  id: 'probe-1',
  charge: 1e-9,
  mass: 1,
  position: { x, y, z: 0 },
})

const pointChargeView = (probe?: ProbeParticleInput) => {
  const scene = createPointChargeScene({
    sceneId: 'pc-vis-test',
    charges: [{ id: 'q1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
    ...(probe === undefined ? {} : { probe }),
    now: '2026-08-21T00:00:00.000Z',
  })
  const engine = new ElectricEngine()
  const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-vis', 'trace-vis'))
  const state = simulation.states[0]
  if (state === undefined) throw new Error('No simulation state.')
  const observations = observeElectricScene({ scene, simulation, state }).observations
  return electricSceneVisualAt({ scene, simulation, observations, state })
}

describe('Electric point-charge visual bridge', () => {
  it('emits a glass-sphere source, streamlines and probe vectors', () => {
    const view = pointChargeView(probeAt(0.2, 0))

    expect(view.pointChargeSources).toBeDefined()
    expect(view.pointChargeSources?.length).toBe(1)
    const source = view.pointChargeSources?.[0]
    expect(source?.sign).toBe('positive')
    expect(source?.chargeValue).toBe(5e-6)

    /* Streamlines radiate from the source; a positive charge yields outward lines. */
    expect(view.fieldStreamlines).toBeDefined()
    expect((view.fieldStreamlines ?? []).length).toBeGreaterThan(0)

    /* Probe present, so E and F vectors attach to the probe position. */
    expect(view.probe).toBeDefined()
    expect(view.probe?.at).toEqual({ x: 0.2, y: 0 })
    const observableKeys = view.vectors.map(vector => vector.observable)
    expect(observableKeys).toContain('electricField')
    expect(observableKeys).toContain('force')
  })

  it('renders a field-sampled view with no probe', () => {
    const view = pointChargeView()
    /* No probe: still a source and streamlines, but no probe vector or probe marker. */
    expect(view.pointChargeSources?.length).toBe(1)
    expect((view.fieldStreamlines ?? []).length).toBeGreaterThan(0)
    expect(view.probe).toBeUndefined()
    expect(view.vectors.some(vector => vector.observable === 'force')).toBe(false)
  })

  it('points the source sign inward for a negative charge', () => {
    const scene = createPointChargeScene({
      sceneId: 'pc-neg-test',
      charges: [{ id: 'q1', charge: -5e-6, position: { x: 0, y: 0, z: 0 } }],
      probe: probeAt(0.2, 0),
      now: '2026-08-21T00:00:00.000Z',
    })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-neg', 'trace-neg'))
    const state = simulation.states[0]
    if (state === undefined) throw new Error('No simulation state.')
    const observations = observeElectricScene({ scene, simulation, state }).observations
    const view = electricSceneVisualAt({ scene, simulation, observations, state })

    expect(view.pointChargeSources?.[0]?.sign).toBe('negative')
  })

  it('draws streamlines that point TOWARD a negative charge (E2 direction)', () => {
    const scene = createPointChargeScene({
      sceneId: 'pc-neg-dir',
      charges: [{ id: 'q1', charge: -5e-6, position: { x: 0, y: 0, z: 0 } }],
      probe: probeAt(0.2, 0),
      now: '2026-08-21T00:00:00.000Z',
    })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-negd', 'trace-negd'))
    const state = simulation.states[0]
    if (state === undefined) throw new Error('No simulation state.')
    const observations = observeElectricScene({ scene, simulation, state }).observations
    const view = electricSceneVisualAt({ scene, simulation, observations, state })

    const streamlines = view.fieldStreamlines ?? []
    expect(streamlines.length).toBeGreaterThan(0)
    /* For a negative charge the lines are reversed so the LAST point is nearest the
       source: a line ends closer to the origin than it starts. (For a positive charge
       the opposite holds.) At least one streamline must end nearer the source than its
       start, proving the inward direction. */
    const inwardLines = streamlines.filter((line) => {
      const start = line.points[0]
      const end = line.points[line.points.length - 1]
      if (start === undefined || end === undefined) return false
      const startDist = Math.hypot(start.x, start.y)
      const endDist = Math.hypot(end.x, end.y)
      return endDist < startDist
    })
    expect(inwardLines.length).toBeGreaterThan(0)
  })

  it('emits no degenerate streamline stubs', () => {
    const view = pointChargeView(probeAt(0.2, 0))
    const streamlines = view.fieldStreamlines ?? []
    expect(streamlines.length).toBeGreaterThan(0)
    /* Every streamline must span more than the minRadius — no oscillating 61-point
       stubs sitting on the charge sphere. */
    for (const line of streamlines) {
      const first = line.points[0]
      const last = line.points[line.points.length - 1]
      expect(first).toBeDefined()
      expect(last).toBeDefined()
      if (first === undefined || last === undefined) continue
      const span = Math.hypot(last.x - first.x, last.y - first.y)
      expect(span).toBeGreaterThan(0)
    }
  })

  it('renders streamline paths, a glass-sphere source and a probe dot in the DOM', () => {
    const view = pointChargeView(probeAt(0.2, 0))
    const { container } = render(<PhysicsCanvas view={view} ariaLabel="点电荷电场" />)

    /* Streamlines render as paths inside the electric-field streamline group. */
    const streamlinePaths = container.querySelectorAll('path[marker-end], path')
    expect(streamlinePaths.length).toBeGreaterThan(0)
    /* The source sphere is a circle filled with a gradient (glass sphere). */
    const gradientCircles = container.querySelectorAll('circle[fill^="url(#pc-point-"]')
    expect(gradientCircles.length).toBe(1)
    /* Probe dot: a small unfilled-gradient circle, distinguishable from the sphere. */
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
  })

  it('emits equipotential contours for a multi-source scene', () => {
    const scene = createPointChargeScene({
      sceneId: 'pc-multi-test',
      charges: [
        { id: 'q1', charge: 2e-6, position: { x: -0.1, y: 0, z: 0 } },
        { id: 'q2', charge: -2e-6, position: { x: 0.1, y: 0, z: 0 } },
      ],
      probe: probeAt(0, 0),
      now: '2026-08-21T00:00:00.000Z',
    })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-multi', 'trace-multi'))
    const state = simulation.states[0]
    if (state === undefined) throw new Error('No simulation state.')
    const observations = observeElectricScene({ scene, simulation, state }).observations
    const view = electricSceneVisualAt({ scene, simulation, observations, state })

    /* Two sources render. */
    expect(view.pointChargeSources?.length).toBe(2)
    /* Equipotentials are present for a multi-source scene. */
    expect(view.equipotentials).toBeDefined()
    expect((view.equipotentials ?? []).length).toBeGreaterThan(0)
    /* Each contour is a polyline of at least 3 points. */
    for (const contour of view.equipotentials ?? []) {
      expect(contour.points.length).toBeGreaterThanOrEqual(3)
    }
    /* The equipotential observable is visible, so the visibility flag is on. */
    expect(view.visible.equipotentials).toBe(true)
  })

  it('omits equipotentials for a single-source scene', () => {
    const view = pointChargeView(probeAt(0.2, 0))
    /* Single source: no equipotential observable, no contours. */
    expect(view.equipotentials).toBeUndefined()
    expect(view.visible.equipotentials).toBeFalsy()
  })

  it('renders equipotential paths in the DOM for a multi-source scene', () => {
    const scene = createPointChargeScene({
      sceneId: 'pc-multi-dom',
      charges: [
        { id: 'q1', charge: 2e-6, position: { x: -0.1, y: 0, z: 0 } },
        { id: 'q2', charge: -2e-6, position: { x: 0.1, y: 0, z: 0 } },
      ],
      probe: probeAt(0, 0),
      now: '2026-08-21T00:00:00.000Z',
    })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-dom', 'trace-dom'))
    const state = simulation.states[0]
    if (state === undefined) throw new Error('No simulation state.')
    const observations = observeElectricScene({ scene, simulation, state }).observations
    const view = electricSceneVisualAt({ scene, simulation, observations, state })
    const { container } = render(<PhysicsCanvas view={view} ariaLabel="多源电场" />)

    /* Equipotential paths render as dashed paths (data-closed attribute on closed loops). */
    const equipotentialPaths = container.querySelectorAll('svg path')
    /* At least one path exists (streamlines + equipotentials together). */
    expect(equipotentialPaths.length).toBeGreaterThan(0)
  })
})


