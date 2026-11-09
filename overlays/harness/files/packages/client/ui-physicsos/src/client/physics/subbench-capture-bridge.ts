import {
  REFERENCE_INTENSITY,
  noiseReadingOf,
  type ResolvedNoiseModel,
} from '@physicsos/engine-acoustics'
import {
  atmosphericPressureOf,
  liquidPressureOf,
  solidPressureOf,
  type ResolvedPressureModel,
} from '@physicsos/engine-fluid'
import {
  transformerReadingOf,
  type ResolvedTransformerModel,
} from '@physicsos/engine-induction'
import {
  electromagnetFieldOf,
  motorReadingOf,
  solenoidFieldOf,
  straightWireFieldOf,
  type ResolvedCurrentModel,
} from '@physicsos/engine-magnetic'
import {
  pinholeReadingOf,
  refractionReadingOf,
  type ResolvedLightModel,
} from '@physicsos/engine-optics'
import {
  thermometerReadingOf,
  type ResolvedThermometerModel,
} from '@physicsos/engine-thermal'
import type { SimulationResult } from '@physicsos/physics-core'
import { CELSIUS_ZERO_IN_KELVIN, type PhysicsScene } from '@physicsos/physics-scene'
import { quantity, type Quantity } from '@physicsos/physics-units'
import type {
  AnalysisDataset,
  AxisDescriptor,
  CapturedResult,
  ConditionValue,
  DataValue,
  DatasetRow,
  JsonObject,
  MetricDescriptor,
  MetricScale,
  MetricSemantics,
} from '@physicsos/physics-workbench'
import { copyJsonObject, freezeData } from '@physicsos/physics-workbench/json'

type Evidence = Pick<CapturedResult, 'analysis' | 'rawState' | 'metricSemantics' | 'conditions' | 'diagnostics'>
type Context = { readonly scene: PhysicsScene; readonly result: SimulationResult }

const LINEAR: MetricScale = { kind: 'linear' }
const ABSOLUTE_TEMPERATURE: MetricScale = { kind: 'temperature-absolute' }
const TEMPERATURE_DIFFERENCE: MetricScale = { kind: 'temperature-difference' }

const numberValue = (value: number | undefined, absent = 'not-defined-by-model'): DataValue =>
  value === undefined
    ? { missing: absent }
    : Number.isFinite(value)
      ? value
      : { missing: 'non-finite-engine-value' }

const markerSemantics = (semanticKey: string, reason: string): MetricSemantics => ({
  semanticKey,
  scale: { kind: 'unresolved', reason },
})

const axisOf = (
  identity: string,
  dimension: AxisDescriptor['dimension'],
  unit: string,
  kind: AxisDescriptor['kind'] = 'parameter',
  reference = `${identity}:zero`,
): AxisDescriptor => ({
  id: identity,
  identity,
  kind,
  dimension,
  unit,
  origin: { kind: 'absolute', value: quantity(0, unit, dimension), reference },
})

const metricOf = (
  id: string,
  dimension: MetricDescriptor['dimension'],
  unit: string,
  targetId: string,
  semantics?: MetricSemantics,
): MetricDescriptor => ({
  id,
  targetId,
  component: 'scalar',
  dimension,
  unit,
  semanticKey: semantics?.semanticKey ?? id,
  scale: semantics?.scale ?? LINEAR,
  ...(semantics?.reference === undefined ? {} : { reference: semantics.reference }),
})

const conditionOf = (
  semanticKey: string,
  value: Quantity,
  targetId: string,
  scale: MetricScale = LINEAR,
): ConditionValue => ({ semanticKey, value, targetId, scale })

const rowOf = (
  rowId: string,
  axes: Readonly<Record<string, DataValue>>,
  values: Readonly<Record<string, DataValue>>,
  evidence?: JsonObject,
): DatasetRow => ({ rowId, axes, values, ...(evidence === undefined ? {} : { evidence }) })

/** Numeric analyses are evaluated during a solve revision, never while capturing it. */
const analysisOf = (
  context: Context,
  analysisId: string,
  axes: readonly AxisDescriptor[],
  metrics: readonly MetricDescriptor[],
  rows: readonly DatasetRow[],
  conditions: readonly ConditionValue[],
  metadata?: JsonObject,
): AnalysisDataset => ({
  schemaVersion: 1,
  kind: 'dataset',
  id: `${context.result.metadata.engineId}:${analysisId}:${String(context.scene.id)}:${context.scene.revision}`,
  axes,
  metrics,
  rows,
  conditions: conditions.filter(condition => !axes.some(axis => axis.identity === condition.semanticKey)),
  origin: {
    sceneId: String(context.scene.id),
    sceneRevision: context.scene.revision,
    simulationId: String(context.result.simulationId),
    collection: 'analysis',
    analysisId,
  },
  metadata: {
    evaluation: 'engine-closed-form',
    ...(metadata ?? {}),
  },
})

const holdEvidence = (
  model: object,
  reading: object,
  units: JsonObject,
  analysis: readonly AnalysisDataset[],
  conditions: readonly ConditionValue[],
  metricSemantics: Readonly<Record<string, MetricSemantics>> = {},
): Evidence => {
  let rawState: JsonObject | undefined
  let diagnostics: CapturedResult['diagnostics'] = []
  try {
    rawState = copyJsonObject({ model, reading, units })
  } catch (error: unknown) {
    diagnostics = [{
      code: 'CAPTURE_RAW_STATE_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'The native engine reading is not JSON-safe.',
    }]
  }
  return {
    ...(rawState === undefined ? {} : { rawState }),
    analysis: freezeData(analysis),
    conditions: freezeData(conditions),
    metricSemantics: freezeData(metricSemantics),
    diagnostics: freezeData(diagnostics),
  }
}

export const pressureCaptureEvidence = (
  context: Context & { readonly model: ResolvedPressureModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  const gravity = conditionOf('gravity', quantity(model.gravity, 'm/s^2', 'acceleration'), target)
  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    const conditions = [
      gravity,
      conditionOf('contact_force', quantity(model.force, 'N', 'force'), target),
      conditionOf('contact_area', quantity(model.area, 'm^2', 'area'), target),
    ]
    const areas = [model.area, ...(model.comparisonArea === undefined ? [] : [model.comparisonArea])]
    const analysis = analysisOf(
      context,
      'pressure-solid-area',
      [axisOf('contact_area', 'area', 'm^2')],
      [metricOf('contact_force', 'force', 'N', target), metricOf('contact_pressure', 'pressure', 'Pa', target)],
      areas.map((area, index) => {
        const sample = solidPressureOf({ ...model, area })
        return rowOf(`face:${index}`, { contact_area: numberValue(area) }, {
          contact_force: numberValue(sample.force),
          contact_pressure: numberValue(sample.pressure),
        }, { sample: index === 0 ? 'loaded-face' : 'authored-comparison-face', formula: 'p = F / S' })
      }),
      conditions,
      { sampleSelection: 'authored-contact-faces' },
    )
    return holdEvidence(model, reading, {
      force: 'N', area: 'm^2', comparisonArea: 'm^2', pressure: 'Pa', comparisonPressure: 'Pa', gravity: 'm/s^2',
    }, [analysis], conditions)
  }
  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    const conditions = [
      gravity,
      conditionOf('liquid_density', quantity(model.liquidDensity, 'kg/m^3', 'density'), target),
      conditionOf('probe_depth', quantity(model.depth, 'm', 'length'), target),
    ]
    const depths = [model.depth, ...(model.comparisonDepth === undefined ? [] : [model.comparisonDepth])]
    const densities = [model.liquidDensity, ...(model.comparisonLiquidDensity === undefined ? [] : [model.comparisonLiquidDensity])]
    const metrics = [metricOf('liquid_pressure', 'pressure', 'Pa', target)]
    const depthAnalysis = analysisOf(context, 'pressure-liquid-depth',
      [axisOf('probe_depth', 'length', 'm')], metrics,
      depths.map((depth, index) => rowOf(`depth:${index}`, { probe_depth: depth }, {
        liquid_pressure: numberValue(liquidPressureOf({ ...model, depth }).pressure),
      }, { sample: index === 0 ? 'primary-probe' : 'authored-comparison-probe', formula: 'p = rho * g * h' })),
      conditions, { sampleSelection: 'authored-probe-depths' })
    const densityAnalysis = analysisOf(context, 'pressure-liquid-density',
      [axisOf('liquid_density', 'density', 'kg/m^3')], metrics,
      densities.map((liquidDensity, index) => rowOf(`liquid:${index}`, { liquid_density: liquidDensity }, {
        liquid_pressure: numberValue(liquidPressureOf({ ...model, liquidDensity }).pressure),
      }, { sample: index === 0 ? 'primary-liquid' : 'authored-comparison-liquid', formula: 'p = rho * g * h' })),
      conditions, { sampleSelection: 'authored-liquid-densities' })
    return holdEvidence(model, reading, {
      liquidDensity: 'kg/m^3', comparisonLiquidDensity: 'kg/m^3', depth: 'm', comparisonDepth: 'm',
      pressure: 'Pa', comparisonDepthPressure: 'Pa', comparisonLiquidPressure: 'Pa', gravity: 'm/s^2',
    }, [depthAnalysis, densityAnalysis], conditions)
  }
  const reading = atmosphericPressureOf(model)
  const conditions = [
    gravity,
    conditionOf('atmospheric_pressure', quantity(model.atmosphericPressure, 'Pa', 'pressure'), target),
    conditionOf('barometer_fluid_density', quantity(model.barometerFluidDensity, 'kg/m^3', 'density'), target),
    conditionOf('hemisphere_radius', quantity(model.hemisphereRadius, 'm', 'length'), target),
  ]
  const analysis = analysisOf(context, 'pressure-atmospheric-instruments',
    [axisOf('instrument', 'dimensionless', '', 'static', 'instrument-index')],
    [metricOf('atmospheric_pressure', 'pressure', 'Pa', target), metricOf('barometer_column', 'length', 'm', target),
      metricOf('hemisphere_force', 'force', 'N', target)],
    [rowOf('barometer', { instrument: 0 }, {
      atmospheric_pressure: reading.atmosphericPressure,
      barometer_column: numberValue(reading.columnHeight),
      hemisphere_force: { missing: 'not-observed-by-barometer' },
    }, { instrument: 'barometer', formula: 'h = p / (rho * g)' }),
    rowOf('hemispheres', { instrument: 1 }, {
      atmospheric_pressure: reading.atmosphericPressure,
      barometer_column: { missing: 'not-observed-by-hemispheres' },
      hemisphere_force: numberValue(reading.hemisphereForce),
    }, { instrument: 'magdeburg-hemispheres', formula: 'F = p * pi * r^2' })], conditions)
  return holdEvidence(model, reading, {
    atmosphericPressure: 'Pa', barometerFluidDensity: 'kg/m^3', hemisphereRadius: 'm',
    columnHeight: 'm', hemisphereForce: 'N', gravity: 'm/s^2',
  }, [analysis], conditions)
}

const CURRENT_MARKERS: Readonly<Record<string, MetricSemantics>> = {
  field_circulation: markerSemantics('field_circulation', 'Current circulation is a signed direction marker, not a continuous magnitude.'),
  north_pole: markerSemantics('north_pole', 'The engine encodes the north-pole end as a signed direction marker.'),
  rotation_sense: markerSemantics('rotation_sense', 'The engine encodes the current-controlled rotation sense as a signed direction marker.'),
  wire_current: { semanticKey: 'electric_current', scale: LINEAR },
  coil_current: { semanticKey: 'electric_current', scale: LINEAR },
  rotor_current: { semanticKey: 'electric_current', scale: LINEAR },
}

export const currentCaptureEvidence = (
  context: Context & { readonly model: ResolvedCurrentModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  const conditions: ConditionValue[] = [conditionOf('electric_current', quantity(model.current, 'A', 'electric_current'), target)]
  const analyses: AnalysisDataset[] = []
  const currentAxis = axisOf('electric_current', 'electric_current', 'A')
  const currents = [model.current / 2, model.current, -model.current]
  let reading: object
  let units: JsonObject
  let currentMetrics: readonly MetricDescriptor[]
  let currentRows: readonly DatasetRow[]

  if (model.type === 'straight_wire') {
    reading = straightWireFieldOf(model)
    units = { current: 'A', probeDistance: 'm', comparisonDistance: 'm', field: 'T', comparisonField: 'T', circulation: 'direction-marker' }
    conditions.push(conditionOf('probe_distance', quantity(model.probeDistance, 'm', 'length'), target))
    const distances = [model.probeDistance, ...(model.comparisonDistance === undefined ? [] : [model.comparisonDistance])]
    analyses.push(analysisOf(context, 'current-wire-distance', [axisOf('probe_distance', 'length', 'm')],
      [metricOf('magnetic_flux_density', 'magnetic_flux_density', 'T', target)],
      distances.map((probeDistance, index) => rowOf(`probe:${index}`, { probe_distance: probeDistance }, {
        magnetic_flux_density: numberValue(straightWireFieldOf({ ...model, probeDistance }).field),
      }, { sample: index === 0 ? 'primary-probe' : 'authored-comparison-probe', formula: 'B = mu0 * abs(I) / (2 * pi * r)' })),
      conditions, { sampleSelection: 'authored-probe-distances' }))
    currentMetrics = [metricOf('magnetic_flux_density', 'magnetic_flux_density', 'T', target),
      metricOf('field_circulation', 'dimensionless', '', target, CURRENT_MARKERS.field_circulation)]
    currentRows = currents.map((current, index) => {
      const sample = straightWireFieldOf({ ...model, current })
      return rowOf(`current:${index}`, { electric_current: current }, {
        magnetic_flux_density: numberValue(sample.field), field_circulation: numberValue(sample.circulation),
      })
    })
  } else if (model.type === 'solenoid') {
    reading = solenoidFieldOf(model)
    units = { current: 'A', turns: '', comparisonTurns: '', coilLength: 'm', turnDensity: '1/m', field: 'T', comparisonField: 'T', endField: 'T', northPole: 'direction-marker' }
    conditions.push(conditionOf('coil_turns', quantity(model.turns, '', 'dimensionless'), target),
      conditionOf('coil_length', quantity(model.coilLength, 'm', 'length'), target))
    const turns = [model.turns, ...(model.comparisonTurns === undefined ? [] : [model.comparisonTurns])]
    analyses.push(analysisOf(context, 'current-solenoid-turns', [axisOf('coil_turns', 'dimensionless', '')],
      [metricOf('magnetic_flux_density', 'magnetic_flux_density', 'T', target), metricOf('end_field', 'magnetic_flux_density', 'T', target)],
      turns.map((turns, index) => {
        const sample = solenoidFieldOf({ ...model, turns })
        return rowOf(`winding:${index}`, { coil_turns: turns }, {
          magnetic_flux_density: numberValue(sample.field), end_field: numberValue(sample.endField),
        }, { sample: index === 0 ? 'primary-winding' : 'authored-comparison-winding', formula: 'B = mu0 * (N / L) * abs(I)' })
      }), conditions, { sampleSelection: 'authored-winding-turns' }))
    currentMetrics = [metricOf('magnetic_flux_density', 'magnetic_flux_density', 'T', target), metricOf('end_field', 'magnetic_flux_density', 'T', target)]
    currentRows = currents.map((current, index) => {
      const sample = solenoidFieldOf({ ...model, current })
      return rowOf(`current:${index}`, { electric_current: current }, {
        magnetic_flux_density: numberValue(sample.field), end_field: numberValue(sample.endField),
      })
    })
  } else if (model.type === 'electromagnet') {
    reading = electromagnetFieldOf(model)
    units = { current: 'A', turns: '', coilLength: 'm', turnDensity: '1/m', coreRelativePermeability: '', comparisonCoreRelativePermeability: '',
      coreArea: 'm^2', gravity: 'm/s^2', field: 'T', airField: 'T', pull: 'N', airPull: 'N', heldMass: 'kg',
      airHeldMass: 'kg', comparisonField: 'T', comparisonPull: 'N', northPole: 'direction-marker' }
    conditions.push(conditionOf('coil_turns', quantity(model.turns, '', 'dimensionless'), target),
      conditionOf('coil_length', quantity(model.coilLength, 'm', 'length'), target),
      conditionOf('core_permeability', quantity(model.coreRelativePermeability, '', 'dimensionless'), target),
      conditionOf('core_area', quantity(model.coreArea, 'm^2', 'area'), target),
      conditionOf('gravity', quantity(model.gravity, 'm/s^2', 'acceleration'), target))
    const authoredCores = [model.coreRelativePermeability,
      ...(model.comparisonCoreRelativePermeability === undefined ? [] : [model.comparisonCoreRelativePermeability])]
    const cores = authoredCores.includes(1) ? authoredCores : [...authoredCores, 1]
    const metrics = [metricOf('magnetic_flux_density', 'magnetic_flux_density', 'T', target),
      metricOf('pole_face_pull', 'force', 'N', target), metricOf('held_mass', 'mass', 'kg', target)]
    analyses.push(analysisOf(context, 'current-electromagnet-core', [axisOf('core_permeability', 'dimensionless', '')], metrics,
      cores.map((coreRelativePermeability, index) => {
        const sample = electromagnetFieldOf({ ...model, coreRelativePermeability })
        return rowOf(`core:${index}`, { core_permeability: coreRelativePermeability }, {
          magnetic_flux_density: numberValue(sample.field), pole_face_pull: numberValue(sample.pull), held_mass: numberValue(sample.heldMass),
        }, { sample: index >= authoredCores.length ? 'air-core-control' : index === 0 ? 'primary-core' : 'authored-comparison-core',
          airCoreControl: coreRelativePermeability === 1,
          formula: 'B = mu_r * mu0 * (N / L) * abs(I); F = B^2 * A / (2 * mu0)' })
      }), conditions, { sampleSelection: 'authored-cores-and-air-control' }))
    currentMetrics = metrics
    currentRows = currents.map((current, index) => {
      const sample = electromagnetFieldOf({ ...model, current })
      return rowOf(`current:${index}`, { electric_current: current }, {
        magnetic_flux_density: numberValue(sample.field), pole_face_pull: numberValue(sample.pull), held_mass: numberValue(sample.heldMass),
      })
    })
  } else {
    reading = motorReadingOf(model)
    units = { current: 'A', turns: '', field: 'T', magneticFluxDensity: 'T', sideLength: 'm', coilWidth: 'm',
      coilArea: 'm^2', area: 'm^2', angle: 'rad', coilAngle: 'rad', sideForce: 'N', torque: 'N*m', peakTorque: 'N*m', sense: 'direction-marker' }
    conditions.push(conditionOf('rotor_turns', quantity(model.turns, '', 'dimensionless'), target),
      conditionOf('stator_field', quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'), target),
      conditionOf('rotor_side_length', quantity(model.sideLength, 'm', 'length'), target),
      conditionOf('rotor_width', quantity(model.coilWidth, 'm', 'length'), target),
      conditionOf('coil_angle', quantity(model.coilAngle, 'rad', 'angle'), target))
    const angles = [...new Set([model.coilAngle, Math.PI / 2, 0])]
    const metrics = [metricOf('side_force', 'force', 'N', target), metricOf('motor_torque', 'torque', 'N*m', target),
      metricOf('peak_torque', 'torque', 'N*m', target), metricOf('lever_arm', 'length', 'm', target)]
    analyses.push(analysisOf(context, 'current-motor-angle', [axisOf('coil_angle', 'angle', 'rad')], metrics,
      angles.map((coilAngle, index) => {
        const sample = motorReadingOf({ ...model, coilAngle })
        return rowOf(`angle:${index}`, { coil_angle: coilAngle }, {
          side_force: numberValue(sample.sideForce), motor_torque: numberValue(sample.torque),
          peak_torque: numberValue(sample.peakTorque), lever_arm: numberValue(model.coilWidth * Math.cos(coilAngle)),
        }, {
          samples: [
            ...(coilAngle === model.coilAngle ? ['current-angle'] : []),
            ...(coilAngle === Math.PI / 2 ? ['dead-point'] : []),
            ...(coilAngle === 0 ? ['maximum-arm'] : []),
          ],
          formula: 'tau = n * B * I * A * cos(theta)',
        })
      }), conditions, { sampleSelection: 'current-dead-point-maximum-arm' }))
    currentMetrics = metrics.slice(0, 3)
    currentRows = currents.map((current, index) => {
      const sample = motorReadingOf({ ...model, current })
      return rowOf(`current:${index}`, { electric_current: current }, {
        side_force: numberValue(sample.sideForce), motor_torque: numberValue(sample.torque), peak_torque: numberValue(sample.peakTorque),
      })
    })
  }
  analyses.push(analysisOf(context, `current-${model.type}-current`, [currentAxis], currentMetrics, currentRows,
    conditions, { sampleSelection: 'half-current-current-reversed-current' }))
  return holdEvidence(model, reading, units, analyses, conditions, CURRENT_MARKERS)
}

const LIGHT_MARKERS: Readonly<Record<string, MetricSemantics>> = {
  inverted: markerSemantics('image_orientation_marker', 'The engine encodes an inverted image as -1; this is not a continuous magnitude.'),
  total_internal_reflection: markerSemantics('total_internal_reflection_marker', 'The engine encodes total reflection as -1 and refraction as +1.'),
}

export const lightCaptureEvidence = (
  context: Context & { readonly model: ResolvedLightModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  if (model.type === 'pinhole') {
    const reading = pinholeReadingOf(model)
    const conditions = [
      conditionOf('object_height', quantity(model.objectHeight, 'm', 'length'), target),
      conditionOf('object_distance', quantity(model.objectDistance, 'm', 'length'), target),
      conditionOf('screen_distance', quantity(model.screenDistance, 'm', 'length'), target),
    ]
    const screens = [...new Set([model.screenDistance, model.objectDistance * 0.5, model.objectDistance, model.objectDistance * 1.5])]
    const analysis = analysisOf(context, 'light-pinhole-screen', [axisOf('screen_distance', 'length', 'm')],
      [metricOf('image_height', 'length', 'm', target), metricOf('magnification', 'dimensionless', '', target)],
      screens.map((screenDistance, index) => {
        const sample = pinholeReadingOf({ ...model, screenDistance })
        return rowOf(`screen:${index}`, { screen_distance: screenDistance }, {
          image_height: numberValue(sample.imageHeight), magnification: numberValue(sample.magnification),
        }, { formula: 'image_height = object_height * screen_distance / object_distance' })
      }), conditions, { sampleSelection: 'current-screen-and-pinhole-layout-presets' })
    return holdEvidence(model, reading, {
      objectHeight: 'm', objectDistance: 'm', screenDistance: 'm', imageHeight: 'm', magnification: '', tipAt: 'm', tailAt: 'm', inverted: 'boolean',
    }, [analysis], conditions, LIGHT_MARKERS)
  }
  const reading = refractionReadingOf(model)
  const conditions = [
    conditionOf('incident_index', quantity(model.incidentIndex, '', 'dimensionless'), target),
    conditionOf('refracted_index', quantity(model.refractedIndex, '', 'dimensionless'), target),
    conditionOf('incident_angle', quantity(model.incidentAngle, 'rad', 'angle'), target),
  ]
  const angles = [...new Set(reading.criticalAngle === undefined
    ? [model.incidentAngle, 0, Math.PI / 6]
    : [model.incidentAngle, reading.criticalAngle / 2, reading.criticalAngle, (reading.criticalAngle + Math.PI / 2) / 2])]
  const analysis = analysisOf(context, 'light-refraction-angle', [axisOf('incident_angle', 'angle', 'rad')],
    [metricOf('critical_angle', 'angle', 'rad', target), metricOf('refracted_angle', 'angle', 'rad', target),
      metricOf('total_internal_reflection', 'dimensionless', '', target, LIGHT_MARKERS.total_internal_reflection)],
    angles.map((incidentAngle, index) => {
      const sample = refractionReadingOf({ ...model, incidentAngle })
      return rowOf(`angle:${index}`, { incident_angle: incidentAngle }, {
        critical_angle: numberValue(sample.criticalAngle, 'no-critical-angle-for-media'),
        refracted_angle: numberValue(sample.refractedAngle, 'total-internal-reflection'),
        total_internal_reflection: sample.totalInternalReflection ? -1 : 1,
      }, { formula: 'n1 * sin(theta1) = n2 * sin(theta2)', criticalAngleExists: sample.criticalAngle !== undefined })
    }), conditions, { sampleSelection: reading.criticalAngle === undefined ? 'current-normal-thirty-degrees' : 'current-under-critical-past-critical' })
  return holdEvidence(model, reading, {
    incidentIndex: '', refractedIndex: '', incidentAngle: 'rad', criticalAngle: 'rad', refractedAngle: 'rad',
    totalInternalReflection: 'boolean',
  }, [analysis], conditions, LIGHT_MARKERS)
}

export const transformerCaptureEvidence = (
  context: Context & { readonly model: ResolvedTransformerModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  const reading = transformerReadingOf(model.primaryVoltage, model.primaryCurrent, model.primaryTurns, model.secondaryTurns)
  const conditions = [
    conditionOf('primary_voltage', quantity(model.primaryVoltage, 'V', 'electric_potential'), target),
    conditionOf('primary_current', quantity(model.primaryCurrent, 'A', 'electric_current'), target),
    conditionOf('primary_turns', quantity(model.primaryTurns, '', 'dimensionless'), target),
    conditionOf('secondary_turns', quantity(model.secondaryTurns, '', 'dimensionless'), target),
  ]
  const windingAnalysis = analysisOf(context, 'transformer-windings', [axisOf('winding', 'dimensionless', '', 'static', 'winding-index')],
    [metricOf('winding_turns', 'dimensionless', '', target), metricOf('winding_voltage', 'electric_potential', 'V', target),
      metricOf('winding_current', 'electric_current', 'A', target), metricOf('winding_power', 'power', 'W', target)],
    [rowOf('primary', { winding: 0 }, { winding_turns: reading.primaryTurns, winding_voltage: numberValue(reading.primaryVoltage),
      winding_current: numberValue(reading.primaryCurrent), winding_power: numberValue(reading.primaryPower) }, { winding: 'primary' }),
    rowOf('secondary', { winding: 1 }, { winding_turns: reading.secondaryTurns, winding_voltage: numberValue(reading.secondaryVoltage),
      winding_current: numberValue(reading.secondaryCurrent), winding_power: numberValue(reading.secondaryPower) }, { winding: 'secondary' })], conditions)
  const turns = [...new Set([model.secondaryTurns, model.primaryTurns * 0.2, model.primaryTurns, model.primaryTurns * 5])]
  const turnsAnalysis = analysisOf(context, 'transformer-secondary-turns', [axisOf('secondary_turns', 'dimensionless', '')],
    [metricOf('secondary_voltage', 'electric_potential', 'V', target), metricOf('secondary_current', 'electric_current', 'A', target),
      metricOf('secondary_power', 'power', 'W', target)],
    turns.map((secondaryTurns, index) => {
      const sample = transformerReadingOf(model.primaryVoltage, model.primaryCurrent, model.primaryTurns, secondaryTurns)
      return rowOf(`turns:${index}`, { secondary_turns: numberValue(secondaryTurns) }, {
        secondary_voltage: numberValue(sample.secondaryVoltage), secondary_current: numberValue(sample.secondaryCurrent),
        secondary_power: numberValue(sample.secondaryPower),
      }, {
        formula: 'U2 = U1 * N2 / N1; I2 = I1 * N1 / N2',
        samples: [
          ...(secondaryTurns === model.secondaryTurns ? ['current-winding'] : []),
          ...(secondaryTurns === model.primaryTurns * 0.2 ? ['step-down-preset'] : []),
          ...(secondaryTurns === model.primaryTurns ? ['equal-turns'] : []),
          ...(secondaryTurns === model.primaryTurns * 5 ? ['step-up-preset'] : []),
        ],
      })
    }), conditions, { sampleSelection: 'current-step-down-equal-turns-step-up-presets' })
  return holdEvidence(model, reading, {
    primaryVoltage: 'V', secondaryVoltage: 'V', primaryCurrent: 'A', secondaryCurrent: 'A', primaryTurns: '', secondaryTurns: '',
    primaryPower: 'W', secondaryPower: 'W', turnsRatio: '', fluxRate: 'Wb/s', stepsUp: 'boolean',
  }, [windingAnalysis, turnsAnalysis], conditions)
}

export const THERMOMETER_METRIC_SEMANTICS = freezeData<Readonly<Record<string, MetricSemantics>>>({
  reading_temperature: { semanticKey: 'temperature', scale: ABSOLUTE_TEMPERATURE },
  expansion_coefficient: {
    semanticKey: 'volumetric_expansion_coefficient_per_temperature',
    scale: { kind: 'unresolved', reason: 'The engine encodes 1/K as dimensionless; the unit registry has no reciprocal-temperature dimension.' },
  },
  scale_factor: {
    semanticKey: 'column_sensitivity_per_temperature',
    scale: { kind: 'unresolved', reason: 'The engine encodes m/K as length; the unit registry has no length-per-temperature dimension.' },
  },
})

export const thermometerCaptureEvidence = (
  context: Context & { readonly model: ResolvedThermometerModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  const reading = thermometerReadingOf(model.bulbVolume, model.boreDiameter, model.expansionCoefficient,
    model.temperature - CELSIUS_ZERO_IN_KELVIN, model.icePointLength)
  const conditions = [
    conditionOf('bulb_volume', quantity(model.bulbVolume, 'm^3', 'volume'), target),
    conditionOf('bore_diameter', quantity(model.boreDiameter, 'm', 'length'), target),
    conditionOf('expansion_coefficient', quantity(model.expansionCoefficient, '', 'dimensionless'), target,
      THERMOMETER_METRIC_SEMANTICS.expansion_coefficient!.scale),
    conditionOf('temperature', quantity(model.temperature, 'K', 'temperature'), target, ABSOLUTE_TEMPERATURE),
    conditionOf('ice_point_length', quantity(model.icePointLength, 'm', 'length'), target),
  ]
  const celsius = [0, 25, 50, 100]
  const temperatureAxis = axisOf('temperature', 'temperature', 'K', 'parameter', 'absolute-zero')
  const analysis = analysisOf(context, 'thermometer-calibration', [temperatureAxis],
    [metricOf('reading_temperature', 'temperature', 'K', target, THERMOMETER_METRIC_SEMANTICS.reading_temperature),
      metricOf('temperature_rise', 'temperature', 'K', target, {
        semanticKey: 'temperature_rise', scale: TEMPERATURE_DIFFERENCE,
        reference: { identity: 'celsius-ice-point', value: quantity(CELSIUS_ZERO_IN_KELVIN, 'K', 'temperature') },
      }),
      metricOf('column_length', 'length', 'm', target), metricOf('column_rise', 'length', 'm', target, {
        semanticKey: 'column_rise', scale: LINEAR,
        reference: { identity: 'ice-point-column-length', value: quantity(model.icePointLength, 'm', 'length') },
      })],
    celsius.map((temperature, index) => {
      const sample = thermometerReadingOf(model.bulbVolume, model.boreDiameter, model.expansionCoefficient, temperature, model.icePointLength)
      const absolute = temperature + CELSIUS_ZERO_IN_KELVIN
      return rowOf(`calibration:${index}`, { temperature: absolute }, {
        reading_temperature: absolute, temperature_rise: temperature,
        column_length: numberValue(sample.column), column_rise: numberValue(sample.scale * temperature),
      }, { inputTemperature: temperature, inputUnit: 'degC', referenceKelvin: CELSIUS_ZERO_IN_KELVIN,
        fixedPoint: temperature === 0 ? 'ice-point' : temperature === 100 ? 'steam-point' : 'intermediate', formula: 'h = h0 + (V0 * beta / A) * (T - 273.15 K)' })
    }), conditions, {
      sampleSelection: 'native-calibration-table', temperatureScale: 'temperature-absolute',
      inputTemperatureReference: { identity: 'celsius-ice-point', kelvin: CELSIUS_ZERO_IN_KELVIN },
      unsupportedEngineUnits: { expansion_coefficient: { actualUnit: '1/K', rawUnit: '', rawDimension: 'dimensionless' },
        scale_factor: { actualUnit: 'm/K', rawUnit: 'm', rawDimension: 'length' } },
    })
  return holdEvidence(model, reading, {
    bulbVolume: 'm^3', boreArea: 'm^2', boreDiameter: 'm', expansionCoefficient: '1/K',
    temperature: { model: 'K', reading: 'degC', reference: 'celsius-ice-point', kelvinOffset: CELSIUS_ZERO_IN_KELVIN },
    scale: 'm/K', degreesPerMetre: 'K/m',
    icePointLength: 'm', icePoint: 'm', steamPoint: 'm', column: 'm', span: 'm',
  }, [analysis], conditions, THERMOMETER_METRIC_SEMANTICS)
}

const logarithmicScale = (identity: string, value: Quantity): MetricScale => ({
  kind: 'logarithmic', base: 10, factor: 10, reference: { identity, value },
})
const INTENSITY_LEVEL = logarithmicScale('sound-intensity-reference', quantity(REFERENCE_INTENSITY, 'W/m^2', 'intensity'))
const POWER_LEVEL = logarithmicScale('sound-power-reference', quantity(REFERENCE_INTENSITY, 'W', 'power'))
const INTENSITY_RATIO_LEVEL = logarithmicScale('intensity-ratio-unity', quantity(1, '', 'dimensionless'))

export const NOISE_METRIC_SEMANTICS = freezeData<Readonly<Record<string, MetricSemantics>>>({
  sound_power_level: { semanticKey: 'sound_power_level', scale: POWER_LEVEL },
  sound_level: { semanticKey: 'sound_intensity_level', scale: INTENSITY_LEVEL },
  level_without_barrier: { semanticKey: 'sound_intensity_level', scale: INTENSITY_LEVEL },
  spreading_loss: { semanticKey: 'point_source_spreading_gain', scale: INTENSITY_RATIO_LEVEL },
  barrier_attenuation: { semanticKey: 'sound_barrier_insertion_loss', scale: INTENSITY_RATIO_LEVEL },
  relative_level_loss: { semanticKey: 'sound_intensity_level_loss', scale: INTENSITY_RATIO_LEVEL },
})

export const noiseCaptureEvidence = (
  context: Context & { readonly model: ResolvedNoiseModel },
): Evidence => {
  const { model } = context
  const target = model.benchId
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)
  const conditions = [
    conditionOf('sound_power_level', quantity(model.soundPowerLevel, '', 'dimensionless'), target, POWER_LEVEL),
    conditionOf('listener_distance', quantity(model.distance, 'm', 'length'), target),
    conditionOf('barrier_attenuation', quantity(model.barrierAttenuation, '', 'dimensionless'), target, INTENSITY_RATIO_LEVEL),
    conditionOf('relative_level_baseline_distance', quantity(model.distance, 'm', 'length'), target),
    conditionOf('relative_level_baseline_sound_level', quantity(reading.level, '', 'dimensionless'), target, INTENSITY_LEVEL),
  ]
  const relativeLossSemantics: MetricSemantics = {
    ...NOISE_METRIC_SEMANTICS.relative_level_loss!,
    reference: {
      identity: 'relative-level-baseline-distance-over-one-metre',
      value: quantity(model.distance, '', 'dimensionless'),
    },
  }
  const analysis = analysisOf(context, 'noise-distance', [axisOf('listener_distance', 'length', 'm')],
    [metricOf('sound_level', 'dimensionless', '', target, NOISE_METRIC_SEMANTICS.sound_level),
      metricOf('level_without_barrier', 'dimensionless', '', target, NOISE_METRIC_SEMANTICS.level_without_barrier),
      metricOf('sound_intensity', 'intensity', 'W/m^2', target),
      metricOf('relative_level_loss', 'dimensionless', '', target, relativeLossSemantics)],
    [1, 2, 4, 8].map((multiple, index) => {
      const distance = model.distance * multiple
      const sample = noiseReadingOf(model.soundPowerLevel, distance, model.barrierAttenuation)
      return rowOf(`distance:${index}`, { listener_distance: numberValue(distance) }, {
        sound_level: numberValue(sample.level), level_without_barrier: numberValue(sample.levelWithoutBarrier),
        sound_intensity: numberValue(sample.intensity), relative_level_loss: numberValue(reading.level - sample.level),
      }, { distanceMultiple: multiple, baselineDistance: copyJsonObject(quantity(model.distance, 'm', 'length')),
        formula: 'L = Lw - 20 * log10(r / 1 m) - 10 * log10(4 * pi) - A',
        intensityFormula: 'I = I0 * 10^(L / 10)', relativeLevelLossFormula: 'deltaL = L(r0) - L(r) = 20 * log10(r / r0)' })
    }), conditions, { sampleSelection: 'native-doubling-distance-table',
      rawLevelEncoding: { dimension: 'dimensionless', unit: '', numericUnit: 'dB' },
      weighting: 'none', spreadingContributionSign: 'negative' })
  return holdEvidence(model, reading, {
    soundPowerLevel: 'dB', distance: 'm', barrierAttenuation: 'dB', level: 'dB', levelWithoutBarrier: 'dB',
    barrierSaving: 'dB', intensity: 'W/m^2',
  }, [analysis], conditions, NOISE_METRIC_SEMANTICS)
}
