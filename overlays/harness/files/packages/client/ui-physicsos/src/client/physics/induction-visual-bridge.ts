/**
 * Induction → SceneVisualModel bridge.
 *
 * Projects a verified induction frame (the engine's resolved model + state) onto
 * the shared visual contract. Every drawn fact — where the rod sits, the EMF and
 * current values, the Lenz sign — comes from the Induction Engine's resolved
 * model and simulation; this module only converts SI metres into the bench's
 * display unit (centimetres), frames the extent and formats strings. It never
 * computes an EMF.
 *
 * Scene units on the canvas are CENTIMETRES: the junior induction bench is
 * authored, read and taught in cm, so the axis ticks are the numbers a student
 * would measure on a real rail-and-rod rig.
 */

import type { ResolvedInductionModel } from '@physicsos/engine-induction'
import { isScalarQuantity, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { inductionBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import { formatSignificant } from './number-format.ts'
import type {
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** Engine model lengths are SI metres; the bench displays centimetres. */
const CM_PER_METRE = 100

/**
 * The induction scene visuals helper `fmtInductionValue`.
 * @returns the formatted string.
 * @param digits - the digits.
 * @param value - the new value.
 */
export const fmtInductionValue = (value: number, digits = 3): string =>
  formatSignificant(value, digits)

/**
 * Scene observable definition → canvas toggle key. The induction factory stamps
 * `observable-induction-emf / -current / -flux / -bar_motion` (the scene key is
 * the snake-case observable name), all keyed by the id suffix.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const inductionObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-emf')) return 'emf'
  if (id.endsWith('-current')) return 'inductionCurrent'
  if (id.endsWith('-flux')) return 'flux'
  if (id.endsWith('-bar-motion') || id.endsWith('-bar_motion')) return 'barMotion'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = inductionObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Student-facing one-liner for the Lenz direction readout. The value that
 *  decides the sentence is an engine fact — for a sweeping bar the derived EMF
 *  (E = BLv, its sign is the cutting direction), for the coil the bench's
 *  stated flux rate — never an EMF this module recomputes from B·L·v.  * @returns the formatted string.
 * @param signedValue - the signed measurement.
 * @param isBar - whether the element is a bar.
 * @returns the formatted string.
 */
export const lenzDirectionText = (isBar: boolean, signedValue: number): string => {
  if (isBar) {
    if (!Number.isFinite(signedValue) || Math.abs(signedValue) < 1e-12) return '棒静止，无感应电流'
    return signedValue > 0 ? '右手定则：感应电流沿回路正方向' : '右手定则：感应电流沿回路负方向'
  }
  if (!Number.isFinite(signedValue) || Math.abs(signedValue) < 1e-12) return '磁通量不变，无感应电流'
  return signedValue > 0
    ? '楞次定律：磁通量增加，感应磁场反抗原磁场'
    : '楞次定律：磁通量减少，感应磁场补偿原磁场'
}

/**
 * The induction visual input shape used by the induction scene visuals module.
 */
export interface InductionVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedInductionModel
  readonly simulation: SimulationResult
  readonly time: number
  /**
   * The engine's EXACT state at `time` (closed form via `stateAt`). Without it
   * the frame falls back to the nearest sampled state, whose time can sit
   * 1/60 of the run away from the clock — on a τ = 0.25 s exchange that is a
   * 7 % error between the "t =" the student reads and the numbers beside it.
   */
  readonly state?: SimulationState
}

/** The sampled state nearest the requested time — the fallback when the
 *  caller did not supply the engine's exact state for this frame. */
const nearestState = (simulation: SimulationResult, time: number): SimulationState | undefined => {
  const first = simulation.states[0]
  if (first === undefined) return undefined
  let nearest = first
  for (const state of simulation.states) {
    if (Math.abs(state.time.value - time) < Math.abs(nearest.time.value - time)) {
      nearest = state
    }
  }
  return nearest
}

/** The engine's published x for an object in a frame state — never re-derived. */
const objectX = (state: SimulationState | undefined, objectId: string): number => {
  const position = state?.objects.find(entry => entry.id === objectId)?.position
  return position === undefined ? 0 : position.vector.x
}

/**
 * Build one induction frame from the resolved model and simulation.
 *
 * The bar_motion rig draws the field box with the rod at x(t) = v·t; the
 * flux_change rig draws the coil in a uniform field whose readout carries the
 * rate; the double_bar_rail rig draws two rails, both bars at their integrated
 * positions, the BIL force arrows on each bar and the loop current. The
 * current arrow's sign and every number come from the engine — never re-derived
 * here.
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const inductionSceneVisual = (input: InductionVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
    simulation,
    time,
    state,
  } = input

  const bench = inductionBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('induction')

  const isBar = model.subModel === 'bar_motion_emf'
  const isDoubleBar = model.subModel === 'double_bar_rail'
  const visible = visibilityOf(scene)
  /* 感应电动势 gates the `E = …` fragment; 磁通量 gates the `dΦ/dt = …`
     fragment — both on the readout line, which is where those numbers live.
     Absent definitions mean visible (the scene declares them true). */
  const showEmf = visible.emf !== false
  const showFlux = visible.flux !== false

  /* Per-frame readouts from the engine's own state at this time. */
  const frameState = state ?? nearestState(simulation, time)
  const frameDerived = frameState?.derived ?? simulation.derivedQuantities
  const scalarAt = (key: string): number => {
    const entry = frameDerived.find(candidate => candidate.key === key)
    return entry === undefined || !isScalarQuantity(entry.value) ? Number.NaN : entry.value.value
  }

  if (isDoubleBar) {
    return doubleBarSceneVisual({ scene, model, frameState, time, scalarAt })
  }

  /* Follow camera for the sweeping rod. The rod travels metres along a field
     20 cm tall, so a frame that holds the whole sweep flattens the rig into a
     hairline; instead the window rides with the rod at a fixed comfortable
     scale and the field marks scroll past it — which is exactly the flux
     cutting the student is meant to see. The rod's position is the engine's
     published state at this frame. */
  const fieldHeightCm = isBar ? cmOf(model.barLength) + 6 : 26
  let fieldOrigin: ScenePoint
  let fieldWidthCm: number
  if (isBar) {
    const rodXCm = cmOf(objectX(frameState, `${model.benchId}.bar`))
    fieldWidthCm = Math.max(cmOf(model.barLength) * 5, 100)
    fieldOrigin = { x: rodXCm - fieldWidthCm / 2, y: -fieldHeightCm / 2 }
  } else {
    fieldWidthCm = 40
    fieldOrigin = { x: -fieldWidthCm / 2, y: -fieldHeightCm / 2 }
  }

  /* Readouts from the engine's derived set at this frame. */
  const emf = scalarAt('induced_emf')
  const current = scalarAt('induced_current')
  const lenz = scalarAt('lenz_direction')
  const fluxRate = scalarAt('flux_rate')

  const readout: string[] = [
    '感应读数',
    `${showEmf ? `${isBar ? 'E = BLv' : 'E = -dΦ/dt'} = ${fmtInductionValue(emf)} V · ` : ''}I = E/R = ${fmtInductionValue(current)} A${showFlux ? ` · dΦ/dt = ${fmtInductionValue(fluxRate)} Wb/s` : ''}`,
    /* Direction quotes an engine value: the bar's EMF sign (右手定则) or the
       coil's stated flux rate (楞次定律), never a B·L·v recomputed here. */
    lenzDirectionText(isBar, isBar ? emf : fluxRate),
  ]
  if (!isBar) {
    readout.push(`t = ${time.toFixed(2)} s（磁通量匀速变化，E 恒定）`)
  }

  if (isBar) {
    /* The rod's swept position comes from the engine's published object state
       (bar_motion_emf integrates x = v·t into its states), sampled at this
       frame — the same channel the double-bar rig already uses. The bridge
       must not re-derive kinematics from parameters. */
    const displacementCm = cmOf(objectX(frameState, `${model.benchId}.bar`))
    const rod: SceneVisualModel['inductionBar'] = {
      id: `${model.benchId}.bar`,
      at: { x: displacementCm, y: 0 },
      length: cmOf(model.barLength),
      label: `L = ${fmtInductionValue(cmOf(model.barLength))} cm · v = ${fmtInductionValue(model.barVelocity, 3)} m/s`,
      direction: model.barVelocity < 0 ? -1 : 1,
    }
    /* The rail-and-resistor rig: two horizontal rails the rod bridges, closed
       at the left end by the resistor wire — the loop the induced current
       actually runs around. The resistor sits inside the field's left margin,
       upstream of the rod's start. */
    const railHalf = cmOf(model.barLength) / 2
    const closureX = fieldOrigin.x + 5
    const rails: SceneVisualModel['inductionRails'] = [
      { id: 'induction-rail-top', from: { x: fieldOrigin.x, y: railHalf }, to: { x: fieldOrigin.x + fieldWidthCm, y: railHalf } },
      { id: 'induction-rail-bottom', from: { x: fieldOrigin.x, y: -railHalf }, to: { x: fieldOrigin.x + fieldWidthCm, y: -railHalf } },
    ]
    const resistor: SceneVisualModel['inductionResistor'] = {
      id: 'induction-resistor',
      at: { x: closureX, y: 0 },
      span: railHalf * 2,
      label: `R = ${fmtInductionValue(model.resistance)} Ω`,
    }
    /* The current arrow rides the bottom rail between the closure and the rod:
       the segment of the loop where the induced current visibly returns. */
    const currentArrow: SceneVisualModel['inductionCurrent'] = {
      id: 'induction-current-arrow',
      from: { x: closureX + 2, y: -railHalf },
      to: { x: displacementCm - 2, y: -railHalf },
      sign: lenz,
    }
    /* The live loop the induced current runs around: resistor wire → bottom
       rail → rod → top rail, ordered so a POSITIVE current travels the bottom
       rail left→right — the direction the arrow draws for lenz > 0. The
       engine's signed induced_current already carries that sign (R > 0 gives
       sign(I) = sign(E) = lenz); a zero current emits no flow. */
    const chargeFlows: SceneVisualModel['chargeFlows'] =
      Number.isFinite(current) && Math.abs(current) > 1e-12
        ? [{
          id: 'induction-loop-flow',
          path: [
            { x: closureX, y: -railHalf },
            { x: displacementCm, y: -railHalf },
            { x: displacementCm, y: railHalf },
            { x: closureX, y: railHalf },
            { x: closureX, y: -railHalf },
          ],
          current,
        }]
        : undefined
    return emptyVisualModel('induction', {
      extent: { width: fieldWidthCm + 8, height: fieldHeightCm + 24 },
      origin: { x: fieldOrigin.x - 4, y: fieldOrigin.y - 16 },
      grid: { minor: 2, major: 10 },
      axes: { x: 'x / cm', y: '' },
      tickStep: 10,
      inductionField: {
        id: 'induction-field',
        origin: fieldOrigin,
        size: { width: fieldWidthCm, height: fieldHeightCm },
        marks: 'into',
      },
      inductionRails: rails,
      inductionResistor: resistor,
      inductionBar: rod,
      inductionCurrent: currentArrow,
      ...(chargeFlows === undefined ? {} : { chargeFlows }),
      overlay: { readout, scale: { label: '10 cm', length: 10 } },
      visible,
    })
  }

  /* flux_change rig: coil in a steady-but-changing field. */
  const coilAreaM2 = model.coilArea ?? 0
  const coilDiameter = Math.sqrt(Math.max(1e-6, coilAreaM2)) * CM_PER_METRE
  const coil: SceneVisualModel['inductionCoil'] = {
    id: model.benchId,
    at: { x: 0, y: 0 },
    diameter: Math.max(6, coilDiameter),
    label: `S = ${fmtInductionValue(coilAreaM2 * 1e4, 3)} cm²`,
  }
  const currentArrow: SceneVisualModel['inductionCurrent'] = {
    id: 'induction-current-arrow',
    from: { x: fieldOrigin.x + 4, y: fieldOrigin.y - 6 },
    to: { x: fieldOrigin.x + fieldWidthCm - 4, y: fieldOrigin.y - 6 },
    sign: lenz,
  }
  /* The coil IS the loop: charges circulate its edge-on ring, ordered so a
     positive current runs the front (bottom) arc left→right — the reading the
     legend arrow gives for lenz > 0. The 0.34 squash matches the ellipse the
     renderer draws for this coil; the ring repeats its first point to close. */
  const coilRadius = Math.max(6, coilDiameter) / 2
  const coilRing: ScenePoint[] = Array.from({ length: COIL_FLOW_SEGMENTS }, (_, index) => {
    const theta = Math.PI + (2 * Math.PI * index) / COIL_FLOW_SEGMENTS
    return { x: coilRadius * Math.cos(theta), y: coilRadius * 0.34 * Math.sin(theta) }
  })
  const firstRingPoint = coilRing[0]
  const chargeFlows: SceneVisualModel['chargeFlows'] =
    firstRingPoint !== undefined && Number.isFinite(current) && Math.abs(current) > 1e-12
      ? [{
        id: 'induction-loop-flow',
        path: [...coilRing, firstRingPoint],
        current,
      }]
      : undefined
  return emptyVisualModel('induction', {
    extent: { width: fieldWidthCm + 8, height: fieldHeightCm + 24 },
    origin: { x: fieldOrigin.x - 4, y: fieldOrigin.y - 16 },
    grid: { minor: 2, major: 10 },
    axes: { x: 'x / cm', y: '' },
    tickStep: 10,
    inductionField: {
      id: 'induction-field',
      origin: fieldOrigin,
      size: { width: fieldWidthCm, height: fieldHeightCm },
      marks: 'into',
    },
    inductionCoil: coil,
    inductionCurrent: currentArrow,
    ...(chargeFlows === undefined ? {} : { chargeFlows }),
    overlay: { readout, scale: { label: '10 cm', length: 10 } },
    visible,
  })
}

/** Metres → centimetres for a single length. */
const cmOf = (metres: number): number => metres * CM_PER_METRE

/** Beads-per-ring resolution of the flux_change coil's charge-flow path. */
const COIL_FLOW_SEGMENTS = 24

/* ------------------------------------------------------ double_bar_rail -- */

/**
 * Frame for the two-bar rail rig: two horizontal rails, both bars at their
 * integrated positions, the BIL force arrows on each bar and the loop-current
 * arrow along the bottom rail. Every number (v₁, v₂, E, I, F磁) comes from the
 * engine's per-state derived set — this module only turns them into geometry.
 */
const doubleBarSceneVisual = ({
  scene,
  model,
  frameState,
  time,
  scalarAt,
}: {
  scene: PhysicsScene
  model: ResolvedInductionModel
  time: number
  scalarAt: (key: string) => number
  frameState: SimulationState | undefined
}): SceneVisualModel => {
  const railSpacingCm = cmOf(model.barLength)

  /* Follow camera. A rail rig is one-dimensional: the pair drifts metres along
     rails 20 cm apart, so any frame that holds the whole run flattens the
     apparatus into a hairline. The window rides with the pair's centre instead,
     sized by the bars' CURRENT separation plus room for their labels, so the
     bars stay legible from first frame to last; rails and field marks run to
     the frame edges and the scrolling axis ticks carry the motion. Positions
     are the engine's published states — the bridge frames, it never
     re-integrates. */
  const x1Cm = cmOf(objectX(frameState, `${model.benchId}.bar1`))
  const x2Cm = cmOf(objectX(frameState, `${model.benchId}.bar2`))
  const gapCm = Math.abs(x1Cm - x2Cm)
  const fieldWidthCm = Math.max(railSpacingCm * 5, gapCm + railSpacingCm * 3.5)
  const fieldOrigin: ScenePoint = {
    x: (x1Cm + x2Cm) / 2 - fieldWidthCm / 2,
    y: -(railSpacingCm + 8) / 2,
  }
  const fieldHeightCm = railSpacingCm + 8

  const v1 = scalarAt('bar1_velocity')
  const v2 = scalarAt('bar2_velocity')
  const emf = scalarAt('induced_emf')
  const current = scalarAt('induced_current')
  const force1 = scalarAt('magnetic_force')
  const force2 = -force1
  const lenz = scalarAt('lenz_direction')

  /* Bars: two vertical conductors spanning the rails at x₁ / x₂. */
  const bars: SceneVisualModel['inductionPairBars'] = [
    {
      id: `${model.benchId}.bar1`,
      at: { x: x1Cm, y: 0 },
      length: railSpacingCm,
      label: `m₁ = ${fmtInductionValue((model.barMasses?.[0] ?? 0) * 1000, 3)} g · v₁ = ${fmtInductionValue(v1, 3)} m/s`,
    },
    {
      id: `${model.benchId}.bar2`,
      at: { x: x2Cm, y: 0 },
      length: railSpacingCm,
      label: `m₂ = ${fmtInductionValue((model.barMasses?.[1] ?? 0) * 1000, 3)} g · v₂ = ${fmtInductionValue(v2, 3)} m/s`,
    },
  ]

  /* Force arrows: engine BIL facts, drawn at each bar along the rails. The
     arrow length scales with the force magnitude (10 cm per N). A zero force
     earns NO arrow — at t = 0 of the free two-bar rig the engine's force is
     exactly 0, and a floor-length stub would claim a push that never happened
     (and with `< 0 ? -1 : 1` it would point both bars the same way). */
  const forceArrows: SceneVisualModel['inductionForceArrows'] = [
    {
      id: 'induction-force-bar1',
      at: { x: x1Cm, y: railSpacingCm / 2 + 4 },
      force: force1,
    },
    {
      id: 'induction-force-bar2',
      at: { x: x2Cm, y: -railSpacingCm / 2 - 4 },
      /* Same current, same length, opposite side of the loop: the reaction is
         the engine's own forceOnBar1 with flipped sign. */
      force: force2,
    },
  ]
    .filter(arrow => Number.isFinite(arrow.force) && Math.abs(arrow.force) > 1e-12)
    .map((arrow) => {
      const direction = arrow.force < 0 ? -1 : 1
      return {
        id: arrow.id,
        at: arrow.at,
        direction,
        /* 80 cm per newton, capped at 1.2 rail spacings: the opening F磁 = BIL
           = 0.2 N draws 16 cm — long enough to read its direction, short
           enough that it never spans the gap and reads as a link between the
           bars. The length tracks the decay, so the brake visibly lets go. */
        length: Math.max(2, Math.min(railSpacingCm * 1.2, Math.abs(arrow.force) * 80)),
        label: `F磁 = ${fmtInductionValue(arrow.force, 3)} N`,
      }
    })

  const currentArrow: SceneVisualModel['inductionCurrent'] = {
    id: 'induction-current-arrow',
    from: { x: fieldOrigin.x + 4, y: fieldOrigin.y - 6 },
    to: { x: fieldOrigin.x + fieldWidthCm - 4, y: fieldOrigin.y - 6 },
    sign: lenz,
  }

  /* The live loop is the window between the two bars: bottom rail left→right
     for a positive current — the direction the legend arrow draws for
     lenz > 0. Corners are ordered by bar position so the path stays a simple
     rectangle; the engine's signed induced_current carries the lenz sign. */
  const leftX = Math.min(x1Cm, x2Cm)
  const rightX = Math.max(x1Cm, x2Cm)
  const chargeFlows: SceneVisualModel['chargeFlows'] =
    Number.isFinite(current) && Math.abs(current) > 1e-12
      ? [{
        id: 'induction-loop-flow',
        path: [
          { x: leftX, y: -railSpacingCm / 2 },
          { x: rightX, y: -railSpacingCm / 2 },
          { x: rightX, y: railSpacingCm / 2 },
          { x: leftX, y: railSpacingCm / 2 },
          { x: leftX, y: -railSpacingCm / 2 },
        ],
        current,
      }]
      : undefined

  /* The narrative must match the rig's actual regime: a free pair relaxes to a
     common velocity (current decaying), while a constant pull drives the
     relative velocity UP toward the terminal u∞ (current rising to a plateau).
     Quoting the decay story on the driven rig would teach the opposite law. */
  const driven = (model.externalForce ?? 0) > 0
  const doubleBarVisible = visibilityOf(scene)
  const showEmf = doubleBarVisible.emf !== false
  const readout: string[] = [
    '双棒读数',
    `${showEmf ? `E = BL(v₁−v₂) = ${fmtInductionValue(emf, 3)} V · ` : ''}I = ${fmtInductionValue(current, 3)} A`,
    `v₁ = ${fmtInductionValue(v1, 3)} m/s · v₂ = ${fmtInductionValue(v2, 3)} m/s`,
    driven
      ? `t = ${time.toFixed(2)} s（外力驱动，相对速度趋向 u∞，电流趋于稳定）`
      : `t = ${time.toFixed(2)} s（相对速度指数衰减，电流随之减小）`,
  ]

  return emptyVisualModel('induction', {
    extent: { width: fieldWidthCm + 8, height: fieldHeightCm + 40 },
    origin: { x: fieldOrigin.x - 4, y: fieldOrigin.y - 20 },
    grid: { minor: 2, major: 10 },
    axes: { x: 'x / cm', y: '' },
    tickStep: 10,
    inductionField: {
      id: 'induction-field',
      origin: fieldOrigin,
      size: { width: fieldWidthCm, height: fieldHeightCm },
      marks: 'into',
    },
    inductionRails: [
      { id: 'induction-rail-top', from: { x: fieldOrigin.x, y: railSpacingCm / 2 }, to: { x: fieldOrigin.x + fieldWidthCm, y: railSpacingCm / 2 } },
      { id: 'induction-rail-bottom', from: { x: fieldOrigin.x, y: -railSpacingCm / 2 }, to: { x: fieldOrigin.x + fieldWidthCm, y: -railSpacingCm / 2 } },
    ],
    inductionPairBars: bars,
    inductionForceArrows: forceArrows,
    inductionCurrent: currentArrow,
    ...(chargeFlows === undefined ? {} : { chargeFlows }),
    overlay: { readout, scale: { label: '10 cm', length: 10 } },
    visible: doubleBarVisible,
  })
}
