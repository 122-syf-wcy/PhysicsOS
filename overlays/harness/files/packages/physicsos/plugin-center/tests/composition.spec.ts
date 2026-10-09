import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { loadPluginCatalog, PluginCenter, type PluginStateTable, type PluginEnablementRecord } from '../src/catalog.ts'
import { loadPluginManifest, pluginManifestEntryPayload } from '../src/manifest.ts'
import { pluginCenterRoutes } from '../src/routes.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
})

// These are separate Loader entries in the real web-app preset patches, not
// duplicate declarations of a package in a signed catalog.
const presetInventory = (): PluginInventorySnapshot => ({
  entries: ['standard', 'minimal', 'cordis', 'ptc', 'physics-student'].map(id => ({
    entryId: `preset-${id}` as never,
    moduleName: '@deepseek-ai/dsh-agent-preset',
    enabled: true,
    fiberPhase: 'active',
  })),
})

async function signedPhysicsEntry() {
  const bytes = Buffer.from('export const name = "fixture-physics-tool"\n')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const entry = {
    id: '@deepseek-ai/dsh-tool-physicsos', name: 'Physics tool', version: '0.1.0',
    harnessRange: '=0.1.7-rc.2', capabilities: ['tools.register'],
    entry: 'plugins/physics-tool/index.js', publisher: 'PhysicsOS',
    sha256: createHash('sha256').update(bytes).digest('hex'), signature: '',
  }
  entry.signature = `ed25519:${sign(null, pluginManifestEntryPayload(entry), privateKey).toString('base64')}`
  const validated = await loadPluginManifest({ schemaVersion: 1, entries: [entry] }, {
    rootDir: '/fixture', readFile: async () => bytes,
    trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  })
  const result = validated.entries[0]
  if (result === undefined) throw new Error('signed fixture missing')
  return result
}

const states: PluginStateTable = {
  get: () => undefined,
  entries: () => new Map<string, PluginEnablementRecord>().entries(),
  put: async () => { throw new Error('read-only test must not write enablement') },
}

describe('native inventory to signed plugin catalog composition', () => {
  it('aggregates the repeated subagent tool package from the production inventory', async () => {
    const entries = await loadPluginCatalog({
      official: async () => ({ entries: ['subagent-main', 'subagent-physics'].map(entryId => ({
        entryId: entryId as never,
        moduleName: '@deepseek-ai/dsh-tool-subagent',
        enabled: true,
        fiberPhase: 'active' as const,
      })) }),
      physicsos: async () => [],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: '@deepseek-ai/dsh-tool-subagent', status: 'enabled' })
  })

  it('serves one package per real preset module and preserves signed PhysicsOS ownership', async () => {
    const signed = await signedPhysicsEntry()
    const inventory: PluginInventorySnapshot = { entries: [
      ...presetInventory().entries,
      { entryId: 'physics-active' as never, moduleName: signed.id, enabled: true, fiberPhase: 'active' },
      { entryId: 'physics-disabled' as never, moduleName: signed.id, enabled: false, fiberPhase: null },
    ] }
    const center = new PluginCenter({
      catalog: () => loadPluginCatalog({ official: async () => inventory, physicsos: async () => [signed] }),
      states,
    })
    const handler = pluginCenterRoutes({ center, identity: () => ({
      actorOf: () => ({ userKey: 'platform:admin', schoolId: 'platform', username: 'admin', role: 'SUPER_ADMIN' }),
      record: async () => {},
    }) })
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/physicsos/plugins/state`)
    expect(response.status).toBe(200)
    const body = await response.json() as { entries: { id: string; source: string; status: string; integrity: string }[] }
    expect(body.entries).toHaveLength(2)
    expect(new Set(body.entries.map(row => row.id)).size).toBe(2)
    expect(body.entries.find(row => row.id === signed.id)).toMatchObject({ source: 'physicsos', status: 'enabled', integrity: 'verified' })
  })

  it('retains a failed instance instead of taking the final healthy instance', async () => {
    const rows = presetInventory().entries
    const entries = await loadPluginCatalog({
      official: async () => ({ entries: rows.map((row, index) => ({ ...row, fiberPhase: index === 0 ? 'failed' : 'active' })) }),
      physicsos: async () => [],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ status: 'failed', compatibility: 'incompatible' })
  })

  it('still rejects duplicate native entry IDs even for signed managed packages', async () => {
    const signed = await signedPhysicsEntry()
    const row = { entryId: 'same-entry' as never, moduleName: signed.id, enabled: true, fiberPhase: 'active' as const }
    await expect(loadPluginCatalog({ official: async () => ({ entries: [row, row] }), physicsos: async () => [signed] }))
      .rejects.toMatchObject({ code: 'DUPLICATE_PLUGIN_ID' })
  })

  it('still rejects duplicate IDs inside the signed package catalog', async () => {
    const signed = await signedPhysicsEntry()
    await expect(loadPluginCatalog({ official: async () => presetInventory(), physicsos: async () => [signed, signed] }))
      .rejects.toMatchObject({ code: 'DUPLICATE_PLUGIN_ID' })
  })

  it('refuses conflicting package versions instead of deduplicating them silently', async () => {
    await expect(loadPluginCatalog({
      official: async () => presetInventory(), physicsos: async () => [],
      officialDetails: row => ({ version: row.entryId === 'preset-standard' ? '0.1.6' : '0.1.7-rc.2' }),
    })).rejects.toMatchObject({ code: 'DUPLICATE_PLUGIN_ID' })
  })
})
