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
    ...scene.thermalBenches.flatMap((entry) => [
      entry.sample.id,
      ...(entry.comparisonSample === undefined ? [] : [entry.comparisonSample.id]),
    ]),
    ...(scene.leverBenches ?? []).map((entry) => entry.id),
    ...(scene.leverBenches ?? []).flatMap((entry) => entry.hangers.map((hanger) => hanger.id)),
    ...(scene.inductionBenches ?? []).map((entry) => entry.id),
    ...(scene.waveBenches ?? []).map((entry) => entry.id),
    ...(scene.pressureBenches ?? []).map((entry) => entry.id),
    ...(scene.currentBenches ?? []).map((entry) => entry.id),
    ...(scene.energyBenches ?? []).map((entry) => entry.id),
    ...(scene.lightBenches ?? []).map((entry) => entry.id),
    ...(scene.transformerBenches ?? []).map((entry) => entry.id),
    ...(scene.thermometerBenches ?? []).map((entry) => entry.id),
    ...(scene.noiseBenches ?? []).map((entry) => entry.id),
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
    const samples = [
      bench.sample,
      ...(bench.comparisonSample === undefined ? [] : [bench.comparisonSample]),
    ]
    const sampleDimensionsValid = samples.every((sample) =>
      hasExpectedDimension(sample.mass, 'mass') &&
      hasExpectedDimension(sample.solidSpecificHeat, 'specific_heat') &&
      hasExpectedDimension(sample.liquidSpecificHeat, 'specific_heat') &&
      hasExpectedDimension(sample.latentHeat, 'specific_latent_heat') &&
      hasExpectedDimension(sample.meltingPoint, 'temperature') &&
      hasExpectedDimension(sample.initialTemperature, 'temperature'))
    const dimensionsValid =
      sampleDimensionsValid &&
      hasExpectedDimension(bench.heaterPower, 'power') &&
      (bench.runDuration === undefined || hasExpectedDimension(bench.runDuration, 'time'))
    checks.push(
      check(`thermal_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Thermal bench "${bench.id}" quantities must use mass / specific heat / latent heat / temperature / power / time dimensions.`,
        targetId: bench.id,
      }),
    )
    /* Latent heat may be zero — that IS how an amorphous sample is stated — and
       a sample may start above its melting point, which is how an
       already-liquid sample is stated. Everything else divides into the heating
       rate, so it has to be strictly positive. */
    const sampleValuesValid = samples.every((sample) => {
      const latentHeat = canonicalValue(sample.latentHeat)
      return (
        canonicalValue(sample.mass) > 0 &&
        canonicalValue(sample.solidSpecificHeat) > 0 &&
        canonicalValue(sample.liquidSpecificHeat) > 0 &&
        Number.isFinite(latentHeat) &&
        latentHeat >= 0 &&
        Number.isFinite(canonicalValue(sample.meltingPoint)) &&
        canonicalValue(sample.meltingPoint) > 0 &&
        Number.isFinite(canonicalValue(sample.initialTemperature)) &&
        canonicalValue(sample.initialTemperature) > 0
      )
    })
    const valuesValid =
      dimensionsValid &&
      sampleValuesValid &&
      canonicalValue(bench.heaterPower) > 0 &&
      (bench.runDuration === undefined || canonicalValue(bench.runDuration) > 0)
    checks.push(
      check(`thermal_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Thermal bench "${bench.id}" needs positive mass, specific heats, temperatures and power, and a non-negative latent heat.`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.leverBenches ?? []) {
    const dimensionsValid =
      hasExpectedDimension(bench.beamLength, 'length') &&
      hasExpectedDimension(bench.gravity, 'acceleration') &&
      bench.hangers.every(
        (hanger) =>
          hasExpectedDimension(hanger.mass, 'mass') &&
          hasExpectedDimension(hanger.armLength, 'length'),
      )
    checks.push(
      check(`lever_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Lever "${bench.id}" quantities must use mass / length / acceleration dimensions.`,
        targetId: bench.id,
      }),
    )
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }
    const halfBeam = dimensionsValid ? canonicalValue(bench.beamLength) / 2 : 0
    const sides = bench.hangers.map((hanger) => hanger.side)
    const classOne =
      bench.hangers.length === 2 &&
      sides.includes('left') &&
      sides.includes('right')
    const armsOnBeam =
      dimensionsValid &&
      bench.hangers.every((hanger) => canonicalValue(hanger.armLength) <= halfBeam)
    const valuesValid =
      dimensionsValid &&
      positive(bench.beamLength) &&
      positive(bench.gravity) &&
      bench.hangers.every((hanger) => positive(hanger.mass) && positive(hanger.armLength)) &&
      classOne &&
      armsOnBeam
    checks.push(
      check(`lever_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Lever "${bench.id}" needs two hangers on opposite sides, positive masses and arms, and each arm inside half the beam.`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.inductionBenches ?? []) {
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }
    const finite = (quantity: Parameters<typeof canonicalValue>[0]): boolean =>
      Number.isFinite(canonicalValue(quantity))

    const commonDimensions =
      hasExpectedDimension(bench.magneticFluxDensity, 'magnetic_flux_density') &&
      hasExpectedDimension(bench.resistance, 'resistance')

    let subDimensions: boolean
    let subValues: boolean
    if (bench.type === 'bar_motion') {
      subDimensions =
        (bench.barLength === undefined || hasExpectedDimension(bench.barLength, 'length')) &&
        (bench.barVelocity === undefined || hasExpectedDimension(bench.barVelocity, 'velocity'))
      subValues =
        (bench.barLength === undefined || positive(bench.barLength)) &&
        (bench.barVelocity === undefined || finite(bench.barVelocity))
    } else if (bench.type === 'double_bar_rail') {
      /* Masses are per-element positive; velocities / positions are signed
         (direction along the rails); the external force may not be negative. */
      subDimensions =
        (bench.barLength === undefined || hasExpectedDimension(bench.barLength, 'length')) &&
        (bench.barMasses === undefined ||
          (hasExpectedDimension(bench.barMasses[0], 'mass') &&
            hasExpectedDimension(bench.barMasses[1], 'mass'))) &&
        (bench.barVelocities === undefined ||
          (hasExpectedDimension(bench.barVelocities[0], 'velocity') &&
            hasExpectedDimension(bench.barVelocities[1], 'velocity'))) &&
        (bench.barPositions === undefined ||
          (hasExpectedDimension(bench.barPositions[0], 'length') &&
            hasExpectedDimension(bench.barPositions[1], 'length'))) &&
        (bench.externalForce === undefined || hasExpectedDimension(bench.externalForce, 'force'))
      subValues =
        (bench.barLength === undefined || positive(bench.barLength)) &&
        (bench.barMasses === undefined || (positive(bench.barMasses[0]) && positive(bench.barMasses[1]))) &&
        (bench.barVelocities === undefined || (finite(bench.barVelocities[0]) && finite(bench.barVelocities[1]))) &&
        (bench.barPositions === undefined || (finite(bench.barPositions[0]) && finite(bench.barPositions[1]))) &&
        (bench.externalForce === undefined || canonicalValue(bench.externalForce) >= 0)
    } else {
      /* flux_change */
      subDimensions =
        (bench.coilArea === undefined || hasExpectedDimension(bench.coilArea, 'area')) &&
        (bench.coilAngle === undefined || hasExpectedDimension(bench.coilAngle, 'angle')) &&
        (bench.fluxRate === undefined || hasExpectedDimension(bench.fluxRate, 'magnetic_flux_rate'))
      subValues =
        (bench.coilArea === undefined || positive(bench.coilArea)) &&
        (bench.coilAngle === undefined || finite(bench.coilAngle)) &&
        (bench.fluxRate === undefined || finite(bench.fluxRate))
    }

    const dimensionsValid = commonDimensions && subDimensions
    checks.push(
      check(`induction_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Induction bench "${bench.id}" quantities must use magnetic_flux_density / resistance and the sub-model's dimensions.`,
        targetId: bench.id,
      }),
    )

    /* B > 0 and R > 0 are always required: a zero field produces no EMF and a
       zero resistance is not a loop. The bar length / coil area must be > 0
       when present; velocity and flux rate may carry a sign (direction). */
    const valuesValid = dimensionsValid && positive(bench.magneticFluxDensity) && positive(bench.resistance) && subValues
    checks.push(
      check(`induction_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Induction bench "${bench.id}" needs a positive magnetic flux density and resistance, and positive lengths/areas where applicable.`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.waveBenches ?? []) {
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }

    const commonDimensions =
      hasExpectedDimension(bench.amplitude, 'length') &&
      hasExpectedDimension(bench.frequency, 'frequency')

    let subDimensions: boolean
    let subValues: boolean
    if (bench.type === 'standing') {
      subDimensions =
        (bench.stringLength === undefined ||
          hasExpectedDimension(bench.stringLength, 'length')) &&
        (bench.waveSpeed === undefined || hasExpectedDimension(bench.waveSpeed, 'velocity'))
      /* The harmonic is a mode index, not a measurement: n must be a positive
         integer or L = nλ/2 describes no mode of a clamped string. */
      subValues =
        (bench.stringLength === undefined || positive(bench.stringLength)) &&
        (bench.waveSpeed === undefined || positive(bench.waveSpeed)) &&
        (bench.harmonic === undefined ||
          (Number.isInteger(bench.harmonic) && bench.harmonic >= 1))
    } else if (bench.type === 'interference') {
      subDimensions =
        (bench.wavelength === undefined || hasExpectedDimension(bench.wavelength, 'length')) &&
        (bench.sourceSeparation === undefined ||
          hasExpectedDimension(bench.sourceSeparation, 'length')) &&
        (bench.pathOne === undefined || hasExpectedDimension(bench.pathOne, 'length')) &&
        (bench.pathTwo === undefined || hasExpectedDimension(bench.pathTwo, 'length'))
      subValues =
        (bench.wavelength === undefined || positive(bench.wavelength)) &&
        (bench.sourceSeparation === undefined || positive(bench.sourceSeparation)) &&
        (bench.pathOne === undefined || positive(bench.pathOne)) &&
        (bench.pathTwo === undefined || positive(bench.pathTwo))
    } else {
      /* travelling */
      subDimensions =
        (bench.wavelength === undefined || hasExpectedDimension(bench.wavelength, 'length')) &&
        (bench.ropeLength === undefined || hasExpectedDimension(bench.ropeLength, 'length'))
      subValues =
        (bench.wavelength === undefined || positive(bench.wavelength)) &&
        (bench.ropeLength === undefined || positive(bench.ropeLength))
    }

    const dimensionsValid = commonDimensions && subDimensions
    checks.push(
      check(`wave_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Wave bench "${bench.id}" quantities must use length / frequency and the sub-model's dimensions.`,
        targetId: bench.id,
      }),
    )

    /* Every wave quantity is a magnitude: a zero or negative amplitude,
       wavelength or frequency describes no wave, and unlike induction there is
       no signed direction quantity on the bench. */
    const valuesValid =
      dimensionsValid && positive(bench.amplitude) && positive(bench.frequency) && subValues
    checks.push(
      check(`wave_bench_values:${bench.id}`, 'constraint', valuesValid, {
        message: `Wave bench "${bench.id}" needs a positive amplitude and frequency, positive lengths, and an integral harmonic n ≥ 1.`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.pressureBenches ?? []) {
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }
    const nonNegative = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value >= 0
    }
    const optional = (
      quantity: Parameters<typeof canonicalValue>[0] | undefined,
      dimension: Parameters<typeof hasExpectedDimension>[1],
    ): boolean => quantity === undefined || hasExpectedDimension(quantity, dimension)
    const optionalPositive = (
      quantity: Parameters<typeof canonicalValue>[0] | undefined,
    ): boolean => quantity === undefined || positive(quantity)

    let subDimensions: boolean
    let subValues: boolean
    if (bench.type === 'solid') {
      /* A solid-pressure rig is only complete with both the force and the face
         it presses on; the comparison face may be absent (no tipped view). Both
         areas are magnitudes, and a zero area is not a contact. */
      subDimensions =
        optional(bench.force, 'force') &&
        optional(bench.area, 'area') &&
        optional(bench.comparisonArea, 'area')
      subValues =
        bench.force !== undefined &&
        nonNegative(bench.force) &&
        bench.area !== undefined &&
        positive(bench.area) &&
        optionalPositive(bench.comparisonArea)
    } else if (bench.type === 'liquid') {
      /* Depth is measured DOWN from the surface, so a probe level with the
         surface (0) is a real configuration — h = 0 is the one depth that must
         read zero pressure, not a missing value. */
      subDimensions =
        optional(bench.gravity, 'acceleration') &&
        optional(bench.liquidDensity, 'density') &&
        optional(bench.depth, 'length') &&
        optional(bench.comparisonDepth, 'length') &&
        optional(bench.comparisonLiquidDensity, 'density')
      subValues =
        bench.gravity !== undefined &&
        positive(bench.gravity) &&
        bench.liquidDensity !== undefined &&
        positive(bench.liquidDensity) &&
        bench.depth !== undefined &&
        nonNegative(bench.depth) &&
        (bench.comparisonDepth === undefined || nonNegative(bench.comparisonDepth)) &&
        optionalPositive(bench.comparisonLiquidDensity)
    } else {
      /* atmospheric */
      subDimensions =
        optional(bench.gravity, 'acceleration') &&
        optional(bench.atmosphericPressure, 'pressure') &&
        optional(bench.barometerFluidDensity, 'density') &&
        optional(bench.hemisphereRadius, 'length')
      subValues =
        bench.gravity !== undefined &&
        positive(bench.gravity) &&
        bench.atmosphericPressure !== undefined &&
        positive(bench.atmosphericPressure) &&
        bench.barometerFluidDensity !== undefined &&
        positive(bench.barometerFluidDensity) &&
        bench.hemisphereRadius !== undefined &&
        positive(bench.hemisphereRadius)
    }

    const dimensionsValid = subDimensions
    checks.push(
      check(`pressure_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Pressure bench "${bench.id}" quantities must use the sub-model's dimensions (force / area, density / length / acceleration, pressure / density / length).`,
        targetId: bench.id,
      }),
    )
    checks.push(
      check(`pressure_bench_values:${bench.id}`, 'constraint', dimensionsValid && subValues, {
        message: `Pressure bench "${bench.id}" is missing a required ${bench.type} quantity, or carries a non-positive one.`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.currentBenches ?? []) {
    const finite = (quantity: Parameters<typeof canonicalValue>[0]): boolean =>
      Number.isFinite(canonicalValue(quantity))
    const positive = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value > 0
    }
    /* A conductor with no current makes no field, so zero is not a weaker
       version of a valid rig — it is a missing one. The sign IS meaningful:
       it is the direction, and it is what flips the circulation. */
    const nonZero = (quantity: Parameters<typeof canonicalValue>[0]): boolean => {
      const value = canonicalValue(quantity)
      return Number.isFinite(value) && value !== 0
    }
    const optional = (
      quantity: Parameters<typeof canonicalValue>[0] | undefined,
      dimension: Parameters<typeof hasExpectedDimension>[1],
    ): boolean => quantity === undefined || hasExpectedDimension(quantity, dimension)
    const optionalPositive = (
      quantity: Parameters<typeof canonicalValue>[0] | undefined,
    ): boolean => quantity === undefined || positive(quantity)

    let subDimensions: boolean
    let subValues: boolean
    if (bench.type === 'straight_wire') {
      subDimensions =
        optional(bench.current, 'electric_current') &&
        optional(bench.probeDistance, 'length') &&
        optional(bench.comparisonDistance, 'length')
      subValues =
        bench.current !== undefined &&
        nonZero(bench.current) &&
        bench.probeDistance !== undefined &&
        positive(bench.probeDistance) &&
        optionalPositive(bench.comparisonDistance)
    } else if (bench.type === 'motor') {
      subDimensions =
        optional(bench.current, 'electric_current') &&
        optional(bench.turns, 'dimensionless') &&
        optional(bench.magneticFluxDensity, 'magnetic_flux_density') &&
        optional(bench.sideLength, 'length') &&
        optional(bench.coilWidth, 'length') &&
        optional(bench.coilAngle, 'angle')
      subValues =
        bench.current !== undefined &&
        nonZero(bench.current) &&
        bench.turns !== undefined &&
        positive(bench.turns) &&
        finite(bench.turns) &&
        bench.magneticFluxDensity !== undefined &&
        positive(bench.magneticFluxDensity) &&
        bench.sideLength !== undefined &&
        positive(bench.sideLength) &&
        bench.coilWidth !== undefined &&
        positive(bench.coilWidth) &&
        /* Any angle is a rig — 0° lies along the field and 90° is the dead
           point — so only a non-number is refused. */
        bench.coilAngle !== undefined &&
        finite(bench.coilAngle)
    } else if (bench.type === 'electromagnet') {
      subDimensions =
        optional(bench.current, 'electric_current') &&
        optional(bench.turns, 'dimensionless') &&
        optional(bench.coilLength, 'length') &&
        optional(bench.coreRelativePermeability, 'dimensionless') &&
        optional(bench.comparisonCoreRelativePermeability, 'dimensionless') &&
        optional(bench.coreArea, 'area') &&
        optional(bench.gravity, 'acceleration')
      subValues =
        bench.current !== undefined &&
        nonZero(bench.current) &&
        bench.turns !== undefined &&
        positive(bench.turns) &&
        finite(bench.turns) &&
        bench.coilLength !== undefined &&
        positive(bench.coilLength) &&
        /* μ_r = 1 is the AIR-CORED coil — a real rig this bench is measured
           against — so only zero is refused here. */
        bench.coreRelativePermeability !== undefined &&
        positive(bench.coreRelativePermeability) &&
        optionalPositive(bench.comparisonCoreRelativePermeability) &&
        bench.coreArea !== undefined &&
        positive(bench.coreArea) &&
        bench.gravity !== undefined &&
        positive(bench.gravity)
    } else {
      /* solenoid */
      subDimensions =
        optional(bench.current, 'electric_current') &&
        optional(bench.turns, 'dimensionless') &&
        optional(bench.comparisonTurns, 'dimensionless') &&
        optional(bench.coilLength, 'length')
      subValues =
        bench.current !== undefined &&
        nonZero(bench.current) &&
        bench.turns !== undefined &&
        positive(bench.turns) &&
        finite(bench.turns) &&
        optionalPositive(bench.comparisonTurns) &&
        bench.coilLength !== undefined &&
        positive(bench.coilLength)
    }

    checks.push(
      check(`current_bench_dimensions:${bench.id}`, 'dimension', subDimensions, {
        message: `Current bench "${bench.id}" quantities must use the rig's dimensions (current / length, current / turns / length).`,
        targetId: bench.id,
      }),
    )
    checks.push(
      check(
        `current_bench_values:${bench.id}`,
        'constraint',
        subDimensions && subValues,
        {
          message: `Current bench "${bench.id}" is missing a required ${bench.type} quantity, or carries a non-physical one (a zero current makes no field).`,
          targetId: bench.id,
        },
      ),
    )
  }

  for (const bench of scene.energyBenches ?? []) {
    const positive = (value: Parameters<typeof canonicalValue>[0]): boolean => {
      const si = canonicalValue(value)
      return Number.isFinite(si) && si > 0
    }
    const angleValid = (): boolean => {
      const radians = canonicalValue(bench.inclineAngle)
      return Number.isFinite(radians) && radians > 0 && radians < Math.PI / 2
    }
    const dimensionsValid =
      hasExpectedDimension(bench.mass, 'mass') &&
      hasExpectedDimension(bench.gravity, 'acceleration') &&
      hasExpectedDimension(bench.releaseHeight, 'length') &&
      hasExpectedDimension(bench.inclineAngle, 'angle') &&
      hasExpectedDimension(bench.frictionCoefficient, 'dimensionless')
    checks.push(
      check(`energy_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Energy bench "${bench.id}" quantities must use the rig's dimensions (mass / acceleration / length / angle / dimensionless).`,
        targetId: bench.id,
      }),
    )
    const frictionValid = (() => {
      const mu = canonicalValue(bench.frictionCoefficient)
      return Number.isFinite(mu) && mu >= 0
    })()
    checks.push(
      check(
        `energy_bench_values:${bench.id}`,
        'constraint',
        dimensionsValid &&
          positive(bench.mass) &&
          positive(bench.gravity) &&
          positive(bench.releaseHeight) &&
          angleValid() &&
          frictionValid,
        {
          message: `Energy bench "${bench.id}" needs a positive mass, gravity and height, an angle strictly between 0° and 90°, and a friction coefficient ≥ 0.`,
          targetId: bench.id,
        },
      ),
    )
  }

  for (const bench of scene.lightBenches ?? []) {
    const positive = (value: Parameters<typeof canonicalValue>[0]): boolean => {
      const si = canonicalValue(value)
      return Number.isFinite(si) && si > 0
    }
    const optional = (
      value: Parameters<typeof hasExpectedDimension>[0] | undefined,
      dimension: Parameters<typeof hasExpectedDimension>[1],
    ): boolean => value === undefined || hasExpectedDimension(value, dimension)
    const dimensionsValid =
      optional(bench.objectHeight, 'length') &&
      optional(bench.objectDistance, 'length') &&
      optional(bench.screenDistance, 'length') &&
      optional(bench.incidentIndex, 'dimensionless') &&
      optional(bench.refractedIndex, 'dimensionless') &&
      optional(bench.incidentAngle, 'angle')
    checks.push(
      check(`light_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Light bench "${bench.id}" quantities must all be lengths.`,
        targetId: bench.id,
      }),
    )
    const subValues =
      bench.type === 'pinhole'
        ? bench.objectHeight !== undefined &&
          bench.objectDistance !== undefined &&
          bench.screenDistance !== undefined &&
          positive(bench.objectHeight) &&
          positive(bench.objectDistance) &&
          positive(bench.screenDistance)
        : (() => {
          const index = (value?: Parameters<typeof canonicalValue>[0]) =>
            value === undefined ? Number.NaN : canonicalValue(value)
          const angle = index(bench.incidentAngle)
          return (
            bench.incidentIndex !== undefined &&
            bench.refractedIndex !== undefined &&
            bench.incidentAngle !== undefined &&
            index(bench.incidentIndex) >= 1 &&
            positive(bench.refractedIndex) &&
            Number.isFinite(angle) &&
            angle >= 0 &&
            angle < Math.PI / 2
          )
        })()
    checks.push(
      check(`light_bench_values:${bench.id}`, 'constraint', dimensionsValid && subValues, {
        message:
          bench.type === 'pinhole'
            ? `Light bench "${bench.id}" needs a positive object height and two positive distances.`
            : `Light bench "${bench.id}" needs n₁ ≥ 1, n₂ > 0 and an angle of incidence in [0°, 90°).`,
        targetId: bench.id,
      }),
    )
  }

  for (const bench of scene.transformerBenches ?? []) {
    const positive = (value: Parameters<typeof canonicalValue>[0]): boolean => {
      const si = canonicalValue(value)
      return Number.isFinite(si) && si > 0
    }
    const nonNegative = (value: Parameters<typeof canonicalValue>[0]): boolean => {
      const si = canonicalValue(value)
      return Number.isFinite(si) && si >= 0
    }
    const dimensionsValid =
      hasExpectedDimension(bench.primaryVoltage, 'electric_potential') &&
      hasExpectedDimension(bench.primaryCurrent, 'electric_current') &&
      hasExpectedDimension(bench.primaryTurns, 'dimensionless') &&
      hasExpectedDimension(bench.secondaryTurns, 'dimensionless')
    checks.push(
      check(`transformer_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Transformer bench "${bench.id}" quantities must use their contract dimensions.`,
        targetId: bench.id,
      }),
    )
    checks.push(
      check(
        `transformer_bench_values:${bench.id}`,
        'constraint',
        dimensionsValid &&
          positive(bench.primaryVoltage) &&
          nonNegative(bench.primaryCurrent) &&
          positive(bench.primaryTurns) &&
          positive(bench.secondaryTurns),
        {
          message: `Transformer bench "${bench.id}" needs a positive voltage and both windings, with a current >= 0.`,
          targetId: bench.id,
        },
      ),
    )
  }

  for (const bench of scene.thermometerBenches ?? []) {
    const positive = (value: Parameters<typeof canonicalValue>[0]): boolean => {
      const si = canonicalValue(value)
      return Number.isFinite(si) && si > 0
    }
    const finite = (value: Parameters<typeof canonicalValue>[0]): boolean =>
      Number.isFinite(canonicalValue(value))
    const dimensionsValid =
      hasExpectedDimension(bench.bulbVolume, 'volume') &&
      hasExpectedDimension(bench.boreDiameter, 'length') &&
      hasExpectedDimension(bench.expansionCoefficient, 'dimensionless') &&
      hasExpectedDimension(bench.temperature, 'temperature') &&
      hasExpectedDimension(bench.icePointLength, 'length')
    checks.push(
      check(`thermometer_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Thermometer bench "${bench.id}" quantities must use their contract dimensions.`,
        targetId: bench.id,
      }),
    )
    checks.push(
      check(
        `thermometer_bench_values:${bench.id}`,
        'constraint',
        dimensionsValid &&
          positive(bench.bulbVolume) &&
          positive(bench.boreDiameter) &&
          positive(bench.expansionCoefficient) &&
          /* Any temperature is a rig — a thermometer below zero is still a
             thermometer — so only a non-number is refused. */
          finite(bench.temperature) &&
          positive(bench.icePointLength),
        {
          message: `Thermometer bench "${bench.id}" needs a positive bulb, bore, expansion coefficient and ice-point length, with a finite temperature.`,
          targetId: bench.id,
        },
      ),
    )
  }

  for (const bench of scene.noiseBenches ?? []) {
    const si = (value: Parameters<typeof canonicalValue>[0]) => canonicalValue(value)
    const dimensionsValid =
      hasExpectedDimension(bench.soundPowerLevel, 'dimensionless') &&
      hasExpectedDimension(bench.distance, 'length') &&
      hasExpectedDimension(bench.barrierAttenuation, 'dimensionless')
    checks.push(
      check(`noise_bench_dimensions:${bench.id}`, 'dimension', dimensionsValid, {
        message: `Noise bench "${bench.id}" quantities must use their contract dimensions.`,
        targetId: bench.id,
      }),
    )
    checks.push(
      check(
        `noise_bench_values:${bench.id}`,
        'constraint',
        dimensionsValid &&
          /* A source can be quiet: a negative power level is a sound below the
             reference intensity, not a missing value. */
          Number.isFinite(si(bench.soundPowerLevel)) &&
          Number.isFinite(si(bench.distance)) &&
          si(bench.distance) > 0 &&
          Number.isFinite(si(bench.barrierAttenuation)) &&
          si(bench.barrierAttenuation) >= 0,
        {
          message: `Noise bench "${bench.id}" needs a finite power level, a positive distance and a barrier attenuation >= 0.`,
          targetId: bench.id,
        },
      ),
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
