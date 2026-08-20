import { add, magnitude, scale, subtract, type Vector3 } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'

export const COULOMB_CONSTANT = 8.987_551_792_3e9

const displacementFromSource = (sourcePosition: Vector3, samplePosition: Vector3): Vector3 =>
  subtract(samplePosition, sourcePosition)

const requireNonZeroDistance = (displacement: Vector3): number => {
  const distance = magnitude(displacement)
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new PhysicsOSError(
      'ELECTRIC_FIELD_SINGULARITY',
      'Point-charge field and potential are undefined at the source position.',
    )
  }
  return distance
}

export const pointChargeElectricField = (
  sourceCharge: number,
  sourcePosition: Vector3,
  samplePosition: Vector3,
): Vector3 => {
  const displacement = displacementFromSource(sourcePosition, samplePosition)
  const distance = requireNonZeroDistance(displacement)
  return scale(displacement, (COULOMB_CONSTANT * sourceCharge) / (distance ** 3))
}

export const pointChargePotential = (
  sourceCharge: number,
  sourcePosition: Vector3,
  samplePosition: Vector3,
): number => {
  const distance = requireNonZeroDistance(displacementFromSource(sourcePosition, samplePosition))
  return (COULOMB_CONSTANT * sourceCharge) / distance
}

export const superposeElectricFields = (fields: readonly Vector3[]): Vector3 =>
  fields.reduce((sum, field) => add(sum, field), { x: 0, y: 0, z: 0 })

export const electricForce = (charge: number, electricField: Vector3): Vector3 =>
  scale(electricField, charge)

export const coulombForce = (
  sourceCharge: number,
  testCharge: number,
  sourcePosition: Vector3,
  testPosition: Vector3,
): Vector3 => electricForce(
  testCharge,
  pointChargeElectricField(sourceCharge, sourcePosition, testPosition),
)
