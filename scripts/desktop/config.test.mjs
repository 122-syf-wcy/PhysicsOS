import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    validateReleaseConfig(config)
    assert.equal(config.bundle.active, true)
    assert.equal(config.bundle.createUpdaterArtifacts, true)
    assert.equal(config.build.frontendDist, '../web')
    assert.match(config.build.beforeDevCommand, /\bpnpm\b/)
    assert.equal(config.build.devUrl, 'http://127.0.0.1:3080')
    assert.equal(config.app.withGlobalTauri, true)
    assert.equal(config.bundle.macOS?.signingIdentity, undefined)
    assert.equal(config.bundle.windows?.certificateThumbprint, undefined)
  })

  it('keeps the shell capability surface to core IPC', () => {
    const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
    assert.deepEqual(capability.windows, ['main'])
    assert.deepEqual(capability.permissions, ['core:default'])
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
  })
})
