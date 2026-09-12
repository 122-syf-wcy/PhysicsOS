/**
 * Wave renderer. Registered for `domain: 'wave'` in the renderer registry.
 *
 * Draws the three textbook wave rigs from the shared visual model alone: the
 * rope profile with its marked particle and transverse-velocity arrow, the two
 * coherent sources with their spreading crests and the observation point carrying
 * the engine's verdict, and the clamped string with its envelope, nodes and
 * antinodes. Every point was sampled by the engine and framed upstream by the wave
 * visual bridge; nothing here evaluates a sine.
 *
 * Draw order is back-to-front: equilibrium line and envelope, crests, the
 * profile, construction dimensions, then nodes / sources / marker / point last so
 * the thing being explained sits on top.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, MathLabel, Vectors, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

export function WaveRenderer({ view, projection }: RendererProps) {
  const profile = view.waveProfile
  const marker = view.waveMarker
  const sources = view.waveSources ?? []
  const point = view.wavePoint
  const nodes = view.waveNodes ?? []
  const envelope = view.waveEnvelope
  const fronts = view.waveFronts ?? []
  const showWaveform = view.visible.waveform !== false

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* Equilibrium line the rope / string oscillates about */}
      {profile === undefined ? null : (
        <line
          className={css.waveEquilibrium}
          x1={projection.px(profile.equilibrium.from)}
          y1={projection.py(profile.equilibrium.from)}
          x2={projection.px(profile.equilibrium.to)}
          y2={projection.py(profile.equilibrium.to)}
        />
      )}

      {/* Apparatus ends: a standing-wave string is clamped at both ends;
          a travelling rope is driven by a vibrator at its left end. */}
      {profile === undefined ? null : (() => {
        const fromX = projection.px(profile.equilibrium.from)
        const fromY = projection.py(profile.equilibrium.from)
        const toX = projection.px(profile.equilibrium.to)
        const toY = projection.py(profile.equilibrium.to)
        if (profile.kind === 'string') {
          return (
            <g aria-hidden="true">
              {[fromX, toX].map((x, index) => (
                <g key={index}>
                  <rect
                    className={css.waveClamp}
                    x={x - (index === 0 ? 9 : 0)}
                    y={(index === 0 ? fromY : toY) - 9}
                    width={9}
                    height={18}
                  />
                  {[-6, 0, 6].map(offset => (
                    <line
                      key={offset}
                      className={css.waveClampHatch}
                      x1={x - (index === 0 ? 9 : 0) + offset + 7}
                      y1={(index === 0 ? fromY : toY) - 9}
                      x2={x - (index === 0 ? 9 : 0) + offset}
                      y2={(index === 0 ? fromY : toY) - 14}
                    />
                  ))}
                </g>
              ))}
            </g>
          )
        }
        /* Rope: driver box left of the first point, pin to the rope end. */
        return (
          <g aria-hidden="true">
            <rect
              className={css.waveDriver}
              x={fromX - 16}
              y={fromY - 8}
              width={11}
              height={16}
              rx={2}
            />
            <line
              className={css.waveDriverPin}
              x1={fromX - 5}
              y1={fromY}
              x2={fromX}
              y2={fromY}
            />
            <text className={css.annotation} x={fromX - 10} y={fromY + 22} textAnchor="middle">
              振源
            </text>
          </g>
        )
      })()}

      {/* Standing-wave envelope: the two curves the string never leaves */}
      {envelope === undefined || !showWaveform ? null : (
        <g className={projection.highlighted(envelope.id) ? css.highlightGroup : undefined} aria-hidden="true">
          <path className={css.waveEnvelope} d={projection.path(envelope.upper)} />
          <path className={css.waveEnvelope} d={projection.path(envelope.lower)} />
        </g>
      )}

      {/* Circular crests spreading from each interference source */}
      {fronts.length === 0 ? null : (
        <g className={css.waveFrontGroup} aria-hidden="true">
          {fronts.map(front => (
            <circle
              key={front.id}
              className={css.waveFront}
              cx={projection.px(front.center)}
              cy={projection.py(front.center)}
              r={front.radius * projection.scale}
            />
          ))}
        </g>
      )}

      {/* The sampled rope / string profile */}
      {profile === undefined || !showWaveform || profile.points.length < 2 ? null : (
        <g className={projection.highlighted(profile.id) ? css.highlightGroup : undefined}>
          <path
            className={profile.kind === 'rope' ? css.waveRope : css.waveString}
            d={projection.path(profile.points)}
          />
        </g>
      )}

      {/* Construction dimensions: λ, A, L, λ/2, r₁, r₂, d */}
      {view.dimensions.map(dimension => (
        <Dimension key={dimension.id} dimension={dimension} projection={projection} />
      ))}

      {/* Nodes (hollow, still) and antinodes (filled, largest swing) */}
      {view.visible.nodes === false
        ? null
        : nodes.map((node) => {
          const cx = projection.px(node.at)
          const cy = projection.py(node.at)
          const highlighted = projection.highlighted(node.id)
          return (
            <g key={node.id} className={highlighted ? css.highlightGroup : undefined}>
              <circle
                className={node.kind === 'node' ? css.waveNode : css.waveAntinode}
                cx={cx}
                cy={cy}
                r={node.kind === 'node' ? 4.2 : 3.4}
              />
              {node.label === undefined ? null : (
                /* Both labels sit above their mark: a node label below would
                   land on the axis tick row that shares the equilibrium line. */
                <text className={css.annotation} x={cx} y={cy - 9} textAnchor="middle">
                  {node.label}
                </text>
              )}
            </g>
          )
        })}

      {/* The two coherent sources: dipper stem above each contact dot */}
      {sources.map((source) => {
        const cx = projection.px(source.at)
        const cy = projection.py(source.at)
        return (
          <g key={source.id} className={projection.highlighted(source.id) ? css.highlightGroup : undefined}>
            <line
              className={css.waveSourceStem}
              x1={cx}
              y1={cy - 5}
              x2={cx}
              y2={cy - 15}
            />
            <rect
              className={css.waveSourceStem}
              x={cx - 4}
              y={cy - 20}
              width={8}
              height={6}
              rx={1.5}
            />
            <circle className={css.waveSource} cx={cx} cy={cy} r={5} />
            <text className={css.annotation} x={cx} y={cy + 17} textAnchor="middle">
              {source.label}
            </text>
          </g>
        )
      })}

      {/* Transverse-velocity arrow of the marked particle */}
      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] !== false)}
        projection={projection}
      />

      {/* The marked rope particle */}
      {marker === undefined || !showWaveform ? null : (() => {
        const cx = projection.px(marker.at)
        const cy = projection.py(marker.at)
        return (
          <g className={projection.highlighted(marker.id) ? css.highlightGroup : undefined}>
            <line className={css.waveMarkerGuide} x1={cx} y1={projection.py({ x: marker.at.x, y: 0 })} x2={cx} y2={cy} />
            <circle className={css.waveMarker} cx={cx} cy={cy} r={4.6} />
            <text className={css.annotation} x={cx + 9} y={cy - 8}>
              {marker.label}
            </text>
          </g>
        )
      })()}

      {/* Observation point P with the engine's verdict */}
      {point === undefined || view.visible.superposition === false ? null : (() => {
        const cx = projection.px(point.at)
        const cy = projection.py(point.at)
        const verdictClass =
          point.verdict === 'constructive'
            ? css.wavePointConstructive
            : point.verdict === 'destructive'
              ? css.wavePointDestructive
              : css.wavePointPartial
        return (
          <g className={projection.highlighted(point.id) ? css.highlightGroup : undefined}>
            <circle className={clsxJoin(css.wavePoint, verdictClass)} cx={cx} cy={cy} r={6} />
            <MathLabel
              x={cx + 11}
              y={cy - 10}
              anchor="start"
              symbol={point.readout}
              className={css.wavePointLabel}
            />
          </g>
        )
      })()}
    </>
  )
}
