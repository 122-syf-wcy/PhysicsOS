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

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import clsx from 'clsx'
import type { ScenePoint, SceneVisualModel } from './scene-visual-model.ts'
import { RENDERERS, type RendererProjection } from './renderer-registry.tsx'
import css from './PhysicsCanvas.module.css'

/** Room for axes and gutters, in px. */
const PAD = { left: 46, bottom: 36, top: 18, right: 24 } as const
/** Nominal plot box the scene is fitted into, in px. */
const PLOT = { width: 720, height: 405 } as const

export interface TrajectoryHover {
  /** Scene time in seconds at the hovered trajectory position. */
  time: number
  /** Screen position for the tooltip, relative to the canvas box. */
  screen: { xRatio: number; yRatio: number }
  rows: readonly { label: string; value: string }[]
}

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
}

/**
 * Render one physics frame.
 */
export function PhysicsCanvas({
  view,
  ariaLabel,
  trajectoryTimes,
  sampleReadout,
  onSeekTime,
}: PhysicsCanvasProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<TrajectoryHover | null>(null)

  /* Fit the scene extent into the nominal plot box, preserving aspect so a metre
     on x is a metre on y — a squashed axis would make the physics read wrong. */
  const scale = useMemo(() => {
    const sx = PLOT.width / Math.max(view.extent.width, 1e-6)
    const sy = PLOT.height / Math.max(view.extent.height, 1e-6)
    return Math.min(sx, sy)
  }, [view.extent.width, view.extent.height])

  const plotWidth = view.extent.width * scale
  const plotHeight = view.extent.height * scale
  const width = plotWidth + PAD.left + PAD.right
  const height = plotHeight + PAD.top + PAD.bottom
  const originY = PAD.top + plotHeight

  const projection = useMemo<RendererProjection>(() => {
    const px = (point: ScenePoint) => PAD.left + (point.x - view.origin.x) * scale
    const py = (point: ScenePoint) => originY - (point.y - view.origin.y) * scale
    return {
      px,
      py,
      scale,
      uid,
      path: (points: readonly ScenePoint[]) =>
        points
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point).toFixed(2)} ${py(point).toFixed(2)}`)
          .join(' '),
      highlighted: (id: string) => view.highlighted?.includes(id) === true,
    }
  }, [scale, originY, uid, view.origin.x, view.origin.y, view.highlighted])

  const minor = view.grid.minor * scale
  const major = view.grid.major * scale
  const minorId = `pc-minor-${uid}`
  const majorId = `pc-major-${uid}`

  /* Axis ticks are only labelled when the caller states a step, so the canvas
     never invents a scale it cannot justify. */
  const ticks = useMemo(() => {
    const step = view.tickStep
    if (step === undefined || step <= 0) return { x: [], y: [] }
    const xs: { at: number; label: string }[] = []
    const ys: { at: number; label: string }[] = []
    const decimals = step < 1 ? 1 : 0
    const maxX = view.origin.x + view.extent.width
    const maxY = view.origin.y + view.extent.height
    for (let scene = Math.ceil(view.origin.x / step) * step; scene <= maxX + 1e-9; scene += step) {
      xs.push({ at: projection.px({ x: scene, y: 0 }), label: scene.toFixed(decimals) })
    }
    for (let scene = Math.ceil(view.origin.y / step) * step; scene <= maxY + 1e-9; scene += step) {
      ys.push({ at: projection.py({ x: 0, y: scene }), label: scene.toFixed(decimals) })
    }
    return { x: xs, y: ys }
  }, [view.tickStep, view.extent.width, view.extent.height, view.origin.x, view.origin.y, projection])

  const axisX = Math.min(PAD.left + plotWidth, Math.max(PAD.left, projection.px({ x: 0, y: 0 })))
  const axisY = Math.min(originY, Math.max(PAD.top, projection.py({ x: 0, y: 0 })))

  const trajectory = view.trajectories.find(entry => entry.kind === 'history')
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
      if (!interactive || onSeekTime === undefined) return
      const index = nearestSample(event)
      if (index === null) return
      const time = trajectoryTimes[index]
      if (time !== undefined) onSeekTime(time)
    },
    [interactive, trajectoryTimes, onSeekTime, nearestSample],
  )

  const Renderer = RENDERERS[view.domain]

  return (
    <div className={css.host}>
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

        {/* ---------- axes ---------- */}
        <line className={css.axis} x1={PAD.left} y1={axisY} x2={PAD.left + plotWidth} y2={axisY} />
        <line className={css.axis} x1={axisX} y1={originY} x2={axisX} y2={PAD.top} />
        {ticks.x.map(tick => (
          <g key={`tx-${tick.at}`}>
            <line className={css.tick} x1={tick.at} y1={axisY} x2={tick.at} y2={axisY + 4} />
            <text className={css.tickLabel} x={tick.at} y={axisY + 15} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
        {ticks.y.map(tick => (
          <g key={`ty-${tick.at}`}>
            <line className={css.tick} x1={axisX - 4} y1={tick.at} x2={axisX} y2={tick.at} />
            <text className={css.tickLabel} x={axisX - 7} y={tick.at + 3.4} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        <text className={css.axisLabel} x={PAD.left + plotWidth} y={Math.min(originY + 29, axisY + 29)} textAnchor="end">
          {view.axes.x}
        </text>
        <text className={css.axisLabel} x={Math.max(PAD.left - 8, axisX - 8)} y={PAD.top + 9} textAnchor="end">
          {view.axes.y}
        </text>

        {/* ---------- domain drawing ---------- */}
        <Renderer view={view} projection={projection} />

        {/* ---------- readout gutter ---------- */}
        {view.overlay.readout.length === 0 ? null : (
          <g>
            <rect
              className={css.readoutPanel}
              x={PAD.left + 10}
              y={PAD.top + 10}
              width={188}
              height={20 + view.overlay.readout.length * 16}
              rx="8"
            />
            {view.overlay.readout.map((line, index) => (
              <text
                key={line}
                className={index === 0 ? css.readoutTitle : css.readoutLine}
                x={PAD.left + 22}
                y={PAD.top + 29 + index * 16}
              >
                {line}
              </text>
            ))}
          </g>
        )}

        {/* ---------- scale bar ---------- */}
        <g>
          {(() => {
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
