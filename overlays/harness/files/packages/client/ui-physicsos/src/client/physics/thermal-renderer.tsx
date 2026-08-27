/**
 * Thermal renderer. Registered for `domain: 'thermal'` in the renderer registry.
 *
 * Draws the textbook heating bench: the beaker with the sample shaded solid or
 * liquid according to how much has melted, the heat source under it with its
 * power, the thermometer with its live column and reading, and the melting-point
 * reference line the column parks on. It reads ONLY the shared visual model —
 * the temperature and the melted fraction were produced by the engine and framed
 * upstream by the thermal visual bridge; nothing is computed here.
 *
 * Draw order is back-to-front: melting-point guide, heater, beaker and sample,
 * then the thermometer last so the reading being explained sits on top.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** The heat source: a burner body with three flame tongues. */
const HeaterGlyph = ({
  x,
  y,
  halfWidth,
}: {
  x: number
  y: number
  halfWidth: number
}) => (
  <g>
    <rect
      className={css.thermalHeaterBody}
      x={x - halfWidth}
      y={y}
      width={halfWidth * 2}
      height={halfWidth * 0.42}
      rx={halfWidth * 0.16}
    />
    {[-0.5, 0, 0.5].map(offset => (
      <path
        key={offset}
        className={css.thermalFlame}
        d={[
          `M${x + offset * halfWidth} ${y}`,
          `q${halfWidth * 0.2} ${-halfWidth * 0.34} 0 ${-halfWidth * 0.62}`,
          `q${-halfWidth * 0.2} ${halfWidth * 0.28} 0 ${halfWidth * 0.62}`,
          'z',
        ].join(' ')}
      />
    ))}
  </g>
)

export function ThermalRenderer({ view, projection }: RendererProps) {
  const showThermometer = view.visible.thermometer === true
  const showPhase = view.visible.phase === true
  const sample = view.thermalSample
  const thermometer = view.thermalThermometer
  const heater = view.thermalHeater

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* The melting point drawn across the bench: the level the column stops at */}
      {showPhase
        ? view.guides.map(guide => (
          <g key={guide.id}>
            <line
              className={css.thermalMeltingLine}
              x1={projection.px(guide.from)}
              y1={projection.py(guide.from)}
              x2={projection.px(guide.to)}
              y2={projection.py(guide.to)}
            />
            {guide.label === undefined ? null : (
              <text
                className={css.thermalMeltingLabel}
                x={projection.px(guide.to)}
                y={projection.py(guide.to) - 6}
                textAnchor="end"
              >
                {guide.label}
              </text>
            )}
          </g>
        ))
        : null}

      {/* Heat source under the beaker */}
      {heater === undefined ? null : (
        <g className={projection.highlighted(heater.id) ? css.highlightGroup : undefined}>
          <HeaterGlyph
            x={projection.px(heater.at)}
            y={projection.py(heater.at)}
            halfWidth={heater.halfWidth * projection.scale}
          />
          <text
            className={css.annotation}
            x={projection.px(heater.at)}
            y={projection.py(heater.at) + heater.halfWidth * projection.scale * 0.42 + 16}
            textAnchor="middle"
          >
            {heater.label === undefined ? heater.power : `${heater.label} ${heater.power}`}
          </text>
        </g>
      )}

      {/* Beaker with the sample: melted part shaded as liquid, the rest solid */}
      {sample === undefined ? null : (
        <g className={projection.highlighted(sample.id) ? css.highlightGroup : undefined}>
          <rect
            className={css.thermalSampleSolid}
            x={projection.px({ x: sample.at.x - sample.halfWidth, y: 0 })}
            y={projection.py({ x: 0, y: sample.at.y + sample.halfHeight })}
            width={sample.halfWidth * 2 * projection.scale}
            height={sample.halfHeight * 2 * projection.scale}
          />
          {sample.meltedFraction <= 0 ? null : (
            <rect
              className={clsxJoin(
                css.thermalSampleLiquid,
                sample.phase === 'melting' && css.thermalSampleMelting,
              )}
              x={projection.px({ x: sample.at.x - sample.halfWidth, y: 0 })}
              y={projection.py({
                x: 0,
                y: sample.at.y - sample.halfHeight + 2 * sample.halfHeight * sample.meltedFraction,
              })}
              width={sample.halfWidth * 2 * projection.scale}
              height={sample.halfHeight * 2 * projection.scale * sample.meltedFraction}
            />
          )}
          <path
            className={css.thermalBeakerWall}
            d={[
              `M${projection.px({ x: sample.at.x - sample.halfWidth, y: 0 })} ${projection.py({ x: 0, y: sample.at.y + sample.halfHeight + 1 })}`,
              `V${projection.py({ x: 0, y: sample.at.y - sample.halfHeight })}`,
              `H${projection.px({ x: sample.at.x + sample.halfWidth, y: 0 })}`,
              `V${projection.py({ x: 0, y: sample.at.y + sample.halfHeight + 1 })}`,
            ].join(' ')}
          />
          {sample.label === undefined ? null : (
            <text
              className={css.annotation}
              x={projection.px(sample.at)}
              y={projection.py({ x: 0, y: sample.at.y + sample.halfHeight + 1 }) - 8}
              textAnchor="middle"
            >
              {sample.label}
            </text>
          )}
        </g>
      )}

      {/* Thermometer last: the reading is what the whole frame is about */}
      {thermometer === undefined || !showThermometer ? null : (
        <g className={projection.highlighted(thermometer.id) ? css.highlightGroup : undefined}>
          <line
            className={css.thermalTube}
            x1={projection.px(thermometer.at)}
            y1={projection.py(thermometer.at)}
            x2={projection.px(thermometer.at)}
            y2={projection.py({ x: 0, y: thermometer.at.y + 15 })}
          />
          <line
            className={css.thermalColumn}
            x1={projection.px(thermometer.at)}
            y1={projection.py(thermometer.at)}
            x2={projection.px(thermometer.at)}
            y2={projection.py({ x: 0, y: thermometer.at.y + thermometer.columnHeight })}
          />
          <circle
            className={css.thermalBulb}
            cx={projection.px(thermometer.at)}
            cy={projection.py(thermometer.at)}
            r={6}
          />
          <text
            className={css.thermalReading}
            x={projection.px(thermometer.at) + 12}
            y={projection.py({ x: 0, y: thermometer.at.y + thermometer.columnHeight })}
          >
            {thermometer.reading}
          </text>
        </g>
      )}
    </>
  )
}
