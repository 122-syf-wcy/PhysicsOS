import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compareVersions,
  DEVELOPMENT_UPDATE_PUBKEY,
  localUnsignedEnvironment,
  platformKey,
  resolveReleaseConfig,
  selectUpdate,
  validateReleaseConfig,
} from './release-lib.mjs'

const SIGNATURE =
  'RW5jb2RlZFNpZ25hdHVyZUZvclRlc3RzMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
const manifest = {
  version: '1.2.0',
  notes: 'Optics fixes',
  pub_date: '2026-09-26T03:00:00.000Z',
  platforms: {
    'darwin-aarch64': {
      url: 'https://dl.physicsos.dev/1.2.0/PhysicsOS.app.tar.gz',
      signature: SIGNATURE,
    },
  },
}

describe('desktop release helpers', () => {
  it('compares semantic versions numerically', () => {
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0)
    assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0)
    assert.equal(compareVersions('1.2.3+build.7', '1.2.3+build.8'), 0)
  })

  it('maps Node platform and architecture to Tauri updater names', () => {
    assert.equal(platformKey('darwin', 'arm64'), 'darwin-aarch64')
    assert.equal(platformKey('darwin', 'x64'), 'darwin-x86_64')
    assert.equal(platformKey('win32', 'x64'), 'windows-x86_64')
    assert.equal(platformKey('linux', 'x64'), 'linux-x86_64')
    assert.throws(() => platformKey('linux', 'arm64'), /no Tauri update target/i)
  })

  it('selects only a signed newer artifact for this platform', () => {
    assert.deepEqual(selectUpdate(manifest, 'darwin-aarch64', '1.1.0'), {
      version: '1.2.0',
      notes: 'Optics fixes',
      publishedAt: '2026-09-26T03:00:00.000Z',
      url: 'https://dl.physicsos.dev/1.2.0/PhysicsOS.app.tar.gz',
      signature: SIGNATURE,
    })
    assert.equal(selectUpdate(manifest, 'darwin-aarch64', '1.2.0'), null)
    assert.equal(selectUpdate(manifest, 'windows-x86_64', '1.1.0'), null)
  })

  it('rejects unsigned, placeholder, and non-HTTPS release artifacts', () => {
    assert.throws(
      () =>
        selectUpdate(
          {
            ...manifest,
            platforms: {
              'darwin-aarch64': { ...manifest.platforms['darwin-aarch64'], signature: '' },
            },
          },
          'darwin-aarch64',
          '1.1.0',
        ),
      /signature/i,
    )
    assert.throws(
      () =>
        selectUpdate(
          {
            ...manifest,
            platforms: {
              'darwin-aarch64': {
                ...manifest.platforms['darwin-aarch64'],
                signature: `placeholder-${'0'.repeat(40)}`,
              },
            },
          },
          'darwin-aarch64',
          '1.1.0',
        ),
      /signature/i,
    )
    assert.throws(
      () =>
        selectUpdate(
          {
            ...manifest,
            platforms: {
              'darwin-aarch64': {
                ...manifest.platforms['darwin-aarch64'],
                url: 'http://localhost/update.tar.gz',
              },
            },
          },
          'darwin-aarch64',
          '1.1.0',
        ),
      /HTTPS/i,
    )
  })

  it('requires the desktop updater to target update-host latest.json', () => {
    assert.doesNotThrow(() =>
      validateReleaseConfig(
        {
          version: '0.1.0',
          build: { frontendDist: '../web-release' },
          bundle: {
            createUpdaterArtifacts: true,
            resources: { 'resources/agent-sidecar/': 'agent-sidecar/' },
          },
          plugins: {
            updater: {
              pubkey: 'RWQf6LRCZ2P0m4aW6hYf3zIrYNIh4PqPjGKvY5fP6tUJw8ZVk0xWcQh3',
              endpoints: [
                'https://updates.physicsos.app/physicsos/update/latest.json?channel=stable',
              ],
            },
          },
        },
        { mode: 'release' },
      ),
    )
    assert.throws(
      () =>
        validateReleaseConfig(
          {
            version: '0.1.0',
            bundle: { createUpdaterArtifacts: false },
            plugins: {
              updater: {
                pubkey: 'REPLACE_ME',
                endpoints: ['https://physicsos.dev/latest.json'],
              },
            },
          },
          { mode: 'release' },
        ),
      /updater/i,
    )
  })

  it('rejects development keys and placeholder endpoints in release builds', () => {
    const production = {
      version: '0.1.0',
      build: { frontendDist: '../web-release' },
      bundle: {
        createUpdaterArtifacts: true,
        resources: { 'resources/agent-sidecar/': 'agent-sidecar/' },
      },
      plugins: {
        updater: {
          pubkey: 'RWQf6LRCZ2P0m4aW6hYf3zIrYNIh4PqPjGKvY5fP6tUJw8ZVk0xWcQh3',
          endpoints: ['https://updates.physicsos.app/physicsos/update/latest.json?channel=stable'],
        },
      },
    }

    assert.throws(
      () =>
        validateReleaseConfig(
          {
            ...production,
            plugins: {
              updater: {
                ...production.plugins.updater,
                pubkey: DEVELOPMENT_UPDATE_PUBKEY,
              },
            },
          },
          { mode: 'release' },
        ),
      /development key/i,
    )
    assert.throws(
      () =>
        validateReleaseConfig(
          {
            ...production,
            plugins: {
              updater: {
                ...production.plugins.updater,
                endpoints: ['https://physicsos.dev/physicsos/update/latest.json?channel=stable'],
              },
            },
          },
          { mode: 'release' },
        ),
      /placeholder/i,
    )
    assert.throws(
      () =>
        validateReleaseConfig(
          {
            ...production,
            plugins: {
              updater: {
                ...production.plugins.updater,
                endpoints: [
                  'https://updates.example.invalid/physicsos/update/latest.json?channel=stable',
                ],
              },
            },
          },
          { mode: 'release' },
        ),
      /placeholder/i,
    )
    assert.throws(
      () =>
        validateReleaseConfig(
          {
            ...production,
            plugins: {
              updater: {
                ...production.plugins.updater,
                endpoints: ['http://updates.physicsos.app/physicsos/update/latest.json'],
              },
            },
          },
          { mode: 'release' },
        ),
      /HTTPS/i,
    )
    assert.throws(
      () =>
        validateReleaseConfig(
          { ...production, build: { frontendDist: '../web' } },
          { mode: 'release' },
        ),
      /fallback/i,
    )
  })

  it('builds release configuration from a file plus environment overrides', () => {
    const base = {
      version: '0.1.0',
      build: { frontendDist: '../web' },
      bundle: {
        active: true,
        createUpdaterArtifacts: true,
        resources: { 'resources/agent-sidecar/': 'agent-sidecar/' },
      },
      plugins: {
        updater: {
          pubkey: DEVELOPMENT_UPDATE_PUBKEY,
          endpoints: ['https://physicsos.dev/physicsos/update/latest.json?channel=stable'],
        },
      },
    }
    const resolved = resolveReleaseConfig(
      base,
      {
        plugins: {
          updater: {
            pubkey: 'RWQf6LRCZ2P0m4aW6hYf3zIrYNIh4PqPjGKvY5fP6tUJw8ZVk0xWcQh3',
            endpoints: [
              'https://updates.physicsos.app/physicsos/update/latest.json?channel=stable',
            ],
          },
        },
      },
      {},
    )
    assert.equal(resolved.build.frontendDist, '../web-release')
    assert.equal(
      resolved.plugins.updater.pubkey,
      'RWQf6LRCZ2P0m4aW6hYf3zIrYNIh4PqPjGKvY5fP6tUJw8ZVk0xWcQh3',
    )

    const environment = resolveReleaseConfig(
      base,
      {},
      {
        PHYSICSOS_DESKTOP_UPDATE_PUBKEY: 'RWQf6LRCZ2P0m4aW6hYf3zIrYNIh4PqPjGKvY5fP6tUJw8ZVk0xWcQh3',
        PHYSICSOS_DESKTOP_UPDATE_ENDPOINT:
          'https://dl.physicsos.app/physicsos/update/latest.json?channel=stable',
      },
    )
    assert.deepEqual(environment.plugins.updater.endpoints, [
      'https://dl.physicsos.app/physicsos/update/latest.json?channel=stable',
    ])
  })

  it('removes certificate and updater-signing secrets for a local unsigned package', () => {
    const environment = localUnsignedEnvironment({
      PATH: '/usr/bin',
      TAURI_SIGNING_PRIVATE_KEY: 'secret',
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'password',
      APPLE_CERTIFICATE: 'p12',
      APPLE_CERTIFICATE_PASSWORD: 'password',
      APPLE_API_KEY: 'key',
      WINDOWS_CERTIFICATE: 'pfx',
      WINDOWS_CERTIFICATE_PASSWORD: 'password',
    })

    assert.deepEqual(environment, { PATH: '/usr/bin' })
  })
})
