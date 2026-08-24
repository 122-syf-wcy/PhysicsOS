// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { estimateLabelWidth, layoutVectorLabels, type LabelBox } from '../src/client/physics/vector-label-layout.ts'
import { parseMathSymbol } from '../src/client/physics/math-symbol.ts'

const box = (id: string, dirX: number, dirY: number, width = 20): LabelBox => ({
  id,
  /* Every arrow starts at the same body, which is exactly the inclined-plane case
     the layout exists for. */
  x: 100,
  y: 100,
  width,
  height: 12,
  dirX,
  dirY,
  anchor: 'start',
})

const overlaps = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number,
): boolean => Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height

describe('layoutVectorLabels', () => {
  it('separates every label of a free-body diagram sharing one origin', () => {
    /* mg down, N along the normal, f up the slope, a down the slope, plus the two
       gravity components — six labels anchored at the same point. */
    const placed = layoutVectorLabels([
      box('mg', 0, 1),
      box('N', -0.5, -0.87),
      box('f', -0.87, -0.5),
      box('a', 0.87, 0.5),
      box('mg-par', 0.87, 0.5),
      box('mg-perp', 0.5, 0.87),
    ])

    expect(placed).toHaveLength(6)
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (a === undefined || b === undefined) continue
        expect(
          overlaps(a, b, 20, 12),
          `${a.id} and ${b.id} must not share a box`,
        ).toBe(false)
      }
    }
  })

  it('keeps a lone label on its own arrow and marks it undisplaced', () => {
    const placed = layoutVectorLabels([box('v', 1, 0)])
    const only = placed[0]
    expect(only?.displaced).toBe(false)
    /* Anchored one gap beyond the tip, along the arrow. */
    expect(only?.x).toBeGreaterThan(100)
    expect(only?.leader).toBeUndefined()
  })

  it('adds a leader line only once a label is pushed far from its arrow', () => {
    /* Many labels on the SAME direction force large displacement, which is when a
       leader stops the pairing from becoming ambiguous. */
    const placed = layoutVectorLabels(
      Array.from({ length: 6 }, (_, index) => box(`v${index}`, 1, 0)),
    )
    expect(placed.at(-1)?.leader).toBeDefined()
    expect(placed[0]?.leader).toBeUndefined()
  })

  it('never returns a non-finite position', () => {
    /* A zero-length arrow has no direction; the solver must still place its label
       deterministically rather than emitting NaN into the SVG. */
    const placed = layoutVectorLabels([box('zero', 0, 0), box('zero-2', 0, 0)])
    for (const entry of placed) {
      expect(Number.isFinite(entry.x)).toBe(true)
      expect(Number.isFinite(entry.y)).toBe(true)
    }
  })
})

describe('estimateLabelWidth', () => {
  it('grows with visible glyphs and discounts script markers', () => {
    const plain = estimateLabelWidth('v', 12)
    const script = estimateLabelWidth('v_x', 12)
    const long = estimateLabelWidth('mg\\sin\\theta', 12)
    expect(script).toBeGreaterThan(plain)
    expect(long).toBeGreaterThan(script)
    /* Over-estimating is the safe direction: extra spacing beats a collision. */
    expect(script).toBeGreaterThanOrEqual(estimateLabelWidth('vx', 12))
  })
})

describe('parseMathSymbol', () => {
  it('splits subscripts and superscripts into script runs', () => {
    expect(parseMathSymbol('v_x')).toEqual([{ text: 'v' }, { text: 'x', script: 'sub' }])
    expect(parseMathSymbol('F_{net}')).toEqual([{ text: 'F' }, { text: 'net', script: 'sub' }])
    expect(parseMathSymbol('t^2')).toEqual([{ text: 't' }, { text: '2', script: 'super' }])
  })

  it('expands the Greek and function names physics labels actually use', () => {
    expect(parseMathSymbol('\\theta')).toEqual([{ text: 'θ' }])
    expect(parseMathSymbol('\\mu')).toEqual([{ text: 'μ' }])
    expect(parseMathSymbol('mg\\sin\\theta')).toEqual([{ text: 'mgsinθ' }])
  })

  it('drops braces that are not a script group', () => {
    expect(parseMathSymbol('{v}')).toEqual([{ text: 'v' }])
  })

  it('returns nothing for an empty symbol rather than an empty run', () => {
    expect(parseMathSymbol('')).toEqual([])
  })
})
