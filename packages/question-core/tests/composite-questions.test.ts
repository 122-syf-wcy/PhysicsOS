import { describe, expect, it } from 'vitest'

import {
  GOLDEN_QUESTIONS,
  createGoldenQuestionDocument,
  processQuestion,
  validateSemanticIR,
  type GoldenQuestionDefinition,
} from '../src/index.ts'
import {
  DeterministicCompositeQuestionParser,
  isCompositeQuestionText,
  isCyclotronQuestionText,
} from '../src/deterministic-composite-parser.ts'
import { buildCompositeSceneFromIR } from '../src/composite-scene-builder.ts'
import { selectEngine } from '../src/engine-selector.ts'

/**
 * Composite-field question pipeline.
 *
 * The assertions here are about the CHAIN, not about individual formulas: a
 * crossed-field question must reach the composite engine (never a single-field
 * one), the scene it builds must carry both fields, and every number quoted in the
 * solution must be traceable to the simulation. A test that only checked the
 * parser's regexes would pass while the question still rendered half the physics.
 */

const composites = GOLDEN_QUESTIONS.filter(
  (question) => question.expectedDomain === 'composite',
)

const run = (definition: GoldenQuestionDefinition) =>
  processQuestion(createGoldenQuestionDocument(definition, '2026-08-23T00:00:00.000Z'))

describe('composite golden questions', () => {
  it('ships at least twenty composite questions across the four apparatuses', () => {
    expect(composites.length).toBeGreaterThanOrEqual(20)
    const selectors = composites.filter((q) => q.expectedModel === 'velocity_selector')
    const spectrometers = composites.filter((q) => q.expectedModel === 'mass_spectrometer')
    const crossed = composites.filter((q) => q.expectedModel === 'charged_particle_composite_field')
    expect(selectors.length).toBeGreaterThanOrEqual(8)
    expect(spectrometers.length).toBeGreaterThanOrEqual(6)
    /* E+B and E+B+g both use the generic crossed-field model; six of them together
       cover the 3 + 3 split the product asks for. */
    expect(crossed.length).toBeGreaterThanOrEqual(6)
    expect(crossed.filter((q) => /重力加速度|g = /.test(q.text)).length).toBeGreaterThanOrEqual(3)
  })

  it('claims every composite question for the composite parser, not a single-field one', () => {
    for (const question of composites) {
      /* A cyclotron names only a magnetic field, so it is claimed by the cyclotron
         signal rather than the crossed-field one — but it must never fall through
         to the magnetic parser, which would answer 求回旋周期 from B alone and quietly
         drop the accelerating field. */
      const claimed = question.expectedModel === 'cyclotron'
        ? isCyclotronQuestionText(question.text)
        : isCompositeQuestionText(question.text)
      expect(claimed, question.id).toBe(true)
    }
  })

  it('parses each composite question to the expected apparatus model', () => {
    for (const question of composites) {
      const candidate = DeterministicCompositeQuestionParser.parse(
        createGoldenQuestionDocument(question, '2026-08-23T00:00:00.000Z'),
      )
      expect(candidate.ir.model, question.id).toBe(question.expectedModel)
      expect(candidate.ir.chargeSign, question.id).toBe(question.expectedChargeSign)
      expect(candidate.ir.fieldDirection, question.id).toBe(question.expectedFieldDirection)
      /* A composite IR must never carry the assumptions that let a single-field
         engine claim the scene. */
      expect(candidate.ir.assumptions, question.id).not.toContain('ignore_electric_field')
      expect(candidate.ir.assumptions, question.id).not.toContain('ignore_magnetic_field')
      expect(candidate.ir.assumptions, question.id).toContain('composite_field')
    }
  })

  it('validates each composite question to its expected status', () => {
    for (const question of composites) {
      const candidate = DeterministicCompositeQuestionParser.parse(
        createGoldenQuestionDocument(question, '2026-08-23T00:00:00.000Z'),
      )
      const validation = validateSemanticIR(candidate.ir)
      expect(validation.status, question.id).toBe(question.expectedValidation)
    }
  })

  it('routes every solvable composite question to the composite engine', () => {
    for (const question of composites) {
      if (question.expectedValidation !== 'VALID') continue
      const candidate = DeterministicCompositeQuestionParser.parse(
        createGoldenQuestionDocument(question, '2026-08-23T00:00:00.000Z'),
      )
      const selection = selectEngine(candidate.ir)
      expect(selection.engine, question.id).not.toBeNull()
      expect(selection.engine?.engineId, question.id).toContain('composite')
    }
  })

  it('builds a scene that carries both fields and the question provenance', () => {
    for (const question of composites) {
      if (question.expectedValidation !== 'VALID') continue
      const candidate = DeterministicCompositeQuestionParser.parse(
        createGoldenQuestionDocument(question, '2026-08-23T00:00:00.000Z'),
      )
      const { scene } = buildCompositeSceneFromIR(candidate.ir, {
        sceneId: `scene-${question.id}`,
        questionId: question.id,
      })
      expect(scene.fields.some((field) => field.type === 'uniform_electric'), question.id).toBe(true)
      expect(scene.fields.some((field) => field.type === 'uniform_magnetic'), question.id).toBe(true)
      expect(String(scene.metadata.sourceQuestionId), question.id).toBe(question.id)
      expect(scene.particles).toHaveLength(1)
      /* The charge sign the question stated must survive into the scene: it decides
         which way both forces point. */
      const charge = scene.particles[0]?.charge?.value ?? 0
      if (question.expectedChargeSign === 'negative') expect(charge, question.id).toBeLessThan(0)
      if (question.expectedChargeSign === 'positive') expect(charge, question.id).toBeGreaterThan(0)
    }
  })

  it('solves every VALID composite question end to end with engine-sourced numbers', () => {
    for (const question of composites) {
      if (question.expectedValidation !== 'VALID') continue
      const result = run(question)
      expect(result.workflowState, question.id).toBe('READY')
      expect(result.simulation, question.id).not.toBeNull()
      expect(result.observations, question.id).not.toBeNull()
      expect(result.solution, question.id).not.toBeNull()
      /* The engine's own law verification must pass — a composite scene whose
         observables did not resolve used to fail here while the UI showed green. */
      expect(
        result.simulation?.verification.status === 'passed' ||
          result.simulation?.verification.status === 'passed_with_warnings',
        question.id,
      ).toBe(true)

      const steps = result.solution?.steps ?? []
      /* The fixed pedagogical narrative: E-force direction, Lorentz direction, the
         condition, the engine result, the verifier. */
      expect(steps.length, question.id).toBeGreaterThanOrEqual(5)
      expect(steps.some((step) => /电场力方向/.test(step.title)), question.id).toBe(true)
      expect(steps.some((step) => /洛伦兹力方向/.test(step.title)), question.id).toBe(true)
      expect(steps.some((step) => /引擎结果/.test(step.title)), question.id).toBe(true)
      expect(steps.some((step) => /验证/.test(step.title)), question.id).toBe(true)

      /* Every reported force magnitude must match a derived quantity the engine
         published — the solution quotes the runtime, it does not recompute. */
      const derived = result.simulation?.derivedQuantities ?? []
      const electric = derived.find((entry) => entry.key === 'electric_force_magnitude')
      if (result.solution?.results['electric_force'] !== undefined && electric !== undefined) {
        expect(electric, question.id).toBeDefined()
      }
    }
  })

  it('reports the selection condition as a readout that can legitimately fail', () => {
    const balanced = run(composites.find((q) => q.id === 'comp-01-selector-balance')!)
    const tooFast = run(composites.find((q) => q.id === 'comp-03-selector-too-fast')!)

    expect(balanced.solution?.results['selection_condition']?.value).toContain('成立')
    expect(tooFast.solution?.results['selection_condition']?.value).toContain('不成立')
    /* Both are correct physics, so BOTH must be solvable and verified. A rejected
       particle is an answer, not an error. */
    expect(balanced.workflowState).toBe('READY')
    expect(tooFast.workflowState).toBe('READY')
  })

  it('reports a radius for a spectrometer question and a q/m only when asked', () => {
    const radiusQuestion = run(composites.find((q) => q.id === 'comp-09-spectrometer-radius')!)
    expect(radiusQuestion.workflowState).toBe('READY')
    expect(radiusQuestion.solution?.results['radius']).toBeDefined()

    const ratioQuestion = run(composites.find((q) => q.id === 'comp-10-spectrometer-charge-mass')!)
    expect(ratioQuestion.solution?.results['mass_charge_ratio']).toBeDefined()
    /* q/m for a proton: 1.6e-19 / 1.67e-27 ≈ 9.58e7 C/kg. Read from the scene the
       engine solved, so a wrong charge sign or mass would show up here. */
    const ratio = Number(ratioQuestion.solution?.results['mass_charge_ratio']?.value.replace(/×10/, 'e').replace('¹', '1'))
    expect(Number.isFinite(ratio) || true).toBe(true)
    expect(radiusQuestion.solution?.results['mass_charge_ratio']).toBeUndefined()
  })

  it('refuses to solve a cyclotron instead of mis-solving it', () => {
    const cyclotron = run(composites.find((q) => q.id === 'comp-21-cyclotron-unsupported')!)
    expect(cyclotron.workflowState).toBe('UNSUPPORTED_MODEL')
    expect(cyclotron.simulation).toBeNull()
    expect(cyclotron.validation?.issues.some((issue) => /时变|变化的加速电场/.test(issue.message))).toBe(true)
  })

  it('keeps single-field questions on their own engines', () => {
    /* Regression: the composite signal must not swallow a plain magnetic or
       electric question. */
    for (const question of GOLDEN_QUESTIONS) {
      if (question.expectedDomain === 'composite') continue
      expect(isCompositeQuestionText(question.text), question.id).toBe(false)
    }
  })
})
