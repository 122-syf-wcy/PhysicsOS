/**
 * Lever renderer. Dispatched from the mechanics renderer when the frame
 * carries a beam — the snapshot domain stays `mechanics`, so this is not a
 * tenth picker domain.
 *
 * Draws the textbook class-1 lever: a rigid graduated beam on a pedestal
 * fulcrum, hanging 钩码 (hooked cylinders) on strings, arm dimensions and
 * weight arrows. It reads ONLY the shared visual model — attach points and
 * the tip were produced by the engine and framed upstream by the lever
 * visual bridge; nothing is computed here.
 *
 * Draw order is back-to-front: arm guides, fulcrum pedestal, beam with its
 * tick marks, strings and masses, then the weight arrows last so the reading
 * being explained sits on top.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, MathLabel, Vectors } from './primitives.tsx'
import css from './renderers.module.css'

/** A hanging 钩码: ring hook at the string end, squat cylinder body with the
 *  centre slot every hooked mass is drawn with. */
const HangerGlyph = ({
  ax,
  ay,
  mx,
  my,
  size,
  massText,
  highlighted,
}: {
  ax: number
  ay: number
  mx: number
  my: number
  size: number
  massText: string
  highlighted: boolean
}) => {
  const bodyW = size * 1.7
  const bodyH = size * 1.25
  const ringR = size * 0.42
  return (
    <g className={highlighted ? css.highlightGroup : undefined}>
      {/* String ends at the hook ring, not inside the body */}
      <line
        className={css.leverString}
        x1={ax}
        y1={ay}
        x2={mx}
        y2={my - bodyH / 2 - ringR * 1.6}
      />
      <circle
        className={css.leverMassHook}
        cx={mx}
        cy={my - bodyH / 2 - ringR * 0.55}
        r={ringR}
      />
      {/* Cylinder body with the centre slot of a slotted weight */}
      <rect
        className={css.leverMass}
        x={mx - bodyW / 2}
        y={my - bodyH / 2}
        width={bodyW}
        height={bodyH}
        rx={size * 0.22}
      />
      <line
        className={css.leverMassSlot}
        x1={mx - bodyW / 2 + size * 0.18}
        y1={my}
        x2={mx + bodyW / 2 - size * 0.18}
        y2={my}
      />
      <MathLabel
        x={mx}
        y={my + bodyH / 2 + 13}
        anchor="middle"
        symbol={massText}
        className={css.annotation}
      />
    </g>
  )
}

export function LeverRenderer({ view, projection }: RendererProps) {
  const beam = view.leverBeam
  const fulcrum = view.leverFulcrum
  const hangers = view.leverHangers ?? []
  if (beam === undefined || fulcrum === undefined) return null

  const fx = projection.px(fulcrum.at)
  const fy = projection.py(fulcrum.at)
  const size = 7 * projection.scale

  /* Beam geometry in px space: a thick bar with graduation ticks. */
  const bx1 = projection.px(beam.from)
  const by1 = projection.py(beam.from)
  const bx2 = projection.px(beam.to)
  const by2 = projection.py(beam.to)
  const beamLen = Math.hypot(bx2 - bx1, by2 - by1) || 1
  const ux = (bx2 - bx1) / beamLen
  const uy = (by2 - by1) / beamLen
  const nx = -uy
  const ny = ux
  const half = Math.max(2.4, beamLen * 0.012)
  const beamPath = [
    `M${bx1 + nx * half} ${by1 + ny * half}`,
    `L${bx2 + nx * half} ${by2 + ny * half}`,
    `L${bx2 - nx * half} ${by2 - ny * half}`,
    `L${bx1 - nx * half} ${by1 - ny * half}`,
    'Z',
  ].join(' ')
  const tickCount = Math.floor(beamLen / 16)
  const ticks = Array.from({ length: Math.max(0, tickCount - 1) }, (_, index) => {
    const t = (index + 1) / tickCount
    const cx = bx1 + (bx2 - bx1) * t
    const cy = by1 + (by2 - by1) * t
    return {
      x1: cx + nx * half,
      y1: cy + ny * half,
      x2: cx + nx * half * 0.35,
      y2: cy + ny * half * 0.35,
    }
  })

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {view.visible.arms === true
        ? view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))
        : null}

      {/* Pedestal fulcrum: triangle apex under the beam, stand column, base */}
      <g className={projection.highlighted(fulcrum.id) ? css.highlightGroup : undefined}>
        <polygon
          className={css.leverFulcrum}
          points={`${fx},${fy} ${fx - size},${fy + size * 1.4} ${fx + size},${fy + size * 1.4}`}
        />
        <line
          className={css.leverFulcrumStand}
          x1={fx}
          y1={fy + size * 1.4}
          x2={fx}
          y2={fy + size * 2.3}
        />
        <line
          className={css.leverFulcrumBase}
          x1={fx - size * 1.7}
          y1={fy + size * 2.3}
          x2={fx + size * 1.7}
          y2={fy + size * 2.3}
        />
      </g>

      {/* Graduated beam */}
      <g className={projection.highlighted(beam.id) ? css.highlightGroup : undefined}>
        <path className={css.leverBeamBar} d={beamPath} />
        {ticks.map((tick, index) => (
          <line
            key={index}
            className={css.leverBeamTick}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}
      </g>

      {hangers.map((hanger) => {
        const ax = projection.px(hanger.attach)
        const ay = projection.py(hanger.attach)
        const mx = projection.px(hanger.massAt)
        const my = projection.py(hanger.massAt)
        return (
          <HangerGlyph
            key={hanger.id}
            ax={ax}
            ay={ay}
            mx={mx}
            my={my}
            size={5.5 * projection.scale}
            massText={hanger.massText}
            highlighted={projection.highlighted(hanger.id)}
          />
        )
      })}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />
    </>
  )
}
