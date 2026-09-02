/**
 * Induction renderer. Registered for `domain: 'induction'` in the renderer
 * registry.
 *
 * Draws the textbook induction rig: the dotted uniform-field box with ✕
 * (into-page) marks, the conducting rod at its swept position (bar_motion) or
 * the edge-on coil (flux_change), and the induced-current arrow on the loop
 * rail whose direction is the engine's Lenz readout. It reads ONLY the shared
 * visual model — every position and sign was produced by the engine and framed
 * upstream by the induction visual bridge; nothing is computed here.
 *
 * Draw order is back-to-front: field box and marks, loop rail, rod / coil,
 * then the current arrow last so the reading being explained sits on top.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** Arrowhead polygon at the tip of a screen-space segment. */
const headAt = (x: number, y: number, ux: number, uy: number, size: number): string => {
  const bx = x - ux * size
  const by = y - uy * size
  const px = -uy * size * 0.46
  const py = ux * size * 0.46
  return `M${x} ${y} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`
}

export function InductionRenderer({ view, projection }: RendererProps) {
  const field = view.inductionField
  const bar = view.inductionBar
  const coil = view.inductionCoil
  const current = view.inductionCurrent
  if (field === undefined) return <></>

  const fx = projection.px(field.origin)
  const fy = projection.py({ x: field.origin.x, y: field.origin.y + field.size.height })
  const fw =
    projection.px({ x: field.origin.x + field.size.width, y: field.origin.y }) - fx
  const fh = fy - projection.py(field.origin)

  /* ✕ marks (into page) on a coarse grid inside the field box. */
  const marks: Array<{ x: number; y: number }> = []
  const cols = Math.max(3, Math.floor(fw / 46))
  const rows = Math.max(2, Math.floor(fh / 46))
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      marks.push({
        x: fx + ((col + 0.5) * fw) / cols,
        y: fy + ((row + 0.5) * fh) / rows,
      })
    }
  }
  const markHalf = 3.2

  return (
    <>
      {/* Uniform field box with into-page marks */}
      <g className={projection.highlighted(field.id) ? css.highlightGroup : undefined}>
        <rect className={css.inductionFieldBox} x={fx} y={fy} width={fw} height={fh} />
        {marks.map((mark, index) => (
          <g key={index} className={css.inductionFieldMark}>
            <line x1={mark.x - markHalf} y1={mark.y - markHalf} x2={mark.x + markHalf} y2={mark.y + markHalf} />
            <line x1={mark.x - markHalf} y1={mark.y + markHalf} x2={mark.x + markHalf} y2={mark.y - markHalf} />
          </g>
        ))}
      </g>

      {/* The conducting rod, vertical, spanning the field height (bar_motion) */}
      {bar !== undefined && view.visible.barMotion === true
        ? (() => {
          const bx = projection.px(bar.at)
          const topY = projection.py({ x: 0, y: bar.at.y + bar.length / 2 })
          const bottomY = projection.py({ x: 0, y: bar.at.y - bar.length / 2 })
          return (
            <g className={projection.highlighted(bar.id) ? css.highlightGroup : undefined}>
              <line className={css.inductionRod} x1={bx} y1={topY} x2={bx} y2={bottomY} />
              <text className={css.annotation} x={bx + 10} y={topY - 6}>
                {bar.label}
              </text>
            </g>
          )
        })()
        : null}

      {/* The coil, a flat loop seen edge-on (flux_change) */}
      {coil !== undefined
        ? (() => {
          const cx = projection.px(coil.at)
          const cy = projection.py(coil.at)
          const r = Math.max(4, (coil.diameter * projection.scale) / 2)
          /* Four connected arcs read as wire wound edge-on. */
          const arcs = [0, 1, 2, 3]
            .map((index) => {
              const dx = cx - r + (index / 4) * 2 * r
              const dxNext = cx - r + ((index + 0.25) / 4) * 2 * r
              const midY = cy - r * 0.5 + (index % 2 === 0 ? 0 : r * 0.18)
              return `M${dx} ${midY} A${r * 0.3} ${r * 0.42} 0 0 1 ${dxNext} ${midY - r * 0.28}`
            })
            .join(' ')
          return (
            <g className={projection.highlighted(coil.id) ? css.highlightGroup : undefined}>
              <path className={css.inductionCoil} d={arcs} />
              <ellipse
                className={css.inductionCoil}
                cx={cx}
                cy={cy}
                rx={r}
                ry={r * 0.34}
                opacity={0.55}
              />
              <text className={css.annotation} x={cx + r + 8} y={cy - r * 0.5}>
                {coil.label}
              </text>
            </g>
          )
        })()
        : null}

      {/* Induced-current arrow on the loop rail; sign = engine's Lenz readout */}
      {current !== undefined && view.visible.inductionCurrent === true
        ? (() => {
          const from = { x: projection.px(current.from), y: projection.py(current.from) }
          const to = { x: projection.px(current.to), y: projection.py(current.to) }
          /* sign > 0 draws the arrow left→right; sign < 0 flips it. */
          const tip = current.sign >= 0 ? to : from
          const tail = current.sign >= 0 ? from : to
          const dx = tip.x - tail.x
          const dy = tip.y - tail.y
          const length = Math.hypot(dx, dy)
          const ux = length === 0 ? 1 : dx / length
          const uy = length === 0 ? 0 : dy / length
          return (
            <g className={projection.highlighted(current.id) ? css.highlightGroup : undefined}>
              <line
                className={clsxJoin(css.inductionCurrentArrow, current.sign === 0 && css.inductionFieldBox)}
                x1={tail.x}
                y1={tail.y}
                x2={tip.x}
                y2={tip.y}
              />
              {current.sign !== 0 ? (
                <path className={css.inductionCurrentHead} d={headAt(tip.x, tip.y, ux, uy, 8)} />
              ) : null}
              <text
                className={css.inductionCurrentLabel}
                x={(tail.x + tip.x) / 2}
                y={tail.y + 14}
                textAnchor="middle"
              >
                I = E/R
              </text>
            </g>
          )
        })()
        : null}
    </>
  )
}
