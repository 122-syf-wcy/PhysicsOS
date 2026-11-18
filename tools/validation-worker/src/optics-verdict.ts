import type { BrowserFrame, DrawnSegment, DrawnTriangle, ParameterControlEvidence, StaticOpticsFacts } from './types.ts'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const close = (left: number, right: number): boolean => finite(left) && finite(right) && Math.abs(left - right) <= 1e-6
const matrix = (value: readonly number[]): boolean => Array.isArray(value) && value.length === 6 && value.every(finite)
const point = (value: { readonly x: number; readonly y: number }): boolean => finite(value?.x) && finite(value?.y)
const pixelClose = (left: number, right: number): boolean => {
  if (!finite(left) || !finite(right)) return false
  const magnitude = Math.max(1, Math.abs(left), Math.abs(right))
  const ulp = 2 ** (Math.floor(Math.log2(magnitude)) - 23)
  return Math.abs(left - right) <= Math.min(1 / 1024, 4 * ulp)
}
const samePoint = (left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): boolean => point(left) && point(right) && pixelClose(left.x, right.x) && pixelClose(left.y, right.y)
const nativePoint = (world: { readonly x: number; readonly y: number }, pixel: { readonly x: number; readonly y: number }, transform: readonly number[]): boolean => point(world) && point(pixel) && matrix(transform)
  && close(pixel.x, transform[0]! * world.x + transform[2]! * world.y + transform[4]!)
  && close(pixel.y, transform[1]! * world.x + transform[3]! * world.y + transform[5]!)

/** Only a solid, surviving native one-segment stroke can calibrate or depict facts. */
const segmentValid = (line: DrawnSegment): boolean => line.source === 'canvas-2d-segment-stroke'
  && Number.isSafeInteger(line.surface) && line.surface >= 0 && Number.isSafeInteger(line.strokeIndex) && line.strokeIndex >= 0
  && Number.isInteger(line.paintedPatches) && line.paintedPatches >= 2 && line.paintedPatches <= 4
  && nativePoint(line.from, line.pixelFrom, line.transform) && nativePoint(line.to, line.pixelTo, line.transform)
  && Math.abs(line.transform[0]! * line.transform[3]! - line.transform[1]! * line.transform[2]!) > 1e-12
  && Math.hypot(line.pixelTo.x - line.pixelFrom.x, line.pixelTo.y - line.pixelFrom.y) >= 4
const triangleValid = (head: DrawnTriangle): boolean => head.source === 'canvas-2d-triangle-fill'
  && Number.isSafeInteger(head.surface) && head.surface >= 0 && Number.isSafeInteger(head.drawIndex) && head.drawIndex >= 0
  && Number.isInteger(head.paintedPatches) && head.paintedPatches >= 2 && head.paintedPatches <= 4
  && Array.isArray(head.points) && head.points.length === 3 && Array.isArray(head.pixelPoints) && head.pixelPoints.length === 3
  && matrix(head.transform) && Math.abs(head.transform[0]! * head.transform[3]! - head.transform[1]! * head.transform[2]!) > 1e-12
  && head.points.every((p, index) => nativePoint(p, head.pixelPoints[index]!, head.transform))
  && Math.abs((head.pixelPoints[1]!.x - head.pixelPoints[0]!.x) * (head.pixelPoints[2]!.y - head.pixelPoints[0]!.y)
    - (head.pixelPoints[1]!.y - head.pixelPoints[0]!.y) * (head.pixelPoints[2]!.x - head.pixelPoints[0]!.x)) >= 36

interface Projection {
  readonly scale: number
  readonly originX: number
  readonly axisY: number
  at(point: { readonly x: number; readonly y: number }): { x: number; y: number }
}
function visibleSurfaceScale(frame: BrowserFrame, surface: number): number | undefined {
  const actual = frame.drawnSurfaces?.find(item => item.source === 'canvas-2d-surface' && item.surface === surface)
  if (actual === undefined || ![actual.width, actual.height, actual.displayWidth, actual.displayHeight].every(finite)
    || actual.width <= 0 || actual.height <= 0 || actual.displayWidth <= 0 || actual.displayHeight <= 0) return undefined
  const sx = actual.displayWidth / actual.width, sy = actual.displayHeight / actual.height
  return close(sx, sy) ? sx : undefined
}

interface OpticsGeometry {
  readonly surface: number
  readonly projection: Projection
  readonly axis: DrawnSegment
  readonly lines: readonly DrawnSegment[]
  readonly heads: readonly DrawnTriangle[]
}

function projectionOf(facts: StaticOpticsFacts, line: DrawnSegment): Projection | undefined {
  if (!segmentValid(line) || !close(line.pixelFrom.y, line.pixelTo.y) || !finite(facts.axis.from) || !finite(facts.axis.to) || facts.axis.to <= facts.axis.from) return undefined
  const scale = (line.pixelTo.x - line.pixelFrom.x) / (facts.axis.to - facts.axis.from)
  if (!finite(scale) || scale <= 0) return undefined
  const originX = line.pixelFrom.x - facts.axis.from * scale, axisY = line.pixelFrom.y
  return { scale, originX, axisY, at: p => ({ x: originX + p.x * scale, y: axisY - (p.y - facts.axis.y) * scale }) }
}

/** Axis calibration is independent of object/image/ray positions; never fit a subject camera. */
export function opticsGeometry(frame: BrowserFrame): OpticsGeometry | undefined {
  const facts = frame.optics
  if (facts === undefined || frame.time !== 0 || (frame.taintedSurfaces ?? 0) > 0) return undefined
  for (const axis of frame.drawnSegments ?? []) {
    const projection = projectionOf(facts, axis)
    const displayScale = visibleSurfaceScale(frame, axis.surface)
    if (projection === undefined || displayScale === undefined || Math.hypot(axis.pixelTo.x - axis.pixelFrom.x, axis.pixelTo.y - axis.pixelFrom.y) * displayScale < 16) continue
    const lines: DrawnSegment[] = [], heads: DrawnTriangle[] = [], used = new Set([axis.strokeIndex])
    const take = (from: { x: number; y: number }, to: { x: number; y: number }): DrawnSegment | undefined => {
      const a = projection.at(from), b = projection.at(to)
      const line = frame.drawnSegments?.find(item => item.surface === axis.surface && !used.has(item.strokeIndex) && segmentValid(item)
        && samePoint(item.pixelFrom, a) && samePoint(item.pixelTo, b)
        && Math.hypot(item.pixelTo.x - item.pixelFrom.x, item.pixelTo.y - item.pixelFrom.y) * displayScale >= 4)
      if (line !== undefined) { used.add(line.strokeIndex); lines.push(line) }
      return line
    }
    const arrow = (at: { x: number; y: number }, height: number): boolean => {
      const tip = projection.at({ x: at.x, y: at.y + height }), foot = projection.at(at)
      const direction = Math.sign(tip.y - foot.y)
      const head = frame.drawnTriangles?.find(item => item.surface === axis.surface && triangleValid(item) && samePoint(item.pixelPoints[0]!, tip)
        && pixelClose(item.pixelPoints[1]!.y, item.pixelPoints[2]!.y)
        && pixelClose((item.pixelPoints[1]!.x + item.pixelPoints[2]!.x) / 2, tip.x)
        && item.pixelPoints[1]!.x < tip.x && item.pixelPoints[2]!.x > tip.x
        && (tip.y - item.pixelPoints[1]!.y) * direction > 0
        && Math.abs(tip.y - item.pixelPoints[1]!.y) * displayScale >= 3
        && (item.pixelPoints[2]!.x - item.pixelPoints[1]!.x) * displayScale >= 4)
      if (head === undefined) return false
      const baseY = head.pixelPoints[1]!.y
      // Exact geometry supported: shaft reaches the triangle base, tip is the
      // engine height. Arbitrary arrow styles/sprites do not inherit this proof.
      const shaft = frame.drawnSegments?.find(item => item.surface === axis.surface && !used.has(item.strokeIndex) && segmentValid(item)
        && samePoint(item.pixelFrom, foot) && samePoint(item.pixelTo, { x: tip.x, y: baseY })
        && Math.hypot(item.pixelTo.x - item.pixelFrom.x, item.pixelTo.y - item.pixelFrom.y) * displayScale >= 4)
      if (shaft === undefined) return false
      heads.push(head); used.add(shaft.strokeIndex); lines.push(shaft)
      return true
    }
    if (!arrow(facts.object.at, facts.object.height) || !arrow(facts.image.at, facts.image.height)) continue
    if (take({ x: facts.element.at.x, y: facts.element.at.y - facts.element.halfAperture }, { x: facts.element.at.x, y: facts.element.at.y + facts.element.halfAperture }) === undefined) continue
    let valid = true
    for (const ray of facts.rays) {
      for (let index = 1; index < ray.points.length; index++) {
        if (take(ray.points[index - 1]!, ray.points[index]!) === undefined) { valid = false; break }
      }
    }
    if (!valid) continue
    for (const screen of facts.screens) {
      if (take({ x: screen.at.x, y: screen.at.y - screen.halfHeight }, { x: screen.at.x, y: screen.at.y + screen.halfHeight }) === undefined) { valid = false; break }
    }
    if (valid) return { surface: axis.surface, projection, axis, lines, heads }
  }
  return undefined
}

export function opticsSemanticState(frame: BrowserFrame): boolean {
  const geometry = opticsGeometry(frame), facts = frame.optics
  return geometry !== undefined && facts !== undefined && facts.semanticText.length >= 6
    && facts.semanticText.every(text => frame.drawnTexts?.some(draw => draw.source === 'canvas-2d-text-fill'
      && draw.surface === geometry.surface && draw.text === text && Number.isSafeInteger(draw.paintedPixels) && draw.paintedPixels >= 6
      && finite(draw.inkHeight) && draw.inkHeight * (visibleSurfaceScale(frame, geometry.surface) ?? 0) >= 6))
}

export function opticsStaticStable(frames: readonly BrowserFrame[]): boolean {
  const first = frames[0], anchor = first === undefined ? undefined : opticsGeometry(first)
  if (frames.length !== 2 || first === undefined || anchor === undefined || !/^[a-f0-9]{64}$/.test(first.snapshotSha256 ?? '')) return false
  return frames.every(frame => {
    const geometry = opticsGeometry(frame)
    return frame.time === 0 && frame.revision === first.revision && frame.snapshotSha256 === first.snapshotSha256 && frame.paintHash === first.paintHash
      && JSON.stringify(frame.optics) === JSON.stringify(first.optics) && geometry !== undefined && geometry.surface === anchor.surface
      && geometry.axis.strokeIndex === anchor.axis.strokeIndex && pixelClose(geometry.projection.scale, anchor.projection.scale)
      && pixelClose(geometry.projection.originX, anchor.projection.originX) && pixelClose(geometry.projection.axisY, anchor.projection.axisY)
      && geometry.lines.every((line, index) => line.strokeIndex === anchor.lines[index]?.strokeIndex)
      && geometry.heads.every((head, index) => head.drawIndex === anchor.heads[index]?.drawIndex)
  })
}

export function opticsParameterChanged(first: BrowserFrame | undefined, changed: BrowserFrame | undefined, control: ParameterControlEvidence | undefined): boolean {
  const before = first?.optics, after = changed?.optics
  if (first === undefined || changed === undefined || before === undefined || after === undefined || control === undefined
    || control.id !== 'object-height' || control.from !== before.heightParameter.value || control.to !== after.heightParameter.value
    || !control.nativeContract || !control.intentMatched || !close(control.to - control.from, 0.5)
    || !Number.isSafeInteger(first.revision) || !Number.isSafeInteger(changed.revision)
    || first.snapshotSha256 === changed.snapshotSha256 || !/^[a-f0-9]{64}$/.test(changed.snapshotSha256 ?? '')
    || changed.time !== 0 || !opticsSemanticState(changed) || !opticsSemanticState(first)
    || !close(after.object.height - before.object.height, 0.5) || after.image.height === before.image.height
    || JSON.stringify(before.object.at) !== JSON.stringify(after.object.at) || before.object.id !== after.object.id
    || JSON.stringify(before.element) !== JSON.stringify(after.element) || JSON.stringify(before.marks) !== JSON.stringify(after.marks)
    || before.object.label !== after.object.label || before.image.label !== after.image.label || JSON.stringify(before.screens) !== JSON.stringify(after.screens)
    || !close(after.image.height / after.object.height, before.image.height / before.object.height)
    || before.image.id !== after.image.id || JSON.stringify(before.image.at) !== JSON.stringify(after.image.at) || after.image.nature !== before.image.nature) return false
  const initial = opticsGeometry(first), next = opticsGeometry(changed)
  return initial !== undefined && next !== undefined && initial.surface === next.surface
    && initial.axis.strokeIndex === next.axis.strokeIndex
    && initial.lines.length === next.lines.length && initial.lines.every((line, index) => line.strokeIndex === next.lines[index]?.strokeIndex)
    && initial.heads.every((head, index) => head.drawIndex === next.heads[index]?.drawIndex)
    && before.rays.every((ray, index) => ray.id === after.rays[index]?.id && ray.kind === after.rays[index]?.kind)
}
