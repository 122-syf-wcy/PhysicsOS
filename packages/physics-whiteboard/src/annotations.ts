import type { CanvasAnnotationPrimitive, CanvasAnnotationScene, JsonObject } from './types.ts'

export const CANVAS_ANNOTATION_LIMITS = { primitives: 2000, pointsPerStroke: 100000, totalPoints: 200000, coordinate: 10000000 } as const
const fail = (message: string): never => { throw new Error(`Invalid canvas annotations: ${message}`) }
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('expected plain object')
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (!('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe property')
  }
  return input as Record<string, unknown>
}
const keys = (input: Record<string, unknown>, allowed: readonly string[]): void => {
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('unsupported field')
}
const number = (input: unknown, min: number = -CANVAS_ANNOTATION_LIMITS.coordinate, max: number = CANVAS_ANNOTATION_LIMITS.coordinate): number =>
  typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : fail('number outside bounds')
const text = (input: unknown, max = 200): string => typeof input === 'string' && input.length > 0 && input.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input) ? input : fail('invalid text')
const array = (input: unknown, max: number): readonly unknown[] => {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > max) return fail('array exceeds bounds')
  if (Reflect.ownKeys(input).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) fail('unsupported array property')
  for (let index = 0; index < input.length; index++) if (!Object.getOwnPropertyDescriptor(input, index)?.hasOwnProperty('value')) fail('sparse or accessor array')
  return input
}
/** Strict safe vectors only: no URLs, image resources, callbacks or executable metadata. */
export function parseCanvasAnnotations(input: unknown): CanvasAnnotationScene {
  const scene = object(input); keys(scene, ['schemaVersion', 'primitives'])
  if (scene.schemaVersion !== 1) fail('unsupported schema version')
  const ids = new Set<string>(); let count = 0
  const primitives = array(scene.primitives, CANVAS_ANNOTATION_LIMITS.primitives).map(value => {
    const p = object(value); const id = text(p.id)
    if (ids.has(id)) fail('duplicate primitive ID'); ids.add(id)
    const type = text(p.type)
    const fields: Record<string, readonly string[]> = { line: ['points'], arrow: ['points'], polyline: ['points', 'closed', 'samples'], rectangle: ['x', 'y', 'width', 'height'], ellipse: ['x', 'y', 'width', 'height'], arc: ['cx', 'cy', 'radius', 'startAngle', 'endAngle'], text: ['x', 'y', 'text', 'fontSize', 'textAlign'] }
    const specific = fields[type]
    if (!specific) return fail('unsupported primitive type')
    keys(p, ['id', 'type', 'style', ...specific])
    if (p.style !== undefined) {
      const style = object(p.style); keys(style, ['strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle'])
      // Accept the literal syntaxes models and SVG both produce: hex or name,
      // and rgb()/rgba() with numeric channels. No url(), var() or expression
      // syntax can pass this pattern, so no executable value reaches the renderer.
      for (const key of ['strokeColor', 'backgroundColor']) {
        if (style[key] === undefined) continue
        const color = text(style[key])
        if (/^(#[0-9a-f]{3,8}|transparent|black|white|red|blue|green|rgba?\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*(,\s*-?[\d.]+\s*)?\))$/i.test(color)) continue
        fail('invalid color')
      }
      if (style.strokeWidth !== undefined) number(style.strokeWidth, 0.1, 100)
      if (style.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(String(style.strokeStyle))) fail('invalid stroke style')
    }
    if (['line', 'arrow', 'polyline'].includes(type)) {
      const points = array(p.points, type === 'polyline' ? CANVAS_ANNOTATION_LIMITS.pointsPerStroke : 2)
      if (points.length < (type === 'polyline' ? 1 : 2)) fail('missing points')
      count += points.length; if (count > CANVAS_ANNOTATION_LIMITS.totalPoints) fail('too many scene points')
      points.forEach(value => { const pair = array(value, 2); if (pair.length !== 2) fail('invalid point'); pair.forEach(value => number(value)) })
      if (p.closed !== undefined && typeof p.closed !== 'boolean') fail('invalid closed flag')
      if (p.samples !== undefined) {
        const samples = array(p.samples, CANVAS_ANNOTATION_LIMITS.pointsPerStroke)
        if (samples.length !== points.length) fail('sample count differs from points')
        let time = -Infinity
        samples.forEach((value, index) => {
          const sample = object(value); keys(sample, ['x', 'y', 'pressure', 'time'])
          const pair = points[index] as readonly number[]
          if (number(sample.x) !== pair[0] || number(sample.y) !== pair[1]) fail('sample coordinates differ from points')
          number(sample.pressure, 0, 1)
          const next = number(sample.time, 0, Number.MAX_SAFE_INTEGER)
          if (next < time) fail('sample time decreases'); time = next
        })
      }
    } else if (type === 'rectangle' || type === 'ellipse') {
      number(p.x); number(p.y); number(p.width, 0.001); number(p.height, 0.001)
    } else if (type === 'arc') {
      number(p.cx); number(p.cy); number(p.radius, 0.001)
      const start = number(p.startAngle, -Math.PI * 4, Math.PI * 4); const end = number(p.endAngle, -Math.PI * 4, Math.PI * 4)
      if (Math.abs(end - start) > Math.PI * 2 + 1e-8) fail('arc exceeds full circle')
    } else {
      number(p.x); number(p.y); text(p.text, 10000); number(p.fontSize, 1, 500)
      if (p.textAlign !== undefined && !['left', 'center', 'right'].includes(String(p.textAlign))) fail('invalid text alignment')
    }
    // Clone after validation, so callers cannot mutate retained samples or styles.
    return JSON.parse(JSON.stringify(p)) as CanvasAnnotationPrimitive
  })
  return { schemaVersion: 1, primitives }
}
export function readCanvasAnnotations(metadata?: unknown): CanvasAnnotationScene {
  if (metadata === undefined || metadata === null) return { schemaVersion: 1, primitives: [] }
  const source = object(metadata)
  return source.physicsosAnnotations === undefined ? { schemaVersion: 1, primitives: [] } : parseCanvasAnnotations(source.physicsosAnnotations)
}
export function canvasAnnotationsJsonSchema(): JsonObject {
  const n = { type: 'number', minimum: -CANVAS_ANNOTATION_LIMITS.coordinate, maximum: CANVAS_ANNOTATION_LIMITS.coordinate }
  const s = { type: 'string', minLength: 1, maxLength: 200 }
  const point = { type: 'array', items: n, minItems: 2, maxItems: 2 }
  const positive = { type: 'number', minimum: 0.001, maximum: CANVAS_ANNOTATION_LIMITS.coordinate }
  const style = { type: 'object', additionalProperties: false, properties: { strokeColor: { type: 'string', pattern: '^(#[0-9a-fA-F]{3,8}|transparent|black|white|red|blue|green)$' }, backgroundColor: { type: 'string', pattern: '^(#[0-9a-fA-F]{3,8}|transparent|black|white|red|blue|green)$' }, strokeWidth: { type: 'number', minimum: 0.1, maximum: 100 }, strokeStyle: { enum: ['solid', 'dashed', 'dotted'] } } }
  const primitive = (type: string, properties: JsonObject, required: string[]) => ({ type: 'object', additionalProperties: false, properties: { id: s, type: { const: type }, style, ...properties }, required: ['id', 'type', ...required] })
  return { type: 'object', additionalProperties: false, required: ['schemaVersion', 'primitives'], properties: { schemaVersion: { const: 1 }, primitives: { type: 'array', maxItems: CANVAS_ANNOTATION_LIMITS.primitives, items: { anyOf: [
    ...['line', 'arrow'].map(type => primitive(type, { points: { type: 'array', items: point, minItems: 2, maxItems: 2 } }, ['points'])),
    primitive('polyline', { points: { type: 'array', items: point, minItems: 1, maxItems: CANVAS_ANNOTATION_LIMITS.pointsPerStroke }, closed: { type: 'boolean' }, samples: { type: 'array', maxItems: CANVAS_ANNOTATION_LIMITS.pointsPerStroke, items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'pressure', 'time'], properties: { x: n, y: n, pressure: { type: 'number', minimum: 0, maximum: 1 }, time: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } } } } }, ['points']),
    ...['rectangle', 'ellipse'].map(type => primitive(type, { x: n, y: n, width: positive, height: positive }, ['x', 'y', 'width', 'height'])),
    primitive('arc', { cx: n, cy: n, radius: positive, startAngle: { type: 'number', minimum: -Math.PI * 4, maximum: Math.PI * 4 }, endAngle: { type: 'number', minimum: -Math.PI * 4, maximum: Math.PI * 4 } }, ['cx', 'cy', 'radius', 'startAngle', 'endAngle']),
    primitive('text', { x: n, y: n, text: { type: 'string', minLength: 1, maxLength: 10000 }, fontSize: { type: 'number', minimum: 1, maximum: 500 }, textAlign: { enum: ['left', 'center', 'right'] } }, ['x', 'y', 'text', 'fontSize']),
  ] } } } }
}
