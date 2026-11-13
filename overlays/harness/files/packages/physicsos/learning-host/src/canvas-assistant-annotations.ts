import type { CanvasAnnotationPrimitive, CanvasAnnotationScene, DrawingPrimitive } from '@physicsos/physics-whiteboard'
import type { CanvasLayout } from '@physicsos/physics-workbench/types'

interface Region { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Viewport extends Region { readonly zoom: number }
export interface ModelAnnotationContext {
  readonly schemaVersion: 1
  readonly geometryOnly: true
  readonly primitives: readonly DrawingPrimitive[]
  readonly omittedOffscreen: number
  readonly omittedForBudget: number
  readonly simplifiedStrokeCount: number
}
const intersects = (left: Region, right: Region): boolean => left.x <= right.x + right.width && left.x + left.width >= right.x && left.y <= right.y + right.height && left.y + left.height >= right.y
function bounds(p: CanvasAnnotationPrimitive): Region | undefined {
  if (p.type === 'line' || p.type === 'arrow' || p.type === 'polyline') {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const point of p.points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]) }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  if (p.type === 'rectangle' || p.type === 'ellipse') return p
  if (p.type === 'arc') return { x: p.cx - p.radius, y: p.cy - p.radius, width: p.radius * 2, height: p.radius * 2 }
  if (p.type === 'text') return { x: p.x, y: p.y, width: Math.max(...p.text.split('\n').map(line => line.length)) * p.fontSize * 0.6, height: p.text.split('\n').length * p.fontSize * 1.3 }
  return undefined
}
/** A bounded geometric proxy for model reading; saved raw samples are never edited. */
export function modelAnnotationContext(scene: CanvasAnnotationScene, selected: readonly { readonly layout: CanvasLayout }[], viewport: Viewport, byteBudget: number): ModelAnnotationContext {
  const regions: Region[] = [{ x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: viewport.width / viewport.zoom, height: viewport.height / viewport.zoom },
    ...selected.map(node => ({ x: node.layout.x - 40, y: node.layout.y - 40, width: node.layout.width + 80, height: node.layout.height + 80 }))]
  const primitives: DrawingPrimitive[] = []; let omittedOffscreen = 0; let omittedForBudget = 0; let simplifiedStrokeCount = 0
  let remaining = Math.max(0, Math.min(64 * 1024, byteBudget) - 512)
  for (const p of scene.primitives) {
    const box = bounds(p)
    if (!box || !regions.some(region => intersects(box, region))) { omittedOffscreen++; continue }
    const { samples: _rawSamples, ...base } = p
    const count = p.type === 'polyline' ? Math.min(256, p.points.length) : 0
    const simplified = p.type === 'polyline' && count < p.points.length
    const geometry = (p.type === 'polyline' ? { ...base, points: simplified ? Array.from({ length: count }, (_, index) => p.points[Math.round(index * (p.points.length - 1) / (count - 1))]!) : p.points } : base) as DrawingPrimitive
    const bytes = Buffer.byteLength(JSON.stringify(geometry)) + 1
    if (primitives.length >= 100 || bytes > remaining) { omittedForBudget++; continue }
    primitives.push(geometry); remaining -= bytes
    if (simplified) simplifiedStrokeCount++
  }
  return { schemaVersion: 1, geometryOnly: true, primitives, omittedOffscreen, omittedForBudget, simplifiedStrokeCount }
}
