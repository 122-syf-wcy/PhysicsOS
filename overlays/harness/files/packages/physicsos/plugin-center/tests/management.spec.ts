import { describe, expect, it } from 'vitest'
import { managedEntryFor } from '../src/management.ts'
import { loadPluginCatalog, PluginCenter, type PluginEnablementRecord } from '../src/catalog.ts'

describe('package enablement with multiple native instances', () => {
  it('refuses ambiguous enablement before writing a false package-wide override', async () => {
    const inventory = { entries: ['preset-standard', 'preset-physics-student'].map(entryId => ({
      entryId: entryId as never, moduleName: '@deepseek-ai/dsh-agent-preset', enabled: true, fiberPhase: 'active' as const,
    })) }
    const records = new Map<string, PluginEnablementRecord>()
    const center = new PluginCenter({
      catalog: () => loadPluginCatalog({ official: async () => inventory, physicsos: async () => [] }),
      states: {
        get: id => records.get(id), entries: () => records.entries(),
        put: async (id, record) => { records.set(id, record) },
      },
      applyEnablement: async (entry) => { managedEntryFor(inventory.entries, entry.id) },
    })
    await expect(center.setEnabled('@deepseek-ai/dsh-agent-preset', false, {
      userKey: 'platform:admin', schoolId: 'platform', username: 'admin', role: 'SUPER_ADMIN',
    })).rejects.toMatchObject({ status: 409, code: 'MULTIPLE_PLUGIN_INSTANCES' })
    expect(records.size).toBe(0)
    expect((await center.state()).entries[0]?.status).toBe('enabled')
  })

  it('requires choosing a native entry rather than silently changing the first preset', () => {
    const rows = ['preset-standard', 'preset-physics-student'].map(entryId => ({ entryId, moduleName: '@deepseek-ai/dsh-agent-preset' }))
    expect(() => managedEntryFor(rows, '@deepseek-ai/dsh-agent-preset')).toThrow(/multiple configured instances/)
  })

  it('retains the exact single managed row and its read-only reason', () => {
    const row = { entryId: 'web', moduleName: '@deepseek-ai/dsh-host-webserver', readOnlyReason: 'profile-read-only' }
    expect(managedEntryFor([row], row.moduleName)).toBe(row)
    expect(managedEntryFor([row], 'absent')).toBeUndefined()
  })
})
