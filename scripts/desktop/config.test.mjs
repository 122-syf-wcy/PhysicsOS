import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateReleaseConfig } from './release-lib.mjs'

const desktop = fileURLToPath(new URL('../../apps/desktop/', import.meta.url))

function read(path) {
  return readFileSync(new URL(path, `file://${desktop}`), 'utf8')
}

describe('Tauri desktop configuration', () => {
  it('builds an unsigned shell while retaining the signed updater path', () => {
    const config = JSON.parse(read('src-tauri/tauri.conf.json'))
    validateReleaseConfig(config, { mode: 'development' })
    assert.equal(config.bundle.active, true)
    assert.equal(config.bundle.createUpdaterArtifacts, true)
    assert.deepEqual(config.bundle.icon, [
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ])
    assert.equal(config.build.frontendDist, '../web')
    assert.equal(config.bundle.targets, 'all')
    assert.equal(config.bundle.resources, undefined)
    assert.match(config.build.beforeDevCommand, /\bpnpm\b/)
    assert.equal(config.build.devUrl, 'http://127.0.0.1:3080')
    assert.equal(config.app.withGlobalTauri, true)
    assert.equal(config.app.windows[0].visible, false)
    assert.equal(config.bundle.macOS?.signingIdentity, undefined)
    assert.equal(config.bundle.windows?.certificateThumbprint, undefined)
  })

  it('keeps the shell capability surface to core IPC', () => {
    const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
    assert.deepEqual(capability.windows, ['main'])
    assert.deepEqual(capability.permissions, ['core:default'])
    assert.deepEqual(capability.remote, { urls: ['http://127.0.0.1:38971'] })
  })

  it('registers updater and local sidecar native code', () => {
    const cargo = read('src-tauri/Cargo.toml')
    assert.match(cargo, /tauri-plugin-updater/)
    assert.match(read('src-tauri/src/lib.rs'), /sidecar_request/)

    const localPackage = read('../../scripts/desktop/package-local.mjs')
    assert.match(localPackage, /localUnsignedEnvironment/)
    assert.match(localPackage, /--no-bundle/)
  })

  it('has a standalone web fallback for a buildable production shell', () => {
    assert.match(read('web/index.html'), /<div id="app"><\/div>/)
    assert.match(read('web/index.html'), /Development fallback/)
  })

  it('packages the real frontend and a resolveable sidecar for release builds', () => {
    const packageRelease = readFileSync(
      new URL('../../scripts/desktop/package-release.mjs', import.meta.url),
      'utf8',
    )
    const packageSidecar = readFileSync(
      new URL('../../scripts/desktop/package-sidecar.mjs', import.meta.url),
      'utf8',
    )
    const sidecarLib = readFileSync(
      new URL('../../scripts/desktop/sidecar-lib.mjs', import.meta.url),
      'utf8',
    )
    assert.equal(packageRelease.includes('vendor/deepseek-harness/apps/web/dist'), true)
    assert.match(packageRelease, /pnpm_config_verify_deps_before_run/)
    assert.match(packageRelease, /skip-sidecar-build/)
    assert.match(packageRelease, /resources: \{ 'resources\/agent-sidecar\/': 'agent-sidecar\/' \}/)
    assert.match(packageSidecar, /pnpm_config_verify_deps_before_run/)
    assert.equal(packageSidecar.includes('collectHarnessCliSidecar'), true)
    assert.equal(sidecarLib.includes('https://nodejs.org/dist'), true)
    assert.match(sidecarLib, /node-v\$\{PINNED_NODE_VERSION\}-win-x64\.zip/)
    const sidecar = read('src-tauri/src/sidecar.rs')
    assert.match(sidecar, /resource_dir/)
    assert.match(sidecar, /agent-sidecar\/sidecar\.json/)
    assert.match(sidecar, /sidecar_args/)
    assert.match(read('sidecar/bridge.mjs'), /BRIDGE_PROTOCOL_VERSION/)
    assert.match(read('sidecar/bridge.mjs'), /session\/create/)
    assert.match(read('sidecar/bridge.mjs'), /run\/resume/)
    assert.match(read('src-tauri/src/lib.rs'), /web_host/)
    assert.equal(
      existsSync(new URL('../../apps/desktop/src-tauri/src/web_host.rs', import.meta.url)),
      true,
    )
  })
})
