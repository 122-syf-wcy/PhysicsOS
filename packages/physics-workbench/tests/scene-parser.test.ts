import { describe, expect, it } from 'vitest'
import { quantityVector } from '@physicsos/physics-core'
import {
  createCircuitScene,
  createElectricScene,
  createMagneticScene,
  createThermometerBenchScene,
  parsePhysicsScene,
  type Force,
  type MeasurementDefinition,
  type ObservableDefinition,
  type PhysicsScene,
  type SceneAnnotation,
  type SceneMetadata,
  type SceneParseIssue,
  type Timeline,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asComponentId, asObservableId, asQuestionId, asSceneId } from '@physicsos/shared'

import { FIXTURE_TIME, makeCompleteScene, makeEmptyScene } from './scene-fixtures.ts'

type FilePath = readonly (string | number)[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isArray = (value: unknown): value is unknown[] => Array.isArray(value)

const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected a fixture data object.')
  return value
}
const array = (value: unknown): unknown[] => {
  if (!isArray(value)) throw new Error('Expected a fixture data array.')
  return value
}
const first = <T>(values: readonly T[]): T => {
  const value = values[0]
  if (value === undefined) throw new Error('Expected a non-empty fixture collection.')
  return value
}

/** Invalid imported files remain unknown data rather than counterfeit scenes. */
const fileScene = (scene: PhysicsScene = makeCompleteScene()): Record<string, unknown> => {
  const value: unknown = JSON.parse(JSON.stringify(scene))
  return record(value)
}
const fileValue = (input: unknown, path: FilePath): unknown => {
  let value = input
  for (const key of path) value = typeof key === 'number' ? array(value)[key] : record(value)[key]
  return value
}
const setFileValue = (input: unknown, path: FilePath, value: unknown): void => {
  const key = path[path.length - 1]
  if (key === undefined) throw new Error('Expected a non-empty fixture property path.')
  const parent = fileValue(input, path.slice(0, -1))
  if (typeof key === 'number') array(parent)[key] = value
  else record(parent)[key] = value
}
const deleteFileValue = (input: unknown, path: FilePath): void => {
  const key = path[path.length - 1]
  if (typeof key !== 'string') throw new Error('Expected an object property to delete.')
  delete record(fileValue(input, path.slice(0, -1)))[key]
}

const parsedScene = (input: unknown): PhysicsScene => {
  const result = parsePhysicsScene(input)
  if (!result.ok) throw new Error(`Unexpected parser issues: ${JSON.stringify(result.issues)}`)
  expect(result.ok).toBe(true)
  return result.value
}
const issues = (input: unknown): readonly SceneParseIssue[] => {
  const result = parsePhysicsScene(input)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected the unknown scene input to be rejected.')
  expect(result.issues.length).toBeGreaterThan(0)
  return result.issues
}
const pointerPath = (path: string): string => path === '$'
  ? ''
  : path.slice(1).replace(/\[(\d+)\]/g, '/$1').replace(/\./g, '/')
const issueAt = (input: unknown, path: string, code: string): void => {
  expect(issues(input)).toEqual(expect.arrayContaining([expect.objectContaining({ path: pointerPath(path), code })]))
}

const mandatoryCollections: (keyof PhysicsScene)[] = [
  'bodies', 'particles', 'fields', 'forces', 'regions', 'boundaries', 'constraints', 'circuits',
  'opticalBenches', 'acousticBenches', 'fluidTanks', 'thermalBenches', 'leverBenches',
  'measurementDefinitions', 'observableDefinitions', 'annotations',
]
const optionalCollections: (keyof PhysicsScene)[] = [
  'inductionBenches', 'waveBenches', 'cyclotronBenches', 'modernPhysicsBenches', 'pressureBenches',
  'currentBenches', 'energyBenches', 'lightBenches', 'transformerBenches', 'thermometerBenches', 'noiseBenches',
]

describe('parsePhysicsScene complete contract', () => {
  it('preserves every field, union, collection and safe extension unchanged', () => {
    const scene: PhysicsScene = makeCompleteScene()
    const value = parsedScene(scene)
    expect(value).toStrictEqual(scene)
    expect(JSON.stringify(value)).toBe(JSON.stringify(scene))
    expect(value).not.toBe(scene)

    expect(value.bodies.map((entry) => entry.shape.type)).toEqual(['circle', 'rectangle', 'polygon', 'segment', 'point'])
    expect(value.fields.map((entry) => entry.type)).toEqual(['uniform_electric', 'uniform_magnetic', 'uniform_gravity', 'point_charge'])
    expect(value.forces.map((entry) => entry.type)).toEqual(['gravity', 'normal', 'friction', 'tension', 'spring', 'electric', 'lorentz', 'ampere', 'drag', 'custom'])
    expect(value.regions.map((entry) => entry.shape.type)).toEqual(['rectangle', 'circle', 'polygon', 'half_plane', 'unbounded'])
    expect(value.boundaries.map((entry) => entry.type)).toEqual(['line', 'segment', 'circle', 'rectangle', 'polygon'])
    expect(value.boundaries.map((entry) => entry.behavior?.type)).toEqual(['pass_through', 'stop', 'reflect', 'custom', undefined])
    expect(value.constraints.map((entry) => entry.type)).toEqual(['fixed', 'distance', 'rope', 'hinge', 'surface', 'spring', 'track', 'custom'])
    expect(first(value.circuits).components.map((entry) => entry.type)).toEqual(['voltage_source', 'resistor', 'switch', 'ammeter', 'voltmeter', 'variable_resistor', 'capacitor', 'inductor'])
    expect(first(value.opticalBenches).elements.map((entry) => entry.type)).toEqual(['thin_lens', 'plane_mirror', 'curved_mirror'])
    expect(first(value.leverBenches).hangers.map((entry) => entry.side)).toEqual(['left', 'right'])
    expect(value.inductionBenches?.map((entry) => entry.type)).toEqual(['bar_motion', 'flux_change', 'double_bar_rail'])
    expect(value.waveBenches?.map((entry) => entry.type)).toEqual(['travelling', 'interference', 'standing', 'longitudinal', 'reflection_refraction', 'diffraction', 'doppler'])
    expect(value.cyclotronBenches?.map((entry) => entry.magneticOrientation)).toEqual(['into_page', 'out_of_page'])
    expect(value.modernPhysicsBenches?.map((entry) => entry.type)).toEqual(['photoelectric_effect'])
    expect(value.pressureBenches?.map((entry) => entry.type)).toEqual(['solid', 'liquid', 'atmospheric'])
    expect(value.currentBenches?.map((entry) => entry.type)).toEqual(['straight_wire', 'solenoid', 'electromagnet', 'motor'])
    expect(value.lightBenches?.map((entry) => entry.type)).toEqual(['pinhole', 'total_reflection'])
    expect(value.measurementDefinitions.map((entry) => entry.type)).toEqual(['position', 'velocity', 'acceleration', 'force', 'energy', 'current', 'voltage', 'electric_field', 'magnetic_field', 'custom'])
    expect(value.observableDefinitions.map((entry) => entry.type)).toEqual(['force', 'velocity', 'acceleration', 'momentum', 'trajectory', 'electric_field', 'electric_potential', 'magnetic_field', 'energy', 'current', 'voltage', 'measurement', 'graph', 'geometry', 'annotation'])
    expect(value.annotations.map((entry) => entry.type)).toEqual(['label', 'formula', 'marker', 'guide', 'teacher_note'])
    expect(value.metadata.experimentNotebook?.entries).toStrictEqual(scene.metadata.experimentNotebook?.entries)
    for (const name of [...mandatoryCollections, ...optionalCollections]) expect(value[name]).toStrictEqual(scene[name])
  })

  it('accepts a real JSON file of the complete typed scene', () => {
    const scene: PhysicsScene = makeCompleteScene()
    const input: unknown = JSON.parse(JSON.stringify(scene))
    expect(parsedScene(input)).toStrictEqual(scene)
  })

  it('keeps required empty lists and does not invent absent specialist lists', () => {
    const scene: PhysicsScene = makeEmptyScene()
    const value = parsedScene(scene)
    expect(value).toStrictEqual(scene)
    for (const name of mandatoryCollections) expect(value[name]).toEqual([])
    for (const name of optionalCollections) expect(Object.prototype.hasOwnProperty.call(value, name)).toBe(false)
  })

  it('accepts every explicitly empty optional specialist collection', () => {
    const input = fileScene(makeEmptyScene())
    for (const name of optionalCollections) input[name] = []
    const value = parsedScene(input)
    for (const name of optionalCollections) expect(value[name]).toEqual([])
  })

  const builderScenes: [string, PhysicsScene][] = [
    ['electric', createElectricScene({ now: FIXTURE_TIME })],
    ['magnetic', createMagneticScene({ now: FIXTURE_TIME })],
    ['thermometer', createThermometerBenchScene({ now: FIXTURE_TIME })],
    ['circuit', createCircuitScene({
      now: FIXTURE_TIME,
      components: [
        { id: 'source', type: 'voltage_source', voltage: 6, terminals: { positive: 'high', negative: 'low' } },
        { id: 'resistor-1', type: 'resistor', resistance: 10, terminals: { a: 'high', b: 'low' } },
        { id: 'resistor-2', type: 'resistor', resistance: 20, terminals: { a: 'high', b: 'low' } },
      ],
    })],
  ]
  for (const [name, scene] of builderScenes) {
    it(`preserves the existing root ${name} builder output exactly`, () => {
      expect(parsedScene(scene)).toStrictEqual(scene)
      expect(parsedScene(fileScene(scene))).toStrictEqual(scene)
    })
  }

  const states: Timeline['state'][] = ['idle', 'running', 'paused', 'completed', 'error']
  for (const state of states) {
    it(`accepts timeline state ${state} and zero-duration static timelines`, () => {
      const scene = makeEmptyScene()
      scene.timeline.state = state
      expect(parsedScene(scene)).toStrictEqual(scene)
    })
  }

  it('accepts the maximum safe revision without rounding', () => {
    const scene = makeEmptyScene()
    scene.revision = Number.MAX_SAFE_INTEGER
    expect(parsedScene(scene).revision).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('does not require engine-solvable or physically positive authored quantities', () => {
    const scene = makeCompleteScene()
    first(scene.bodies).mass.value = -1
    first(scene.particles).mass.value = 0
    first(scene.bodies).material = { frictionCoefficient: -1, staticFrictionCoefficient: -2, restitution: 2 }
    const resistor = first(scene.circuits).components.find((entry) => entry.type === 'resistor')
    if (resistor === undefined || resistor.type !== 'resistor') throw new Error('Expected a fixture resistor.')
    resistor.resistance.value = 0
    const rheostat = first(scene.circuits).components.find((entry) => entry.type === 'variable_resistor')
    if (rheostat === undefined || rheostat.type !== 'variable_resistor') throw new Error('Expected a fixture rheostat.')
    rheostat.sliderPosition = -0.5
    first(scene.opticalBenches).object.height.value = 0
    const lens = first(first(scene.opticalBenches).elements)
    if (lens.type !== 'thin_lens') throw new Error('Expected a fixture thin lens.')
    lens.focalLength.value = 0
    lens.apertureRadius = quantity(-1, 'cm', 'length')
    first(scene.acousticBenches).soundSpeed.value = 0
    first(scene.acousticBenches).reflector.position.value = -1
    first(scene.fluidTanks).block.volume.value = 0
    first(scene.fluidTanks).liquid.density.value = -1
    first(scene.thermalBenches).heaterPower.value = 0
    first(scene.thermalBenches).runDuration = quantity(0, 's', 'time')
    first(first(scene.leverBenches).hangers).mass.value = 0
    const energy = first(scene.energyBenches ?? [])
    energy.mass.value = 0
    energy.inclineAngle.value = 0
    first(scene.modernPhysicsBenches ?? []).quantumEfficiency = 2
    expect(parsedScene(scene)).toStrictEqual(scene)

    const draft = makeEmptyScene('incomplete-specialist-draft')
    draft.leverBenches = [{ id: 'lever-draft', type: 'lever_bench', beamLength: quantity(0, 'm', 'length'), gravity: quantity(0, 'm/s^2', 'acceleration'), hangers: [] }]
    draft.pressureBenches = [{ id: 'solid-draft', type: 'solid' }, { id: 'liquid-draft', type: 'liquid' }, { id: 'atmospheric-draft', type: 'atmospheric' }]
    draft.currentBenches = [{ id: 'motor-draft', type: 'motor' }, { id: 'solenoid-draft', type: 'solenoid' }]
    draft.lightBenches = [{ id: 'pinhole-draft', type: 'pinhole' }, { id: 'reflection-draft', type: 'total_reflection' }]
    draft.inductionBenches = [{ id: 'rail-draft', type: 'double_bar_rail', magneticFluxDensity: quantity(0, 'T', 'magnetic_flux_density'), resistance: quantity(0, 'Ω', 'resistance') }]
    draft.waveBenches = [{ id: 'standing-draft', type: 'standing', amplitude: quantity(0, 'm', 'length'), frequency: quantity(0, 'Hz', 'frequency'), harmonic: 0.5 }]
    expect(parsedScene(draft)).toStrictEqual(draft)
  })
})

describe('complete contract rejection', () => {
  const nonScenes: unknown[] = [null, [], true, 1, 'physics-scene/1.0', undefined, {}]
  for (const [index, input] of nonScenes.entries()) {
    it(`rejects non-scene input ${index} with structured issues`, () => {
      const result = issues(input)
      for (const issue of result) {
        expect(typeof issue.path).toBe('string')
        expect(typeof issue.code).toBe('string')
        expect(typeof issue.message).toBe('string')
        expect(issue.path === '' || issue.path.startsWith('/')).toBe(true)
        expect(issue.message.length).toBeGreaterThan(0)
      }
    })
  }

  it('rejects a four-field JSON shell rather than claiming it is a PhysicsScene', () => {
    const input: unknown = JSON.parse('{"schemaVersion":"physics-scene/1.0","id":"draft","revision":0,"dimension":"2d"}')
    issueAt(input, '$.coordinateSystem', 'missing_property')
    issueAt(input, '$.timeline', 'missing_property')
    issueAt(input, '$.metadata', 'missing_property')
    issueAt(input, '$.bodies', 'missing_property')
  })

  for (const name of mandatoryCollections) {
    it(`rejects a file missing mandatory collection ${name}`, () => {
      const input = fileScene()
      delete input[name]
      issueAt(input, `$.${name}`, 'missing_property')
    })
  }
  for (const name of [...mandatoryCollections, ...optionalCollections]) {
    it(`rejects a non-array ${name} collection when present`, () => {
      const input = fileScene()
      input[name] = null
      issueAt(input, `$.${name}`, 'invalid_type')
    })
  }

  const missingFields: [FilePath, string][] = [
    [['bodies', 0, 'mass'], '$.bodies[0].mass'],
    [['particles', 0, 'position'], '$.particles[0].position'],
    [['fields', 0, 'fieldStrength'], '$.fields[0].fieldStrength'],
    [['forces', 0, 'targetId'], '$.forces[0].targetId'],
    [['regions', 0, 'center'], '$.regions[0].center'],
    [['boundaries', 0, 'geometry'], '$.boundaries[0].geometry'],
    [['constraints', 0, 'parameters'], '$.constraints[0].parameters'],
    [['circuits', 0, 'nodes'], '$.circuits[0].nodes'],
    [['circuits', 0, 'connections', 0, 'from'], '$.circuits[0].connections[0].from'],
    [['circuits', 0, 'components', 0, 'voltage'], '$.circuits[0].components[0].voltage'],
    [['opticalBenches', 0, 'object'], '$.opticalBenches[0].object'],
    [['opticalBenches', 0, 'elements'], '$.opticalBenches[0].elements'],
    [['opticalBenches', 0, 'elements', 0, 'focalLength'], '$.opticalBenches[0].elements[0].focalLength'],
    [['acousticBenches', 0, 'reflector'], '$.acousticBenches[0].reflector'],
    [['fluidTanks', 0, 'liquid'], '$.fluidTanks[0].liquid'],
    [['thermalBenches', 0, 'sample', 'solidSpecificHeat'], '$.thermalBenches[0].sample.solidSpecificHeat'],
    [['leverBenches', 0, 'hangers'], '$.leverBenches[0].hangers'],
    [['inductionBenches', 0, 'resistance'], '$.inductionBenches[0].resistance'],
    [['waveBenches', 0, 'frequency'], '$.waveBenches[0].frequency'],
    [['cyclotronBenches', 0, 'gapVoltage'], '$.cyclotronBenches[0].gapVoltage'],
    [['modernPhysicsBenches', 0, 'lightIntensity'], '$.modernPhysicsBenches[0].lightIntensity'],
    [['energyBenches', 0, 'releaseHeight'], '$.energyBenches[0].releaseHeight'],
    [['transformerBenches', 0, 'secondaryTurns'], '$.transformerBenches[0].secondaryTurns'],
    [['thermometerBenches', 0, 'expansionCoefficient'], '$.thermometerBenches[0].expansionCoefficient'],
    [['noiseBenches', 0, 'barrierAttenuation'], '$.noiseBenches[0].barrierAttenuation'],
    [['measurementDefinitions', 0, 'enabled'], '$.measurementDefinitions[0].enabled'],
    [['observableDefinitions', 0, 'visible'], '$.observableDefinitions[0].visible'],
    [['annotations', 0, 'content'], '$.annotations[0].content'],
    [['metadata', 'createdAt'], '$.metadata.createdAt'],
  ]
  for (const [path, location] of missingFields) {
    it(`requires nested contract field ${location}`, () => {
      const input = fileScene()
      deleteFileValue(input, path)
      issueAt(input, location, 'missing_property')
    })
  }

  const wrongUnions: [FilePath, string, string, string][] = [
    [['schemaVersion'], '$.schemaVersion', 'physics-scene/2.0', 'invalid_literal'],
    [['dimension'], '$.dimension', '4d', 'invalid_enum'],
    [['coordinateSystem', 'type'], '$.coordinateSystem.type', 'polar', 'invalid_literal'],
    [['timeline', 'state'], '$.timeline.state', 'ready', 'invalid_enum'],
    [['bodies', 0, 'type'], '$.bodies[0].type', 'particle', 'invalid_literal'],
    [['bodies', 0, 'shape', 'type'], '$.bodies[0].shape.type', 'sphere', 'invalid_union'],
    [['particles', 0, 'type'], '$.particles[0].type', 'rigid_body', 'invalid_literal'],
    [['fields', 0, 'type'], '$.fields[0].type', 'electric', 'invalid_union'],
    [['forces', 0, 'type'], '$.forces[0].type', 'push', 'invalid_enum'],
    [['regions', 0, 'shape', 'type'], '$.regions[0].shape.type', 'segment', 'invalid_union'],
    [['boundaries', 0, 'type'], '$.boundaries[0].type', 'plane', 'invalid_enum'],
    [['boundaries', 0, 'behavior', 'type'], '$.boundaries[0].behavior.type', 'bounce', 'invalid_union'],
    [['constraints', 0, 'type'], '$.constraints[0].type', 'joint', 'invalid_enum'],
    [['circuits', 0, 'type'], '$.circuits[0].type', 'network', 'invalid_literal'],
    [['circuits', 0, 'components', 0, 'type'], '$.circuits[0].components[0].type', 'battery', 'invalid_union'],
    [['circuits', 0, 'components', 2, 'state'], '$.circuits[0].components[2].state', 'unknown', 'invalid_enum'],
    [['opticalBenches', 0, 'type'], '$.opticalBenches[0].type', 'optics', 'invalid_literal'],
    [['opticalBenches', 0, 'elements', 0, 'type'], '$.opticalBenches[0].elements[0].type', 'prism', 'invalid_union'],
    [['acousticBenches', 0, 'type'], '$.acousticBenches[0].type', 'echo', 'invalid_literal'],
    [['fluidTanks', 0, 'type'], '$.fluidTanks[0].type', 'tank', 'invalid_literal'],
    [['thermalBenches', 0, 'type'], '$.thermalBenches[0].type', 'heating', 'invalid_literal'],
    [['leverBenches', 0, 'hangers', 0, 'side'], '$.leverBenches[0].hangers[0].side', 'middle', 'invalid_enum'],
    [['inductionBenches', 0, 'type'], '$.inductionBenches[0].type', 'rod', 'invalid_enum'],
    [['waveBenches', 0, 'type'], '$.waveBenches[0].type', 'transverse', 'invalid_enum'],
    [['waveBenches', 6, 'sourceDirection'], '$.waveBenches[6].sourceDirection', 'stationary', 'invalid_enum'],
    [['waveBenches', 6, 'observerDirection'], '$.waveBenches[6].observerDirection', 'moving', 'invalid_enum'],
    [['cyclotronBenches', 0, 'magneticOrientation'], '$.cyclotronBenches[0].magneticOrientation', 'left', 'invalid_enum'],
    [['modernPhysicsBenches', 0, 'type'], '$.modernPhysicsBenches[0].type', 'fission', 'invalid_literal'],
    [['pressureBenches', 0, 'type'], '$.pressureBenches[0].type', 'gas', 'invalid_enum'],
    [['currentBenches', 0, 'type'], '$.currentBenches[0].type', 'coil', 'invalid_enum'],
    [['energyBenches', 0, 'type'], '$.energyBenches[0].type', 'ramp', 'invalid_literal'],
    [['lightBenches', 0, 'type'], '$.lightBenches[0].type', 'reflection', 'invalid_enum'],
    [['transformerBenches', 0, 'type'], '$.transformerBenches[0].type', 'coil', 'invalid_literal'],
    [['thermometerBenches', 0, 'type'], '$.thermometerBenches[0].type', 'digital', 'invalid_literal'],
    [['noiseBenches', 0, 'type'], '$.noiseBenches[0].type', 'sound', 'invalid_literal'],
    [['measurementDefinitions', 0, 'type'], '$.measurementDefinitions[0].type', 'temperature', 'invalid_enum'],
    [['observableDefinitions', 0, 'type'], '$.observableDefinitions[0].type', 'pressure', 'invalid_enum'],
    [['observableDefinitions', 0, 'style', 'emphasis'], '$.observableDefinitions[0].style.emphasis', 'strong', 'invalid_enum'],
    [['annotations', 0, 'type'], '$.annotations[0].type', 'html', 'invalid_enum'],
  ]
  for (const [path, location, value, code] of wrongUnions) {
    it(`rejects unsupported union value at ${location}`, () => {
      const input = fileScene()
      setFileValue(input, path, value)
      issueAt(input, location, code)
    })
  }

  const wrongTypes: [FilePath, string, unknown][] = [
    [['coordinateSystem', 'origin', 'x'], '$.coordinateSystem.origin.x', '0'],
    [['coordinateSystem', 'axes', 'x'], '$.coordinateSystem.axes.x', [1, 0, 0]],
    [['bodies', 0, 'fixed'], '$.bodies[0].fixed', 'false'],
    [['bodies', 0, 'tags', 0], '$.bodies[0].tags[0]', 1],
    [['bodies', 2, 'shape', 'vertices'], '$.bodies[2].shape.vertices', {}],
    [['regions', 3, 'shape', 'normal', 'z'], '$.regions[3].shape.normal.z', false],
    [['forces', 0, 'derived'], '$.forces[0].derived', 1],
    [['constraints', 0, 'targets'], '$.constraints[0].targets', 'body-circle'],
    [['constraints', 0, 'parameters'], '$.constraints[0].parameters', []],
    [['circuits', 0, 'components', 5, 'sliderPosition'], '$.circuits[0].components[5].sliderPosition', '0.5'],
    [['opticalBenches', 0, 'elements', 0, 'enabled'], '$.opticalBenches[0].elements[0].enabled', 1],
    [['waveBenches', 2, 'harmonic'], '$.waveBenches[2].harmonic', '2'],
    [['waveBenches', 5, 'diffractionOrder'], '$.waveBenches[5].diffractionOrder', '1'],
    [['modernPhysicsBenches', 0, 'quantumEfficiency'], '$.modernPhysicsBenches[0].quantumEfficiency', '0.25'],
    [['observableDefinitions', 0, 'style', 'scale'], '$.observableDefinitions[0].style.scale', 'large'],
    [['annotations', 0, 'visible'], '$.annotations[0].visible', 1],
    [['metadata', 'curriculumTags', 0], '$.metadata.curriculumTags[0]', 1],
  ]
  for (const [path, location, value] of wrongTypes) {
    it(`rejects incorrect field structure at ${location}`, () => {
      const input = fileScene()
      setFileValue(input, path, value)
      issueAt(input, location, 'invalid_type')
    })
  }

  it('rejects missing vector coordinates instead of silently supplying zero', () => {
    const input = fileScene()
    deleteFileValue(input, ['particles', 0, 'velocity', 'vector', 'z'])
    issueAt(input, '$.particles[0].velocity.vector.z', 'missing_property')
  })

  it('rejects properties outside the closed contract instead of dropping them', () => {
    const input = fileScene()
    setFileValue(input, ['bodies', 0, 'render'], { component: 'not-a-domain-field' })
    issueAt(input, '$.bodies[0].render', 'unexpected_property')
  })

  const invalidRevisions = [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]
  for (const value of invalidRevisions) {
    it(`rejects unsafe or non-integral revision ${value}`, () => {
      const input = fileScene()
      input['revision'] = value
      issueAt(input, '$.revision', 'invalid_revision')
    })
  }

  it('requires non-empty identifiers, but not a particular prefix', () => {
    const input = fileScene()
    input['id'] = '   '
    issueAt(input, '$.id', 'invalid_identifier')
    setFileValue(input, ['bodies', 0, 'id'], 1)
    issueAt(input, '$.bodies[0].id', 'invalid_identifier')
  })

  it('rejects invalid coordinate units, zero axes and backwards timelines', () => {
    const invalidUnit = fileScene()
    setFileValue(invalidUnit, ['coordinateSystem', 'lengthUnit'], 's')
    issueAt(invalidUnit, '$.coordinateSystem.lengthUnit', 'dimension_mismatch')
    const zeroAxis = makeEmptyScene()
    zeroAxis.coordinateSystem.axes.x = { x: 0, y: 0, z: 0 }
    issueAt(zeroAxis, '$.coordinateSystem.axes.x', 'invalid_axis')
    const backwards = makeEmptyScene()
    backwards.timeline.startTime = quantity(1, 'min', 'time')
    backwards.timeline.endTime = quantity(59, 's', 'time')
    issueAt(backwards, '$.timeline.endTime', 'invalid_time_range')
  })

  for (const playbackRate of [0, -1]) {
    it(`requires a positive playback rate rather than ${playbackRate}`, () => {
      const scene = makeEmptyScene()
      scene.timeline.playbackRate = playbackRate
      issueAt(scene, '$.timeline.playbackRate', 'invalid_playback_rate')
    })
  }
  for (const value of [0, -1]) {
    it(`requires a positive simulation time step rather than ${value}`, () => {
      const scene = makeEmptyScene()
      scene.timeline.simulationTimeStep = quantity(value, 's', 'time')
      issueAt(scene, '$.timeline.simulationTimeStep.value', 'invalid_time_step')
    })
  }
})

describe('quantity dimensions, units and finite conversion', () => {
  const dimensionCases: [FilePath, string][] = [
    [['timeline', 'currentTime'], '$.timeline.currentTime'],
    [['timeline', 'simulationTimeStep'], '$.timeline.simulationTimeStep'],
    [['bodies', 0, 'mass'], '$.bodies[0].mass'],
    [['bodies', 0, 'position'], '$.bodies[0].position'],
    [['bodies', 0, 'acceleration'], '$.bodies[0].acceleration'],
    [['bodies', 0, 'shape', 'radius'], '$.bodies[0].shape.radius'],
    [['bodies', 1, 'shape', 'width'], '$.bodies[1].shape.width'],
    [['bodies', 2, 'shape', 'vertices', 0], '$.bodies[2].shape.vertices[0]'],
    [['bodies', 3, 'shape', 'end'], '$.bodies[3].shape.end'],
    [['bodies', 0, 'material', 'density'], '$.bodies[0].material.density'],
    [['particles', 0, 'charge'], '$.particles[0].charge'],
    [['particles', 0, 'velocity'], '$.particles[0].velocity'],
    [['fields', 0, 'fieldStrength'], '$.fields[0].fieldStrength'],
    [['fields', 1, 'magneticFluxDensity'], '$.fields[1].magneticFluxDensity'],
    [['fields', 2, 'acceleration'], '$.fields[2].acceleration'],
    [['forces', 0, 'vector'], '$.forces[0].vector'],
    [['regions', 0, 'center'], '$.regions[0].center'],
    [['regions', 3, 'shape', 'offset'], '$.regions[3].shape.offset'],
    [['boundaries', 0, 'geometry', 'start'], '$.boundaries[0].geometry.start'],
    [['circuits', 0, 'components', 0, 'voltage'], '$.circuits[0].components[0].voltage'],
    [['circuits', 0, 'components', 0, 'internalResistance'], '$.circuits[0].components[0].internalResistance'],
    [['circuits', 0, 'components', 1, 'resistance'], '$.circuits[0].components[1].resistance'],
    [['circuits', 0, 'components', 3, 'internalResistance'], '$.circuits[0].components[3].internalResistance'],
    [['circuits', 0, 'components', 4, 'internalResistance'], '$.circuits[0].components[4].internalResistance'],
    [['circuits', 0, 'components', 5, 'totalResistance'], '$.circuits[0].components[5].totalResistance'],
    [['circuits', 0, 'components', 6, 'capacitance'], '$.circuits[0].components[6].capacitance'],
    [['circuits', 0, 'components', 6, 'initialVoltage'], '$.circuits[0].components[6].initialVoltage'],
    [['circuits', 0, 'components', 7, 'inductance'], '$.circuits[0].components[7].inductance'],
    [['opticalBenches', 0, 'object', 'height'], '$.opticalBenches[0].object.height'],
    [['opticalBenches', 0, 'elements', 0, 'apertureRadius'], '$.opticalBenches[0].elements[0].apertureRadius'],
    [['opticalBenches', 0, 'elements', 2, 'focalLength'], '$.opticalBenches[0].elements[2].focalLength'],
    [['opticalBenches', 0, 'screen', 'position'], '$.opticalBenches[0].screen.position'],
    [['acousticBenches', 0, 'soundSpeed'], '$.acousticBenches[0].soundSpeed'],
    [['fluidTanks', 0, 'block', 'mass'], '$.fluidTanks[0].block.mass'],
    [['fluidTanks', 0, 'block', 'volume'], '$.fluidTanks[0].block.volume'],
    [['fluidTanks', 0, 'liquid', 'density'], '$.fluidTanks[0].liquid.density'],
    [['fluidTanks', 0, 'lowerRate'], '$.fluidTanks[0].lowerRate'],
    [['fluidTanks', 0, 'gravity'], '$.fluidTanks[0].gravity'],
    [['thermalBenches', 0, 'sample', 'solidSpecificHeat'], '$.thermalBenches[0].sample.solidSpecificHeat'],
    [['thermalBenches', 0, 'sample', 'liquidSpecificHeat'], '$.thermalBenches[0].sample.liquidSpecificHeat'],
    [['thermalBenches', 0, 'sample', 'latentHeat'], '$.thermalBenches[0].sample.latentHeat'],
    [['thermalBenches', 0, 'sample', 'meltingPoint'], '$.thermalBenches[0].sample.meltingPoint'],
    [['thermalBenches', 0, 'sample', 'boilingPoint'], '$.thermalBenches[0].sample.boilingPoint'],
    [['thermalBenches', 0, 'sample', 'vaporizationHeat'], '$.thermalBenches[0].sample.vaporizationHeat'],
    [['thermalBenches', 0, 'comparisonSample', 'initialTemperature'], '$.thermalBenches[0].comparisonSample.initialTemperature'],
    [['thermalBenches', 0, 'heaterPower'], '$.thermalBenches[0].heaterPower'],
    [['thermalBenches', 0, 'runDuration'], '$.thermalBenches[0].runDuration'],
    [['leverBenches', 0, 'gravity'], '$.leverBenches[0].gravity'],
    [['leverBenches', 0, 'hangers', 0, 'armLength'], '$.leverBenches[0].hangers[0].armLength'],
    [['inductionBenches', 0, 'barVelocity'], '$.inductionBenches[0].barVelocity'],
    [['inductionBenches', 1, 'coilArea'], '$.inductionBenches[1].coilArea'],
    [['inductionBenches', 1, 'coilAngle'], '$.inductionBenches[1].coilAngle'],
    [['inductionBenches', 1, 'fluxRate'], '$.inductionBenches[1].fluxRate'],
    [['inductionBenches', 2, 'barMasses', 0], '$.inductionBenches[2].barMasses[0]'],
    [['inductionBenches', 2, 'barVelocities', 1], '$.inductionBenches[2].barVelocities[1]'],
    [['inductionBenches', 2, 'barPositions', 0], '$.inductionBenches[2].barPositions[0]'],
    [['inductionBenches', 2, 'externalForce'], '$.inductionBenches[2].externalForce'],
    [['waveBenches', 0, 'frequency'], '$.waveBenches[0].frequency'],
    [['waveBenches', 2, 'waveSpeed'], '$.waveBenches[2].waveSpeed'],
    [['waveBenches', 4, 'incidentAngle'], '$.waveBenches[4].incidentAngle'],
    [['waveBenches', 4, 'transmittedWaveSpeed'], '$.waveBenches[4].transmittedWaveSpeed'],
    [['waveBenches', 6, 'sourceSpeed'], '$.waveBenches[6].sourceSpeed'],
    [['waveBenches', 6, 'observerSpeed'], '$.waveBenches[6].observerSpeed'],
    [['cyclotronBenches', 0, 'magneticFluxDensity'], '$.cyclotronBenches[0].magneticFluxDensity'],
    [['cyclotronBenches', 0, 'gapVoltage'], '$.cyclotronBenches[0].gapVoltage'],
    [['modernPhysicsBenches', 0, 'workFunction'], '$.modernPhysicsBenches[0].workFunction'],
    [['modernPhysicsBenches', 0, 'lightIntensity'], '$.modernPhysicsBenches[0].lightIntensity'],
    [['modernPhysicsBenches', 0, 'cathodeArea'], '$.modernPhysicsBenches[0].cathodeArea'],
    [['pressureBenches', 0, 'force'], '$.pressureBenches[0].force'],
    [['pressureBenches', 0, 'comparisonArea'], '$.pressureBenches[0].comparisonArea'],
    [['pressureBenches', 1, 'comparisonLiquidDensity'], '$.pressureBenches[1].comparisonLiquidDensity'],
    [['pressureBenches', 2, 'atmosphericPressure'], '$.pressureBenches[2].atmosphericPressure'],
    [['currentBenches', 0, 'current'], '$.currentBenches[0].current'],
    [['currentBenches', 1, 'comparisonTurns'], '$.currentBenches[1].comparisonTurns'],
    [['currentBenches', 2, 'coreRelativePermeability'], '$.currentBenches[2].coreRelativePermeability'],
    [['currentBenches', 3, 'coilAngle'], '$.currentBenches[3].coilAngle'],
    [['energyBenches', 0, 'frictionCoefficient'], '$.energyBenches[0].frictionCoefficient'],
    [['lightBenches', 1, 'incidentIndex'], '$.lightBenches[1].incidentIndex'],
    [['lightBenches', 1, 'incidentAngle'], '$.lightBenches[1].incidentAngle'],
    [['transformerBenches', 0, 'primaryVoltage'], '$.transformerBenches[0].primaryVoltage'],
    [['transformerBenches', 0, 'primaryCurrent'], '$.transformerBenches[0].primaryCurrent'],
    [['transformerBenches', 0, 'secondaryTurns'], '$.transformerBenches[0].secondaryTurns'],
    [['thermometerBenches', 0, 'expansionCoefficient'], '$.thermometerBenches[0].expansionCoefficient'],
    [['thermometerBenches', 0, 'temperature'], '$.thermometerBenches[0].temperature'],
    [['noiseBenches', 0, 'soundPowerLevel'], '$.noiseBenches[0].soundPowerLevel'],
    [['noiseBenches', 0, 'barrierAttenuation'], '$.noiseBenches[0].barrierAttenuation'],
  ]
  for (const [path, location] of dimensionCases) {
    it(`requires the exact expected quantity dimension at ${location}`, () => {
      const input = fileScene()
      const value = record(fileValue(input, path))
      value['dimension'] = value['dimension'] === 'mass' ? 'length' : 'mass'
      issueAt(input, `${location}.dimension`, 'dimension_mismatch')
    })
  }

  it('rejects a known unit of the wrong dimension and an unregistered unit', () => {
    const input = fileScene()
    setFileValue(input, ['bodies', 0, 'mass', 'unit'], 's')
    issueAt(input, '$.bodies[0].mass.unit', 'dimension_mismatch')
    setFileValue(input, ['bodies', 0, 'mass', 'unit'], 'made-up-kilograms')
    issueAt(input, '$.bodies[0].mass.unit', 'unknown_unit')
  })

  const nonfiniteValues = [NaN, Infinity, -Infinity]
  const finitePaths: [FilePath, string][] = [
    [['revision'], '$.revision'],
    [['coordinateSystem', 'origin', 'z'], '$.coordinateSystem.origin.z'],
    [['timeline', 'playbackRate'], '$.timeline.playbackRate'],
    [['bodies', 0, 'mass', 'value'], '$.bodies[0].mass.value'],
    [['particles', 1, 'velocity', 'vector', 'x'], '$.particles[1].velocity.vector.x'],
    [['fields', 0, 'fieldStrength', 'vector', 'y'], '$.fields[0].fieldStrength.vector.y'],
    [['regions', 3, 'shape', 'normal', 'x'], '$.regions[3].shape.normal.x'],
    [['boundaries', 2, 'behavior', 'restitution'], '$.boundaries[2].behavior.restitution'],
    [['bodies', 0, 'metadata', 'extension', 'nested', 5, 'x'], '$.bodies[0].metadata.extension.nested[5].x'],
    [['metadata', 'pluginExtension', 'array', 3, 'count'], '$.metadata.pluginExtension.array[3].count'],
    [['bodies', 0, 'material', 'custom', 'layers', 0, 'thickness'], '$.bodies[0].material.custom.layers[0].thickness'],
    [['constraints', 0, 'parameters', 'anchor', 'x'], '$.constraints[0].parameters.anchor.x'],
    [['constraints', 0, 'parameters', 'pivot', 'y'], '$.constraints[0].parameters.pivot.y'],
    [['observableDefinitions', 0, 'parameters', 'graph', 'rows', 0, 1], '$.observableDefinitions[0].parameters.graph.rows[0][1]'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 0, 'value'], '$.metadata.experimentNotebook.entries[0].parameters[0].value'],
  ]
  for (const [path, location] of finitePaths) {
    for (const value of nonfiniteValues) {
      it(`rejects ${String(value)} even in nested data at ${location}`, () => {
        const input = fileScene()
        setFileValue(input, path, value)
        issueAt(input, location, 'non_finite_number')
      })
    }
  }

  it('rejects finite scalars that overflow during canonical conversion', () => {
    const scene = makeCompleteScene()
    first(scene.opticalBenches).object.position = quantity(Number.MAX_VALUE, 'km', 'length')
    issueAt(scene, '$.opticalBenches[0].object.position.value', 'canonical_overflow')
    const input = fileScene()
    setFileValue(input, ['timeline', 'endTime', 'value'], Number.MAX_VALUE)
    issueAt(input, '$.timeline.endTime.value', 'canonical_overflow')
  })

  it('rejects finite vector coordinates that overflow in canonical units', () => {
    const scene = makeCompleteScene()
    first(scene.particles).velocity = quantityVector({ x: Number.MAX_VALUE, y: 0, z: 0 }, 'km/s', 'velocity')
    issueAt(scene, '$.particles[0].velocity.vector.x', 'canonical_overflow')
    scene.coordinateSystem.lengthUnit = 'km'
    scene.coordinateSystem.origin.z = Number.MAX_VALUE
    issueAt(scene, '$.coordinateSystem.origin.z', 'canonical_overflow')
  })

  it('retains finite maximum-size metadata numbers without treating them as quantities', () => {
    const scene = makeEmptyScene()
    Object.assign(scene.metadata, { extension: { large: Number.MAX_VALUE, small: Number.MIN_VALUE } })
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  const tuples = ['barMasses', 'barVelocities', 'barPositions']
  for (const name of tuples) {
    for (const length of [0, 1, 3]) {
      it(`requires exactly two quantities in ${name}, not ${length}`, () => {
        const input = fileScene()
        const original = array(fileValue(input, ['inductionBenches', 2, name]))
        const replacement = Array.from({ length }, (_, index) => original[index % 2])
        setFileValue(input, ['inductionBenches', 2, name], replacement)
        issueAt(input, `$.inductionBenches[2].${name}`, 'invalid_tuple')
      })
    }
  }
})

describe('metadata, release identities, notebooks and provenance', () => {
  const actorTypes: NonNullable<SceneMetadata['createdBy']>['type'][] = ['user', 'agent', 'system', 'teacher', 'migration']
  for (const type of actorTypes) {
    it(`accepts actor type ${type} with or without an id`, () => {
      const scene = makeEmptyScene()
      scene.metadata.createdBy = { type }
      expect(parsedScene(scene)).toStrictEqual(scene)
      scene.metadata.createdBy = { type, id: 'author / arbitrary-id' }
      expect(parsedScene(scene)).toStrictEqual(scene)
    })
  }

  it('preserves shared-compatible offset and fractional scene timestamps', () => {
    const scene = makeCompleteScene()
    const timestamp = '2026-11-08T18:00:00.123456+08:00'
    scene.metadata.createdAt = timestamp
    scene.metadata.updatedAt = timestamp
    if (scene.metadata.lineage === undefined) throw new Error('Expected fixture lineage.')
    scene.metadata.lineage.forkedAt = timestamp
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('preserves notebook recordedAt as a presentation string without inventing a date contract', () => {
    const scene = makeEmptyScene()
    scene.metadata.experimentNotebook = {
      version: 1,
      entries: [{ id: 'reading', recordedAt: 'lesson 2 / local clock', sceneId: 'external-scene', sceneRevision: 0, columns: [], values: [], parameters: [] }],
    }
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('accepts arbitrary non-prefix question and scene brands, with external lineage', () => {
    const scene = makeEmptyScene('Question / 7 / 光学')
    scene.metadata.sourceQuestionId = asQuestionId('Paper 2026 · Question 7')
    scene.metadata.lineage = {
      origin: 'question', branchType: 'experimental', originQuestionId: asQuestionId('自由题号 7'),
      originSceneId: asSceneId('original outside this file'), parentSceneId: asSceneId('parent outside this file'),
      parentRevision: Number.MAX_SAFE_INTEGER, forkedAt: FIXTURE_TIME,
    }
    expect(parsedScene(scene)).toStrictEqual(scene)
    scene.metadata.lineage.origin = 'template'
    delete scene.metadata.lineage.originQuestionId
    expect(parsedScene(scene)).toStrictEqual(scene)
    scene.metadata.lineage.origin = 'blank'
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('preserves official, community and kind-omitted community release identities', () => {
    const scene = makeCompleteScene()
    expect(parsedScene(scene)).toStrictEqual(scene)
    scene.metadata.experimentRelease = { kind: 'community', id: 'published-id', experimentId: 'experiment-id', version: '1.0', sha256: '1'.repeat(64) }
    expect(parsedScene(scene)).toStrictEqual(scene)
    scene.metadata.experimentRelease = { id: 'legacy-id', experimentId: 'experiment-id', version: '0.9', sha256: 'f'.repeat(64) }
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  const malformedMetadata: [FilePath, string, unknown, string][] = [
    [['metadata', 'createdAt'], '$.metadata.createdAt', 'not-a-time', 'invalid_datetime'],
    [['metadata', 'updatedAt'], '$.metadata.updatedAt', 1, 'invalid_type'],
    [['metadata', 'createdBy', 'type'], '$.metadata.createdBy.type', 'assistant', 'invalid_enum'],
    [['metadata', 'createdBy', 'id'], '$.metadata.createdBy.id', 1, 'invalid_type'],
    [['metadata', 'sourceQuestionId'], '$.metadata.sourceQuestionId', '', 'invalid_identifier'],
    [['metadata', 'lineage', 'branchType'], '$.metadata.lineage.branchType', 'original', 'invalid_literal'],
    [['metadata', 'lineage', 'origin'], '$.metadata.lineage.origin', 'clone', 'invalid_enum'],
    [['metadata', 'lineage', 'parentRevision'], '$.metadata.lineage.parentRevision', Number.MAX_SAFE_INTEGER + 1, 'invalid_revision'],
    [['metadata', 'lineage', 'forkedAt'], '$.metadata.lineage.forkedAt', 'never', 'invalid_datetime'],
    [['metadata', 'experimentRelease', 'kind'], '$.metadata.experimentRelease.kind', 'preview', 'invalid_enum'],
    [['metadata', 'experimentRelease', 'id'], '$.metadata.experimentRelease.id', '', 'invalid_identifier'],
    [['metadata', 'experimentNotebook', 'version'], '$.metadata.experimentNotebook.version', 2, 'invalid_literal'],
    [['metadata', 'experimentNotebook', 'entries'], '$.metadata.experimentNotebook.entries', {}, 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'id'], '$.metadata.experimentNotebook.entries[0].id', 1, 'invalid_identifier'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'recordedAt'], '$.metadata.experimentNotebook.entries[0].recordedAt', 1, 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'sceneId'], '$.metadata.experimentNotebook.entries[0].sceneId', '', 'invalid_identifier'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'sceneRevision'], '$.metadata.experimentNotebook.entries[0].sceneRevision', 0.5, 'invalid_revision'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'columns'], '$.metadata.experimentNotebook.entries[0].columns', 'temperature', 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'values', 0], '$.metadata.experimentNotebook.entries[0].values[0]', 25, 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'parameters'], '$.metadata.experimentNotebook.entries[0].parameters', {}, 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 0, 'id'], '$.metadata.experimentNotebook.entries[0].parameters[0].id', 1, 'invalid_identifier'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 0, 'value'], '$.metadata.experimentNotebook.entries[0].parameters[0].value', '25', 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 0, 'unit'], '$.metadata.experimentNotebook.entries[0].parameters[0].unit', 1, 'invalid_type'],
    [['metadata', 'experimentNotebook', 'entries', 1, 'experimentRelease', 'sha256'], '$.metadata.experimentNotebook.entries[1].experimentRelease.sha256', 'not-a-digest', 'invalid_sha256'],
  ]
  for (const [path, location, value, code] of malformedMetadata) {
    it(`validates known metadata field ${location}`, () => {
      const input = fileScene()
      setFileValue(input, path, value)
      issueAt(input, location, code)
    })
  }

  it('requires SHA-256 for both explicit and kind-omitted community releases', () => {
    for (const index of [1, 2]) {
      const input = fileScene()
      deleteFileValue(input, ['metadata', 'experimentNotebook', 'entries', index, 'experimentRelease', 'sha256'])
      issueAt(input, `$.metadata.experimentNotebook.entries[${index}].experimentRelease.sha256`, 'missing_property')
    }
  })

  it('rejects official release fields that belong only to community releases', () => {
    const input = fileScene()
    setFileValue(input, ['metadata', 'experimentRelease', 'sha256'], 'a'.repeat(64))
    issueAt(input, '$.metadata.experimentRelease.sha256', 'unexpected_property')
  })

  it('requires every notebook observation field and parameter field', () => {
    for (const name of ['id', 'recordedAt', 'sceneId', 'sceneRevision', 'columns', 'values', 'parameters']) {
      const input = fileScene()
      deleteFileValue(input, ['metadata', 'experimentNotebook', 'entries', 0, name])
      issueAt(input, `$.metadata.experimentNotebook.entries[0].${name}`, 'missing_property')
    }
    for (const name of ['id', 'value', 'unit']) {
      const input = fileScene()
      deleteFileValue(input, ['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 0, name])
      issueAt(input, `$.metadata.experimentNotebook.entries[0].parameters[0].${name}`, 'missing_property')
    }
  })

  it('rejects mismatched notebook columns and values', () => {
    const input = fileScene()
    setFileValue(input, ['metadata', 'experimentNotebook', 'entries', 0, 'values'], ['one value'])
    issueAt(input, '$.metadata.experimentNotebook.entries[0].values', 'invalid_observation_row')
  })

  it('rejects duplicate notebook entry and parameter identities in their own lists', () => {
    const duplicateEntry = fileScene()
    setFileValue(duplicateEntry, ['metadata', 'experimentNotebook', 'entries', 1, 'id'], 'reading-official')
    issueAt(duplicateEntry, '$.metadata.experimentNotebook.entries[1].id', 'duplicate_id')
    const duplicateParameter = fileScene()
    setFileValue(duplicateParameter, ['metadata', 'experimentNotebook', 'entries', 0, 'parameters', 1, 'id'], 'temperature')
    issueAt(duplicateParameter, '$.metadata.experimentNotebook.entries[0].parameters[1].id', 'duplicate_id')
  })
})

describe('typed references and identity namespaces', () => {
  const invalidReferences: [FilePath, string, string][] = [
    [['fields', 0, 'regionId'], '$.fields[0].regionId', 'missing-region'],
    [['fields', 0, 'regionId'], '$.fields[0].regionId', 'body-circle'],
    [['fields', 3, 'sourceParticleId'], '$.fields[3].sourceParticleId', 'missing-particle'],
    [['fields', 3, 'sourceParticleId'], '$.fields[3].sourceParticleId', 'body-circle'],
    [['forces', 0, 'targetId'], '$.forces[0].targetId', 'missing-target'],
    [['forces', 0, 'sourceId'], '$.forces[0].sourceId', 'missing-source'],
    [['constraints', 0, 'targets', 0], '$.constraints[0].targets[0]', 'missing-target'],
    [['measurementDefinitions', 0, 'targetId'], '$.measurementDefinitions[0].targetId', 'missing-target'],
    [['measurementDefinitions', 5, 'componentId'], '$.measurementDefinitions[5].componentId', 'missing-component'],
    [['measurementDefinitions', 5, 'componentId'], '$.measurementDefinitions[5].componentId', 'particle-probe'],
    [['observableDefinitions', 0, 'targetId'], '$.observableDefinitions[0].targetId', 'missing-target'],
    [['observableDefinitions', 0, 'targetId'], '$.observableDefinitions[0].targetId', 'measurement-position'],
    [['annotations', 0, 'targetId'], '$.annotations[0].targetId', 'missing-target'],
    [['annotations', 0, 'targetId'], '$.annotations[0].targetId', 'observable-force'],
    [['circuits', 0, 'connections', 0, 'from', 'componentId'], '$.circuits[0].connections[0].from.componentId', 'missing-component'],
  ]
  for (const [path, location, value] of invalidReferences) {
    it(`rejects invalid internal reference ${location} = ${value}`, () => {
      const input = fileScene()
      setFileValue(input, path, value)
      issueAt(input, location, 'invalid_reference')
    })
  }

  it('rejects dangling observables when a referenced nested hanger is removed', () => {
    const scene = makeCompleteScene()
    first(scene.leverBenches).hangers = []
    issueAt(scene, '$.observableDefinitions[3].targetId', 'invalid_reference')
  })

  it('accepts generic references to forces, boundaries, constraints and every nested physical target', () => {
    const scene = makeCompleteScene()
    const targets = [
      'body-circle', 'particle-probe', 'field-electric', 'force-gravity', 'region-circle', 'boundary-line', 'constraint-fixed',
      'circuit-main', 'component-source', 'optical-bench', 'optical-object', 'optical-lens', 'optical-screen',
      'acoustic-bench', 'acoustic-source', 'acoustic-reflector', 'fluid-tank', 'tank-block', 'tank-liquid',
      'thermal-bench', 'thermal-sample', 'thermal-comparison', 'lever-bench', 'lever-hanger-left',
      'induction-bar', 'wave-standing', 'cyclotron-into', 'modern-bench', 'pressure-solid', 'current-wire',
      'energy-bench', 'light-pinhole', 'transformer-bench', 'thermometer-bench', 'noise-bench',
    ]
    scene.observableDefinitions = targets.map((targetId, index): ObservableDefinition => ({ id: asObservableId(`target-observable-${index}`), type: 'geometry', targetId, visible: true }))
    scene.measurementDefinitions = targets.map((targetId, index): MeasurementDefinition => ({ id: `target-measurement-${index}`, type: 'custom', targetId, enabled: true }))
    scene.annotations = targets.map((targetId, index): SceneAnnotation => ({ id: `target-annotation-${index}`, type: 'label', targetId, content: targetId, visible: true }))
    scene.constraints = [...scene.constraints, { id: 'all-targets-constraint', type: 'custom', targets, parameters: {} }]
    scene.forces = [...scene.forces, ...targets.map((targetId, index): Force => ({ id: `target-force-${index}`, type: 'custom', targetId, sourceId: targetId }))]
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  const duplicateObjects: [FilePath, string][] = [
    [['particles', 0, 'id'], '$.particles[0].id'],
    [['fields', 0, 'id'], '$.fields[0].id'],
    [['forces', 0, 'id'], '$.forces[0].id'],
    [['regions', 0, 'id'], '$.regions[0].id'],
    [['boundaries', 0, 'id'], '$.boundaries[0].id'],
    [['constraints', 0, 'id'], '$.constraints[0].id'],
    [['circuits', 0, 'id'], '$.circuits[0].id'],
    [['circuits', 0, 'components', 0, 'id'], '$.circuits[0].components[0].id'],
    [['opticalBenches', 0, 'id'], '$.opticalBenches[0].id'],
    [['opticalBenches', 0, 'object', 'id'], '$.opticalBenches[0].object.id'],
    [['opticalBenches', 0, 'elements', 0, 'id'], '$.opticalBenches[0].elements[0].id'],
    [['opticalBenches', 0, 'screen', 'id'], '$.opticalBenches[0].screen.id'],
    [['acousticBenches', 0, 'id'], '$.acousticBenches[0].id'],
    [['acousticBenches', 0, 'source', 'id'], '$.acousticBenches[0].source.id'],
    [['acousticBenches', 0, 'reflector', 'id'], '$.acousticBenches[0].reflector.id'],
    [['fluidTanks', 0, 'id'], '$.fluidTanks[0].id'],
    [['fluidTanks', 0, 'block', 'id'], '$.fluidTanks[0].block.id'],
    [['fluidTanks', 0, 'liquid', 'id'], '$.fluidTanks[0].liquid.id'],
    [['thermalBenches', 0, 'id'], '$.thermalBenches[0].id'],
    [['thermalBenches', 0, 'sample', 'id'], '$.thermalBenches[0].sample.id'],
    [['thermalBenches', 0, 'comparisonSample', 'id'], '$.thermalBenches[0].comparisonSample.id'],
    [['leverBenches', 0, 'id'], '$.leverBenches[0].id'],
    [['leverBenches', 0, 'hangers', 0, 'id'], '$.leverBenches[0].hangers[0].id'],
    [['inductionBenches', 0, 'id'], '$.inductionBenches[0].id'],
    [['waveBenches', 0, 'id'], '$.waveBenches[0].id'],
    [['cyclotronBenches', 0, 'id'], '$.cyclotronBenches[0].id'],
    [['modernPhysicsBenches', 0, 'id'], '$.modernPhysicsBenches[0].id'],
    [['pressureBenches', 0, 'id'], '$.pressureBenches[0].id'],
    [['currentBenches', 0, 'id'], '$.currentBenches[0].id'],
    [['energyBenches', 0, 'id'], '$.energyBenches[0].id'],
    [['lightBenches', 0, 'id'], '$.lightBenches[0].id'],
    [['transformerBenches', 0, 'id'], '$.transformerBenches[0].id'],
    [['thermometerBenches', 0, 'id'], '$.thermometerBenches[0].id'],
    [['noiseBenches', 0, 'id'], '$.noiseBenches[0].id'],
  ]
  for (const [path, location] of duplicateObjects) {
    it(`rejects a global physical identity collision at ${location}`, () => {
      const input = fileScene()
      setFileValue(input, path, 'body-circle')
      issueAt(input, location, 'duplicate_id')
    })
  }

  const duplicateDefinitions: [FilePath, string, string][] = [
    [['measurementDefinitions', 1, 'id'], '$.measurementDefinitions[1].id', 'measurement-position'],
    [['observableDefinitions', 1, 'id'], '$.observableDefinitions[1].id', 'observable-force'],
    [['annotations', 1, 'id'], '$.annotations[1].id', 'annotation-label'],
    [['circuits', 0, 'nodes', 1, 'id'], '$.circuits[0].nodes[1].id', 'net-a'],
    [['circuits', 0, 'connections', 1, 'id'], '$.circuits[0].connections[1].id', 'wire-1'],
  ]
  for (const [path, location, value] of duplicateDefinitions) {
    it(`rejects duplicate definition identity at ${location}`, () => {
      const input = fileScene()
      setFileValue(input, path, value)
      issueAt(input, location, 'duplicate_id')
    })
  }

  it('keeps scene, physical, measurement, observable, annotation and net namespaces separate', () => {
    const scene = makeCompleteScene()
    scene.id = asSceneId('body-circle')
    scene.measurementDefinitions = [{ id: 'body-circle', type: 'custom', targetId: 'body-circle', enabled: true }]
    scene.observableDefinitions = [{ id: asObservableId('body-circle'), type: 'geometry', targetId: 'body-circle', visible: true }]
    scene.annotations = [{ id: 'body-circle', type: 'label', targetId: 'body-circle', content: 'Separate identity namespace', visible: true }]
    first(first(scene.circuits).nodes).id = 'body-circle'
    first(first(scene.circuits).connections).id = 'body-circle'
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('accepts repeated terminal declarations of the same component and key', () => {
    const scene = makeCompleteScene()
    const connections = first(scene.circuits).connections
    expect(first(connections).to.id).toBe(connections[1]?.from.id)
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('rejects terminal identities reused for a different component or key', () => {
    const input = fileScene()
    setFileValue(input, ['circuits', 0, 'connections', 0, 'to', 'id'], 'component-source.positive')
    issueAt(input, '$.circuits[0].connections[0].to.id', 'duplicate_id')
  })

  it('requires one stable identity for repeated declarations of the same terminal', () => {
    const input = fileScene()
    setFileValue(input, ['circuits', 0, 'connections', 1, 'from', 'id'], 'another-terminal-id')
    issueAt(input, '$.circuits[0].connections[1].from.id', 'inconsistent_terminal')
  })

  it('uses source positive/negative keys and a/b keys for every other component', () => {
    const input = fileScene()
    setFileValue(input, ['circuits', 0, 'connections', 0, 'from', 'terminalKey'], 'a')
    issueAt(input, '$.circuits[0].connections[0].from.terminalKey', 'invalid_terminal')
    setFileValue(input, ['circuits', 0, 'connections', 0, 'to', 'terminalKey'], 'positive')
    issueAt(input, '$.circuits[0].connections[0].to.terminalKey', 'invalid_terminal')
  })

  it('rejects a terminal that names a component in a different circuit', () => {
    const scene = makeCompleteScene()
    scene.circuits.push({ id: 'other-circuit', type: 'circuit', nodes: [], components: [{ id: asComponentId('other-resistor'), type: 'resistor', resistance: quantity(1, 'Ω', 'resistance') }], connections: [] })
    first(first(scene.circuits).connections).from.componentId = asComponentId('other-resistor')
    issueAt(scene, '$.circuits[0].connections[0].from.componentId', 'invalid_reference')
  })

  it('permits matching local net, wire and terminal ids in different circuits', () => {
    const scene = makeCompleteScene()
    scene.circuits.push({
      id: 'other-circuit', type: 'circuit',
      nodes: [{ id: 'net-a' }, { id: 'net-b' }],
      components: [{ id: asComponentId('other-resistor'), type: 'resistor', resistance: quantity(1, 'Ω', 'resistance') }],
      connections: [{ id: 'wire-1', from: { id: 'component-source.positive', componentId: asComponentId('other-resistor'), terminalKey: 'a' }, to: { id: 'component-source.negative', componentId: asComponentId('other-resistor'), terminalKey: 'b' } }],
    })
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  it('does not invent connection-to-node references or demand populated net lists', () => {
    const scene = makeCompleteScene()
    first(scene.circuits).nodes = []
    expect(parsedScene(scene)).toStrictEqual(scene)
  })

  const unsolvableScenes: [string, PhysicsScene][] = [
    ['shorted source', createCircuitScene({ now: FIXTURE_TIME, components: [{ id: 'source', type: 'voltage_source', voltage: 6, terminals: { positive: 'short', negative: 'short' } }] })],
    ['open circuit', createCircuitScene({ now: FIXTURE_TIME, components: [{ id: 'source', type: 'voltage_source', voltage: 6, terminals: { positive: 'one', negative: 'two' } }, { id: 'switch', type: 'switch', state: 'open', terminals: { a: 'three', b: 'four' } }] })],
    ['empty topology', createCircuitScene({ now: FIXTURE_TIME, components: [] })],
  ]
  for (const [name, scene] of unsolvableScenes) {
    it(`saves a structurally valid ${name} draft without engine validation`, () => {
      expect(parsedScene(scene)).toStrictEqual(scene)
      expect(scene.timeline.endTime?.value).toBe(0)
    })
  }
})

describe('untrusted JSON safety and detached ownership', () => {
  it('returns a detached copy of scalars, vectors, specialist objects, tuples and extension trees', () => {
    const source = makeCompleteScene()
    const value = parsedScene(source)
    const unchanged = makeCompleteScene()
    const release = source.metadata.experimentRelease
    if (release === undefined) throw new Error('Expected a fixture release.')
    const entries = source.metadata.experimentNotebook?.entries
    if (entries === undefined) throw new Error('Expected fixture notebook entries.')

    first(source.bodies).mass.value = 42
    first(source.particles).position.vector.x = 99
    first(source.opticalBenches).object.height.value = 99
    first(source.acousticBenches).source.position.value = 99
    first(source.fluidTanks).liquid.density.value = 99
    first(source.thermalBenches).sample.initialTemperature.value = 99
    first(first(source.leverBenches).hangers).mass.value = 99
    first(first(source.circuits).connections).from.id = 'changed-terminal'
    const tuple = first((source.inductionBenches ?? []).filter((entry) => entry.type === 'double_bar_rail')).barMasses
    if (tuple === undefined) throw new Error('Expected fixture bar masses.')
    tuple[0].value = 99
    first(source.constraints).parameters['anchor'] = { x: 99, y: 99 }
    record(first(source.bodies).material?.custom)['surface'] = 'changed'
    record(first(source.observableDefinitions).parameters)['graph'] = { rows: [[99, 99]] }
    Object.assign(source.metadata, { questionCodeVisualization: { source: 'changed' }, pluginExtension: { changed: true } })
    Object.defineProperty(release, 'version', { value: 'changed-release', enumerable: true, configurable: true, writable: true })
    Object.defineProperty(first(entries), 'values', { value: ['changed-reading'], enumerable: true, configurable: true, writable: true })
    source.bodies.push({ id: 'later-body', type: 'rigid_body', mass: quantity(1, 'kg', 'mass'), position: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'), velocity: quantityVector({ x: 0, y: 0, z: 0 }, 'm/s', 'velocity'), shape: { type: 'point' } })

    expect(value).toStrictEqual(unchanged)
    expect(value.metadata.experimentNotebook).not.toBe(source.metadata.experimentNotebook)
    expect(first(value.bodies).metadata).not.toBe(first(source.bodies).metadata)
    first(value.bodies).mass.value = -3
    expect(first(source.bodies).mass.value).toBe(42)
  })

  it('copies shared but non-cyclic metadata independently without rejecting it as a cycle', () => {
    const scene = makeEmptyScene()
    const shared: Record<string, unknown> = { nested: { value: 1 } }
    Object.assign(scene.metadata, { extension: { first: shared, second: shared } })
    const value = parsedScene(scene)
    const extension = record(record(value.metadata)['extension'])
    expect(extension['first']).toStrictEqual(shared)
    expect(extension['first']).not.toBe(shared)
    expect(extension['first']).not.toBe(extension['second'])
    record(shared['nested'])['value'] = 7
    expect(record(record(extension['first'])['nested'])['value']).toBe(1)
  })

  it('accepts plain null-prototype extension dictionaries and copies them into safe own data properties', () => {
    const scene = makeEmptyScene()
    const extension: Record<string, unknown> = { count: 2, nested: [null, 'safe'] }
    Object.setPrototypeOf(extension, null)
    Object.assign(scene.metadata, { extension })
    const copy = record(record(parsedScene(scene).metadata)['extension'])
    expect(copy).toEqual({ count: 2, nested: [null, 'safe'] })
    expect(copy).not.toBe(extension)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
  })

  const unsafeValues: [string, unknown][] = [
    ['function', () => 1],
    ['undefined', undefined],
    ['bigint', BigInt(1)],
    ['symbol', Symbol('not-json')],
    ['Date', new Date(FIXTURE_TIME)],
    ['Map', new Map([['key', 1]])],
    ['Set', new Set([1])],
    ['typed array', new Uint8Array([1])],
  ]
  for (const [name, value] of unsafeValues) {
    it(`rejects ${name} in an extension rather than serializing or executing it`, () => {
      const scene = makeEmptyScene()
      Object.assign(scene.metadata, { extension: value })
      const code = typeof value === 'object' && value !== null ? 'non_plain_object' : 'non_json_value'
      issueAt(scene, '$.metadata.extension', code)
    })
  }

  it('rejects class objects without invoking their toJSON method', () => {
    let calls = 0
    class RendererPayload {
      readonly value = 1
      toJSON(): { value: number } {
        calls += 1
        return { value: this.value }
      }
    }
    const scene = makeEmptyScene()
    Object.assign(scene.metadata, { renderer: new RendererPayload() })
    issueAt(scene, '$.metadata.renderer', 'non_plain_object')
    expect(calls).toBe(0)
  })

  it('rejects React-like elements and runtime functions inside nested extension data', () => {
    const scene = makeEmptyScene()
    Object.assign(scene.metadata, { view: { $$typeof: Symbol.for('react.element'), type: () => null, props: {} } })
    issueAt(scene, '$.metadata.view.$$typeof', 'non_json_value')
    issueAt(scene, '$.metadata.view.type', 'non_json_value')
  })

  it('rejects custom prototypes rather than copying inherited data', () => {
    const input = fileScene(makeEmptyScene())
    const metadata = record(input['metadata'])
    Object.setPrototypeOf(metadata, { hidden: 'inherited' })
    issueAt(input, '$.metadata', 'non_plain_object')
  })

  it('rejects accessors without invoking even throwing getters', () => {
    const input = fileScene()
    let calls = 0
    Object.defineProperty(record(fileValue(input, ['bodies', 0, 'mass'])), 'value', {
      enumerable: true,
      configurable: true,
      get: () => { calls += 1; throw new Error('This getter must not be evaluated.') },
    })
    issueAt(input, '$.bodies[0].mass.value', 'accessor_property')
    expect(calls).toBe(0)
  })

  it('rejects accessors in extension records and indexed arrays without invoking them', () => {
    const input = fileScene()
    let calls = 0
    Object.defineProperty(record(fileValue(input, ['constraints', 0, 'parameters'])), 'pivot', {
      enumerable: true,
      configurable: true,
      get: () => { calls += 1; return { x: 0, y: 0 } },
    })
    Object.defineProperty(array(fileValue(input, ['bodies', 0, 'metadata', 'extension', 'nested'])), '0', {
      enumerable: true,
      configurable: true,
      get: () => { calls += 1; return null },
    })
    issueAt(input, '$.constraints[0].parameters.pivot', 'accessor_property')
    issueAt(input, '$.bodies[0].metadata.extension.nested[0]', 'accessor_property')
    expect(calls).toBe(0)
  })

  it('rejects setter-only and hidden accessors', () => {
    const scene = makeEmptyScene()
    Object.defineProperty(scene.metadata, 'extension', { enumerable: false, set: (_value: unknown) => undefined })
    issueAt(scene, '$.metadata.extension', 'accessor_property')
  })

  it('returns JSON Pointer paths that compose under /scene and escape extension keys', () => {
    const bad = makeEmptyScene()
    Object.assign(bad.metadata, { extension: { 'a/b~c': { 'quote".[]': Infinity } } })
    const value = issues(bad)
    expect(value).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/metadata/extension/a~1b~0c/quote".[]', code: 'non_finite_number' }),
    ]))
    expect(`/scene${first(value).path}`).toBe('/scene/metadata/extension/a~1b~0c/quote".[]')
    expect(issues(null)).toEqual(expect.arrayContaining([expect.objectContaining({ path: '' })]))
  })

  it('rejects a cycle with the exact nested issue path', () => {
    const scene = makeEmptyScene()
    const extension: Record<string, unknown> = { value: 1 }
    extension['self'] = extension
    Object.assign(scene.metadata, { extension })
    issueAt(scene, '$.metadata.extension.self', 'cyclic_value')
  })

  it('rejects cyclic arrays as well as records', () => {
    const scene = makeEmptyScene()
    const extension: unknown[] = []
    extension.push(extension)
    Object.assign(scene.metadata, { extension })
    issueAt(scene, '$.metadata.extension[0]', 'cyclic_value')
  })

  for (const name of ['__proto__', 'constructor', 'prototype']) {
    it(`rejects the dangerous own property name ${name} without polluting prototypes`, () => {
      const scene = makeEmptyScene()
      const extension: Record<string, unknown> = {}
      Object.defineProperty(extension, name, { value: { parserPollutionSentinel: true }, enumerable: true, configurable: true, writable: true })
      Object.assign(scene.metadata, { extension })
      issueAt(scene, `$.metadata.extension.${name}`, 'unsafe_key')
      expect(Object.getOwnPropertyDescriptor(Object.prototype, 'parserPollutionSentinel')).toBeUndefined()
    })
  }

  it('rejects a dangerous key that was actually read from JSON', () => {
    const input = fileScene(makeEmptyScene())
    const extension: unknown = JSON.parse('{"nested":{"__proto__":{"parserPollutionSentinel":true}}}')
    record(input['metadata'])['extension'] = extension
    issueAt(input, '$.metadata.extension.nested.__proto__', 'unsafe_key')
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'parserPollutionSentinel')).toBeUndefined()
  })

  it('rejects symbol keys and non-enumerable data instead of silently losing them', () => {
    const symbolScene = makeEmptyScene()
    Object.defineProperty(symbolScene.metadata, Symbol('hidden'), { value: 1, enumerable: true })
    issueAt(symbolScene, '$.metadata', 'non_json_key')
    const hiddenScene = makeEmptyScene()
    Object.defineProperty(hiddenScene.metadata, 'hidden', { value: 1, enumerable: false })
    issueAt(hiddenScene, '$.metadata.hidden', 'non_json_property')
  })

  it('rejects sparse arrays and custom array properties', () => {
    const sparseScene = makeEmptyScene()
    Object.assign(sparseScene.metadata, { extension: new Array<unknown>(2) })
    issueAt(sparseScene, '$.metadata.extension', 'sparse_array')
    const customScene = makeEmptyScene()
    const values: unknown[] = [1]
    Object.assign(values, { note: 'not an indexed JSON element' })
    Object.assign(customScene.metadata, { extension: values })
    issueAt(customScene, '$.metadata.extension.note', 'non_json_property')
  })

  it('rejects array subclasses and array-like objects', () => {
    class RenderArray extends Array<number> {}
    const subclassScene = makeEmptyScene()
    Object.assign(subclassScene.metadata, { extension: new RenderArray(1, 2) })
    issueAt(subclassScene, '$.metadata.extension', 'non_plain_object')
    const input = fileScene(makeEmptyScene())
    input['bodies'] = { 0: {}, length: 1 }
    issueAt(input, '$.bodies', 'invalid_type')
  })

  it('returns issues instead of throwing when an object cannot be inspected', () => {
    const scene = makeEmptyScene()
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    Object.assign(scene.metadata, { extension: revoked.proxy })
    expect(() => parsePhysicsScene(scene)).not.toThrow()
    issueAt(scene, '$.metadata.extension', 'unsafe_object')
  })

  it('keeps parser calls independent after a rejected cyclic input', () => {
    const bad = makeEmptyScene()
    Object.assign(bad.metadata, { self: bad })
    issueAt(bad, '$.metadata.self', 'cyclic_value')
    const good = makeCompleteScene()
    expect(parsedScene(good)).toStrictEqual(good)
  })
})
