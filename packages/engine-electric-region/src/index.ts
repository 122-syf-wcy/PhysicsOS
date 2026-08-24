/**
 * Electric Region Engine — bounded (parallel-plate) uniform electric field.
 *
 * This engine handles a uniform electric field bound to a rectangular region
 * (the gap between two parallel plates). A charged particle travels in a
 * straight line outside the field, follows a parabola inside, and produces
 * discrete events on entering, leaving, or striking a plate.
 *
 * It implements the same `PhysicsEngine<PhysicsScene, PhysicsEventLike>`
 * interface as the magnetic, mechanics and (unbounded) electric engines, and
 * is mutually exclusive with `@physicsos/engine-electric` by `canHandle`:
 * this engine only accepts a scene whose uniform field carries a `regionId`,
 * while the unbounded electric engine rejects any scene with regions or
 * boundaries.
 */
export {
  ELECTRIC_REGION_ENGINE_ID,
  ELECTRIC_REGION_ENGINE_VERSION,
  PARALLEL_PLATE_MODEL,
  ElectricRegionEngine,
  createElectricRegionSimulationRequest,
  electricRegionEngine,
  resolveParallelPlateModel,
  type ParallelPlateModel,
} from './electric-region-engine.ts'
