import { describe, it, expect } from 'vitest'
import {
  createGoldenQuestionDocument,
  processQuestion,
  DeterministicMagneticQuestionParser,
  GOLDEN_QUESTIONS,
  type QuestionDocument,
} from '../src/index.ts'

describe('Golden Questions', () => {
  for (const def of GOLDEN_QUESTIONS) {
    describe(def.id + ': ' + def.title, () => {
      const doc = createGoldenQuestionDocument(def)
      const result = processQuestion(doc)

      it('should have expected validation status', () => {
        if (def.expectedValidation === 'VALID') {
          expect(result.validation?.status).toBe('VALID')
        } else if (def.expectedValidation === 'AMBIGUOUS') {
          expect(result.workflowState).toBe('AMBIGUOUS')
        } else if (def.expectedValidation === 'INVALID_SEMANTICS') {
          expect(result.workflowState).toBe('INVALID_SEMANTICS')
        } else if (def.expectedValidation === 'UNSUPPORTED_MODEL') {
          expect(result.workflowState).toBe('UNSUPPORTED_MODEL')
        }
      })

      it('should detect expected charge sign', () => {
        if (result.ir) {
          expect(result.ir.chargeSign).toBe(def.expectedChargeSign)
        }
      })

      it('should detect expected field direction', () => {
        if (result.ir) {
          expect(result.ir.fieldDirection).toBe(def.expectedFieldDirection)
        }
      })
    })
  }
})

describe('01-proton-basic full pipeline', () => {
  const def = GOLDEN_QUESTIONS[0]
  if (!def) throw new Error('Golden question not found')
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should produce semantic IR', () => {
    expect(result.ir).not.toBeNull()
    expect(result.ir!.domain).toBe('magnetic')
    expect(result.ir!.model).toBe('charged_particle_uniform_magnetic_field')
  })

  it('should extract correct knowns', () => {
    const knowns = result.ir!.knowns
    const charge = knowns.find((k) => k.key === 'charge')
    const mass = knowns.find((k) => k.key === 'mass')
    const velocity = knowns.find((k) => k.key === 'velocity')
    const bField = knowns.find((k) => k.key === 'magnetic_field_strength')

    expect(charge).toBeDefined()
    expect(charge!.value).toBeCloseTo(1.6e-19, 10)
    expect(mass).toBeDefined()
    expect(mass!.value).toBeCloseTo(1.67e-27, 10)
    expect(velocity).toBeDefined()
    expect(velocity!.value).toBeCloseTo(2e6, 1)
    expect(bField).toBeDefined()
    expect(bField!.value).toBeCloseTo(0.5, 1)
  })

  it('should detect into_page direction', () => {
    expect(result.ir!.fieldDirection).toBe('into_page')
  })

  it('should build PhysicsScene', () => {
    expect(result.scene).not.toBeNull()
    expect(result.scene!.particles.length).toBe(1)
    expect(result.scene!.fields.length).toBe(1)
    expect(result.scene!.fields[0]!.type).toBe('uniform_magnetic')
  })

  it('should run simulation and produce derived quantities', () => {
    expect(result.simulation).not.toBeNull()
    const dq = result.simulation!.derivedQuantities
    const radius = dq.find((d) => d.key === 'cyclotron_radius')
    const period = dq.find((d) => d.key === 'cyclotron_period')
    const force = dq.find((d) => d.key === 'lorentz_force_magnitude')

    expect(radius).toBeDefined()
    const rValue = (radius!.value as { value: number }).value
    expect(rValue).toBeCloseTo(0.0418, 1)

    expect(period).toBeDefined()
    const tValue = (period!.value as { value: number }).value
    expect(tValue).toBeCloseTo(1.31e-7, 1)

    expect(force).toBeDefined()
    const fValue = (force!.value as { value: number }).value
    expect(fValue).toBeCloseTo(1.6e-13, 1)
  })

  it('should pass verification', () => {
    expect(result.simulation!.verification.status).not.toBe('failed')
  })

  it('should produce solution', () => {
    expect(result.solution).not.toBeNull()
    expect(result.solution!.results['force']).toBeDefined()
    expect(result.solution!.results['radius']).toBeDefined()
    expect(result.solution!.results['period']).toBeDefined()
  })

  it('should produce observations', () => {
    expect(result.observations).not.toBeNull()
    expect(result.observations!.observations.length).toBeGreaterThan(0)
  })

  it('workflow state should be READY', () => {
    expect(result.workflowState).toBe('READY')
  })
})

describe('Question to Lab scene consistency', () => {
  const def = GOLDEN_QUESTIONS[0]
  if (!def) throw new Error('Golden question not found')
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should have same scene ID for question and lab', () => {
    expect(result.scene).not.toBeNull()
    const scene = result.scene!
    const sim = result.simulation!
    expect(sim.sceneId).toBe(scene.id)
    expect(sim.sceneRevision).toBe(scene.revision)
  })

  it('should have consistent physics facts', () => {
    const sim = result.simulation!
    const dq = sim.derivedQuantities
    const radius = (dq.find((d) => d.key === 'cyclotron_radius')!.value as { value: number }).value
    const period = (dq.find((d) => d.key === 'cyclotron_period')!.value as { value: number }).value
    const force = (dq.find((d) => d.key === 'lorentz_force_magnitude')!.value as { value: number }).value

    expect(radius).toBeCloseTo(0.0418, 1)
    expect(period).toBeCloseTo(1.31e-7, 1)
    expect(force).toBeCloseTo(1.6e-13, 1)
  })
})

describe('Ambiguity test: missing charge sign', () => {
  const def = GOLDEN_QUESTIONS.find((q) => q.id === '06-missing-charge-sign')
  if (!def) throw new Error('Golden question not found')
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should return AMBIGUOUS', () => {
    expect(result.workflowState).toBe('AMBIGUOUS')
  })

  it('should have ambiguity about charge sign', () => {
    expect(result.validation).not.toBeNull()
    expect(result.validation!.ambiguities.length).toBeGreaterThan(0)
    const chargeAmbiguity = result.validation!.ambiguities.find((a) => a.field === 'chargeSign')
    expect(chargeAmbiguity).toBeDefined()
    expect(chargeAmbiguity!.message).toContain('电荷正负')
  })
})

describe('Unsupported model: parallel velocity', () => {
  const def = GOLDEN_QUESTIONS.find((q) => q.id === '08-parallel-velocity')
  if (!def) throw new Error('Golden question not found')
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should return UNSUPPORTED_MODEL', () => {
    expect(result.workflowState).toBe('UNSUPPORTED_MODEL')
  })
})

describe('Zero field: invalid semantics', () => {
  const def = GOLDEN_QUESTIONS.find((q) => q.id === '07-zero-field')
  if (!def) throw new Error('Golden question not found')
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should return INVALID_SEMANTICS', () => {
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
  })
})

describe('Deterministic parser', () => {
  it('should parse scientific notation 2.0×10^6', () => {
    const def = GOLDEN_QUESTIONS[0]
    if (!def) throw new Error('Golden question not found')
    const doc = createGoldenQuestionDocument(def)
    const candidate = DeterministicMagneticQuestionParser.parse(doc)
    const velocity = candidate.ir.knowns.find((k) => k.key === 'velocity')
    expect(velocity).toBeDefined()
    expect(velocity!.value).toBeCloseTo(2e6, 1)
  })

  it('should parse 2.0e6 notation', () => {
    const def = GOLDEN_QUESTIONS.find((q) => q.id === '10-scientific-notation')
    if (!def) throw new Error('Golden question not found')
    const doc = createGoldenQuestionDocument(def)
    const candidate = DeterministicMagneticQuestionParser.parse(doc)
    const velocity = candidate.ir.knowns.find((k) => k.key === 'velocity')
    expect(velocity).toBeDefined()
    expect(velocity!.value).toBeCloseTo(2e6, 1)
  })

  it('should detect proton as positive', () => {
    const def = GOLDEN_QUESTIONS[0]
    if (!def) throw new Error('Golden question not found')
    const doc = createGoldenQuestionDocument(def)
    const candidate = DeterministicMagneticQuestionParser.parse(doc)
    expect(candidate.ir.chargeSign).toBe('positive')
  })

  it('should detect electron as negative', () => {
    const def = GOLDEN_QUESTIONS.find((q) => q.id === '02-electron-negative-charge')
    if (!def) throw new Error('Golden question not found')
    const doc = createGoldenQuestionDocument(def)
    const candidate = DeterministicMagneticQuestionParser.parse(doc)
    expect(candidate.ir.chargeSign).toBe('negative')
  })
})

describe('Unmatched question text', () => {
  const runtimeDoc = (text: string): QuestionDocument => ({
    id: 'q-unmatched' as QuestionDocument['id'],
    content: { source: 'text', rawText: text, status: 'EXTRACTED' },
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  it('returns PARSE_FAILED instead of a magnetic IR for optics text', () => {
    const result = processQuestion(runtimeDoc('凸透镜的焦距是 20 cm，物距 30 cm，求像距。'))
    expect(result.workflowState).toBe('PARSE_FAILED')
    expect(result.ir).toBeNull()
  })

  it('returns PARSE_FAILED instead of a magnetic IR for thermodynamics text', () => {
    const result = processQuestion(runtimeDoc('一定质量理想气体从状态 A 到状态 B，温度从 300 K 升到 400 K，求内能变化。'))
    expect(result.workflowState).toBe('PARSE_FAILED')
    expect(result.ir).toBeNull()
  })

  it('returns PARSE_FAILED for unrecognised text', () => {
    const result = processQuestion(runtimeDoc('今天天气不错，讲一个关于光的故事。'))
    expect(result.workflowState).toBe('PARSE_FAILED')
  })
})
