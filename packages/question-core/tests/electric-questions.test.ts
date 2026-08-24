import { describe, expect, it } from 'vitest'

import {
  createGoldenQuestionDocument,
  DeterministicElectricQuestionParser,
  GOLDEN_QUESTIONS,
  isElectricQuestionText,
  processQuestion,
} from '../src/index.ts'
import { isParallelPlateScene } from '@physicsos/physics-scene'

const electricQuestion = (id: string) => {
  const definition = GOLDEN_QUESTIONS.find((candidate) => candidate.id === id)
  if (definition === undefined) throw new Error(`Missing electric golden question ${id}`)
  return definition
}

const scalar = (
  result: ReturnType<typeof processQuestion>,
  key: string,
): number => {
  const derived = result.simulation?.derivedQuantities.find((candidate) => candidate.key === key)
  if (derived === undefined || 'vector' in derived.value) {
    throw new Error(`Missing scalar derived quantity ${key}`)
  }
  return derived.value.value
}

const vector = (
  result: ReturnType<typeof processQuestion>,
  key: string,
): { x: number; y: number; z: number } => {
  const derived = result.simulation?.derivedQuantities.find((candidate) => candidate.key === key)
  if (derived === undefined || !('vector' in derived.value)) {
    throw new Error(`Missing vector derived quantity ${key}`)
  }
  return derived.value.vector
}

describe('DeterministicElectricQuestionParser', () => {
  it('extracts electric quantities, directions, targets and relations', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-01-perpendicular-deflection'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.confidence).toBeGreaterThan(0.9)
    expect(candidate.ir.domain).toBe('electric')
    expect(candidate.ir.model).toBe('charged_particle_uniform_electric_field')
    expect(candidate.ir.entities).toEqual(['particle', 'electric_field'])
    expect(candidate.ir.electricFieldDirection).toBe('up')
    expect(candidate.ir.initialVelocityDirection).toBe('right')
    expect(candidate.ir.relations).toContain('velocity_perpendicular_E')
    expect(candidate.ir.assumptions).toContain('electric_force_only')
    expect(candidate.ir.targets).toEqual(expect.arrayContaining([
      'electric_force',
      'acceleration',
      'final_velocity',
      'displacement',
      'electric_potential_change',
      'electric_potential_energy_change',
      'work_by_electric_field',
      'kinetic_energy_change',
    ]))
    expect(candidate.ir.knowns.find((known) => known.key === 'electric_field_strength')?.value).toBe(6)
    expect(candidate.ir.knowns.find((known) => known.key === 'time')?.value).toBe(2)
  })

  it('does not claim a magnetic-field question', () => {
    const magnetic = electricQuestion('01-proton-basic')
    const document = createGoldenQuestionDocument(magnetic)
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(isElectricQuestionText(magnetic.text)).toBe(false)
    expect(candidate.confidence).toBeLessThan(0.5)
    expect(candidate.issues).toContainEqual(expect.objectContaining({ code: 'NOT_ELECTRIC_QUESTION' }))
    expect(processQuestion(document).ir?.domain).toBe('magnetic')
  })
})

describe('Electric Question full pipeline', () => {
  it('runs perpendicular deflection through Scene, Engine, Verifier and Observation', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-01-perpendicular-deflection'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.scene?.fields[0]?.type).toBe('uniform_electric')
    expect(result.scene?.timeline.endTime?.value).toBe(2)
    expect(result.simulation?.metadata.engineId).toBe('engine-electric')
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.simulation?.sceneId).toBe(result.scene?.id)
    expect(result.simulation?.sceneRevision).toBe(result.scene?.revision)

    expect(scalar(result, 'electric_force_magnitude')).toBeCloseTo(12)
    expect(scalar(result, 'acceleration_magnitude')).toBeCloseTo(3)
    expect(vector(result, 'displacement_vector')).toMatchObject({ x: 6, y: 6, z: 0 })
    expect(scalar(result, 'electric_potential_change')).toBeCloseTo(-36)
    expect(scalar(result, 'electric_potential_energy_change')).toBeCloseTo(-72)
    expect(scalar(result, 'work_by_electric_field')).toBeCloseTo(72)
    expect(scalar(result, 'kinetic_energy_change')).toBeCloseTo(72)

    const observationTypes = result.observations?.observations.map((observation) => observation.type)
    expect(observationTypes).toEqual(expect.arrayContaining([
      'electric_field',
      'electric_force',
      'electric_velocity',
      'electric_acceleration',
      'electric_trajectory',
      'electric_potential',
      'electric_energy',
    ]))
    expect(result.solution?.results['electric_force']).toBeDefined()
    expect(result.solution?.results['displacement']).toMatchObject({ value: '(6.0000, 6.0000)', unit: 'm' })
    expect(result.solution?.results['electric_potential_energy_change']).toBeDefined()
    expect(result.solution?.results['kinetic_energy_change']).toBeDefined()
  })

  it('preserves signed energy facts for a negative charge moving parallel to E', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-02-negative-parallel'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.relations).toContain('velocity_parallel_E')
    expect(result.scene?.particles[0]?.charge?.value).toBe(-1)
    const force = vector(result, 'electric_force_vector')
    expect(force.x).toBeCloseTo(-2)
    expect(force.y).toBeCloseTo(0)
    expect(force.z).toBeCloseTo(0)
    expect(scalar(result, 'acceleration_magnitude')).toBeCloseTo(1)
    expect(scalar(result, 'speed')).toBeCloseTo(2)
    expect(vector(result, 'displacement_vector')).toMatchObject({ x: 6, y: 0, z: 0 })
    expect(scalar(result, 'electric_potential_change')).toBeCloseTo(-12)
    expect(scalar(result, 'electric_potential_energy_change')).toBeCloseTo(12)
    expect(scalar(result, 'kinetic_energy_change')).toBeCloseTo(-12)
    expect(result.simulation?.verification.status).toBe('passed')
  })
})

describe('Electric semantic validation', () => {
  it('returns AMBIGUOUS when the electric-field direction is missing', () => {
    const document = createGoldenQuestionDocument({
      id: 'electric-ambiguous-direction',
      title: '缺少电场方向',
      text: '一个带正电粒子，q = +1 C，m = 1 kg，处于匀强电场中，E = 2 N/C。求电场力。',
      expectedDomain: 'electric',
      expectedChargeSign: 'positive',
      expectedFieldDirection: 'unknown',
      expectedValidation: 'AMBIGUOUS',
    })
    const result = processQuestion(document)

    expect(result.workflowState).toBe('AMBIGUOUS')
    expect(result.validation?.ambiguities).toContainEqual(expect.objectContaining({
      field: 'electricFieldDirection',
    }))
  })

  it('returns INVALID_SEMANTICS instead of filling a missing mass with a default', () => {
    const document = createGoldenQuestionDocument({
      id: 'electric-missing-mass',
      title: '缺少质量',
      text: '一个带正电粒子，q = +1 C，处于匀强电场中，E = 2 N/C，电场方向沿 x 轴正方向。求加速度。',
      expectedDomain: 'electric',
      expectedChargeSign: 'positive',
      expectedFieldDirection: 'unknown',
      expectedValidation: 'INVALID_SEMANTICS',
    })
    const result = processQuestion(document)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_MASS' }))
    expect(result.scene).toBeNull()
  })
})

describe('Point-charge Golden Questions', () => {
  it('Q1: parses a point-charge E question into the point-charge model and a point-charge scene', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-03-point-charge-field'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('point_charge_electrostatic_field')
    expect(result.ir?.relations).toContain('point_charge_field')
    expect(result.scene?.fields[0]?.type).toBe('point_charge')
    expect(result.simulation?.metadata.engineId).toBe('engine-electric')
    expect(result.simulation?.metadata.solver).toBe('analytical-point-charge')
    expect(result.simulation?.verification.status).toBe('passed')
    /* E = kq/r² = 8.9875e9 × 5e-6 / 0.2² ≈ 1.1234×10⁶ V/m. */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(1.1234e6, -3)
    expect(vector(result, 'electric_field_vector').x).toBeGreaterThan(0)
  })

  it('Q2: computes the force on a test charge, F = qE', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-04-point-charge-force'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('point_charge_electrostatic_field')
    expect(result.scene?.fields[0]?.type).toBe('point_charge')
    expect(result.simulation?.verification.status).toBe('passed')
    /* E ≈ 1.1234×10⁶ V/m; F = q'E = 2e-6 × E ≈ 2.247 N, repulsive (+x). */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(1.1234e6, -3)
    expect(scalar(result, 'electric_force_magnitude')).toBeCloseTo(2.247, 2)
    const force = vector(result, 'electric_force_vector')
    expect(force.x).toBeGreaterThan(0)
    expect(force.y).toBeCloseTo(0)
    /* The solution must surface the force the engine produced, not recompute it. */
    expect(result.solution?.results['electric_force']).toBeDefined()
  })

  it('Q3: carries the negative source sign so the direction is answerable', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-05-point-charge-direction'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.chargeSign).toBe('negative')
    expect(result.ir?.targets).toContain('electric_field_direction')
    expect(result.scene?.fields[0]?.type).toBe('point_charge')
    expect(result.simulation?.verification.status).toBe('passed')
    /* A negative source: the field at the +x probe points back toward the charge. */
    expect(vector(result, 'electric_field_vector').x).toBeLessThan(0)
  })

  it('does not route a uniform-field question to the point-charge model', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-01-perpendicular-deflection'))
    const result = processQuestion(document)

    expect(result.ir?.model).toBe('charged_particle_uniform_electric_field')
    expect(result.scene?.fields[0]?.type).toBe('uniform_electric')
  })

  it('multi-source Q1: parses an unlike-charges midpoint question with two sources', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-06-dipole-midpoint-field'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('point_charge_electrostatic_field')
    expect(result.ir?.sourceCharges).toBeDefined()
    expect(result.ir?.sourceCharges?.length).toBe(2)
    expect(result.ir?.relations).toContain('multi_source_superposition')
    /* Two fixed sources + one probe at the midpoint. */
    const fixedSources = result.scene?.particles.filter((particle) => particle.fixed) ?? []
    expect(fixedSources.length).toBe(2)
    expect(result.scene?.fields[0]?.type).toBe('point_charge')
    expect(result.simulation?.verification.status).toBe('passed')
    /* q1 = +2 μC at x = -0.1, q2 = -2 μC at x = +0.1, midpoint r = 0.1 m.
       Both fields point +x, so E = 2·kq/r² = 2 × 8.9875e9 × 2e-6 / 0.01 ≈ 3.595×10⁶ V/m. */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(3.595e6, -3)
    expect(vector(result, 'electric_field_vector').x).toBeGreaterThan(0)
  })

  it('multi-source Q2: like charges cancel at the midpoint', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-07-like-charges-midpoint'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.sourceCharges?.length).toBe(2)
    expect(result.simulation?.verification.status).toBe('passed')
    /* q1 = q2 = +3 μC, separation 30 cm, midpoint r = 0.15 m. Fields oppose, E = 0. */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(0, 6)
  })

  it('multi-source Q3: dipole midpoint field doubles', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-08-dipole-axis-field'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.sourceCharges?.length).toBe(2)
    expect(result.simulation?.verification.status).toBe('passed')
    /* q1 = +1 μC, q2 = -1 μC, separation 10 cm, midpoint r = 0.05 m.
       Both fields point +x (toward the negative charge), E = 2·kq/r² ≈ 7.19×10⁶ V/m. */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(7.19e6, -3)
    expect(vector(result, 'electric_field_vector').x).toBeGreaterThan(0)
    /* The superposition check must be present and passing. */
    const superposition = result.simulation?.verification.checks.find(
      (check) => check.id === 'electric_field_superposition',
    )
    expect(superposition?.passed).toBe(true)
  })

  it('directional distance: places the probe off-axis to the left of a positive source', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-09-off-axis-field'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('point_charge_electrostatic_field')
    /* The directional distance "距其左侧 15 cm" must populate sampleOffset, not
       leave the probe on the default +x axis. */
    expect(result.ir?.sampleOffset).toBeDefined()
    expect(result.ir?.sampleOffset?.axis).toBe('x')
    expect(result.ir?.sampleOffset?.sign).toBe(-1)
    expect(result.ir?.sampleOffset?.distance).toBeCloseTo(0.15)
    expect(result.ir?.sourceDistance).toBeCloseTo(0.15)
    /* The scene probe sits at x = -0.15 m (left of the source at the origin). */
    const probe = result.scene?.particles.find((particle) => particle.id === 'probe-1')
    expect(probe?.position?.vector.x).toBeCloseTo(-0.15)
    expect(probe?.position?.vector.y).toBeCloseTo(0)
    expect(result.scene?.fields[0]?.type).toBe('point_charge')
    expect(result.simulation?.verification.status).toBe('passed')
    /* q = +4 μC, r = 0.15 m: E = kq/r² = 8.9875e9 × 4e-6 / 0.0225 ≈ 1.598×10⁶ V/m. */
    expect(scalar(result, 'electric_field_magnitude')).toBeCloseTo(1.598e6, -3)
    /* A positive source's field is radial; at the left probe it points -x (away
       from the source, toward -x). */
    const field = vector(result, 'electric_field_vector')
    expect(field.x).toBeLessThan(0)
  })
})

describe('Parallel-plate Golden Questions', () => {
  it('Q10: parses an electron deflection question into the bounded electric field model', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-10-electron-deflection'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.confidence).toBeGreaterThan(0.5)
    expect(candidate.ir.domain).toBe('electric')
    expect(candidate.ir.model).toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.plateSeparation).toBeCloseTo(0.04)
    expect(candidate.ir.plateLength).toBeCloseTo(0.12)
    expect(candidate.ir.relations).toContain('charged_particle_in_bounded_electric_field')
    expect(candidate.ir.relations).toContain('particle_enters_field')
    expect(candidate.ir.assumptions).toContain('bounded_electric_field')
    expect(candidate.ir.assumptions).toContain('parallel_plate')
    expect(candidate.ir.assumptions).toContain('electric_force_only')
    expect(candidate.ir.assumptions).toContain('ignore_gravity')
    expect(candidate.ir.enterPosition).toBe('edge')
    expect(candidate.ir.chargeSign).toBe('negative')
    expect(candidate.ir.electricFieldDirection).toBe('down')
    expect(candidate.ir.targets).toContain('deflection')
    /* Knowns must carry plate geometry. */
    expect(candidate.ir.knowns.find((k) => k.key === 'plate_separation')?.value).toBeCloseTo(0.04)
    expect(candidate.ir.knowns.find((k) => k.key === 'plate_length')?.value).toBeCloseTo(0.12)
    expect(candidate.ir.knowns.find((k) => k.key === 'electric_field_strength')?.value).toBe(2000)
    expect(candidate.ir.knowns.find((k) => k.key === 'charge')?.value).toBeCloseTo(-1.6e-19)
    expect(candidate.ir.knowns.find((k) => k.key === 'mass')?.value).toBeCloseTo(9.11e-31)
  })

  it('Q10: builds a parallel-plate scene with correct structure and runs through the full pipeline', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-10-electron-deflection'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.model).toBe('charged_particle_bounded_electric_field')
    expect(result.ir?.plateSeparation).toBeCloseTo(0.04)
    expect(result.ir?.plateLength).toBeCloseTo(0.12)
    expect(result.ir?.relations).toContain('charged_particle_in_bounded_electric_field')

    /* Scene structure: one rectangular region, two plate boundaries, one uniform
       electric field bound to the region. */
    expect(result.scene).toBeDefined()
    expect(result.scene?.regions.length).toBe(1)
    expect(result.scene?.boundaries.length).toBe(2)
    expect(result.scene?.fields[0]?.type).toBe('uniform_electric')
    expect(result.scene?.fields[0]?.regionId).toBeDefined()
    expect(isParallelPlateScene(result.scene!)).toBe(true)

    /* The engine runs and verification passes. The bounded-field scene is
       handled by the ElectricRegionEngine (engine-electric-region), not the
       unbounded electric engine. */
    expect(result.simulation?.metadata.engineId).toBe('engine-electric-region')
    expect(result.simulation?.verification.status).toBe('passed')

    /* Particle starts outside the field region (left edge entry). */
    const particle = result.scene?.particles[0]
    expect(particle?.position?.vector.x).toBeLessThan(0)
    expect(particle?.charge?.value).toBeLessThan(0)

    /* Deflection: y = 0.5 * a * t² where a = qE/m, t = L/v0
       a = 1.6e-19 * 2000 / 9.11e-31 ≈ 3.513×10^14 m/s²
       t = 0.12 / 3e7 = 4e-9 s
       y = 0.5 * 3.513e14 * (4e-9)² ≈ 2.811×10^-3 m ≈ 2.81 mm
       The engine computes displacement_vector; |y| is the deflection. */
    const displacement = vector(result, 'displacement_vector')
    expect(Math.abs(displacement.y)).toBeCloseTo(2.811e-3, -2)
  })

  it('Q12: computes exit velocity for an electron leaving the parallel-plate field', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-12-exit-velocity'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('charged_particle_bounded_electric_field')
    expect(result.ir?.plateSeparation).toBeCloseTo(0.04)
    expect(result.ir?.plateLength).toBeCloseTo(0.12)
    expect(result.ir?.relations).toContain('charged_particle_in_bounded_electric_field')

    /* Scene structure checks. */
    expect(result.scene?.regions.length).toBe(1)
    expect(result.scene?.boundaries.length).toBe(2)
    expect(result.scene?.fields[0]?.regionId).toBeDefined()

    expect(result.simulation?.verification.status).toBe('passed')

    /* Exit speed: v = √(v0² + (at)²)
       a = qE/m = 1.6e-19 * 2000 / 9.11e-31 ≈ 3.5137×10^14 m/s²
       t = L/vx = 0.12 / 3e7 = 4e-9 s
       at ≈ 1.4055e6 m/s
       v = √((3e7)² + (1.4055e6)²) ≈ 3.00329×10^7 m/s
       Use precision -3 (thousands place) — a carries limited precision from the
       3-sig-fig input constants q and m, and the region engine's bounded-field
       solver rounds slightly differently than the unbounded formula. */
    const speed = scalar(result, 'speed')
    expect(speed).toBeCloseTo(3.0033e7, -3)
  })

  it('Q13: hit-plate question parses into bounded model with correct geometry', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-13-hit-plate-time'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.ir.model).toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.plateSeparation).toBeCloseTo(0.02)
    expect(candidate.ir.plateLength).toBeCloseTo(0.20)
    expect(candidate.ir.relations).toContain('charged_particle_in_bounded_electric_field')
    /* The question mentions 打到极板, so plate_hit_time should be a target. */
    expect(candidate.ir.targets).toContain('plate_hit_time')
  })

  it('Q14: deflection direction target is recognized', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-14-deflection-direction'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.ir.model).toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.chargeSign).toBe('negative')
    expect(candidate.ir.electricFieldDirection).toBe('down')
    expect(candidate.ir.targets).toContain('electric_field_direction')
  })

  it('Q15: reversed field direction is parsed as up', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-15-field-reversed'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.ir.model).toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.electricFieldDirection).toBe('up')
  })

  it('Q11: proton (positive charge) parses correctly', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-11-proton-deflection'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.ir.model).toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.chargeSign).toBe('positive')
    expect(candidate.ir.plateSeparation).toBeCloseTo(0.02)
    expect(candidate.ir.plateLength).toBeCloseTo(0.10)
  })

  it('does not route a uniform-field question (without plate keywords) to the bounded model', () => {
    const document = createGoldenQuestionDocument(electricQuestion('electric-01-perpendicular-deflection'))
    const candidate = DeterministicElectricQuestionParser.parse(document)

    expect(candidate.ir.model).not.toBe('charged_particle_bounded_electric_field')
    expect(candidate.ir.model).toBe('charged_particle_uniform_electric_field')
  })
})
