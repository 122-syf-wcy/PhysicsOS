import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar } from '@physicsos/physics-core'
import {
  createConvexLensScene,
  createOpticalBenchScene,
  createPlaneMirrorScene,
  opticalBenchOf,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import {
  OpticsEngine,
  PLANE_MIRROR_MODEL,
  THIN_LENS_MODEL,
  createOpticsSimulationRequest,
  opticsEngine,
  principalRaysOf,
  resolveOpticalImaging,
} from '../src/index.ts'

const lensScene = (objectDistance: number, focalLength = 10): PhysicsScene =>
  createConvexLensScene({ focalLength, objectDistance })

const expectImage = (scene: PhysicsScene) => {
  const result = resolveOpticalImaging(scene)
  if (result.outcome.kind !== 'image') throw new Error('Expected an image outcome.')
  return { result, image: result.outcome.image }
}

describe('plane mirror imaging', () => {
  it('images virtual, upright, unit magnification at the mirrored position', () => {
    const { result, image } = expectImage(createPlaneMirrorScene({ objectDistance: 10 }))
    expect(image.nature).toBe('virtual')
    expect(image.orientation).toBe('upright')
    expect(image.magnification).toBe(1)
    expect(image.distance).toBeCloseTo(0.1, 12)
    expect(image.x).toBeCloseTo(0.1, 12)
    expect(image.height).toBeCloseTo(0.06, 12)
    /* The screen parked exactly at the image plane still catches nothing. */
    expect(result.imageOnScreen).toBe(false)
  })

  it('passes mirror symmetry and ray-construction verification', () => {
    const scene = createPlaneMirrorScene()
    const request = createOpticsSimulationRequest(scene, 'sim-mirror', 'trace-mirror')
    const outcome = opticsEngine.simulate(scene, request)
    expect(outcome.verification.status).toBe('passed')
    const ids = outcome.verification.checks.map((entry) => entry.id)
    expect(ids).toContain('mirror_image_symmetry')
    expect(ids).toContain('principal_rays_converge')
    expect(ids).toContain('virtual_image_uncatchable')
    expect(derivedScalar(outcome.derivedQuantities, 'image_distance').value).toBeCloseTo(10, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'magnification').value).toBe(1)
  })

  it('draws a three-ray fan whose extensions aim at the image top', () => {
    const result = resolveOpticalImaging(createPlaneMirrorScene({ objectDistance: 10 }))
    const rays = principalRaysOf(result)
    expect(rays).toHaveLength(3)
    for (const ray of rays) {
      expect(ray.kind).toBe('incident')
      const last = ray.extension?.[ray.extension.length - 1]
      expect(last?.x).toBeCloseTo(0.1, 12)
      expect(last?.y).toBeCloseTo(0.06, 12)
    }
  })
})

describe('convex lens imaging across the five zones', () => {
  it('u > 2f: real, inverted, reduced (the camera)', () => {
    const { result, image } = expectImage(lensScene(30))
    expect(result.lensZone).toBe('beyond_2f')
    expect(image.nature).toBe('real')
    expect(image.orientation).toBe('inverted')
    expect(image.distance).toBeCloseTo(0.15, 12)
    expect(image.magnification).toBeCloseTo(0.5, 12)
    expect(image.height).toBeCloseTo(0.03, 12)
    /* Template parks the screen on the sharp-image plane. */
    expect(result.imageOnScreen).toBe(true)
    expect(result.screenOffset).toBeCloseTo(0, 9)
  })

  it('u = 2f: real, inverted, same size at v = 2f', () => {
    const { result, image } = expectImage(lensScene(20))
    expect(result.lensZone).toBe('at_2f')
    expect(image.distance).toBeCloseTo(0.2, 12)
    expect(image.magnification).toBeCloseTo(1, 12)
    expect(image.orientation).toBe('inverted')
  })

  it('f < u < 2f: real, inverted, magnified (the projector)', () => {
    const { result, image } = expectImage(lensScene(15))
    expect(result.lensZone).toBe('between_f_2f')
    expect(image.nature).toBe('real')
    expect(image.distance).toBeCloseTo(0.3, 12)
    expect(image.magnification).toBeCloseTo(2, 12)
  })

  it('u = f: no image, emergent rays parallel', () => {
    const scene = lensScene(10)
    const result = resolveOpticalImaging(scene)
    expect(result.outcome.kind).toBe('no_image')
    expect(result.lensZone).toBe('at_f')
    expect(result.imageOnScreen).toBe(false)
    const request = createOpticsSimulationRequest(scene, 'sim-at-f', 'trace-at-f')
    const outcome = opticsEngine.simulate(scene, request)
    expect(outcome.verification.status).toBe('passed')
    expect(outcome.verification.checks.map((entry) => entry.id)).toContain(
      'rays_parallel_at_focus',
    )
    const rays = principalRaysOf(result)
    expect(rays).toHaveLength(2)
    expect(rays.every((ray) => ray.extension === undefined)).toBe(true)
  })

  it('u < f: virtual, upright, magnified on the object side (the magnifier)', () => {
    const { result, image } = expectImage(lensScene(5))
    expect(result.lensZone).toBe('within_f')
    expect(image.nature).toBe('virtual')
    expect(image.orientation).toBe('upright')
    expect(image.distance).toBeCloseTo(0.1, 12)
    expect(image.magnification).toBeCloseTo(2, 12)
    expect(image.x).toBeCloseTo(-0.1, 12)
    expect(result.imageOnScreen).toBe(false)
    const rays = principalRaysOf(result)
    expect(rays).toHaveLength(3)
    for (const ray of rays) {
      const last = ray.extension?.[ray.extension.length - 1]
      expect(last?.x).toBeCloseTo(-0.1, 12)
      expect(last?.y).toBeCloseTo(0.12, 12)
    }
  })

  it('verifies the thin lens equation and independent ray construction', () => {
    const scene = lensScene(30)
    const request = createOpticsSimulationRequest(scene, 'sim-lens', 'trace-lens')
    const outcome = opticsEngine.simulate(scene, request)
    expect(outcome.verification.status).toBe('passed')
    const ids = outcome.verification.checks.map((entry) => entry.id)
    expect(ids).toContain('thin_lens_equation')
    expect(ids).toContain('principal_rays_converge')
    expect(derivedScalar(outcome.derivedQuantities, 'object_distance').value).toBeCloseTo(30, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'image_distance').value).toBeCloseTo(15, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'focal_length').value).toBeCloseTo(10, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'magnification').value).toBeCloseTo(0.5, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'screen_offset').value).toBeCloseTo(0, 9)
  })

  it('flags a moved screen as off the sharp-image plane', () => {
    const scene = createConvexLensScene({ focalLength: 10, objectDistance: 30, screenPosition: 22 })
    const result = resolveOpticalImaging(scene)
    expect(result.imageOnScreen).toBe(false)
    expect(result.screenOffset).toBeCloseTo(0.07, 9)
  })
})

describe('engine gate', () => {
  it('accepts the two templates with their model ids', () => {
    const engine = new OpticsEngine()
    const lens = engine.canHandle(lensScene(30))
    expect(lens.supported).toBe(true)
    if (lens.supported) expect(lens.modelId).toBe(THIN_LENS_MODEL)
    const mirror = engine.canHandle(createPlaneMirrorScene())
    expect(mirror.supported).toBe(true)
    if (mirror.supported) expect(mirror.modelId).toBe(PLANE_MIRROR_MODEL)
  })

  it('rejects scenes without exactly one bench or with foreign objects', () => {
    const engine = new OpticsEngine()
    const none = engine.canHandle({ ...lensScene(30), opticalBenches: [] })
    expect(none.supported).toBe(false)

    const scene = lensScene(30)
    const withParticle: PhysicsScene = {
      ...scene,
      particles: [
        {
          id: 'stray',
          type: 'particle',
          mass: quantity(1, 'kg', 'mass'),
          position: { vector: { x: 0, y: 0, z: 0 }, unit: 'm', dimension: 'length' },
          velocity: { vector: { x: 0, y: 0, z: 0 }, unit: 'm/s', dimension: 'velocity' },
        },
      ],
    }
    const impure = engine.canHandle(withParticle)
    expect(impure.supported).toBe(false)
    if (!impure.supported) {
      expect(impure.failedConditions[0]?.condition).toBe('pure_optics_scene')
    }
  })

  it('rejects an object standing on or behind the element', () => {
    const engine = new OpticsEngine()
    const scene = createOpticalBenchScene({
      object: { position: 5, height: 6 },
      element: { type: 'thin_lens', position: 0, focalLength: 10 },
    })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions[0]?.condition).toBe('imaging_model_resolvable')
    }
  })

  it('rejects mismatched simulation requests and negative time', () => {
    const scene = lensScene(30)
    const request = createOpticsSimulationRequest(scene, 'sim-x', 'trace-x')
    expect(() =>
      opticsEngine.simulate({ ...scene, revision: scene.revision + 1 }, request),
    ).toThrowError()
    expect(() => opticsEngine.stateAt(scene, quantity(-1, 's', 'time'))).toThrowError()
  })

  it('reports a static single-state simulation with bench facts', () => {
    const bench = opticalBenchOf(lensScene(30))
    expect(bench).toBeDefined()
    const scene = lensScene(30)
    const outcome = opticsEngine.simulate(
      scene,
      createOpticsSimulationRequest(scene, 'sim-static', 'trace-static'),
    )
    expect(outcome.states).toHaveLength(1)
    expect(outcome.metadata.deterministic).toBe(true)
    const benchState = outcome.states[0]?.objects.find((entry) => entry.id === 'optical-bench-1')
    expect(benchState?.values?.['image_position_x']).toBeDefined()
  })
})
