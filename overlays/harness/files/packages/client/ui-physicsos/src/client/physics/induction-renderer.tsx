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

/** Charge-carrier drift: one bead every ~22 px of conductor; the advance rate
    is ∝ |I| (px/s per ampere), floored so a small current still visibly drifts
    and capped so a strong one stays readable. */
const CHARGE_SPACING_PX = 22
const CHARGE_SPEED_PER_AMP = 1000
const CHARGE_SPEED_MIN = 10
const CHARGE_SPEED_MAX = 110

/** Screen-space point at arc length `s` along a projected polyline. */
const pointAlong = (
  screen: readonly { x: number; y: number }[],
  lengths: readonly number[],
  s: number,
): { x: number; y: number } => {
  const first = screen[0] ?? { x: 0, y: 0 }
  let walked = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0
    const a = screen[index]
    const b = screen[index + 1]
    if (a === undefined || b === undefined) break
    if (s <= walked + length || index === lengths.length - 1) {
      const t = length <= 0 ? 0 : Math.min(1, Math.max(0, (s - walked) / length))
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    walked += length
  }
  return first
}

export function InductionRenderer({ view, projection, time }: RendererProps) {
  const field = view.inductionField
  const bar = view.inductionBar
  const coil = view.inductionCoil
  const current = view.inductionCurrent
  const rails = view.inductionRails
  const pairBars = view.inductionPairBars
  const forceArrows = view.inductionForceArrows
  if (field === undefined) return <></>

  const fx = projection.px(field.origin)
  const fy = projection.py({ x: field.origin.x, y: field.origin.y + field.size.height })
  const fw =
    projection.px({ x: field.origin.x + field.size.width, y: field.origin.y }) - fx
  /* The projection flips y (scene +y is up, screen y grows down), so the
     screen top is py(origin.y + height) and the box height is the absolute
     difference — a raw `fy - py(origin)` is negative and Chrome rejects a
     negative rect height. */
  const fh = Math.abs(fy - projection.py(field.origin))
  const boxTop = Math.min(fy, projection.py(field.origin))

  /* ✕ marks (into page) on a coarse grid inside the field box. */
  const marks: Array<{ x: number; y: number }> = []
  const cols = Math.max(3, Math.floor(fw / 46))
  const rows = Math.max(2, Math.floor(fh / 46))
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      marks.push({
        x: fx + ((col + 0.5) * fw) / cols,
        y: boxTop + ((row + 0.5) * fh) / rows,
      })
    }
  }
  const markHalf = 3.2

  return (
    <>
      {/* Uniform field box with into-page marks */}
      <g className={projection.highlighted(field.id) ? css.highlightGroup : undefined}>
        <rect className={css.inductionFieldBox} x={fx} y={boxTop} width={fw} height={fh} />
        {marks.map((mark, index) => (
          <g key={index} className={css.inductionFieldMark}>
            <line x1={mark.x - markHalf} y1={mark.y - markHalf} x2={mark.x + markHalf} y2={mark.y + markHalf} />
            <line x1={mark.x - markHalf} y1={mark.y + markHalf} x2={mark.x + markHalf} y2={mark.y - markHalf} />
          </g>
        ))}
      </g>

      {/* Rails — drawn for every rail rig, single- or double-bar. Each rail is
          a conductor band: a dark baseline plus a lighter top edge so the pair
          reads as metal, not as two plot lines. */}
      {rails === undefined ? null : rails.map((rail) => {
        const from = { x: projection.px(rail.from), y: projection.py(rail.from) }
        const to = { x: projection.px(rail.to), y: projection.py(rail.to) }
        return (
          <g key={rail.id}>
            <line
              className={css.inductionRailEdge}
              x1={from.x}
              y1={from.y - 1.4}
              x2={to.x}
              y2={to.y - 1.4}
            />
            <line
              className={css.inductionRail}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          </g>
        )
      })}

      {/* Loop closure: the resistor wire bridging the rails at the left end
          (bar_motion). The zigzag sits mid-wire so the element reads as a
          resistor, not a rail joint. */}
      {view.inductionResistor === undefined ? null : (() => {
        const resistor = view.inductionResistor
        const cx = projection.px(resistor.at)
        const topY = projection.py({ x: 0, y: resistor.at.y + resistor.span / 2 })
        const bottomY = projection.py({ x: 0, y: resistor.at.y - resistor.span / 2 })
        const midY = (topY + bottomY) / 2
        const lead = (bottomY - topY) * 0.28
        /* Zigzag between the two leads: 6 half-cycles, ±4.5 px wide. */
        const zig = Array.from({ length: 6 }, (_, i) =>
          `L${cx + (i % 2 === 0 ? 4.5 : -4.5)} ${topY + lead + ((i + 0.5) / 6) * (bottomY - topY - lead * 2)}`)
          .join(' ')
        return (
          <g className={projection.highlighted(resistor.id) ? css.highlightGroup : undefined}>
            <path
              className={css.inductionResistor}
              d={`M${cx} ${topY} L${cx} ${topY + lead} ${zig} L${cx} ${bottomY}`}
            />
            <text className={css.inductionResistorLabel} x={cx - 8} y={midY + 4} textAnchor="end">
              {resistor.label}
            </text>
          </g>
        )
      })()}

      {/* The conducting rod: a metal bar bridging the rails, with contact dots
          at the rail crossings and a velocity arrow in its slide direction. */}
      {bar !== undefined && view.visible.barMotion === true
        ? (() => {
          const bx = projection.px(bar.at)
          const topY = projection.py({ x: 0, y: bar.at.y + bar.length / 2 })
          const bottomY = projection.py({ x: 0, y: bar.at.y - bar.length / 2 })
          const arrowTail = { x: bx + 6, y: topY - 12 }
          const arrowTip = { x: bx + 6 + bar.direction * 34, y: topY - 12 }
          const ux = bar.direction
          return (
            <g className={projection.highlighted(bar.id) ? css.highlightGroup : undefined}>
              <line className={css.inductionRodBed} x1={bx} y1={topY} x2={bx} y2={bottomY} />
              <line className={css.inductionRod} x1={bx} y1={topY} x2={bx} y2={bottomY} />
              <circle className={css.inductionRodContact} cx={bx} cy={topY} r={3.2} />
              <circle className={css.inductionRodContact} cx={bx} cy={bottomY} r={3.2} />
              <line
                className={css.inductionVelocity}
                x1={arrowTail.x}
                y1={arrowTail.y}
                x2={arrowTip.x}
                y2={arrowTip.y}
              />
              <path
                className={css.inductionVelocityHead}
                d={headAt(arrowTip.x, arrowTip.y, ux, 0, 7)}
              />
              <text className={css.inductionVelocityLabel} x={(arrowTail.x + arrowTip.x) / 2} y={arrowTail.y - 5} textAnchor="middle">
                v
              </text>
              <text className={css.annotation} x={bx + 10} y={topY - 26}>
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

      {/* Two bars of the double_bar_rail rig (the rails themselves are drawn
          above, shared with the single-bar rig). */}
      {pairBars !== undefined
        ? (
          <>
            {pairBars.map((pairBar) => {
              const bx = projection.px(pairBar.at)
              const topY = projection.py({ x: 0, y: pairBar.at.y + pairBar.length / 2 })
              const bottomY = projection.py({ x: 0, y: pairBar.at.y - pairBar.length / 2 })
              return (
                <g
                  key={pairBar.id}
                  className={projection.highlighted(pairBar.id) ? css.highlightGroup : undefined}
                >
                  <line className={css.inductionRod} x1={bx} y1={topY} x2={bx} y2={bottomY} />
                  <text className={css.annotation} x={bx + 10} y={topY - 4}>
                    {pairBar.label}
                  </text>
                </g>
              )
            })}
          </>
        )
        : null}

      {/* Magnetic force arrows on each bar (double_bar_rail); engine BIL facts.
          They carry the force colour, not the current colour: the same rig shows
          an induced current in amber, so a force drawn in amber would read as a
          second current. The arrow length is ∝ |F|, so the braking force visibly
          fades as the bars approach a common velocity. */}
      {forceArrows !== undefined
        ? forceArrows.map((arrow) => {
          const tail = { x: projection.px(arrow.at), y: projection.py(arrow.at) }
          const tip = {
            x: projection.px({ x: arrow.at.x + arrow.direction * arrow.length, y: arrow.at.y }),
            y: projection.py(arrow.at),
          }
          const dx = tip.x - tail.x
          const dy = tip.y - tail.y
          const length = Math.hypot(dx, dy)
          const ux = length === 0 ? arrow.direction : dx / length
          const uy = length === 0 ? 0 : dy / length
          /* Bar 1 sits above the rails, bar 2 below: keep each label on the
             outside of its arrow so it never lands on a rail. */
          const above = arrow.at.y > 0
          return (
            <g
              key={arrow.id}
              className={projection.highlighted(arrow.id) ? css.highlightGroup : undefined}
            >
              <line className={css.inductionForceArrow} x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
              <path className={css.inductionForceHead} d={headAt(tip.x, tip.y, ux, uy, 7)} />
              <text
                className={css.inductionForceLabel}
                x={(tail.x + tip.x) / 2}
                y={above ? tail.y - 7 : tail.y + 15}
                textAnchor="middle"
              >
                {arrow.label}
              </text>
            </g>
          )
        })
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

      {/* Drifting charge carriers along each solved loop run: evenly spaced
          beads whose advance rate is ∝ |I| (clamped) and whose travel sense is
          the current's sign along the path order. The phase is the engine
          clock — pause freezes the drift, scrubbing reverses it — and a zero
          current parks the beads. Gated by the same 感应电流 observable as
          the direction arrow. */}
      {view.visible.inductionCurrent === true
        ? (view.chargeFlows ?? []).map((flow) => {
          const screen = flow.path.map(point => ({
            x: projection.px(point),
            y: projection.py(point),
          }))
          const lengths: number[] = []
          let total = 0
          for (let index = 1; index < screen.length; index += 1) {
            const a = screen[index - 1]
            const b = screen[index]
            if (a === undefined || b === undefined) continue
            const length = Math.hypot(b.x - a.x, b.y - a.y)
            lengths.push(length)
            total += length
          }
          if (screen.length < 2 || total <= 0) return null
          const count = Math.max(2, Math.round(total / CHARGE_SPACING_PX))
          const stepLength = total / count
          const speed = Math.min(
            CHARGE_SPEED_MAX,
            Math.max(CHARGE_SPEED_MIN, Math.abs(flow.current) * CHARGE_SPEED_PER_AMP),
          )
          const advance =
            flow.current === 0 ? 0 : Math.sign(flow.current) * speed * (time ?? 0)
          return (
            <g key={flow.id} data-charge-flow={flow.id} aria-hidden="true">
              {Array.from({ length: count }, (_, index) => {
                const s = (((index * stepLength + advance) % total) + total) % total
                const dot = pointAlong(screen, lengths, s)
                return (
                  <circle
                    key={index}
                    className={css.inductionChargeDot}
                    cx={dot.x}
                    cy={dot.y}
                    r={2.6}
                  />
                )
              })}
            </g>
          )
        })
        : null}
    </>
  )
}
