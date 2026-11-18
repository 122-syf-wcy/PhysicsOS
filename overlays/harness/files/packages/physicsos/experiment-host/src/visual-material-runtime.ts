/** Runtime-only composition. Does not register plugins/routes or import any test repository. */
import type { VisualMaterialPngValidator, VisualMaterialRecoveryResult } from './visual-material-contracts.ts'
import { FileVisualMaterialBlobStore } from './visual-material-blobs.ts'
import { PostgresVisualMaterialRepository, type PostgresVisualMaterialRepositoryOptions } from './visual-material-postgres.ts'
import { DefaultVisualMaterialService } from './visual-material-service.ts'

export interface VisualMaterialRuntimeOptions extends PostgresVisualMaterialRepositoryOptions {
  readonly dshHome?: string
  readonly validatePng?: VisualMaterialPngValidator
}
export function createVisualMaterialRuntime(options: VisualMaterialRuntimeOptions): {
  readonly repository: PostgresVisualMaterialRepository
  readonly blobs: FileVisualMaterialBlobStore
  readonly service: DefaultVisualMaterialService
  /** Finish bounded pending recovery before mounting REST/tools. Issues are explicit; nothing is evicted. */
  readonly initialize: (signal?: AbortSignal) => Promise<readonly VisualMaterialRecoveryResult[]>
  readonly close: () => Promise<void>
} {
  const repository = new PostgresVisualMaterialRepository(options)
  const shared = {
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.validatePng === undefined ? {} : { validatePng: options.validatePng }),
  }
  const blobs = new FileVisualMaterialBlobStore({ ...shared, ...(options.dshHome === undefined ? {} : { dshHome: options.dshHome }) })
  const service = new DefaultVisualMaterialService({ repository, blobs, ...shared })
  return {
    repository, blobs, service,
    initialize: async signal => {
      try {
        await service.initialize(signal)
        const results: VisualMaterialRecoveryResult[] = []
        let after: import('./visual-material-contracts.ts').VisualMaterialRecoveryPosition | undefined
        do {
          const result = await service.recoverPending({ limit: 100, ...(after === undefined ? {} : { after }) }, signal)
          results.push(result); after = result.next
        } while (after !== undefined)
        return results
      } catch (error) { await repository.close(); throw error }
    },
    close: () => repository.close(),
  }
}
