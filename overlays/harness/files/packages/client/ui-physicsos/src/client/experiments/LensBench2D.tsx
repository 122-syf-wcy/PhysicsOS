import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { OpticsRenderer } from '../physics/optics-renderer.tsx'
import type { RendererProjection } from '../physics/renderer-registry.tsx'
import type { ScenePoint } from '../physics/scene-visual-model.ts'
import { lensBounds, lensParameter, type LensBenchProps } from './lens-bench.ts'
import { svgPointFromClient } from '../physics/svg-screen-point.ts'
import css from './ExperimentPage.module.css'

/** The same engine ray geometry, framed as a bench rather than a general coordinate editor. */
export function LensBench2D({ snapshot, preview, commit, cancel }: LensBenchProps) {
  const svg = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(840)
  const bounds = lensBounds(snapshot)
  const drag = useRef<{ id: string; value: number; min: number; max: number } | undefined>(
    undefined,
  )
  const uid = useId().replaceAll(':', '')
  const latestCancel = useRef(cancel)
  latestCancel.current = cancel
  useEffect(() => () => {
    if (drag.current !== undefined) { drag.current = undefined; latestCancel.current() }
  }, [])
  useEffect(() => {
    if (svg.current === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured) setWidth(measured)
    })
    observer.observe(svg.current)
    return () => {
      observer.disconnect()
    }
  }, [])
  const viewport = drag.current === undefined ? bounds : drag.current
  const scale = (width - 64) / (viewport.max - viewport.min)
  const axisY = 170
  const verticalScale = Math.min(9, Math.max(5, scale))
  const projection = useMemo<RendererProjection>(
    () => ({
      px: point => 32 + (point.x - viewport.min) * scale,
      py: point => axisY - point.y * verticalScale,
      sx: x => (x - 32) / scale + viewport.min,
      sy: y => (axisY - y) / verticalScale,
      scale,
      uid,
      path: points =>
        points
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'}${32 + (point.x - viewport.min) * scale},${axisY - point.y * verticalScale}`,
          )
          .join(' '),
      highlighted: id => snapshot.view.highlighted?.includes(id) ?? false,
    }),
    [scale, viewport.min, verticalScale, uid, snapshot.view.highlighted],
  )
  const move = (event: PointerEvent<SVGSVGElement>): void => {
    if (drag.current === undefined || svg.current === null) return
    const at = svgPointFromClient(svg.current, event)
    if (at === undefined) return
    const sceneX = projection.sx(at.x)
    const value =
      Math.round(
        Math.max(1, Math.min(200, drag.current.id === 'object-distance' ? -sceneX : sceneX)) * 2,
      ) / 2
    drag.current.value = value
    preview(drag.current.id, value)
  }
  const release = (): void => {
    const active = drag.current
    drag.current = undefined
    if (active !== undefined) commit(active.id, active.value)
  }
  const abort = (): void => {
    if (drag.current !== undefined) {
      drag.current = undefined
      cancel()
    }
  }
  const handle = (id: string, label: string, at: ScenePoint) => (
    <g
      key={id}
      className={css.dragHandle}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={200}
      aria-valuenow={lensParameter(snapshot, id)}
      aria-valuetext={`${lensParameter(snapshot, id)} cm`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current !== undefined) { event.preventDefault(); event.stopPropagation(); abort() }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          commit(
            id,
            Math.max(
              1,
              Math.min(
                200,
                lensParameter(snapshot, id) + (event.key === 'ArrowRight' ? 0.5 : -0.5),
              ),
            ),
          )
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        drag.current = { id, value: lensParameter(snapshot, id), ...bounds }
        svg.current?.setPointerCapture(event.pointerId)
      }}
    >
      <rect
        x={projection.px(at) - 22}
        y={axisY - 86}
        width={44}
        height={172}
        rx={12}
        fill="transparent"
      />
      <rect
        x={projection.px(at) - 19}
        y={axisY + 92}
        width={38}
        height={25}
        rx={8}
        className={css.handleChip}
      />
      <text x={projection.px(at)} y={axisY + 109} textAnchor="middle" className={css.handleGlyph}>
        ↔
      </text>
    </g>
  )
  const view = {
    ...snapshot.view,
    origin: { x: viewport.min, y: -20 },
    extent: { width: viewport.max - viewport.min, height: 40 },
  }
  return (
    <svg
      ref={svg}
      className={css.benchSvg}
      viewBox={`0 0 ${width} 330`}
      role="img"
      aria-label="凸透镜光路图，拖动物体或光屏调整实验"
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={abort}
      onLostPointerCapture={abort}
    >
      <defs>
        <pattern id={`${uid}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="currentColor" opacity="0.10" />
        </pattern>
      </defs>
      <rect width={width} height="330" fill={`url(#${uid}-grid)`} />
      <OpticsRenderer view={view} projection={projection} />
      {snapshot.view.opticalObjects?.map(object =>
        handle('object-distance', '拖动物体', object.at),
      )}
      {snapshot.view.opticalScreens?.map(screen =>
        handle('screen-distance', '拖动光屏', screen.at),
      )}
    </svg>
  )
}
