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
import { derivedScalar, type SimulationResult } from '@physicsos/physics-core'
import { inductionBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** Engine model lengths are SI metres; the bench displays centimetres. */
const CM_PER_METRE = 100

export const fmtInductionValue = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The induction factory stamps
 * `observable-induction-emf / -current / -flux / -bar-motion`, all keyed by the
 * id suffix.
 */
export const inductionObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-emf')) return 'emf'
  if (id.endsWith('-current')) return 'inductionCurrent'
  if (id.endsWith('-flux')) return 'flux'
  if (id.endsWith('-bar-motion')) return 'barMotion'
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

/** Student-facing one-liner for the Lenz direction readout. */
export const lenzDirectionText = (model: ResolvedInductionModel): string => {
  if (model.subModel === 'bar_motion_emf') {
    const emf = model.magneticFluxDensity * model.barLength * model.barVelocity
    if (Math.abs(emf) < 1e-12) return '棒静止，无感应电流'
    return emf > 0 ? '右手定则：感应电流沿回路正方向' : '右手定则：感应电流沿回路负方向'
  }
  const rate = model.fluxRate ?? 0
  if (Math.abs(rate) < 1e-12) return '磁通量不变，无感应电流'
  return rate > 0
    ? '楞次定律：磁通量增加，感应磁场反抗原磁场'
    : '楞次定律：磁通量减少，感应磁场补偿原磁场'
}

export interface InductionVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedInductionModel
  readonly simulation: SimulationResult
  readonly time: number
}

/**
 * Build one induction frame from the resolved model and simulation.
 *
 * The bar_motion rig draws the field box with the rod at x(t) = v·t; the
 * flux_change rig draws the coil in a uniform field whose readout carries the
 * rate. The current arrow's sign comes from the engine's lenz_direction
 * derived quantity — never re-derived here.
 */
export const inductionSceneVisual = ({
  scene,
  model,
  simulation,
  time,
}: InductionVisualInput): SceneVisualModel => {
  const bench = inductionBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('induction')

  const isBar = model.subModel === 'bar_motion_emf'

  /* The field box: wide enough to hold the rod's whole sweep. */
  const fieldWidthCm = isBar
    ? Math.max(40, Math.abs(model.barVelocity) * 5 * CM_PER_METRE + cmOf(model.barLength) + 20)
    : 40
  const fieldHeightCm = isBar ? cmOf(model.barLength) + 6 : 26
  const fieldOrigin: ScenePoint = { x: -fieldWidthCm / 2, y: -fieldHeightCm / 2 }

  /* Readouts from the engine's derived set. */
  const emf = derivedScalar(simulation.derivedQuantities, 'induced_emf').value
  const current = derivedScalar(simulation.derivedQuantities, 'induced_current').value
  const lenz = derivedScalar(simulation.derivedQuantities, 'lenz_direction').value

  const readout: string[] = [
    '感应读数',
    isBar
      ? `E = BLv = ${fmtInductionValue(emf)} V · I = E/R = ${fmtInductionValue(current)} A`
      : `E = -dΦ/dt = ${fmtInductionValue(emf)} V · I = E/R = ${fmtInductionValue(current)} A`,
    lenzDirectionText(model),
  ]
  if (!isBar) {
    readout.push(`t = ${time.toFixed(2)} s（磁通量匀速变化，E 恒定）`)
  }

  if (isBar) {
    /* The rod sweeps at constant v; x(t) = v·t from the engine's state. */
    const displacementCm = model.barVelocity * time * CM_PER_METRE
    const rod: SceneVisualModel['inductionBar'] = {
      id: `${model.benchId}.bar`,
      at: { x: displacementCm, y: 0 },
      length: cmOf(model.barLength),
      label: `L = ${fmtInductionValue(cmOf(model.barLength))} cm · v = ${fmtInductionValue(model.barVelocity, 3)} m/s`,
    }
    /* The current arrow follows the loop rail below the field box. */
    const currentArrow: SceneVisualModel['inductionCurrent'] = {
      id: 'induction-current-arrow',
      from: { x: fieldOrigin.x + 4, y: fieldOrigin.y - 6 },
      to: { x: fieldOrigin.x + fieldWidthCm - 4, y: fieldOrigin.y - 6 },
      sign: lenz,
    }
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
      inductionBar: rod,
      inductionCurrent: currentArrow,
      overlay: { readout, scale: { label: '10 cm', length: 10 } },
      visible: visibilityOf(scene),
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
    overlay: { readout, scale: { label: '10 cm', length: 10 } },
    visible: visibilityOf(scene),
  })
}

/** Metres → centimetres for a single length. */
const cmOf = (metres: number): number => metres * CM_PER_METRE
