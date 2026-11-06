import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { CANVAS_TEXT_SHIM } from '../src/question-code-canvas-text.ts'

function patchedContext() {
  const calls: unknown[] = []
  class CanvasRenderingContext2D {
    fillText(text: unknown) { calls.push(text) }
    strokeText(text: unknown) { calls.push(text) }
    measureText(text: unknown) { calls.push(text); return { width: String(text).length } }
  }
  runInNewContext(CANVAS_TEXT_SHIM, { CanvasRenderingContext2D })
  return { ctx: new CanvasRenderingContext2D(), calls }
}

describe('private question canvas text', () => {
  it('draws engine LaTeX symbols as the Unicode a canvas can paint', () => {
    const { ctx, calls } = patchedContext()
    ctx.fillText('\\theta 30°')
    ctx.fillText('$\\theta_0$ = 12^\\circ')
    ctx.strokeText('F_{net}')
    ctx.fillText('v_0 = 3 m/s^2')
    ctx.measureText('\\Delta t \\cdot \\mu mg')
    ctx.fillText('\\vec{F} = \\frac{1}{2}')
    expect(calls).toEqual(['θ 30°', 'θ₀ = 12°', 'Fₙₑₜ', 'v₀ = 3 m/s²', 'Δ t · μ mg', 'F = 1/2'])
  })

  it('leaves ordinary text, unknown commands and non-strings untouched', () => {
    const { ctx, calls } = patchedContext()
    ctx.fillText('重力 mg')
    ctx.fillText('\\unknown x_y')
    ctx.fillText(42)
    expect(calls).toEqual(['重力 mg', '\\unknown x_y', 42])
  })

  it('stays inert where no canvas API exists', () => {
    expect(() => runInNewContext(CANVAS_TEXT_SHIM, {})).not.toThrow()
  })
})
