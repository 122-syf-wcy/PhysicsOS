import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RENDERERS, type ComponentDragChannel, type ComponentControlChannel, type ComponentWiringChannel } from '@lab/physics/renderer-registry.tsx'
import { Apparatus, ArrowMarkers, Body, PendulumRig, SpringCoil } from '@lab/physics/primitives.tsx'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { ScenePoint } from '@lab/physics/scene-visual-model.ts'
import { svgPointFromClient } from '@lab/physics/svg-screen-point.ts'
import type { LabClient } from '../runtime/client.ts'
import type { WireSummary } from '../runtime/transport.ts'
import { RetainedDrawing } from './drawing.ts'
import { PLOT_PADDING, projectScene, staticView } from './projection.ts'

interface Props { client: LabClient; frame: WorkspaceFrame; summary: WireSummary; dark: boolean }
export const SceneStage = memo(function SceneStage({ client, frame, summary, dark }: Props) {
  const uid = useId().replace(/:/g, '')
  const host = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const raster = useRef<HTMLCanvasElement>(null)
  const layers = useRef<HTMLDivElement>(null)
  const latest = useRef({ frame, summary })
  latest.current = { frame, summary }
  const [size, setSize] = useState({ width: 640, height: 400 })
  const [readout, setReadout] = useState<readonly { label: string; value: string }[]>([])
  const [pinnedTime, setPinnedTime] = useState<number | undefined>()
  const [panTool, setPanTool] = useState(false)
  const gesture = useRef<{ points: Map<number, { x: number; y: number }>; initial: { x: number; y: number; zoom: number }; start: { x: number; y: number }; distance: number; moved: boolean }>({ points: new Map(), initial: { x: 0, y: 0, zoom: 1 }, start: { x: 0, y: 0 }, distance: 0, moved: false })
  const viewport = useRef(client.getSnapshot().presentation.viewport)
  const projection = useMemo(() => projectScene(frame.view, size.width, size.height, uid), [frame.view.extent.width, frame.view.extent.height, frame.view.origin.x, frame.view.origin.y, frame.view.highlighted, size, uid])
  const staticModel = useMemo(() => staticView(frame.view), [frame.view])
  const Renderer = RENDERERS[frame.domain]
  client.metrics.count('staticSceneRenders')
  const act = useCallback((name: string, ...args: unknown[]): void => {
    // The public action method validates this data in the Worker before dispatch.
    void (client.action as (name: string, ...args: unknown[]) => Promise<void>)(name, ...args).catch(() => undefined)
  }, [client])
  const drag = useMemo<ComponentDragChannel | undefined>(() => summary.capabilities.componentPlacement ? {
    preview: (id, point) => act('previewComponentPlacement', id, point), commit: (id, point) => act('commitComponentPlacement', id, point),
    cancel: () => act('cancelComponentPlacement'), nudge: (id, delta) => act('nudgeComponentPlacement', id, delta),
  } : undefined, [summary.capabilities.componentPlacement, act])
  const controls = useMemo<ComponentControlChannel | undefined>(() => summary.capabilities.switch || summary.capabilities.slider ? {
    setSwitch: (id, state) => act('setSwitchState', id, state), previewSlider: (id, value) => act('previewSliderPosition', id, value),
    commitSlider: (id, value) => act('commitSliderPosition', id, value), cancelSlider: () => act('cancelSliderPosition'),
  } : undefined, [summary.capabilities.switch, summary.capabilities.slider, act])
  const wiring: ComponentWiringChannel | undefined = summary.buildMode !== 'construct' ? undefined : {
    start: ref => act(summary.pendingWire === undefined ? 'beginWire' : 'completeWire', ref), complete: ref => act('completeWire', ref), cancel: () => act('cancelWire'), pending: summary.pendingWire,
  }
  useEffect(() => {
    const node = host.current
    if (node === null) return
    const measure = (): void => { const rect = node.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height }) }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const transform = useCallback((next: typeof viewport.current): void => {
    viewport.current = next
    if (layers.current !== null) layers.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`
  }, [])
  useEffect(() => { transform(client.getSnapshot().presentation.viewport) }, [client, client.getSnapshot().presentation.viewport, transform])
  const persistViewport = useCallback(() => {
    void client.setPresentation({ ...client.getSnapshot().presentation, viewport: { ...viewport.current } }).catch(() => undefined)
  }, [client])
  useLayoutEffect(() => {
    if (svg.current === null || raster.current === null) return
    const binding = new RetainedDrawing(svg.current, raster.current, frame, projection, size.width, size.height)
    let pending: number | undefined
    const draw = (): void => {
      pending = undefined
      if (!client.getSnapshot().active) return
      const next = client.frames.getSnapshot()
      if (next === undefined || next.domain !== frame.domain || next.sceneRevision !== frame.sceneRevision) return
      const start = performance.now()
      binding.draw(next)
      client.metrics.duration('draw', performance.now() - start)
      client.metrics.count('dynamicDraws')
    }
    const schedule = (): void => { if (pending === undefined) pending = requestAnimationFrame(draw) }
    const unsubscribe = client.frames.subscribe(schedule)
    draw()
    return () => { unsubscribe(); if (pending !== undefined) cancelAnimationFrame(pending) }
  }, [client, frame, projection, size, dark])
  const zoom = (factor: number, x = size.width / 2, y = size.height / 2): void => {
    const current = viewport.current
    const scale = Math.max(0.25, Math.min(8, current.zoom * factor)), ratio = scale / current.zoom
    transform({ x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom: scale })
  }
  const sample = async (clientX: number, clientY: number): Promise<void> => {
    const current = client.frames.getSnapshot()
    const point = svg.current === null ? undefined : svgPointFromClient(svg.current, { clientX, clientY })
    if (current === undefined || point === undefined) return
    const first = current.view.trajectories[0]
    const paths = current.view.trajectories.filter(path => path.id === first?.id)
    const points = [...paths.filter(path => path.kind === 'history').flatMap(path => path.points), ...paths.filter(path => path.kind === 'predicted').flatMap(path => path.points)]
    if (points.length !== current.trajectoryTimes.length) return
    let best = -1, distance = Infinity
    points.forEach((candidate, index) => { const next = Math.hypot(projection.px(candidate) - point.x, projection.py(candidate) - point.y); if (next < distance) { best = index; distance = next } })
    if (best < 0 || distance * viewport.current.zoom > 36) return
    setPinnedTime(current.trajectoryTimes[best])
    const rows = client.getSampleReadout(best)
    setReadout(rows)
    // Resolve the displayed sample to the authoritative physical time, then query by the same full index.
    const raw = await client.query<WorkspaceFrame>('snapshot')
    const time = current.trajectoryTimes[best]!
    const index = raw.trajectoryTimes.findIndex(value => value === time)
    if (index >= 0) setReadout(await client.readout(index))
  }
  const minor = Math.max(5, frame.view.grid.minor * projection.scale)
  const major = Math.max(minor, frame.view.grid.major * projection.scale)
  const particleRadius = (index: number): number => (frame.view.particles[index]?.radius ?? 0) * projection.scale
  return <div className="stage-wrap">
    <details className="stage-tools"><summary aria-label="画布视图选项">视图 <span aria-hidden="true">⌄</span></summary><div className="stage-tool-options" aria-label="画布视图">
      <button type="button" onClick={() => { zoom(1.2); persistViewport() }} aria-label="放大">＋</button>
      <button type="button" onClick={() => { zoom(1 / 1.2); persistViewport() }} aria-label="缩小">−</button>
      <button type="button" onClick={() => { transform({ x: 0, y: 0, zoom: 1 }); persistViewport() }}>适合画布</button>
      <button type="button" aria-pressed={panTool} onClick={() => setPanTool(!panTool)}>平移</button>
    </div></details>
    <div ref={host} className={`scene-host ${panTool ? 'pan-tool' : ''}`} data-testid="physics-scene" data-domain={frame.domain}
      onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top); persistViewport() } }}
      onPointerDown={event => {
        if (event.button !== 0 || (!panTool && (event.target as Element).closest('[data-component-id], [data-terminal-component], [role="button"], [class*="Draggable"]'))) return
        const g = gesture.current
        g.points.set(event.pointerId, { x: event.clientX, y: event.clientY })
        g.initial = { ...viewport.current }; g.start = { x: event.clientX, y: event.clientY }; g.moved = false
        if (g.points.size === 2) { const [a, b] = [...g.points.values()]; g.distance = Math.hypot(a!.x - b!.x, a!.y - b!.y) }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const g = gesture.current
        if (!g.points.has(event.pointerId)) return
        g.points.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const dx = event.clientX - g.start.x, dy = event.clientY - g.start.y
        if (Math.hypot(dx, dy) > 5) g.moved = true
        if (g.points.size === 2 && g.distance > 0) {
          const [a, b] = [...g.points.values()]
          const scale = Math.max(0.25, Math.min(8, g.initial.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y) / g.distance))
          transform({ ...g.initial, zoom: scale })
        } else if (g.moved) transform({ x: g.initial.x + dx, y: g.initial.y + dy, zoom: g.initial.zoom })
      }}
      onPointerUp={event => {
        const g = gesture.current
        if (!g.points.has(event.pointerId)) return
        g.points.delete(event.pointerId)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (!g.moved && !panTool) void sample(event.clientX, event.clientY).catch(() => undefined)
        if (g.points.size === 0) persistViewport()
      }}
      onPointerCancel={event => { gesture.current.points.delete(event.pointerId); persistViewport() }}>
      <div ref={layers} className="scene-layers">
        <svg ref={svg} width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={frame.ariaLabel} fill="none">
          <defs>
            <ArrowMarkers uid={uid} />
            <pattern id={`${uid}-minor`} width={minor} height={minor} patternUnits="userSpaceOnUse"><path d={`M ${minor} 0 L 0 0 0 ${minor}`} stroke="var(--physics-grid-minor)" strokeWidth="0.5" /></pattern>
            <pattern id={`${uid}-major`} width={major} height={major} patternUnits="userSpaceOnUse"><path d={`M ${major} 0 L 0 0 0 ${major}`} stroke="var(--physics-grid-major)" strokeWidth="0.75" /></pattern>
          </defs>
          <rect width={size.width} height={size.height} fill="var(--physics-canvas-bg)" />
          <rect width={size.width} height={size.height} fill={`url(#${uid}-minor)`} />
          <rect width={size.width} height={size.height} fill={`url(#${uid}-major)`} />
          <g aria-hidden="true" stroke="var(--physics-axis)" strokeWidth="1"><path d={`M${PLOT_PADDING.left} ${PLOT_PADDING.top} V${size.height - PLOT_PADDING.bottom} H${size.width - PLOT_PADDING.right}`} /></g>
          <g fill="var(--physics-canvas-text-muted)" fontSize="11"><text x={size.width - 12} y={size.height - 10} textAnchor="end">{frame.view.axes.x}</text><text x="8" y="16">{frame.view.axes.y}</text></g>
          <Renderer view={staticModel} projection={projection} time={frame.clock.time} componentDrag={drag} componentControl={controls} componentWiring={wiring}
            componentSelection={summary.buildMode === 'construct' ? { selected: frame.view.highlighted?.[0], select: id => act('setHighlight', [id]), edit: (id, command) => act('editBuilderComponent', id, command) } : undefined} />
          {frame.view.apparatus?.map(sprite => <g key={sprite.id} data-live-apparatus={sprite.id}><Apparatus sprite={sprite} projection={projection} /></g>)}
          {frame.view.spring === undefined ? null : <SpringCoil spring={frame.view.spring} projection={projection} />}
          {frame.view.pendulum === undefined ? null : <PendulumRig pendulum={frame.view.pendulum} projection={projection} />}
          {frame.view.energyRamp === undefined ? frame.view.bodies.map(body => <g key={body.id} data-live-body={body.id}><Body body={body} projection={projection} /></g>) : null}
          {(frame.domain === 'modern' ? [] : frame.view.particles).map((particle, index) => <g key={particle.id} data-live-particle={particle.id}>
            <circle cx={projection.px(particle.at)} cy={projection.py(particle.at)} r={particleRadius(index)} fill={particle.sign === 'negative' ? 'var(--physics-vector-force)' : 'var(--physics-keypoint-impact)'} />
            <text x={projection.px(particle.at) - particleRadius(index) - 6} y={projection.py(particle.at) - particleRadius(index) - 5} fontSize="13" fill="var(--physics-canvas-text)" textAnchor="end">{particle.symbol}</text>
          </g>)}
        </svg>
        <canvas ref={raster} aria-hidden="true" className="dynamic-layer" />
      </div>
    </div>
    <details className="readout-strip"><summary><span>实时读数</span><span className="muted">{frame.view.overlay.readout.length} 项 <span aria-hidden="true">⌄</span></span></summary><div aria-label="当前实验读数">{frame.view.overlay.readout.map((row, index) => <span key={index}>{row}</span>)}</div></details>
    {pinnedTime === undefined ? null : <section className="pinned-reading" aria-label="轨迹固定读数">
      <div>{readout.map(row => <span key={row.label}><strong>{row.value}</strong> {row.label}</span>)}</div>
      <button type="button" onClick={() => act('seek', pinnedTime)}>定位此时刻</button><button type="button" onClick={() => setPinnedTime(undefined)}>关闭读数</button>
    </section>}
  </div>
})
