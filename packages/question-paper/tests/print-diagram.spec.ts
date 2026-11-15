import { describe, expect, it } from 'vitest'
import { paperCircuitTerminalPoint, paperFigureFileName, paperFigureInputHash, paperFigureJsonSchema, parsePaperDiagram, parsePaperFigure, renderPaperDiagramSvg, studentFigureCaption } from '../src/print-diagram.ts'
import type { DiagramPaperFigure, PaperDiagramSpec } from '../src/print-diagram.ts'
import type { PaperQuestion } from '../src/paper.ts'

const diagram: PaperDiagramSpec = { schemaVersion: 1, viewBox: { x: 0, y: 0, width: 300, height: 200 }, scale: 'metric', primitives: [
  { id: 'circle', role: 'given', type: 'circle', cx: 120, cy: 100, radius: 50 },
  { id: 'radius', role: 'given', type: 'line', points: [[120, 100], [170, 100]] },
  { id: 'center', role: 'given', type: 'text', x: 105, y: 85, text: 'O', fontSize: 12 },
  { id: 'solution-force', role: 'solution', type: 'arrow', points: [[120, 100], [120, 165]] },
  { id: 'solution-label', role: 'solution', type: 'text', x: 150, y: 150, text: 'N=mg', fontSize: 12 },
] }
const question = (figure: DiagramPaperFigure = { kind: 'line-diagram', ref: 'same-ref', caption: '内部指令：画出向上的支持力 N，答案方向向上', studentCaption: '几何示意图', diagram }): PaperQuestion => ({ number: 1, subject: 'physics', kind: 'drawing', score: 3, stem: '如图，圆心为 O。请作图。', figure, knowledge: ['几何'], ability: '应用', difficulty: 'basic', status: 'draft' })
const mutate = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

describe('deterministic paper diagram spec', () => {
  it('renders a true circle and radius deterministically, with solution marks invisible to students', () => {
    const student = renderPaperDiagramSvg(diagram)
    expect(student).toBe(renderPaperDiagramSvg(parsePaperDiagram(diagram)))
    expect(student).toContain('<circle cx="120" cy="100" r="50"/>')
    expect(student).toContain('x1="120" y1="100" x2="170" y2="100"')
    expect(student).not.toContain('solution-force')
    expect(student).not.toContain('N=mg')
    expect(renderPaperDiagramSvg(diagram, 'answer')).toContain('solution-force')
    expect(renderPaperDiagramSvg(diagram, 'answer')).toContain('N=mg')
    expect(student).not.toMatch(/<image|foreignObject|<script|href=/)
  })

  it('enforces actual angle geometry, bounded arcs, explicit roles and no unsupported SVG input', () => {
    const rightAngle: PaperDiagramSpec = { ...diagram, primitives: [{ id: 'angle', role: 'given', type: 'angle', vertex: [100, 60], first: [180, 60], second: [100, 140], radius: 24, label: '90°' }] }
    expect(renderPaperDiagramSvg(rightAngle)).toContain('90°')
    expect(() => parsePaperDiagram({ ...rightAngle, primitives: [{ ...rightAngle.primitives[0]!, label: '30°' }] })).toThrow('夹角不符')
    expect(() => parsePaperDiagram({ ...diagram, primitives: [{ id: 'arc', role: 'given', type: 'arc', cx: 100, cy: 100, radius: 40, startAngle: 0, endAngle: Math.PI * 3 }] })).toThrow('角域')
    expect(() => parsePaperDiagram({ ...diagram, primitives: [{ id: 'line', type: 'line', points: [[20, 20], [30, 30]] }] })).toThrow('given 或 solution')
    expect(() => parsePaperDiagram({ ...diagram, primitives: [{ id: 'image', role: 'given', type: 'image', href: 'file:///secret' }] })).toThrow('不支持')
    expect(() => parsePaperDiagram({ ...diagram, primitives: [{ id: 'line', role: 'given', type: 'line', points: [[10, 10], [400, 40]] }] })).toThrow('超出 viewBox')
    expect(() => parsePaperDiagram({ ...diagram, primitives: [{ id: 'line', role: 'given', type: 'line', points: [[10, 10], [10, 10]] }] })).toThrow('零长度')
    expect(() => parsePaperDiagram({ ...diagram, primitives: diagram.primitives.map((p) => ({ ...p, role: 'solution' })) })).toThrow('没有实际已知图形')
  })

  it('uses standard circuit terminals and orthogonal wires without inferred topology or readings', () => {
    const components: PaperDiagramSpec['primitives'] = [
      { id: 'R1', type: 'circuit-component', role: 'given', symbol: 'resistor', at: [100, 100], rotation: 0, size: 24, label: 'R₁' },
      { id: 'R2', type: 'circuit-component', role: 'given', symbol: 'resistor', at: [200, 100], rotation: 0, size: 24, label: 'R₂' },
    ]
    const circuit: PaperDiagramSpec = { ...diagram, scale: 'schematic', primitives: [...components, { id: 'wire', role: 'given', type: 'circuit-wire', from: { componentId: 'R1', terminal: 'b' }, to: { componentId: 'R2', terminal: 'a' }, via: [] }] }
    expect(renderPaperDiagramSvg(circuit)).toContain('points="118,100 182,100"')
    expect(renderPaperDiagramSvg(circuit)).not.toMatch(/reading|current|computed/)
    const rotated = { ...components[0]!, type: 'circuit-component' as const, at: [100, 100] as const, symbol: 'resistor' as const, role: 'given' as const, rotation: 90 as const, size: 24 }
    expect(paperCircuitTerminalPoint(rotated, 'b')[0]).toBeCloseTo(100)
    expect(paperCircuitTerminalPoint(rotated, 'b')[1]).toBeCloseTo(118)
    expect(() => parsePaperDiagram({ ...circuit, primitives: [...components, { id: 'wire', role: 'given', type: 'circuit-wire', from: { componentId: 'R1', terminal: 'b' }, to: { componentId: 'absent', terminal: 'a' }, via: [] }] })).toThrow('未知元件')
    expect(() => parsePaperDiagram({ ...circuit, primitives: [...components.map((p) => p.id === 'R2' ? { ...p, at: [200, 130] } : p), circuit.primitives[2]] })).toThrow('横平竖直')
    expect(() => parsePaperDiagram({ ...circuit, primitives: [{ ...components[0]!, reading: 4 }] })).toThrow('不支持属性 reading')
  })

  it('retains known coordinate tick data with black ink and explicit axes, not a generated data plot', () => {
    const spec: PaperDiagramSpec = { ...diagram, scale: 'schematic', primitives: [
      { id: 'axes', role: 'given', type: 'coordinate-axes', origin: [55, 40], xLength: 180, yLength: 110, xLabel: 't/s', yLabel: 'v/(m/s)', ticks: [{ axis: 'x', offset: 60, label: '2' }, { axis: 'y', offset: 40, label: '4' }] },
      { id: 'known-curve', role: 'given', type: 'polyline', points: [[55, 40], [115, 80], [175, 80]] },
    ] }
    const svg = renderPaperDiagramSvg(spec)
    expect(svg).toContain('t/s')
    expect(svg).toContain('v/(m/s)')
    expect(svg).toContain('>2</text>')
    expect(svg).toContain('stroke="black"')
    expect(svg).not.toContain('linearGradient')
  })
})

describe('student-safe labels and cache content identity', () => {
  it('never reuses an internal caption as a student-facing diagram label', () => {
    expect(studentFigureCaption(question())).toBe('图 1 · 几何示意图')
    expect(studentFigureCaption(question({ kind: 'line-diagram', ref: 'legacy', caption: '内部指令：箭头向上，选项 B 正确' }))).toBe('图 1')
    expect(() => parsePaperFigure({ kind: 'line-diagram', ref: 'f', diagram, studentCaption: '支持力方向向上' })).toThrow('中性图名')
    expect(() => parsePaperFigure({ kind: 'image', ref: 'f', sourceAsset: { id: 'https://internal/', sha256: 'a'.repeat(64), mediaType: 'image/png' } })).toThrow('标识')
  })

  it('changes the input hash for same-ref diagram/caption/stem changes but not review metadata', () => {
    const original = question()
    const a = paperFigureInputHash(original)
    expect(paperFigureFileName(original)).toBe(`fig-${a}.png`)
    expect(paperFigureInputHash({ ...original, status: 'approved', reviewNote: '审核通过' })).toBe(a)
    expect(paperFigureInputHash({ ...original, stem: `${original.stem} 改变条件` })).not.toBe(a)
    expect(paperFigureInputHash(question({ ...original.figure!, caption: '另一内部作图指令', diagram }))).not.toBe(a)
    const edited = mutate(diagram)
    const primitives = edited.primitives as Record<string, unknown>[]
    primitives[0]!.radius = 49
    expect(paperFigureInputHash(question({ kind: 'line-diagram', ref: 'same-ref', diagram: edited as unknown as PaperDiagramSpec }))).not.toBe(a)
    expect(paperFigureJsonSchema()).toHaveProperty('properties.diagram')
  })
})
