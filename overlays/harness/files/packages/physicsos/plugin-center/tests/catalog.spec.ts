import { describe, expect, it } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  PINNED_HARNESS_VERSION,
  PluginCenter,
  loadPluginCatalog,
  type PluginCenterEntry,
  type PluginEnablementRecord,
  type PluginStateTable,
} from '../src/catalog.ts'

const stateTable = (): PluginStateTable => {
  const records = new Map<string, PluginEnablementRecord>()
  return {
    get: id => records.get(id),
    entries: () => records.entries(),
    put: async (id, record) => {
      records.set(id, record)
    },
  }
}

const inventory: PluginInventorySnapshot = {
  entries: [
    {
      entryId: 'web-server' as never,
      moduleName: '@deepseek-ai/dsh-host-webserver',
      enabled: true,
      fiberPhase: 'active',
      meta: { title: { en: 'Web Server' }, description: { en: 'Harness HTTP server' } },
    },
    {
      entryId: 'legacy-plugin' as never,
      moduleName: '@deepseek-ai/dsh-legacy-plugin',
      enabled: false,
      fiberPhase: null,
      meta: { title: 'Legacy Plugin' },
    },
  ],
}

describe('official plugin catalog', () => {
  it('projects the pinned inventory with the contract fields and no filesystem paths', async () => {
    const entries = await loadPluginCatalog({
      official: async () => inventory,
      physicsos: async () => [],
    })

    const server = entries.find(entry => entry.id === '@deepseek-ai/dsh-host-webserver')
    expect(server).toMatchObject({
      id: '@deepseek-ai/dsh-host-webserver',
      name: 'Web Server',
      version: PINNED_HARNESS_VERSION,
      source: 'official',
      compatibility: 'compatible',
      status: 'enabled',
      capabilities: [],
      publisher: 'DeepSeek',
      harnessRange: `=${PINNED_HARNESS_VERSION}`,
      integrity: 'verified',
    })
    expect(JSON.stringify(entries)).not.toMatch(/(?:\/Users\/|\/app\/|\/var\/lib\/)/)
  })

  it('keeps a version the compatibility surface rejects visible as incompatible', async () => {
    const entries = await loadPluginCatalog({
      official: async () => inventory,
      physicsos: async () => [],
      officialDetails: entry => entry.moduleName === '@deepseek-ai/dsh-legacy-plugin'
        ? { compatibility: 'incompatible', version: '0.1.6' }
        : undefined,
    })

    expect(entries.find(entry => entry.id === '@deepseek-ai/dsh-legacy-plugin')).toMatchObject({
      version: '0.1.6',
      compatibility: 'incompatible',
      status: 'disabled',
      integrity: 'verified',
    })
  })

  it('omits retired classroom packages from the product catalog', async () => {
    const entries = await loadPluginCatalog({
      official: async () => ({
        entries: [
          ...inventory.entries,
          {
            entryId: 'class-host' as never,
            moduleName: '@deepseek-ai/dsh-class-host',
            enabled: true,
            fiberPhase: 'active',
          },
        ],
      }),
      physicsos: async () => [],
    })

    expect(entries.some(entry => entry.id === '@deepseek-ai/dsh-class-host')).toBe(false)
  })

  it('persists enablement and refuses to enable an incompatible entry', async () => {
    const base: PluginCenterEntry[] = [
      {
        id: 'official.one',
        name: 'One',
        version: PINNED_HARNESS_VERSION,
        source: 'official',
        compatibility: 'compatible',
        status: 'enabled',
        capabilities: ['storage.read'],
        publisher: 'DeepSeek',
        harnessRange: `=${PINNED_HARNESS_VERSION}`,
        integrity: 'verified',
      },
      {
        id: 'old.plugin',
        name: 'Old',
        version: '0.1.6',
        source: 'official',
        compatibility: 'incompatible',
        status: 'disabled',
        capabilities: [],
        publisher: 'DeepSeek',
        harnessRange: '^0.1.6',
        integrity: 'verified',
      },
    ]
    const center = new PluginCenter({
      catalog: async () => base,
      states: stateTable(),
      now: () => new Date('2026-09-27T00:00:00.000Z'),
    })

    await center.setEnabled('official.one', false, {
      userKey: 'PHYSICSOS-OPEN:admin',
      schoolId: 'PHYSICSOS-OPEN',
      username: 'admin',
      role: 'SUPER_ADMIN',
    })
    expect((await center.state()).entries.find(entry => entry.id === 'official.one')?.status)
      .toBe('disabled')

    await expect(center.setEnabled('old.plugin', true, {
      userKey: 'PHYSICSOS-OPEN:admin',
      schoolId: 'PHYSICSOS-OPEN',
      username: 'admin',
      role: 'SUPER_ADMIN',
    })).rejects.toMatchObject({ status: 409, code: 'INCOMPATIBLE' })
  })

  it('refuses to enable an entry whose digest was not verified', async () => {
    const center = new PluginCenter({
      catalog: async () => [{
        id: 'physicsos.unverified',
        name: 'Unverified',
        version: '0.1.0',
        source: 'physicsos',
        compatibility: 'compatible',
        status: 'disabled',
        capabilities: ['storage.read'],
        publisher: 'PhysicsOS',
        harnessRange: `=${PINNED_HARNESS_VERSION}`,
        integrity: 'missing',
      }],
      states: stateTable(),
    })

    await expect(center.setEnabled('physicsos.unverified', true, {
      userKey: 'PHYSICSOS-OPEN:admin',
      schoolId: 'PHYSICSOS-OPEN',
      username: 'admin',
      role: 'SUPER_ADMIN',
    })).rejects.toMatchObject({ status: 409, code: 'INTEGRITY_MISSING' })
  })
})
