import { describe, expect, it } from 'vitest'
import { applyScenePatch, diagramToElements, diffScene, insertDiagram, parseDrawingDiagram, parseWhiteboardDocument } from '../src/index.ts'
import type { DrawingDiagram, SourceImage, WhiteboardDocument, WhiteboardScene } from '../src/types.ts'

const source: SourceImage = { id: 'question-1', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 1200, height: 600, byteLength: 2048, viewBox: { x: 0, y: 0, width: 1200, height: 600 } }
const diagram: DrawingDiagram = { schemaVersion: 1, sourceImageId: source.id, sourceImageSha256: source.sha256, viewBox: source.viewBox,
  primitives: [
    { id: 'rail', type: 'line', points: [[100, 400], [1100, 400]] },
    { id: 'block', type: 'rectangle', x: 400, y: 300, width: 200, height: 100 },
    { id: 'force', type: 'arrow', points: [[600, 350], [900, 350]] },
    { id: 'mass', type: 'text', x: 480, y: 330, text: 'm', fontSize: 24 },
  ], uncertainties: [{ kind: 'missing-measurement', message: 'No length is given; geometry follows image proportions.', primitiveIds: ['rail'] }] }
const blank = (): WhiteboardDocument => ({ schemaVersion: 1, id: 'board-1', title: 'Classroom', scene: { elements: [], appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } }, sourceImages: [source], appliedGenerationIds: [] })

describe('complete editable whiteboard JSON', () => {
  it('round-trips every captured freehand coordinate and pressure without decimation', () => {
    const points = Array.from({ length: 5001 }, (_, i) => [i / 8, (i % 113) / 7])
    const pressures = points.map((_, i) => (i % 101) / 100)
    const document = { ...blank(), scene: { elements: [{ id: 'pen-1', type: 'freedraw', x: 10, y: 20, points, pressures, simulatePressure: false }], appState: { zoom: { value: 1.75 }, scrollX: -50 } } }
    const restored = parseWhiteboardDocument(JSON.parse(JSON.stringify(document)))
    expect(restored.scene.elements[0]?.points).toEqual(points)
    expect(restored.scene.elements[0]?.pressures).toEqual(pressures)
    expect(restored.scene.appState).toEqual({ zoom: { value: 1.75 }, scrollX: -50 })
  })
  it('rejects executable object properties without executing an accessor', () => {
    let reads = 0
    const document = { ...blank(), scene: { elements: [], appState: Object.defineProperty({}, 'name', { enumerable: true, get() { reads += 1; return 'unsafe' } }) } }
    expect(() => parseWhiteboardDocument(document)).toThrow(/JSON|Accessor|accessor/i)
    expect(reads).toBe(0)
  })
  it('rejects foreign iframe/SVG element types and images with unowned resource IDs', () => {
    expect(() => parseWhiteboardDocument({ ...blank(), scene: { elements: [{ id: 'script', type: 'embeddable', link: 'javascript:alert(1)' }], appState: {} } })).toThrow(/type|element/i)
    expect(() => parseWhiteboardDocument({ ...blank(), scene: { elements: [{ id: 'img', type: 'image', fileId: 'someone-elses-image' }], appState: {} } })).toThrow(/image|resource/i)
  })
  it('rejects clipped and malformed source geometry instead of fixing proportions silently', () => {
    expect(() => parseDrawingDiagram({ ...diagram, viewBox: { x: 0, y: 0, width: 600, height: 600 } }, source)).toThrow(/viewBox|geometry|proportion/i)
    expect(() => parseDrawingDiagram({ ...diagram, primitives: [{ id: 'rail', type: 'line', points: [[0, 0], [1201, 600]] }] }, source)).toThrow(/bounds|viewBox/i)
    expect(() => parseDrawingDiagram({ ...diagram, primitives: [{ id: 'code', type: 'svg', svg: '<svg/>' }] }, source)).toThrow(/type|primitive/i)
    expect(() => parseDrawingDiagram({ ...diagram, sourceImageSha256: 'b'.repeat(64) }, source)).toThrow(/source|hash/i)
  })
  it('converts original image-space geometry to independently editable native elements', () => {
    const elements = diagramToElements(parseDrawingDiagram(diagram, source), 'job-1')
    expect(elements).toHaveLength(4)
    expect(elements[0]).toMatchObject({ id: 'generation:job-1:rail', type: 'line', x: 100, y: 400, width: 1000, height: 0, points: [[0, 0], [1000, 0]] })
    expect(elements[1]).toMatchObject({ type: 'rectangle', x: 400, y: 300, width: 200, height: 100 })
    expect(elements[2]).toMatchObject({ type: 'arrow', x: 600, y: 350, points: [[0, 0], [300, 0]], endArrowhead: 'arrow' })
    expect(elements[3]).toMatchObject({ type: 'text', x: 480, y: 330, text: 'm', fontSize: 24 })
    expect(elements[0]?.customData).toMatchObject({ sourceImageId: 'question-1', uncertain: true })
  })
  it('keeps arc endpoints in source coordinates and editable points with no arbitrary scale', () => {
    const elements = diagramToElements({ ...diagram, primitives: [{ id: 'angle', type: 'arc', cx: 300, cy: 200, radius: 100, startAngle: 0, endAngle: Math.PI / 2 }] }, 'arc-job')
    expect(elements[0]?.type).toBe('line')
    const first = elements[0]!
    const points = first.points as readonly (readonly number[])[]
    expect(first.x).toBeCloseTo(300)
    expect(first.y).toBeCloseTo(200)
    expect(points[0]?.[0]).toBeCloseTo(100)
    expect(points[0]?.[1]).toBeCloseTo(0)
    expect(points.at(-1)?.[0]).toBeCloseTo(0)
    expect(points.at(-1)?.[1]).toBeCloseTo(100)
  })
  it('inserts an actual diagram once while preserving later human writing', () => {
    const human = { id: 'pen-late', type: 'freedraw', points: [[0, 0], [8, 9]], pressures: [0.2, 0.8] }
    const current = { ...blank(), scene: { elements: [human], appState: {} } }
    const inserted = insertDiagram(current, diagram, 'job-1')
    expect(inserted.scene.elements[0]).toEqual(human)
    expect(inserted.scene.elements).toHaveLength(5)
    expect(insertDiagram(inserted, diagram, 'job-1')).toEqual(inserted)
  })
  it('applies compact edit/clear differences in both directions, restoring text and pressure', () => {
    const before: WhiteboardScene = { elements: [{ id: 'stroke', type: 'freedraw', points: [[0, 0], [2, 3]], pressures: [0.1, 0.9] }, { id: 'label', type: 'text', text: 'F', x: 20 }], appState: {} }
    const after = { elements: [{ id: 'label', type: 'text', text: '2F', x: 40 }], appState: {} }
    const change = diffScene(before, after)
    expect(change.forward.remove).toEqual(['stroke'])
    expect(change.forward.upsert).toEqual([{ id: 'label', type: 'text', text: '2F', x: 40 }])
    expect(applyScenePatch(before, change.forward)).toEqual(after)
    expect(applyScenePatch(after, change.backward)).toEqual(before)
    const clear = diffScene(before, { elements: [], appState: {} })
    expect(applyScenePatch(before, clear.forward).elements).toEqual([])
    expect(applyScenePatch({ elements: [], appState: {} }, clear.backward)).toEqual(before)
  })
  it('undo retains newly arrived generated elements outside the operation', () => {
    const before: WhiteboardScene = { elements: [{ id: 'label', type: 'text', text: 'F' }], appState: {} }
    const after: WhiteboardScene = { elements: [{ id: 'label', type: 'text', text: '2F' }], appState: {} }
    const change = diffScene(before, after)
    const current: WhiteboardScene = { ...after, elements: [...after.elements, { id: 'generated-rail', type: 'line', points: [[0, 0], [100, 0]] }] }
    expect(applyScenePatch(current, change.backward).elements).toEqual([{ id: 'label', type: 'text', text: 'F' }, { id: 'generated-rail', type: 'line', points: [[0, 0], [100, 0]] }])
  })

  it('retains null array entries in full JSON application state', () => {
    const document = { ...blank(), scene: { elements: [], appState: { selection: [null, 'element'] } } }
    expect(parseWhiteboardDocument(document).scene.appState.selection).toEqual([null, 'element'])
  })

  it('refuses unbounded arc angles before numeric extrema traversal', () => {
    expect(() => parseDrawingDiagram({ ...diagram, primitives: [{ id: 'angle', type: 'arc', cx: 300, cy: 200, radius: 100, startAngle: 10000, endAngle: 10000 }] }, source)).toThrow(/angle/i)
  })

})
