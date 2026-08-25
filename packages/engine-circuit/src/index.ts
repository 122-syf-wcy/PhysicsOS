/**
 * Circuit Engine — DC steady-state analysis of a single-source circuit.
 *
 * The engine resolves the scene's circuit into electrical nodes and branches
 * (union-find over connected terminals), then solves the operating point with
 * modified nodal analysis. A variable resistor turns the timeline into a
 * quasi-static slider sweep: `stateAt(t)` re-solves the DC operating point at
 * the slider position mapped from `t`, so charts plot U/I curves against the
 * sweep. Scenes without a variable resistor are static (timeline length 0).
 *
 * It implements the same `PhysicsEngine<PhysicsScene, PhysicsEventLike>`
 * interface as the magnetic, mechanics and electric engines, and is mutually
 * exclusive with them by `canHandle`: this engine only accepts pure circuit
 * scenes (exactly one circuit, no particles/bodies/fields/regions).
 */
export {
  CIRCUIT_ENGINE_ID,
  CIRCUIT_ENGINE_VERSION,
  DC_CIRCUIT_MODEL,
  CircuitEngine,
  circuitEngine,
  createCircuitSimulationRequest,
  resolveCircuitOperatingPoint,
  effectiveSliderResistance,
  sliderPositionAt,
  type CircuitOperatingPoint,
  type ComponentOperatingPoint,
} from './circuit-engine.ts'
export {
  IDEAL_VOLTMETER_RESISTANCE,
  MIN_SLIDER_RESISTANCE,
  resolveCircuitModel,
  type CircuitBranch,
  type ConductanceBranch,
  type ResolvedCircuitModel,
  type SourceBranch,
} from './circuit-model.ts'
export { solveCircuit, type BranchSolution, type CircuitSolution } from './mna-solver.ts'
