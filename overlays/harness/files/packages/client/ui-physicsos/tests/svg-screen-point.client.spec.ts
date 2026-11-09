// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { svgPointFromClient } from '../src/client/physics/svg-screen-point.ts'

function surface(aspect = 'xMidYMid meet') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '10 20 200 100')
  svg.setAttribute('preserveAspectRatio', aspect)
  Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({
    x: 100, y: 50, left: 100, top: 50, width: 400, height: 400, right: 500, bottom: 450,
  }) })
  Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => null })
  return svg
}

describe('SVG screen coordinates for real apparatus gestures', () => {
  it.each([
    { aspect: 'xMidYMid meet', clientX: 200, clientY: 200, x: 60, y: 45 },
    { aspect: 'xMaxYMin slice', clientX: 300, clientY: 150, x: 160, y: 45 },
    { aspect: 'none', clientX: 200, clientY: 150, x: 60, y: 45 },
    { aspect: 'xMinYMax meet', clientX: 140, clientY: 290, x: 30, y: 40 },
  ])('removes the real $aspect viewport offset and scale', ({ aspect, clientX, clientY, x, y }) => {
    expect(svgPointFromClient(surface(aspect), { clientX, clientY })).toEqual({ x, y })
  })

  it.each([
    { name: 'translation', forward: [1, 0, 0, 1, 100, 50], inverse: [1, 0, 0, 1, -100, -50], clientX: 130, clientY: 90 },
    { name: 'rotation with scale', forward: [0, 2, -2, 0, 100, 50], inverse: [0, -0.5, 0.5, 0, -25, 50], clientX: 20, clientY: 110 },
    { name: 'skew', forward: [1, 0, 0.5, 1, 10, 20], inverse: [1, 0, -0.5, 1, 0, -20], clientX: 60, clientY: 60 },
  ])('uses the native inverse for $name rather than an axis-aligned box', ({ forward, inverse, clientX, clientY }) => {
    const svg = surface()
    const coefficients = ([a, b, c, d, e, f]: number[]) => ({ a, b, c, d, e, f })
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ ...coefficients(forward), inverse: () => coefficients(inverse) }) })
    expect(svgPointFromClient(svg, { clientX, clientY })).toEqual({ x: 30, y: 40 })
  })

  it('refuses a singular screen transform instead of inventing a recoverable scene point', () => {
    const svg = surface()
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({
      a: 0, b: 0, c: 0, d: 1, e: 100, f: 50,
      inverse: () => { throw new Error('The transform collapses one axis.') },
    }) })
    expect(svgPointFromClient(svg, { clientX: 100, clientY: 90 })).toBeUndefined()
  })

  it('refuses malformed viewBox and nonfinite pointer inputs', () => {
    const svg = surface()
    svg.setAttribute('viewBox', '0 0 0 100')
    expect(svgPointFromClient(svg, { clientX: 200, clientY: 200 })).toBeUndefined()
    expect(svgPointFromClient(surface(), { clientX: Number.NaN, clientY: 200 })).toBeUndefined()
  })
})
