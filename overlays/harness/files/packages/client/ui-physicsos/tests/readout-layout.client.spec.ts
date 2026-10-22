import { describe, expect, it } from 'vitest'
import { layoutReadout } from '../src/client/physics/readout-layout.ts'

describe('readout card fitting', () => {
  it('wraps long CJK readings instead of spilling beyond a narrow card', () => {
    const result = layoutReadout(['能量', '光子能量与截止频率'], 70)
    expect(result.width).toBeLessThanOrEqual(70)
    expect(result.lines.filter(line => !line.title).map(line => line.text)).toEqual(['光子能量', '与截止频', '率'])
    expect(result.height).toBe(84)
  })

  it('preserves signs, units and scientific notation when wrapping', () => {
    const reading = 'E = 4.97e-19 J · I = 0.003 A'
    const result = layoutReadout(['读数', reading], 110)
    expect(result.lines.filter(line => !line.title).map(line => line.text).join('')).toBe(reading)
    expect(result.width).toBeLessThanOrEqual(110)
  })

  it('keeps short rows intact and renders no card for an empty readout', () => {
    expect(layoutReadout(['读数', 't = 2 s'], 300).lines.map(line => line.text)).toEqual(['读数', 't = 2 s'])
    expect(layoutReadout([], 300)).toEqual({ lines: [], width: 0, height: 0 })
  })
})
