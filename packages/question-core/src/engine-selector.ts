import type { PhysicsSemanticIR } from './semantic-ir.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsEngine, ModelSupport } from '@physicsos/physics-core'
import { ElectricEngine } from '@physicsos/engine-electric'
import { MagneticEngine } from '@physicsos/engine-magnetic'
import { MechanicsEngine } from '@physicsos/engine-mechanics'

const electricEngine = new ElectricEngine()
const magneticEngine = new MagneticEngine()
const mechanicsEngine = new MechanicsEngine()

export interface EngineSelectionResult {
  engine: PhysicsEngine<PhysicsScene> | null
  support: ModelSupport | null
  reason?: string
}

export function selectEngine(ir: PhysicsSemanticIR): EngineSelectionResult {
  if (ir.domain === 'electric' && ir.model === 'charged_particle_uniform_electric_field') {
    return { engine: electricEngine as unknown as PhysicsEngine<PhysicsScene>, support: null }
  }
  if (ir.domain === 'magnetic' && ir.model === 'charged_particle_uniform_magnetic_field') {
    return { engine: magneticEngine as unknown as PhysicsEngine<PhysicsScene>, support: null }
  }
  if (ir.domain === 'mechanics') {
    return { engine: mechanicsEngine as unknown as PhysicsEngine<PhysicsScene>, support: null }
  }
  return {
    engine: null,
    support: null,
    reason: 'No engine available for domain ' + ir.domain + ' / model ' + ir.model,
  }
}
