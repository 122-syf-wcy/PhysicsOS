/**
 * The five mechanics apparatus the engine already solves end to end —
 * spring oscillator, spring statics, simple pendulum, horizontal friction and
 * circular orbit. The parser could not name any of them, so each of these
 * question shapes either fell through to the generic uniformly-accelerated
 * model (a confidently wrong number) or was rejected outright.
 */

import { describe, expect, it } from 'vitest'
import { DeterministicMechanicsQuestionParser } from '../src/deterministic-mechanics-parser.ts'
import { validateSemanticIR } from '../src/semantic-validator.ts'
import type { QuestionDocument } from '../src/question-document.ts'

const document = (text: string): QuestionDocument => ({
  id: 'apparatus',
  content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
  metadata: { title: 'apparatus', tags: [], difficulty: 'standard' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as QuestionDocument)

const parse = (text: string) => DeterministicMechanicsQuestionParser.parse(document(text)).ir!

describe('mechanics apparatus detection', () => {
  it('names a spring oscillator rather than falling back to kinematics', () => {
    const ir = parse('劲度系数 k = 200 N/m，质量 m = 0.50 kg 的物块连在水平弹簧上做简谐运动，求振动周期。'
      + '已知：k = 200 N/m，m = 0.50 kg。')
    expect(ir.model).toBe('spring_oscillator')
    expect(ir.springStiffness).toBe(200)
    expect(ir.targets).toContain('period')
    expect(validateSemanticIR(ir).status).toBe('VALID')
  })

  it('names a vertical spring rig as statics', () => {
    const ir = parse('劲度系数 k = 100 N/m 的弹簧竖直悬挂质量 m = 0.20 kg 的物体静止，求弹簧的伸长量。'
      + '已知：k = 100 N/m，m = 0.20 kg，g = 10 m/s²。')
    expect(ir.model).toBe('spring_statics')
    expect(ir.targets).toContain('spring_extension')
  })

  it('names a pendulum and reads its length', () => {
    const ir = parse('摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。'
      + '已知：L = 1.0 m，g = 10 m/s²。')
    expect(ir.model).toBe('simple_pendulum')
    expect(ir.pendulumLength).toBe(1)
    expect(ir.targets).toContain('period')
  })

  it('names a rough horizontal surface as its own model', () => {
    const ir = parse('粗糙水平面上质量 m = 2.0 kg 的物块，动摩擦因数 μ = 0.20，求物块的加速度。'
      + '已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。')
    expect(ir.model).toBe('horizontal_friction')
    expect(ir.targets).toContain('acceleration')
  })

  it('reads an orbit radius written in scientific notation', () => {
    const ir = parse('一颗人造卫星绕地球做匀速圆周运动，轨道半径 r = 6.8×10^6 m，求卫星的线速度。'
      + '已知：r = 6.8×10^6 m。')
    expect(ir.model).toBe('circular_orbit')
    expect(ir.orbitRadius).toBeCloseTo(6.8e6, -3)
    expect(ir.gravitationalParameter).toBeCloseTo(3.986e14, -10)
    /* GM plus one radius fixes the orbit, so the two-knowns rule does not apply. */
    expect(validateSemanticIR(ir).status).toBe('VALID')
  })
})

describe('gravity is not an initial velocity', () => {
  it('keeps g out of the velocity knowns', () => {
    /* "g = 10 m/s²" carries the same "10 m/s" substring a real speed does; the
       bare unit pattern used to record it as v₀ and every mechanics question
       arrived with a phantom initial velocity. */
    const ir = parse('粗糙水平面上质量 m = 2.0 kg 的物块，动摩擦因数 μ = 0.20，求物块的加速度。'
      + '已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。')
    expect(ir.knowns.some(k => k.key === 'initial_velocity')).toBe(false)
    expect(ir.knowns.find(k => k.key === 'gravity')?.value).toBe(10)
  })
})

describe('target detection follows the asking clause', () => {
  it('asks for the speed a stem asks for, not the acceleration it states', () => {
    /* 加速度 appears in the givens; the question asks for 速度. A bare keyword
       scan recorded both and the engine answered the wrong one. */
    const ir = parse('一倾角 37° 的斜面，质量 2.0 kg 的物块由静止下滑，动摩擦因数 0.25。'
      + '已知：m = 2.0 kg，θ = 37°，μ = 0.25，g = 10 m/s²。则物块下滑 4.0 m 时的速度大小为（ ）')
    expect(ir.targets).toContain('velocity')
    expect(ir.targets).not.toContain('acceleration')
  })

  it('does not read 加速度 as a request for speed', () => {
    /* 加速度 contains the characters 速度; without the lookbehind the engine
       answered a speed question the stem never posed. */
    const ir = parse('粗糙水平面上质量 2.0 kg 的物块，动摩擦因数 0.20，求物块的加速度。'
      + '已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。')
    expect(ir.targets).toContain('acceleration')
    expect(ir.targets).not.toContain('velocity')
  })
})
