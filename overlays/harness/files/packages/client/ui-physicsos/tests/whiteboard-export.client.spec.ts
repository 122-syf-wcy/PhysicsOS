// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { completeExportSvg } from '../src/client/whiteboard/export.ts'
import { elementBounds, hitElement, sceneBounds } from '../src/client/whiteboard/editor-model.ts'
import type { WhiteboardDocument } from '@physicsos/physics-whiteboard'
const board: WhiteboardDocument = { schemaVersion: 1, id: 'board', title: 'Image', appliedGenerationIds: [], sourceImages: [{ id: 'source', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 800, height: 400, byteLength: 1, viewBox: { x: 0, y: 0, width: 800, height: 400 } }], scene: { elements: [{ id: 'image', type: 'image', fileId: 'source', x: 20, y: 30, width: 800, height: 400 }], appState: {} } }
describe('complete image and aligned text exports', () => {
  it('creates the missing SVG image from document data after a still-loading original resolves', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.innerHTML = '<g data-whiteboard-elements="true"><g data-element-id="image" transform="translate(20 30)"></g></g>'
    let resolve!: (url: string) => void; const loading = new Promise<string>(yes => { resolve = yes })
    const exporting = completeExportSvg(board, svg, () => loading)
    resolve('data:image/png;base64,AQ==')
    const exported = await exporting
    expect(exported.querySelector('image')?.getAttribute('href')).toBe('data:image/png;base64,AQ==')
    expect(exported.querySelector('image')?.getAttribute('width')).toBe('800')
    expect(exported.querySelector('image')?.getAttribute('height')).toBe('400')
  })
  it('refuses a partial export when its original image cannot be loaded', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    await expect(completeExportSvg(board, svg, async () => { throw new Error('Original unavailable') })).rejects.toThrow('Original unavailable')
  })
  it('includes full CJK and right/center-aligned labels in selection, hit testing and export bounds', () => {
    const right = { id: 'right', type: 'text', text: '水平向右的力', x: 400, y: 50, fontSize: 24, textAlign: 'right' }
    const box = elementBounds(right)
    expect(box.width).toBeGreaterThanOrEqual(144); expect(box.x + box.width).toBe(400)
    expect(hitElement([right], 270, 60, 0)?.id).toBe('right')
    const center = { ...right, textAlign: 'center' }
    const centered = elementBounds(center); expect(centered.x + centered.width / 2).toBe(400)
    const exported = sceneBounds({ elements: [right], appState: {} }); expect(exported.x).toBeLessThanOrEqual(256)
  })
})
