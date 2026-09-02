/**
 * Engine dispatch for the tool runtime.
 *
 * Every PhysicsOS engine implements the same `PhysicsEngine` contract and ships
 * its own `create*SimulationRequest`. The tool runtime never guesses a domain
 * from titles: it asks each engine `canHandle(scene)` and runs the first one
 * that accepts, exactly as the Lab does through its per-domain runtimes. The
 * engines are mutually exclusive by construction (each rejects the apparatus
 * collections it does not model), so "first accepting engine" is deterministic.
 */

import type {
  PhysicsEngine,
  PhysicsEventLike,
  SimulationRequest,
  SimulationResult,
} from '@physicsos/physics-core'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { verifyMagneticScene } from '@physicsos/physics-verifier'
import { MagneticEngine, createMagneticSimulationRequest } from '@physicsos/engine-magnetic'
import { MechanicsEngine, createMechanicsSimulationRequest } from '@physicsos/engine-mechanics'
import { ElectricEngine, createElectricSimulationRequest } from '@physicsos/engine-electric'
import {
  ElectricRegionEngine,
  createElectricRegionSimulationRequest,
} from '@physicsos/engine-electric-region'
import { CompositeEngine, createCompositeSimulationRequest } from '@physicsos/engine-composite'
import { CircuitEngine, createCircuitSimulationRequest } from '@physicsos/engine-circuit'
import { OpticsEngine, createOpticsSimulationRequest } from '@physicsos/engine-optics'
import { AcousticsEngine, createAcousticsSimulationRequest } from '@physicsos/engine-acoustics'
import { FluidEngine, createFluidSimulationRequest } from '@physicsos/engine-fluid'
import { ThermalEngine, createThermalSimulationRequest } from '@physicsos/engine-thermal'
import { LeverEngine, createLeverSimulationRequest } from '@physicsos/engine-lever'
import { InductionEngine, createInductionSimulationRequest } from '@physicsos/engine-induction'
import { WaveEngine, createWaveSimulationRequest } from '@physicsos/engine-wave'

type AnyEngine = PhysicsEngine<PhysicsScene, PhysicsEventLike>
type RequestBuilder = (scene: PhysicsScene, simulationId: string, traceId: string) => SimulationRequest

export interface EngineEntry {
  readonly engine: AnyEngine
  readonly createRequest: RequestBuilder
}

const entry = (engine: unknown, createRequest: unknown): EngineEntry => ({
  engine: engine as AnyEngine,
  createRequest: createRequest as RequestBuilder,
})

/**
 * Order matters only where two engines could both accept: the composite engine
 * must be asked before the single-field engines (it models E and B together),
 * and the bounded electric engine before the unbounded one. Every other pair is
 * disjoint by apparatus.
 */
export const ENGINES: readonly EngineEntry[] = [
  entry(new CompositeEngine(), createCompositeSimulationRequest),
  entry(new ElectricRegionEngine(), createElectricRegionSimulationRequest),
  entry(new ElectricEngine(), createElectricSimulationRequest),
  entry(new MagneticEngine(), createMagneticSimulationRequest),
  entry(new MechanicsEngine(), createMechanicsSimulationRequest),
  entry(new LeverEngine(), createLeverSimulationRequest),
  entry(new CircuitEngine(), createCircuitSimulationRequest),
  entry(new OpticsEngine(), createOpticsSimulationRequest),
  entry(new AcousticsEngine(), createAcousticsSimulationRequest),
  entry(new FluidEngine(), createFluidSimulationRequest),
  entry(new ThermalEngine(), createThermalSimulationRequest),
  entry(new InductionEngine(), createInductionSimulationRequest),
  entry(new WaveEngine(), createWaveSimulationRequest),
]

/** The engine that accepts the scene, with the conditions the others failed on when none does. */
export const pickEngine = (
  scene: PhysicsScene,
): { entry: EngineEntry } | { entry: undefined; reasons: readonly string[] } => {
  const reasons: string[] = []
  for (const candidate of ENGINES) {
    const support = candidate.engine.canHandle(scene)
    if (support.supported) return { entry: candidate }
    reasons.push(
      `${candidate.engine.engineId}: ${support.failedConditions.map((failure) => failure.condition).join(', ')}`,
    )
  }
  return { entry: undefined, reasons }
}

/**
 * The teaching domain a scene belongs to, as the Lab shelves it. Engines report
 * the physics they model (`PhysicsDomainId`), which is broader than the shelf in
 * two places: the echo range says `wave` but is taught as acoustics, and the
 * buoyancy tank says `mechanics` but is taught as fluid statics. Everything
 * else coincides.
 */
export const domainOfEngine = (engine: AnyEngine): string => {
  switch (engine.engineId) {
    case 'engine-acoustics':
      return 'acoustics'
    case 'engine-fluid':
      return 'fluid'
    default:
      return engine.domain
  }
}

export interface SimulatedScene {
  readonly engineId: string
  readonly domain: string
  readonly simulation: SimulationResult<PhysicsEventLike>
}

/**
 * Simulate a scene with the engine that accepts it. The magnetic engine's
 * verification is replaced by the external Physics Verifier, exactly as the
 * Question Runtime does, so the named conservation checks are the same ones a
 * student sees in the Lab.
 */
export const simulateScene = (
  scene: PhysicsScene,
  entryFor: EngineEntry,
  simulationId: string,
  traceId: string,
): SimulatedScene => {
  const request = entryFor.createRequest(scene, simulationId, traceId)
  let simulation = entryFor.engine.simulate(scene, request)
  if (entryFor.engine.engineId === 'engine-magnetic') {
    simulation = { ...simulation, verification: verifyMagneticScene(scene, simulation) }
  }
  return { engineId: entryFor.engine.engineId, domain: domainOfEngine(entryFor.engine), simulation }
}
