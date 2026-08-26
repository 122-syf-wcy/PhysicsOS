/**
 * Acoustics renderer. Registered for `domain: 'acoustics'` in the renderer
 * registry.
 *
 * Draws the textbook echo range: the ground rail, the loudspeaker source, the
 * hatched cliff face, the out/return path guides (out high, back low — the
 * split every 初中 diagram uses), the travelling pulse dot with its trailing
 * wavefront arcs, and the d dimension. It reads ONLY the shared visual model —
 * the pulse position and its leg were produced by the engine and framed
 * upstream by the acoustics visual bridge; nothing propagates here.
 *
 * Draw order is back-to-front: ground, path guides, dimension, wall, source,
 * wavefronts, then the pulse last so the moving reading is never buried.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, Ground, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** Arrowhead polygon at the tip of a screen-space segment. */
const headAt = (x: number, y: number, ux: number, uy: number, size: number): string => {
  const bx = x - ux * size
  const by = y - uy * size
  const px = -uy * size * 0.46
  const py = ux * size * 0.46
  return `M${x} ${y} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`
}

/** One trailing wavefront arc, opening against the travel direction. */
const wavefrontArc = (
  cx: number,
  cy: number,
  radius: number,
  forward: boolean,
): string => {
  /* A 100° arc bulging towards the travel sense: the chord is vertical, the
     apex leads the pulse like a bow wave. */
  const spread = radius * 0.766
  const apex = forward ? cx + radius : cx - radius
  return `M${apex - (forward ? radius : -radius) * 0.36} ${cy - spread} Q${apex} ${cy} ${apex - (forward ? radius : -radius) * 0.36} ${cy + spread}`
}

/** The loudspeaker horn: box body, trapezoid mouth facing +x. */
const SpeakerGlyph = ({
  x,
  y,
  size,
  highlighted,
}: {
  x: number
  y: number
  size: number
  highlighted: boolean
}) => (
  <g className={highlighted ? css.highlightGroup : undefined}>
    <path
      className={css.acousticSourceBody}
      d={[
        `M${x - size * 0.7} ${y - size * 0.42}`,
        `h${size * 0.55} l${size * 0.6} ${-size * 0.34}`,
        `v${size * 1.52} l${-size * 0.6} ${-size * 0.34}`,
        `h${-size * 0.55} z`,
      ].join(' ')}
    />
  </g>
)

export function AcousticsRenderer({ view, projection }: RendererProps) {
  const showWavefronts = view.visible.wavefronts === true
  const showPath = view.visible.path === true
  const pulse = view.acousticPulse

  /* Speaker size follows the projected wall height so the glyphs stay in
     proportion at any range length. */
  const wallHalfPx = (view.acousticReflectors?.[0]?.halfHeight ?? 8) * projection.scale
  const speakerSize = Math.max(14, Math.min(34, wallHalfPx * 0.5))

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {view.ground === undefined ? null : <Ground ground={view.ground} projection={projection} />}

      {/* Out/return path guides with travel-sense arrowheads */}
      {showPath
        ? view.guides.map((guide) => {
          const x1 = projection.px(guide.from)
          const y1 = projection.py(guide.from)
          const x2 = projection.px(guide.to)
          const y2 = projection.py(guide.to)
          const length = Math.hypot(x2 - x1, y2 - y1) || 1
          const ux = (x2 - x1) / length
          const uy = (y2 - y1) / length
          return (
            <g key={guide.id}>
              <line className={css.acousticPathLine} x1={x1} y1={y1} x2={x2} y2={y2} />
              <path
                className={css.acousticPathHead}
                d={headAt((x1 + x2) / 2 + ux * 14, (y1 + y2) / 2 + uy * 14, ux, uy, 8)}
              />
              {guide.label === undefined ? null : (
                <text
                  className={css.acousticPathLabel}
                  x={(x1 + x2) / 2}
                  y={y1 - 7}
                  textAnchor="middle"
                >
                  {guide.label}
                </text>
              )}
            </g>
          )
        })
        : null}

      {view.dimensions.map(dimension => (
        <Dimension key={dimension.id} dimension={dimension} projection={projection} />
      ))}

      {/* Reflecting walls: heavy plate with the hatched back on +x */}
      {(view.acousticReflectors ?? []).map((wall) => {
        const x = projection.px(wall.at)
        const footY = projection.py(wall.at)
        const topY = projection.py({ x: 0, y: wall.at.y + 2 * wall.halfHeight })
        const hatchCount = Math.max(4, Math.floor((footY - topY) / 12))
        const highlighted = projection.highlighted(wall.id)
        return (
          <g key={wall.id} className={highlighted ? css.highlightGroup : undefined}>
            <line className={css.acousticWallPlate} x1={x} y1={topY} x2={x} y2={footY} />
            {Array.from({ length: hatchCount }, (_, index) => {
              const y = topY + ((index + 0.5) / hatchCount) * (footY - topY)
              return (
                <line
                  key={index}
                  className={css.acousticWallHatch}
                  x1={x + 2}
                  y1={y + 4.5}
                  x2={x + 9}
                  y2={y - 4.5}
                />
              )
            })}
            {wall.label === undefined ? null : (
              <text className={css.annotation} x={x} y={topY - 8} textAnchor="middle">
                {wall.label}
              </text>
            )}
          </g>
        )
      })}

      {/* Sound sources */}
      {(view.acousticSources ?? []).map((source) => {
        const x = projection.px(source.at)
        const footY = projection.py(source.at)
        return (
          <g key={source.id}>
            <SpeakerGlyph
              x={x}
              y={footY - speakerSize * 0.62}
              size={speakerSize}
              highlighted={projection.highlighted(source.id)}
            />
            {source.label === undefined ? null : (
              <text className={css.annotation} x={x} y={footY + 19} textAnchor="middle">
                {source.label}
              </text>
            )}
          </g>
        )
      })}

      {/* Trailing wavefront arcs, under the pulse dot */}
      {showWavefronts && pulse !== undefined
        ? (view.acousticWavefronts ?? []).map(front => (
          <path
            key={front.id}
            className={css.acousticWavefront}
            d={wavefrontArc(
              projection.px(front.at),
              projection.py(front.at),
              front.radius * projection.scale,
              front.direction === 'forward',
            )}
          />
        ))
        : null}

      {/* The pulse itself — green once the echo is home */}
      {pulse === undefined ? null : (
        <circle
          className={clsxJoin(
            css.acousticPulseDot,
            pulse.phase === 'received' && css.acousticPulseReceived,
            projection.highlighted(pulse.id) && css.highlightGroup,
          )}
          cx={projection.px(pulse.at)}
          cy={projection.py(pulse.at)}
          r={5}
        />
      )}
    </>
  )
}
