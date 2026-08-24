import type { PhysicsSemanticIR } from './semantic-ir.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsEngine, ModelSupport } from '@physicsos/physics-core'
import { ElectricEngine } from '@physicsos/engine-electric'
import { ElectricRegionEngine } from '@physicsos/engine-electric-region'
import { CompositeEngine } from '@physicsos/engine-composite'
import { MagneticEngine } from '@physicsos/engine-magnetic'
import { MechanicsEngine } from '@physicsos/engine-mechanics'

const electricEngine = new ElectricEngine()
const electricRegionEngine = new ElectricRegionEngine()
const compositeEngine = new CompositeEngine()
const magneticEngine = new MagneticEngine()
const mechanicsEngine = new MechanicsEngine()

export interface EngineSelectionResult {
  engine: PhysicsEngine<PhysicsScene> | null
  support: ModelSupport | null
  reason?: string
}

const COMPOSITE_MODELS = new Set([
  'velocity_selector',
  'mass_spectrometer',
  'cyclotron',
  'charged_particle_composite_field',
])

export function selectEngine(ir: PhysicsSemanticIR): EngineSelectionResult {
  /* Composite models are matched on the model id alone, before the domain checks.
     A crossed-field question can legitimately be tagged 'electric', 'magnetic' or
     'composite' depending on which parser claimed it, but only the composite engine
     models more than one force — every other engine rejects a multi-field scene at
     canHandle, so routing on the domain would send it somewhere it cannot run. */
  if (COMPOSITE_MODELS.has(ir.model)) {
    return { engine: compositeEngine as unknown as PhysicsEngine<PhysicsScene>, support: null }
  }
  /* Bounded (parallel-plate) uniform electric field routes to the region engine,
     which only accepts scenes carrying a region-bound uniform field; the
     unbounded electric engine explicitly rejects regions and boundaries, so the
     two are mutually exclusive by canHandle. */
  if (ir.domain === 'electric' && ir.model === 'charged_particle_bounded_electric_field') {
    return { engine: electricRegionEngine as unknown as PhysicsEngine<PhysicsScene>, support: null }
  }
  if (
    (ir.domain === 'electric' && ir.model === 'charged_particle_uniform_electric_field') ||
    (ir.domain === 'electric' && ir.model === 'point_charge_electrostatic_field')
  ) {
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
