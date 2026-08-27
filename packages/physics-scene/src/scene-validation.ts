import { UNIT_X, UNIT_Y, UNIT_Z, isFiniteVector, magnitude } from '@physicsos/physics-math'
import {
  check,
  summarizeVerification,
  toCanonicalVector,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
} from '@physicsos/physics-core'
import {
  canonicalValue,
  dimensionOf,
  isKnownUnit,
  type PhysicalDimension,
} from '@physicsos/physics-units'

import type { PhysicsScene } from './scene.ts'

const hasExpectedDimension = (
  value: { readonly unit: string; readonly dimension: string },
  expected: PhysicalDimension,
): boolean => {
  try {
    return (
      isKnownUnit(value.unit) &&
      dimensionOf(value.unit) === expected &&
      value.dimension === expected
    )
  } catch {
    return false
  }
}

/**
 * Scene-level structural validation. Physical model preconditions (v ⟂ B and
 * friends) belong to the engine's `canHandle`; this function only asserts the
 * invariants docs/03 §27, §33 and §174 place on any scene.
 */
export const validateScene = (scene: PhysicsScene): VerificationResult => {
  const checks: VerificationCheck[] = []
  const errors: VerificationIssue[] = []

  checks.push(
    check('scene_schema_version', 'schema', scene.schemaVersion === 'physics-scene/1.0', {
      message: `Unexpected scene schemaVersion "${scene.schemaVersion}".`,
    }),
  )

  const revisionValid = Number.isInteger(scene.revision) && scene.revision >= 0
  checks.push(
    check('scene_revision_valid', 'schema', revisionValid, {
      message: `Scene revision must be a non-negative integer, received ${String(scene.revision)}.`,
      details: { revision: scene.revision },
    }),
  )

  const ids = [
    ...scene.particles.map((entry) => entry.id),
    ...scene.bodies.map((entry) => entry.id),
    ...scene.fields.map((entry) => entry.id),
    ...scene.regions.map((entry) => entry.id),
    ...scene.circuits.map((entry) => entry.id),
    ...scene.circuits.flatMap((entry) => entry.components.map((component) => String(component.id))),
    ...scene.opticalBenches.map((entry) => entry.id),
    ...scene.opticalBenches.flatMap((entry) => [
      entry.object.id,
      ...entry.elements.map((element) => element.id),
      ...(entry.screen === undefined ? [] : [entry.screen.id]),
    ]),
    ...scene.acousticBenches.map((entry) => entry.id),
    ...scene.acousticBenches.flatMap((entry) => [entry.source.id, entry.reflector.id]),
    ...scene.fluidTanks.map((entry) => entry.id),
    ...scene.fluidTanks.flatMap((entry) => [entry.block.id, entry.liquid.id]),
    ...scene.thermalBenches.map((entry) => entry.id),
    ...scene.thermalBenches.map((entry) => entry.sample.id),
  ]
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  checks.push(
    check('scene_object_ids_unique', 'schema', duplicates.length === 0, {
      message: `Duplicate object ids: ${duplicates.join(', ')}.`,
      details: { duplicates },
    }),
  )

  const observableIds = scene.observableDefinitions.map((entry) => String(entry.id))
  const duplicateObservables = observableIds.filter(
    (id, index) => observableIds.indexOf(id) !== index,
  )
  checks.push(
    check('observable_ids_unique', 'schema', duplicateObservables.length === 0, {
      message: `Duplicate observable ids: ${duplicateObservables.join(', ')}.`,
    }),
  )

  for (const particle of scene.particles) {
    const unitsKnown =
      isKnownUnit(particle.mass.unit) &&
      isKnownUnit(particle.position.unit) &&
      isKnownUnit(particle.velocity.unit) &&
      (particle.charge === undefined || isKnownUnit(particle.charge.unit))
    checks.push(
      check(`particle_units_known:${particle.id}`, 'dimension', unitsKnown, {
        message: `Particle "${particle.id}" uses a unit outside the registry (docs/03 §12).`,
        targetId: particle.id,
      }),
    )

    const dimensionsValid =
      hasExpectedDimension(particle.mass, 'mass') &&
      hasExpectedDimension(particle.position, 'length') &&
      hasExpectedDimension(particle.velocity, 'velocity') &&
      (particle.charge === undefined || hasExpectedDimension(particle.charge, 'electric_charge'))
    checks.push(
      check(`particle_dimensions_valid:${particle.id}`, 'dimension', dimensionsValid, {
        message: `Particle "${particle.id}" quantities must use their contract dimensions.`,
        targetId: particle.id,
      }),
    )

    if (dimensionsValid) {
      const massSI = canonicalValue(particle.mass)
      checks.push(
        check(`particle_mass_positive:${particle.id}`, 'constraint', massSI > 0, {
          message: `Particle "${particle.id}" must have mass > 0 (docs/03 §33).`,
          targetId: particle.id,
          details: { massSI },
        }),
      )
    }

    checks.push(
      check(
        `particle_position_finite:${particle.id}`,
        'numerical',
        isFiniteVector(particle.position.vector),
        { message: `Particle "${particle.id}" position must be finite.`, targetId: particle.id },
      ),
    )

    checks.push(
      check(
        `particle_velocity_finite:${particle.id}`,
        'numerical',
        isFiniteVector(particle.velocity.vector),
        { message: `Particle "${particle.id}" velocity must be finite.`, targetId: particle.id },
      ),
    )
  }

  for (const body of scene.bodies) {
    const unitsKnown =
      isKnownUnit(body.mass.unit) &&
      isKnownUnit(body.position.unit) &&
      isKnownUnit(body.velocity.unit)
    checks.push(
      check(`body_units_known:${body.id}`, 'dimension', unitsKnown, {
        message: `Body "${body.id}" uses a unit outside the registry (docs/03 §12).`,
        targetId: body.id,
      }),
    )

    const dimensionsValid =
      hasExpectedDimension(body.mass, 'mass') &&
      hasExpectedDimension(body.position, 'length') &&
      hasExpectedDimension(body.velocity, 'velocity')
    checks.push(
      check(`body_dimensions_valid:${body.id}`, 'dimension', dimensionsValid, {
        message: `Body "${body.id}" quantities must use their contract dimensions.`,
        targetId: body.id,
      }),
    )

    if (dimensionsValid) {
      const massSI = canonicalValue(body.mass)
      checks.push(
        check(`body_mass_positive:${body.id}`, 'constraint', massSI > 0, {
          message: `Body "${body.id}" must have mass > 0.`,
          targetId: body.id,
          details: { massSI },
        }),
      )
    }

    checks.push(
      check(
        `body_position_finite:${body.id}`,
        'numerical',
        isFiniteVector(body.position.vector),
        { message: `Body "${body.id}" position must be finite.`, targetId: body.id },
      ),
    )

    checks.push(
      check(
        `body_velocity_finite:${body.id}`,
        'numerical',
        isFiniteVector(body.velocity.vector),
        { message: `Body "${body.id}" velocity must be finite.`, targetId: body.id },
      ),
    )
  }

  for (const field of scene.fields) {
    if (field.type === 'uniform_magnetic') {
      const dimensionsValid = hasExpectedDimension(
        field.magneticFluxDensity,
        'magnetic_flux_density',
      )
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" magnetic flux density must use magnetic_flux_density.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.magneticFluxDensity) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" flux density must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.type === 'uniform_electric') {
      const dimensionsValid = hasExpectedDimension(field.fieldStrength, 'electric_field')
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" strength must use electric_field.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.fieldStrength) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" field strength must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.type === 'uniform_gravity') {
      const dimensionsValid = hasExpectedDimension(field.acceleration, 'acceleration')
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" acceleration must use acceleration.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.acceleration) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" acceleration must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.regionId !== undefined) {
      const regionExists = scene.regions.some((region) => region.id === field.regionId)
      checks.push(
        check(`field_region_exists:${field.id}`, 'semantic', regionExists, {
          message: `Field "${field.id}" references unknown region "${field.regionId}".`,
          targetId: field.id,
        }),
      )
    }
  }

  for (const circuit of scene.circuits) {
    const nodeIds = circuit.nodes.map((node) => node.id)
    const duplicateNodes = nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index)
    checks.push(
      check(`circuit_node_ids_unique:${circuit.id}`, 'schema', duplicateNodes.length === 0, {
        message: `Circuit "${circuit.id}" has duplicate node ids: ${duplicateNodes.join(', ')}.`,
        targetId: circuit.id,
      }),
    )

    const connectionIds = circuit.connections.map((connection) => connection.id)
    const duplicateConnections = connectionIds.filter(
      (id, index) => connectionIds.indexOf(id) !== index,
    )
    checks.push(
      check(
        `circuit_connection_ids_unique:${circuit.id}`,
        'schema',
        duplicateConnections.length === 0,
        {
          message: `Circuit "${circuit.id}" has duplicate connection ids: ${duplicateConnections.join(', ')}.`,
          targetId: circuit.id,
        },
      ),
    )

    const componentIds = new Set(circuit.components.map((component) => String(component.id)))
    for (const connection of circuit.connections) {
      const endpointsValid =
        componentIds.has(String(connection.from.componentId)) &&
        componentIds.has(String(connection.to.componentId)) &&
        connection.from.terminalKey.length > 0 &&
        connection.to.terminalKey.length > 0
      checks.push(
        check(`circuit_connection_endpoints:${connection.id}`, 'semantic', endpointsValid, {
          message: `Connection "${connection.id}" references a component missing from circuit "${circuit.id}".`,
          targetId: circuit.id,
        }),
      )
    }

    for (const component of circuit.components) {
      const componentId = String(component.id)
      let dimensionsValid = true
      let valuesValid = true
      switch (component.type) {
        case 'resistor': {
          dimensionsValid = hasExpectedDimension(component.resistance, 'resistance')
          valuesValid =
            dimensionsValid &&
            Number.isFinite(canonicalValue(component.resistance)) &&
            canonicalValue(component.resistance) > 0
          break
        }
        case 'voltage_source': {
          dimensionsValid =
            hasExpectedDimension(component.voltage, 'electric_potential') &&
            (component.internalResistance === undefined ||
              hasExpectedDimension(component.internalResistance, 'resistance'))
          valuesValid =
            dimensionsValid &&
            Number.isFinite(canonicalValue(component.voltage)) &&
            (component.internalResistance === undefined ||
              canonicalValue(component.internalResistance) >= 0)
          break
        }
        case 'switch': {
          valuesValid = component.state === 'open' || component.state === 'closed'
          break
        }
        case 'ammeter':
        case 'voltmeter': {
          dimensionsValid =
            component.internalResistance === undefined ||
            hasExpectedDimension(component.internalResistance, 'resistance')
          valuesValid =
            dimensionsValid &&
            (component.internalResistance === undefined ||
              canonicalValue(component.internalResistance) >= 0)
          break
        }
        case 'variable_resistor': {
          dimensionsValid = hasExpectedDimension(component.totalResistance, 'resistance')
          valuesValid =
            dimensionsValid &&
            Number.isFinite(canonicalValue(component.totalResistance)) &&
            canonicalValue(component.totalResistance) > 0 &&
            Number.isFinite(component.sliderPosition) &&
            component.sliderPosition >= 0 &&
            component.sliderPosition <= 1
          break
        }
        case 'capacitor': {
          dimensionsValid = hasExpectedDimension(component.capacitance, 'capacitance')
          valuesValid = dimensionsValid && canonicalValue(component.capacitance) > 0
          break
        }
        case 'inductor': {
          dimensionsValid = hasExpectedDimension(component.inductance, 'inductance')
          valuesValid = dimensionsValid && canonicalValue(component.inductance) > 0
          break
        }
      }
      checks.push(
        check(`circuit_component_dimensions:${componentId}`, 'dimension', dimensionsValid, {
          message: `Component "${componentId}" quantities must use their contract dimensions.`,
          targetId: componentId,
        }),
      )
      checks.push(
        check(`circuit_component_values:${componentId}`, 'constraint', valuesValid, {
          message: `Component "${componentId}" carries an out-of-range value.`,
          targetId: componentId,
        }),
      )
    }
  }

  for (const bench of scene.opticalBenches) {
    const objectDimensionsValid =
      hasExpectedDimension(bench.object.position, 'length') &&
      hasExpectedDimension(bench.object.height, 'length')
    checks.push(
      check(`optical_object_dimensions:${bench.id}`, 'dimension', objectDimensionsValid, {
        message: `Optical object of bench "${bench.id}" must use length quantities.`,
        targetId: bench.object.id,
      }),
    )
    const objectValuesValid =
      objectDimensionsValid &&
      Number.isFinite(canonicalValue(bench.object.position)) &&
      Number.isFinite(canonicalValue(bench.object.height)) &&
      canonicalValue(bench.object.height) > 0
    checks.push(
      check(`optical_object_values:${bench.id}`, 'constraint', objectValuesValid, {
        message: `Optical object of bench "${bench.id}" must be finite with height > 0.`,
        targetId: bench.object.id,
      }),
    )

    for (const element of bench.elements) {
      let dimensionsValid = hasExpectedDimension(element.position, 'length')
      let valuesValid = dimensionsValid && Number.isFinite(canonicalValue(element.position))
      if (element.apertureRadius !== undefined) {
        dimensionsValid =
          dimensionsValid && hasExpectedDimension(element.apertureRadius, 'length')
        valuesValid =
          valuesValid && dimensionsValid && canonicalValue(element.apertureRadius) > 0
      }
      if (element.type === 'thin_lens' || element.type === 'curved_mirror') {
        const focalDimensionValid = hasExpectedDimension(element.focalLength, 'length')
        dimensionsValid = dimensionsValid && focalDimensionValid
        /* f = 0 is not an imaging element; both signs are legal (a converging
           convex lens / concave mirror vs a diverging concave lens / convex
           mirror). */
        valuesValid =
          valuesValid &&
          focalDimensionValid &&
          Number.isFinite(canonicalValue(element.focalLength)) &&
          canonicalValue(element.focalLength) !== 0
      }
      checks.push(
        check(`optical_element_dimensions:${element.id}`, 'dimension', dimensionsValid, {
          message: `Optical element "${element.id}" quantities must use length dimensions.`,
          targetId: element.id,
        }),
      )
      checks.push(
        check(`optical_element_values:${element.id}`, 'constraint', valuesValid, {
          message: `Optical element "${element.id}" carries an out-of-range value.`,
          targetId: element.id,
        }),
      )
    }

    if (bench.screen !== undefined) {
      const screenValid =
        hasExpectedDimension(bench.screen.position, 'length') &&
        Number.isFinite(canonicalValue(bench.screen.position))
      checks.push(
        check(`optical_screen_valid:${bench.id}`, 'constraint', screenValid, {
          message: `Optical screen of bench "${bench.id}" must have a finite length position.`,
          targetId: bench.screen.id,
        }),
      )
    }
  }

  for (const bench of scene.acousticBenches) {
    const dimensionsValid =
      hasExpectedDimension(bench.source.position, 'length') &&
      hasExpectedDimension(bench.reflector.position, 'length') &&
      hasExpectedDimension(bench.soundSpeed, 'velocity')
    checks.push(
      check(`acoustic_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Acoustic bench "${bench.id}" quantities must use length / velocity dimensions.`,
        targetId: bench.id,
      }),
    )
    /* The pulse travels towards +x: a reflector at or behind the source has no
       echo path, and a non-positive sound speed is not a propagation medium. */
    const valuesValid =
      dimensionsValid &&
      Number.isFinite(canonicalValue(bench.source.position)) &&
      Number.isFinite(canonicalValue(bench.reflector.position)) &&
      canonicalValue(bench.reflector.position) > canonicalValue(bench.source.position) &&
      Number.isFinite(canonicalValue(bench.soundSpeed)) &&
      canonicalValue(bench.soundSpeed) > 0
    checks.push(
      check(`acoustic_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Acoustic bench "${bench.id}" needs the reflector ahead of the source and sound speed > 0.`,
        targetId: bench.id,
      }),
    )
  }

  for (const tank of scene.fluidTanks) {
    const dimensionsValid =
      hasExpectedDimension(tank.block.mass, 'mass') &&
      hasExpectedDimension(tank.block.volume, 'volume') &&
      hasExpectedDimension(tank.block.height, 'length') &&
      hasExpectedDimension(tank.liquid.density, 'density') &&
      hasExpectedDimension(tank.lowerRate, 'velocity') &&
      hasExpectedDimension(tank.gravity, 'acceleration')
    checks.push(
      check(`fluid_tank_dimensions:${tank.id}`, 'dimension', dimensionsValid, {
        message: `Fluid tank "${tank.id}" quantities must use mass / volume / length / density / velocity / acceleration dimensions.`,
        targetId: tank.id,
      }),
    )
    /* Every one of these is a divisor or a physical extent somewhere in the
       Archimedes solution: a zero volume has no cross-section, a zero height
       cannot convert depth into displaced volume, and a still or massless
       liquid is not a fluid to float in. */
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }
    const valuesValid =
      dimensionsValid &&
      positive(tank.block.mass) &&
      positive(tank.block.volume) &&
      positive(tank.block.height) &&
      positive(tank.liquid.density) &&
      positive(tank.lowerRate) &&
      positive(tank.gravity)
    checks.push(
      check(`fluid_tank_values:${tank.id}`, 'constraint', valuesValid, {
        message: `Fluid tank "${tank.id}" needs a positive block mass, volume and height, liquid density, lowering rate and gravity.`,
        targetId: tank.id,
      }),
    )
  }

  for (const bench of scene.thermalBenches) {
    const sample = bench.sample
    const dimensionsValid =
      hasExpectedDimension(sample.mass, 'mass') &&
      hasExpectedDimension(sample.solidSpecificHeat, 'specific_heat') &&
      hasExpectedDimension(sample.liquidSpecificHeat, 'specific_heat') &&
      hasExpectedDimension(sample.latentHeat, 'specific_latent_heat') &&
      hasExpectedDimension(sample.meltingPoint, 'temperature') &&
      hasExpectedDimension(sample.initialTemperature, 'temperature') &&
      hasExpectedDimension(bench.heaterPower, 'power')
    checks.push(
      check(`thermal_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Thermal bench "${bench.id}" quantities must use mass / specific heat / latent heat / temperature / power dimensions.`,
        targetId: bench.id,
      }),
    )
    /* Latent heat may be zero — that IS how an amorphous sample is stated —
       but everything else divides into the heating rate, and the sample has to
       start below its melting point or there is no solid phase to heat. */
    const meltingPoint = canonicalValue(sample.meltingPoint)
    const initialTemperature = canonicalValue(sample.initialTemperature)
    const latentHeat = canonicalValue(sample.latentHeat)
    const valuesValid =
      dimensionsValid &&
      canonicalValue(sample.mass) > 0 &&
      canonicalValue(sample.solidSpecificHeat) > 0 &&
      canonicalValue(sample.liquidSpecificHeat) > 0 &&
      Number.isFinite(latentHeat) &&
      latentHeat >= 0 &&
      Number.isFinite(meltingPoint) &&
      meltingPoint > 0 &&
      Number.isFinite(initialTemperature) &&
      initialTemperature > 0 &&
      initialTemperature < meltingPoint &&
      canonicalValue(bench.heaterPower) > 0
    checks.push(
      check(`thermal_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Thermal bench "${bench.id}" needs positive mass, specific heats and power, a non-negative latent heat, and a starting temperature below the melting point.`,
        targetId: bench.id,
      }),
    )
  }

  for (const observable of scene.observableDefinitions) {
    if (observable.targetId === undefined) continue
    const targetExists = ids.includes(observable.targetId)
    checks.push(
      check(`observable_target_exists:${String(observable.id)}`, 'semantic', targetExists, {
        message: `Observable "${String(observable.id)}" targets unknown object "${observable.targetId}".`,
        targetId: observable.targetId,
      }),
    )
  }

  const axes = scene.coordinateSystem.axes
  const axesOrthonormal =
    magnitude(axes.x) > 0 &&
    magnitude(axes.y) > 0 &&
    magnitude(axes.z) > 0 &&
    isFiniteVector(axes.x) &&
    isFiniteVector(axes.y) &&
    isFiniteVector(axes.z)
  checks.push(
    check('coordinate_axes_valid', 'schema', axesOrthonormal, {
      message: 'Coordinate axes must be finite non-zero vectors.',
    }),
  )

  const playbackRateValid =
    Number.isFinite(scene.timeline.playbackRate) && scene.timeline.playbackRate > 0
  checks.push(
    check('timeline_playback_rate_valid', 'schema', playbackRateValid, {
      message: `Timeline playbackRate must be a positive finite number, received ${String(
        scene.timeline.playbackRate,
      )}.`,
    }),
  )

  const timelineDimensionsValid =
    hasExpectedDimension(scene.timeline.currentTime, 'time') &&
    hasExpectedDimension(scene.timeline.startTime, 'time') &&
    (scene.timeline.endTime === undefined ||
      hasExpectedDimension(scene.timeline.endTime, 'time')) &&
    (scene.timeline.simulationTimeStep === undefined ||
      hasExpectedDimension(scene.timeline.simulationTimeStep, 'time'))
  checks.push(
    check('timeline_dimensions_valid', 'dimension', timelineDimensionsValid, {
      message: 'Timeline quantities must use time dimensions.',
    }),
  )

  return summarizeVerification(checks, [], errors)
}

/** Standard right-handed 2D cartesian frame in metres. */
export const defaultCoordinateSystem = () => ({
  type: 'cartesian' as const,
  origin: { x: 0, y: 0, z: 0 },
  axes: { x: UNIT_X, y: UNIT_Y, z: UNIT_Z },
  lengthUnit: 'm',
})
