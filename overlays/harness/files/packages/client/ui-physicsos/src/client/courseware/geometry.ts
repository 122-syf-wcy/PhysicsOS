import type { CanvasAnnotationPrimitive } from '@physicsos/physics-whiteboard'
import type { InkSample, InkPointer } from '../whiteboard/ink.ts'
import type { CoursewareStage, CoursewareTool } from './types.ts'
export interface CoursewarePointer extends InkPointer { readonly pointerId: number }
export interface CoursewareStageBounds { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
/** CSS pixels -> actual authored stage coordinates, not iframe dimensions and never devicePixelRatio. */
export function coursewarePoint(pointer: Pick<InkPointer, 'clientX' | 'clientY'>, bounds: CoursewareStageBounds, stage: Pick<CoursewareStage, 'width' | 'height'>): { readonly x: number; readonly y: number } {
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(bounds.width + bounds.height)) throw new Error('课件舞台尚未完成布局。')
  return { x: (pointer.clientX - bounds.left) * stage.width / bounds.width, y: (pointer.clientY - bounds.top) * stage.height / bounds.height }
}
export function coursewareSamples(event: InkPointer, bounds: CoursewareStageBounds, stage: Pick<CoursewareStage, 'width' | 'height'>): readonly InkSample[] {
  const events = [...(event.getCoalescedEvents?.() ?? [])]; const last = events.at(-1)
  if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY || last.pressure !== event.pressure || last.timeStamp !== event.timeStamp) events.push(event)
  return events.map(point => ({ ...coursewarePoint(point, bounds, stage), pressure: point.pressure, time: point.timeStamp }))
}
export function fitCoursewareStage(width: number, height: number, logicalWidth = 1920, logicalHeight = 1080): CoursewareStage {
  const scale = Math.max(0.0001, Math.min(width / logicalWidth, height / logicalHeight))
  return { width: logicalWidth, height: logicalHeight, scale, rect: { x: (width - logicalWidth * scale) / 2, y: (height - logicalHeight * scale) / 2, width: logicalWidth * scale, height: logicalHeight * scale } }
}
export function coursewareShape(tool: CoursewareTool, samples: readonly InkSample[], id: string, color: string, width: number): CanvasAnnotationPrimitive | undefined {
  const a = samples[0]; const b = samples.at(-1); if (!a || !b) return undefined
  const style = { strokeColor: color, strokeWidth: width }
  if (tool === 'pen' || tool === 'highlighter') {
    const hex = color.slice(1); const translucent = `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},0.28)`
    return { id, type: 'polyline', points: samples.map(p => [p.x, p.y] as const), samples, style: tool === 'highlighter' ? { strokeColor: translucent, strokeWidth: Math.min(100, width * 5) } : style }
  }
  if (tool === 'line' || tool === 'arrow') return { id, type: tool, points: [[a.x, a.y], [b.x, b.y]], style }
  if (tool === 'rectangle' || tool === 'ellipse') return { id, type: tool, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(0.01, Math.abs(b.x - a.x)), height: Math.max(0.01, Math.abs(b.y - a.y)), style }
  return undefined
}
function segmentDistance(x: number, y: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!; const dy = b[1]! - a[1]!; const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (y - a[1]!) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(x - a[0]! - t * dx, y - a[1]! - t * dy)
}
/** Whole-stroke/whole-shape eraser. It never silently splits or resamples raw pressure paths. */
export function coursewareHit(p: CanvasAnnotationPrimitive, x: number, y: number, tolerance: number): boolean {
  const reach = tolerance + (p.style?.strokeWidth ?? 3) / 2
  if (p.type === 'polyline' || p.type === 'line' || p.type === 'arrow') return p.points.some((point, i) => segmentDistance(x, y, p.points[Math.max(0, i - 1)]!, point) <= reach)
  if (p.type === 'rectangle') { const a = [p.x, p.y]; const b = [p.x + p.width, p.y]; const c = [p.x + p.width, p.y + p.height]; const d = [p.x, p.y + p.height]; return [[a, b], [b, c], [c, d], [d, a]].some(([a, b]) => segmentDistance(x, y, a!, b!) <= reach) }
  if (p.type === 'ellipse') { const rx = p.width / 2; const ry = p.height / 2; return Math.abs(Math.hypot((x - p.x - rx) / rx, (y - p.y - ry) / ry) - 1) * Math.min(rx, ry) <= reach }
  if (p.type === 'arc') return Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.radius) <= reach
  if (p.type === 'text') return x >= p.x - reach && y >= p.y - reach && x <= p.x + p.fontSize * p.text.length * .6 + reach && y <= p.y + p.fontSize * 1.3 + reach
  return false
}
