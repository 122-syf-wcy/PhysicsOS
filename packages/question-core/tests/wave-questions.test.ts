import { describe, expect, it } from 'vitest'

import { isWaveScene, waveBenchOf } from '@physicsos/physics-scene'

import {
  createGoldenQuestionDocument,
  DeterministicWaveQuestionParser,
  GOLDEN_QUESTIONS,
  isWaveQuestionText,
  processQuestion,
  type QuestionDocument,
} from '../src/index.ts'

const waveQuestion = (id: string) => {
  const definition = GOLDEN_QUESTIONS.find((candidate) => candidate.id === id)
  if (definition === undefined) throw new Error(`Missing wave golden question ${id}`)
  return definition
}

const documentOf = (id: string, text: string): QuestionDocument =>
  ({
    id,
    content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
    metadata: { domain: 'wave', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
  }) as unknown as QuestionDocument

describe('DeterministicWaveQuestionParser', () => {
  it('recognizes mechanical-wave text and rejects optics, sound, magnetic and mechanics text', () => {
    expect(isWaveQuestionText(waveQuestion('wave-01-speed-from-wavelength-frequency').text)).toBe(true)
    expect(isWaveQuestionText(waveQuestion('wave-03-interference-constructive').text)).toBe(true)
    expect(isWaveQuestionText(waveQuestion('wave-05-standing-third-harmonic').text)).toBe(true)
    /* Optics interference is light, not a rope. */
    expect(isWaveQuestionText('双缝干涉实验中光的波长为 600 nm，求条纹间距。')).toBe(false)
    /* The echo rig is the acoustics bench. */
    expect(isWaveQuestionText('声速 340 m/s，2 s 后听到回声，求峭壁距离。')).toBe(false)
    for (const id of ['01-proton-basic', 'circ-01-series-current', 'mech-02-projectile-horizontal', 'ind-01-bar-motion-emf', 'opt-02-convex-lens-beyond-2f']) {
      expect(isWaveQuestionText(waveQuestion(id).text), id).toBe(false)
    }
  })

  it('extracts A, λ, f and the v / T targets from a rope question', () => {
    const candidate = DeterministicWaveQuestionParser.parse(
      createGoldenQuestionDocument(waveQuestion('wave-01-speed-from-wavelength-frequency')),
    )
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.9)
    expect(candidate.ir.domain).toBe('wave')
    expect(candidate.ir.model).toBe('travelling_wave')
    expect(candidate.ir.knowns.find((k) => k.key === 'wave_amplitude')?.value).toBeCloseTo(0.05, 12)
    expect(candidate.ir.knowns.find((k) => k.key === 'wavelength')?.value).toBeCloseTo(0.4, 12)
    expect(candidate.ir.knowns.find((k) => k.key === 'wave_frequency')?.value).toBeCloseTo(5, 12)
    expect(candidate.ir.targets).toEqual(['wave_speed', 'wave_period'])
    expect(candidate.ir.relations).toContain('wave_speed_relation')
    expect(candidate.ir.waveWavelength).toBeCloseTo(0.4, 12)
    expect(candidate.ir.waveFrequency).toBeCloseTo(5, 12)
  })

  it('records a stated wave speed instead of a wavelength and asks for λ', () => {
    const candidate = DeterministicWaveQuestionParser.parse(
      createGoldenQuestionDocument(waveQuestion('wave-02-wavelength-from-speed')),
    )
    expect(candidate.ir.model).toBe('travelling_wave')
    expect(candidate.ir.waveSpeed).toBeCloseTo(2, 12)
    expect(candidate.ir.waveFrequency).toBeCloseTo(10, 12)
    expect(candidate.ir.waveWavelength).toBeUndefined()
    expect(candidate.ir.targets).toEqual(['wavelength'])
  })

  it('extracts both path lengths, the separation and the verdict targets from an interference question', () => {
    const candidate = DeterministicWaveQuestionParser.parse(
      createGoldenQuestionDocument(waveQuestion('wave-03-interference-constructive')),
    )
    expect(candidate.ir.model).toBe('wave_interference')
    expect(candidate.ir.waveSourceSeparation).toBeCloseTo(0.8, 12)
    expect(candidate.ir.wavePathOne).toBeCloseTo(1.0, 12)
    expect(candidate.ir.wavePathTwo).toBeCloseTo(1.4, 12)
    expect(candidate.ir.waveAmplitude).toBeCloseTo(0.03, 12)
    expect(candidate.ir.targets).toEqual(expect.arrayContaining(['interference_type', 'resultant_amplitude']))
    expect(candidate.ir.assumptions).toContain('coherent_in_phase_sources')
  })

  it('accepts a stated path difference in place of the two path lengths', () => {
    const candidate = DeterministicWaveQuestionParser.parse(
      createGoldenQuestionDocument(waveQuestion('wave-04-interference-destructive')),
    )
    expect(candidate.ir.model).toBe('wave_interference')
    expect(candidate.ir.wavePathDifference).toBeCloseTo(0.3, 12)
    expect(candidate.ir.wavePathOne).toBeUndefined()
    expect(candidate.ir.knowns.find((k) => k.key === 'path_difference')?.value).toBeCloseTo(0.3, 12)
  })

  it('reads the harmonic number in words and the string geometry', () => {
    const candidate = DeterministicWaveQuestionParser.parse(
      createGoldenQuestionDocument(waveQuestion('wave-05-standing-third-harmonic')),
    )
    expect(candidate.ir.model).toBe('standing_wave')
    expect(candidate.ir.waveStringLength).toBeCloseTo(1.0, 12)
    expect(candidate.ir.waveHarmonic).toBe(3)
    expect(candidate.ir.waveSpeed).toBeCloseTo(40, 12)
    expect(candidate.ir.targets).toEqual(['wavelength', 'wave_frequency', 'node_count'])
    expect(candidate.ir.assumptions).toContain('string_clamped_both_ends')
  })
})

describe('Wave Question full pipeline', () => {
  it('solves v = λf and T = 1/f on the rope through Scene, Engine, Verifier and Observation', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-01-speed-from-wavelength-frequency')))
    expect(result.workflowState).toBe('READY')
    expect(result.ir?.domain).toBe('wave')
    expect(result.scene).not.toBeNull()
    expect(isWaveScene(result.scene!)).toBe(true)
    expect(result.scene?.metadata.sourceQuestionId).toBeDefined()
    expect(result.simulation?.verification.status).toBe('passed')
    /* v = 0.4 × 5 = 2 m/s, T = 0.2 s */
    expect(result.solution?.results['wave_speed']?.value).toBe('2.0000')
    expect(result.solution?.results['wave_speed']?.unit).toBe('m/s')
    expect(result.solution?.results['wave_period']?.value).toBe('0.2000')
    const observations = result.observations?.observations ?? []
    expect(observations.some((o) => o.type === 'waveform')).toBe(true)
    expect(observations.some((o) => o.type === 'wave_speed')).toBe(true)
  })

  it('lets the scene contract resolve λ = v/f when the question states the speed', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-02-wavelength-from-speed')))
    expect(result.workflowState).toBe('READY')
    /* λ = 2 / 10 = 0.2 m; the bench stored λ, the engine reports it. */
    expect(waveBenchOf(result.scene!)?.wavelength?.value).toBeCloseTo(0.2, 12)
    expect(result.solution?.results['wavelength']?.value).toBe('0.2000')
    expect(result.solution?.results['wavelength']?.unit).toBe('m')
  })

  it('judges Δ = 2λ constructive with A_P = 2A = 6 cm from the engine verdict', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-03-interference-constructive')))
    expect(result.workflowState).toBe('READY')
    expect(result.solution?.results['interference_type']?.value).toBe('振动加强')
    expect(result.solution?.results['resultant_amplitude']?.value).toBe('6.0000')
    expect(result.solution?.results['resultant_amplitude']?.unit).toBe('cm')
    const observations = result.observations?.observations ?? []
    const superposition = observations.find((o) => o.type === 'wave_superposition')
    expect(superposition).toBeDefined()
  })

  it('judges Δ = 1.5λ destructive with a zero resultant when only Δ is stated', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-04-interference-destructive')))
    expect(result.workflowState).toBe('READY')
    const bench = waveBenchOf(result.scene!)
    /* The builder parks P a separation from S₁ and Δ farther from S₂. */
    expect(bench?.pathOne?.value).toBeCloseTo(0.8, 12)
    expect(bench?.pathTwo?.value).toBeCloseTo(1.1, 12)
    expect(result.solution?.results['interference_type']?.value).toBe('振动减弱')
    expect(result.solution?.results['resultant_amplitude']?.value).toBe('0.0000')
  })

  it('reads λ, f_n and the node count of the third harmonic', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-05-standing-third-harmonic')))
    expect(result.workflowState).toBe('READY')
    /* λ = 2L/n = 2/3 m, f = n·v/2L = 60 Hz, nodes = n + 1 = 4 */
    expect(result.solution?.results['wavelength']?.value).toBe('0.6667')
    expect(result.solution?.results['wave_frequency']?.value).toBe('60.0000')
    expect(result.solution?.results['node_count']?.value).toBe('4')
    const observations = result.observations?.observations ?? []
    expect(observations.some((o) => o.type === 'wave_nodes')).toBe(true)
  })

  it('rejects a rope question without a frequency as INVALID_SEMANTICS', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('wave-06-missing-frequency')))
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues.some((issue) => issue.code === 'MISSING_FREQUENCY')).toBe(true)
  })

  it('still routes kinematics text to mechanics after the wave dispatch (no regression)', () => {
    const result = processQuestion(createGoldenQuestionDocument(waveQuestion('mech-02-projectile-horizontal')))
    expect(result.workflowState).toBe('READY')
    expect(result.ir?.domain).toBe('mechanics')
  })
})

describe('Wave semantic validation', () => {
  it('folds a stated period into the frequency the rig needs', () => {
    const result = processQuestion(
      documentOf('test-period', '一列绳上的横波，波长 λ = 0.4 m，周期 T = 0.2 s，振幅 5 cm。求：波速'),
    )
    expect(result.workflowState).toBe('READY')
    expect(waveBenchOf(result.scene!)?.frequency.value).toBeCloseTo(5, 9)
    expect(result.solution?.results['wave_speed']?.value).toBe('2.0000')
  })

  it('refuses a path difference larger than the source separation', () => {
    const result = processQuestion(
      documentOf(
        'test-unreachable',
        '两个相干波源发出的水波波长 λ = 0.2 m，频率 f = 10 Hz，两波源间距 d = 0.5 m，某点到两波源的路程差 Δ = 0.9 m。判断该点振动是加强还是减弱',
      ),
    )
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues.some((issue) => issue.code === 'UNREACHABLE_PATH_DIFFERENCE')).toBe(true)
  })

  it('requires the string length, the harmonic and a medium on a standing question', () => {
    const result = processQuestion(
      documentOf('test-standing-missing', '一根弦两端固定，形成驻波，弦上波速 v = 40 m/s。求：振动频率'),
    )
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    const codes = (result.validation?.issues ?? []).map((issue) => issue.code)
    expect(codes).toContain('MISSING_STRING_LENGTH')
    expect(codes).toContain('MISSING_HARMONIC')
  })
})
