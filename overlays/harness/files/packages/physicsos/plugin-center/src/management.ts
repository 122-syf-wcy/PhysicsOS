import { PluginCenterError } from './catalog.ts'

/** A package catalog row cannot silently toggle just one of several instances. */
export function managedEntryFor<T extends { readonly moduleName: string }>(
  rows: readonly T[],
  packageId: string,
): T | undefined {
  const matches = rows.filter(row => row.moduleName === packageId)
  if (matches.length > 1) {
    throw new PluginCenterError(409, 'MULTIPLE_PLUGIN_INSTANCES',
      `${packageId} has multiple configured instances; manage the individual entries in the native plugin manager`)
  }
  return matches[0]
}
