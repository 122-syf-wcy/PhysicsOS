import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadPluginManifest,
  pluginManifestEntryPayload,
  validatePluginManifest,
  type RawPluginManifest,
  type RawPluginManifestEntry,
} from '../src/manifest.ts'
import { loadPluginTrustPublicKey } from '../src/trust.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const baseEntry = (overrides: Partial<RawPluginManifestEntry> = {}): RawPluginManifestEntry => ({
  id: 'physicsos.example',
  name: 'Example Physics Plugin',
  version: '0.1.0',
  harnessRange: '>=0.1.7-rc.2 <0.1.8',
  capabilities: ['storage.read', 'tools.register'],
  entry: 'plugins/example/index.js',
  publisher: 'PhysicsOS',
  sha256: 'a'.repeat(64),
  signature: `ed25519:${'A'.repeat(86)}`,
  ...overrides,
})

const manifest = (entry = baseEntry()): RawPluginManifest => ({
  schemaVersion: 1,
  entries: [entry],
})

describe('PhysicsOS plugin manifest', () => {
  it('validates the required signed entry fields before a digest is accepted', () => {
    const validated = validatePluginManifest(manifest())

    expect(validated.entries).toEqual([{
      id: 'physicsos.example',
      name: 'Example Physics Plugin',
      version: '0.1.0',
      harnessRange: '>=0.1.7-rc.2 <0.1.8',
      capabilities: ['storage.read', 'tools.register'],
      entry: 'plugins/example/index.js',
      publisher: 'PhysicsOS',
      sha256: 'a'.repeat(64),
      compatibility: 'compatible',
      integrity: 'missing',
    }])
  })

  it('rejects unsigned entries and entries with a missing digest', () => {
    expect(() => validatePluginManifest(manifest(baseEntry({ signature: '' }))))
      .toThrow(/signature/)
    expect(() => validatePluginManifest(manifest({
      ...baseEntry(),
      sha256: undefined,
    } as unknown as RawPluginManifestEntry)))
      .toThrow(/sha256/)
  })

  it('rejects unknown capabilities', () => {
    expect(() => validatePluginManifest(manifest(baseEntry({ capabilities: ['root.everything'] }))))
      .toThrow(/capabilit/)
  })

  it('rejects duplicate plugin ids', () => {
    expect(() => validatePluginManifest({
      schemaVersion: 1,
      entries: [baseEntry(), baseEntry({ name: 'Duplicate' })],
    })).toThrow(/duplicate/)
  })

  it('rejects absolute and traversal entry paths', () => {
    for (const entry of ['/tmp/plugin.js', '../plugin.js', 'plugins/../../plugin.js', 'C:\\plugin.js']) {
      expect(() => validatePluginManifest(manifest(baseEntry({ entry }))), entry)
        .toThrow(/entry/)
    }
  })

  it('rejects a Harness range that excludes the pinned runtime', () => {
    expect(() => validatePluginManifest(manifest(baseEntry({ harnessRange: '^0.1.6' }))))
      .toThrow(/Harness/)
  })

  it('verifies a digest against the contained preinstalled entry file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-plugin-digest-'))
    roots.push(root)
    await mkdir(join(root, 'plugins/example'), { recursive: true })
    const bytes = 'export const installed = true\n'
    await writeFile(join(root, 'plugins/example/index.js'), bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const unsigned = baseEntry({ sha256 })
    const signed = baseEntry({
      sha256,
      signature: `ed25519:${sign(null, pluginManifestEntryPayload(unsigned), privateKey).toString('base64')}`,
    })

    const validated = await loadPluginManifest(manifest(signed), {
      rootDir: root,
      trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    expect(validated.entries[0]?.integrity).toBe('verified')
  })

  it('verifies the publisher signature when a trust root is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-plugin-signature-'))
    roots.push(root)
    await mkdir(join(root, 'plugins/example'), { recursive: true })
    const bytes = 'export const signed = true\n'
    await writeFile(join(root, 'plugins/example/index.js'), bytes)
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const unsigned = baseEntry({
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    const signature = `ed25519:${sign(null, pluginManifestEntryPayload(unsigned), privateKey).toString('base64')}`
    const signed = baseEntry({
      sha256: unsigned.sha256,
      signature,
    })

    const validated = await loadPluginManifest(manifest(signed), {
      rootDir: root,
      trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    expect(validated.entries[0]?.integrity).toBe('verified')

    const tamperedBytes = Buffer.from(signature.slice('ed25519:'.length), 'base64')
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 1
    await expect(loadPluginManifest(manifest(baseEntry({
      sha256: unsigned.sha256,
      signature: `ed25519:${tamperedBytes.toString('base64')}`,
    })), {
      rootDir: root,
      trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).rejects.toThrow(/signature/)

    await expect(loadPluginManifest(manifest(signed), {
      rootDir: root,
      trustedPublicKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    })).rejects.toThrow(/not a private key/)
  })

  it('loads the bundled trust root by default and accepts public-key overrides', async () => {
    const bundled = await loadPluginTrustPublicKey({
      env: {},
      readFile: async path => `bundled key from ${path}`,
    })
    expect(bundled).toMatch(/^bundled key from /)

    const inline = await loadPluginTrustPublicKey({
      env: { PHYSICSOS_PLUGIN_TRUST_PUBLIC_KEY: 'inline-public-key' },
      readFile: async () => {
        throw new Error('inline key must not read a file')
      },
    })
    expect(inline).toBe('inline-public-key')

    const fromFile = await loadPluginTrustPublicKey({
      env: { PHYSICSOS_PLUGIN_TRUST_PUBLIC_KEY_FILE: '/run/secrets/plugin-signing.pub' },
      readFile: async path => `file key from ${path}`,
    })
    expect(fromFile).toBe('file key from /run/secrets/plugin-signing.pub')
  })

  it('refuses a digest mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-plugin-digest-'))
    roots.push(root)
    await mkdir(join(root, 'plugins/example'), { recursive: true })
    await writeFile(join(root, 'plugins/example/index.js'), 'tampered\n')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const unsigned = baseEntry()
    const signed = baseEntry({
      signature: `ed25519:${sign(null, pluginManifestEntryPayload(unsigned), privateKey).toString('base64')}`,
    })

    await expect(loadPluginManifest(manifest(signed), {
      rootDir: root,
      trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).rejects.toThrow(/digest/)
  })

  it('refuses file verification without a trusted public key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-plugin-trust-root-'))
    roots.push(root)

    await expect(loadPluginManifest(manifest(), { rootDir: root }))
      .rejects.toThrow(/trusted ed25519 public key/)
  })

  it('refuses an entry that escapes the configured root even after shape validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-plugin-digest-'))
    roots.push(root)
    const { publicKey } = generateKeyPairSync('ed25519')

    await expect(loadPluginManifest(manifest(baseEntry({ entry: 'safe/plugin.js' })), {
      rootDir: root,
      trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      readFile: async () => {
        throw new Error('unexpected read')
      },
      resolvePath: () => '/outside/plugin.js',
    })).rejects.toThrow(/contained|entry/)
  })

  it('verifies the shipped preinstalled manifest with the bundled trust root', async () => {
    const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
    const vendorRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const trustedPublicKey = await import('node:fs/promises').then(fs =>
      fs.readFile(join(pluginRoot, 'plugins/physicsos-plugin-signing.pub'), 'utf8'))
    const raw = JSON.parse(
      await import('node:fs/promises').then(fs =>
        fs.readFile(join(pluginRoot, 'plugins/manifest.json'), 'utf8')),
    ) as RawPluginManifest

    const validated = await loadPluginManifest(raw, { rootDir: vendorRoot, trustedPublicKey })
    expect(validated.entries).toHaveLength(12)
    expect(validated.entries.every(entry => entry.integrity === 'verified')).toBe(true)
  })
})
