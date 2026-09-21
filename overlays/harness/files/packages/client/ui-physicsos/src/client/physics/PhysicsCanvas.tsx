/**
 * Shared physics canvas.
 *
 * The single canvas host for every physics domain. It owns:
 *   - scene→SVG projection (the one place y flips)
 *   - grid, axes, ticks, scale bar, readout gutter
 *   - renderer dispatch through the registry
 *
 * It does NOT know what a projectile or a Lorentz force is. Domain drawing lives
 * in a renderer that receives an already-projected coordinate helper, so adding
 * `electric` or `circuit` later means registering a renderer, not touching this
 * file or growing a second canvas.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import type { ScenePoint, SceneVisualModel } from './scene-visual-model.ts'
import {
  RENDERERS,
  type ComponentControlChannel,
  type ComponentDragChannel,
  type ComponentWiringChannel,
  type RendererProjection,
} from './renderer-registry.tsx'
import css from './PhysicsCanvas.module.css'

/** Room for axes and gutters, in px. */
const PAD = { left: 46, bottom: 36, top: 18, right: 24 } as const
/**
 * Plot box used until the container has been measured.
 *
 * The emitted viewBox tracks the container's PIXEL size, so one viewBox unit is one
 * CSS pixel and `preserveAspectRatio` never rescales the drawing: a smaller viewBox
 * would magnify every stroke and label, a larger one would shrink them. This nominal
 * size only covers the first paint and non-DOM environments.
 */
const NOMINAL_PLOT = { width: 720, height: 405 } as const

export interface TrajectoryHover {
  /** Scene time in seconds at the hovered trajectory position. */
  time: number
  /** Screen position for the tooltip, relative to the canvas box. */
  screen: { xRatio: number; yRatio: number }
  rows: readonly { label: string; value: string }[]
}

/**
 * One transient burst drawn over the frame when the playback clock crosses a
 * timeline event — the visible "beat" of a collision, a field boundary or a
 * turning point. Purely presentational: the position is a point the runtime
 * already reported (a key point or the live body), never something the canvas
 * computes, and the burst carries no physical quantity.
 */
export interface CanvasEffect {
  /** Unique per firing so React never recycles a half-played animation. */
  key: string
  /** `impact` = collision / plate hit, `boundary` = field enter/exit, `mark` = launch / apex / generic. */
  kind: 'impact' | 'boundary' | 'mark'
  /** Scene-unit anchor of the burst. */
  at: ScenePoint
}

/** Spark rays around an impact burst, in degrees. */
const IMPACT_RAYS = [0, 45, 90, 135, 180, 225, 270, 315] as const

export interface PhysicsCanvasProps {
  view: SceneVisualModel
  /** Accessible description of what the frame shows. */
  ariaLabel: string
  /**
   * Sampled trajectory times, parallel to `view.trajectories[0].points`. Supplied
   * only when the caller can map a point back to a scene time; hover and seek are
   * disabled without it, rather than the canvas inventing a time.
   */
  trajectoryTimes?: readonly number[]
  /** Hover readout rows for a trajectory sample, formatted by the caller. */
  sampleReadout?: (index: number) => readonly { label: string; value: string }[]
  /** Click a trajectory point to seek the timeline to that scene time. */
  onSeekTime?: (time: number) => void
  /**
   * Pointer-drag channel for schematic components (circuit domain). Forwarded
   * to the domain renderer; undefined leaves every part fixed.
   */
  componentDrag?: ComponentDragChannel
  /** Bench controls (switch flip, rheostat slider push); forwarded like the drag channel. */
  componentControl?: ComponentControlChannel
  /** Present only while the student is assembling a circuit, by hand. */
  componentWiring?: ComponentWiringChannel
  /** Transient event bursts (collision, boundary, mark) to draw over the frame. */
  effects?: readonly CanvasEffect[]
  /**
   * Current playback time. When supplied together with `trajectoryTimes`, the
   * canvas draws strobe ghosts of the moving body at fixed time intervals along
   * the path it has ALREADY travelled — the textbook multi-flash photograph,
   * built only from samples the runtime produced.
   */
  clockTime?: number
}

/** Strobe ghosts per full run: one every total/STROBE_DIVISIONS seconds. */
const STROBE_DIVISIONS = 12

/**
 * Render one physics frame.
 */
export function PhysicsCanvas({
  view,
  ariaLabel,
  trajectoryTimes,
  sampleReadout,
  onSeekTime,
  componentDrag,
  componentControl,
  componentWiring,
  effects,
  clockTime,
}: PhysicsCanvasProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<TrajectoryHover | null>(null)
  const [box, setBox] = useState<{ width: number; height: number }>({
    width: NOMINAL_PLOT.width + PAD.left + PAD.right,
    height: NOMINAL_PLOT.height + PAD.top + PAD.bottom,
  })
  /* The readout card parks in the top-left gutter but can cover the scene —
     it is chrome, not physics, so the student may drag it anywhere inside the
     canvas. readoutPos stays undefined until the card is first moved. */
  const [readoutPos, setReadoutPos] = useState<{ x: number; y: number } | undefined>(undefined)
  const readoutDragRef = useRef<{
    pointerId: number
    grabX: number
    grabY: number
    downX: number
    downY: number
    moved: boolean
  } | null>(null)
  const [readoutDragging, setReadoutDragging] = useState(false)
  /* A press released on the card must not fall through to a trajectory seek. */
  const suppressClickRef = useRef(false)

  /* Measure the host so the viewBox can match its pixel size. Without this the SVG
     is letterboxed and scaled by whatever ratio the container happens to have. */
  useEffect(() => {
    const host = hostRef.current
    if (host === null || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      setBox(current =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height },
      )
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [])

  const plot = {
    width: Math.max(120, box.width - PAD.left - PAD.right),
    height: Math.max(90, box.height - PAD.top - PAD.bottom),
  }

  /* Fit the scene extent into the FIXED plot box, preserving aspect so a metre on
     x is a metre on y — a squashed axis would make the physics read wrong. The box
     is fixed (rather than shrunk to the content) so the emitted viewBox is always
     the same size: a content-sized viewBox gets magnified by `preserveAspectRatio`
     whenever the scene is portrait, which blows up every stroke and label by the
     same factor and makes the canvas look coarse. */
  const scale = useMemo(() => {
    const sx = plot.width / Math.max(view.extent.width, 1e-6)
    const sy = plot.height / Math.max(view.extent.height, 1e-6)
    return Math.min(sx, sy)
  }, [plot.width, plot.height, view.extent.width, view.extent.height])

  const plotWidth = plot.width
  const plotHeight = plot.height
  /* Centre the scene in the plot box; the leftover margin is honest empty space. */
  const insetX = (plotWidth - view.extent.width * scale) / 2
  const insetY = (plotHeight - view.extent.height * scale) / 2
  const width = plotWidth + PAD.left + PAD.right
  const height = plotHeight + PAD.top + PAD.bottom
  const originY = PAD.top + plotHeight - insetY

  const projection = useMemo<RendererProjection>(() => {
    const px = (point: ScenePoint) => PAD.left + insetX + (point.x - view.origin.x) * scale
    const py = (point: ScenePoint) => originY - (point.y - view.origin.y) * scale
    return {
      px,
      py,
      /* Inverse pair: pointer positions arrive in viewBox units and must
         land back on the schematic's own grid before a drag can be reported
         in scene units. */
      sx: (x: number) => view.origin.x + (x - PAD.left - insetX) / scale,
      sy: (y: number) => view.origin.y + (originY - y) / scale,
      scale,
      uid,
      path: (points: readonly ScenePoint[]) =>
        points
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point).toFixed(2)} ${py(point).toFixed(2)}`)
          .join(' '),
      highlighted: (id: string) => view.highlighted?.includes(id) === true,
    }
  }, [scale, insetX, originY, uid, view.origin.x, view.origin.y, view.highlighted])

  const minor = view.grid.minor * scale
  const major = view.grid.major * scale
  const minorId = `pc-minor-${uid}`
  const majorId = `pc-major-${uid}`
  const clipId = `pc-clip-${uid}`

  /* Axis ticks are only labelled when the caller states a step, so the canvas
     never invents a scale it cannot justify. */
  const ticks = useMemo(() => {
    const step = view.tickStep
    if (step === undefined || step <= 0) return { x: [], y: [] }
    const xs: { at: number; label: string }[] = []
    const ys: { at: number; label: string }[] = []
    /* Enough decimals to tell adjacent ticks apart: a cm-scale bench
       (step 0.02) would otherwise label every tick "-0.0 / 0.0 / 0.1". */
    const decimals = step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0
    const maxX = view.origin.x + view.extent.width
    const maxY = view.origin.y + view.extent.height
    const avoid = view.tickLabelAvoid
    const labelFor = (scene: number, range: readonly [number, number] | undefined): string =>
      range !== undefined && scene > range[0] && scene < range[1] ? '' : scene.toFixed(decimals)
    for (let scene = Math.ceil(view.origin.x / step) * step; scene <= maxX + 1e-9; scene += step) {
      xs.push({ at: projection.px({ x: scene, y: 0 }), label: labelFor(scene, avoid?.x) })
    }
    for (let scene = Math.ceil(view.origin.y / step) * step; scene <= maxY + 1e-9; scene += step) {
      ys.push({ at: projection.py({ x: 0, y: scene }), label: labelFor(scene, avoid?.y) })
    }
    return { x: xs, y: ys }
  }, [view.tickStep, view.tickLabelAvoid, view.extent.width, view.extent.height, view.origin.x, view.origin.y, projection])

  const axisX = Math.min(PAD.left + plotWidth, Math.max(PAD.left, projection.px({ x: 0, y: 0 })))
  const axisY = Math.min(originY, Math.max(PAD.top, projection.py({ x: 0, y: 0 })))

  /* Hover / seek / strobe pair against one equally-time-spaced path per body.
     A bridge may split that path at the playhead (solid travelled + dashed
     predicted); both pieces share the id and stay parallel to the runtime's
     trajectoryTimes, so re-joining them here keeps the index contract exact. */
  const trajectory = useMemo(() => {
    const first = view.trajectories[0]
    if (first === undefined) return undefined
    const parts = view.trajectories.filter(entry => entry.id === first.id)
    const points = [
      ...parts.filter(entry => entry.kind === 'history').flatMap(entry => entry.points),
      ...parts.filter(entry => entry.kind === 'predicted').flatMap(entry => entry.points),
    ]
    return { id: first.id, points }
  }, [view.trajectories])
  const interactive =
    trajectory !== undefined &&
    trajectoryTimes !== undefined &&
    trajectoryTimes.length === trajectory.points.length

  /** Nearest trajectory sample to a pointer position, in screen space. */
  const nearestSample = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>): number | null => {
      if (trajectory === undefined) return null
      const box = svgRef.current?.getBoundingClientRect()
      if (box === undefined || box.width === 0) return null
      /* The SVG scales with preserveAspectRatio, so pointer px must be mapped
         back through the viewBox before comparing with projected points. */
      const viewX = ((event.clientX - box.left) / box.width) * width
      const viewY = ((event.clientY - box.top) / box.height) * height
      let bestIndex = -1
      let bestDistance = Number.POSITIVE_INFINITY
      trajectory.points.forEach((point, index) => {
        const distance = Math.hypot(projection.px(point) - viewX, projection.py(point) - viewY)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
      /* Only claim the pointer when it is genuinely near the path. */
      return bestDistance <= 26 ? bestIndex : null
    },
    [trajectory, projection, width, height],
  )

  const handleMove = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      /* While the readout card is dragged the hover must not chase the pointer. */
      if (readoutDragRef.current !== null) return
      if (!interactive) return
      const index = nearestSample(event)
      if (index === null) {
        setHover(null)
        return
      }
      const point = trajectory.points[index]
      const time = trajectoryTimes[index]
      if (point === undefined || time === undefined) return
      setHover({
        time,
        screen: {
          xRatio: projection.px(point) / width,
          yRatio: projection.py(point) / height,
        },
        rows: sampleReadout?.(index) ?? [],
      })
    },
    [interactive, trajectory, trajectoryTimes, nearestSample, projection, width, height, sampleReadout],
  )

  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      /* Any press that ended on the readout card is a card interaction, never
         a trajectory seek. */
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      if (!interactive || onSeekTime === undefined) return
      const index = nearestSample(event)
      if (index === null) return
      const time = trajectoryTimes[index]
      if (time !== undefined) onSeekTime(time)
    },
    [interactive, trajectoryTimes, onSeekTime, nearestSample],
  )

  const Renderer = RENDERERS[view.domain]

  /* Strobe ghosts: the moving body's outline at every total/N seconds it has
     already passed. Radius comes from the live body or the particle; positions
     are trajectory samples — nothing here is a new physical claim. */
  const strobe = useMemo(() => {
    if (!interactive || clockTime === undefined) return []
    const live = view.bodies.find(body => body.live === true)
    const particle = view.particles[0]
    const radius = live !== undefined
      ? live.size * scale
      : particle !== undefined
        ? particle.radius * scale
        : 0
    if (radius <= 0) return []
    const total = trajectoryTimes[trajectoryTimes.length - 1] ?? 0
    if (total <= 0) return []
    const interval = total / STROBE_DIVISIONS
    const ghosts: { x: number; y: number; r: number; kind: 'ball' | 'block' | 'cart' | 'weight-hook' | 'particle'; rotation: number }[] = []
    let nextMark = interval
    for (const [index, time] of trajectoryTimes.entries()) {
      if (time > clockTime + 1e-9) break
      if (time + 1e-9 < nextMark) continue
      const point = trajectory.points[index]
      if (point === undefined) continue
      ghosts.push({
        x: projection.px(point),
        y: projection.py(point),
        r: radius,
        kind: live === undefined ? 'particle' : live.kind,
        rotation: live?.rotation ?? 0,
      })
      nextMark += interval
    }
    return ghosts
  }, [interactive, clockTime, view.bodies, view.particles, scale, trajectoryTimes, trajectory, projection])

  /* The readout card sizes itself to its widest line — CJK glyphs ~1em,
     latin/digits ~0.62em at these sizes — and sits in viewBox coordinates. */
  const readoutTextWidth = (line: string): number => {
    let units = 0
    for (const ch of line) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.62
    return units * 11.5
  }
  const readoutWidth =
    view.overlay.readout.length === 0
      ? 0
      : Math.min(Math.max(...view.overlay.readout.map(readoutTextWidth)) + 24, plotWidth - 24)
  const readoutHeight = 20 + view.overlay.readout.length * 16
  /* Render-time clamp too: a parked card must stay inside when the lines grow
     wider or the canvas shrinks after it was dragged. */
  const readoutOrigin =
    readoutPos === undefined
      ? { x: PAD.left + 8, y: PAD.top + 8 }
      : {
        x: Math.min(Math.max(readoutPos.x, 4), width - readoutWidth - 4),
        y: Math.min(Math.max(readoutPos.y, 4), height - readoutHeight - 4),
      }

  const viewPoint = (event: { clientX: number; clientY: number }) => {
    const box = svgRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || box.height === 0) return undefined
    return {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    }
  }

  const onReadoutPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    const at = viewPoint(event)
    if (at === undefined) return
    /* jsdom has no pointer capture — the guard keeps the spec DOM happy. */
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    readoutDragRef.current = {
      pointerId: event.pointerId,
      grabX: at.x - readoutOrigin.x,
      grabY: at.y - readoutOrigin.y,
      downX: at.x,
      downY: at.y,
      moved: false,
    }
    event.stopPropagation()
  }

  const onReadoutPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = readoutDragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    const at = viewPoint(event)
    if (at === undefined) return
    if (!drag.moved) {
      /* ~2 viewBox px of travel before the press becomes a drag. */
      if (Math.hypot(at.x - drag.downX, at.y - drag.downY) < 2) return
      drag.moved = true
      setReadoutDragging(true)
    }
    setReadoutPos({
      x: Math.min(Math.max(at.x - drag.grabX, 4), width - readoutWidth - 4),
      y: Math.min(Math.max(at.y - drag.grabY, 4), height - readoutHeight - 4),
    })
    event.stopPropagation()
  }

  const endReadoutDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = readoutDragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    readoutDragRef.current = null
    setReadoutDragging(false)
    suppressClickRef.current = true
  }

  const cancelReadoutDrag = (event: ReactPointerEvent<SVGGElement>) => {
    if (readoutDragRef.current?.pointerId !== event.pointerId) return
    readoutDragRef.current = null
    setReadoutDragging(false)
  }

  return (
    <div className={css.host} ref={hostRef}>
      <svg
        ref={svgRef}
        className={clsx(css.root, interactive && css.interactive)}
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHover(null) }}
        onClick={handleClick}
      >
        <defs>
          {/* fill="none" is load-bearing: an SVG path defaults to a BLACK fill,
              and an L-shaped grid cell filled black tiles into a checkerboard. */}
          <pattern id={minorId} width={minor} height={minor} patternUnits="userSpaceOnUse">
            <path d={`M${minor} 0H0V${minor}`} fill="none" className={css.gridMinor} />
          </pattern>
          <pattern id={majorId} width={major} height={major} patternUnits="userSpaceOnUse">
            <path d={`M${major} 0H0V${major}`} fill="none" className={css.gridMajor} />
          </pattern>
          {/* Physics does not stop at the frame edge — a projectile keeps flying and
              a block keeps sliding — so domain drawing is clipped to the plot rather
              than allowed to bleed over the axes, ticks and gutters. */}
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotWidth} height={plotHeight} />
          </clipPath>
          {/* Soft sphere shading for ball bodies (primitives.tsx Body). A
              gradient, not a filter, so it costs nothing per frame. */}
          <radialGradient id={`pc-ball-${uid}`} cx="36%" cy="32%" r="72%">
            <stop offset="0%" className={css.ballHighlight} />
            <stop offset="55%" className={css.ballMid} />
            <stop offset="100%" className={css.ballShade} />
          </radialGradient>
        </defs>

        <rect x={PAD.left} y={PAD.top} width={plotWidth} height={plotHeight} className={css.plot} />
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotWidth}
          height={plotHeight}
          fill={`url(#${minorId})`}
          opacity="0.7"
        />
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotWidth}
          height={plotHeight}
          fill={`url(#${majorId})`}
          opacity="0.38"
        />

        {/* ---------- axes ----------
            An axis is drawn only when the bridge named it. A one-dimensional
            rig (rails, a rod) has no meaningful y, and a circuit schematic has
            no coordinates at all — an unnamed axis line through the apparatus
            is noise, not a reading aid. */}
        {view.axes.x.length === 0 ? null : (
          <>
            <line className={css.axis} x1={PAD.left} y1={axisY} x2={PAD.left + plotWidth} y2={axisY} />
            {ticks.x.map(tick => (
              <g key={`tx-${tick.at}`}>
                <line className={css.tick} x1={tick.at} y1={axisY} x2={tick.at} y2={axisY + 4} />
                {tick.label === '' ? null : (
                  <text className={css.tickLabel} x={tick.at} y={axisY + 15} textAnchor="middle">
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            <text className={css.axisLabel} x={PAD.left + plotWidth} y={Math.min(originY + 29, axisY + 29)} textAnchor="end">
              {view.axes.x}
            </text>
          </>
        )}
        {view.axes.y.length === 0 ? null : (
          <>
            <line className={css.axis} x1={axisX} y1={originY} x2={axisX} y2={PAD.top} />
            {ticks.y.map(tick => (
              <g key={`ty-${tick.at}`}>
                <line className={css.tick} x1={axisX - 4} y1={tick.at} x2={axisX} y2={tick.at} />
                {tick.label === '' ? null : (
                  <text className={css.tickLabel} x={axisX - 7} y={tick.at + 3.4} textAnchor="end">
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            {/* Right of the axis line: every y-tick label ends at axisX − 7 on
                the left, so the axis name can never share their row. Clamped
                inside the plot for the all-negative-x edge case. */}
            <text
              className={css.axisLabel}
              x={Math.min(axisX + 8, PAD.left + plotWidth - 36)}
              y={PAD.top + 12}
              textAnchor="start"
            >
              {view.axes.y}
            </text>
          </>
        )}

        {/* ---------- strobe ghosts ---------- */}
        {strobe.length === 0 ? null : (
          <g clipPath={`url(#${clipId})`} className={css.strobe} aria-hidden="true">
            {strobe.map((ghost, index) => (
              ghost.kind === 'block' || ghost.kind === 'cart' ? (
                <rect
                  key={index}
                  className={css.strobeBody}
                  x={ghost.x - ghost.r}
                  y={ghost.y - ghost.r}
                  width={ghost.r * 2}
                  height={ghost.r * 2}
                  rx={ghost.r * 0.18}
                  transform={ghost.rotation === 0 ? undefined : `rotate(${-ghost.rotation} ${ghost.x} ${ghost.y})`}
                  style={{ opacity: 0.16 + (index / Math.max(1, strobe.length)) * 0.22 }}
                />
              ) : (
                <circle
                  key={index}
                  className={css.strobeBody}
                  cx={ghost.x}
                  cy={ghost.y}
                  r={ghost.r}
                  style={{ opacity: 0.16 + (index / Math.max(1, strobe.length)) * 0.22 }}
                />
              )
            ))}
          </g>
        )}

        {/* ---------- domain drawing ---------- */}
        <g clipPath={`url(#${clipId})`}>
          <Renderer
            view={view}
            projection={projection}
            {...clockTime === undefined ? {} : { time: clockTime }}
            {...componentDrag === undefined ? {} : { componentDrag }}
            {...componentControl === undefined ? {} : { componentControl }}
            {...componentWiring === undefined ? {} : { componentWiring }}
          />
        </g>

        {/* ---------- event bursts ----------
            Drawn above the domain layer and clipped with it. Each burst is a
            CSS animation keyed per firing, so it plays out on its own clock and
            never re-triggers on an unrelated re-render. */}
        {effects === undefined || effects.length === 0 ? null : (
          <g clipPath={`url(#${clipId})`} className={css.effects} aria-hidden="true">
            {effects.map((effect) => {
              const cx = projection.px(effect.at)
              const cy = projection.py(effect.at)
              const kindClass =
                effect.kind === 'impact'
                  ? css.effectImpact
                  : effect.kind === 'boundary'
                    ? css.effectBoundary
                    : css.effectMark
              return (
                <g key={effect.key} className={clsx(css.effect, kindClass)} data-physicsos-effect={effect.kind}>
                  <circle className={css.effectRing} cx={cx} cy={cy} r="6" />
                  <circle className={clsx(css.effectRing, css.effectRingLate)} cx={cx} cy={cy} r="6" />
                  <circle className={css.effectCore} cx={cx} cy={cy} r="3" />
                  {/* The rotation lives on a wrapper: a CSS transform animation on
                      the line itself would override its rotate() attribute. */}
                  {effect.kind === 'impact'
                    ? IMPACT_RAYS.map(angle => (
                      <g key={angle} transform={`rotate(${angle} ${cx.toFixed(2)} ${cy.toFixed(2)})`}>
                        <line className={css.effectRay} x1={cx} y1={cy - 4} x2={cx} y2={cy - 12} />
                      </g>
                    ))
                    : null}
                </g>
              )
            })}
          </g>
        )}

        {/* ---------- readout gutter ----------
            The card sizes itself to its widest line and parks top-left by
            default; it is chrome over the scene, so the student can drag it
            anywhere inside the canvas when it covers the picture. */}
        {view.overlay.readout.length === 0 ? null : (
          <g
            className={clsx(
              css.readoutDraggable,
              readoutDragging ? css.readoutDragging : undefined,
            )}
            onPointerDown={onReadoutPointerDown}
            onPointerMove={onReadoutPointerMove}
            onPointerUp={endReadoutDrag}
            onPointerCancel={cancelReadoutDrag}
          >
            <title>拖动调整读数卡片位置</title>
            <rect
              className={css.readoutPanel}
              x={readoutOrigin.x}
              y={readoutOrigin.y}
              width={readoutWidth}
              height={readoutHeight}
              rx="8"
            />
            {view.overlay.readout.map((line, index) => (
              <text
                key={line}
                className={index === 0 ? css.readoutTitle : css.readoutLine}
                x={readoutOrigin.x + 12}
                y={readoutOrigin.y + 19 + index * 16}
              >
                {line}
              </text>
            ))}
          </g>
        )}

        {/* ---------- scale bar ----------
            Hidden on schematics: a circuit grid has no physical length, so a
            bar reading "1" would be a number with nothing to measure. */}
        <g>
          {view.overlay.scale.label.length === 0 || view.axes.x.length === 0 && view.axes.y.length === 0 ? null : (() => {
            const barLength = view.overlay.scale.length * scale
            const right = PAD.left + plotWidth - 18
            const left = right - barLength
            const y = originY - 16
            return (
              <>
                <line className={css.scaleBar} x1={left} y1={y} x2={right} y2={y} />
                <line className={css.scaleBar} x1={left} y1={y - 4} x2={left} y2={y + 4} />
                <line className={css.scaleBar} x1={right} y1={y - 4} x2={right} y2={y + 4} />
                <text className={css.scaleLabel} x={right} y={y - 7} textAnchor="end">
                  {view.overlay.scale.label}
                </text>
              </>
            )
          })()}
        </g>
      </svg>

      {hover === null ? null : (
        <div
          className={css.tooltip}
          style={{ left: `${hover.screen.xRatio * 100}%`, top: `${hover.screen.yRatio * 100}%` }}
          role="status"
        >
          {hover.rows.map(row => (
            <span key={row.label} className={css.tooltipRow}>
              <span className={css.tooltipLabel}>{row.label}</span>
              <span className={css.tooltipValue}>{row.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
