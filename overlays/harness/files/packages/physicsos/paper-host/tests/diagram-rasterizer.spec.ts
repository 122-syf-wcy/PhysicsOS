import { describe, expect, it } from 'vitest'
import { rasterizePaperDiagram, normalizeSourceFigure, validateFigurePng } from '../src/diagram-rasterizer.ts'
import { simpleDiagram } from './export-fixture.ts'

/** These exercise the declared native Sharp dependency, not a byte stub. */
describe('real controlled diagram rasterization', () => {
  it('produces a complete visible PNG deterministically from real bounded geometry', async () => {
    const png = await rasterizePaperDiagram(simpleDiagram)
    const dimensions = await validateFigurePng(png)
    expect(dimensions.width).toBe(480)
    expect(dimensions.height).toBe(320)
    expect(png).toEqual(await rasterizePaperDiagram(simpleDiagram))
  })
  it('rejects empty and header-valid but truncated PNG payloads', async () => {
    const png = await rasterizePaperDiagram(simpleDiagram)
    await expect(validateFigurePng(new Uint8Array())).rejects.toThrow()
    await expect(validateFigurePng(png.slice(0, 40))).rejects.toThrow()
    await expect(validateFigurePng(png.slice(0, png.length - 40))).rejects.toThrow()
  })
  it('rejects arbitrary native SVG/image resources and false source-attachment digests', async () => {
    await expect(rasterizePaperDiagram({ ...simpleDiagram, primitives: [{ id: 'foreign', role: 'given', type: 'image', href: 'file:///private/asset' }] } as never)).rejects.toThrow('不支持')
    const png = await rasterizePaperDiagram(simpleDiagram)
    await expect(normalizeSourceFigure(png, { id: 'owned-synthetic', sha256: '0'.repeat(64), mediaType: 'image/png' })).rejects.toThrow('SHA-256')
  })
})
