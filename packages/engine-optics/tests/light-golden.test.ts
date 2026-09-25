import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createPinholeScene,
  createSceneCommand,
  isLightScene,
  lightBenchesOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  LIGHT_ENGINE_ID,
  LightEngine,
  PINHOLE_MODEL,
  createLightSimulationRequest,
  imagePointOf,
  lightEngine,
  pinholeImageHeight,
  pinholeMagnification,
  pinholeReadingOf,
  resolveLightModel,
} from '../src/index.ts'

/* A 6 cm arrow 30 cm in front of the hole throws a 3 cm image on a screen 15 cm
   behind it: v/u = 1/2, and both numbers are integers because they are. */
const pinholeScene = (input: Parameters<typeof createPinholeScene>[0] = {}): PhysicsScene =>
  createPinholeScene(input)

const simulated = (scene: PhysicsScene) =>
  lightEngine.simulate(scene, createLightSimulationRequest(scene, 'sim-light', 'trace-light'))

const scalarOf = (scene: PhysicsScene, key: string): number => {
  const derived = simulated(scene).derivedQuantities.find((entry) => entry.key === key)
  if (derived === undefined) throw new Error(`derived quantity missing: ${key}`)
  if (!isScalarQuantity(derived.value)) throw new Error(`derived quantity not scalar: ${key}`)
  return derived.value.value
}

const checkPassed = (scene: PhysicsScene, id: string): boolean | undefined =>
  simulated(scene).verification.checks.find((entry) => entry.id === id)?.passed

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  return runtime.execute(
    createSceneCommand<T>({
      commandId: `cmd-${type}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

describe('pinhole image', () => {
  it('resolves the object and the two distances into SI', () => {
    const model = resolveLightModel(pinholeScene())
    expect(model.type).toBe('pinhole')
    if (model.type !== 'pinhole') throw new Error('expected a pinhole bench')
    expect(model.benchId).toBe('light-bench-1')
    expect(model.objectHeight).toBeCloseTo(0.06, 15)
    expect(model.objectDistance).toBeCloseTo(0.3, 15)
    expect(model.screenDistance).toBeCloseTo(0.15, 15)
  })

  it('halves the arrow and turns it upside down', () => {
    const reading = pinholeReadingOf({
      type: 'pinhole',
      benchId: 'light-bench-1',
      objectHeight: 0.06,
      objectDistance: 0.3,
      screenDistance: 0.15,
    })
    expect(reading.magnification).toBeCloseTo(0.5, 15)
    expect(reading.imageHeight).toBeCloseTo(0.03, 15)
    /* Straight lines through the hole: the tip lands BELOW the axis and the
       tail above it — the inversion is geometry, not a stored flag. */
    expect(reading.tipAt).toBeCloseTo(-0.03, 15)
    expect(reading.tailAt).toBeCloseTo(0.03, 15)
    expect(reading.inverted).toBe(true)
  })

  it('puts the image exactly where straight rays put it', () => {
    const points = imagePointOf(0.06, 0.3, 0.15)
    /* The two rays cross at the hole and keep going: the image height is the
       half-separation of where they land, and it equals h·v/u. */
    expect((points.tail - points.tip) / 2).toBeCloseTo(pinholeImageHeight(0.06, 0.3, 0.15), 15)
  })

  it('scales the image with the screen distance and against the object distance', () => {
    /* Twice the screen distance, twice the image. */
    expect(pinholeImageHeight(0.06, 0.3, 0.3)).toBeCloseTo(0.06, 15)
    /* Twice the object distance, half the image. */
    expect(pinholeImageHeight(0.06, 0.6, 0.15)).toBeCloseTo(0.015, 15)
    expect(pinholeMagnification(0.6, 0.15)).toBeCloseTo(0.25, 15)
  })

  it('verifies the rays, the inversion and both distances', () => {
    const scene = pinholeScene()
    expect(checkPassed(scene, 'image_from_straight_rays')).toBe(true)
    expect(checkPassed(scene, 'image_is_inverted')).toBe(true)
    expect(checkPassed(scene, 'image_scales_with_both_distances')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('reports the image, the magnification and the inversion as derived quantities', () => {
    const scene = pinholeScene()
    expect(scalarOf(scene, 'object_height')).toBeCloseTo(0.06, 15)
    expect(scalarOf(scene, 'object_distance')).toBeCloseTo(0.3, 15)
    expect(scalarOf(scene, 'screen_distance')).toBeCloseTo(0.15, 15)
    expect(scalarOf(scene, 'magnification')).toBeCloseTo(0.5, 15)
    expect(scalarOf(scene, 'image_height')).toBeCloseTo(0.03, 15)
    expect(scalarOf(scene, 'inverted')).toBe(-1)
    const image = simulated(scene).derivedQuantities.find((entry) => entry.key === 'image_height')
    expect(image?.formula?.expression).toBe("h′ = h·v/u")
    expect(lightEngine.canHandle(scene)).toMatchObject({ supported: true, modelId: PINHOLE_MODEL })
    expect(lightEngine.engineId).toBe(LIGHT_ENGINE_ID)
  })

  it('refuses a rig with no bench, two benches, or a zero length', () => {
    expect(lightEngine.canHandle({ ...pinholeScene(), lightBenches: [] }).supported).toBe(false)
    const bench = lightBenchesOf(pinholeScene())[0]!
    expect(
      lightEngine.canHandle({ ...pinholeScene(), lightBenches: [bench, { ...bench, id: 'x' }] })
        .supported,
    ).toBe(false)
    expect(new LightEngine().canHandle(createPinholeScene({ objectHeight: 0 })).supported).toBe(false)
  })

  it('re-solves from the inspector: the screen, the object and its height', () => {
    const runtime = new SceneRuntime(pinholeScene())

    const far = execute(runtime, 'SetScreenDistance', {
      benchId: 'light-bench-1',
      distance: quantity(30, 'cm', 'length'),
    })
    expect(far.ok).toBe(true)
    /* Same size as the object once the screen is as far behind as it is in front. */
    expect(scalarOf(runtime.getScene(), 'magnification')).toBeCloseTo(1, 12)

    const taller = execute(runtime, 'SetObjectHeight', {
      benchId: 'light-bench-1',
      height: quantity(12, 'cm', 'length'),
    })
    expect(taller.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'image_height')).toBeCloseTo(0.12, 12)

    const back = execute(runtime, 'SetObjectDistance', {
      benchId: 'light-bench-1',
      distance: quantity(60, 'cm', 'length'),
    })
    expect(back.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'image_height')).toBeCloseTo(0.06, 12)

    const zero = execute(runtime, 'SetScreenDistance', {
      benchId: 'light-bench-1',
      distance: quantity(0, 'cm', 'length'),
    })
    expect(zero.ok).toBe(false)
    expect(isLightScene(runtime.getScene())).toBe(true)
  })
})
