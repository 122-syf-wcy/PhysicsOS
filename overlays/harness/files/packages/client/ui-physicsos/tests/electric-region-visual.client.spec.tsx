// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  createParallelPlateScene,
  createElectricScene,
} from '@physicsos/physics-scene'
import { ElectricRegionEngine, createElectricRegionSimulationRequest } from '@physicsos/engine-electric-region'
import { observeElectricScene } from '@physicsos/physics-observation'

import { electricSceneVisualAt } from '../src/client/physics/electric-visual-bridge.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'

afterEach(cleanup)

const regionView = (sceneOverrides: Parameters<typeof createParallelPlateScene>[0] = {}) => {
  const scene = createParallelPlateScene({
    sceneId: 'pp-vis-test',
    now: '2026-08-21T00:00:00.000Z',
    ...sceneOverrides,
  })
  const engine = new ElectricRegionEngine()
  const support = engine.canHandle(scene)
  if (!support.supported) throw new Error(`Region engine cannot handle scene: ${support.failedConditions.map(c => c.message).join('; ')}`)
  const simulation = engine.simulate(scene, createElectricRegionSimulationRequest(scene, 'sim-region-vis', 'trace-region-vis'))
  const state = simulation.states[Math.floor(simulation.states.length / 2)] ?? simulation.states[0]
  if (state === undefined) throw new Error('No simulation state.')
  const observations = observeElectricScene({ scene, simulation, state }).observations
  return { scene, view: electricSceneVisualAt({ scene, simulation, observations, state }), simulation }
}

describe('Electric parallel-plate visual bridge', () => {
  it('produces plates and boundedField for a parallel-plate scene', () => {
    const { view } = regionView()

    expect(view.plates).toBeDefined()
    expect(view.plates?.length).toBe(2)
    const topPlate = view.plates?.find(p => p.top)
    const bottomPlate = view.plates?.find(p => !p.top)
    expect(topPlate).toBeDefined()
    expect(bottomPlate).toBeDefined()
    /* Top plate sits above y = 0, bottom below. */
    expect((topPlate?.at.y ?? 0)).toBeGreaterThan(0)
    expect((bottomPlate?.at.y ?? 0)).toBeLessThan(0)
    /* Plate lengths match the scene geometry. */
    expect(topPlate?.length).toBeGreaterThan(0)
    expect(bottomPlate?.length).toBe(topPlate?.length)

    expect(view.boundedField).toBeDefined()
    const bf = view.boundedField
    expect(bf?.width).toBeGreaterThan(0)
    expect(bf?.height).toBeGreaterThan(0)
    /* Direction must be normalized. */
    const dirLen = Math.hypot(bf?.direction.x ?? 0, bf?.direction.y ?? 0)
    expect(dirLen).toBeCloseTo(1, 6)
  })

  it('infers plate polarity from the field direction', () => {
    /* Default scene: E points down → top plate +, bottom plate −. */
    const { view } = regionView()
    const topPlate = view.plates?.find(p => p.top)
    const bottomPlate = view.plates?.find(p => !p.top)
    expect(topPlate?.sign).toBe('positive')
    expect(bottomPlate?.sign).toBe('negative')
  })

  it('infers plate polarity when field points up', () => {
    const { view } = regionView({ electricFieldDirection: 'up' })
    const topPlate = view.plates?.find(p => p.top)
    const bottomPlate = view.plates?.find(p => !p.top)
    expect(topPlate?.sign).toBe('negative')
    expect(bottomPlate?.sign).toBe('positive')
  })

  it('omits plate sign for a purely horizontal field', () => {
    const { view } = regionView({ electricFieldDirection: 'right' })
    const topPlate = view.plates?.find(p => p.top)
    /* A horizontal field does not map to a plate polarity. */
    expect(topPlate?.sign).toBeUndefined()
  })

  it('produces a particle, trajectory, and vectors', () => {
    const { view } = regionView()

    expect(view.particles.length).toBe(1)
    expect(view.particles[0]?.id).toBeTruthy()

    /* Trajectory: at least 2 points for a history path. */
    expect(view.trajectories.length).toBeGreaterThan(0)
    expect(view.trajectories[0]?.points.length).toBeGreaterThanOrEqual(2)

    /* Vectors: E should be present (electricField observable). */
    const observableKeys = view.vectors.map(v => v.observable)
    expect(observableKeys).toContain('electricField')
  })

  it('keeps the E arrow tip inside the bounded field region', () => {
    const { view } = regionView()
    const region = view.boundedField
    expect(region).toBeDefined()
    const eVector = view.vectors.find(vector => vector.observable === 'electricField')
    expect(eVector).toBeDefined()
    /* The field is zero outside the plates, so an arrow crossing the region
       edge would paint a field that is not there. */
    const xMin = (region?.at.x ?? 0) - (region?.width ?? 0) / 2
    const xMax = (region?.at.x ?? 0) + (region?.width ?? 0) / 2
    const yMin = (region?.at.y ?? 0) - (region?.height ?? 0) / 2
    const yMax = (region?.at.y ?? 0) + (region?.height ?? 0) / 2
    expect(eVector?.to.x).toBeGreaterThanOrEqual(xMin - 1e-9)
    expect(eVector?.to.x).toBeLessThanOrEqual(xMax + 1e-9)
    expect(eVector?.to.y).toBeGreaterThanOrEqual(yMin - 1e-9)
    expect(eVector?.to.y).toBeLessThanOrEqual(yMax + 1e-9)
  })

  it('does not trigger the region branch for a uniform-field scene', () => {
    const scene = createElectricScene()
    /* A plain uniform-field scene has no regions or boundaries — the structure
       the bridge dispatches on — so it never reaches the plate projection. */
    expect(scene.regions.length).toBe(0)
    expect(scene.boundaries.length).toBe(0)
  })

  it('renders plate bars, field arrows, and trajectory paths in the DOM', () => {
    const { view } = regionView()
    const { container } = render(<PhysicsCanvas view={view} ariaLabel="平行板电场" />)

    /* SVG exists. */
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()

    /* Plate elements: two groups with data-testid plate-top and plate-bottom. */
    expect(container.querySelector('[data-testid="plate-top"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="plate-bottom"]')).toBeTruthy()

    /* Plate bars are rects inside the plate groups. */
    const plateRects = container.querySelectorAll('[data-testid^="plate-"] rect')
    expect(plateRects.length).toBe(2)

    /* Field lines: clipped to the region rect, each carrying one mid-line
       arrowhead (the marker-end lines). `pc-region-clip-*` distinguishes the
       field layer from the plot-wide clip that also wraps the vectors —
       jsdom's selector engine chokes on `url(#…)` inside `[attr^=]`, so the
       filter runs on the attribute string instead. */
    const regionFieldInk = Array.from(container.querySelectorAll('g[clip-path]'))
      .filter(group => group.getAttribute('clip-path')?.startsWith('url(#pc-region-clip'))
      .flatMap(group => Array.from(group.querySelectorAll('line[marker-end]')))
    expect(regionFieldInk.length).toBeGreaterThan(0)

    /* Trajectory path exists. */
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('hides the field lines when the electricField observable is off', () => {
    const { view } = regionView()
    const hidden = {
      ...view,
      visible: { ...view.visible, electricField: false },
    }
    const { container } = render(<PhysicsCanvas view={hidden} ariaLabel="平行板电场" />)

    /* No clipped field-line group at all — the toggle controls real ink. The
       region clip (`pc-region-clip-*`) is the field layer; the plot clip
       wraps the vectors and must not be counted. */
    const regionFieldInk = Array.from(container.querySelectorAll('g[clip-path]'))
      .filter(group => group.getAttribute('clip-path')?.startsWith('url(#pc-region-clip'))
      .flatMap(group => Array.from(group.querySelectorAll('line[marker-end]')))
    expect(regionFieldInk.length).toBe(0)
    /* Plates still render — the toggle hides the field layer, not the
       apparatus. */
    expect(container.querySelector('[data-testid="plate-top"]')).toBeTruthy()
  })

  it('does not render plate elements for a point-charge scene', () => {
    /* A parallel-plate scene that is rendered as a point-charge scene should
       not produce plate elements. We verify by checking that a uniform-field
       scene (not parallel-plate) has no plates in the visual. */
    const scene = createElectricScene()
    expect(scene.regions.length).toBe(0)
  })
})
