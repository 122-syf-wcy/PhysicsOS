import { quantityVector } from '@physicsos/physics-core'
import { defaultCoordinateSystem, type Body, type Boundary, type CircuitComponent, type CircuitTerminal, type Constraint, type Force, type MeasurementDefinition, type ObservableDefinition, type PhysicsObjectBase, type PhysicsScene, type Region, type SceneAnnotation, type SceneMetadata, type ShapeDefinition } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asComponentId, asObservableId, asQuestionId, asSceneId } from '@physicsos/shared'

export const FIXTURE_TIME = '2026-11-08T10:00:00.000Z'

/** Minimal complete contract; optional specialist collections are omitted. */
export const makeEmptyScene = (id = 'empty-scene'): PhysicsScene => ({
  schemaVersion: 'physics-scene/1.0',
  id: asSceneId(id),
  revision: 0,
  dimension: '2d',
  coordinateSystem: defaultCoordinateSystem(),
  timeline: {
    currentTime: quantity(0, 's', 'time'),
    startTime: quantity(0, 's', 'time'),
    endTime: quantity(0, 's', 'time'),
    state: 'idle',
    playbackRate: 1,
  },
  bodies: [],
  particles: [],
  fields: [],
  forces: [],
  regions: [],
  boundaries: [],
  constraints: [],
  circuits: [],
  opticalBenches: [],
  acousticBenches: [],
  fluidTanks: [],
  thermalBenches: [],
  leverBenches: [],
  measurementDefinitions: [],
  observableDefinitions: [],
  annotations: [],
  metadata: { createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME },
})

const base = (id: string): PhysicsObjectBase => ({
  id,
  name: `Fixture ${id}`,
  enabled: true,
  tags: ['contract', 'all-domains'],
  metadata: {
    presentation: { colorToken: 'accent', label: id },
    extension: { nested: [null, true, false, 'note', 2.5, { x: 1, y: -2 }] },
  },
})

const terminal = (componentId: string, terminalKey: string): CircuitTerminal => ({
  id: `${componentId}.${terminalKey}`,
  componentId: asComponentId(componentId),
  terminalKey,
})

/**
 * An authored scene spanning every collection, object union and quantity field.
 * It is a structural fixture, not a request for any one engine to solve all rigs.
 */
export const makeCompleteScene = (): PhysicsScene => {
  const shapes: ShapeDefinition[] = [
    { type: 'circle', radius: quantity(5, 'cm', 'length') },
    { type: 'rectangle', width: quantity(10, 'cm', 'length'), height: quantity(20, 'cm', 'length') },
    { type: 'polygon', vertices: [
      quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'),
      quantityVector({ x: 1, y: 0, z: 0 }, 'm', 'length'),
      quantityVector({ x: 0, y: 1, z: 0 }, 'm', 'length'),
    ] },
    { type: 'segment',
      start: quantityVector({ x: -1, y: 0, z: 0 }, 'm', 'length'),
      end: quantityVector({ x: 1, y: 0, z: 0 }, 'm', 'length'),
    },
    { type: 'point' },
  ]
  const bodies = shapes.map((shape, index): Body => ({
    ...base(`body-${shape.type}`),
    type: 'rigid_body',
    mass: quantity(index + 1, 'kg', 'mass'),
    position: quantityVector({ x: index, y: 1, z: 0 }, 'cm', 'length'),
    velocity: quantityVector({ x: 3.6, y: 0, z: 0 }, 'km/h', 'velocity'),
    acceleration: quantityVector({ x: 0, y: -9.8, z: 0 }, 'm/s²', 'acceleration'),
    shape,
    material: {
      density: quantity(7800, 'kg/m³', 'density'),
      frictionCoefficient: 0.2,
      staticFrictionCoefficient: 0.3,
      restitution: 0.8,
      custom: { surface: 'steel', layers: [{ thickness: 0.2, porous: false }], calibration: [null, 1, 2] },
    },
    fixed: false,
  }))
  const regions: Region[] = [
    { ...base('region-rectangle'), shape: { type: 'rectangle', width: quantity(10, 'm', 'length'), height: quantity(5, 'm', 'length') }, center: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length') },
    { ...base('region-circle'), shape: { type: 'circle', radius: quantity(2, 'm', 'length') }, center: quantityVector({ x: 2, y: 0, z: 0 }, 'm', 'length') },
    { ...base('region-polygon'), shape: { type: 'polygon', vertices: [quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'), quantityVector({ x: 2, y: 0, z: 0 }, 'm', 'length'), quantityVector({ x: 0, y: 2, z: 0 }, 'm', 'length')] }, center: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length') },
    { ...base('region-half-plane'), shape: { type: 'half_plane', normal: { x: 1, y: 0, z: 0 }, offset: quantity(-1, 'm', 'length') }, center: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length') },
    { ...base('region-unbounded'), shape: { type: 'unbounded' }, center: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length') },
  ]
  const boundaries: Boundary[] = [
    { ...base('boundary-line'), type: 'line', geometry: { type: 'segment', start: quantityVector({ x: -5, y: 0, z: 0 }, 'm', 'length'), end: quantityVector({ x: 5, y: 0, z: 0 }, 'm', 'length') }, behavior: { type: 'pass_through' } },
    { ...base('boundary-segment'), type: 'segment', geometry: { type: 'segment', start: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'), end: quantityVector({ x: 0, y: 5, z: 0 }, 'm', 'length') }, behavior: { type: 'stop' } },
    { ...base('boundary-circle'), type: 'circle', geometry: { type: 'circle', radius: quantity(4, 'm', 'length') }, behavior: { type: 'reflect', restitution: 0.7 } },
    { ...base('boundary-rectangle'), type: 'rectangle', geometry: { type: 'rectangle', width: quantity(3, 'm', 'length'), height: quantity(2, 'm', 'length') }, behavior: { type: 'custom', model: 'authored-boundary' } },
    { ...base('boundary-polygon'), type: 'polygon', geometry: { type: 'polygon', vertices: [quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'), quantityVector({ x: 1, y: 0, z: 0 }, 'm', 'length'), quantityVector({ x: 0, y: 1, z: 0 }, 'm', 'length')] } },
  ]
  const forceTypes: Force['type'][] = ['gravity', 'normal', 'friction', 'tension', 'spring', 'electric', 'lorentz', 'ampere', 'drag', 'custom']
  const forces = forceTypes.map((type): Force => ({
    ...base(`force-${type}`),
    type,
    targetId: type === 'normal' ? 'boundary-line' : type === 'drag' ? 'constraint-fixed' : type === 'custom' ? 'force-gravity' : 'body-circle',
    sourceId: type === 'spring' ? 'constraint-spring' : type === 'friction' ? 'boundary-line' : 'field-gravity',
    vector: quantityVector({ x: 1, y: -2, z: 3 }, 'N', 'force'),
    derived: true,
    model: `fixture-${type}`,
  }))
  const constraintTypes: Constraint['type'][] = ['fixed', 'distance', 'rope', 'hinge', 'surface', 'spring', 'track', 'custom']
  const constraints = constraintTypes.map((type): Constraint => ({
    ...base(`constraint-${type}`),
    type,
    targets: ['body-circle', 'boundary-line'],
    parameters: {
      anchor: { x: 0, y: 2 },
      pivot: { x: 1, y: -1 },
      configuration: { length: 3, damping: 0.2, samples: [0, 0.5, 1], optional: null },
    },
  }))
  const components: CircuitComponent[] = [
    { id: asComponentId('component-source'), type: 'voltage_source', name: 'Source', enabled: true, voltage: quantity(6, 'V', 'electric_potential'), internalResistance: quantity(0.2, 'Ω', 'resistance') },
    { id: asComponentId('component-resistor'), type: 'resistor', name: 'Load', enabled: true, resistance: quantity(10, 'ohm', 'resistance') },
    { id: asComponentId('component-switch'), type: 'switch', name: 'Switch', enabled: true, state: 'closed' },
    { id: asComponentId('component-ammeter'), type: 'ammeter', name: 'Ammeter', enabled: true, internalResistance: quantity(0, 'Ω', 'resistance') },
    { id: asComponentId('component-voltmeter'), type: 'voltmeter', name: 'Voltmeter', enabled: true, internalResistance: quantity(1e6, 'Ω', 'resistance') },
    { id: asComponentId('component-variable'), type: 'variable_resistor', name: 'Rheostat', enabled: true, totalResistance: quantity(20, 'Ω', 'resistance'), sliderPosition: 0.25 },
    { id: asComponentId('component-capacitor'), type: 'capacitor', name: 'Capacitor', enabled: true, capacitance: quantity(1e-6, 'F', 'capacitance'), initialVoltage: quantity(-0.5, 'V', 'electric_potential') },
    { id: asComponentId('component-inductor'), type: 'inductor', name: 'Inductor', enabled: true, inductance: quantity(0.1, 'H', 'inductance') },
  ]
  const observableTypes: ObservableDefinition['type'][] = ['force', 'velocity', 'acceleration', 'momentum', 'trajectory', 'electric_field', 'electric_potential', 'magnetic_field', 'energy', 'current', 'voltage', 'measurement', 'graph', 'geometry', 'annotation']
  const observableTargets = ['force-gravity', 'body-circle', 'particle-probe', 'lever-hanger-left', 'optical-object', 'field-electric', 'particle-source', 'field-magnetic', 'thermal-sample', 'component-ammeter', 'component-source', 'tank-liquid', 'thermal-comparison', 'optical-screen', 'acoustic-reflector']
  const observables = observableTypes.map((type, index): ObservableDefinition => ({
    id: asObservableId(`observable-${type}`),
    type,
    targetId: observableTargets[index] ?? 'body-circle',
    visible: index % 2 === 0,
    style: { emphasis: index % 2 === 0 ? 'normal' : 'highlight', labelVisible: true, scale: 1.5, token: 'fixture-accent' },
    parameters: { kind: 'fixture', graph: { rows: [[0, 1], [1, 2]], legend: ['first', 'second'] }, pivot: { x: 1, y: 2 }, missing: null },
  }))
  const measurementTypes: MeasurementDefinition['type'][] = ['position', 'velocity', 'acceleration', 'force', 'energy', 'current', 'voltage', 'electric_field', 'magnetic_field', 'custom']
  const measurements = measurementTypes.map((type): MeasurementDefinition => ({
    id: `measurement-${type}`,
    type,
    targetId: type === 'force' ? 'force-normal' : type === 'custom' ? 'constraint-hinge' : 'particle-probe',
    ...(type === 'current' || type === 'voltage' ? { componentId: asComponentId(type === 'current' ? 'component-ammeter' : 'component-voltmeter') } : {}),
    enabled: true,
  }))
  const annotationTypes: SceneAnnotation['type'][] = ['label', 'formula', 'marker', 'guide', 'teacher_note']
  const annotations = annotationTypes.map((type): SceneAnnotation => ({
    id: `annotation-${type}`,
    type,
    targetId: type === 'guide' ? 'boundary-segment' : type === 'teacher_note' ? 'constraint-fixed' : 'optical-lens',
    content: `Authored ${type}`,
    visible: true,
  }))

  const metadata = {
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    createdBy: { type: 'teacher', id: 'fixture-author' },
    title: 'Complete authored contract',
    description: 'All collections and unions with safe extension metadata.',
    curriculumTags: ['junior', 'senior'],
    knowledgeTags: ['units', 'references'],
    sourceQuestionId: asQuestionId('Q / 光学 / 17'),
    engineVersion: 'fixture/1.0',
    experimentRelease: { kind: 'official', id: 'official-release', experimentId: 'all-domains', version: '1.0.0' },
    experimentNotebook: {
      version: 1,
      entries: [
        {
          id: 'reading-official', recordedAt: FIXTURE_TIME, sceneId: 'historical-scene', sceneRevision: 3,
          experimentRelease: { kind: 'official', id: 'official-release', experimentId: 'all-domains', version: '1.0.0' },
          columns: ['temperature', 'level'], values: ['25 °C', '40 dB'],
          parameters: [{ id: 'temperature', value: 25, unit: '°C' }, { id: 'sound', value: 40, unit: 'dB' }],
        },
        {
          id: 'reading-community', recordedAt: FIXTURE_TIME, sceneId: 'historical-scene', sceneRevision: 4,
          experimentRelease: { kind: 'community', id: 'community-release', experimentId: 'all-domains', version: '2.0.0', sha256: 'a'.repeat(64) },
          columns: ['expansion'], values: ['0.0002 1/K'], parameters: [{ id: 'expansion', value: 0.0002, unit: '1/K' }],
        },
        {
          id: 'reading-legacy-community', recordedAt: FIXTURE_TIME, sceneId: 'historical-scene', sceneRevision: 5,
          experimentRelease: { id: 'legacy-community-release', experimentId: 'all-domains', version: '0.9.0', sha256: 'B'.repeat(64) },
          columns: [], values: [], parameters: [],
        },
        { id: 'reading-without-release', recordedAt: FIXTURE_TIME, sceneId: 'external-scene', sceneRevision: 0, columns: ['state'], values: ['draft'], parameters: [] },
      ],
    },
    lineage: {
      origin: 'question', branchType: 'experimental', originQuestionId: asQuestionId('Problem 17'),
      originSceneId: asSceneId('external-original'), parentSceneId: asSceneId('external-parent'), parentRevision: 6, forkedAt: FIXTURE_TIME,
    },
    questionCodeVisualization: { language: 'physics-question', source: 'F = m * a', annotations: [{ line: 1, enabled: true }], version: 1 },
    pluginExtension: { array: [null, true, 'future', { count: 2 }], nested: { enabled: false } },
  } satisfies SceneMetadata & Record<string, unknown>

  return {
    ...makeEmptyScene('all-domains-scene'),
    revision: 7,
    dimension: '3d',
    coordinateSystem: { type: 'cartesian', origin: { x: 15, y: -2, z: 1 }, axes: { x: { x: 0, y: 1, z: 0 }, y: { x: -1, y: 0, z: 0 }, z: { x: 0, y: 0, z: 1 } }, lengthUnit: 'cm' },
    timeline: { currentTime: quantity(500, 'ms', 'time'), startTime: quantity(0, 's', 'time'), endTime: quantity(1, 'min', 'time'), state: 'paused', playbackRate: 1.25, simulationTimeStep: quantity(1, 'ms', 'time') },
    bodies,
    particles: [
      { ...base('particle-source'), type: 'particle', mass: quantity(1, 'g', 'mass'), charge: quantity(2, 'μC', 'electric_charge'), position: quantityVector({ x: 0, y: 0, z: 0 }, 'm', 'length'), velocity: quantityVector({ x: 0, y: 0, z: 0 }, 'm/s', 'velocity'), acceleration: quantityVector({ x: 0, y: 0, z: 0 }, 'm/s^2', 'acceleration'), species: 'source', fixed: true },
      { ...base('particle-probe'), type: 'particle', mass: quantity(1e-3, 'kg', 'mass'), charge: quantity(-1, 'uC', 'electric_charge'), position: quantityVector({ x: 1, y: 2, z: 3 }, 'm', 'length'), velocity: quantityVector({ x: 1, y: 0, z: 0 }, 'km/s', 'velocity'), species: 'probe', fixed: false },
    ],
    fields: [
      { ...base('field-electric'), type: 'uniform_electric', regionId: 'region-rectangle', fieldStrength: quantityVector({ x: 0, y: -2, z: 0 }, 'N/C', 'electric_field') },
      { ...base('field-magnetic'), type: 'uniform_magnetic', regionId: 'region-circle', magneticFluxDensity: quantityVector({ x: 0, y: 0, z: -10 }, 'µT', 'magnetic_flux_density') },
      { ...base('field-gravity'), type: 'uniform_gravity', regionId: 'region-half-plane', acceleration: quantityVector({ x: 0, y: -9.8, z: 0 }, 'm/s^2', 'acceleration') },
      { ...base('field-point-charge'), type: 'point_charge', regionId: 'region-unbounded', sourceParticleId: 'particle-source' },
    ],
    forces,
    regions,
    boundaries,
    constraints,
    circuits: [{
      ...base('circuit-main'),
      type: 'circuit',
      metadata: { layout: { components: { 'component-source': { x: 0, y: 0, rotation: 0 }, 'component-resistor': { x: 2, y: 0 } }, wires: { 'wire-1': [{ x: 1, y: 0 }, { x: 1, y: 2 }] } }, extension: { notes: ['arbitrary local net names'] } },
      nodes: [{ id: 'net-a', label: 'Local net A' }, { id: 'net-b', label: 'Local net B' }],
      components,
      connections: [
        { id: 'wire-1', from: terminal('component-source', 'positive'), to: terminal('component-resistor', 'a') },
        { id: 'wire-2', from: terminal('component-resistor', 'a'), to: terminal('component-variable', 'a') },
        { id: 'wire-3', from: terminal('component-source', 'negative'), to: terminal('component-resistor', 'b') },
        { id: 'wire-4', from: terminal('component-source', 'negative'), to: terminal('component-ammeter', 'a') },
        { id: 'wire-5', from: terminal('component-ammeter', 'b'), to: terminal('component-switch', 'a') },
        { id: 'wire-6', from: terminal('component-switch', 'b'), to: terminal('component-voltmeter', 'a') },
        { id: 'wire-7', from: terminal('component-voltmeter', 'b'), to: terminal('component-capacitor', 'a') },
        { id: 'wire-8', from: terminal('component-capacitor', 'b'), to: terminal('component-inductor', 'a') },
        { id: 'wire-9', from: terminal('component-inductor', 'b'), to: terminal('component-variable', 'b') },
      ],
    }],
    opticalBenches: [{
      ...base('optical-bench'), type: 'optical_bench',
      object: { id: 'optical-object', name: 'Candle', position: quantity(-30, 'cm', 'length'), height: quantity(5, 'cm', 'length') },
      elements: [
        { id: 'optical-lens', name: 'Lens', enabled: true, type: 'thin_lens', position: quantity(0, 'cm', 'length'), focalLength: quantity(10, 'cm', 'length'), apertureRadius: quantity(3, 'cm', 'length') },
        { id: 'optical-plane-mirror', name: 'Plane mirror', enabled: false, type: 'plane_mirror', position: quantity(40, 'cm', 'length'), apertureRadius: quantity(4, 'cm', 'length') },
        { id: 'optical-curved-mirror', name: 'Curved mirror', enabled: false, type: 'curved_mirror', position: quantity(50, 'cm', 'length'), focalLength: quantity(-10, 'cm', 'length'), apertureRadius: quantity(4, 'cm', 'length') },
      ],
      screen: { id: 'optical-screen', name: 'Screen', position: quantity(15, 'cm', 'length') },
    }],
    acousticBenches: [{ ...base('acoustic-bench'), type: 'acoustic_bench', source: { id: 'acoustic-source', name: 'Clapper', position: quantity(0, 'm', 'length') }, reflector: { id: 'acoustic-reflector', name: 'Wall', position: quantity(34, 'm', 'length') }, soundSpeed: quantity(340, 'm/s', 'velocity') }],
    fluidTanks: [{ ...base('fluid-tank'), type: 'fluid_tank', block: { id: 'tank-block', name: 'Block', mass: quantity(0.5, 'kg', 'mass'), volume: quantity(100, 'cm³', 'volume'), height: quantity(5, 'cm', 'length') }, liquid: { id: 'tank-liquid', name: 'Water', density: quantity(1000, 'kg/m^3', 'density') }, lowerRate: quantity(0.01, 'm/s', 'velocity'), gravity: quantity(9.8, 'm/s^2', 'acceleration') }],
    thermalBenches: [{
      ...base('thermal-bench'), type: 'thermal_bench',
      sample: { id: 'thermal-sample', name: 'Water', mass: quantity(0.1, 'kg', 'mass'), solidSpecificHeat: quantity(2100, 'J/(kg*K)', 'specific_heat'), liquidSpecificHeat: quantity(4200, 'J/(kg·℃)', 'specific_heat'), latentHeat: quantity(334000, 'J/kg', 'specific_latent_heat'), meltingPoint: quantity(273.15, 'K', 'temperature'), boilingPoint: quantity(373.15, 'K', 'temperature'), vaporizationHeat: quantity(2260000, 'J/kg', 'specific_latent_heat'), initialTemperature: quantity(263.15, 'K', 'temperature') },
      comparisonSample: { id: 'thermal-comparison', name: 'Oil', mass: quantity(0.1, 'kg', 'mass'), solidSpecificHeat: quantity(2000, 'J/(kg*K)', 'specific_heat'), liquidSpecificHeat: quantity(2000, 'J/(kg*K)', 'specific_heat'), latentHeat: quantity(0, 'J/kg', 'specific_latent_heat'), meltingPoint: quantity(273.15, 'K', 'temperature'), initialTemperature: quantity(293.15, 'K', 'temperature') },
      heaterPower: quantity(100, 'W', 'power'), runDuration: quantity(60, 's', 'time'),
    }],
    leverBenches: [{ ...base('lever-bench'), type: 'lever_bench', beamLength: quantity(1, 'm', 'length'), gravity: quantity(9.8, 'm/s^2', 'acceleration'), hangers: [{ id: 'lever-hanger-left', name: 'Left load', side: 'left', mass: quantity(0.2, 'kg', 'mass'), armLength: quantity(0.3, 'm', 'length') }, { id: 'lever-hanger-right', name: 'Right load', side: 'right', mass: quantity(0.3, 'kg', 'mass'), armLength: quantity(0.2, 'm', 'length') }] }],
    inductionBenches: [
      { ...base('induction-bar'), type: 'bar_motion', magneticFluxDensity: quantity(0.5, 'T', 'magnetic_flux_density'), resistance: quantity(2, 'Ω', 'resistance'), barLength: quantity(20, 'cm', 'length'), barVelocity: quantity(-3, 'm/s', 'velocity') },
      { ...base('induction-flux'), type: 'flux_change', magneticFluxDensity: quantity(0.5, 'T', 'magnetic_flux_density'), resistance: quantity(2, 'Ω', 'resistance'), coilArea: quantity(100, 'cm²', 'area'), coilAngle: quantity(30, '°', 'angle'), fluxRate: quantity(-0.1, 'Wb/s', 'magnetic_flux_rate') },
      { ...base('induction-double-bar'), type: 'double_bar_rail', magneticFluxDensity: quantity(0.5, 'T', 'magnetic_flux_density'), resistance: quantity(2, 'Ω', 'resistance'), barLength: quantity(1, 'm', 'length'), barMasses: [quantity(1, 'kg', 'mass'), quantity(2, 'kg', 'mass')], barVelocities: [quantity(3, 'm/s', 'velocity'), quantity(-1, 'm/s', 'velocity')], barPositions: [quantity(-2, 'm', 'length'), quantity(2, 'm', 'length')], externalForce: quantity(0, 'N', 'force') },
    ],
    waveBenches: [
      { ...base('wave-travelling'), type: 'travelling', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(2, 'Hz', 'frequency'), wavelength: quantity(1, 'm', 'length'), ropeLength: quantity(5, 'm', 'length') },
      { ...base('wave-interference'), type: 'interference', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(2, 'Hz', 'frequency'), wavelength: quantity(1, 'm', 'length'), sourceSeparation: quantity(2, 'm', 'length'), pathOne: quantity(3, 'm', 'length'), pathTwo: quantity(4, 'm', 'length') },
      { ...base('wave-standing'), type: 'standing', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(3, 'Hz', 'frequency'), stringLength: quantity(1, 'm', 'length'), harmonic: 2, waveSpeed: quantity(3, 'm/s', 'velocity') },
      { ...base('wave-longitudinal'), type: 'longitudinal', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(1, 'kHz', 'frequency'), wavelength: quantity(0.34, 'm', 'length'), mediumLength: quantity(2, 'm', 'length') },
      { ...base('wave-reflection-refraction'), type: 'reflection_refraction', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(2, 'Hz', 'frequency'), incidentSpeed: quantity(3, 'm/s', 'velocity'), transmittedWaveSpeed: quantity(2, 'm/s', 'velocity'), incidentAngle: quantity(30, 'deg', 'angle') },
      { ...base('wave-diffraction'), type: 'diffraction', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(2, 'Hz', 'frequency'), wavelength: quantity(0.1, 'm', 'length'), slitWidth: quantity(0.2, 'm', 'length'), screenDistance: quantity(2, 'm', 'length'), diffractionOrder: 1 },
      { ...base('wave-doppler'), type: 'doppler', amplitude: quantity(2, 'cm', 'length'), frequency: quantity(500, 'Hz', 'frequency'), wavelength: quantity(0.68, 'm', 'length'), waveSpeed: quantity(340, 'm/s', 'velocity'), sourceSpeed: quantity(20, 'm/s', 'velocity'), observerSpeed: quantity(0, 'm/s', 'velocity'), sourceDirection: 'approaching', observerDirection: 'stationary' },
    ],
    cyclotronBenches: [
      { ...base('cyclotron-into'), type: 'cyclotron', magneticFluxDensity: quantity(0.5, 'T', 'magnetic_flux_density'), magneticOrientation: 'into_page', gapVoltage: quantity(100, 'V', 'electric_potential'), gapWidth: quantity(1, 'cm', 'length'), deeRadius: quantity(20, 'cm', 'length') },
      { ...base('cyclotron-out'), type: 'cyclotron', magneticFluxDensity: quantity(0.5, 'T', 'magnetic_flux_density'), magneticOrientation: 'out_of_page', gapVoltage: quantity(100, 'V', 'electric_potential'), gapWidth: quantity(1, 'cm', 'length'), deeRadius: quantity(20, 'cm', 'length') },
    ],
    modernPhysicsBenches: [{ ...base('modern-bench'), type: 'photoelectric_effect', workFunction: quantity(3.2e-19, 'J', 'energy'), photonWavelength: quantity(400e-9, 'm', 'length'), lightIntensity: quantity(1, 'W/m²', 'intensity'), cathodeArea: quantity(1, 'cm^2', 'area'), quantumEfficiency: 0.25 }],
    pressureBenches: [
      { ...base('pressure-solid'), type: 'solid', force: quantity(10, 'N', 'force'), area: quantity(10, 'cm^2', 'area'), comparisonArea: quantity(20, 'cm^2', 'area') },
      { ...base('pressure-liquid'), type: 'liquid', gravity: quantity(9.8, 'm/s^2', 'acceleration'), liquidDensity: quantity(1000, 'kg/m^3', 'density'), depth: quantity(10, 'cm', 'length'), comparisonDepth: quantity(20, 'cm', 'length'), comparisonLiquidDensity: quantity(800, 'kg/m^3', 'density') },
      { ...base('pressure-atmospheric'), type: 'atmospheric', gravity: quantity(9.8, 'm/s^2', 'acceleration'), atmosphericPressure: quantity(101325, 'Pa', 'pressure'), barometerFluidDensity: quantity(13600, 'kg/m^3', 'density'), hemisphereRadius: quantity(5, 'cm', 'length') },
    ],
    currentBenches: [
      { ...base('current-wire'), type: 'straight_wire', current: quantity(-2, 'A', 'electric_current'), probeDistance: quantity(2, 'cm', 'length'), comparisonDistance: quantity(4, 'cm', 'length') },
      { ...base('current-solenoid'), type: 'solenoid', current: quantity(2, 'A', 'electric_current'), turns: quantity(100, '', 'dimensionless'), comparisonTurns: quantity(200, '', 'dimensionless'), coilLength: quantity(10, 'cm', 'length') },
      { ...base('current-electromagnet'), type: 'electromagnet', current: quantity(2, 'A', 'electric_current'), turns: quantity(100, '1', 'dimensionless'), coilLength: quantity(10, 'cm', 'length'), coreRelativePermeability: quantity(100, '', 'dimensionless'), comparisonCoreRelativePermeability: quantity(1, '', 'dimensionless'), coreArea: quantity(1, 'cm^2', 'area'), gravity: quantity(9.8, 'm/s^2', 'acceleration') },
      { ...base('current-motor'), type: 'motor', current: quantity(2, 'A', 'electric_current'), turns: quantity(10, '', 'dimensionless'), magneticFluxDensity: quantity(0.1, 'T', 'magnetic_flux_density'), sideLength: quantity(5, 'cm', 'length'), coilWidth: quantity(4, 'cm', 'length'), coilAngle: quantity(30, 'deg', 'angle') },
    ],
    energyBenches: [{ ...base('energy-bench'), type: 'energy_bench', mass: quantity(1, 'kg', 'mass'), gravity: quantity(9.8, 'm/s^2', 'acceleration'), releaseHeight: quantity(1, 'm', 'length'), inclineAngle: quantity(30, 'deg', 'angle'), frictionCoefficient: quantity(0.2, '', 'dimensionless') }],
    lightBenches: [
      { ...base('light-pinhole'), type: 'pinhole', objectHeight: quantity(5, 'cm', 'length'), objectDistance: quantity(20, 'cm', 'length'), screenDistance: quantity(10, 'cm', 'length') },
      { ...base('light-total-reflection'), type: 'total_reflection', incidentIndex: quantity(1.5, '', 'dimensionless'), refractedIndex: quantity(1, '', 'dimensionless'), incidentAngle: quantity(50, 'deg', 'angle') },
    ],
    transformerBenches: [{ ...base('transformer-bench'), type: 'transformer', primaryVoltage: quantity(220, 'V', 'electric_potential'), primaryCurrent: quantity(0.5, 'A', 'electric_current'), primaryTurns: quantity(1000, '', 'dimensionless'), secondaryTurns: quantity(100, '', 'dimensionless') }],
    thermometerBenches: [{ ...base('thermometer-bench'), type: 'liquid_in_glass', bulbVolume: quantity(0.1, 'cm^3', 'volume'), boreDiameter: quantity(0.16, 'mm', 'length'), expansionCoefficient: quantity(2e-4, '', 'dimensionless'), temperature: quantity(298.15, 'K', 'temperature'), icePointLength: quantity(2, 'cm', 'length') }],
    noiseBenches: [{ ...base('noise-bench'), type: 'noise', soundPowerLevel: quantity(80, '', 'dimensionless'), distance: quantity(2, 'm', 'length'), barrierAttenuation: quantity(10, '', 'dimensionless') }],
    measurementDefinitions: measurements,
    observableDefinitions: observables,
    annotations,
    metadata,
  }
}

export const completeScene: PhysicsScene = makeCompleteScene()
