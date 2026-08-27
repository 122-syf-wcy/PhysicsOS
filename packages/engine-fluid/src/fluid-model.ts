import { canonicalValue } from '@physicsos/physics-units'
import { fluidTanksOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of a spring-scale buoyancy rig. The block hangs with its
 * bottom face level with the liquid surface at t = 0 and descends at
 * `lowerRate`; everything below is time-independent apparatus.
 */
export interface ResolvedFluidModel {
  readonly tankId: string
  readonly blockId: string
  readonly liquidId: string
  /** Block mass (kg), > 0. */
  readonly blockMass: number
  /** Block volume (m³), > 0. */
  readonly blockVolume: number
  /** Block vertical extent (m), > 0. */
  readonly blockHeight: number
  /** Horizontal cross-section V/h (m²), > 0. */
  readonly crossSection: number
  /** Block density m/V (kg/m³), > 0. */
  readonly blockDensity: number
  /** Liquid density (kg/m³), > 0. */
  readonly liquidDensity: number
  /** Descent speed of the block (m/s), > 0. */
  readonly lowerRate: number
  /** Gravitational field strength (m/s²), > 0. */
  readonly gravity: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

/**
 * Resolve the scene's fluid tank into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveFluidModel = (scene: PhysicsScene): ResolvedFluidModel => {
  const tanks = fluidTanksOf(scene)
  const tank = tanks[0]
  if (tank === undefined || tanks.length !== 1) {
    throw modelError('FLUID_SINGLE_TANK', 'Fluid Engine requires exactly one tank.')
  }

  const blockMass = positiveOrThrow(
    canonicalValue(tank.block.mass),
    'FLUID_BLOCK_MASS',
    'Block mass must be finite and > 0.',
  )
  const blockVolume = positiveOrThrow(
    canonicalValue(tank.block.volume),
    'FLUID_BLOCK_VOLUME',
    'Block volume must be finite and > 0.',
  )
  const blockHeight = positiveOrThrow(
    canonicalValue(tank.block.height),
    'FLUID_BLOCK_HEIGHT',
    'Block height must be finite and > 0.',
  )
  const liquidDensity = positiveOrThrow(
    canonicalValue(tank.liquid.density),
    'FLUID_LIQUID_DENSITY',
    'Liquid density must be finite and > 0.',
  )
  const lowerRate = positiveOrThrow(
    canonicalValue(tank.lowerRate),
    'FLUID_LOWER_RATE',
    'Lowering rate must be finite and > 0.',
  )
  const gravity = positiveOrThrow(
    canonicalValue(tank.gravity),
    'FLUID_GRAVITY',
    'Gravity must be finite and > 0.',
  )

  return {
    tankId: tank.id,
    blockId: tank.block.id,
    liquidId: tank.liquid.id,
    blockMass,
    blockVolume,
    blockHeight,
    crossSection: blockVolume / blockHeight,
    blockDensity: blockMass / blockVolume,
    liquidDensity,
    lowerRate,
    gravity,
  }
}
