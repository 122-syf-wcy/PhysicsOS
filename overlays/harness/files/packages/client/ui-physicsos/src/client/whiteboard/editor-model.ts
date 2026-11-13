import type { JsonObject, WhiteboardScene } from '@physicsos/physics-whiteboard'
import { inkOutline } from './ink.ts'
export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export const numeric = (element: JsonObject, key: string, fallback = 0): number => typeof element[key] === 'number' ? element[key] : fallback
export const pointsOf = (element: JsonObject): readonly (readonly [number, number])[] => Array.isArray(element.points) ? element.points as readonly (readonly [number, number])[] : []
export function elementBounds(element: JsonObject): Bounds {
  const x = numeric(element, 'x'); const y = numeric(element, 'y'); const points = pointsOf(element)
  if (points.length) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]) }
    return { x: x + minX, y: y + minY, width: maxX - minX, height: maxY - minY }
  }
  const font = numeric(element, 'fontSize', 24)
  const lines = String(element.text ?? '').split('\n')
  const textWidth = Math.max(...lines.map(line => [...line].reduce((sum, glyph) => sum + (/\p{Mark}|[\u200d\ufe0e\ufe0f]/u.test(glyph) ? 0 : glyph === '\t' ? 4 : 1), 0))) * font
  const width = element.type === 'text' ? Math.max(numeric(element, 'width'), textWidth) : numeric(element, 'width')
  const left = element.type === 'text' && element.textAlign === 'right' ? x - width : element.type === 'text' && element.textAlign === 'center' ? x - width / 2 : x
  return { x: left, y, width, height: element.type === 'text' ? Math.max(numeric(element, 'height'), lines.length * font * 1.3) : numeric(element, 'height') }
}
export function sceneBounds(scene: WhiteboardScene): Bounds {
  const visible = scene.elements.filter(element => !element.isDeleted)
  if (!visible.length) return { x: 0, y: 0, width: 1200, height: 700 }
  let x = Infinity; let y = Infinity; let right = -Infinity; let bottom = -Infinity
  for (const element of visible) { const box = elementBounds(element); const pad = numeric(element, 'strokeWidth', 2) + 12; x = Math.min(x, box.x - pad); y = Math.min(y, box.y - pad); right = Math.max(right, box.x + box.width + pad); bottom = Math.max(bottom, box.y + box.height + pad) }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax; const dy = by - ay
  const ratio = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(x - ax - ratio * dx, y - ay - ratio * dy)
}
export function hitElement(elements: readonly JsonObject[], x: number, y: number, tolerance: number): JsonObject | undefined {
  return [...elements].reverse().find(element => {
    if (element.isDeleted) return false
    const points = pointsOf(element); const ox = numeric(element, 'x'); const oy = numeric(element, 'y')
    if (points.length) {
      const width = tolerance + numeric(element, 'strokeWidth', 2)
      if (points.length === 1) return Math.hypot(x - ox - points[0]![0], y - oy - points[0]![1]) <= width
      return points.some((point, index) => index > 0 && segmentDistance(x - ox, y - oy, points[index - 1]![0], points[index - 1]![1], point[0], point[1]) <= width)
    }
    const box = elementBounds(element)
    return x >= box.x - tolerance && x <= box.x + box.width + tolerance && y >= box.y - tolerance && y <= box.y + box.height + tolerance
  })
}
/** Pressure changes remain in the outline even when successive coordinates coincide. */
export function pressurePath(element: JsonObject): string {
  const points = pointsOf(element); const pressures = Array.isArray(element.pressures) ? element.pressures : []
  return inkOutline(points, points.map((_, index) => element.simulatePressure ? 1 : Number(pressures[index] ?? 0.5)), numeric(element, 'strokeWidth', 3))
}
