import type { CanvasLayout, CanvasNode } from '@physicsos/physics-workbench/types'
import type { CanvasInkSample, CanvasAnnotationPrimitive } from '@physicsos/physics-whiteboard'

export interface CanvasInkPointer { readonly clientX: number; readonly clientY: number; readonly pressure: number; readonly timeStamp: number }
export interface CanvasInkStroke { readonly points: readonly (readonly [number, number])[]; readonly samples: readonly CanvasInkSample[] }
/** One active buffer, one animation-frame preview, one durable pointer-up operation. */
export function createInkGesture(options: {
  readonly toWorld: (sample: CanvasInkPointer) => { readonly x: number; readonly y: number }
  readonly requestFrame: (callback: () => void) => number
  readonly cancelFrame: (handle: number) => void
  readonly onPreview: (stroke?: CanvasInkStroke) => void
  readonly onCommit: (stroke: CanvasInkStroke) => void
}) {
  let pointer: number | undefined; let samples: CanvasInkSample[] = []; let frame: number | undefined
  const snapshot = (): CanvasInkStroke => ({ points: samples.map(sample => [sample.x, sample.y]), samples: samples.map(sample => ({ ...sample })) })
  const add = (point: CanvasInkPointer): void => {
    const world = options.toWorld(point)
    samples.push({ x: world.x, y: world.y, pressure: point.pressure, time: point.timeStamp })
  }
  const preview = (): void => { if (frame === undefined) frame = options.requestFrame(() => { frame = undefined; if (pointer !== undefined) options.onPreview(snapshot()) }) }
  const cancel = (): void => { if (frame !== undefined) options.cancelFrame(frame); frame = undefined; pointer = undefined; samples = []; options.onPreview(undefined) }
  return {
    begin(id: number, point: CanvasInkPointer): void { if (pointer !== undefined) return; pointer = id; samples = []; add(point); preview() },
    append(id: number, points: readonly CanvasInkPointer[]): void { if (pointer !== id) return; points.forEach(add); preview() },
    finish(id: number, point: CanvasInkPointer): void {
      if (pointer !== id) return
      add(point); const completed = snapshot(); cancel(); options.onCommit(completed)
    },
    cancel,
  }
}
export function shapeFromStroke(stroke: CanvasInkStroke, type: 'line' | 'rectangle' | 'ellipse', id: string): CanvasAnnotationPrimitive {
  const first = stroke.points[0]!; const last = stroke.points.at(-1)!
  if (type === 'line') return { id, type, points: [first, last] }
  const x = Math.min(first[0], last[0]); const y = Math.min(first[1], last[1])
  return { id, type, x, y, width: Math.max(0.001, Math.abs(last[0] - first[0])), height: Math.max(0.001, Math.abs(last[1] - first[1])) }
}
/** Conservative conversions are proposals; raw ink is never overwritten automatically. */
export function suggestInkShape(stroke: CanvasInkStroke, id: string): CanvasAnnotationPrimitive | undefined {
  if (stroke.points.length < 8) return undefined
  const points = stroke.points; const first = points[0]!; const last = points.at(-1)!
  const minX = Math.min(...points.map(point => point[0])); const minY = Math.min(...points.map(point => point[1]))
  const width = Math.max(...points.map(point => point[0])) - minX; const height = Math.max(...points.map(point => point[1])) - minY
  const distance = Math.hypot(last[0] - first[0], last[1] - first[1]); const scale = Math.hypot(width, height)
  if (scale < 24) return undefined
  if (distance > scale * 0.8) {
    const deviation = points.reduce((sum, p) => sum + Math.abs((last[0] - first[0]) * (first[1] - p[1]) - (first[0] - p[0]) * (last[1] - first[1])) / distance, 0) / points.length
    if (deviation < scale * 0.035) return { id, type: 'line', points: [first, last] }
    return undefined
  }
  if (distance > scale * 0.18 || width < 16 || height < 16) return undefined
  const cx = minX + width / 2; const cy = minY + height / 2
  const radialError = points.reduce((sum, p) => sum + Math.abs(Math.hypot((p[0] - cx) / (width / 2), (p[1] - cy) / (height / 2)) - 1), 0) / points.length
  if (radialError < 0.12) return { id, type: 'ellipse', x: minX, y: minY, width, height }
  const edgeError = points.reduce((sum, p) => sum + Math.min(Math.abs(p[0] - minX), Math.abs(p[0] - minX - width), Math.abs(p[1] - minY), Math.abs(p[1] - minY - height)), 0) / points.length
  return edgeError < Math.min(width, height) * 0.055 ? { id, type: 'rectangle', x: minX, y: minY, width, height } : undefined
}

export type CanvasAlignment = 'left' | 'right' | 'top' | 'bottom' | 'horizontal-center' | 'vertical-center'
export type CanvasDistribution = 'horizontal' | 'vertical'
export type CanvasLayer = 'front' | 'back' | 'forward' | 'backward'

/** Layouts use world-space pixels; group membership never changes physical scene coordinates. */
export function descendants(nodes: readonly CanvasNode[], selected: readonly string[]): Set<string> {
  const included = new Set(selected)
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.groupId !== undefined && included.has(node.groupId) && !included.has(node.id)) {
        included.add(node.id)
        changed = true
      }
    }
  }
  return included
}

export function translatedLayouts(
  nodes: readonly CanvasNode[],
  selected: readonly string[],
  dx: number,
  dy: number,
): Readonly<Record<string, CanvasLayout>> {
  const roots = nodes.filter(node => selected.includes(node.id) && node.locked !== true)
  const ids = descendants(nodes, roots.map(node => node.id))
  const layouts: Record<string, CanvasLayout> = {}
  for (const node of nodes) {
    if (ids.has(node.id)) layouts[node.id] = { ...node.layout, x: node.layout.x + dx, y: node.layout.y + dy }
  }
  return layouts
}

export function boundsOf(nodes: readonly CanvasNode[]): { x: number; y: number; width: number; height: number } | undefined {
  if (nodes.length === 0) return undefined
  const x = Math.min(...nodes.map(node => node.layout.x))
  const y = Math.min(...nodes.map(node => node.layout.y))
  return {
    x,
    y,
    width: Math.max(...nodes.map(node => node.layout.x + node.layout.width)) - x,
    height: Math.max(...nodes.map(node => node.layout.y + node.layout.height)) - y,
  }
}

const moveWithChildren = (
  nodes: readonly CanvasNode[],
  id: string,
  next: CanvasLayout,
  result: Record<string, CanvasLayout>,
): void => {
  const source = nodes.find(node => node.id === id)
  if (source === undefined) return
  Object.assign(result, translatedLayouts(nodes, [id], next.x - source.layout.x, next.y - source.layout.y))
  result[id] = next
}

/** Alignment affects selected editable roots and carries their grouped children with them. */
export function alignedLayouts(
  nodes: readonly CanvasNode[],
  selected: readonly string[],
  alignment: CanvasAlignment,
): Readonly<Record<string, CanvasLayout>> {
  const ids = new Set(selected)
  const roots = nodes.filter(node => ids.has(node.id) && node.locked !== true && (node.groupId === undefined || !ids.has(node.groupId)))
  const bounds = boundsOf(roots)
  if (bounds === undefined || roots.length < 2) return {}
  const result: Record<string, CanvasLayout> = {}
  for (const node of roots) {
    const next = { ...node.layout }
    if (alignment === 'left') next.x = bounds.x
    if (alignment === 'right') next.x = bounds.x + bounds.width - next.width
    if (alignment === 'top') next.y = bounds.y
    if (alignment === 'bottom') next.y = bounds.y + bounds.height - next.height
    if (alignment === 'horizontal-center') next.x = bounds.x + (bounds.width - next.width) / 2
    if (alignment === 'vertical-center') next.y = bounds.y + (bounds.height - next.height) / 2
    moveWithChildren(nodes, node.id, next, result)
  }
  return result
}

/** Distribute the selected roots over their existing outer bounds, without rescaling contents. */
export function distributedLayouts(
  nodes: readonly CanvasNode[],
  selected: readonly string[],
  direction: CanvasDistribution,
): Readonly<Record<string, CanvasLayout>> {
  const ids = new Set(selected)
  const horizontal = direction === 'horizontal'
  const roots = nodes.filter(node => ids.has(node.id) && node.locked !== true && (node.groupId === undefined || !ids.has(node.groupId)))
    .sort((a, b) => horizontal ? a.layout.x - b.layout.x : a.layout.y - b.layout.y)
  if (roots.length < 3) return {}
  const bounds = boundsOf(roots)!
  const total = roots.reduce((sum, node) => sum + (horizontal ? node.layout.width : node.layout.height), 0)
  const gap = ((horizontal ? bounds.width : bounds.height) - total) / (roots.length - 1)
  let at = horizontal ? bounds.x : bounds.y
  const result: Record<string, CanvasLayout> = {}
  for (const node of roots) {
    const next = { ...node.layout, ...(horizontal ? { x: at } : { y: at }) }
    moveWithChildren(nodes, node.id, next, result)
    at += (horizontal ? node.layout.width : node.layout.height) + gap
  }
  return result
}

export function layeredLayouts(
  nodes: readonly CanvasNode[],
  selected: readonly string[],
  layer: CanvasLayer,
): Readonly<Record<string, CanvasLayout>> {
  const ids = new Set(selected)
  const sorted = [...nodes].sort((a, b) => a.layout.zIndex - b.layout.zIndex)
  const moving = sorted.filter(node => ids.has(node.id) && node.locked !== true)
  const stationary = sorted.filter(node => !moving.includes(node))
  let ordered: CanvasNode[]
  if (layer === 'front') ordered = [...stationary, ...moving]
  else if (layer === 'back') ordered = [...moving, ...stationary]
  else {
    ordered = [...sorted]
    const indices = ordered.map((node, index) => moving.includes(node) ? index : -1).filter(index => index >= 0)
    if (layer === 'forward') {
      for (const index of indices.reverse()) {
        if (index < ordered.length - 1 && !moving.includes(ordered[index + 1]!)) {
          const current = ordered[index]!
          ordered[index] = ordered[index + 1]!
          ordered[index + 1] = current
        }
      }
    } else {
      for (const index of indices) {
        if (index > 0 && !moving.includes(ordered[index - 1]!)) {
          const current = ordered[index]!
          ordered[index] = ordered[index - 1]!
          ordered[index - 1] = current
        }
      }
    }
  }
  return Object.fromEntries(ordered.map((node, index) => [node.id, { ...node.layout, zIndex: index }]))
}
