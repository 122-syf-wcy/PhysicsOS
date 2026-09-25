/**
 * Noise rig renderer: the source, its wavefronts, the listener standing where it
 * stands, and whatever is between them.
 *
 * The distances are to scale (the bridge sized them in metres), so walking the
 * listener back moves it visibly past the inner wavefronts — and the level it
 * reads falls 6 dB for every doubling. That correspondence is the figure's whole
 * content, so nothing here is rescaled for looks.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { MathLabel } from './primitives.tsx'
import css from './renderers.module.css'

/** Drawn radius of the source glyph and the listener marker (scene metres). */
const SOURCE_RADIUS = 0.14
const LISTENER_RADIUS = 0.11
const BARRIER_HALF_HEIGHT = 0.5

export function NoiseRenderer({ view, projection }: RendererProps) {
  const rig = view.noiseRig
  if (rig === undefined) return null

  const sx = projection.px(rig.sourceAt)
  const sy = projection.py(rig.sourceAt)
  const lx = projection.px(rig.listenerAt)
  const ly = projection.py(rig.listenerAt)

  return (
    <>
      {/* The wavefronts: half-circles facing the listener, because that is where
          the sound it hears has got to. */}
      {rig.wavefronts.map((radius, index) => (
        <circle
          key={radius}
          className={css.noiseWavefront}
          data-testid={`noise-wavefront-${index}`}
          cx={sx}
          cy={sy}
          r={radius * projection.scale}
          opacity={0.5 - index * 0.9 * 0}
        />
      ))}

      {/* The barrier, when there is one — standing between them. */}
      {rig.barrierAt === undefined ? null : (
        <g data-testid="noise-barrier">
          <line
            className={css.noiseBarrier}
            x1={projection.px(rig.barrierAt)}
            y1={sy - BARRIER_HALF_HEIGHT * projection.scale}
            x2={projection.px(rig.barrierAt)}
            y2={sy + BARRIER_HALF_HEIGHT * projection.scale}
          />
        </g>
      )}

      {/* The source and the listener. */}
      <circle className={css.noiseSource} cx={sx} cy={sy} r={SOURCE_RADIUS * projection.scale} />
      <circle
        className={css.noiseListener}
        data-testid="noise-listener"
        cx={lx}
        cy={ly}
        r={LISTENER_RADIUS * projection.scale}
      />

      {/* The distance between them, drawn as a rule under the axis. */}
      <line
        className={css.noiseDistance}
        x1={sx}
        y1={sy + 0.62 * projection.scale}
        x2={lx}
        y2={sy + 0.62 * projection.scale}
      />

      <MathLabel
        x={sx}
        y={sy - 0.32 * projection.scale}
        anchor="start"
        symbol={rig.sourceText}
        className={css.currentReading}
      />
      <MathLabel
        x={lx + LISTENER_RADIUS * projection.scale + 5}
        y={ly - 4}
        anchor="start"
        symbol={rig.levelText}
        className={css.currentReading}
      />
      <MathLabel
        x={(sx + lx) / 2}
        y={sy + 0.62 * projection.scale + 16}
        anchor="middle"
        symbol={rig.distanceText}
        className={css.currentReading}
      />
      {rig.barrierAt === undefined ? null : (
        <MathLabel
          x={projection.px(rig.barrierAt)}
          y={sy - BARRIER_HALF_HEIGHT * projection.scale - 6}
          anchor="middle"
          symbol={rig.barrierText}
          className={css.currentReading}
        />
      )}
    </>
  )
}
