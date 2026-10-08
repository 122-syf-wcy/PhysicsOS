import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {
  PluginCenter,
  loadPluginCatalog,
  type PluginCenterEntry,
} from './catalog.ts'
import { openPluginCenterDomain } from './domain.ts'
import { identityOf } from './identity.ts'
import {
  loadPluginManifest,
  type RawPluginManifest,
  type ValidatedPluginManifest,
} from './manifest.ts'
import { pluginCenterRoutes } from './routes.ts'
import { loadPluginTrustPublicKey } from './trust.ts'

export const name = 'plugin-center'
export const inject = ['webServer', 'storageDomain']

export {
  PINNED_HARNESS_REVISION,
  PINNED_HARNESS_TAG,
  PINNED_HARNESS_VERSION,
  PluginCenter,
  PluginCenterError,
  loadPluginCatalog,
  officialCatalog,
  physicsosCatalog,
  supportsPinnedHarness,
  type OfficialPluginDetails,
  type PluginActor,
  type PluginCatalogSources,
  type PluginCenterEntry,
  type PluginCenterOptions,
  type PluginCenterState,
  type PluginCompatibility,
  type PluginEnablementRecord,
  type PluginIntegrity,
  type PluginSource,
  type PluginStateTable,
  type PluginStatus,
} from './catalog.ts'
export {
  ManifestValidationError,
  PLUGIN_CAPABILITIES,
  loadPluginManifest,
  pluginManifestEntryPayload,
  validatePluginManifest,
  type LoadPluginManifestOptions,
  type PluginCapability,
  type RawPluginManifest,
  type RawPluginManifestEntry,
  type ValidatedPluginManifest,
  type ValidatedPluginManifestEntry,
} from './manifest.ts'
export { pluginCenterDomain, openPluginCenterDomain, type PluginCenterDomain } from './domain.ts'
export {
  IDENTITY_SERVICE,
  PluginRoutesError,
  identityOf,
  requireSuperAdmin,
  type PhysicsosIdentity,
} from './identity.ts'
export { pluginCenterRoutes, type PluginCenterRouteDeps } from './routes.ts'
export {
  BUNDLED_PLUGIN_TRUST_PUBLIC_KEY_PATH,
  PLUGIN_TRUST_PUBLIC_KEY_ENV,
  PLUGIN_TRUST_PUBLIC_KEY_FILE_ENV,
  loadPluginTrustPublicKey,
  type PluginTrustOptions,
} from './trust.ts'

interface PluginInventoryService {
  list(): Promise<PluginInventorySnapshot>
}

interface PluginManagerRow {
  entryId: string
  moduleName: string
  readOnlyReason?: string
}

interface PluginManagerService {
  listPlugins(): Promise<PluginManagerRow[]>
  setPluginEnabled(entryId: string, enabled: boolean): Promise<{ application: string }>
}

const loadBundledManifest = async (): Promise<ValidatedPluginManifest> => {
  const manifestPath = fileURLToPath(new URL('../plugins/manifest.json', import.meta.url))
  const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as RawPluginManifest
  const trustedPublicKey = await loadPluginTrustPublicKey()
  return loadPluginManifest(raw, { rootDir, trustedPublicKey })
}

/**
 * Mount the read state and super-admin enable/disable surface.
 * @param ctx Cordis context with webServer/storageDomain.
 * @returns effect disposer for the route and domain.
 */
export function apply(ctx: Context): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain = await openPluginCenterDomain(ctx)
    const manifest = await loadBundledManifest()
    const entries: PluginInventorySnapshot = { entries: [] }
    const inventory = async (): Promise<PluginInventorySnapshot> => {
      const service = ctx.get('pluginInventory') as PluginInventoryService | undefined
      return service === undefined ? entries : service.list()
    }
    const center = new PluginCenter({
      catalog: () => loadPluginCatalog({
        official: inventory,
        physicsos: () => Promise.resolve(manifest.entries),
      }),
      states: domain.table('enablement'),
      applyEnablement: async (entry: PluginCenterEntry, enabled: boolean): Promise<void> => {
        const managerService = ctx.get('pluginManager') as PluginManagerService | undefined
        if (managerService === undefined) return
        const row = (await managerService.listPlugins())
          .find(candidate => candidate.moduleName === entry.id)
        if (row === undefined) return
        if (row.readOnlyReason !== undefined) {
          throw new Error(`plugin-center: ${entry.id} cannot be managed (${row.readOnlyReason})`)
        }
        const result = await managerService.setPluginEnabled(row.entryId, enabled)
        if (result.application === 'failed' || result.application === 'cancelled') {
          throw new Error(`plugin-center: enablement of ${entry.id} was not applied`)
        }
      },
    })

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/plugins',
      handler: pluginCenterRoutes({
        center,
        identity: () => identityOf(ctx),
      }),
    })
    yield () => domain.close()
  }, 'plugin-center')
}
