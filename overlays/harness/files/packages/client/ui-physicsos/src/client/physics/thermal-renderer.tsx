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
  time,
}: {
  x: number
  y: number
  halfWidth: number
  /** Scene clock in seconds; undefined draws a still flame. */
  time?: number | undefined
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
    {[-0.5, 0, 0.5].map((offset, index) => {
      /* Flicker is phase-locked to the scene clock, so it freezes on pause
         and reverses on scrub. The lean skews around the flame's base point
         (local origin) so the root stays planted on the burner. */
      const phase = (time ?? 0) * 7.1 + index * 2.3
      const sway = Math.sin(phase) * 0.8
      const lean = Math.sin(phase * 1.31 + 1.1) * 2.6
      return (
        <g
          key={offset}
          data-testid="thermal-flame"
          transform={`translate(${(x + offset * halfWidth + sway).toFixed(2)} ${y.toFixed(2)})`}
        >
          <path
            className={css.thermalFlame}
            transform={`skewX(${lean.toFixed(2)})`}
            d={[
              'M0 0',
              `q${halfWidth * 0.2} ${-halfWidth * 0.34} 0 ${-halfWidth * 0.62}`,
              `q${-halfWidth * 0.2} ${halfWidth * 0.28} 0 ${halfWidth * 0.62}`,
              'z',
            ].join(' ')}
          />
        </g>
      )
    })}
  </g>
)

const BeakerGlyph = ({
  sample,
  projection,
}: {
  sample: NonNullable<RendererProps['view']['thermalSample']>
  projection: RendererProps['projection']
}) => {
  const left = projection.px({ x: sample.at.x - sample.halfWidth, y: 0 })
  const right = projection.px({ x: sample.at.x + sample.halfWidth, y: 0 })
  const top = projection.py({ x: 0, y: sample.at.y + sample.halfHeight })
  const bottom = projection.py({ x: 0, y: sample.at.y - sample.halfHeight })
  const rim = 5
  const corner = Math.min(9, (bottom - top) * 0.12)
  const liquidTop = sample.meltedFraction <= 0
    ? null
    : projection.py({
      x: 0,
      y: sample.at.y - sample.halfHeight + 2 * sample.halfHeight * sample.meltedFraction,
    })
  return (
    <g className={projection.highlighted(sample.id) ? css.highlightGroup : undefined}>
      <rect
        className={css.thermalSampleSolid}
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
      />
      {liquidTop === null ? null : (
        <>
          <rect
            className={clsxJoin(
              css.thermalSampleLiquid,
              /* Both plateaus are the same kind of moment — heat going in,
                 temperature standing still — so they share one ink. */
              (sample.phase === 'melting' || sample.phase === 'boiling') &&
                css.thermalSampleMelting,
            )}
            x={left}
            y={liquidTop}
            width={right - left}
            height={bottom - liquidTop}
          />
          {/* The liquid's free surface: a meniscus line is what makes the
              melted fraction read as a level, not a second fill. */}
          <line
            className={css.thermalSurface}
            x1={left}
            y1={liquidTop}
            x2={right}
            y2={liquidTop}
          />
        </>
      )}
      {/* Glass beaker: an open-top vessel with a lip on both walls and a
          rounded bottom corner — the silhouette of labware, not a U. */}
      <path
        className={css.thermalBeakerWall}
        d={[
          `M${left - rim} ${top - rim}`,
          `L${left} ${top}`,
          `V${bottom - corner}`,
          `Q${left} ${bottom} ${left + corner} ${bottom}`,
          `H${right - corner}`,
          `Q${right} ${bottom} ${right} ${bottom - corner}`,
          `V${top}`,
          `L${right + rim} ${top - rim}`,
        ].join(' ')}
      />
      {sample.label === undefined ? null : (
        <text
          className={css.annotation}
          x={projection.px(sample.at)}
          y={top - 9}
          textAnchor="middle"
        >
          {sample.label}
        </text>
      )}
    </g>
  )
}

const ThermometerGlyph = ({
  thermometer,
  projection,
}: {
  thermometer: NonNullable<RendererProps['view']['thermalThermometer']>
  projection: RendererProps['projection']
}) => {
  const cx = projection.px(thermometer.at)
  const bulbY = projection.py(thermometer.at)
  const tubeTop = projection.py({ x: 0, y: thermometer.at.y + 15 })
  const columnTop = projection.py({ x: 0, y: thermometer.at.y + thermometer.columnHeight })
  const tubeW = 9
  const ticks = [0.2, 0.4, 0.6, 0.8]
  return (
    <g className={projection.highlighted(thermometer.id) ? css.highlightGroup : undefined}>
      {/* The instrument: a glass tube (rounded capsule) holding a red column
          that grows out of the bulb, with scale ticks on the right. */}
      <rect
        className={css.thermalTubeOuter}
        x={cx - tubeW / 2}
        y={tubeTop}
        width={tubeW}
        height={bulbY - tubeTop}
        rx={tubeW / 2}
      />
      <line
        className={css.thermalColumn}
        x1={cx}
        y1={bulbY}
        x2={cx}
        y2={columnTop}
      />
      <circle
        className={css.thermalBulb}
        cx={cx}
        cy={bulbY}
        r={7}
      />
      {ticks.map(fraction => (
        <line
          key={fraction}
          className={css.thermalTick}
          x1={cx + tubeW / 2}
          y1={bulbY - fraction * (bulbY - tubeTop)}
          x2={cx + tubeW / 2 + 4}
          y2={bulbY - fraction * (bulbY - tubeTop)}
        />
      ))}
      <text
        className={css.thermalReading}
        x={cx + tubeW / 2 + 8}
        y={columnTop + 4}
      >
        {thermometer.reading}
      </text>
    </g>
  )
}

const HeaterLabel = ({
  heater,
  projection,
  time,
}: {
  heater: NonNullable<RendererProps['view']['thermalHeater']>
  projection: RendererProps['projection']
  time?: number | undefined
}) => (
  <g className={projection.highlighted(heater.id) ? css.highlightGroup : undefined}>
    <HeaterGlyph
      x={projection.px(heater.at)}
      y={projection.py(heater.at)}
      halfWidth={heater.halfWidth * projection.scale}
      time={time}
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
)

export function ThermalRenderer({ view, projection, time }: RendererProps) {
  const showThermometer = view.visible.thermometer === true
  const showPhase = view.visible.phase === true
  const sample = view.thermalSample
  const thermometer = view.thermalThermometer
  const heater = view.thermalHeater
  const comparisonSample = view.thermalComparisonSample
  const comparisonThermometer = view.thermalComparisonThermometer
  const comparisonHeater = view.thermalComparisonHeater

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

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

      {heater === undefined
        ? null
        : <HeaterLabel heater={heater} projection={projection} time={time} />}
      {comparisonHeater === undefined
        ? null
        : <HeaterLabel heater={comparisonHeater} projection={projection} time={time} />}

      {sample === undefined ? null : <BeakerGlyph sample={sample} projection={projection} />}
      {comparisonSample === undefined
        ? null
        : <BeakerGlyph sample={comparisonSample} projection={projection} />}

      {thermometer === undefined || !showThermometer
        ? null
        : <ThermometerGlyph thermometer={thermometer} projection={projection} />}
      {comparisonThermometer === undefined || !showThermometer
        ? null
        : <ThermometerGlyph thermometer={comparisonThermometer} projection={projection} />}
    </>
  )
}
