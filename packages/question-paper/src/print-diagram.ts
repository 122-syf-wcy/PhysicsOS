/**
 * Paper-only, deterministic diagrams. The primitive vocabulary follows the
 * whiteboard's controlled drawing spec, but this is NOT a transcription of
 * a source image and never invents a source-image id/hash or engine reading.
 * Coordinates are x-right/y-up; circular arcs use radians. Only `given`
 * primitives appear in a student diagram. Solution construction stays on
 * the teacher side and must not be relabelled as a given to fill a gap.
 */

import { createHash } from 'node:crypto'
import type { PaperFigure, PaperQuestion } from './paper.ts'

export type DiagramPoint = readonly [number, number]
export type DiagramRole = 'given' | 'solution'
interface PrimitiveBase { readonly id: string; readonly role: DiagramRole }
interface Stroke { readonly dashed?: boolean }
export type CircuitSymbol = 'resistor' | 'voltage_source' | 'switch' | 'ammeter' | 'voltmeter' | 'variable_resistor'
export interface CircuitTerminal { readonly componentId: string; readonly terminal: 'a' | 'b' }
export type PaperDiagramPrimitive = PrimitiveBase & (
  | (Stroke & { readonly type: 'line' | 'arrow'; readonly points: readonly [DiagramPoint, DiagramPoint] })
  | (Stroke & { readonly type: 'polyline'; readonly points: readonly DiagramPoint[]; readonly closed?: boolean })
  | { readonly type: 'rectangle' | 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly type: 'circle'; readonly cx: number; readonly cy: number; readonly radius: number }
  | (Stroke & { readonly type: 'arc'; readonly cx: number; readonly cy: number; readonly radius: number; readonly startAngle: number; readonly endAngle: number })
  | { readonly type: 'angle'; readonly vertex: DiagramPoint; readonly first: DiagramPoint; readonly second: DiagramPoint; readonly radius: number; readonly label?: string }
  | { readonly type: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly fontSize: number; readonly textAlign?: 'left' | 'center' | 'right' }
  | { readonly type: 'circuit-component'; readonly symbol: CircuitSymbol; readonly at: DiagramPoint; readonly rotation: 0 | 90 | 180 | 270; readonly size: number; readonly label?: string; readonly closed?: boolean }
  | { readonly type: 'circuit-wire'; readonly from: CircuitTerminal; readonly to: CircuitTerminal; readonly via: readonly DiagramPoint[] }
  | { readonly type: 'junction'; readonly at: DiagramPoint; readonly radius: number }
  | { readonly type: 'coordinate-axes'; readonly origin: DiagramPoint; readonly xLength: number; readonly yLength: number; readonly xLabel: string; readonly yLabel: string; readonly ticks: readonly { readonly axis: 'x' | 'y'; readonly offset: number; readonly label: string }[] }
)
export interface PaperDiagramSpec {
  readonly schemaVersion: 1
  readonly viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly scale: 'schematic' | 'metric'
  readonly primitives: readonly PaperDiagramPrimitive[]
}
export interface SourceFigureAsset {
  /** An owned, authorized attachment id, never a URL or a filesystem path. */
  readonly id: string
  readonly sha256: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}
export interface DiagramPaperFigure extends PaperFigure {
  /** Legacy `caption` remains an internal instruction, not a student label. */
  readonly studentCaption?: string
  readonly diagram?: PaperDiagramSpec
  readonly sourceAsset?: SourceFigureAsset
}

export const PAPER_DIAGRAM_RENDERER_VERSION = 'paper-diagram-svg-v1'
export const PAPER_DIAGRAM_LIMITS = { primitives: 256, points: 512, dimension: 2000, text: 80 } as const
const CAPTIONS = ['示意图', '电路图', '电路示意图', '光路图', '光路示意图', '实验装置示意图', '运动示意图', '几何示意图', '坐标图', '数据图', '题图'] as const
const fail = (message: string): never => { throw new Error(`题图规格无效：${message}`) }
const record = (input: unknown, label: string): Record<string, unknown> => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) return fail(`${label}必须是 JSON 对象`)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if (!('value' in descriptor)) fail('不允许 accessor 属性')
  return input as Record<string, unknown>
}
const keys = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`不支持属性 ${key}`)
}
const num = (value: unknown, label: string, min = -1e6, max = 1e6): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail(`${label}超出有限数值范围`)
const text = (value: unknown, label: string, max: number = PAPER_DIAGRAM_LIMITS.text): string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : fail(`${label}须为短单行文本`)
const list = (value: unknown, label: string, min: number, max: number): readonly unknown[] =>
  Array.isArray(value) && value.length >= min && value.length <= max ? value : fail(`${label}数量超出范围`)
const idOf = (value: unknown): string => {
  const id = text(value, '图元 id', 64)
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? id : fail('图元 id 只能含字母、数字、连字符和下划线')
}

/** Validate the complete spec before any native SVG renderer receives it. */
export function parsePaperDiagram(input: unknown): PaperDiagramSpec {
  const root = record(input, 'diagram')
  keys(root, ['schemaVersion', 'viewBox', 'scale', 'primitives'])
  if (root.schemaVersion !== 1 || !['schematic', 'metric'].includes(String(root.scale))) fail('版本或比例声明不支持')
  const box = record(root.viewBox, 'viewBox')
  keys(box, ['x', 'y', 'width', 'height'])
  const x = num(box.x, 'viewBox.x'); const y = num(box.y, 'viewBox.y')
  const width = num(box.width, 'viewBox.width', 24, PAPER_DIAGRAM_LIMITS.dimension)
  const height = num(box.height, 'viewBox.height', 24, PAPER_DIAGRAM_LIMITS.dimension)
  const point = (input: unknown): DiagramPoint => {
    const p = list(input, '坐标', 2, 2)
    const px = num(p[0], 'x'); const py = num(p[1], 'y')
    if (px < x - 1e-8 || px > x + width + 1e-8 || py < y - 1e-8 || py > y + height + 1e-8) fail('图元超出 viewBox')
    return [px, py]
  }
  const rectBounds = (px: number, py: number, w: number, h: number): void => { point([px, py]); point([px + w, py + h]) }
  const arcBounds = (cx: number, cy: number, radius: number, start: number, end: number): void => {
    const angles = [start, end]
    for (let i = Math.ceil(Math.min(start, end) / (Math.PI / 2)); i <= Math.floor(Math.max(start, end) / (Math.PI / 2)); i++) angles.push(i * Math.PI / 2)
    for (const angle of angles) point([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
  }
  const labelBounds = (px: number, py: number, value: string, fontSize: number, align = 'center'): void => {
    const w = [...value].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.65), 0) * fontSize
    const left = align === 'left' ? px : align === 'right' ? px - w : px - w / 2
    rectBounds(left, py - fontSize * 0.7, w, fontSize * 1.4)
  }
  const primitiveIds = new Set<string>()
  const primitives = list(root.primitives, '图元', 1, PAPER_DIAGRAM_LIMITS.primitives).map((input): PaperDiagramPrimitive => {
    const p = record(input, '图元'); const id = idOf(p.id)
    if (primitiveIds.has(id)) fail(`重复图元 id ${id}`)
    primitiveIds.add(id)
    if (p.role !== 'given' && p.role !== 'solution') fail('每个图元须明确 given 或 solution，不能默认公开解题构造')
    const base: PrimitiveBase = { id, role: p.role as DiagramRole }
    const common = ['id', 'role', 'type']
    const stroke = (): Stroke => {
      if (p.dashed !== undefined && typeof p.dashed !== 'boolean') fail('dashed 必须为布尔值')
      return p.dashed === undefined ? {} : { dashed: p.dashed as boolean }
    }
    if (p.type === 'line' || p.type === 'arrow' || p.type === 'polyline') {
      keys(p, [...common, 'points', 'dashed', ...(p.type === 'polyline' ? ['closed'] : [])])
      const points = list(p.points, '线段坐标', 2, p.type === 'polyline' ? PAPER_DIAGRAM_LIMITS.points : 2).map(point)
      for (let i = 1; i < points.length; i++) if (Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]) < 1e-6) fail('零长度线段')
      if (p.type === 'polyline') {
        if (p.closed !== undefined && typeof p.closed !== 'boolean') fail('closed 必须为布尔值')
        return { ...base, type: p.type, points, ...stroke(), ...(p.closed === undefined ? {} : { closed: p.closed as boolean }) }
      }
      return { ...base, type: p.type, points: points as unknown as readonly [DiagramPoint, DiagramPoint], ...stroke() }
    }
    if (p.type === 'rectangle' || p.type === 'ellipse') {
      keys(p, [...common, 'x', 'y', 'width', 'height'])
      const px = num(p.x, 'x'); const py = num(p.y, 'y'); const w = num(p.width, 'width', 1, width); const h = num(p.height, 'height', 1, height)
      rectBounds(px, py, w, h)
      return { ...base, type: p.type, x: px, y: py, width: w, height: h }
    }
    if (p.type === 'circle' || p.type === 'arc') {
      keys(p, [...common, 'cx', 'cy', 'radius', ...(p.type === 'arc' ? ['startAngle', 'endAngle', 'dashed'] : [])])
      const cx = num(p.cx, 'cx'); const cy = num(p.cy, 'cy'); const radius = num(p.radius, 'radius', 1, Math.max(width, height))
      if (p.type === 'circle') { rectBounds(cx - radius, cy - radius, radius * 2, radius * 2); return { ...base, type: p.type, cx, cy, radius } }
      const startAngle = num(p.startAngle, 'startAngle', -Math.PI * 4, Math.PI * 4)
      const endAngle = num(p.endAngle, 'endAngle', -Math.PI * 4, Math.PI * 4)
      if (Math.abs(endAngle - startAngle) < 1e-6 || Math.abs(endAngle - startAngle) > Math.PI * 2 + 1e-8) fail('圆弧角域无效')
      arcBounds(cx, cy, radius, startAngle, endAngle)
      return { ...base, type: p.type, cx, cy, radius, startAngle, endAngle, ...stroke() }
    }
    if (p.type === 'angle') {
      keys(p, [...common, 'vertex', 'first', 'second', 'radius', 'label'])
      const vertex = point(p.vertex); const first = point(p.first); const second = point(p.second)
      const radius = num(p.radius, '角标半径', 2, Math.min(Math.hypot(first[0] - vertex[0], first[1] - vertex[1]), Math.hypot(second[0] - vertex[0], second[1] - vertex[1])))
      const { start, end } = angleRange(vertex, first, second)
      if (end - start < 1e-6 || end - start > Math.PI + 1e-8) fail('角标须为非零、不超过平角的逆时针夹角')
      arcBounds(vertex[0], vertex[1], radius, start, end)
      const label = p.label === undefined ? undefined : text(p.label, '角标')
      const degrees = label?.match(/^(\d+(?:\.\d+)?)\s*(?:°|度)$/)
      if (degrees !== undefined && degrees !== null && Math.abs(Number(degrees[1]) - (end - start) * 180 / Math.PI) > 0.05) fail('标注角度与实际几何夹角不符')
      if (label !== undefined) labelBounds(vertex[0] + (radius + 12) * Math.cos((start + end) / 2), vertex[1] + (radius + 12) * Math.sin((start + end) / 2), label, 12)
      return { ...base, type: p.type, vertex, first, second, radius, ...(label === undefined ? {} : { label }) }
    }
    if (p.type === 'text') {
      keys(p, [...common, 'x', 'y', 'text', 'fontSize', 'textAlign'])
      const px = num(p.x, 'text.x'); const py = num(p.y, 'text.y'); const value = text(p.text, '标注')
      const fontSize = num(p.fontSize, 'fontSize', 8, 32)
      const align = p.textAlign === undefined ? 'center' : String(p.textAlign)
      if (!['left', 'center', 'right'].includes(align)) fail('文字对齐方式不支持')
      labelBounds(px, py, value, fontSize, align)
      return { ...base, type: p.type, x: px, y: py, text: value, fontSize, textAlign: align as 'left' | 'center' | 'right' }
    }
    if (p.type === 'circuit-component') {
      keys(p, [...common, 'symbol', 'at', 'rotation', 'size', 'label', 'closed'])
      const symbols: readonly string[] = ['resistor', 'voltage_source', 'switch', 'ammeter', 'voltmeter', 'variable_resistor']
      if (!symbols.includes(String(p.symbol))) fail('不支持该电路元件符号')
      const at = point(p.at); const size = num(p.size, '元件尺寸', 16, 120)
      if (![0, 90, 180, 270].includes(Number(p.rotation)) || typeof p.rotation !== 'number') fail('元件 rotation 须为 0/90/180/270')
      rectBounds(at[0] - size * 0.8, at[1] - size * 0.8, size * 1.6, size * 1.6)
      if (p.closed !== undefined && (p.symbol !== 'switch' || typeof p.closed !== 'boolean')) fail('closed 仅用于开关且须为布尔值')
      if (p.symbol === 'switch' && p.closed === undefined) fail('开关须明确开闭状态')
      const label = p.label === undefined ? undefined : text(p.label, '元件名称', 24)
      if (label !== undefined) labelBounds(at[0], at[1] - size * 0.9, label, 12)
      return { ...base, type: p.type, symbol: p.symbol as CircuitSymbol, at, rotation: p.rotation as 0 | 90 | 180 | 270, size, ...(label === undefined ? {} : { label }), ...(p.closed === undefined ? {} : { closed: p.closed as boolean }) }
    }
    if (p.type === 'circuit-wire') {
      keys(p, [...common, 'from', 'to', 'via'])
      const terminal = (input: unknown): CircuitTerminal => {
        const t = record(input, '电路端点'); keys(t, ['componentId', 'terminal'])
        if (t.terminal !== 'a' && t.terminal !== 'b') fail('端点须为 a 或 b（电源 a 负、b 正）')
        return { componentId: idOf(t.componentId), terminal: t.terminal }
      }
      return { ...base, type: p.type, from: terminal(p.from), to: terminal(p.to), via: list(p.via, '导线拐点', 0, 32).map(point) }
    }
    if (p.type === 'junction') {
      keys(p, [...common, 'at', 'radius'])
      const at = point(p.at); const radius = num(p.radius, '结点半径', 1, 4)
      rectBounds(at[0] - radius, at[1] - radius, radius * 2, radius * 2)
      return { ...base, type: p.type, at, radius }
    }
    if (p.type === 'coordinate-axes') {
      keys(p, [...common, 'origin', 'xLength', 'yLength', 'xLabel', 'yLabel', 'ticks'])
      const origin = point(p.origin); const xLength = num(p.xLength, 'xLength', 24, width); const yLength = num(p.yLength, 'yLength', 24, height)
      point([origin[0] + xLength, origin[1]]); point([origin[0], origin[1] + yLength])
      const xLabel = text(p.xLabel, '横轴名称', 16); const yLabel = text(p.yLabel, '纵轴名称', 16)
      labelBounds(origin[0] + xLength, origin[1] - 18, xLabel, 12)
      labelBounds(origin[0], origin[1] + yLength + 18, yLabel, 12)
      const ticks = list(p.ticks, '坐标刻度', 0, 40).map((input) => {
        const t = record(input, '刻度'); keys(t, ['axis', 'offset', 'label'])
        if (t.axis !== 'x' && t.axis !== 'y') fail('刻度 axis 须为 x 或 y')
        const offset = num(t.offset, '刻度位置', 0, t.axis === 'x' ? xLength - 8 : yLength - 8)
        const label = text(t.label, '已知刻度', 16)
        labelBounds(t.axis === 'x' ? origin[0] + offset : origin[0] - 18, t.axis === 'y' ? origin[1] + offset : origin[1] - 16, label, 10)
        return { axis: t.axis as 'x' | 'y', offset, label }
      })
      return { ...base, type: p.type, origin, xLength, yLength, xLabel, yLabel, ticks }
    }
    return fail(`不支持图元类型 ${String(p.type)}`)
  })
  if (!primitives.some((p) => p.role === 'given' && p.type !== 'text')) fail('学生题图没有实际已知图形；不能只用文字或解题图占位')
  const components = new Map(primitives.filter((p): p is Extract<PaperDiagramPrimitive, { type: 'circuit-component' }> => p.type === 'circuit-component').map((p) => [p.id, p]))
  for (const wire of primitives.filter((p): p is Extract<PaperDiagramPrimitive, { type: 'circuit-wire' }> => p.type === 'circuit-wire')) {
    const path = circuitWirePoints(wire, components)
    for (let i = 1; i < path.length; i++) {
      if (Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]) < 1e-6) fail('导线有零长度片段')
      if (Math.abs(path[i]![0] - path[i - 1]![0]) > 1e-7 && Math.abs(path[i]![1] - path[i - 1]![1]) > 1e-7) fail('导线必须横平竖直；请提供明确拐点，不自动猜测接线')
    }
  }
  return { schemaVersion: 1, viewBox: { x, y, width, height }, scale: root.scale as 'schematic' | 'metric', primitives }
}

/** Legacy figures stay readable; only explicit specs/assets can be rendered. */
export function parsePaperFigure(input: unknown): DiagramPaperFigure {
  const f = record(input, 'figure'); keys(f, ['kind', 'ref', 'caption', 'studentCaption', 'diagram', 'sourceAsset'])
  if (f.kind !== 'line-diagram' && f.kind !== 'image') fail('figure.kind 不支持')
  const ref = text(f.ref, 'figure.ref', 128)
  if (/[/\\]/.test(ref)) fail('figure.ref 不得包含路径分隔符')
  const caption = f.caption === undefined ? undefined : typeof f.caption === 'string' && f.caption.length <= 6000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(f.caption) ? f.caption : fail('内部图指令不是限额内文本')
  const studentCaption = f.studentCaption === undefined ? undefined : text(f.studentCaption, '学生图注', 24)
  if (studentCaption !== undefined && !CAPTIONS.includes(studentCaption as typeof CAPTIONS[number])) fail('学生图注只能为中性图名；作图指令/方向/答案不得进入学生卷')
  if (f.diagram !== undefined && f.kind !== 'line-diagram') fail('diagram 仅用于 line-diagram')
  let sourceAsset: SourceFigureAsset | undefined
  if (f.sourceAsset !== undefined) {
    if (f.kind !== 'image') fail('来源附件仅用于 image')
    const source = record(f.sourceAsset, '来源附件'); keys(source, ['id', 'sha256', 'mediaType'])
    const id = text(source.id, '来源附件 id', 128)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) fail('来源附件 id 不是可安全解析的标识')
    if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256)) fail('来源附件须带真实 SHA-256')
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(source.mediaType))) fail('来源附件须为受支持的真实栅格图')
    sourceAsset = { id, sha256: source.sha256, mediaType: source.mediaType as SourceFigureAsset['mediaType'] }
  }
  return { kind: f.kind, ref, ...(caption === undefined ? {} : { caption }), ...(studentCaption === undefined ? {} : { studentCaption }), ...(f.diagram === undefined ? {} : { diagram: parsePaperDiagram(f.diagram) }), ...(sourceAsset === undefined ? {} : { sourceAsset }) }
}

function angleRange(vertex: DiagramPoint, first: DiagramPoint, second: DiagramPoint): { start: number; end: number } {
  const start = Math.atan2(first[1] - vertex[1], first[0] - vertex[0])
  const angle = (Math.atan2(second[1] - vertex[1], second[0] - vertex[0]) - start + Math.PI * 2) % (Math.PI * 2)
  return { start, end: start + angle }
}

/** Standard two-terminal geometry, matching the scene renderer's axis model. */
export function paperCircuitTerminalPoint(component: Extract<PaperDiagramPrimitive, { type: 'circuit-component' }>, terminal: 'a' | 'b'): DiagramPoint {
  const angle = component.rotation * Math.PI / 180; const offset = component.size * 0.75 * (terminal === 'a' ? -1 : 1)
  return [component.at[0] + offset * Math.cos(angle), component.at[1] + offset * Math.sin(angle)]
}
function circuitWirePoints(wire: Extract<PaperDiagramPrimitive, { type: 'circuit-wire' }>, components: ReadonlyMap<string, Extract<PaperDiagramPrimitive, { type: 'circuit-component' }>>): DiagramPoint[] {
  const endpoint = (terminal: CircuitTerminal): DiagramPoint => {
    const component = components.get(terminal.componentId)
    if (component === undefined || (wire.role === 'given' && component.role !== 'given')) fail('导线引用未知元件或学生不可见的解题元件')
    return paperCircuitTerminalPoint(component, terminal.terminal)
  }
  return [endpoint(wire.from), ...wire.via, endpoint(wire.to)]
}
const xml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const n = (value: number): string => String(Math.round(value * 1e6) / 1e6)

/** No raw model SVG, CSS, file/HTTP URLs, foreignObject, or images enter here. */
export function renderPaperDiagramSvg(input: PaperDiagramSpec, audience: 'student' | 'answer' = 'student'): string {
  const spec = parsePaperDiagram(input); const b = spec.viewBox; const flip = b.y * 2 + b.height
  const primitives = spec.primitives.filter((p) => audience === 'answer' || p.role === 'given')
  const components = new Map(spec.primitives.filter((p): p is Extract<PaperDiagramPrimitive, { type: 'circuit-component' }> => p.type === 'circuit-component').map((p) => [p.id, p]))
  const labels: string[] = []
  const label = (x: number, y: number, value: string, size = 12, align = 'center'): void => { labels.push(`<text x="${n(x)}" y="${n(flip - y)}" font-size="${n(size)}" text-anchor="${align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}" dominant-baseline="middle">${xml(value)}</text>`) }
  const line = (a: DiagramPoint, z: DiagramPoint, arrow = false): string => `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(z[0])}" y2="${n(z[1])}"${arrow ? ' marker-end="url(#paper-arrow)"' : ''}/>`
  const arc = (cx: number, cy: number, r: number, start: number, end: number): string => {
    if (Math.abs(Math.abs(end - start) - Math.PI * 2) < 1e-7) return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`
    return `<path d="M ${n(cx + r * Math.cos(start))} ${n(cy + r * Math.sin(start))} A ${n(r)} ${n(r)} 0 ${Math.abs(end - start) > Math.PI ? 1 : 0} ${end > start ? 1 : 0} ${n(cx + r * Math.cos(end))} ${n(cy + r * Math.sin(end))}"/>`
  }
  const shapes = primitives.map((p): string => {
    let shape = ''
    if (p.type === 'line' || p.type === 'arrow') shape = line(p.points[0], p.points[1], p.type === 'arrow')
    else if (p.type === 'polyline') shape = `<${p.closed === true ? 'polygon' : 'polyline'} points="${p.points.map((v) => `${n(v[0])},${n(v[1])}`).join(' ')}"/>`
    else if (p.type === 'rectangle') shape = `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}"/>`
    else if (p.type === 'ellipse') shape = `<ellipse cx="${n(p.x + p.width / 2)}" cy="${n(p.y + p.height / 2)}" rx="${n(p.width / 2)}" ry="${n(p.height / 2)}"/>`
    else if (p.type === 'circle') shape = `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.radius)}"/>`
    else if (p.type === 'arc') shape = arc(p.cx, p.cy, p.radius, p.startAngle, p.endAngle)
    else if (p.type === 'angle') { const a = angleRange(p.vertex, p.first, p.second); shape = arc(p.vertex[0], p.vertex[1], p.radius, a.start, a.end); if (p.label !== undefined) label(p.vertex[0] + (p.radius + 12) * Math.cos((a.start + a.end) / 2), p.vertex[1] + (p.radius + 12) * Math.sin((a.start + a.end) / 2), p.label) }
    else if (p.type === 'text') label(p.x, p.y, p.text, p.fontSize, p.textAlign)
    else if (p.type === 'circuit-wire') shape = `<polyline points="${circuitWirePoints(p, components).map((v) => `${n(v[0])},${n(v[1])}`).join(' ')}"/>`
    else if (p.type === 'junction') shape = `<circle cx="${n(p.at[0])}" cy="${n(p.at[1])}" r="${n(p.radius)}" fill="black"/>`
    else if (p.type === 'coordinate-axes') {
      shape = line(p.origin, [p.origin[0] + p.xLength, p.origin[1]], true) + line(p.origin, [p.origin[0], p.origin[1] + p.yLength], true)
      label(p.origin[0] + p.xLength, p.origin[1] - 18, p.xLabel); label(p.origin[0], p.origin[1] + p.yLength + 18, p.yLabel)
      for (const tick of p.ticks) {
        const at: DiagramPoint = tick.axis === 'x' ? [p.origin[0] + tick.offset, p.origin[1]] : [p.origin[0], p.origin[1] + tick.offset]
        shape += line(at, tick.axis === 'x' ? [at[0], at[1] + 4] : [at[0] + 4, at[1]])
        label(tick.axis === 'x' ? at[0] : at[0] - 18, tick.axis === 'y' ? at[1] : at[1] - 16, tick.label, 10)
      }
    } else if (p.type === 'circuit-component') {
      const s = p.size; const local = (a: DiagramPoint, b: DiagramPoint, arrow = false): string => line(a, b, arrow)
      if (p.symbol === 'resistor' || p.symbol === 'variable_resistor') {
        shape = local([-s * 0.75, 0], [-s * 0.5, 0]) + local([s * 0.5, 0], [s * 0.75, 0]) + `<rect x="${n(-s * 0.5)}" y="${n(-s * 0.18)}" width="${n(s)}" height="${n(s * 0.36)}"/>`
        if (p.symbol === 'variable_resistor') shape += local([0, s * 0.65], [0, s * 0.21], true)
      } else if (p.symbol === 'voltage_source') {
        shape = local([-s * 0.75, 0], [-s * 0.12, 0]) + local([s * 0.12, 0], [s * 0.75, 0]) + local([-s * 0.12, -s * 0.15], [-s * 0.12, s * 0.15]) + local([s * 0.12, -s * 0.34], [s * 0.12, s * 0.34])
      } else if (p.symbol === 'switch') {
        shape = local([-s * 0.75, 0], [-s * 0.35, 0]) + local([s * 0.35, 0], [s * 0.75, 0]) + local([-s * 0.35, 0], [s * 0.35, p.closed === true ? 0 : s * 0.3]) + `<circle cx="${n(-s * 0.35)}" cy="0" r="1.5" fill="black"/><circle cx="${n(s * 0.35)}" cy="0" r="1.5" fill="black"/>`
      } else {
        shape = local([-s * 0.75, 0], [-s * 0.35, 0]) + local([s * 0.35, 0], [s * 0.75, 0]) + `<circle cx="0" cy="0" r="${n(s * 0.35)}"/>`
        label(p.at[0], p.at[1], p.symbol === 'ammeter' ? 'A' : 'V', 14)
      }
      shape = `<g transform="translate(${n(p.at[0])} ${n(p.at[1])}) rotate(${p.rotation})">${shape}</g>`
      if (p.label !== undefined) label(p.at[0], p.at[1] - s * 0.9, p.label)
    }
    return `<g data-primitive-id="${p.id}"${'dashed' in p && p.dashed === true ? ' stroke-dasharray="5 4"' : ''}>${shape}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(b.width)}" height="${n(b.height)}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)}"><defs><marker id="paper-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 7 3.5 L 0 7 Z" fill="black"/></marker></defs><rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" fill="white"/><g transform="translate(0 ${n(flip)}) scale(1 -1)" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes.join('')}</g><g fill="black" font-family="Noto Serif CJK SC,Songti SC,SimSun,serif">${labels.join('')}</g></svg>`
}

/** The neutral label cannot reveal the legacy drawing instruction or answer. */
export function studentFigureCaption(question: PaperQuestion): string {
  if (question.figure === undefined) return ''
  const figure = parsePaperFigure(question.figure)
  return `图 ${question.number}${figure.studentCaption === undefined ? '' : ` · ${figure.studentCaption}`}${figure.diagram?.scale === 'schematic' ? '（示意图，非比例绘制）' : ''}`
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
/** Node-side cache identity; UI consumes the server-returned filename, not crypto. */
export function paperFigureInputHash(question: PaperQuestion): string {
  if (question.figure === undefined) fail('题目没有 figure')
  return createHash('sha256').update(canonical({ renderer: PAPER_DIAGRAM_RENDERER_VERSION, number: question.number, subject: question.subject, kind: question.kind, stem: question.stem, options: question.options, subQuestions: question.subQuestions, figure: parsePaperFigure(question.figure) }), 'utf8').digest('hex')
}
export const paperFigureFileName = (question: PaperQuestion): string => `fig-${paperFigureInputHash(question)}.png`

/** One schema shared by drafting and durable host validation. */
export function paperDiagramJsonSchema(): Record<string, unknown> {
  const number = { type: 'number' }; const point = { type: 'array', items: number, minItems: 2, maxItems: 2 }
  const string = { type: 'string', minLength: 1, maxLength: PAPER_DIAGRAM_LIMITS.text }
  const primitive = (type: string, fields: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, required: ['id', 'role', 'type', ...required], properties: { id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' }, role: { enum: ['given', 'solution'] }, type: { const: type }, ...fields } })
  const terminal = { type: 'object', additionalProperties: false, required: ['componentId', 'terminal'], properties: { componentId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' }, terminal: { enum: ['a', 'b'] } } }
  const radius = { type: 'number', minimum: 1, maximum: PAPER_DIAGRAM_LIMITS.dimension }
  return { type: 'object', additionalProperties: false, required: ['schemaVersion', 'viewBox', 'scale', 'primitives'], properties: {
    schemaVersion: { const: 1 }, scale: { enum: ['schematic', 'metric'] }, viewBox: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: { x: number, y: number, width: { type: 'number', minimum: 24, maximum: PAPER_DIAGRAM_LIMITS.dimension }, height: { type: 'number', minimum: 24, maximum: PAPER_DIAGRAM_LIMITS.dimension } } },
    primitives: { type: 'array', minItems: 1, maxItems: PAPER_DIAGRAM_LIMITS.primitives, items: { oneOf: [
      ...['line', 'arrow'].map((type) => primitive(type, { points: { type: 'array', items: point, minItems: 2, maxItems: 2 }, dashed: { type: 'boolean' } }, ['points'])),
      primitive('polyline', { points: { type: 'array', items: point, minItems: 2, maxItems: PAPER_DIAGRAM_LIMITS.points }, closed: { type: 'boolean' }, dashed: { type: 'boolean' } }, ['points']),
      ...['rectangle', 'ellipse'].map((type) => primitive(type, { x: number, y: number, width: radius, height: radius }, ['x', 'y', 'width', 'height'])),
      primitive('circle', { cx: number, cy: number, radius }, ['cx', 'cy', 'radius']),
      primitive('arc', { cx: number, cy: number, radius, startAngle: number, endAngle: number, dashed: { type: 'boolean' } }, ['cx', 'cy', 'radius', 'startAngle', 'endAngle']),
      primitive('angle', { vertex: point, first: point, second: point, radius, label: string }, ['vertex', 'first', 'second', 'radius']),
      primitive('text', { x: number, y: number, text: string, fontSize: { type: 'number', minimum: 8, maximum: 32 }, textAlign: { enum: ['left', 'center', 'right'] } }, ['x', 'y', 'text', 'fontSize']),
      primitive('circuit-component', { symbol: { enum: ['resistor', 'voltage_source', 'switch', 'ammeter', 'voltmeter', 'variable_resistor'] }, at: point, size: { type: 'number', minimum: 16, maximum: 120 }, rotation: { enum: [0, 90, 180, 270] }, label: { type: 'string', minLength: 1, maxLength: 24 }, closed: { type: 'boolean' } }, ['symbol', 'at', 'size', 'rotation']),
      primitive('circuit-wire', { from: terminal, to: terminal, via: { type: 'array', items: point, minItems: 0, maxItems: 32 } }, ['from', 'to', 'via']),
      primitive('junction', { at: point, radius: { type: 'number', minimum: 1, maximum: 4 } }, ['at', 'radius']),
      primitive('coordinate-axes', { origin: point, xLength: radius, yLength: radius, xLabel: { type: 'string', minLength: 1, maxLength: 16 }, yLabel: { type: 'string', minLength: 1, maxLength: 16 }, ticks: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['axis', 'offset', 'label'], properties: { axis: { enum: ['x', 'y'] }, offset: { type: 'number', minimum: 0 }, label: { type: 'string', minLength: 1, maxLength: 16 } } } } }, ['origin', 'xLength', 'yLength', 'xLabel', 'yLabel', 'ticks']),
    ] } },
  } }
}
export function paperFigureJsonSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['kind', 'ref'], properties: { kind: { enum: ['line-diagram', 'image'] }, ref: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^/\\\\\\u0000-\\u001f]+$' }, caption: { type: 'string', minLength: 1, maxLength: 6000 }, studentCaption: { enum: [...CAPTIONS] }, diagram: paperDiagramJsonSchema(), sourceAsset: { type: 'object', additionalProperties: false, required: ['id', 'sha256', 'mediaType'], properties: { id: { type: 'string', minLength: 1, maxLength: 128 }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, mediaType: { enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] } } } } }
}
