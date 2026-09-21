// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MathText } from '../src/client/physics/MathText.tsx'
import { toTexExpression } from '../src/client/physics/math-symbol.ts'

describe('toTexExpression', () => {
  it('leaves TeX input untouched', () => {
    expect(toTexExpression('v = \\frac{m_1 v_1 + m_2 v_2}{m_1 + m_2}')).toBe(
      'v = \\frac{m_1 v_1 + m_2 v_2}{m_1 + m_2}',
    )
    expect(toTexExpression('mg\\sin\\theta')).toBe('mg\\sin\\theta')
  })

  it('normalises the engine Unicode dialect', () => {
    expect(toTexExpression('K = ½mv²')).toBe('K = \\tfrac{1}{2}mv^{2}')
    expect(toTexExpression('P = Σpᵢ')).toBe('P = \\Sigma p_{i}')
    expect(toTexExpression('K = Σ½mᵢvᵢ²')).toBe('K = \\Sigma\\tfrac{1}{2}m_{i}v_{i}^{2}')
    expect(toTexExpression('R_滑 = p·R_全')).toBe('R_\\text{滑} = p\\cdot R_\\text{全}')
    expect(toTexExpression('U = E − I·r')).toBe('U = E - I\\cdot r')
    expect(toTexExpression('t₁ = d/v')).toBe('t_{1} = d/v')
  })

  it('braces the radicand behind √', () => {
    expect(toTexExpression('v = √(2gh)')).toBe('v = \\sqrt{2gh}')
    expect(toTexExpression('√3')).toBe('\\sqrt{3}')
  })

  it('maps operators, relations and full-width punctuation', () => {
    expect(toTexExpression('F_B = qv×B')).toBe('F_B = qv\\times B')
    expect(toTexExpression('θ = 30°')).toBe('\\theta = 30^{\\circ}')
    expect(toTexExpression('t_hit（场景时钟）')).toBe('t_hit(\\text{场景时钟})')
    expect(toTexExpression('a ≈ b → c ± d ∞')).toBe('a \\approx b \\to c \\pm d \\infty')
  })

  it('uprights long prose words inside formulas', () => {
    expect(toTexExpression('E = constant')).toBe('E = \\mathrm{constant}')
    /* Short variable runs stay italic math. */
    expect(toTexExpression('p = mv')).toBe('p = mv')
  })
})

describe('MathText', () => {
  it('typesets a TeX fraction through KaTeX', () => {
    const { container } = render(<MathText expression={'v = \\frac{s}{t}'} />)
    /* KaTeX marks the fraction with .mfrac; the old custom renderer used .frac. */
    expect(container.querySelector('.katex .mfrac')).not.toBeNull()
    expect(container.querySelector('.katex-mathml math')).not.toBeNull()
  })

  it('typesets the Unicode engine dialect identically', () => {
    const { container } = render(<MathText expression="K = ½mv²" />)
    /* .katex-html is the visual arm; .katex-mathml serves assistive tech. */
    expect(container.querySelector('.katex .katex-html')).not.toBeNull()
    expect(container.querySelector('.katex .vlist')).not.toBeNull()
  })

  it('survives unparsable input with an error span, not a throw', () => {
    const { container } = render(<MathText expression="\\frac{" />)
    expect(container.textContent?.length).toBeGreaterThan(0)
  })
})
