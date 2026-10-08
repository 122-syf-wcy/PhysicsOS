import type { PhysicsSemanticIR } from './semantic-ir.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsEngine, ModelSupport } from '@physicsos/physics-core'
import { questionEngine } from '@physicsos/physics-runtime'

export interface EngineSelectionResult {
  engine: PhysicsEngine<PhysicsScene> | null
  support: ModelSupport | null
  reason?: string
}

export function selectEngine(ir: PhysicsSemanticIR): EngineSelectionResult {
  const entry = questionEngine(ir.domain, ir.model)
  return entry === undefined
    ? {
        engine: null,
        support: null,
        reason: 'No engine available for domain ' + ir.domain + ' / model ' + ir.model,
      }
    : { engine: entry.engine, support: null }
}
