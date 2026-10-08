import { satisfies, validRange } from 'semver'
import type {
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { PluginLocalizedMeta } from '@deepseek-ai/dsh-package-manifest'
import type { ValidatedPluginManifestEntry } from './manifest.ts'

/** Harness release pinned by the PhysicsOS image. */
export const PINNED_HARNESS_VERSION = '0.1.7-rc.2'
/** Release tag that carries {@link PINNED_HARNESS_VERSION}. */
export const PINNED_HARNESS_TAG = 'dsh-v0.1.7-rc.2'
/** Immutable revision carried by {@link PINNED_HARNESS_TAG}. */
export const PINNED_HARNESS_REVISION = '477b4f420553e8a52c2fbccc464d7561b239c443'
/**
 * Packages retained in the tree for upgrades and migrations, but absent from
 * the supported product surface. They never appear in the administrator
 * catalog, even if an older profile composition still loads one.
 */
const RETIRED_PLUGIN_IDS = new Set(['@deepseek-ai/dsh-class-host'])

export type PluginSource = 'official' | 'physicsos'
export type PluginCompatibility = 'compatible' | 'incompatible' | 'unknown'
export type PluginStatus = 'enabled' | 'disabled' | 'failed'
export type PluginIntegrity = 'verified' | 'missing'

/** Exact state record consumed by the administrator plugin center. */
export interface PluginCenterEntry {
  id: string
  name: string
  version: string
  source: PluginSource
  compatibility: PluginCompatibility
  status: PluginStatus
  capabilities: string[]
  description?: string
  publisher: string
  harnessRange: string
  integrity: PluginIntegrity
}

/** Exact state envelope returned by `GET /physicsos/plugins/state`. */
export interface PluginCenterState {
  pinnedHarnessVersion: string
  entries: PluginCenterEntry[]
  updatedAt: string
}

/** Durable administrator choice. Only enablement is persisted. */
export interface PluginEnablementRecord {
  id: string
  enabled: boolean
  updatedAt: string
  updatedBy: string
}

/** The subset of the storage-domain table this package owns. */
export interface PluginStateTable {
  get(id: string): PluginEnablementRecord | undefined
  entries(): IterableIterator<[string, PluginEnablementRecord]>
  put(id: string, record: PluginEnablementRecord): Promise<void>
}

export interface PluginActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
}

export class PluginCenterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PluginCenterError'
  }
}

/** Product-specific facts layered over the upstream runtime inventory. */
export interface OfficialPluginDetails {
  version?: string
  harnessRange?: string
  compatibility?: PluginCompatibility
  capabilities?: readonly string[]
  publisher?: string
  description?: string
  integrity?: PluginIntegrity
}

export interface PluginCatalogSources {
  official(): Promise<PluginInventorySnapshot>
  physicsos(): Promise<readonly ValidatedPluginManifestEntry[]>
  officialDetails?(entry: PluginInventoryEntry): OfficialPluginDetails | undefined
}

export interface PluginCenterOptions {
  catalog(): Promise<readonly PluginCenterEntry[]>
  states: PluginStateTable
  applyEnablement?(entry: PluginCenterEntry, enabled: boolean): Promise<void>
  now?(): Date
}

const localizedText = (
  value: string | { readonly en: string; readonly [locale: string]: string } | undefined,
  fallback: string,
): string => {
  if (typeof value === 'string') return value
  if (value === undefined) return fallback
  return value.en || Object.values(value).find(text => text !== '') || fallback
}

const metaText = (
  meta: PluginLocalizedMeta | undefined,
  field: 'title' | 'description',
  fallback: string,
): string => localizedText(meta?.[field], fallback)

const assertUniqueIds = (entries: readonly PluginCenterEntry[]): void => {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new PluginCenterError(500, 'DUPLICATE_PLUGIN_ID', `plugin id is duplicated: ${entry.id}`)
    }
    seen.add(entry.id)
  }
}

/**
 * Project upstream runtime inventory into the official half of the catalog.
 *
 * Package discovery stays in `@deepseek-ai/dsh-host-plugin-inventory`; this
 * function only maps its stable fields and product compatibility metadata.
 */
export const officialCatalog = (
  snapshot: PluginInventorySnapshot,
  detailsOf?: (entry: PluginInventoryEntry) => OfficialPluginDetails | undefined,
): PluginCenterEntry[] => snapshot.entries.map((entry) => {
  const details = detailsOf?.(entry)
  const description = details?.description
    ?? metaText(entry.meta, 'description', '')
  return {
    id: entry.moduleName,
    name: metaText(entry.meta, 'title', entry.moduleName),
    version: details?.version ?? PINNED_HARNESS_VERSION,
    source: 'official',
    compatibility: details?.compatibility
      ?? (entry.fiberPhase === 'failed' ? 'incompatible' : 'compatible'),
    status: entry.fiberPhase === 'failed' ? 'failed' : entry.enabled ? 'enabled' : 'disabled',
    capabilities: [...(details?.capabilities ?? [])],
    ...(description === '' ? {} : { description }),
    publisher: details?.publisher ?? 'DeepSeek',
    harnessRange: details?.harnessRange ?? `=${PINNED_HARNESS_VERSION}`,
    integrity: details?.integrity ?? 'verified',
  }
})

/** Project validated PhysicsOS manifest entries, overlaying live runtime status. */
export const physicsosCatalog = (
  entries: readonly ValidatedPluginManifestEntry[],
  inventory: PluginInventorySnapshot,
): PluginCenterEntry[] => {
  const runtimeById = new Map(inventory.entries.map(entry => [entry.moduleName, entry]))
  return entries.map((entry) => {
    const runtime = runtimeById.get(entry.id)
    const status: PluginStatus = runtime?.fiberPhase === 'failed'
      ? 'failed'
      : runtime?.enabled === true
        ? 'enabled'
        : 'disabled'
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      source: 'physicsos',
      compatibility: entry.compatibility,
      status,
      capabilities: [...entry.capabilities],
      ...(entry.description === undefined ? {} : { description: entry.description }),
      publisher: entry.publisher,
      harnessRange: entry.harnessRange,
      integrity: entry.integrity,
    }
  })
}

/**
 * Compose the two catalogs. PhysicsOS manifest ids claim their package name,
 * so the same preinstalled package cannot also appear as an official row.
 */
export const loadPluginCatalog = async (
  sources: PluginCatalogSources,
): Promise<PluginCenterEntry[]> => {
  const [official, physicsos] = await Promise.all([
    sources.official(),
    sources.physicsos(),
  ])
  const physicsosIds = new Set(physicsos.map(entry => entry.id))
  const entries = [
    ...officialCatalog({
      entries: official.entries.filter(entry =>
        !physicsosIds.has(entry.moduleName) && !RETIRED_PLUGIN_IDS.has(entry.moduleName)),
    }, entry => sources.officialDetails?.(entry)),
    ...physicsosCatalog(physicsos, official),
  ]
  assertUniqueIds(entries)
  return entries.sort((left, right) =>
    left.source === right.source
      ? left.id.localeCompare(right.id)
      : left.source === 'official' ? -1 : 1)
}

const stateStatus = (entry: PluginCenterEntry, enabled: boolean): PluginStatus => {
  if (!enabled) return 'disabled'
  if (entry.status === 'failed') return 'failed'
  if (entry.compatibility !== 'compatible' || entry.integrity !== 'verified') return 'disabled'
  return 'enabled'
}

/**
 * Storage-backed product state over a catalog projection.
 *
 * The catalog remains source-controlled and immutable; the domain persists
 * only the administrator's enable/disable choice for each stable id.
 */
export class PluginCenter {
  private readonly now: () => Date

  constructor(private readonly options: PluginCenterOptions) {
    this.now = () => options.now?.() ?? new Date()
  }

  private async overlayState(): Promise<PluginCenterEntry[]> {
    const entries = await this.options.catalog()
    const overrides = new Map(this.options.states.entries())
    return entries.map((entry) => {
      const override = overrides.get(entry.id)
      return override === undefined
        ? { ...entry, capabilities: [...entry.capabilities] }
        : { ...entry, capabilities: [...entry.capabilities], status: stateStatus(entry, override.enabled) }
    })
  }

  /**
   * Current product catalog with persisted administrator choices applied.
   * @returns the exact state envelope consumed by the administrator UI.
   */
  async state(): Promise<PluginCenterState> {
    const entries = await this.overlayState()
    const records = [...this.options.states.entries()].map(([, record]) => record)
    const updatedAt = records.reduce(
      (latest, record) => record.updatedAt > latest ? record.updatedAt : latest,
      '',
    ) || this.now().toISOString()
    return {
      pinnedHarnessVersion: PINNED_HARNESS_VERSION,
      entries,
      updatedAt,
    }
  }

  /**
   * Validate and persist one administrator enable/disable choice.
   * @param id stable catalog id.
   * @param enabled requested state.
   * @param actor server-resolved super administrator.
   * @returns the updated catalog row.
   */
  async setEnabled(id: string, enabled: boolean, actor: PluginActor): Promise<PluginCenterEntry> {
    const base = (await this.options.catalog()).find(entry => entry.id === id)
    if (base === undefined) throw new PluginCenterError(404, 'NOT_FOUND', `unknown plugin: ${id}`)
    if (enabled && base.compatibility !== 'compatible') {
      throw new PluginCenterError(
        409,
        'INCOMPATIBLE',
        `${id} is incompatible with Harness ${PINNED_HARNESS_VERSION}`,
      )
    }
    if (enabled && base.integrity !== 'verified') {
      throw new PluginCenterError(409, 'INTEGRITY_MISSING', `${id} has no verified integrity digest`)
    }
    if (enabled && base.status === 'failed') {
      throw new PluginCenterError(409, 'PLUGIN_FAILED', `${id} is in a failed runtime state`)
    }

    await this.options.applyEnablement?.(base, enabled)
    const record: PluginEnablementRecord = {
      id,
      enabled,
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.options.states.put(id, record)
    return {
      ...base,
      capabilities: [...base.capabilities],
      status: stateStatus(base, enabled),
    }
  }
}

/** True when a version range accepts the pinned image runtime. */
export const supportsPinnedHarness = (harnessRange: string): boolean => {
  try {
    return validRange(harnessRange) !== null
      && satisfies(PINNED_HARNESS_VERSION, harnessRange)
  } catch {
    return false
  }
}
