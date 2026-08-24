/**
 * Composite field engine — E, B and gravity acting on one charged particle at once.
 *
 * Implements the same `PhysicsEngine<PhysicsScene, PhysicsEventLike>` contract as
 * the mechanics, magnetic and electric engines, and is mutually exclusive with all
 * of them by `canHandle`: this engine requires at least two uniform field kinds,
 * while each single-field engine rejects any scene carrying more than one field.
 */
export {
  COMPOSITE_ENGINE_ID,
  COMPOSITE_ENGINE_VERSION,
  COMPOSITE_FIELD_MODEL,
  CompositeEngine,
  compositeEngine,
  createCompositeSimulationRequest,
  decomposePhases,
  resolveCompositeModel,
  type CompositeModel,
  type CompositePhase,
  type PhaseBoundaryKind,
} from './composite-engine.ts'
