/**
 * The normalization every parser reads through.
 *
 * Before this module each of the ten parsers saw the raw stem. Drafted papers
 * write physics in LaTeX, so the same question that parsed correctly in a
 * hand-written test lost its incline angle and friction coefficient on the real
 * paper — the patterns were written against plain text and the LaTeX form never
 * matched them.
 */

import { describe, expect, it } from 'vitest'
import { normalizeStemText, splitStemIntent } from '../src/latex-text.ts'

describe('normalizeStemText', () => {
  it('unwraps units written as \\mathrm', () => {
    expect(normalizeStemText(String.raw`$m = 2.0\ \mathrm{kg}$`)).toBe('m = 2.0 kg')
    expect(normalizeStemText(String.raw`$v_0 = 6\ \mathrm{m/s}$`)).toBe('v_0 = 6 m/s')
  })

  it('keeps a unit exponent, which the unit patterns read', () => {
    /* m/s^2 must survive: the gravity pattern matches "10 m/s²" and the
       acceleration pattern matches "m/s^2". Flattening the exponent would make
       a speed and an acceleration indistinguishable. */
    expect(normalizeStemText(String.raw`$g = 10\ \mathrm{m/s^2}$`)).toBe('g = 10 m/s^2')
  })

  it('turns \\circ into a degree sign', () => {
    expect(normalizeStemText(String.raw`$\theta = 37^\circ$`)).toBe('θ = 37°')
    expect(normalizeStemText(String.raw`$\theta = 37^{\circ}$`)).toBe('θ = 37°')
  })

  it('reduces subscript braces to the underscore form', () => {
    expect(normalizeStemText('$m_{1} = 2\\ \\mathrm{kg}$')).toBe('m_1 = 2 kg')
    expect(normalizeStemText('$v_{0}$')).toBe('v_0')
  })

  it('expands a fraction', () => {
    expect(normalizeStemText(String.raw`$\dfrac{1}{2}mv^2$`)).toBe('(1)/(2)mv^2')
  })

  it('leaves plain text untouched', () => {
    const plain = '质量 m = 2.0 kg 的物块从倾角 θ = 37° 的斜面下滑'
    expect(normalizeStemText(plain)).toBe(plain)
  })

  it('never invents a value', () => {
    /* The module rewrites syntax only: a stem with no number keeps none. */
    expect(normalizeStemText(String.raw`$\theta$ 的斜面`)).toBe('θ 的斜面')
  })
})

describe('splitStemIntent', () => {
  it('separates the givens from the ask', () => {
    const { setup, ask } = splitStemIntent('加速度大小为 2 m/s²，求 3 s 末的速度')
    expect(setup).toContain('加速度大小为')
    expect(ask).toContain('求')
    expect(ask).toContain('速度')
  })

  it('returns the whole text when nothing asks', () => {
    const text = '一物块沿斜面下滑'
    expect(splitStemIntent(text)).toMatchObject({ setup: text, ask: text })
  })
})
