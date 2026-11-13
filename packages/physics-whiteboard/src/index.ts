import type { DrawingDiagram, DrawingPrimitive, JsonObject, JsonValue, SceneChange, ScenePatch, SourceImage, ViewBox, WhiteboardDocument, WhiteboardScene } from './types.ts'
export type * from './types.ts'
export { CANVAS_ANNOTATION_LIMITS, parseCanvasAnnotations, readCanvasAnnotations, canvasAnnotationsJsonSchema } from './annotations.ts'

const fail = (message: string): never => { throw new Error(message) }
function json(input: unknown, ancestors = new Set<object>(), depth = 0): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input !== 'object' || depth > 80 || ancestors.has(input)) return fail('Expected finite, acyclic JSON data')
  if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return fail('Expected a plain JSON object')
  ancestors.add(input)
  if (Array.isArray(input)) {
    const result: JsonValue[] = []
    for (let index = 0; index < input.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, index)
      if (!descriptor || !('value' in descriptor)) return fail('Sparse arrays and Accessor properties are not JSON')
      result.push(json(descriptor.value, ancestors, depth + 1))
    }
    ancestors.delete(input)
    return result
  }
  const output: Record<string, JsonValue> = {}
  const descriptors = Object.getOwnPropertyDescriptors(input)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(input) && key === 'length') continue
    if (!('value' in descriptor)) return fail('Accessor properties are not JSON')
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return fail('Unsafe JSON property')
    output[key] = json(descriptor.value, ancestors, depth + 1)
  }
  ancestors.delete(input)
  return output
}
function object(value: JsonValue | undefined, label: string): JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fail(`${label} must be an object`) }
function array(value: JsonValue | undefined, label: string): readonly JsonValue[] { return Array.isArray(value) ? value : fail(`${label} must be an array`) }
function string(value: JsonValue | undefined, label: string): string { return typeof value === 'string' && value.length > 0 ? value : fail(`${label} must be nonempty text`) }
function number(value: JsonValue | undefined, label: string, positive = false): number { return typeof value === 'number' && Number.isFinite(value) && (!positive || value > 0) ? value : fail(`${label} must be a finite ${positive ? 'positive ' : ''}number`) }
function viewBox(value: JsonValue | undefined): ViewBox {
  const v = object(value, 'viewBox')
  return { x: number(v.x, 'viewBox.x'), y: number(v.y, 'viewBox.y'), width: number(v.width, 'viewBox.width', true), height: number(v.height, 'viewBox.height', true) }
}
export function parseSourceImage(input: unknown): SourceImage {
  const v = object(json(input), 'Source image')
  string(v.id, 'Source image ID')
  if (!/^[a-f0-9]{64}$/i.test(string(v.sha256, 'Source image hash'))) fail('Invalid source image hash')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(string(v.mimeType, 'Source image MIME'))) fail('Unsupported source image MIME')
  for (const key of ['width', 'height', 'byteLength']) if (!Number.isSafeInteger(number(v[key], `Source image ${key}`, true))) fail(`Invalid source image ${key}`)
  const box = viewBox(v.viewBox)
  if (box.x !== 0 || box.y !== 0 || box.width !== v.width || box.height !== v.height) fail('Source image viewBox must preserve exact pixel geometry')
  return v as unknown as SourceImage
}
export function parseWhiteboardDocument(input: unknown): WhiteboardDocument {
  const v = object(json(input), 'Whiteboard document')
  if (v.schemaVersion !== 1) fail('Unsupported whiteboard schema version')
  string(v.id, 'Whiteboard ID'); string(v.title, 'Whiteboard title')
  const sources = array(v.sourceImages, 'Source images').map(parseSourceImage)
  const sourceIds = new Set(sources.map(source => source.id))
  if (sourceIds.size !== sources.length) fail('Duplicate source image ID')
  const scene = object(v.scene, 'Scene')
  object(scene.appState, 'Scene appState')
  const ids = new Set<string>()
  for (const item of array(scene.elements, 'Scene elements')) {
    const element = object(item, 'Scene element')
    const id = string(element.id, 'Element ID')
    if (ids.has(id)) fail('Duplicate element ID'); ids.add(id)
    if (!['freedraw', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'image'].includes(string(element.type, 'Element type'))) fail('Unsupported element type')
    if (element.type === 'image' && !sourceIds.has(string(element.fileId, 'Image resource ID'))) fail('Unowned image resource')
    for (const key of ['x', 'y', 'width', 'height', 'strokeWidth', 'fontSize', 'angle']) if (element[key] !== undefined) number(element[key], `Element ${key}`)
    if (element.points !== undefined) for (const point of array(element.points, 'Element points')) {
      const pair = array(point, 'Element point'); if (pair.length !== 2) fail('Invalid element point'); number(pair[0], 'Point x'); number(pair[1], 'Point y')
    }
    if (element.pressures !== undefined) {
      const pressures = array(element.pressures, 'Element pressures')
      if (pressures.length !== array(element.points, 'Element points').length) fail('Pressure count must match every captured point')
      for (const pressure of pressures) if (number(pressure, 'Pressure') < 0 || Number(pressure) > 1) fail('Pressure outside 0–1')
    }
  }
  if (v.history !== undefined) {
    const history = object(v.history, 'Whiteboard history')
    for (const direction of ['undo', 'redo']) for (const value of array(history[direction], 'History stack')) {
      const change = object(value, 'History change')
      for (const side of ['forward', 'backward']) {
        const patch = object(change[side], 'History patch')
        const elements = array(patch.upsert, 'History elements')
        parseWhiteboardDocument({ schemaVersion: 1, id: v.id, title: v.title, scene: { elements, appState: object(patch.appState, 'History appState') }, sourceImages: sources, appliedGenerationIds: [] })
        const order = array(patch.order, 'History order').map(id => string(id, 'History element ID'))
        const remove = array(patch.remove, 'History remove').map(id => string(id, 'History element ID'))
        if (new Set(order).size !== order.length || new Set(remove).size !== remove.length) fail('Duplicate history element ID')
      }
    }
  }
  const generations = array(v.appliedGenerationIds, 'Applied generation IDs').map(id => string(id, 'Generation ID'))
  if (new Set(generations).size !== generations.length) fail('Duplicate generation ID')
  return v as unknown as WhiteboardDocument
}
export function parseDrawingDiagram(input: unknown, source: SourceImage): DrawingDiagram {
  const v = object(json(input), 'Drawing diagram')
  if (v.schemaVersion !== 1) fail('Unsupported diagram version')
  if (v.sourceImageId !== source.id || v.sourceImageSha256 !== source.sha256) fail('Drawing source image or hash mismatch')
  const box = viewBox(v.viewBox)
  if (box.x !== source.viewBox.x || box.y !== source.viewBox.y || box.width !== source.viewBox.width || box.height !== source.viewBox.height) fail('Drawing viewBox changes source geometry/proportions')
  const checkPoint = (x: number, y: number) => { if (x < box.x - 1e-7 || x > box.x + box.width + 1e-7 || y < box.y - 1e-7 || y > box.y + box.height + 1e-7) fail('Primitive outside source viewBox bounds') }
  const ids = new Set<string>()
  const primitives = array(v.primitives, 'Drawing primitives')
  if (!primitives.length || primitives.length > 2000) fail('Drawing must contain 1–2000 actual primitives')
  for (const value of primitives) {
    const p = object(value, 'Primitive'); const id = string(p.id, 'Primitive ID')
    if (ids.has(id)) fail('Duplicate primitive ID'); ids.add(id)
    const type = string(p.type, 'Primitive type')
    if (p.style !== undefined) {
      const style = object(p.style, 'Primitive style')
      for (const key of ['strokeColor', 'backgroundColor']) if (style[key] !== undefined && !/^(#[0-9a-f]{3,8}|transparent|black|white|red|blue|green)$/i.test(string(style[key], 'Color'))) fail('Invalid primitive color')
      if (style.strokeWidth !== undefined && (number(style.strokeWidth, 'Stroke width', true) > 100)) fail('Stroke width exceeds bounds')
      if (style.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(String(style.strokeStyle))) fail('Invalid stroke style')
    }
    if (type === 'line' || type === 'arrow' || type === 'polyline') {
      const points = array(p.points, 'Primitive points')
      if ((type !== 'polyline' && points.length !== 2) || points.length < 2 || points.length > 10000) fail('Invalid primitive points')
      for (const value of points) { const point = array(value, 'Primitive point'); if (point.length !== 2) fail('Invalid point'); checkPoint(number(point[0], 'Point x'), number(point[1], 'Point y')) }
    } else if (type === 'rectangle' || type === 'ellipse') {
      const x = number(p.x, 'Primitive x'); const y = number(p.y, 'Primitive y')
      checkPoint(x, y); checkPoint(x + number(p.width, 'Primitive width', true), y + number(p.height, 'Primitive height', true))
    } else if (type === 'text') {
      checkPoint(number(p.x, 'Text x'), number(p.y, 'Text y')); string(p.text, 'Text label')
      if (number(p.fontSize, 'Font size', true) > 500) fail('Invalid font size')
      if (p.textAlign !== undefined && !['left', 'center', 'right'].includes(String(p.textAlign))) fail('Invalid text alignment')
    } else if (type === 'arc') {
      const cx = number(p.cx, 'Arc cx'); const cy = number(p.cy, 'Arc cy'); const r = number(p.radius, 'Arc radius', true)
      const start = number(p.startAngle, 'Arc start'); const end = number(p.endAngle, 'Arc end')
      if (Math.abs(start) > Math.PI * 4 || Math.abs(end) > Math.PI * 4 || Math.abs(end - start) > Math.PI * 2 + 1e-8) fail('Invalid arc angle range')
      const angles = [start, end]
      for (let i = Math.ceil(Math.min(start, end) / (Math.PI / 2)); i <= Math.floor(Math.max(start, end) / (Math.PI / 2)); i++) angles.push(i * Math.PI / 2)
      for (const angle of angles) checkPoint(cx + r * Math.cos(angle), cy + r * Math.sin(angle))
    } else fail('Unsupported primitive type')
  }
  for (const value of array(v.uncertainties, 'Drawing uncertainties')) {
    const u = object(value, 'Uncertainty')
    if (!['illegible', 'not-to-scale', 'missing-measurement'].includes(string(u.kind, 'Uncertainty kind'))) fail('Invalid uncertainty kind')
    string(u.message, 'Uncertainty message')
    for (const id of array(u.primitiveIds, 'Uncertain primitive IDs')) if (!ids.has(string(id, 'Primitive ID'))) fail('Unknown uncertain primitive ID')
  }
  return v as unknown as DrawingDiagram
}
export function drawingDiagramJsonSchema(source: SourceImage): JsonObject {
  const n = { type: 'number' }; const s = { type: 'string', minLength: 1 }
  const point = { type: 'array', items: n, minItems: 2, maxItems: 2 }
  const style = { type: 'object', additionalProperties: false, properties: { strokeColor: s, backgroundColor: s, strokeWidth: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, strokeStyle: { enum: ['solid', 'dashed', 'dotted'] } } }
  const primitive = (type: string, properties: JsonObject, required: string[]) => ({ type: 'object', additionalProperties: false, properties: { id: s, type: { const: type }, style, ...properties }, required: ['id', 'type', ...required] })
  return { type: 'object', additionalProperties: false, required: ['schemaVersion', 'sourceImageId', 'sourceImageSha256', 'viewBox', 'primitives', 'uncertainties'], properties: {
    schemaVersion: { const: 1 }, sourceImageId: { const: source.id }, sourceImageSha256: { const: source.sha256 }, viewBox: { const: { ...source.viewBox } },
    primitives: { type: 'array', minItems: 1, maxItems: 2000, items: { anyOf: [
      ...['line', 'arrow'].map(type => primitive(type, { points: { type: 'array', items: point, minItems: 2, maxItems: 2 } }, ['points'])),
      primitive('polyline', { points: { type: 'array', items: point, minItems: 2, maxItems: 10000 }, closed: { type: 'boolean' } }, ['points']),
      ...['rectangle', 'ellipse'].map(type => primitive(type, { x: n, y: n, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, ['x', 'y', 'width', 'height'])),
      primitive('arc', { cx: n, cy: n, radius: { type: 'number', exclusiveMinimum: 0 }, startAngle: { type: 'number', minimum: -Math.PI * 4, maximum: Math.PI * 4 }, endAngle: { type: 'number', minimum: -Math.PI * 4, maximum: Math.PI * 4 } }, ['cx', 'cy', 'radius', 'startAngle', 'endAngle']),
      primitive('text', { x: n, y: n, text: s, fontSize: { type: 'number', exclusiveMinimum: 0, maximum: 500 }, textAlign: { enum: ['left', 'center', 'right'] } }, ['x', 'y', 'text', 'fontSize']),
    ] } }, uncertainties: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'message', 'primitiveIds'], properties: { kind: { enum: ['illegible', 'not-to-scale', 'missing-measurement'] }, message: s, primitiveIds: { type: 'array', items: s } } } },
  } }
}
function elementFromPrimitive(p: DrawingPrimitive): JsonObject {
  if (p.type === 'arc') {
    const steps = Math.max(1, Math.ceil(Math.abs(p.endAngle - p.startAngle) * 32))
    const points = Array.from({ length: steps + 1 }, (_, i) => { const angle = p.startAngle + (p.endAngle - p.startAngle) * i / steps; return [p.radius * Math.cos(angle), p.radius * Math.sin(angle)] })
    return { type: 'line', x: p.cx, y: p.cy, width: p.radius * 2, height: p.radius * 2, points }
  }
  if (p.type === 'line' || p.type === 'arrow' || p.type === 'polyline') {
    const x = p.points[0]![0]; const y = p.points[0]![1]
    const points = p.points.map(point => [point[0] - x, point[1] - y])
    const xs = p.points.map(point => point[0]); const ys = p.points.map(point => point[1])
    return { type: p.type === 'polyline' ? 'line' : p.type, x, y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points, ...(p.type === 'arrow' ? { endArrowhead: 'arrow' } : {}), ...(p.type === 'polyline' ? { closed: p.closed ?? false } : {}) }
  }
  if (p.type === 'text') return { type: 'text', x: p.x, y: p.y, text: p.text, fontSize: p.fontSize, textAlign: p.textAlign ?? 'left' }
  if (p.type === 'rectangle' || p.type === 'ellipse') return { type: p.type, x: p.x, y: p.y, width: p.width, height: p.height }
  return fail('Unsupported primitive type')
}
export function diagramToElements(diagram: DrawingDiagram, generationId: string): readonly JsonObject[] {
  return diagram.primitives.map(p => {
    const uncertainties = diagram.uncertainties.filter(u => u.primitiveIds.includes(p.id))
    return { id: `generation:${generationId}:${p.id}`, ...elementFromPrimitive(p), strokeColor: p.style?.strokeColor ?? '#1e293b', backgroundColor: p.style?.backgroundColor ?? 'transparent', strokeWidth: p.style?.strokeWidth ?? 2, strokeStyle: uncertainties.length ? 'dashed' : p.style?.strokeStyle ?? 'solid', customData: { sourceImageId: diagram.sourceImageId, generationId, uncertain: uncertainties.length > 0, uncertainties: uncertainties.map(u => ({ kind: u.kind, message: u.message })) } }
  })
}
export function insertDiagram(document: WhiteboardDocument, diagram: DrawingDiagram, generationId: string): WhiteboardDocument {
  if (document.appliedGenerationIds.includes(generationId)) return document
  const source = document.sourceImages.find(image => image.id === diagram.sourceImageId) ?? fail('Drawing source image is not owned by this whiteboard')
  const valid = parseDrawingDiagram(diagram, source)
  return { ...editWhiteboardDocument(document, { ...document.scene, elements: [...document.scene.elements, ...diagramToElements(valid, generationId)] }), appliedGenerationIds: [...document.appliedGenerationIds, generationId] }
}
function patch(before: WhiteboardScene, after: WhiteboardScene): ScenePatch {
  const previous = new Map(before.elements.map(e => [String(e.id), e])); const next = new Set(after.elements.map(e => String(e.id)))
  return { upsert: after.elements.filter(e => previous.get(String(e.id)) !== e && JSON.stringify(previous.get(String(e.id))) !== JSON.stringify(e)), remove: [...previous.keys()].filter(id => !next.has(id)), order: after.elements.map(e => String(e.id)), appState: after.appState }
}
export function diffScene(before: WhiteboardScene, after: WhiteboardScene): SceneChange { return { forward: patch(before, after), backward: patch(after, before) } }
export function applyScenePatch(scene: WhiteboardScene, change: ScenePatch): WhiteboardScene {
  const elements = new Map(scene.elements.map(e => [String(e.id), e]))
  for (const id of change.remove) elements.delete(id)
  for (const element of change.upsert) elements.set(String(element.id), element)
  return { elements: [...change.order.map(id => elements.get(id) ?? fail('Scene patch references a missing element')), ...[...elements].filter(([id]) => !change.order.includes(id)).map(([, element]) => element)], appState: change.appState }
}

/** Scene edits, including source/diagram insertion, share the persisted document history. */
export function editWhiteboardDocument(document: WhiteboardDocument, scene: WhiteboardScene): WhiteboardDocument {
  const change = diffScene(document.scene, scene)
  if (!change.forward.upsert.length && !change.forward.remove.length && change.forward.order.join('\0') === change.backward.order.join('\0')) return { ...document, scene }
  return { ...document, scene, history: { undo: [...(document.history?.undo ?? []), change], redo: [] } }
}
/** Undo/redo retain all geometry and unrelated current elements without replaying generation. */
export function moveWhiteboardHistory(document: WhiteboardDocument, direction: 'undo' | 'redo'): WhiteboardDocument {
  const history = document.history ?? { undo: [], redo: [] }
  const from = history[direction]; const change = from.at(-1)
  if (!change) return document
  const other = direction === 'undo' ? 'redo' : 'undo'
  return { ...document, scene: applyScenePatch(document.scene, direction === 'undo' ? change.backward : change.forward), history: { ...history, [direction]: from.slice(0, -1), [other]: [...history[other], change] } }
}
