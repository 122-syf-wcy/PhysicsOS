/**
 * Pressure rigs → SceneVisualModel bridge.
 *
 * Projects the pressure bench's verified reading onto the shared visual
 * contract. Every drawn fact — the force on a contact face, the pressure under
 * it, the depth of a probe, the height of the mercury column, the pull on the
 * hemispheres — comes from the Fluid Engine's resolved model and its closed-form
 * readings; this module only frames the apparatus, lays out the faces, and
 * formats strings. It never computes a pressure.
 *
 * Scene units are CENTIMETRES, the same as the buoyancy rig: contact areas are
 * drawn as the square root of the authored cm² (so 200 cm² and 50 cm² read 2:1
 * across and 4:1 in area), depths and column heights are drawn at their true cm,
 * and the barometer's 760 mm column is drawn 76 units tall because that is how
 * tall it is. A figure that shortened it would be lying about the one number the
 * experiment exists to produce.
 *
 * Layer rule, the same one the buoyancy rig follows: the apparatus and the dial
 * it reads are always drawn; the annotation layer is gated. `pressure` carries
 * the derived marks (force arrows, depth and column dimensions), and
 * `pressureComparison` carries the whole comparison apparatus — the tipped face,
 * the second vessel, the hemisphere pair. `DimensionVisual` cannot carry an
 * observable key (the canvas draws dimensions unconditionally), so the bridge
 * omits an un-asked dimension instead of filtering it in the renderer.
 */

import {
  atmosphericPressureOf,
  liquidPressureOf,
  solidPressureOf,
  type ResolvedPressureModel,
} from '@physicsos/engine-fluid'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  GroundVisual,
  GuideVisual,
  ObservableKey,
  ObservableVisibility,
  PressureBarometerVisual,
  PressureFaceVisual,
  PressureHemisphereVisual,
  PressureLiquidVisual,
  PressureProbeVisual,
  PressureRigKind,
  PressureSolidVisual,
  ScenePoint,
  SceneVisualModel,
  VectorVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit every rig on this bridge is drawn in. */
const cm = (metres: number): number => metres * 100
/** Square metres → square centimetres. */
const cm2 = (squareMetres: number): number => squareMetres * 1e4

const pascalsText = (value: number): string => `${fmtFluidValue(value, 5)} Pa`
const densityText = (value: number): string => `${fmtFluidValue(value, 5)} kg/m³`

/**
 * Scene observable definition → canvas toggle key. The pressure factory stamps
 * `observable-pressure-reading` / `observable-pressure-comparison` for all three
 * rigs, so the key rides on the id rather than the observable type.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const pressureObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-reading')) return 'pressure'
  if (id.endsWith('-comparison')) return 'pressureComparison'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = pressureObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Which of the two layers the frame is drawing. */
interface Layers {
  readonly reading: boolean
  readonly comparison: boolean
}

/**
 * Student-facing name of the rig the frame is showing.
 * @returns the formatted string.
 * @param type - the part type.
 */
export const pressureRigText = (type: PressureRigKind): string => {
  switch (type) {
    case 'solid':
      return '固体压强（压力作用效果）'
    case 'liquid':
      return '液体内部的压强'
    case 'atmospheric':
      return '大气压的测量'
  }
}

/* ------------------------------------------------------------- solid rig -- */

const SOLID_GAP = 6
const SOLID_BLOCK_HEIGHT = 7
/** Length of every force arrow. Constant BY DESIGN — the force is the same. */
const SOLID_ARROW_LENGTH = 6
/** Slab the block presses on; its top face is the contact area. */
const SOLID_PLATE_DEPTH = 1.6
const SOLID_DIMENSION_Y = -4.5
const SOLID_MARGIN = 5
/** Frame walls: below the area dimensions, above the force label. */
const SOLID_FLOOR = -6.5
const SOLID_CEILING = 15

interface SolidPicture {
  readonly solid: PressureSolidVisual
  readonly vectors: VectorVisual[]
  readonly dimensions: DimensionVisual[]
  readonly ground: GroundVisual
  readonly span: number
}

const solidPicture = (
  reading: ReturnType<typeof solidPressureOf>,
  layers: Layers,
): SolidPicture => {
  const entries: { id: string; area: number; pressure: number; loaded: boolean }[] = [
    { id: 'loaded', area: reading.area, pressure: reading.pressure, loaded: true },
  ]
  if (
    layers.comparison &&
    reading.comparisonArea !== undefined &&
    reading.comparisonPressure !== undefined
  ) {
    entries.push({
      id: 'comparison',
      area: reading.comparisonArea,
      pressure: reading.comparisonPressure,
      loaded: false,
    })
  }

  /* Contacts are drawn as squares of equal area, so the side lengths are the
     square roots and the drawn width ratio is the square root of the area
     ratio: 200 cm² and 50 cm² read 2:1 here and 4:1 in the labels. */
  const widths = entries.map(entry => Math.sqrt(cm2(entry.area)))
  const span = widths.reduce((sum, width) => sum + width, 0) + SOLID_GAP * (widths.length - 1)

  const faces: PressureFaceVisual[] = []
  const vectors: VectorVisual[] = []
  const dimensions: DimensionVisual[] = []
  let cursor = -span / 2
  entries.forEach((entry, index) => {
    const width = widths[index] ?? 1
    const at: ScenePoint = { x: cursor + width / 2, y: 0 }
    cursor += width + SOLID_GAP
    const observable: ObservableKey = entry.loaded ? 'pressure' : 'pressureComparison'
    faces.push({
      id: entry.id,
      at,
      halfWidth: width / 2,
      pressureText: pascalsText(entry.pressure),
      loaded: entry.loaded,
    })
    /* Each face's marks answer to its own layer: the loaded face to `pressure`,
    the comparison face to `pressureComparison`. The two faces are independent
    readings of the same force on different areas, so neither gate can own both. */
    if (entry.loaded ? layers.reading : layers.comparison) {
      vectors.push({
        id: `force-${entry.id}`,
        role: 'force',
        observable,
        from: { x: at.x, y: SOLID_BLOCK_HEIGHT + SOLID_ARROW_LENGTH },
        to: { x: at.x, y: SOLID_BLOCK_HEIGHT },
        symbol: 'F',
      })
      dimensions.push({
        id: `area-${entry.id}`,
        from: { x: at.x - width / 2, y: SOLID_DIMENSION_Y },
        to: { x: at.x + width / 2, y: SOLID_DIMENSION_Y },
        label: `S = ${fmtFluidValue(cm2(entry.area), 5)} cm²`,
      })
    }
  })

  const first = faces[0]
  return {
    solid: {
      id: 'pressure-face',
      at: { x: first?.at.x ?? 0, y: SOLID_BLOCK_HEIGHT / 2 },
      halfWidth: first?.halfWidth ?? 1,
      halfHeight: SOLID_BLOCK_HEIGHT / 2,
      plateDepth: SOLID_PLATE_DEPTH,
      forceText: `${fmtFluidValue(reading.force, 5)} N`,
      faces,
      label: '压力作用效果',
    },
    vectors,
    dimensions,
    /* One table under both faces, so the two plates read as the same bench. */
    ground: {
      y: -SOLID_PLATE_DEPTH,
      from: -span / 2 - 1.5,
      to: span / 2 + 1.5,
      label: '桌面',
    },
    span,
  }
}

/* ----------------------------------------------------------- liquid rig -- */

const LIQUID_GAP = 9
const LIQUID_WIDTH = 24
const COMPARISON_LIQUID_WIDTH = 18
/** Liquid drawn above the surface line, so the vessel reads as a vessel. */
const LIQUID_RIM = 6
const LIQUID_MARGIN = 6
const LIQUID_FLOOR_MARGIN = 8
/** Inset of the depth dimension from the vessel wall. */
const LIQUID_DIMENSION_INSET = 3.5

interface LiquidPicture {
  readonly liquid: PressureLiquidVisual
  readonly comparisonLiquid: PressureLiquidVisual | undefined
  readonly probes: PressureProbeVisual[]
  readonly dimensions: DimensionVisual[]
  readonly guides: GuideVisual[]
  readonly span: number
  readonly floor: number
}

const liquidPicture = (
  reading: ReturnType<typeof liquidPressureOf>,
  layers: Layers,
): LiquidPicture => {
  const h = cm(reading.depth)
  const h2 = reading.comparisonDepth === undefined ? undefined : cm(reading.comparisonDepth)
  const secondProbe =
    layers.comparison && h2 !== undefined && reading.comparisonDepthPressure !== undefined
  const otherLiquid =
    layers.comparison &&
    reading.comparisonLiquidDensity !== undefined &&
    reading.comparisonLiquidPressure !== undefined

  const deepest = Math.max(h, secondProbe ? h2 : h)
  const floor = -(deepest + LIQUID_FLOOR_MARGIN)
  const span = LIQUID_WIDTH + (otherLiquid ? LIQUID_GAP + COMPARISON_LIQUID_WIDTH : 0)
  const left = -span / 2
  const right = span / 2

  const liquid: PressureLiquidVisual = {
    id: 'probed-liquid',
    left,
    right: left + LIQUID_WIDTH,
    surface: 0,
    floor,
    rim: LIQUID_RIM,
    densityText: densityText(reading.liquidDensity),
    label: '被探究的液体',
  }

  /* The probe is the rig's instrument, so it is always drawn; `pressure` gates
     the depth dimension beside it, and `pressureComparison` the second reading. */
  const primaryX = left + LIQUID_WIDTH / 2
  const probes: PressureProbeVisual[] = [
    {
      id: 'probe-primary',
      at: { x: primaryX, y: -h },
      readingText: pascalsText(reading.pressure),
      depth: h,
      surface: 0,
      primary: true,
    },
  ]
  const dimensions: DimensionVisual[] = []
  if (layers.reading) {
    dimensions.push({
      id: 'depth-primary',
      /* Inside the left wall, label toward the liquid: the dimension and its
         label both stay within the vessel, clear of the probe's own reading. */
      side: 'right',
      from: { x: liquid.left + LIQUID_DIMENSION_INSET, y: 0 },
      to: { x: liquid.left + LIQUID_DIMENSION_INSET, y: -h },
      label: `h = ${fmtFluidValue(h, 5)} cm`,
    })
  }

  if (secondProbe) {
    probes.push({
      id: 'probe-comparison-depth',
      at: { x: primaryX, y: -h2 },
      readingText: pascalsText(reading.comparisonDepthPressure),
      depth: h2,
      surface: 0,
      primary: false,
    })
    dimensions.push({
      id: 'depth-comparison',
      /* The same vessel probed deeper: the two depth rules nest, the smaller
         nearest the wall, so the extra 20 cm is read as a step, not a second rig. */
      side: 'right',
      from: { x: liquid.left + 2 * LIQUID_DIMENSION_INSET, y: 0 },
      to: { x: liquid.left + 2 * LIQUID_DIMENSION_INSET, y: -h2 },
      label: `h₂ = ${fmtFluidValue(h2, 5)} cm`,
    })
  }

  let comparisonLiquid: PressureLiquidVisual | undefined
  if (otherLiquid) {
    const comparisonLeft = liquid.right + LIQUID_GAP
    comparisonLiquid = {
      id: 'comparison-liquid',
      left: comparisonLeft,
      right: comparisonLeft + COMPARISON_LIQUID_WIDTH,
      surface: 0,
      floor,
      rim: LIQUID_RIM,
      densityText: densityText(reading.comparisonLiquidDensity),
      label: '换一种液体',
    }
    probes.push({
      id: 'probe-comparison-liquid',
      at: { x: comparisonLeft + COMPARISON_LIQUID_WIDTH / 2, y: -h },
      readingText: pascalsText(reading.comparisonLiquidPressure),
      depth: h,
      surface: 0,
      primary: false,
    })
    dimensions.push({
      id: 'depth-comparison-liquid',
      side: 'right',
      from: { x: comparisonLeft + LIQUID_DIMENSION_INSET, y: 0 },
      to: { x: comparisonLeft + LIQUID_DIMENSION_INSET, y: -h },
      label: `h = ${fmtFluidValue(h, 5)} cm`,
    })
  }

  const guides: GuideVisual[] = [
    {
      id: 'surface-line',
      observable: 'pressure',
      from: { x: left, y: 0 },
      to: { x: right, y: 0 },
      label: '液面',
    },
  ]
  return { liquid, comparisonLiquid, probes, dimensions, guides, span, floor }
}

/* ------------------------------------------------------- atmospheric rig -- */

/** Bore half-width of the Torricelli tube. */
const TUBE_HALF_WIDTH = 2.6
/** Glass drawn above the standing column — the sealed vacuum end. */
const TUBE_HEADROOM = 12
const DISH_HALF_WIDTH = 13
const DISH_DEPTH = 4
const BAROMETER_GAP = 16
const ATMOSPHERIC_MARGIN = 7
/** Drawn length of each hemisphere pull arrow. */
const HEMISPHERE_ARROW = 15
/**
 * Gap from the bore's right wall to the column rule, in centimetres.
 *
 * The rule stands beside the mercury because that is what it measures, and the
 * dimension centres its label ON the rule — so this gap has to be wider than
 * half a `h = 760.05 mm` label or the number is drawn on the column. Three
 * centimetres put the text straight through the glass; eight clears it at both
 * viewport widths the acceptance gate shoots.
 */
const COLUMN_DIMENSION_GAP = 8

interface AtmosphericPicture {
  readonly barometer: PressureBarometerVisual
  readonly hemispheres: PressureHemisphereVisual | undefined
  readonly vectors: VectorVisual[]
  readonly dimensions: DimensionVisual[]
  readonly guides: GuideVisual[]
  readonly minX: number
  readonly maxX: number
  readonly maxY: number
  readonly minY: number
}

const atmosphericPicture = (
  reading: ReturnType<typeof atmosphericPressureOf>,
  model: ResolvedPressureModel & { type: 'atmospheric' },
  layers: Layers,
): AtmosphericPicture => {
  const columnCm = cm(reading.columnHeight)
  const radiusCm = cm(model.hemisphereRadius)
  const boreX = -DISH_HALF_WIDTH - TUBE_HALF_WIDTH
  const tubeTop = columnCm + TUBE_HEADROOM

  const barometer: PressureBarometerVisual = {
    id: 'barometer',
    at: { x: boreX, y: 0 },
    halfWidth: TUBE_HALF_WIDTH,
    surface: 0,
    columnTop: columnCm,
    tubeTop,
    dishHalfWidth: DISH_HALF_WIDTH,
    dishDepth: DISH_DEPTH,
    /* The column is drawn in centimetres; the label states millimetres, because
       760 mmHg is the number the student meets. 76 cm and 760 mm are the same
       length, so the dimension stays honest in either unit. */
    columnText: `h = ${fmtFluidValue(columnCm * 10, 5)} mm`,
    pressureText: pascalsText(reading.atmosphericPressure),
    label: '托里拆利实验',
  }

  /* The hemisphere pair IS this rig's comparison apparatus (the other
     instrument reading the same p₀), so it arrives and leaves with the layer. */
  const hemispheres: PressureHemisphereVisual | undefined = layers.comparison
    ? {
      id: 'hemispheres',
      at: { x: DISH_HALF_WIDTH + BAROMETER_GAP + radiusCm + HEMISPHERE_ARROW, y: columnCm * 0.42 },
      radius: radiusCm,
      forceText: `${fmtFluidValue(reading.hemisphereForce, 5)} N`,
      label: '马德堡半球',
    }
    : undefined

  const rightEdge =
    hemispheres === undefined
      ? DISH_HALF_WIDTH + 6
      : hemispheres.at.x + hemispheres.radius + HEMISPHERE_ARROW

  /* The column height is the pressure, so its dimension is drawn against the
     tube wall where the mercury actually stands. */
  const dimensions: DimensionVisual[] = layers.reading
    ? [
      {
        id: 'column-height',
        /* `side` names the side the measured ink is on, which is why the rule
           standing to the RIGHT of the bore says `left`: that is what throws its
           label further right, clear of the glass, instead of back over it. */
        side: 'left',
        from: { x: boreX + TUBE_HALF_WIDTH + COLUMN_DIMENSION_GAP, y: 0 },
        to: { x: boreX + TUBE_HALF_WIDTH + COLUMN_DIMENSION_GAP, y: columnCm },
        label: barometer.columnText,
      },
    ]
    : []
  /* Both guides mark a level, so both run the full width of the frame — to the
     apparatus, never past it: the extent is what the canvas maps to pixels, and
     anything drawn beyond it is drawn off the picture. */
  const guides: GuideVisual[] = [
    {
      id: 'column-top',
      observable: 'pressure',
      from: { x: boreX - DISH_HALF_WIDTH, y: columnCm },
      to: { x: rightEdge, y: columnCm },
      label: '汞柱顶（真空）',
    },
    {
      id: 'mercury-surface',
      observable: 'pressure',
      from: { x: boreX - DISH_HALF_WIDTH, y: 0 },
      to: { x: rightEdge, y: 0 },
      label: '汞面',
    },
  ]

  const vectors: VectorVisual[] = []
  if (hemispheres !== undefined) {
    for (const side of [-1, 1] as const) {
      vectors.push({
        id: `hemisphere-pull-${side === -1 ? 'left' : 'right'}`,
        role: 'force',
        observable: 'pressureComparison',
        from: { x: hemispheres.at.x + side * radiusCm, y: hemispheres.at.y },
        to: { x: hemispheres.at.x + side * (radiusCm + HEMISPHERE_ARROW), y: hemispheres.at.y },
        symbol: 'F',
      })
    }
  }

  return {
    barometer,
    hemispheres,
    vectors,
    dimensions,
    guides,
    minX: boreX - DISH_HALF_WIDTH,
    maxX: rightEdge,
    maxY: tubeTop,
    minY: -DISH_DEPTH,
  }
}

/* ------------------------------------------------------------------ frame -- */

/**
 * The pressure visual input shape used by the pressure scene visuals module.
 */
export interface PressureVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedPressureModel
}

/**
 * Build one pressure frame from the engine's resolved model
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const pressureSceneVisual = (input: PressureVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
  } = input

  const visible = visibilityOf(scene)
  const layers: Layers = {
    reading: visible.pressure === true,
    comparison: visible.pressureComparison === true,
  }

  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    const picture = solidPicture(reading, layers)
    const margin = SOLID_MARGIN
    return emptyVisualModel('fluid', {
      extent: {
        width: picture.span + 2 * margin,
        height: SOLID_CEILING - SOLID_FLOOR,
      },
      origin: { x: -picture.span / 2 - margin, y: SOLID_FLOOR },
      grid: { minor: 1, major: 5 },
      axes: { x: '', y: 'y / cm' },
      tickStep: 5,
      pressureRig: 'solid',
      pressureSolid: picture.solid,
      ground: picture.ground,
      vectors: picture.vectors,
      dimensions: picture.dimensions,
      overlay: {
        readout: [
          '固体压强 p = F/S',
          `F = ${picture.solid.forceText}（两个面相同）`,
          `S = ${fmtFluidValue(cm2(reading.area), 5)} cm² → p = ${pascalsText(reading.pressure)}`,
          ...(reading.comparisonArea === undefined || reading.comparisonPressure === undefined
            ? []
            : [
              `S₂ = ${fmtFluidValue(cm2(reading.comparisonArea), 5)} cm² → p₂ = ${pascalsText(reading.comparisonPressure)}`,
            ]),
        ],
        scale: { label: '5 cm', length: 5 },
      },
      visible,
    })
  }

  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    const picture = liquidPicture(reading, layers)
    const margin = LIQUID_MARGIN
    const top = LIQUID_RIM + 2
    return emptyVisualModel('fluid', {
      extent: { width: picture.span + 2 * margin, height: top - picture.floor + margin },
      origin: { x: -picture.span / 2 - margin, y: picture.floor - margin / 2 },
      grid: { minor: 1, major: 5 },
      axes: { x: '', y: 'y / cm' },
      tickStep: 5,
      pressureRig: 'liquid',
      pressureLiquid: picture.liquid,
      ...(picture.comparisonLiquid === undefined
        ? {}
        : { pressureComparisonLiquid: picture.comparisonLiquid }),
      pressureProbes: picture.probes,
      guides: picture.guides,
      dimensions: picture.dimensions,
      overlay: {
        readout: [
          '液体压强 p = ρgh',
          `ρ = ${densityText(reading.liquidDensity)} · h = ${fmtFluidValue(cm(reading.depth), 5)} cm`,
          `p = ${pascalsText(reading.pressure)}`,
          ...(reading.comparisonDepthPressure === undefined || reading.comparisonDepth === undefined
            ? []
            : [
              `h₂ = ${fmtFluidValue(cm(reading.comparisonDepth), 5)} cm → p₂ = ${pascalsText(reading.comparisonDepthPressure)}`,
            ]),
          ...(reading.comparisonLiquidPressure === undefined ||
          reading.comparisonLiquidDensity === undefined
            ? []
            : [
              `ρ₂ = ${densityText(reading.comparisonLiquidDensity)} → p₃ = ${pascalsText(reading.comparisonLiquidPressure)}`,
            ]),
        ],
        scale: { label: '5 cm', length: 5 },
      },
      visible,
    })
  }

  const reading = atmosphericPressureOf(model)
  const picture = atmosphericPicture(reading, model, layers)
  const margin = ATMOSPHERIC_MARGIN
  return emptyVisualModel('fluid', {
    extent: {
      width: picture.maxX - picture.minX + 2 * margin,
      height: picture.maxY - picture.minY + margin,
    },
    origin: { x: picture.minX - margin, y: picture.minY - margin / 2 },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: 'y / cm' },
    tickStep: 10,
    pressureRig: 'atmospheric',
    pressureBarometer: picture.barometer,
    ...(picture.hemispheres === undefined ? {} : { pressureHemispheres: picture.hemispheres }),
    guides: picture.guides,
    vectors: picture.vectors,
    dimensions: picture.dimensions,
    overlay: {
      readout: [
        '大气压 p₀',
        `p₀ = ${pascalsText(reading.atmosphericPressure)}`,
        `ρ_液 = ${densityText(model.barometerFluidDensity)} → ${picture.barometer.columnText}`,
        `r = ${fmtFluidValue(cm(model.hemisphereRadius), 5)} cm → F = ${fmtFluidValue(reading.hemisphereForce, 5)} N`,
      ],
      scale: { label: '10 cm', length: 10 },
    },
    visible,
  })
}
