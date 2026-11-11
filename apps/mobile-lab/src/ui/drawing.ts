import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { ScenePoint, VectorVisual } from '@lab/physics/scene-visual-model.ts'
import type { RendererProjection } from '@lab/physics/renderer-registry.tsx'
import { estimateLabelWidth, layoutVectorLabels } from '@lab/physics/vector-label-layout.ts'
import primitiveCss from '@lab/physics/primitives.module.css'
import rendererCss from '@lab/physics/renderers.module.css'

const roleToken = (role: string): string => ({
  velocity: 'velocity', 'velocity-component': 'velocity-soft', force: 'force', gravity: 'gravity', normal: 'normal', friction: 'friction',
  'net-force': 'net-force', acceleration: 'acceleration', 'electric-force': 'electric-force', 'magnetic-force': 'magnetic-force', spring: 'spring', tension: 'tension',
}[role] ?? 'force')
const at = (p: RendererProjection, point: ScenePoint): ScenePoint => ({ x: p.px(point), y: p.py(point) })
const numeric = (node: Element | undefined | null, key: string, value: number): void => {
  if (node === undefined || node === null || !Number.isFinite(value)) return
  const serialized = String(value)
  if (node.getAttribute(key) !== serialized) node.setAttribute(key, serialized)
}
const attribute = (node: Element | undefined | null, key: string, value: string): void => {
  if (node !== undefined && node !== null && node.getAttribute(key) !== value) node.setAttribute(key, value)
}

/** Binds moving attributes once. Static apparatus keeps the shared renderer's geometry and hit targets. */
export class RetainedDrawing {
  private readonly bodies = new Map<string, SVGGElement>()
  private readonly particles = new Map<string, SVGGElement>()
  private readonly apparatus = new Map<string, SVGGElement>()
  private readonly components = new Map<string, Element[]>()
  private readonly classes = new Map<string, Element[]>()
  private readonly ink: Record<string, string> = {}
  private readonly ctx: CanvasRenderingContext2D
  constructor(private readonly svg: SVGSVGElement, private readonly canvas: HTMLCanvasElement,
    private readonly baseline: WorkspaceFrame, private readonly p: RendererProjection, private readonly width: number, private readonly height: number) {
    const context = canvas.getContext('2d', { alpha: true })
    if (context === null) throw new Error('设备无法创建 Canvas 2D 绘制上下文。')
    this.ctx = context
    for (const element of svg.querySelectorAll<SVGGElement>('[data-live-body]')) this.bodies.set(element.dataset.liveBody!, element)
    for (const element of svg.querySelectorAll<SVGGElement>('[data-live-particle]')) this.particles.set(element.dataset.liveParticle!, element)
    for (const element of svg.querySelectorAll<SVGGElement>('[data-live-apparatus]')) this.apparatus.set(element.dataset.liveApparatus!, element)
    for (const element of svg.querySelectorAll('[data-component-id], [data-terminal-hit]')) {
      const id = element.getAttribute('data-component-id') ?? element.getAttribute('data-terminal-component')!
      this.components.set(id, [...(this.components.get(id) ?? []), element])
    }
    for (const name of [...Object.values(primitiveCss), ...Object.values(rendererCss)]) {
      if (!name || name.includes(' ')) continue
      this.classes.set(name, [...svg.getElementsByClassName(name)])
    }
    const style = getComputedStyle(svg)
    for (const token of ['canvas-text', 'canvas-text-muted', 'canvas-bg', 'trajectory', 'trajectory-predicted', 'wave-rope', 'wave-front', 'wave-marker', 'wave-equilibrium', 'acoustics-wave', 'acoustics-wave-soft', 'induction-rod', 'induction-current', 'current-flow',
      ...['velocity', 'velocity-soft', 'force', 'gravity', 'normal', 'friction', 'net-force', 'acceleration', 'electric-force', 'magnetic-force', 'spring', 'tension'].map(role => `vector-${role}`)]) {
      this.ink[token] = style.getPropertyValue(`--physics-${token}`).trim()
    }
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1))
    canvas.width = Math.min(4096, Math.ceil(width * dpr))
    canvas.height = Math.min(4096, Math.ceil(height * dpr))
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
  }
  private nodes(cssName: string | undefined): Element[] { return cssName === undefined ? [] : this.classes.get(cssName) ?? [] }
  private move(node: Element | undefined, current: ScenePoint, before: ScenePoint): void {
    attribute(node, 'transform', `translate(${this.p.px(current) - this.p.px(before)} ${this.p.py(current) - this.p.py(before)})`)
  }
  draw(frame: WorkspaceFrame): void {
    const { view } = frame
    const before = this.baseline.view
    for (const body of view.bodies) {
      const baseline = before.bodies.find(item => item.id === body.id)
      if (baseline !== undefined) this.move(this.bodies.get(body.id), body.at, baseline.at)
    }
    for (const particle of view.particles) {
      const baseline = before.particles.find(item => item.id === particle.id)
      if (baseline !== undefined) this.move(this.particles.get(particle.id), particle.at, baseline.at)
    }
    for (const item of view.apparatus ?? []) {
      const baseline = before.apparatus?.find(entry => entry.id === item.id)
      if (baseline !== undefined) this.move(this.apparatus.get(item.id), item.at, baseline.at)
    }
    for (const component of view.circuitComponents ?? []) {
      const baseline = before.circuitComponents?.find(item => item.id === component.id)
      if (baseline !== undefined) for (const node of this.components.get(component.id) ?? []) this.move(node, component.at, baseline.at)
    }
    for (const className of [rendererCss.circuitWire, rendererCss.circuitWireSheen]) {
      this.nodes(className).forEach((node, index) => { const wire = view.circuitWires?.[index]; if (wire !== undefined) attribute(node, 'd', this.p.path(wire.points)) })
    }
    if (view.pendulum !== undefined) {
      const string = this.nodes(primitiveCss.pendulumString)[0]
      numeric(string, 'x1', this.p.px(view.pendulum.pivot)); numeric(string, 'y1', this.p.py(view.pendulum.pivot))
      numeric(string, 'x2', this.p.px(view.pendulum.bob)); numeric(string, 'y2', this.p.py(view.pendulum.bob))
    }
    if (view.spring !== undefined) this.spring(view.spring)
    this.fluid(frame)
    this.thermal(frame)
    this.energy(frame)
    const ctx = this.ctx
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.font = '12px system-ui, sans-serif'
    if (view.domain !== 'modern' && view.visible.trajectory === true) for (const path of view.trajectories) {
      this.path(path.points, path.kind === 'history' ? 'trajectory' : 'trajectory-predicted', path.kind === 'history' ? [] : [5, 4])
      if (path.kind === 'history' && path.points.length) this.dot(path.points.at(-1)!, 4, 'trajectory')
    }
    if (view.waveProfile !== undefined && view.visible.waveform !== false) {
      this.path(view.waveProfile.points, 'wave-rope')
      const points = view.waveProfile.points
      const step = Math.max(1, Math.floor(points.length / 24))
      for (let index = 0; index < points.length; index += step) this.dot(points[index]!, 3, 'wave-rope')
    }
    for (const front of view.waveFronts ?? []) this.circle(front.center, front.radius * this.p.scale, 'wave-front')
    if (view.waveMarker !== undefined && view.visible.waveform !== false) {
      this.dot(view.waveMarker.at, 4.6, 'wave-marker')
      this.label(view.waveMarker.label, this.p.px(view.waveMarker.at) + 9, this.p.py(view.waveMarker.at) - 8)
    }
    for (const front of view.acousticWavefronts ?? []) {
      ctx.strokeStyle = this.ink['acoustics-wave-soft']!; ctx.lineWidth = 2; ctx.beginPath()
      const angle = front.direction === 'forward' ? 0 : Math.PI
      ctx.arc(this.p.px(front.at), this.p.py(front.at), Math.max(0, front.radius * this.p.scale), angle - Math.PI / 3, angle + Math.PI / 3); ctx.stroke()
    }
    if (view.acousticPulse !== undefined) this.dot(view.acousticPulse.at, 5, 'acoustics-wave')
    const vectors = view.vectors.filter(vector => view.domain === 'wave' ? view.visible[vector.observable] !== false : view.visible[vector.observable] === true || view.visible.forces === true)
    this.vectors(vectors)
    if (view.inductionBar !== undefined && view.visible.barMotion === true) {
      const bar = view.inductionBar
      this.path([{ x: bar.at.x, y: bar.at.y - bar.length / 2 }, { x: bar.at.x, y: bar.at.y + bar.length / 2 }], 'induction-rod', [], 5)
      const y = this.p.py({ x: 0, y: bar.at.y + bar.length / 2 })
      this.arrow({ x: this.p.px(bar.at) + 6, y: y - 12 }, { x: this.p.px(bar.at) + 6 + bar.direction * 34, y: y - 12 }, 'vector-velocity')
      this.label(bar.label, this.p.px(bar.at) + 10, y - 26)
    }
    for (const bar of view.inductionPairBars ?? []) {
      this.path([{ x: bar.at.x, y: bar.at.y - bar.length / 2 }, { x: bar.at.x, y: bar.at.y + bar.length / 2 }], 'induction-rod', [], 5)
      this.label(bar.label, this.p.px(bar.at) + 10, this.p.py({ x: 0, y: bar.at.y + bar.length / 2 }) - 4)
    }
    for (const force of view.inductionForceArrows ?? []) this.arrow(at(this.p, force.at), at(this.p, { x: force.at.x + force.direction * force.length, y: force.at.y }), 'vector-force')
    for (const flow of view.chargeFlows ?? []) {
      if (Math.abs(flow.current) < 1e-12 || (view.domain === 'circuit' && view.visible.current === false)) continue
      const circuit = view.domain === 'circuit'
      const spacing = circuit ? 14 : 22
      const speed = Math.min(circuit ? 90 : 70, Math.max(8, Math.abs(flow.current) * (circuit ? 110 : 42)))
      ctx.strokeStyle = this.ink[circuit ? 'current-flow' : 'induction-current']!; ctx.lineWidth = 3
      ctx.setLineDash([1, spacing - 1]); ctx.lineDashOffset = -Math.sign(flow.current) * frame.clock.time * speed
      ctx.beginPath(); flow.path.forEach((point, index) => { const x = this.p.px(point), y = this.p.py(point); if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y) }); ctx.stroke()
      ctx.setLineDash([]); ctx.lineDashOffset = 0
    }
  }
  private path(points: readonly ScenePoint[], token: string, dash: number[] = [], width = 2): void {
    const ctx = this.ctx; ctx.beginPath(); ctx.strokeStyle = this.ink[token]!; ctx.lineWidth = width; ctx.setLineDash(dash)
    let started = false
    for (const point of points) {
      const x = this.p.px(point), y = this.p.py(point)
      if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue }
      if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y)
      started = true
    }
    ctx.stroke(); ctx.setLineDash([])
  }
  private label(text: string, x: number, y: number): void { this.ctx.fillStyle = this.ink['canvas-text']!; this.ctx.fillText(text, x, y) }
  private dot(point: ScenePoint, radius: number, token: string): void {
    const ctx = this.ctx; ctx.beginPath(); ctx.arc(this.p.px(point), this.p.py(point), radius, 0, Math.PI * 2)
    ctx.fillStyle = this.ink[token]!; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = this.ink['canvas-bg']!; ctx.stroke()
  }
  private circle(point: ScenePoint, radius: number, token: string): void {
    if (radius <= 0 || !Number.isFinite(radius)) return
    const ctx = this.ctx; ctx.beginPath(); ctx.arc(this.p.px(point), this.p.py(point), radius, 0, Math.PI * 2)
    ctx.strokeStyle = this.ink[token]!; ctx.lineWidth = 1.5; ctx.stroke()
  }
  private arrow(from: ScenePoint, to: ScenePoint, token: string): void {
    const ctx = this.ctx; const angle = Math.atan2(to.y - from.y, to.x - from.x)
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.25) return
    ctx.strokeStyle = this.ink[token]!; ctx.fillStyle = this.ink[token]!; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - 7 * Math.cos(angle - 0.4), to.y - 7 * Math.sin(angle - 0.4)); ctx.lineTo(to.x - 7 * Math.cos(angle + 0.4), to.y - 7 * Math.sin(angle + 0.4)); ctx.closePath(); ctx.fill()
  }
  private vectors(vectors: readonly VectorVisual[]): void {
    const positions = layoutVectorLabels(vectors.map(vector => {
      const from = at(this.p, vector.from), to = at(this.p, vector.to)
      return { id: vector.id, x: to.x, y: to.y, width: estimateLabelWidth(vector.symbol, 12), height: 12,
        dirX: to.x - from.x, dirY: to.y - from.y, anchor: vector.labelHint === 'start' ? 'end' as const : to.x >= from.x ? 'start' as const : 'end' as const }
    }))
    vectors.forEach((vector, index) => {
      this.arrow(at(this.p, vector.from), at(this.p, vector.to), `vector-${roleToken(vector.role)}`)
      const label = positions[index]
      if (label !== undefined) { this.ctx.textAlign = label.anchor === 'end' ? 'right' : 'left'; this.label(vector.symbol, label.x, label.y); this.ctx.textAlign = 'left' }
    })
  }
  private spring(spring: NonNullable<WorkspaceFrame['view']['spring']>): void {
    const a = at(this.p, spring.anchor), b = at(this.p, spring.end)
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (length < 8) return
    const ux = dx / length, uy = dy / length, nx = -uy, ny = ux
    const amp = Math.min(11, Math.max(5, length * 0.09)), lead = Math.min(14, length * 0.12), coils = Math.max(4, Math.min(11, Math.floor(length / 26)))
    const halfPitch = (length - 2 * lead) / (coils * 2)
    const point = (t: number, offset: number): string => `${a.x + ux * t + nx * offset} ${a.y + uy * t + ny * offset}`
    const winding = (phase: number, amplitude: number): string => Array.from({ length: coils * 2 }, (_, index) => {
      const i = index + 1; return `Q${point(lead + halfPitch * (i - 0.5), (i % 2 ? 1 : -1) * phase * amplitude * 2)} ${point(lead + halfPitch * i, 0)}`
    }).join(' ')
    attribute(this.nodes(primitiveCss.springCoil)[0], 'd', `M${a.x} ${a.y} L${point(lead, 0)} ${winding(1, amp)} L${point(length - lead, 0)} L${b.x} ${b.y}`)
    attribute(this.nodes(primitiveCss.springCoilBack)[0], 'd', `M${point(lead, 0)} ${winding(-1, amp * 0.92)} L${point(length - lead, 0)}`)
    const joint = this.svg.querySelector('[data-testid="spring-coil"] circle:last-of-type')
    numeric(joint, 'cx', b.x); numeric(joint, 'cy', b.y)
  }
  private fluid(frame: WorkspaceFrame): void {
    const block = frame.view.fluidBlock
    if (block === undefined) return
    const x = this.p.px({ x: block.at.x - block.halfWidth, y: 0 })
    const top = this.p.py({ x: 0, y: block.at.y + block.halfHeight }), bottom = this.p.py({ x: 0, y: block.at.y - block.halfHeight })
    const body = this.nodes(rendererCss.fluidBlockBody)[0]
    numeric(body, 'x', x); numeric(body, 'y', top)
    const label = body?.parentElement?.querySelector('text')
    numeric(label, 'x', x - 8); numeric(label, 'y', this.p.py(block.at))
    const submerged = this.nodes(rendererCss.fluidBlockSubmerged)[0]
    const waterTop = this.p.py({ x: 0, y: block.submergedTop })
    numeric(submerged, 'x', x); numeric(submerged, 'y', waterTop); numeric(submerged, 'height', Math.max(0, bottom - waterTop))
    const wire = this.nodes(rendererCss.fluidWire)[0]
    numeric(wire, 'x2', this.p.px(block.at)); numeric(wire, 'y2', top)
  }
  private thermal(frame: WorkspaceFrame): void {
    const thermometers = [frame.view.thermalThermometer, frame.view.thermalComparisonThermometer].filter(item => item !== undefined)
    thermometers.forEach((thermometer, index) => {
      const y = this.p.py({ x: 0, y: thermometer.at.y + thermometer.columnHeight })
      numeric(this.nodes(rendererCss.thermalColumn)[index], 'y2', y)
      const text = this.nodes(rendererCss.thermalReading)[index]
      numeric(text, 'y', y + 4)
      if (text !== undefined && text.textContent !== thermometer.reading) text.textContent = thermometer.reading
    })
    const samples = [frame.view.thermalSample, frame.view.thermalComparisonSample].filter(item => item !== undefined)
    samples.forEach((sample, index) => {
      const y = this.p.py({ x: 0, y: sample.at.y - sample.halfHeight + 2 * sample.halfHeight * sample.meltedFraction })
      const bottom = this.p.py({ x: 0, y: sample.at.y - sample.halfHeight })
      numeric(this.nodes(rendererCss.thermalSampleLiquid)[index], 'y', y); numeric(this.nodes(rendererCss.thermalSampleLiquid)[index], 'height', Math.max(0, bottom - y))
      numeric(this.nodes(rendererCss.thermalSurface)[index], 'y1', y); numeric(this.nodes(rendererCss.thermalSurface)[index], 'y2', y)
    })
  }
  private energy(frame: WorkspaceFrame): void {
    const ramp = frame.view.energyRamp
    if (ramp === undefined) return
    const node = this.svg.querySelector('[data-testid="energy-cart"]')
    const slope = Math.atan2(ramp.peak.y - ramp.base.y, ramp.peak.x - ramp.base.x), length = Math.hypot(ramp.peak.x - ramp.base.x, ramp.peak.y - ramp.base.y)
    const tx = Math.cos(slope), ty = Math.sin(slope), drawnLength = Math.min(ramp.cartLength, length)
    const half = ramp.cartHalfHeight * drawnLength / ramp.cartLength
    const position = frame.view.bodies.find(body => body.id === 'energy-cart')?.at ?? ramp.peak
    const along = Math.min(length - drawnLength / 2, Math.max(drawnLength / 2, (position.x - ramp.base.x) * tx + (position.y - ramp.base.y) * ty))
    const center = { x: ramp.base.x + tx * along - ty * half, y: ramp.base.y + ty * along + tx * half }
    const x = this.p.px(center), y = this.p.py(center)
    numeric(node, 'x', x - drawnLength * this.p.scale / 2); numeric(node, 'y', y - half * this.p.scale)
    attribute(node, 'transform', `rotate(${-slope * 180 / Math.PI} ${x} ${y})`)
  }
}
