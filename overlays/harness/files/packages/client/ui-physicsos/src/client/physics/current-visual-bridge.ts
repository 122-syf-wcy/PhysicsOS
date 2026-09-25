/**
 * Current-magnetic rigs → SceneVisualModel bridge.
 *
 * Projects the bench's verified field onto the shared visual contract. Every
 * drawn fact — the current symbol, the reading at each probe, the turn loops,
 * which end is north — comes from the Current Engine's resolved model and its
 * closed-form readings; this module only frames the apparatus, lays out the
 * circles, and formats strings. It never computes a field.
 *
 * Scene units are CENTIMETRES, the same as the pressure and buoyancy rigs: a
 * 5 cm probe distance is drawn 5 units out and a 20 cm coil is drawn 20 units
 * long, because the canvas projects with one uniform scale and a dimension
 * drawn between two points then carries a label that is literally the length on
 * screen.
 *
 * Two geometry decisions carry the physics:
 *
 *   - The straight wire is drawn END-ON. A 2D figure cannot show the circles
 *     around a conductor in the plane of the page, so the conductor pierces the
 *     page (⊙ out, ⊗ in) and the field is drawn as the concentric circles it
 *     really is. 安培定则 then reads straight off the drawing: thumb out of the
 *     page, fingers curl counter-clockwise, and the arrowheads follow.
 *   - The coil is drawn SIDE-ON with the field lines that leave one end and
 *     return to the other. The line along the axis is the one the reading is
 *     taken on; the two outside are the same field closing its loop.
 *
 * Layer rule, the same one every bench follows: the apparatus and the dial it
 * reads are always drawn; the annotation layer is gated. `fieldLines` carries
 * the derived marks (the probe circles, the field arrows, the distance and
 * length dimensions), and `fieldComparison` carries the second measurement —
 * the further probe or the second winding. `DimensionVisual` cannot carry an
 * observable key (the canvas draws dimensions unconditionally), so the bridge
 * omits an un-asked dimension instead of filtering it in the renderer.
 */

import {
  electromagnetFieldOf,
  motorReadingOf,
  solenoidFieldOf,
  straightWireFieldOf,
  type ResolvedCurrentModel,
} from '@physicsos/engine-magnetic'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  CurrentCoilVisual,
  CurrentCoreVisual,
  CurrentFieldCircleVisual,
  CurrentFieldLineVisual,
  CurrentProbeVisual,
  CurrentRigKind,
  CurrentWireVisual,
  MotorRotorVisual,
  DimensionVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
  VectorVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit every rig on this bridge is drawn in. */
const cm = (metres: number): number => metres * 100

/**
 * A field magnitude in the unit a student would quote it in.
 *
 * The lab conductor makes tens of microtesla and the coil makes millitesla —
 * one order of magnitude apart in the *apparatus*, so a single fixed unit would
 * print one of them as 0.00004 and the other as 12.566. The threshold picks the
 * prefix; the digits are the same four significant figures everywhere.
 */
const fieldText = (teslas: number): string => {
  const magnitude = Math.abs(teslas)
  if (magnitude < 1e-4) return `${fmtFluidValue(teslas * 1e6, 4)} µT`
  if (magnitude < 0.1) return `${fmtFluidValue(teslas * 1e3, 4)} mT`
  return `${fmtFluidValue(teslas, 4)} T`
}

const amperesText = (value: number): string => `${fmtFluidValue(value, 4)} A`
const cmText = (value: number): string => `${fmtFluidValue(value, 4)} cm`

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-current-field` / `observable-current-comparison` for both rigs, so
 * the key rides on the id rather than the observable type.
 */
export const currentObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-field')) return 'fieldLines'
  if (id.endsWith('-comparison')) return 'fieldComparison'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = currentObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Which of the two layers the frame is drawing. */
interface Layers {
  readonly field: boolean
  readonly comparison: boolean
}

/** Student-facing name of the rig the frame is showing. */
export const currentRigText = (type: CurrentRigKind): string => {
  switch (type) {
    case 'straight_wire':
      return '通电直导线周围的磁场'
    case 'solenoid':
      return '通电螺线管内部的磁场'
    case 'electromagnet':
      return '电磁铁：铁芯与吸力'
    case 'motor':
      return '电动机：安培力与力矩'
  }
}

/**
 * What one grid square is worth. Both rigs draw the grid but no axes (see the
 * frame below), so the readout has to state the scale the tick numbers would
 * have carried — otherwise a student can see the field's shape but not its size.
 */
const GRID_MINOR_TEXT = '1 cm'
const GRID_MAJOR_TEXT = '5 cm'

/* ------------------------------------------------------------- wire rig -- */

/** Drawn length of a field arrow, in scene centimetres. */
const WIRE_ARROW = 5.5
/** Where the two probes sit on their circles: apart, so neither hides the other. */
const WIRE_PRIMARY_ANGLE = (3 * Math.PI) / 4
const WIRE_COMPARISON_ANGLE = -Math.PI / 4
/**
 * An apparatus-only ring beyond everything that was measured, as a multiple of
 * the FARTHEST probe distance. It carries no reading and no dimension: it is
 * there so the figure shows a field rather than a pair of rings, and it is drawn
 * outside the two measured rings because that is the one band the labels —
 * which sit just inside their own ring, on the probe's ray — leave empty.
 */
const WIRE_OUTER_RING_SCALE = 1.4
const WIRE_MARGIN = 9

interface WirePicture {
  readonly wire: CurrentWireVisual
  readonly circles: CurrentFieldCircleVisual[]
  readonly probes: CurrentProbeVisual[]
  readonly vectors: VectorVisual[]
  readonly dimensions: DimensionVisual[]
  readonly outerRadius: number
}

/** The tangent direction at an angle, in the circulation's sense. */
const tangentAt = (angle: number, circulation: 1 | -1): ScenePoint =>
  circulation === 1
    ? { x: -Math.sin(angle), y: Math.cos(angle) }
    : { x: Math.sin(angle), y: -Math.cos(angle) }

const wirePicture = (
  model: ResolvedCurrentModel & { type: 'straight_wire' },
  layers: Layers,
): WirePicture => {
  const reading = straightWireFieldOf(model)
  const r = cm(reading.probeDistance)
  const r2 = reading.comparisonDistance === undefined ? undefined : cm(reading.comparisonDistance)
  const circulation = reading.circulation

  const wire: CurrentWireVisual = {
    id: 'current-wire',
    at: { x: 0, y: 0 },
    currentText: `I = ${amperesText(reading.current)}`,
    direction: reading.circulation,
    label: '通电直导线',
  }

  const circles: CurrentFieldCircleVisual[] = []
  const probes: CurrentProbeVisual[] = []
  const vectors: VectorVisual[] = []
  const dimensions: DimensionVisual[] = []

  /* One ink ring outside the farthest probe: the field continues past the last
     point anyone measured, and that is worth drawing — but not at a radius that
     collides with a reading. */
  circles.push({
    id: 'field-ink-outer',
    center: { x: 0, y: 0 },
    radius: Math.max(r, r2 ?? r) * WIRE_OUTER_RING_SCALE,
    circulation,
    probe: false,
  })
  circles.push({
    id: 'field-probe',
    center: { x: 0, y: 0 },
    radius: r,
    circulation,
    probe: true,
  })

  if (layers.field) {
    const at = {
      x: r * Math.cos(WIRE_PRIMARY_ANGLE),
      y: r * Math.sin(WIRE_PRIMARY_ANGLE),
    }
    probes.push({
      id: 'probe-primary',
      at,
      readingText: fieldText(reading.field),
      primary: true,
    })
    const tangent = tangentAt(WIRE_PRIMARY_ANGLE, circulation)
    vectors.push({
      id: 'field-primary',
      role: 'field',
      observable: 'fieldLines',
      from: at,
      to: { x: at.x + tangent.x * WIRE_ARROW, y: at.y + tangent.y * WIRE_ARROW },
      symbol: 'B',
    })
    /* The dimension runs along the ray the probe sits on, so the number in the
       label is the distance the field was measured at. */
    dimensions.push({
      id: 'probe-distance',
      side: 'right',
      from: { x: 0, y: 0 },
      to: at,
      label: `r = ${cmText(r)}`,
    })
  }

  if (layers.comparison && r2 !== undefined && reading.comparisonField !== undefined) {
    circles.push({
      id: 'field-comparison',
      center: { x: 0, y: 0 },
      radius: r2,
      circulation,
      probe: true,
    })
    const at = {
      x: r2 * Math.cos(WIRE_COMPARISON_ANGLE),
      y: r2 * Math.sin(WIRE_COMPARISON_ANGLE),
    }
    probes.push({
      id: 'probe-comparison',
      at,
      readingText: fieldText(reading.comparisonField),
      primary: false,
    })
    const tangent = tangentAt(WIRE_COMPARISON_ANGLE, circulation)
    vectors.push({
      id: 'field-comparison',
      role: 'field',
      observable: 'fieldComparison',
      from: at,
      to: { x: at.x + tangent.x * WIRE_ARROW, y: at.y + tangent.y * WIRE_ARROW },
      symbol: 'B₂',
    })
    dimensions.push({
      id: 'comparison-distance',
      side: 'right',
      from: { x: 0, y: 0 },
      to: at,
      label: `r₂ = ${cmText(r2)}`,
    })
  }

  const outerRadius = Math.max(...circles.map(circle => circle.radius), r)
  return { wire, circles, probes, vectors, dimensions, outerRadius }
}

/* --------------------------------------------------------- solenoid rig -- */

/** Drawn radius of one turn loop, in scene centimetres. */
const COIL_RADIUS = 3.6
/** Loop counts are clamped to a range that reads as a coil at any turn count. */
const COIL_LOOP_MIN = 7
const COIL_LOOP_MAX = 15
const COIL_TURNS_PER_LOOP = 40
/** How far the outside field lines bulge beyond the coil, and how far they reach. */
const COIL_LOOP_OFFSET = 1.9
const COIL_OVERSHOOT = 7

interface CoilPicture {
  readonly coil: CurrentCoilVisual
  readonly fieldLines: CurrentFieldLineVisual[]
  readonly dimensions: DimensionVisual[]
  readonly halfExtent: { readonly x: number; readonly y: number }
}

/**
 * One field line that leaves the coil at its +x end, turns outside and comes
 * back in at the −x end. Scaled by `y`, so the axial line (y = 0) degenerates to
 * the straight run the reading is taken on while the flanking lines close the
 * loop the way the field does.
 */
const coilLoop = (halfLength: number, y: number): ScenePoint[] => [
  { x: -halfLength + 1.2, y },
  { x: halfLength - 1.2, y },
  { x: halfLength + COIL_OVERSHOOT * 0.55, y: y * 1.6 },
  { x: halfLength + COIL_OVERSHOOT, y: y * 3.1 },
  { x: halfLength + COIL_OVERSHOOT * 0.5, y: y * 4.1 },
  { x: -halfLength - COIL_OVERSHOOT * 0.5, y: y * 4.1 },
  { x: -halfLength - COIL_OVERSHOOT, y: y * 3.1 },
  { x: -halfLength - COIL_OVERSHOOT * 0.55, y: y * 1.6 },
  { x: -halfLength + 1.2, y },
]

/**
 * What the two coil rigs have in common: the winding, the current through it and
 * the field it makes. The solenoid reads that field directly; the electromagnet
 * threads a core through the same coils, so its picture is this one plus a bar.
 */
interface CoilFacts {
  readonly current: number
  readonly turns: number
  readonly coilLength: number
  /** The field the winding carries (T) — the core's or the air's, per rig. */
  readonly field: number
  readonly northPole: 1 | -1
  /** A second winding on the same former, when the rig compares two (solenoid). */
  readonly comparisonTurns?: number | undefined
}

const coilPicture = (coil: CoilFacts, layers: Layers): CoilPicture => {
  const length = cm(coil.coilLength)
  const halfLength = length / 2
  const loopCount = Math.min(
    COIL_LOOP_MAX,
    Math.max(COIL_LOOP_MIN, Math.round(coil.turns / COIL_TURNS_PER_LOOP)),
  )

  const visual: CurrentCoilVisual = {
    id: 'current-coil',
    at: { x: 0, y: 0 },
    halfLength,
    radius: COIL_RADIUS,
    loopCount,
    currentText: `I = ${amperesText(coil.current)}`,
    fieldText: `B = ${fieldText(coil.field)}`,
    northPole: coil.northPole,
    turnsText: `N = ${fmtFluidValue(coil.turns, 4)}`,
    ...(coil.comparisonTurns === undefined
      ? {}
      : { comparisonTurnsText: `N₂ = ${fmtFluidValue(coil.comparisonTurns, 4)}` }),
    label: '通电螺线管',
  }

  const fieldLines: CurrentFieldLineVisual[] = []
  const dimensions: DimensionVisual[] = []

  if (layers.field) {
    /* The line the reading is taken on runs the whole way through the coil and
       out both ends: the interior field is uniform, so a short stub would
       misrepresent it as local to the middle. It is ordered along the field —
       south end to north end — so its arrows point the way the field does, and
       reversing the current reverses the line instead of the drawing. */
    const reach = halfLength + COIL_OVERSHOOT + 2
    fieldLines.push({
      id: 'field-axis',
      points:
        coil.northPole === 1
          ? [{ x: -reach, y: 0 }, { x: reach, y: 0 }]
          : [{ x: reach, y: 0 }, { x: -reach, y: 0 }],
      probe: true,
      arrowAt: [0.3, 0.7],
    })
    dimensions.push({
      id: 'coil-length',
      from: { x: -halfLength, y: -COIL_RADIUS - 2.4 },
      to: { x: halfLength, y: -COIL_RADIUS - 2.4 },
      label: `L = ${cmText(length)}`,
    })
  }

  /* The outside lines are the same field closing its loop; they are apparatus,
     drawn whether or not the reading layer is on, and they are the reason the
     frame is taller than the coil. Each one is ordered the way the field comes
     back — north end round the outside to the south end — which is the opposite
     sense to the axial line, as it is in the physics. */
  for (const y of [COIL_LOOP_OFFSET, -COIL_LOOP_OFFSET]) {
    const loop = coilLoop(halfLength, y)
    fieldLines.push({
      id: `field-loop-${y > 0 ? 'upper' : 'lower'}`,
      points: coil.northPole === 1 ? loop : [...loop].reverse(),
      probe: false,
      arrowAt: [0.18, 0.6],
    })
  }

  return {
    coil: visual,
    fieldLines,
    dimensions,
    halfExtent: { x: halfLength + COIL_OVERSHOOT + 8, y: COIL_RADIUS + COIL_LOOP_OFFSET * 4.1 + 3 },
  }
}

/* -------------------------------------------------------- electromagnet -- */

/** Drawn half-height of the core bar, in scene centimetres. */
const CORE_HALF_HEIGHT = 1.5
/** How far the bar protrudes past the winding at each end. */
const CORE_OVERSHOOT = 3.2
/** Drawn half-height/width of the armature the pole holds; ink, not a size. */
const ARMATURE_HALF_HEIGHT = 2.1
const ARMATURE_HALF_WIDTH = 1.6
/** Scene centimetres left free beside the armature for the pull and mass labels. */
const ELECTROMAGNET_LABEL_ROOM = 13

/**
 * The core threaded through the coil, and the armature its pole face holds.
 *
 * Everything here is apparatus rather than annotation: the core, the armature
 * and the PULL are what the rig is FOR, so the renderer draws them with the
 * bench and gates only the field readings on the field layer —
 * `CurrentCoreVisual` carries both and the renderer picks.
 */
const corePicture = (
  model: ResolvedCurrentModel & { type: 'electromagnet' },
): CurrentCoreVisual => {
  const reading = electromagnetFieldOf(model)
  return {
    id: 'current-core',
    at: { x: 0, y: 0 },
    halfLength: cm(reading.coilLength) / 2 + CORE_OVERSHOOT,
    halfHeight: CORE_HALF_HEIGHT,
    northPole: reading.northPole,
    armatureHalfWidth: ARMATURE_HALF_WIDTH,
    armatureHalfHeight: ARMATURE_HALF_HEIGHT,
    coreText: `μ_r = ${fmtFluidValue(reading.coreRelativePermeability, 4)}`,
    airFieldText: `B₀ = ${fieldText(reading.airField)}`,
    pullText: `F = ${fmtFluidValue(reading.pull, 4)} N`,
    heldMassText: `m = ${fmtFluidValue(reading.heldMass, 4)} kg`,
    ...(reading.comparisonCoreRelativePermeability === undefined ||
    reading.comparisonPull === undefined
      ? {}
      : {
        comparisonCoreText: `μ_r₂ = ${fmtFluidValue(reading.comparisonCoreRelativePermeability, 4)}`,
        comparisonPullText: `F₂ = ${fmtFluidValue(reading.comparisonPull, 4)} N`,
      }),
    label: '电磁铁',
  }
}

/* ----------------------------------------------------------------- motor -- */

/** Drawn length of the force on each rotor side, in scene centimetres. */
const ROTOR_FORCE_ARROW = 6
/**
 * Where the stator-field arrows sit, how long they are, and which rows they take.
 *
 * No row on the axis: the field is uniform, so every arrow points the SAME way,
 * and the band through the middle is left to the rotor and to the labels that
 * name it. A field drawn pointing outward from the middle would be two fields.
 */
const MOTOR_FIELD_X = 12
const MOTOR_FIELD_ARROW = 4.5
const MOTOR_FIELD_ROWS = [5, -5] as const
/** Half the frame, in scene centimetres: room for the forces, the field and the labels. */
const MOTOR_HALF_EXTENT = { x: 17, y: 9.5 } as const

/**
 * The rotor, seen END-ON down its own axis.
 *
 * This is the view the couple is legible in. B is horizontal, so the force on
 * each force-carrying side is VERTICAL whatever angle the coil is at — the
 * angle changes the LEVERAGE, not the forces. At θ = 0 the two sides are level
 * and the couple is full strength; at θ = 90° they are one above the other and
 * the two arrows pull along a single line, so nothing turns. That is the
 * 平衡位置 drawn rather than described, and it is why a real motor needs a
 * commutator to get past it.
 */
const motorPicture = (
  model: ResolvedCurrentModel & { type: 'motor' },
): { rotor: MotorRotorVisual; vectors: VectorVisual[] } => {
  const reading = motorReadingOf(model)
  const halfWidth = cm(reading.coilWidth) / 2
  const along = { x: Math.cos(reading.angle), y: Math.sin(reading.angle) }
  const sides = [
    { x: -halfWidth * along.x, y: -halfWidth * along.y },
    { x: halfWidth * along.x, y: halfWidth * along.y },
  ]
  /* Which way the couple turns the coil is the current's sign — side one is
     pushed along +y when the current is positive, and the pair is the couple. */
  const push = reading.sense

  const vectors: VectorVisual[] = [
    ...sides.map((side, index) => ({
      id: `rotor-force-${index}`,
      role: 'force' as const,
      observable: 'fieldLines' as const,
      from: side,
      to: { x: side.x, y: side.y + (index === 1 ? push : -push) * ROTOR_FORCE_ARROW },
      symbol: 'F',
    })),
    /* The stator field, drawn as a lattice either side of the rotor so it never
       runs through the coil it is turning. */
    ...MOTOR_FIELD_ROWS.flatMap((y, row) =>
      ([1, -1] as const).map(side => ({
        id: `stator-field-${row}-${side}`,
        role: 'field' as const,
        observable: 'fieldLines' as const,
        /* Both sides point the same way — it is one field, not two. */
        from: { x: side * MOTOR_FIELD_X - MOTOR_FIELD_ARROW, y },
        to: { x: side * MOTOR_FIELD_X + MOTOR_FIELD_ARROW, y },
        symbol: 'B',
      })),
    ),
  ]

  return {
    rotor: {
      id: 'current-rotor',
      at: { x: 0, y: 0 },
      sides,
      forces: vectors
        .filter(vector => vector.id.startsWith('rotor-force'))
        .map(vector => ({ id: vector.id, from: vector.from, to: vector.to })),
      halfWidth,
      angle: reading.angle,
      sense: reading.sense,
      torqueText: `τ = ${fmtFluidValue(reading.torque, 4)} N·m`,
      forceText: `F = ${fmtFluidValue(reading.sideForce, 4)} N`,
      currentText: `I = ${amperesText(reading.current)}`,
      turnsText: `n = ${fmtFluidValue(reading.turns, 4)}`,
      angleText: `θ = ${fmtFluidValue((reading.angle * 180) / Math.PI, 4)}°`,
      fieldText: `B = ${fmtFluidValue(reading.field, 4)} T`,
      label: '电动机',
    },
    vectors,
  }
}

/* ------------------------------------------------------------------ frame -- */

export interface CurrentVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedCurrentModel
}

/** Build one current-magnetic frame from the engine's resolved model. */
export const currentSceneVisual = ({ scene, model }: CurrentVisualInput): SceneVisualModel => {
  const visible = visibilityOf(scene)
  const layers: Layers = {
    field: visible.fieldLines === true,
    comparison: visible.fieldComparison === true,
  }

  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)
    const picture = wirePicture(model, layers)
    const margin = WIRE_MARGIN
    const outer = picture.outerRadius + margin
    return emptyVisualModel('magnetic', {
      /* A square frame: the rig is a set of concentric circles, and a frame that
         was wider than it was tall would still draw them round — the projection
         is uniform — but it would leave the circles off-centre in the canvas. */
      extent: { width: 2 * outer, height: 2 * outer },
      origin: { x: -outer, y: -outer },
      grid: { minor: 1, major: 5 },
      /* No axes. The figure is a set of concentric rings around the conductor
         and its symmetry is the point, so an axis cross through their common
         centre adds nothing — and its tick numbers would land on the rings at
         exactly the radii the readings are taken at. The grid carries the scale
         and the readout says what a square is worth. */
      axes: { x: '', y: '' },
      tickStep: 5,
      currentRig: 'straight_wire',
      currentWire: picture.wire,
      currentFieldCircles: picture.circles,
      currentProbes: picture.probes,
      vectors: picture.vectors,
      dimensions: picture.dimensions,
      overlay: {
        readout: [
          '通电直导线 B = μ₀I/(2πr)',
          `I = ${amperesText(reading.current)} · r = ${cmText(cm(reading.probeDistance))} → B = ${fieldText(reading.field)}`,
          ...(reading.comparisonDistance === undefined || reading.comparisonField === undefined
            ? []
            : [
              `r₂ = ${cmText(cm(reading.comparisonDistance))} → B₂ = ${fieldText(reading.comparisonField)}（距离翻倍，磁场减半）`,
            ]),
          reading.circulation === 1
            ? '安培定则：右手握导线，拇指指向纸外 → 四指逆时针绕'
            : '安培定则：右手握导线，拇指指向纸里 → 四指顺时针绕',
          `网格：小格 ${GRID_MINOR_TEXT} · 大格 ${GRID_MAJOR_TEXT}`,
        ],
        scale: { label: '', length: 1 },
      },
      visible,
    })
  }

  if (model.type === 'electromagnet') {
    const reading = electromagnetFieldOf(model)
    const picture = coilPicture(
      {
        current: reading.current,
        turns: reading.turns,
        coilLength: reading.coilLength,
        /* The winding carries the CORE's field: that is the field this rig is
           about, and the air-cored one is drawn beside it as the baseline. */
        field: reading.field,
        northPole: reading.northPole,
      },
      layers,
    )
    const core = corePicture(model)
    /* Wider than the coil alone: the core protrudes, the armature hangs off its
       pole and the pull and mass are written beside that. The frame is sized
       from the visual's own numbers so a label cannot fall off the picture. */
    const extent = {
      x: core.halfLength + 2 * core.armatureHalfWidth + ELECTROMAGNET_LABEL_ROOM,
      y: picture.halfExtent.y,
    }
    return emptyVisualModel('magnetic', {
      extent: { width: 2 * extent.x, height: 2 * extent.y },
      origin: { x: -extent.x, y: -extent.y },
      grid: { minor: 1, major: 5 },
      axes: { x: '', y: '' },
      tickStep: 5,
      currentRig: 'electromagnet',
      currentCoil: picture.coil,
      currentCore: core,
      currentFieldLines: picture.fieldLines,
      dimensions: picture.dimensions,
      overlay: {
        readout: [
          '电磁铁 B = μ_r·μ₀(N/L)I · F = B²A/(2μ₀)',
          `I = ${amperesText(reading.current)} · n = ${fmtFluidValue(reading.turnDensity, 4)} 匝/米 · ${core.coreText}`,
          `空气芯 B₀ = ${fieldText(reading.airField)} → 插铁芯 B = ${fieldText(reading.field)}（μ_r 是乘在磁场上的）`,
          `极面 ${fmtFluidValue(reading.coreArea * 1e4, 4)} cm² → 吸力 F = ${fmtFluidValue(reading.pull, 4)} N（相当于 ${fmtFluidValue(reading.heldMass, 4)} kg 的重力）`,
          ...(reading.comparisonCoreRelativePermeability === undefined ||
          reading.comparisonPull === undefined
            ? []
            : [
              `换 μ_r₂ = ${fmtFluidValue(reading.comparisonCoreRelativePermeability, 4)} 的铁芯 → F₂ = ${fmtFluidValue(reading.comparisonPull, 4)} N（吸力按 μ_r 的平方变）`,
            ]),
          '安培定则：四指顺着电流环绕方向，拇指指向的那端是 N 极，铁块就吸在那里',
          `网格：小格 ${GRID_MINOR_TEXT} · 大格 ${GRID_MAJOR_TEXT}`,
        ],
        scale: { label: '', length: 1 },
      },
      visible,
    })
  }

  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    const picture = motorPicture(model)
    const rotor = picture.rotor
    const extent = MOTOR_HALF_EXTENT
    return emptyVisualModel('magnetic', {
      extent: { width: 2 * extent.x, height: 2 * extent.y },
      origin: { x: -extent.x, y: -extent.y },
      grid: { minor: 1, major: 5 },
      axes: { x: '', y: '' },
      tickStep: 5,
      currentRig: 'motor',
      currentRotor: rotor,
      vectors: picture.vectors,
      overlay: {
        readout: [
          '电动机 τ = n·B·I·A·cosθ',
          `B = ${fmtFluidValue(reading.field, 4)} T · I = ${amperesText(reading.current)} · n = ${fmtFluidValue(reading.turns, 4)} 匝`,
          `线圈 ${cmText(cm(reading.sideLength))} × ${cmText(cm(reading.coilWidth))} → 每条受力边 F = B·I·L = ${fmtFluidValue(reading.sideForce, 4)} N`,
          `力矩 ${rotor.torqueText}（θ = 0 时最大 ${fmtFluidValue(reading.peakTorque, 4)} N·m）`,
          rotor.sense === 1
            ? '左手定则：电流出纸面的一侧力朝上，线圈逆时针转'
            : '左手定则：电流反向，两侧的受力也反向，线圈顺时针转',
          '换向器：转过平衡位置（θ = 90°，力矩为零）时把电流反向一次，力矩回到原方向，线圈就一直朝一个方向转下去',
          `网格：小格 ${GRID_MINOR_TEXT} · 大格 ${GRID_MAJOR_TEXT}`,
        ],
        scale: { label: '', length: 1 },
      },
      visible,
    })
  }

  const reading = solenoidFieldOf(model)
  const picture = coilPicture(
    {
      current: reading.current,
      turns: reading.turns,
      coilLength: reading.coilLength,
      field: reading.field,
      northPole: reading.northPole,
      comparisonTurns: reading.comparisonTurns,
    },
    layers,
  )
  const extent = picture.halfExtent
  return emptyVisualModel('magnetic', {
    extent: { width: 2 * extent.x, height: 2 * extent.y },
    origin: { x: -extent.x, y: -extent.y },
    grid: { minor: 1, major: 5 },
    /* No axes here either: the coil is symmetric about its own centre, so a
       vertical axis through it draws a line down the middle of the copper and
       puts the tick numbers on the turns. */
    axes: { x: '', y: '' },
    tickStep: 5,
    currentRig: 'solenoid',
    currentCoil: picture.coil,
    currentFieldLines: picture.fieldLines,
    dimensions: picture.dimensions,
    overlay: {
      readout: [
        '通电螺线管 B = μ₀(N/L)I',
        `I = ${amperesText(reading.current)} · n = ${fmtFluidValue(reading.turnDensity, 4)} 匝/米 → B = ${fieldText(reading.field)}`,
        ...(reading.comparisonTurns === undefined || reading.comparisonField === undefined
          ? []
          : [
            `N₂ = ${fmtFluidValue(reading.comparisonTurns, 4)} → B₂ = ${fieldText(reading.comparisonField)}（匝数翻倍，磁场翻倍）`,
          ]),
        `管口 B/2 = ${fieldText(reading.endField)}`,
        reading.northPole === 1
          ? '安培定则：四指顺着电流环绕方向，拇指指向右端 → 右端是 N 极'
          : '安培定则：四指顺着电流环绕方向，拇指指向左端 → 左端是 N 极',
        `网格：小格 ${GRID_MINOR_TEXT} · 大格 ${GRID_MAJOR_TEXT}`,
      ],
      scale: { label: '', length: 1 },
    },
    visible,
  })
}
