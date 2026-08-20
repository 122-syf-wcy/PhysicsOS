import { add, scale, magnitude, type Vector3 } from '@physicsos/physics-math'

export interface ForceDynamicsResult {
  netForce: Vector3
  acceleration: Vector3
}

export function newtonSecondLaw(
  mass: number,
  forces: readonly Vector3[],
): ForceDynamicsResult {
  const netForce = forces.reduce((acc, f) => add(acc, f), { x: 0, y: 0, z: 0 } as Vector3)
  const acceleration = scale(netForce, 1 / mass)
  return { netForce, acceleration }
}

export function inclineForceDecomposition(
  gravity: Vector3,
  inclineAngle: number,
): { parallel: number; normal: number } {
  const g = magnitude(gravity)
  const angleRad = (inclineAngle * Math.PI) / 180
  return {
    parallel: g * Math.sin(angleRad),
    normal: g * Math.cos(angleRad),
  }
}

export function inclineAcceleration(
  mass: number,
  gravity: Vector3,
  inclineAngle: number,
  frictionCoefficient: number,
): {
  gravityParallel: number
  gravityNormal: number
  normalForce: number
  frictionForce: number
  netForce: Vector3
  acceleration: Vector3
} {
  const g = magnitude(gravity)
  const angleRad = (inclineAngle * Math.PI) / 180
  const gravityParallel = g * Math.sin(angleRad)
  const gravityNormal = g * Math.cos(angleRad)
  const normalForce = mass * gravityNormal
  
  const maxStaticFriction = frictionCoefficient * normalForce
  const frictionForce = Math.min(maxStaticFriction, mass * gravityParallel)
  
  const netForceAlongIncline = mass * gravityParallel - frictionForce
  
  const unitAlongIncline = { x: Math.cos(angleRad), y: -Math.sin(angleRad), z: 0 } as Vector3
  
  const netForce = scale(unitAlongIncline, netForceAlongIncline)
  const acceleration = scale(netForce, 1 / mass)
  
  return {
    gravityParallel,
    gravityNormal,
    normalForce,
    frictionForce,
    netForce,
    acceleration,
  }
}
