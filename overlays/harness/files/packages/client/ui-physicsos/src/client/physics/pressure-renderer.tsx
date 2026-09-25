/**
 * Pressure rigs renderer. A branch of the `fluid` renderer, the way the lever is
 * a branch of `mechanics`: the three pressure rigs are the same domain shelf as
 * the buoyancy tank and share its canvas, so they dispatch on `view.pressureRig`
 * rather than registering a domain of their own.
 *
 * It reads ONLY the shared visual model. How wide a contact face is, how deep a
 * probe sits, how tall the mercury stands and how long each pull arrow runs were
 * produced by the engine and framed upstream by the pressure visual bridge;
 * nothing is computed here. The few constants left below are ink: stroke shapes
 * and glyph sizes that carry no physics.
 *
 * One scene unit is one centimetre on every rig, so a dimension drawn between
 * two points carries a label that is literally the length on screen.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, Ground, MathLabel, Vectors } from './primitives.tsx'
import css from './renderers.module.css'

/** Lip the dish is drawn up to above its mercury surface. Ink, not a depth. */
const DISH_LIP = 3
/** Drawn radius of a probe, in scene centimetres. Ink, not an instrument size. */
const PROBE_RADIUS = 0.85

export function PressureRenderer({ view, projection }: RendererProps) {
  const rig = view.pressureRig
  const reading = view.visible.pressure === true
  const comparison = view.visible.pressureComparison === true

  if (rig === 'solid' && view.pressureSolid !== undefined) {
    const solid = view.pressureSolid
    const ground = view.ground
    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {ground === undefined ? null : <Ground ground={ground} projection={projection} />}

        {/* Plates first, then the blocks on them, so a block is never buried. */}
        {solid.faces.map((face) => {
          const cx = projection.px(face.at)
          const tableY = projection.py(face.at)
          const halfWidth = face.halfWidth * projection.scale
          const blockTop = projection.py({ x: face.at.x, y: face.at.y + solid.halfHeight })
          const highlighted = projection.highlighted(face.id)
          return (
            <g key={face.id} className={highlighted ? css.highlightGroup : undefined}>
              <rect
                className={css.pressurePlate}
                x={cx - halfWidth}
                y={tableY}
                width={halfWidth * 2}
                height={solid.plateDepth * projection.scale}
                rx={1}
              />
              <rect
                className={css.pressureBlock}
                x={cx - halfWidth}
                y={blockTop}
                width={halfWidth * 2}
                height={tableY - blockTop}
                rx={2}
              />
              {/* The pressure lives INSIDE the block whose face produces it:
                  the two blocks carry the same F and different p, and reading
                  them side by side is the whole comparison. This is the rig's
                  dial, so it is drawn whatever the layers say. */}
              <text className={css.pressureReading} x={cx} y={(blockTop + tableY) / 2 + 4} textAnchor="middle">
                {face.pressureText}
              </text>
            </g>
          )
        })}

        {/* The shared force, drawn on the KNOT of the block's top face so the
            two arrows read as the same push on different areas. The label
            annotates the arrows, so it arrives and leaves with them. */}
        <Vectors
          vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
          projection={projection}
        />
        {reading ? (
          <MathLabel
            x={projection.px(solid.faces[0]?.at ?? solid.at)}
            y={projection.py({ x: 0, y: 2 * solid.halfHeight + 7.2 })}
            anchor="middle"
            symbol={solid.forceText}
            className={css.pressureReading}
          />
        ) : null}

        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  if (rig === 'liquid') {
    const vessels = [view.pressureLiquid, view.pressureComparisonLiquid].filter(
      (vessel): vessel is NonNullable<typeof vessel> => vessel !== undefined,
    )
    const probes = view.pressureProbes ?? []
    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {vessels.map((vessel) => {
          const left = projection.px({ x: vessel.left, y: 0 })
          const right = projection.px({ x: vessel.right, y: 0 })
          const surfaceY = projection.py({ x: 0, y: vessel.surface })
          const floorY = projection.py({ x: 0, y: vessel.floor })
          const rimY = surfaceY - vessel.rim * projection.scale
          const highlighted = projection.highlighted(vessel.id)
          return (
            <g key={vessel.id} className={highlighted ? css.highlightGroup : undefined}>
              <rect
                className={css.pressureLiquidBody}
                x={left}
                y={surfaceY}
                width={right - left}
                height={floorY - surfaceY}
              />
              {/* Vessel walls: up one side, across the floor, up the other. The
                  rim stops short of the top so the vessel reads as open. */}
              <path
                className={css.pressureVesselWall}
                d={`M${left} ${rimY} V${floorY} H${right} V${rimY}`}
              />
              <MathLabel
                x={(left + right) / 2}
                y={floorY + 16}
                anchor="middle"
                symbol={vessel.densityText}
                className={css.pressureVesselLabel}
              />
            </g>
          )
        })}

        {probes.map((probe) => {
          const cx = projection.px(probe.at)
          const cy = projection.py(probe.at)
          const radius = PROBE_RADIUS * projection.scale
          return (
            <g
              key={probe.id}
              data-testid={`pressure-probe-${probe.primary ? 'primary' : 'comparison'}`}
            >
              <circle className={css.pressureProbeBody} cx={cx} cy={cy} r={radius} />
              <circle className={css.pressureProbeDot} cx={cx} cy={cy} r={radius * 0.34} />
              {/* The probe is the rig's instrument and this is its dial. */}
              <MathLabel
                x={cx + radius + 5}
                y={cy + 4}
                anchor="start"
                symbol={probe.readingText}
                className={css.pressureReading}
              />
            </g>
          )
        })}

        {view.guides
          .filter(guide => view.visible[guide.observable] === true)
          .map(guide => (
            <g key={guide.id}>
              <line
                className={css.fluidSurfaceLine}
                x1={projection.px(guide.from)}
                y1={projection.py(guide.from)}
                x2={projection.px(guide.to)}
                y2={projection.py(guide.to)}
              />
              {guide.label === undefined ? null : (
                <MathLabel
                  x={(projection.px(guide.from) + projection.px(guide.to)) / 2 + 6}
                  y={(projection.py(guide.from) + projection.py(guide.to)) / 2 - 6}
                  anchor="start"
                  symbol={guide.label}
                  className={css.pressureGuideLabel}
                />
              )}
            </g>
          ))}
        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  if (rig === 'atmospheric' && view.pressureBarometer !== undefined) {
    const barometer = view.pressureBarometer
    const hemispheres = view.pressureHemispheres
    const boreX = projection.px(barometer.at)
    const halfWidth = barometer.halfWidth * projection.scale
    const surfaceY = projection.py(barometer.at)
    const columnTopY = projection.py({ x: barometer.at.x, y: barometer.columnTop })
    const tubeTopY = projection.py({ x: barometer.at.x, y: barometer.tubeTop })
    const poolX = barometer.dishHalfWidth * projection.scale
    const poolBottomY = surfaceY + barometer.dishDepth * projection.scale

    return (
      <>
        <defs>
          <ArrowMarkers uid={projection.uid} />
        </defs>

        {/* The dish and its pool stand behind the tube, so the glass reads as
            passing into the mercury rather than resting on it. */}
        <rect
          className={css.pressureMercuryPool}
          x={boreX - poolX}
          y={surfaceY}
          width={poolX * 2}
          height={poolBottomY - surfaceY}
        />
        <path
          className={css.pressureDish}
          d={`M${boreX - poolX} ${surfaceY - DISH_LIP * projection.scale} V${poolBottomY} H${boreX + poolX} V${surfaceY - DISH_LIP * projection.scale}`}
        />

        {/* Sealed tube: two walls joined by the rounded vacuum end. */}
        <path
          className={css.pressureTube}
          d={`M${boreX - halfWidth} ${poolBottomY} V${tubeTopY + halfWidth} A${halfWidth} ${halfWidth} 0 0 1 ${boreX + halfWidth} ${tubeTopY + halfWidth} V${poolBottomY}`}
        />
        {/* The standing column: its height IS p₀/(ρ_汞·g). */}
        <rect
          className={css.pressureMercury}
          x={boreX - halfWidth}
          y={columnTopY}
          width={halfWidth * 2}
          height={surfaceY - columnTopY}
        />
        {/* Part of the apparatus, not a reading: the empty end is what makes the
            column a mercury column rather than a tube of air. */}
        <text className={css.pressureVacuum} x={boreX} y={columnTopY - 8} textAnchor="middle">
          真空
        </text>
        <MathLabel
          x={boreX}
          y={surfaceY + 22}
          anchor="middle"
          symbol={barometer.pressureText}
          className={css.pressureReading}
        />

        {hemispheres === undefined ? null : (() => {
          const cx = projection.px(hemispheres.at)
          const cy = projection.py(hemispheres.at)
          const r = hemispheres.radius * projection.scale
          return (
            <g data-testid="magdeburg-hemispheres">
              {/* Two glass domes meeting on a washer, drawn as one sphere with
                  the joint marked — the shape the hands pull apart. */}
              <circle className={css.pressureHemisphere} cx={cx} cy={cy} r={r} />
              <line className={css.pressureHemisphereJoint} x1={cx} y1={cy - r} x2={cx} y2={cy + r} />
              {/* The force needed to part them: derived, so it rides the arrows. */}
              {comparison ? (
                <MathLabel
                  x={cx}
                  y={cy + r + 20}
                  anchor="middle"
                  symbol={hemispheres.forceText}
                  className={css.pressureReading}
                />
              ) : null}
            </g>
          )
        })()}

        <Vectors
          vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
          projection={projection}
        />

        {view.guides
          .filter(guide => view.visible[guide.observable] === true)
          .map(guide => (
            <g key={guide.id}>
              <line
                className={css.pressureGuide}
                x1={projection.px(guide.from)}
                y1={projection.py(guide.from)}
                x2={projection.px(guide.to)}
                y2={projection.py(guide.to)}
              />
              {/* At the line's midpoint, the way every other guide in the app
                  labels itself: a guide spans the frame, so its ends have no
                  room for text and its middle always does. */}
              {guide.label === undefined ? null : (
                <MathLabel
                  x={(projection.px(guide.from) + projection.px(guide.to)) / 2 + 6}
                  y={(projection.py(guide.from) + projection.py(guide.to)) / 2 - 6}
                  anchor="start"
                  symbol={guide.label}
                  className={css.pressureGuideLabel}
                />
              )}
            </g>
          ))}
        {view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))}
      </>
    )
  }

  return null
}
