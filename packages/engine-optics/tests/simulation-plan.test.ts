import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SimulationOptions, SimulationPlan, SimulationRequest, SimulationResult } from '../../physics-core/src/simulation.ts'
import { derivedScalar, isScalarQuantity, type DerivedQuantity } from '../../physics-core/src/simulation-state.ts'
import * as simulation from '../../physics-core/src/simulation.ts'
import * as verification from '../../physics-core/src/verification.ts'
import type { PhysicsScene } from '../../physics-scene/src/scene.ts'
import { createOpticalBenchScene } from '../../physics-scene/src/optics/optics-scene.ts'
import { createConcaveMirrorScene, createConvexLensScene, createConvexMirrorScene, createPlaneMirrorScene } from '../../physics-scene/src/optics/optics-templates.ts'
import { createPinholeScene, createTotalReflectionScene } from '../../physics-scene/src/optics/light-templates.ts'
import * as sceneValidation from '../../physics-scene/src/scene-validation.ts'
import * as sampling from '../../physics-scene/src/trajectory-sampling.ts'
import * as quantities from '../../physics-units/src/quantity.ts'
import type { Quantity } from '../../physics-units/src/quantity.ts'
import { asSceneId } from '../../shared/src/ids.ts'
import { PhysicsOSError } from '../../shared/src/errors.ts'

import { CURVED_MIRROR_MODEL, OPTICS_ENGINE_ID, OPTICS_ENGINE_VERSION, OpticsEngine, PLANE_MIRROR_MODEL, THIN_LENS_MODEL, createOpticsSimulationRequest } from '../src/optics-engine.ts'
import { LIGHT_ENGINE_ID, LIGHT_ENGINE_VERSION, LightEngine, PINHOLE_MODEL, TOTAL_REFLECTION_MODEL, createLightSimulationRequest } from '../src/light-engine.ts'
import * as opticalModels from '../src/optics-model.ts'
import * as lightModels from '../src/light-model.ts'
import * as imaging from '../src/imaging.ts'
import * as rays from '../src/principal-rays.ts'
import * as light from '../src/light.ts'

const now = '2026-11-08T00:00:00.000Z'
const cm = (value: number) => quantities.quantity(value, 'cm', 'length')
const metres = (value: number) => quantities.quantity(value, 'm', 'length')
const radians = (value: number) => quantities.quantity(value, 'rad', 'angle')
const dimensionless = (value: number) => quantities.quantity(value, '', 'dimensionless')
const seconds = (value: number) => quantities.quantity(value, 's', 'time')

type StaticEngine = OpticsEngine | LightEngine
interface NumericFixture {
  name: string
  create: () => PhysicsScene
  modelId: string
  objects: { id: string; values: Record<string, Quantity> }[]
  derived: Record<string, Quantity>
  targets: Record<string, string>
  checks: string[]
}
interface ImagingNumbers {
  objectDistance: number
  focalLength?: number
  screenX: number
  image?: { distance: number; x: number; height: number; magnification: number }
  screenOffset?: number
}

const opticsFixture = (
  name: string,
  create: () => PhysicsScene,
  modelId: string,
  expected: ImagingNumbers,
): NumericFixture => {
  const elementId = modelId === THIN_LENS_MODEL ? 'lens-1' : 'mirror-1'
  const derived: Record<string, Quantity> = {
    object_distance: cm(expected.objectDistance),
    object_height: cm(6),
  }
  const targets: Record<string, string> = {
    object_distance: 'candle-object',
    object_height: 'candle-object',
  }
  const elementValues: Record<string, Quantity> = { position_x: cm(0) }
  if (expected.focalLength !== undefined) {
    derived.focal_length = cm(expected.focalLength)
    targets.focal_length = elementId
    elementValues.focal_length = cm(expected.focalLength)
  }
  const objects: NumericFixture['objects'] = [
    { id: 'candle-object', values: { position_x: cm(-expected.objectDistance), height: cm(6) } },
    { id: elementId, values: elementValues },
    { id: 'screen-1', values: { position_x: cm(expected.screenX) } },
  ]
  if (expected.image !== undefined) {
    derived.image_distance = cm(expected.image.distance)
    derived.image_height = cm(expected.image.height)
    derived.magnification = dimensionless(expected.image.magnification)
    targets.image_distance = targets.image_height = targets.magnification = elementId
    objects.push({
      id: 'optical-bench-1',
      values: { image_position_x: cm(expected.image.x), image_height: cm(expected.image.height) },
    })
  }
  if (expected.screenOffset !== undefined) {
    derived.screen_offset = cm(expected.screenOffset)
    targets.screen_offset = 'screen-1'
  }
  const imageCheck = modelId === THIN_LENS_MODEL
    ? 'thin_lens_equation'
    : modelId === CURVED_MIRROR_MODEL ? 'curved_mirror_equation' : 'mirror_image_symmetry'
  return {
    name, create, modelId, objects, derived, targets,
    checks: [
      ...(expected.image === undefined ? ['rays_parallel_at_focus'] : [imageCheck, 'principal_rays_converge']),
      'virtual_image_uncatchable',
    ],
  }
}

// Textbook magnitudes in cm; the signed image positions distinguish transmission from reflection.
const convergingZones = [
  { name: 'beyond 2f', u: 30, v: 15, h: 3, m: 0.5, lensX: 15, mirrorX: -15, lensScreen: 15, mirrorScreen: -15, real: true },
  { name: 'at 2f', u: 20, v: 20, h: 6, m: 1, lensX: 20, mirrorX: -20, lensScreen: 20, mirrorScreen: -20, real: true },
  { name: 'between f and 2f', u: 15, v: 30, h: 12, m: 2, lensX: 30, mirrorX: -30, lensScreen: 30, mirrorScreen: -30, real: true },
  { name: 'inside f', u: 5, v: 10, h: 12, m: 2, lensX: -10, mirrorX: 10, lensScreen: 20, mirrorScreen: -20, real: false },
]
const opticsFixtures: NumericFixture[] = [
  ...convergingZones.flatMap((zone) => [
    opticsFixture(`convex lens ${zone.name}`, () => createConvexLensScene({ now, objectDistance: zone.u }), THIN_LENS_MODEL, {
      objectDistance: zone.u, focalLength: 10, screenX: zone.lensScreen,
      image: { distance: zone.v, x: zone.lensX, height: zone.h, magnification: zone.m },
      screenOffset: zone.real ? 0 : undefined,
    }),
    opticsFixture(`concave mirror ${zone.name}`, () => createConcaveMirrorScene({ now, objectDistance: zone.u }), CURVED_MIRROR_MODEL, {
      objectDistance: zone.u, focalLength: 10, screenX: zone.mirrorScreen,
      image: { distance: zone.v, x: zone.mirrorX, height: zone.h, magnification: zone.m },
      screenOffset: zone.real ? 0 : undefined,
    }),
  ]),
  opticsFixture('convex lens at focus', () => createConvexLensScene({ now, objectDistance: 10 }), THIN_LENS_MODEL, {
    objectDistance: 10, focalLength: 10, screenX: 20,
  }),
  opticsFixture('concave mirror at focus', () => createConcaveMirrorScene({ now, objectDistance: 10 }), CURVED_MIRROR_MODEL, {
    objectDistance: 10, focalLength: 10, screenX: -20,
  }),
  opticsFixture('concave thin lens', () => createOpticalBenchScene({
    now, sceneId: 'plan-concave-lens',
    object: { id: 'candle-object', position: -30, height: 6 },
    element: { id: 'lens-1', type: 'thin_lens', position: 0, focalLength: -10 },
    screen: { id: 'screen-1', position: 20 },
  }), THIN_LENS_MODEL, {
    objectDistance: 30, focalLength: -10, screenX: 20,
    image: { distance: 7.5, x: -7.5, height: 1.5, magnification: 0.25 },
  }),
  opticsFixture('plane mirror', () => createPlaneMirrorScene({ now }), PLANE_MIRROR_MODEL, {
    objectDistance: 10, screenX: 10,
    image: { distance: 10, x: 10, height: 6, magnification: 1 },
  }),
  opticsFixture('convex curved mirror', () => createConvexMirrorScene({ now }), CURVED_MIRROR_MODEL, {
    objectDistance: 30, focalLength: -10, screenX: -20,
    image: { distance: 7.5, x: 7.5, height: 1.5, magnification: 0.25 },
  }),
  opticsFixture('convex lens with displaced screen', () => createConvexLensScene({ now, screenPosition: 22 }), THIN_LENS_MODEL, {
    objectDistance: 30, focalLength: 10, screenX: 22, screenOffset: 7,
    image: { distance: 15, x: 15, height: 3, magnification: 0.5 },
  }),
]

const lightFixture = (
  name: string,
  create: () => PhysicsScene,
  modelId: string,
  derived: Record<string, Quantity>,
  checks: string[],
): NumericFixture => ({
  name, create, modelId, derived, checks,
  objects: [{ id: 'light-bench-1', values: derived }],
  targets: Object.fromEntries(Object.keys(derived).map((key) => [key, 'light-bench-1'])),
})
const pinholeChecks = ['image_from_straight_rays', 'image_is_inverted', 'image_scales_with_both_distances']
const refractionChecks = ['snell_law_holds', 'critical_angle_grazes_the_boundary', 'refraction_vanishes_past_the_critical_angle']
const criticalIndexPairs = [
  { name: 'half ratio', incidentIndex: 2, refractedIndex: 1 },
  { name: 'sqrt-two glass', incidentIndex: Math.SQRT2, refractedIndex: 1 },
  { name: 'sqrt-three transmitted index', incidentIndex: 2, refractedIndex: Math.sqrt(3) },
  { name: 'sqrt-three glass', incidentIndex: Math.sqrt(3), refractedIndex: 1 },
  { name: 'scaled sqrt-three ratio', incidentIndex: 3, refractedIndex: Math.sqrt(3) },
  ...[1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4].map((incidentIndex) => ({
    name: `glass index ${incidentIndex}`, incidentIndex, refractedIndex: 1,
  })),
]
const lightFixtures: NumericFixture[] = [
  lightFixture('pinhole reduced image', () => createPinholeScene({ now }), PINHOLE_MODEL, {
    object_height: metres(0.06), object_distance: metres(0.3), screen_distance: metres(0.15),
    magnification: dimensionless(0.5), image_height: metres(0.03), inverted: dimensionless(-1),
  }, pinholeChecks),
  lightFixture('pinhole magnified image', () => createPinholeScene({ now, objectHeight: 8, objectDistance: 40, screenDistance: 60 }), PINHOLE_MODEL, {
    object_height: metres(0.08), object_distance: metres(0.4), screen_distance: metres(0.6),
    magnification: dimensionless(1.5), image_height: metres(0.12), inverted: dimensionless(-1),
  }, pinholeChecks),
  lightFixture('total internal reflection', () => createTotalReflectionScene({ now }), TOTAL_REFLECTION_MODEL, {
    incident_index: dimensionless(1.5), refracted_index: dimensionless(1), incident_angle: radians(Math.PI / 4),
    critical_angle: radians(Math.asin(2 / 3)), total_internal_reflection: dimensionless(-1),
  }, refractionChecks),
  lightFixture('refraction below the critical angle', () => createTotalReflectionScene({ now, incidentAngle: 30 }), TOTAL_REFLECTION_MODEL, {
    incident_index: dimensionless(1.5), refracted_index: dimensionless(1), incident_angle: radians(Math.PI / 6),
    critical_angle: radians(Math.asin(2 / 3)), refracted_angle: radians(Math.asin(0.75)), total_internal_reflection: dimensionless(1),
  }, refractionChecks),
  lightFixture('refraction into a denser medium without a critical angle', () => createTotalReflectionScene({ now, incidentIndex: 1, refractedIndex: 1.5, incidentAngle: 45 }), TOTAL_REFLECTION_MODEL, {
    incident_index: dimensionless(1), refracted_index: dimensionless(1.5), incident_angle: radians(Math.PI / 4),
    refracted_angle: radians(Math.asin(Math.SQRT2 / 3)), total_internal_reflection: dimensionless(1),
  }, refractionChecks),
]

interface EngineSuite {
  name: string
  createEngine: () => StaticEngine
  createRequest: typeof createOpticsSimulationRequest
  engineId: string
  engineVersion: string
  solver: string
  copiesTimelineEnd: boolean
  fixtures: NumericFixture[]
}
const suites: EngineSuite[] = [
  {
    name: 'OpticsEngine', createEngine: () => new OpticsEngine(), createRequest: createOpticsSimulationRequest,
    engineId: OPTICS_ENGINE_ID, engineVersion: OPTICS_ENGINE_VERSION, solver: 'geometric-imaging-closed-form',
    copiesTimelineEnd: true, fixtures: opticsFixtures,
  },
  {
    name: 'LightEngine', createEngine: () => new LightEngine(), createRequest: createLightSimulationRequest,
    engineId: LIGHT_ENGINE_ID, engineVersion: LIGHT_ENGINE_VERSION, solver: 'rectilinear-geometry-closed-form',
    copiesTimelineEnd: false, fixtures: lightFixtures,
  },
]
const sceneOf = (fixture: NumericFixture): PhysicsScene => ({ ...fixture.create(), revision: 7 })
const requestOf = (suite: EngineSuite, scene: PhysicsScene, fixture: NumericFixture, options: SimulationOptions = {}): SimulationRequest => ({
  ...suite.createRequest(scene, `plan-${fixture.name}`, `trace-${fixture.name}`), options,
})
const physicsCheckIds = new Set([
  'thin_lens_equation', 'curved_mirror_equation', 'mirror_image_symmetry', 'principal_rays_converge',
  'rays_parallel_at_focus', 'virtual_image_uncatchable', ...pinholeChecks, ...refractionChecks,
])

afterEach(() => vi.restoreAllMocks())

const forbidden = (name: string) => (): never => {
  throw new Error(`prepareSimulationPlan must not call ${name}`)
}
const prepareWithoutExecution = (engine: StaticEngine, scene: PhysicsScene, request: SimulationRequest): SimulationPlan => {
  const before = JSON.stringify({ scene, request })
  try {
    // quantity is the exported seam used by the private state/derived builders; model resolution uses canonicalValue instead.
    const blocked = [
      vi.spyOn(engine, 'simulate').mockImplementation(forbidden('simulate')),
      vi.spyOn(engine, 'stateAt').mockImplementation(forbidden('stateAt')),
      vi.spyOn(engine, 'canHandle').mockImplementation(forbidden('canHandle')),
      vi.spyOn(engine, 'validate').mockImplementation(forbidden('validate')),
      vi.spyOn(quantities, 'quantity').mockImplementation(forbidden('quantity/state construction')),
      vi.spyOn(sceneValidation, 'validateScene').mockImplementation(forbidden('validateScene')),
      vi.spyOn(verification, 'check').mockImplementation(forbidden('verification checks')),
      vi.spyOn(verification, 'summarizeVerification').mockImplementation(forbidden('summarizeVerification')),
      vi.spyOn(sampling, 'trajectoryStorageSampleCount').mockImplementation(forbidden('trajectoryStorageSampleCount')),
      vi.spyOn(sampling, 'trajectorySampleTimes').mockImplementation(forbidden('trajectorySampleTimes')),
      vi.spyOn(simulation, 'eventsInSimulationRange').mockImplementation(forbidden('event projection')),
      vi.spyOn(imaging, 'imagingResultOf').mockImplementation(forbidden('imagingResultOf')),
      vi.spyOn(imaging, 'thinLensOutcome').mockImplementation(forbidden('thinLensOutcome')),
      vi.spyOn(imaging, 'planeMirrorOutcome').mockImplementation(forbidden('planeMirrorOutcome')),
      vi.spyOn(imaging, 'curvedMirrorOutcome').mockImplementation(forbidden('curvedMirrorOutcome')),
      vi.spyOn(imaging, 'lensZoneOf').mockImplementation(forbidden('lensZoneOf')),
      vi.spyOn(rays, 'constructedImageTopOf').mockImplementation(forbidden('constructedImageTopOf')),
      vi.spyOn(rays, 'principalRaysOf').mockImplementation(forbidden('principalRaysOf')),
      vi.spyOn(rays, 'lineIntersection').mockImplementation(forbidden('lineIntersection')),
      vi.spyOn(light, 'pinholeReadingOf').mockImplementation(forbidden('pinholeReadingOf')),
      vi.spyOn(light, 'refractionReadingOf').mockImplementation(forbidden('refractionReadingOf')),
      vi.spyOn(light, 'pinholeMagnification').mockImplementation(forbidden('pinholeMagnification')),
      vi.spyOn(light, 'pinholeImageHeight').mockImplementation(forbidden('pinholeImageHeight')),
      vi.spyOn(light, 'imagePointOf').mockImplementation(forbidden('imagePointOf')),
      vi.spyOn(light, 'criticalAngleOf').mockImplementation(forbidden('criticalAngleOf')),
      vi.spyOn(light, 'refractedAngleOf').mockImplementation(forbidden('refractedAngleOf')),
    ]
    const opticalResolver = vi.spyOn(opticalModels, 'resolveOpticalModel')
    const lightResolver = vi.spyOn(lightModels, 'resolveLightModel')
    const assertion = vi.spyOn(simulation, 'assertSimulationPlan')
    const plan = engine.prepareSimulationPlan(scene, request)
    for (const spy of blocked) expect(spy).not.toHaveBeenCalled()
    expect(engine instanceof OpticsEngine ? opticalResolver : lightResolver).toHaveBeenCalledExactlyOnceWith(scene)
    expect(engine instanceof OpticsEngine ? lightResolver : opticalResolver).not.toHaveBeenCalled()
    expect(assertion).toHaveBeenCalledExactlyOnceWith(plan)
    expect(JSON.stringify({ scene, request })).toBe(before)
    return plan
  } finally {
    vi.restoreAllMocks()
  }
}

const expectPlan = (plan: SimulationPlan, suite: EngineSuite, fixture: NumericFixture, scene: PhysicsScene, request: SimulationRequest, startTime: number, endTime: number) => {
  simulation.assertSimulationPlan(plan)
  expect(plan).toEqual({
    schemaVersion: 'simulation-plan/1.0', engineId: suite.engineId, engineVersion: suite.engineVersion,
    simulationId: request.simulationId, sceneId: scene.id, sceneRevision: scene.revision,
    modelId: fixture.modelId, kind: 'static', startTime, endTime,
    storageSampleCountBound: 1, numericalIterationCountBound: 0,
    metadata: {
      numericalIterationAccounting: suite.name === 'OpticsEngine'
        ? 'No numerical integration; one static state. Algebraic imaging and fixed ray-construction verification are excluded.'
        : 'No numerical integration; one static state. Algebraic light readings and fixed verification checks are excluded.',
    },
  })
  for (const bound of [plan.storageSampleCountBound, plan.numericalIterationCountBound, plan.sceneRevision]) {
    expect(Number.isSafeInteger(bound)).toBe(true)
    expect(bound).toBeGreaterThanOrEqual(0)
  }
  expect(Number.isFinite(plan.startTime)).toBe(true)
  expect(Number.isFinite(plan.endTime)).toBe(true)
  expect(plan.endTime).toBeGreaterThanOrEqual(plan.startTime)
}
const expectScalar = (actual: DerivedQuantity['value'] | undefined, expected: Quantity) => {
  if (actual === undefined || !isScalarQuantity(actual)) throw new Error('Expected a scalar quantity.')
  expect(actual.unit).toBe(expected.unit)
  expect(actual.dimension).toBe(expected.dimension)
  expect(Number.isFinite(actual.value)).toBe(true)
  expect(actual.value).toBeCloseTo(expected.value, 12)
}
const expectNumbers = (result: SimulationResult, fixture: NumericFixture) => {
  const state = result.states[0]
  if (state === undefined) throw new Error('Expected a static state.')
  expect(state.objects.map((entry) => entry.id)).toEqual(fixture.objects.map((entry) => entry.id))
  for (const expected of fixture.objects) {
    const actual = state.objects.find((entry) => entry.id === expected.id)
    expect(Object.keys(actual?.values ?? {}).sort()).toEqual(Object.keys(expected.values).sort())
    for (const [key, value] of Object.entries(expected.values)) expectScalar(actual?.values?.[key], value)
  }
  expect(result.derivedQuantities.map((entry) => entry.key)).toEqual(Object.keys(fixture.derived))
  for (const [key, value] of Object.entries(fixture.derived)) {
    expectScalar(derivedScalar(result.derivedQuantities, key), value)
    const entry = result.derivedQuantities.find((entry) => entry.key === key)
    expect(entry?.targetId).toBe(fixture.targets[key])
    expect(entry?.formula?.expression.length ?? 0).toBeGreaterThan(0)
    expect(entry?.assumptions?.length ?? 0).toBeGreaterThan(0)
  }
  expect(state.derived).toEqual(result.derivedQuantities)
  expect(result.verification.status).toBe('passed')
  expect(result.verification.errors).toEqual([])
  expect(result.verification.warnings).toEqual([])
  expect(result.verification.checks.every((entry) => entry.passed)).toBe(true)
  expect(result.verification.checks.filter((entry) => physicsCheckIds.has(entry.id)).map((entry) => entry.id)).toEqual(fixture.checks)
}
const expectExecution = (result: SimulationResult, plan: SimulationPlan, suite: EngineSuite, scene: PhysicsScene, request: SimulationRequest) => {
  expect(result).toMatchObject({
    schemaVersion: 'simulation-result/1.0', simulationId: plan.simulationId,
    sceneId: plan.sceneId, sceneRevision: plan.sceneRevision,
    metadata: { engineId: suite.engineId, engineVersion: suite.engineVersion, solver: suite.solver, deterministic: true, durationMs: 0 },
  })
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states[0]?.time).toEqual(seconds(plan.startTime))
  expect(result.measurements).toEqual([])
  expect(result.trace).toBe(request.trace)
  // Light's existing time-zero event is inclusive at zero, absent from every positive-start window.
  expect(result.events).toEqual(suite.name === 'LightEngine' && plan.startTime === 0 ? [{
    eventId: 'event-light-image-light-bench-1', sceneId: scene.id, revision: scene.revision,
    type: 'LightImageFormed', time: 0,
  }] : [])
}
const expectUnchangedPhysics = (actual: SimulationResult, reference: SimulationResult) => {
  expect(actual.states[0]?.objects).toEqual(reference.states[0]?.objects)
  expect(actual.states[0]?.derived).toEqual(reference.states[0]?.derived)
  expect(actual.derivedQuantities).toEqual(reference.derivedQuantities)
  expect(actual.verification).toEqual(reference.verification)
  expect(actual.measurements).toEqual(reference.measurements)
  expect(actual.trace).toEqual(reference.trace)
}
const expectErrorCode = (run: () => unknown, code: string) => {
  let error: unknown
  try { run() } catch (caught: unknown) { error = caught }
  expect(error).toBeInstanceOf(PhysicsOSError)
  expect(error).toMatchObject({ code })
}

describe('Snell critical-angle roundoff in actual light simulations', () => {
  it('snaps only machine-roundoff neighbors on both sides of sine one', () => {
    const withSine = (sine: number) => light.refractedAngleOf(sine, 1, Math.PI / 2)
    expect(withSine(1 - Number.EPSILON)).toBe(Math.PI / 2)
    expect(withSine(1 + Number.EPSILON)).toBe(Math.PI / 2)
    expect(withSine(1 - 8 * Number.EPSILON)).toBe(Math.PI / 2)
    expect(withSine(1 + 8 * Number.EPSILON)).toBe(Math.PI / 2)
    expect(withSine(1 - 16 * Number.EPSILON)).toBeLessThan(Math.PI / 2)
    expect(withSine(1 + 16 * Number.EPSILON)).toBeUndefined()
    expect(withSine(1 + 1e-12)).toBeUndefined()
    expect(withSine(1 + light.LIGHT_RELATIVE_TOLERANCE / 2)).toBeUndefined()
    expect(light.refractedAngleOf(1, 1.5, 0)).toBe(0)
  })

  for (const pair of criticalIndexPairs) {
    it(`${pair.name} keeps grazing, below-critical, and above-critical results with exact static plans`, () => {
      const critical = light.criticalAngleOf(pair.incidentIndex, pair.refractedIndex)
      if (critical === undefined) throw new Error('Expected a critical angle for a denser incident medium.')
      const cases = [
        { name: 'critical', angle: critical, totalInternalReflection: false },
        { name: 'below critical', angle: critical - 1e-12, totalInternalReflection: false },
        { name: 'above critical', angle: critical + 1e-12, totalInternalReflection: true },
      ]
      const suite = suites.find((entry) => entry.name === 'LightEngine')
      if (suite === undefined) throw new Error('Expected the LightEngine suite.')
      const engine = new LightEngine()
      for (const entry of cases) {
        const angle = light.refractedAngleOf(pair.incidentIndex, pair.refractedIndex, entry.angle)
        if (entry.totalInternalReflection) {
          expect(angle).toBeUndefined()
        } else {
          expect(angle).toBeDefined()
          expect(Number.isFinite(angle)).toBe(true)
          if (entry.name === 'critical') expect(angle).toBe(Math.PI / 2)
          else expect(angle).toBeLessThan(Math.PI / 2)
        }
        const reading = light.refractionReadingOf({
          type: 'total_reflection', benchId: 'light-bench-1',
          incidentIndex: pair.incidentIndex, refractedIndex: pair.refractedIndex,
          incidentAngle: entry.angle,
        })
        expect(reading.totalInternalReflection).toBe(entry.totalInternalReflection)
        expect(reading.refractedAngle).toBe(angle)

        const source = createTotalReflectionScene({
          now, sceneId: `plan-critical-${pair.name}-${entry.name}`,
          incidentIndex: pair.incidentIndex, refractedIndex: pair.refractedIndex,
        })
        const bench = source.lightBenches?.[0]
        if (bench === undefined) throw new Error('Expected a refraction bench.')
        // Radians avoid adding an authoring-degree round trip to the arithmetic regression.
        const scene: PhysicsScene = {
          ...source,
          lightBenches: [{ ...bench, incidentAngle: radians(entry.angle) }],
        }
        const derived: Record<string, Quantity> = {
          incident_index: dimensionless(pair.incidentIndex),
          refracted_index: dimensionless(pair.refractedIndex),
          incident_angle: radians(entry.angle),
          critical_angle: radians(critical),
          ...(angle === undefined ? {} : { refracted_angle: radians(angle) }),
          total_internal_reflection: dimensionless(entry.totalInternalReflection ? -1 : 1),
        }
        const fixture = lightFixture(`${pair.name} ${entry.name}`, () => scene, TOTAL_REFLECTION_MODEL, derived, refractionChecks)
        const request = createLightSimulationRequest(scene, `sim-${fixture.name}`, `trace-${fixture.name}`)
        request.options = {
          startTime: quantities.quantity(250, 'ms', 'time'),
          endTime: seconds(2),
          outputSampleRate: 7,
        }
        const plan = prepareWithoutExecution(engine, scene, request)
        expectPlan(plan, suite, fixture, scene, request, 0.25, 2)
        const result = engine.simulate(scene, request)
        expectExecution(result, plan, suite, scene, request)
        expectNumbers(result, fixture)
        const refracted = result.derivedQuantities.find((quantity) => quantity.key === 'refracted_angle')
        if (entry.totalInternalReflection) {
          expect(refracted).toBeUndefined()
        } else {
          if (angle === undefined) throw new Error('Expected a refracted ray below or at critical.')
          expectScalar(refracted?.value, radians(angle))
        }
        expect(result.verification.checks.find((check) => check.id === 'critical_angle_grazes_the_boundary')?.passed).toBe(true)
      }
      // The public factory authors degrees, so its round trip must retain the grazing boundary too.
      const degreesScene = createTotalReflectionScene({
        now, sceneId: `plan-critical-degrees-${pair.name}`,
        incidentIndex: pair.incidentIndex, refractedIndex: pair.refractedIndex,
        incidentAngle: critical * 180 / Math.PI,
      })
      const degreesRequest = createLightSimulationRequest(degreesScene, `sim-critical-degrees-${pair.name}`, `trace-critical-degrees-${pair.name}`)
      const degreesPlan = engine.prepareSimulationPlan(degreesScene, degreesRequest)
      expect(degreesPlan).toMatchObject({ kind: 'static', startTime: 0, endTime: 0, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
      const degreesResult = engine.simulate(degreesScene, degreesRequest)
      expect(derivedScalar(degreesResult.derivedQuantities, 'refracted_angle')).toEqual(radians(Math.PI / 2))
      expect(derivedScalar(degreesResult.derivedQuantities, 'total_internal_reflection')).toEqual(dimensionless(1))
      expect(degreesResult.verification.status).toBe('passed')
      expect(light.refractedAngleOf(pair.incidentIndex, pair.refractedIndex, critical - 1e-4)).toBeLessThan(Math.PI / 2)
      expect(light.refractedAngleOf(pair.incidentIndex, pair.refractedIndex, critical + 1e-4)).toBeUndefined()
    })
  }
})

for (const suite of suites) {
  describe(`${suite.name} engine-owned static simulation plan`, () => {
    for (const fixture of suite.fixtures) {
      describe(fixture.name, () => {
        it('plans without execution and matches the numeric default result with options {}', () => {
          const engine = suite.createEngine()
          const scene = sceneOf(fixture)
          const request = requestOf(suite, scene, fixture)
          const before = JSON.stringify({ scene, request })
          expect(request.options).toEqual({})
          const plan = prepareWithoutExecution(engine, scene, request)
          expectPlan(plan, suite, fixture, scene, request, 0, 0)
          const result = engine.simulate(scene, request)
          expectExecution(result, plan, suite, scene, request)
          expectNumbers(result, fixture)
          expect(result.states[0]).toEqual(engine.stateAt(scene, seconds(0)))
          expect(JSON.stringify({ scene, request })).toBe(before)
        })

        it('retains the full non-SI window while storing only the canonical start state', () => {
          const engine = suite.createEngine()
          const scene = sceneOf(fixture)
          const reference = engine.simulate(scene, requestOf(suite, scene, fixture))
          const request = requestOf(suite, scene, fixture, {
            startTime: quantities.quantity(1250, 'ms', 'time'), endTime: quantities.quantity(2, 'min', 'time'),
          })
          const before = JSON.stringify({ scene, request })
          const plan = prepareWithoutExecution(engine, scene, request)
          expectPlan(plan, suite, fixture, scene, request, 1.25, 120)
          const result = engine.simulate(scene, request)
          expectExecution(result, plan, suite, scene, request)
          expectNumbers(result, fixture)
          expectUnchangedPhysics(result, reference)
          expect(result.states[0]).toEqual(engine.stateAt(scene, seconds(plan.startTime)))
          const endState = engine.stateAt(scene, seconds(plan.endTime))
          expect(endState.objects).toEqual(result.states[0]?.objects)
          expect(endState.derived).toEqual(result.states[0]?.derived)
          expect(JSON.stringify({ scene, request })).toBe(before)
        })

        it('uses start as end when omitted, and accepts an explicit equal non-SI end', () => {
          const engine = suite.createEngine()
          const scene = sceneOf(fixture)
          const reference = engine.simulate(scene, requestOf(suite, scene, fixture))
          for (const options of [
            { startTime: quantities.quantity(0.5, 'min', 'time') },
            { startTime: quantities.quantity(30000, 'ms', 'time'), endTime: seconds(30) },
          ]) {
            const request = requestOf(suite, scene, fixture, options)
            const before = JSON.stringify({ scene, request })
            const plan = prepareWithoutExecution(engine, scene, request)
            expectPlan(plan, suite, fixture, scene, request, 30, 30)
            const result = engine.simulate(scene, request)
            expectExecution(result, plan, suite, scene, request)
            expectNumbers(result, fixture)
            expectUnchangedPhysics(result, reference)
            expect(JSON.stringify({ scene, request })).toBe(before)
          }
        })

        it('keeps count and computation constant for sampling knobs and a sparse 1e12-second window', () => {
          const engine = suite.createEngine()
          const scene = sceneOf(fixture)
          const requests = [
            { options: { outputSampleRate: 4096 }, start: 0, end: 0 },
            { options: { endTime: seconds(120), outputSampleRate: 4096, timeStep: quantities.quantity(0.1, 'ms', 'time'), maxIterations: Number.MAX_SAFE_INTEGER }, start: 0, end: 120 },
            { options: { startTime: quantities.quantity(250, 'ms', 'time'), endTime: seconds(1e12), outputSampleRate: 2, timeStep: quantities.quantity(1, 'ms', 'time'), maxIterations: 1 }, start: 0.25, end: 1e12 },
          ].map(({ options, start, end }) => {
            const request = requestOf(suite, scene, fixture, options)
            const before = JSON.stringify({ scene, request })
            const plan = prepareWithoutExecution(engine, scene, request)
            expectPlan(plan, suite, fixture, scene, request, start, end)
            return { request, plan, before }
          })
          try {
            const work = {
              opticalModel: vi.spyOn(opticalModels, 'resolveOpticalModel'),
              lightModel: vi.spyOn(lightModels, 'resolveLightModel'),
              imaging: vi.spyOn(imaging, 'imagingResultOf'),
              stateQuantities: vi.spyOn(quantities, 'quantity'),
              validateScene: vi.spyOn(sceneValidation, 'validateScene'),
              verificationChecks: vi.spyOn(verification, 'check'),
              verificationSummary: vi.spyOn(verification, 'summarizeVerification'),
              constructedRays: vi.spyOn(rays, 'constructedImageTopOf'),
              principalRays: vi.spyOn(rays, 'principalRaysOf'),
              pinholeReading: vi.spyOn(light, 'pinholeReadingOf'),
              refractionReading: vi.spyOn(light, 'refractionReadingOf'),
              imagePoints: vi.spyOn(light, 'imagePointOf'),
              pinholeHeight: vi.spyOn(light, 'pinholeImageHeight'),
              pinholeMagnification: vi.spyOn(light, 'pinholeMagnification'),
              criticalAngle: vi.spyOn(light, 'criticalAngleOf'),
              refractedAngle: vi.spyOn(light, 'refractedAngleOf'),
              storageSamples: vi.spyOn(sampling, 'trajectoryStorageSampleCount'),
              sampleTimes: vi.spyOn(sampling, 'trajectorySampleTimes'),
              events: vi.spyOn(simulation, 'eventsInSimulationRange'),
            }
            const counts = () => Object.fromEntries(Object.entries(work).map(([name, spy]) => [name, spy.mock.calls.length]))
            const reference = engine.simulate(scene, requestOf(suite, scene, fixture))
            const referenceCounts = counts()
            expect(suite.name === 'OpticsEngine' ? work.opticalModel : work.lightModel).toHaveBeenCalledExactlyOnceWith(scene)
            expect(work.validateScene).toHaveBeenCalledExactlyOnceWith(scene)
            expect(work.stateQuantities).toHaveBeenCalled()
            expect(work.storageSamples).not.toHaveBeenCalled()
            expect(work.sampleTimes).not.toHaveBeenCalled()
            expect(work.principalRays).not.toHaveBeenCalled()
            if (suite.name === 'OpticsEngine') {
              expect(work.imaging).toHaveBeenCalledTimes(1)
              expect(work.constructedRays).toHaveBeenCalledTimes(1)
            } else {
              expect(fixture.modelId === PINHOLE_MODEL ? work.pinholeReading : work.refractionReading).toHaveBeenCalled()
            }
            expectNumbers(reference, fixture)
            for (const { request, plan, before } of requests) {
              for (const spy of Object.values(work)) spy.mockClear()
              const result = engine.simulate(scene, request)
              expect(counts()).toEqual(referenceCounts)
              expectExecution(result, plan, suite, scene, request)
              expectNumbers(result, fixture)
              expectUnchangedPhysics(result, reference)
              expect(JSON.stringify({ scene, request })).toBe(before)
            }
          } finally {
            vi.restoreAllMocks()
          }
        })
      })
    }

    it('ignores scene timeline values unless the request builder explicitly copies endTime', () => {
      const fixture = suite.fixtures[0]!
      const engine = suite.createEngine()
      const source = sceneOf(fixture)
      const scene: PhysicsScene = {
        ...source,
        timeline: { ...source.timeline, startTime: quantities.quantity(1, 'min', 'time'), currentTime: seconds(90), endTime: quantities.quantity(2, 'min', 'time'), simulationTimeStep: quantities.quantity(5, 'ms', 'time') },
      }
      const direct = requestOf(suite, scene, fixture)
      const directPlan = prepareWithoutExecution(engine, scene, direct)
      expectPlan(directPlan, suite, fixture, scene, direct, 0, 0)
      const reference = engine.simulate(scene, direct)
      expectExecution(reference, directPlan, suite, scene, direct)
      expectNumbers(reference, fixture)

      const built = suite.createRequest(scene, direct.simulationId, direct.trace.traceId)
      expect(built.options).toEqual(suite.copiesTimelineEnd ? { endTime: scene.timeline.endTime } : {})
      if (suite.copiesTimelineEnd) expect(built.options.endTime).toBe(scene.timeline.endTime)
      const before = JSON.stringify({ scene, built })
      const builtPlan = prepareWithoutExecution(engine, scene, built)
      expectPlan(builtPlan, suite, fixture, scene, built, 0, suite.copiesTimelineEnd ? 120 : 0)
      const result = engine.simulate(scene, built)
      expectExecution(result, builtPlan, suite, scene, built)
      expectNumbers(result, fixture)
      expectUnchangedPhysics(result, reference)
      expect(result.events).toEqual(reference.events)
      expect(JSON.stringify({ scene, built })).toBe(before)

      const noEndScene: PhysicsScene = { ...scene, timeline: { ...scene.timeline, endTime: undefined } }
      const noEnd = suite.createRequest(noEndScene, direct.simulationId, direct.trace.traceId)
      expect(noEnd.options).toEqual({})
      noEnd.options.startTime = quantities.quantity(500, 'ms', 'time')
      const noEndPlan = prepareWithoutExecution(engine, noEndScene, noEnd)
      expectPlan(noEndPlan, suite, fixture, noEndScene, noEnd, 0.5, 0.5)
      const noEndResult = engine.simulate(noEndScene, noEnd)
      expectExecution(noEndResult, noEndPlan, suite, noEndScene, noEnd)
      expectNumbers(noEndResult, fixture)
    })

    it('refuses a different scene id or revision in both planning and execution', () => {
      const fixture = suite.fixtures[0]!
      const engine = suite.createEngine()
      const scene = sceneOf(fixture)
      const request = requestOf(suite, scene, fixture)
      for (const mismatch of [
        { ...request, sceneId: asSceneId('another-optics-scene') },
        { ...request, sceneRevision: scene.revision + 1 },
      ]) {
        expectErrorCode(() => engine.prepareSimulationPlan(scene, mismatch), 'SIMULATION_SCENE_MISMATCH')
        expectErrorCode(() => engine.simulate(scene, mismatch), 'SIMULATION_SCENE_MISMATCH')
      }
    })

    it('rejects invalid matching revisions through the shared plan assertion', () => {
      const fixture = suite.fixtures[0]!
      const engine = suite.createEngine()
      for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const scene: PhysicsScene = { ...sceneOf(fixture), revision }
        const request = requestOf(suite, scene, fixture)
        expectErrorCode(() => engine.prepareSimulationPlan(scene, request), 'INVALID_SIMULATION_PLAN')
        expectErrorCode(() => engine.simulate(scene, request), 'INVALID_SIMULATION_PLAN')
      }
    })

    const rawTime = (value: number, unit = 's'): Quantity<'time'> => ({ value, unit, dimension: 'time' })
    const invalidRanges: { name: string; options: SimulationOptions; code: string }[] = [
      { name: 'negative start', options: { startTime: seconds(-1) }, code: 'INVALID_SIMULATION_RANGE' },
      { name: 'negative end', options: { endTime: seconds(-1) }, code: 'INVALID_SIMULATION_RANGE' },
      { name: 'end before start', options: { startTime: seconds(2), endTime: seconds(1) }, code: 'INVALID_SIMULATION_RANGE' },
      { name: 'reversed mixed-unit range', options: { startTime: quantities.quantity(1, 'min', 'time'), endTime: seconds(59) }, code: 'INVALID_SIMULATION_RANGE' },
      // Raw wire quantities let the engine, rather than the fixture's quantity constructor, reject non-finite input.
      { name: 'NaN start', options: { startTime: rawTime(Number.NaN) }, code: 'NON_FINITE_VALUE' },
      { name: 'infinite start', options: { startTime: rawTime(Infinity) }, code: 'NON_FINITE_VALUE' },
      { name: 'negative infinite start', options: { startTime: rawTime(-Infinity) }, code: 'NON_FINITE_VALUE' },
      { name: 'NaN end', options: { endTime: rawTime(Number.NaN) }, code: 'NON_FINITE_VALUE' },
      { name: 'infinite end', options: { endTime: rawTime(Infinity) }, code: 'NON_FINITE_VALUE' },
      { name: 'negative infinite end', options: { endTime: rawTime(-Infinity) }, code: 'NON_FINITE_VALUE' },
      { name: 'canonical start overflow', options: { startTime: rawTime(Number.MAX_VALUE, 'min') }, code: 'NON_FINITE_VALUE' },
      { name: 'canonical end overflow', options: { endTime: rawTime(Number.MAX_VALUE, 'min') }, code: 'NON_FINITE_VALUE' },
    ]
    for (const invalid of invalidRanges) {
      it(`refuses ${invalid.name} in both planning and execution`, () => {
        const fixture = suite.fixtures[0]!
        const engine = suite.createEngine()
        const scene = sceneOf(fixture)
        const request = requestOf(suite, scene, fixture, invalid.options)
        expectErrorCode(() => engine.prepareSimulationPlan(scene, request), invalid.code)
        expectErrorCode(() => engine.simulate(scene, request), invalid.code)
      })
    }
  })
}
