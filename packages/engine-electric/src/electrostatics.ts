/**
 * Electrostatics re-export.
 *
 * The field math itself lives in `@physicsos/physics-electric-core` so the engine,
 * the observation layer and the question pipeline all read ONE definition of
 * E = kq/r². This module stays as the engine's historical entry point; it adds no
 * physics of its own.
 */

export {
  COULOMB_CONSTANT,
  coulombForce,
  electricForce,
  pointChargeElectricField,
  pointChargePotential,
  superposeElectricFields,
} from '@physicsos/physics-electric-core'
