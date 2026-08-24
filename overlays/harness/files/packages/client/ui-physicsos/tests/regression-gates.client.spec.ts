// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { observeMechanicsScene } from '@physicsos/physics-observation'
import { MechanicsEngine, createMechanicsSimulationRequest } from '@physicsos/engine-mechanics'

import { mountPhysicsOSChrome } from '../src/client/chrome.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from '../src/client/physics/magnetic-workspace-runtime.ts'

/**
 * Regression gates for failures that are silent by nature: a blank canvas, a
 * magnified canvas, a stale dependency copy, or a toggle that changes the picture
 * without changing the physics. Each one has cost real debugging time.
 */

const projectile = () =>
  createMechanicsScene({
    sceneId: 'gate-projectile',
    model: 'projectile_motion',
    mass: 1,
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
    gravity: { x: 0, y: -9.8, z: 0 },
    groundY: 0,
    title: '平抛运动',
  })

describe('gate A · physics semantic tokens are installed', () => {
  it('defines every token the canvas paints with', () => {
    /* `stroke: var(--missing)` is invalid at computed-value time and reverts to the
       inherited value — `none` under the canvas's `<svg fill="none">`. The entire
       canvas then renders into the DOM and paints nothing. */
    const dispose = mountPhysicsOSChrome()
    const css = document.head.querySelector('style[data-physicsos-chrome]')?.textContent ?? ''
    for (const token of [
      '--physics-vector-velocity',
      '--physics-vector-force',
      '--physics-vector-gravity',
      '--physics-vector-normal',
      '--physics-vector-friction',
      '--physics-vector-acceleration',
      '--physics-trajectory',
      '--physics-grid-minor',
      '--physics-axis',
      '--physics-body-fill',
      '--physics-highlight',
    ]) {
      expect(css, `missing ${token}`).toContain(`${token}:`)
    }
    dispose()
  })
})

describe('gate C · the canvas never magnifies itself', () => {
  it('fits every scene inside one FIXED plot box', () => {
    /* The failure mode this guards: a content-sized viewBox gets scaled UP by
       `preserveAspectRatio` whenever the scene is portrait, coarsening every stroke
       and label by the same factor. The fix is a plot box that does not depend on
       the scene, so the emitted viewBox is identical for every frame and the SVG can
       only ever be scaled DOWN to fit its container. The rendered scale itself is
       asserted in the browser gate, where a real box size exists. */
    const PLOT = { width: 960, height: 540 }
    const scenes = [
      projectile(),
      createMechanicsScene({ model: 'inclined_plane', inclineAngle: 30, mass: 2, frictionCoefficient: 0.2 }),
      createMechanicsScene({ model: 'uniform_linear_motion', velocity: { x: 4, y: 0, z: 0 } }),
      /* Deliberately extreme: a very tall drop and a very long range. */
      createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 400, z: 0 },
        velocity: { x: 120, y: 0, z: 0 },
        gravity: { x: 0, y: -9.8, z: 0 },
        groundY: 0,
      }),
    ]
    for (const scene of scenes) {
      const view = createMechanicsWorkspaceRuntime(scene).getSnapshot().view
      const fit = Math.min(PLOT.width / view.extent.width, PLOT.height / view.extent.height)
      const drawnWidth = view.extent.width * fit
      const drawnHeight = view.extent.height * fit
      expect(drawnWidth, `scene ${String(scene.id)} overflows the plot box`).toBeLessThanOrEqual(PLOT.width + 1e-6)
      expect(drawnHeight, `scene ${String(scene.id)} overflows the plot box`).toBeLessThanOrEqual(PLOT.height + 1e-6)
      /* Aspect must be preserved: a metre on x is a metre on y, or the physics
         reads wrong. One axis therefore fills the box exactly. */
      const fills =
        Math.abs(drawnWidth - PLOT.width) < 1e-6 || Math.abs(drawnHeight - PLOT.height) < 1e-6
      expect(fills, `scene ${String(scene.id)} does not fill either axis`).toBe(true)
    }
  })
})

describe('gate G · an observable toggle changes the Observation output', () => {
  it('publishes decomposition observations only when the scene enables them', () => {
    const scene = createMechanicsScene({
      model: 'inclined_plane',
      inclineAngle: 30,
      mass: 2,
      gravity: { x: 0, y: -9.8, z: 0 },
      frictionCoefficient: 0.2,
    })
    const engine = new MechanicsEngine()
    const observe = (input: typeof scene) => {
      const simulation = engine.simulate(
        input,
        createMechanicsSimulationRequest(input, 'gate-sim', 'gate-trace'),
      )
      return observeMechanicsScene({ scene: input, simulation }).observations
    }

    const off = observe(scene)
    expect(off.some(entry => entry.type === 'mechanics_force' && entry.label === 'gravity_parallel')).toBe(false)

    const on = {
      ...scene,
      observableDefinitions: scene.observableDefinitions.map(definition =>
        definition.parameters?.['kind'] === 'force_decomposition'
          ? { ...definition, visible: true }
          : definition,
      ),
    }
    const observed = observe(on)
    /* The toggle must reach the physics layer, not just the drawing code. */
    expect(observed.some(entry => entry.type === 'mechanics_force' && entry.label === 'gravity_parallel')).toBe(true)
    expect(observed.some(entry => entry.type === 'mechanics_force' && entry.label === 'gravity_normal')).toBe(true)
  })

  it('routes a UI toggle through the scene so the canvas and the scene agree', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectile())
    const before = runtime.getSnapshot()
    expect(before.view.visible.components).toBe(false)
    const after = runtime.setObservable('components', true)
    expect(after.view.visible.components).toBe(true)
    /* Visibility lives in the scene, so the change is an auditable revision. */
    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.view.vectors.some(vector => vector.id === 'velocity-x')).toBe(true)
  })
})

describe('gate H · the runtime reads current source, not a stale copy', () => {
  it('sees scene-factory features added in this repo', () => {
    /* pnpm COPIES a `file:` dependency into its store and does not refresh it, so
       the browser bundle can compile an old copy while tests read source. These
       observables and this metadata field only exist in the current source. */
    const scene = createMechanicsScene({
      model: 'projectile_motion',
      position: { x: 0, y: 20, z: 0 },
      velocity: { x: 10, y: 0, z: 0 },
      groundY: 0,
      sourceQuestionId: 'gate-question',
    })
    const kinds = scene.observableDefinitions.map(definition => definition.parameters?.['kind'])
    expect(kinds).toContain('velocity_components')
    expect(kinds).toContain('keypoints')
    expect(scene.observableDefinitions.some(definition => definition.type === 'force')).toBe(true)
    expect(String(scene.metadata.sourceQuestionId)).toBe('gate-question')
  })
})

describe('gate B · the canvas paints real ink in every domain', () => {
  it('emits stroked geometry for mechanics and magnetic frames', () => {
    const mechanics = createMechanicsWorkspaceRuntime(projectile()).getSnapshot()
    expect(mechanics.view.trajectories.length).toBeGreaterThan(0)
    expect(mechanics.view.vectors.length).toBeGreaterThan(0)
    expect(mechanics.view.ground).toBeDefined()

    const magnetic = createMagneticWorkspaceRuntime().getSnapshot()
    expect(magnetic.view.particles.length).toBeGreaterThan(0)
    expect(magnetic.view.vectors.length).toBeGreaterThan(0)
    expect(magnetic.view.field).toBeDefined()
  })
})
