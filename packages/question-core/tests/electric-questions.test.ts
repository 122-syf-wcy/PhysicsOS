import { describe, expect, it } from 'vitest'

import {
  createGoldenQuestionDocument,
  DeterministicElectricQuestionParser,
  GOLDEN_QUESTIONS,
  isElectricQuestionText,
  processQuestion,
} from '../src/index.ts'

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
