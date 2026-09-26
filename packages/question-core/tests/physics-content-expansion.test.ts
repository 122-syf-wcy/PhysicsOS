import { describe, expect, it } from 'vitest'

import {
  detectMechanicalWaveModel,
  isModernPhysicsQuestionText,
  MODERN_GOLDEN_QUESTIONS,
  createGoldenQuestionDocument,
  processQuestion,
  type QuestionDocument,
} from '../src/index.ts'

const documentOf = (id: string, text: string): QuestionDocument =>
  ({
    id,
    content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
    metadata: { createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' },
  }) as unknown as QuestionDocument

describe('cyclotron question pipeline', () => {
  const text =
    '回旋加速器的匀强磁场方向垂直纸面向外，B = 1.5 T，加速电压 U = 2000 V，D形盒半径 R = 0.5 m。质子 q = 1.6×10^-19 C，m = 1.67×10^-27 kg，以 v = 1.0×10^5 m/s 开始加速。求：回旋周期、末速度和最大动能。'

  it('parses the cyclotron geometry into a supported model', () => {
    const result = processQuestion(documentOf('cyclotron-supported', text))
    expect(result.ir?.model).toBe('cyclotron')
    expect(result.ir?.gapVoltage).toBeCloseTo(2000, 9)
    expect(result.ir?.deeRadius).toBeCloseTo(0.5, 12)
    expect(result.validation?.status).toBe('VALID')
  })

  it('runs the time-varying-field cyclotron and solves from engine facts', () => {
    const result = processQuestion(documentOf('cyclotron-supported', text))
    expect(result.workflowState).toBe('READY')
    expect(result.scene?.cyclotronBenches).toHaveLength(1)
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.solution?.results['period']?.value).toBeDefined()
    expect(result.solution?.results['final_velocity']?.value).toBeDefined()
    expect(result.solution?.results['max_kinetic_energy']?.value).toBeDefined()
  })
})

describe('expanded mechanical-wave question pipeline', () => {
  it('routes and solves a longitudinal wave', () => {
    const result = processQuestion(
      documentOf(
        'longitudinal-wave',
        '一列纵波沿弹性介质传播，振幅 A = 2 cm，波长 λ = 0.5 m，频率 f = 4 Hz。求波速。',
      ),
    )
    expect(
      detectMechanicalWaveModel(
        result.document.content.extractedText ?? result.document.content.rawText ?? '',
      ),
    ).toBe('longitudinal_wave')
    expect(result.workflowState).toBe('READY')
    expect(result.solution?.results['wave_speed']?.value).toBe('2.0000')
  })

  it('routes and solves reflection/refraction', () => {
    const result = processQuestion(
      documentOf(
        'wave-boundary',
        '水波在介质1中的波速 v1 = 4 m/s，进入介质2后的波速 v2 = 2 m/s，入射角 θ1 = 30°，频率 f = 2 Hz。求反射角和折射角。',
      ),
    )
    expect(
      detectMechanicalWaveModel(
        result.document.content.extractedText ?? result.document.content.rawText ?? '',
      ),
    ).toBe('reflection_refraction')
    expect(result.workflowState).toBe('READY')
    expect(result.solution?.results['reflection_angle']?.value).toBe('30.0000')
    expect(Number(result.solution?.results['refracted_angle']?.value)).toBeCloseTo(14.4775, 3)
  })

  it('routes and solves single-slit diffraction', () => {
    const result = processQuestion(
      documentOf(
        'wave-diffraction',
        '水波通过宽 a = 1 m 的单缝发生衍射，波长 λ = 0.5 m，频率 f = 2 Hz，缝到屏距离 L = 2 m。求中央明纹宽度和第一暗纹的衍射角。',
      ),
    )
    expect(
      detectMechanicalWaveModel(
        result.document.content.extractedText ?? result.document.content.rawText ?? '',
      ),
    ).toBe('wave_diffraction')
    expect(result.workflowState).toBe('READY')
    expect(result.solution?.results['central_maximum_width']?.value).toBe('2.0000')
  })

  it('routes and solves the Doppler effect', () => {
    const result = processQuestion(
      documentOf(
        'wave-doppler',
        '一列机械波在介质中的波速 v = 340 m/s，波源频率 f = 500 Hz，波源以 vs = 34 m/s 接近静止的观察者。求观察者接收到的频率。',
      ),
    )
    expect(
      detectMechanicalWaveModel(
        result.document.content.extractedText ?? result.document.content.rawText ?? '',
      ),
    ).toBe('wave_doppler')
    expect(result.workflowState).toBe('READY')
    expect(Number(result.solution?.results['observed_frequency']?.value)).toBeCloseTo(555.5556, 3)
  })
})

describe('modern-physics question pipeline', () => {
  const text =
    '某金属的逸出功 W = 2.0 eV，用波长 λ = 400 nm 的单色光照射，光强 I = 10 W/m^2，阴极面积 S = 1 cm^2。求光子能量、最大初动能、遏止电压和光电流。'

  it('recognizes photoelectric text and rejects an unimplemented atomic-level model', () => {
    expect(isModernPhysicsQuestionText(text)).toBe(true)
    const unsupported = processQuestion(
      documentOf('atomic-levels', '处于 n = 2 能级的氢原子向低能级跃迁，求辐射光子能量。'),
    )
    expect(unsupported.workflowState).toBe('UNSUPPORTED_MODEL')
  })

  it('runs the photoelectric scene through engine, verification and observation', () => {
    const result = processQuestion(documentOf('photoelectric', text))
    expect(result.ir?.domain).toBe('modern_physics')
    expect(result.ir?.model).toBe('photoelectric_effect')
    expect(result.ir?.workFunction).toBeCloseTo(2 * 1.602176634e-19, 30)
    expect(result.ir?.photonWavelength).toBeCloseTo(400e-9, 20)
    expect(result.workflowState).toBe('READY')
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.observations?.observations.length).toBeGreaterThanOrEqual(3)
    expect(result.solution?.results['photon_energy']).toBeDefined()
    expect(result.solution?.results['max_kinetic_energy']).toBeDefined()
    expect(result.solution?.results['stopping_potential']).toBeDefined()
    expect(result.solution?.results['photocurrent']).toBeDefined()
  })

  it('keeps every modern fixture aligned with the expected workflow state', () => {
    for (const fixture of MODERN_GOLDEN_QUESTIONS) {
      const result = processQuestion(createGoldenQuestionDocument(fixture, '2026-09-26T00:00:00.000Z'))
      expect(result.workflowState, fixture.id).toBe(
        fixture.expectedValidation === 'UNSUPPORTED_MODEL' ? 'UNSUPPORTED_MODEL' : 'READY',
      )
    }
  })
})
