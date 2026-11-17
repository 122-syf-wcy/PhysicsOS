/** Internal read-only catalog seam. Same CLOSED approved template IDs as the published V3 catalog, never client UI or uploaded package IDs. */
import registry from './experiment-registry.json' with { type: 'json' }
export const EXPERIMENT_CATALOG_SERVICE = 'physicsosExperimentCatalog' as const
export interface PhysicsosExperimentCatalog {
  readonly schemaVersion: 1
  has(experimentId: string): boolean
}
const approvedIds: ReadonlySet<string> = new Set(registry.map(profile => profile.id))
/** Exposed only after ExperimentService.initialize succeeds. No package mutation, network request or fallback allowlist. */
export function createExperimentCatalogService(): PhysicsosExperimentCatalog {
  return Object.freeze({ schemaVersion: 1 as const, has: (experimentId: string): boolean => approvedIds.has(experimentId) })
}
