/**
 * Current-magnetic rigs renderer. A branch of the `magnetic` renderer, the way
 * the pressure rigs are a branch of `fluid`: the two benches are the same
 * domain shelf as the Lorentz particle scene and share its canvas, so they
 * dispatch on `view.currentRig` rather than registering a domain of their own.
 *
 * It reads ONLY the shared visual model. Where the conductor pierces the page,
 * how far out each probe sits, how many loops the coil is drawn with and which
 * end is north were all produced by the engine and framed upstream by the
 * current visual bridge; nothing is computed here. The constants below are ink:
 * glyph sizes and stroke geometry that carry no physics.
 *
 * One scene unit is one centimetre on both rigs, so a dimension drawn between
 * two points carries a label that is literally the length on screen.
 */

import type { RendererProps } from './renderer-registry.tsx'
import type { ScenePoint } from './scene-visual-model.ts'
import { ArrowMarkers, Dimension, MathLabel, Vectors } from './primitives.tsx'
import css from './renderers.module.css'

/** Drawn radius of the conductor where it pierces the page, in scene centimetres. */
const WIRE_SYMBOL_RADIUS = 1.5
/** Half-length of the ⊗ cross's arms, as a fraction of that radius. */
const WIRE_CROSS = 0.62
/** Drawn width of a coil turn loop, as a fraction of the loop spacing. */
const COIL_LOOP_RX = 0.44
/** How far outside the coil the pole letters sit, in scene centimetres. */
const POLE_OFFSET = 3.4

/**
 * Where the circulation arrowheads sit on a field ring, in scene angles. Three
 * of them, spread out, so the sense of the circulation is readable without
 * following the whole circle around.
 */
const CIRCULATION_ANGLES = [Math.PI / 3, Math.PI, (5 * Math.PI) / 3] as const
/** Drawn length of one arrowhead, in pixels. Ink: it marks a sense, not a size. */
const CIRCULATION_ARROW = 7

/**
 * Screen-space tangent of a ring at a scene angle.
 *
 * The scene's y axis points up and the screen's points down, so a
 * counter-clockwise circulation in the physics is drawn counter-clockwise on
 * the page only after the flip — which is why the tangent is derived from the
 * projected point rather than copied from the bridge.
 */
const ringTangent = (angle: number, circulation: 1 | -1): { x: number; y: number } =>
  circulation === 1
    ? { x: -Math.sin(angle), y: -Math.cos(angle) }
    : { x: Math.sin(angle), y: Math.cos(angle) }

/** A point and the unit direction of the polyline through it, in screen pixels. */
const alongPolyline = (
  points: readonly ScenePoint[],
  fraction: number,
): { at: ScenePoint; direction: ScenePoint } | undefined => {
  const segments = points.slice(1).flatMap((to, index) => {
    const from = points[index]
    if (from === undefined) return []
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return [{ from, to, length }]
  })
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (total === 0) return undefined
  let remaining = Math.min(Math.max(fraction, 0), 1) * total
  for (const segment of segments) {
    if (remaining > segment.length) {
      remaining -= segment.length
      continue
    }
    const t = segment.length === 0 ? 0 : remaining / segment.length
    return {
      at: {
        x: segment.from.x + (segment.to.x - segment.from.x) * t,
        y: segment.from.y + (segment.to.y - segment.from.y) * t,
      },
      direction: {
        x: (segment.to.x - segment.from.x) / segment.length,
        y: (segment.to.y - segment.from.y) / segment.length,
      },
    }
  }
  return undefined
}

/**
 * An arrowhead pointing along a direction. Drawn twice: once in the canvas ink
 * with a wide round join, once in the field colour. The field lines of a coil
 * run through the copper, so without the halo an arrowhead that lands between
 * two turns reads as a smudge on the wire rather than as a direction.
 */
const fieldArrow = (at: ScenePoint, direction: ScenePoint, size: number): string => {
  const perp = { x: -direction.y, y: direction.x }
  const tip = { x: at.x + direction.x * size, y: at.y + direction.y * size }
  const back = { x: at.x - direction.x * size * 0.5, y: at.y - direction.y * size * 0.5 }
  const half = size * 0.52
  return `M${tip.x} ${tip.y} L${back.x + perp.x * half} ${back.y + perp.y * half} L${back.x - perp.x * half} ${back.y - perp.y * half} Z`
}

/** Drawn length of a field-line arrowhead, in pixels. Ink, not a magnitude. */
const FIELD_ARROW_SIZE = 10

/** One arrowhead on a ring, drawn as a filled triangle pointing along the tangent. */
const circulationArrow = (cx: number, cy: number, radius: number, angle: number, circulation: 1 | -1) => {
  const px = cx + radius * Math.cos(angle)
  const py = cy - radius * Math.sin(angle)
  const tangent = ringTangent(angle, circulation)
  const perp = { x: -tangent.y, y: tangent.x }
  const tip = {
    x: px + tangent.x * CIRCULATION_ARROW,
    y: py + tangent.y * CIRCULATION_ARROW,
  }
  const back = { x: px - tangent.x * 1.4, y: py - tangent.y * 1.4 }
  const half = CIRCULATION_ARROW * 0.42
  return `M${tip.x} ${tip.y} L${back.x + perp.x * half} ${back.y + perp.y * half} L${back.x - perp.x * half} ${back.y - perp.y * half} Z`
}

export function CurrentRenderer({ view, projection }: RendererProps) {
  const rig = view.currentRig

  if (rig === 'straight_wire' && view.currentWire !== undefined) {
    const wire = view.currentWire
    const circles = view.currentFieldCircles ?? []
    const probes = view.currentProbes ?? []
    const cx = projection.px(wire.at)
    const cy = projection.py(wire.at)
    const symbol = WIRE_SYMBOL_RADIUS * projection.scale
    const cross = symbol * WIRE_CROSS

    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {/* The field is a set of concentric rings around the conductor. The
            probe rings are the ones the readings are taken on; the others are
            the same field at radii nobody measured. */}
        {circles.map((circle) => {
          const radius = circle.radius * projection.scale
          return (
            /* Named by the circle's own id: two rings carry a probe, so a single
               `probe` test id would be ambiguous to anything measuring them. */
            <g key={circle.id} data-testid={`current-ring-${circle.id}`}>
              <circle
                className={circle.probe ? css.currentProbeRing : css.currentFieldRing}
                cx={cx}
                cy={cy}
                r={radius}
              />
              {CIRCULATION_ANGLES.map(angle => (
                <path
                  key={angle}
                  className={css.currentFieldArrow}
                  d={circulationArrow(cx, cy, radius, angle, circle.circulation)}
                />
              ))}
            </g>
          )
        })}

        {/* The conductor, drawn END-ON: ⊙ current out of the page, ⊗ into it.
            This is the glyph 安培定则 is stated about. */}
        <g data-testid="current-conductor">
          <circle className={css.currentWireSymbol} cx={cx} cy={cy} r={symbol} />
          {wire.direction === 1 ? (
            <circle className={css.currentWireDot} cx={cx} cy={cy} r={symbol * 0.42} />
          ) : (
            <path
              className={css.currentWireCross}
              d={`M${cx - cross} ${cy - cross} L${cx + cross} ${cy + cross} M${cx + cross} ${cy - cross} L${cx - cross} ${cy + cross}`}
            />
          )}
        </g>
        {/* Captioned above the outermost ring: the field map is a set of
            concentric circles, so the one band with no ring and no dimension in
            it is the space beyond the last one. */}
        <MathLabel
          x={cx}
          y={cy - circles.reduce((outer, circle) => Math.max(outer, circle.radius), 0) * projection.scale - 12}
          anchor="middle"
          symbol={wire.currentText}
          className={css.currentReading}
        />

        {probes.map((probe) => {
          const probeX = projection.px(probe.at)
          const probeY = projection.py(probe.at)
          const role = probe.primary ? 'primary' : 'comparison'
          /* The reading stays ON its probe's ray but moves out to the middle of
             the gap between its own ring and the next one. A 35 px label reaches
             about 19 px either way along a 45° ray, and the band between the
             conductor and the first ring is narrower than that — the gap
             OUTSIDE the ring it was taken on is not, and the shared ray is what
             still ties the number to its probe. */
          const dx = probe.at.x - wire.at.x
          const dy = probe.at.y - wire.at.y
          const ray = Math.hypot(dx, dy) || 1
          const radius = ray * projection.scale
          const next =
            circles
              .map(circle => circle.radius * projection.scale)
              .filter(candidate => candidate > radius + 1)
              .sort((left, right) => left - right)[0] ?? radius * 1.35
          const along = (radius + next) / 2
          const readingX = cx + (dx / ray) * along
          const readingY = cy - (dy / ray) * along
          return (
            <g key={probe.id} data-testid={`current-probe-${role}`}>
              {/* The marker carries its own id: the group also holds the reading
                  label, so anything measuring where the probe SITS has to be
                  able to ask for the dot rather than for the group's box. */}
              <circle
                className={css.currentProbeBody}
                data-testid={`current-probe-dot-${role}`}
                cx={probeX}
                cy={probeY}
                r={4}
              />
              <circle className={css.currentProbeDot} cx={probeX} cy={probeY} r={1.6} />
              {/* The probe is the bench's instrument and this is its dial. */}
              <MathLabel
                x={readingX}
                y={readingY + 4}
                anchor="middle"
                symbol={probe.readingText}
                className={css.currentReading}
              />
            </g>
          )
        })}

        <Vectors
          vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
          projection={projection}
        />

        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  if ((rig === 'solenoid' || rig === 'electromagnet') && view.currentCoil !== undefined) {
    const coil = view.currentCoil
    const core = view.currentCore
    const lines = view.currentFieldLines ?? []
    const centreX = projection.px(coil.at)
    const centreY = projection.py(coil.at)
    const halfLength = coil.halfLength * projection.scale
    const radius = coil.radius * projection.scale
    const spacing = (2 * halfLength) / Math.max(coil.loopCount, 1)
    const loops = Array.from({ length: coil.loopCount }, (_, index) => index)

    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {/* The core, drawn UNDER the winding: the coil wraps the iron, so the
            turns cross in front of the bar — but the bar is opaque, so it goes
            under the field lines too, or it would hide the axial line the
            reading is taken on. */}
        {core === undefined ? null : (() => {
          const coreEnd = core.halfLength * projection.scale
          const armatureHalfWidth = core.armatureHalfWidth * projection.scale
          const armatureHalfHeight = core.armatureHalfHeight * projection.scale
          const armatureCentre =
            centreX + core.northPole * (coreEnd + armatureHalfWidth)
          /* The pull is drawn on the armature, pointing at the pole that holds
             it: the arrow is the force the magnet exerts, and the mass beside it
             is what that force would balance. */
          const pullDirection = -core.northPole
          const pullPath = fieldArrow(
            { x: armatureCentre + pullDirection * armatureHalfWidth * 0.5, y: centreY },
            { x: pullDirection, y: 0 },
            FIELD_ARROW_SIZE,
          )
          const labelX =
            armatureCentre + core.northPole * (armatureHalfWidth + 8)
          return (
            <g data-testid="current-core">
              <rect
                className={css.currentCoreBar}
                x={centreX - coreEnd}
                y={centreY - core.halfHeight * projection.scale}
                width={2 * coreEnd}
                height={2 * core.halfHeight * projection.scale}
                rx={1.5}
              />
              {/* The core's own property, written BESIDE the winding rather than
                  on it: on the bar it would sit across the turns, and a reading
                  the copper runs through is a reading nobody can read. */}
              <MathLabel
                x={centreX - coreEnd - 8}
                y={centreY - radius - 9}
                anchor="end"
                symbol={core.coreText}
                className={css.currentReading}
              />
              <rect
                className={css.currentArmature}
                data-testid="current-armature"
                x={armatureCentre - armatureHalfWidth}
                y={centreY - armatureHalfHeight}
                width={2 * armatureHalfWidth}
                height={2 * armatureHalfHeight}
                rx={1.2}
              />
              <path className={css.currentFieldArrowHalo} d={pullPath} />
              <path className={css.currentFieldArrow} d={pullPath} />
              <MathLabel
                x={labelX}
                y={centreY - 6}
                anchor={core.northPole === 1 ? 'start' : 'end'}
                symbol={core.pullText}
                className={css.currentReading}
              />
              <MathLabel
                x={labelX}
                y={centreY + 14}
                anchor={core.northPole === 1 ? 'start' : 'end'}
                symbol={core.heldMassText}
                className={css.currentReading}
              />
            </g>
          )
        })()}

        {/* Field lines, over the core and under the copper — each with a halo,
            because the axial one crosses the iron block and a slate line on a
            slate bar reads as neither. The arrowheads come last, on top. */}
        {lines.map((line) => {
          const points = line.points
            .map(point => `${projection.px(point)},${projection.py(point)}`)
            .join(' ')
          return (
            <g key={line.id} data-testid={`current-field-line-${line.probe ? 'axis' : 'loop'}`}>
              <polyline className={css.currentFieldLineHalo} points={points} />
              <polyline
                className={line.probe ? css.currentAxisLine : css.currentFieldLine}
                points={points}
              />
            </g>
          )
        })}

        <g data-testid="current-coil">
          {loops.map(index => (
            <ellipse
              key={index}
              className={css.currentCoilLoop}
              cx={centreX - halfLength + spacing * (index + 0.5)}
              cy={centreY}
              rx={spacing * COIL_LOOP_RX}
              ry={radius}
            />
          ))}
        </g>

        {/* The poles: 安培定则's thumb end gets the N, and the other end the S. */}
        {([1, -1] as const).map(side => (
          <text
            key={side}
            className={css.currentPoleLabel}
            data-testid={`current-pole-${coil.northPole === side ? 'north' : 'south'}`}
            x={centreX + side * (halfLength + POLE_OFFSET * projection.scale)}
            y={centreY + 5}
            textAnchor="middle"
          >
            {coil.northPole === side ? 'N' : 'S'}
          </text>
        ))}

        <MathLabel
          x={centreX - halfLength}
          y={centreY - radius - 9}
          anchor="start"
          symbol={coil.currentText}
          className={css.currentReading}
        />
        {/* The rig's dial, over the coil it measures and clear of the turns. */}
        <MathLabel
          x={centreX + halfLength * 0.45}
          y={centreY - radius - 9}
          anchor="middle"
          symbol={coil.fieldText}
          className={css.currentReading}
        />
        <MathLabel
          x={centreX - halfLength}
          y={centreY + radius + 17}
          anchor="start"
          symbol={coil.turnsText}
          className={css.currentReading}
        />
        {coil.comparisonTurnsText === undefined ? null : (
          <MathLabel
            x={centreX + halfLength}
            y={centreY + radius + 17}
            anchor="end"
            symbol={coil.comparisonTurnsText}
            className={css.currentReading}
          />
        )}

        {/* The arrows that make the lines mean something. On top of everything
            else, because a field line drawn through a coil is mostly copper. */}
        {lines.flatMap((line) => {
          const screen = line.points.map(point => ({
            x: projection.px(point),
            y: projection.py(point),
          }))
          return (line.arrowAt ?? []).flatMap((fraction, index) => {
            const mark = alongPolyline(screen, fraction)
            if (mark === undefined) return []
            const path = fieldArrow(mark.at, mark.direction, FIELD_ARROW_SIZE)
            return [
              <path
                key={`${line.id}-halo-${index}`}
                className={css.currentFieldArrowHalo}
                d={path}
              />,
              <path
                key={`${line.id}-arrow-${index}`}
                className={css.currentFieldArrow}
                d={path}
              />,
            ]
          })
        })}

        <Vectors
          vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
          projection={projection}
        />

        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  if (rig === 'motor' && view.currentRotor !== undefined) {
    const rotor = view.currentRotor
    const cx = projection.px(rotor.at)
    const cy = projection.py(rotor.at)
    const ends = rotor.sides.map(side => ({
      x: projection.px(side),
      y: projection.py(side),
    }))
    /* The spin arrow: an arc through the side of the rotor, drawn in the sense
       the current dictates, with its head at the end that has been reached. */
    const spinRadius = (rotor.halfWidth + 3.4) * projection.scale
    const span = (35 * Math.PI) / 180
    const from = rotor.sense === 1 ? -span : span
    const to = -from
    const at = (angle: number) => ({
      x: cx + spinRadius * Math.cos(angle),
      y: cy - spinRadius * Math.sin(angle),
    })
    const start = at(from)
    const end = at(to)
    const spinPath = `M${start.x} ${start.y} A${spinRadius} ${spinRadius} 0 0 ${rotor.sense === 1 ? 0 : 1} ${end.x} ${end.y}`
    const head = fieldArrow(end, ringTangent(to, rotor.sense), FIELD_ARROW_SIZE)

    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {/* The coil, seen end-on: the line between the two sides that carry the
            force, and those sides drawn as the conductors they are. */}
        <g data-testid="current-rotor">
          <line
            className={css.motorCoil}
            x1={ends[0]?.x ?? cx}
            y1={ends[0]?.y ?? cy}
            x2={ends[1]?.x ?? cx}
            y2={ends[1]?.y ?? cy}
          />
          {ends.map((side, index) => (
            <circle
              key={index}
              className={css.motorSide}
              data-testid={`motor-side-${index + 1}`}
              cx={side.x}
              cy={side.y}
              r={4.6}
            />
          ))}
          {/* The axis the coil turns about — where the commutator sits. */}
          <circle className={css.motorAxis} cx={cx} cy={cy} r={3.4} />
        </g>

        <path className={css.motorSpin} data-testid="motor-spin" d={spinPath} />
        <path className={css.motorSpinHalo} d={head} />
        <path className={css.motorSpinArrow} d={head} />

        {/* To the LEFT of the rotor, in the open band the field rows leave
            between them. Not above it: the readout panel is drawn over the
            canvas AFTER the renderers and its background reaches past the last
            thing it says, so a label up there is invisible rather than merely
            crowded — a fault no text-against-text check can see. */}
        <MathLabel
          x={cx - spinRadius - 16}
          y={cy - 10}
          anchor="end"
          symbol={`${rotor.torqueText} · ${rotor.angleText}`}
          className={css.currentReading}
        />
        <MathLabel
          x={cx - spinRadius - 16}
          y={cy + 18}
          anchor="end"
          symbol={rotor.currentText}
          className={css.currentReading}
        />
        <MathLabel
          x={cx - spinRadius - 16}
          y={cy + 35}
          anchor="end"
          symbol={rotor.turnsText}
          className={css.currentReading}
        />

        <Vectors
          vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
          projection={projection}
        />

        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  return null
}
