/**
 * Lever renderer. Dispatched from the mechanics renderer when the frame
 * carries a beam — the snapshot domain stays `mechanics`, so this is not a
 * tenth picker domain.
 *
 * Draws the textbook class-1 lever: fulcrum, rigid beam, hanging masses on
 * strings, arm dimensions and weight arrows. It reads ONLY the shared visual
 * model — attach points and the tip were produced by the engine and framed
 * upstream by the lever visual bridge; nothing is computed here.
 *
 * Draw order is back-to-front: arm guides, fulcrum, beam, strings and masses,
 * then the weight arrows last so the reading being explained sits on top.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, MathLabel, Vectors, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

export function LeverRenderer({ view, projection }: RendererProps) {
  const beam = view.leverBeam
  const fulcrum = view.leverFulcrum
  const hangers = view.leverHangers ?? []
  if (beam === undefined || fulcrum === undefined) return null

  const fx = projection.px(fulcrum.at)
  const fy = projection.py(fulcrum.at)
  const size = 7 * projection.scale

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

      <polygon
        className={clsxJoin(
          css.leverFulcrum,
          projection.highlighted(fulcrum.id) ? css.highlightGroup : undefined,
        )}
        points={`${fx},${fy} ${fx - size},${fy + size * 1.4} ${fx + size},${fy + size * 1.4}`}
      />

      <g className={projection.highlighted(beam.id) ? css.highlightGroup : undefined}>
        <line
          className={css.leverBeam}
          x1={projection.px(beam.from)}
          y1={projection.py(beam.from)}
          x2={projection.px(beam.to)}
          y2={projection.py(beam.to)}
        />
      </g>

      {hangers.map((hanger) => {
        const ax = projection.px(hanger.attach)
        const ay = projection.py(hanger.attach)
        const mx = projection.px(hanger.massAt)
        const my = projection.py(hanger.massAt)
        const blob = 5.5 * projection.scale
        return (
          <g
            key={hanger.id}
            className={projection.highlighted(hanger.id) ? css.highlightGroup : undefined}
          >
            <line className={css.leverString} x1={ax} y1={ay} x2={mx} y2={my} />
            <circle className={css.leverMass} cx={mx} cy={my} r={blob} />
            <MathLabel
              x={mx}
              y={my + blob + 12}
              anchor="middle"
              symbol={hanger.massText}
              className={css.annotation}
            />
          </g>
        )
      })}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />
    </>
  )
}
