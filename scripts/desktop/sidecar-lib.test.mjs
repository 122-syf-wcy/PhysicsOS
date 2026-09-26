import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { collectHarnessCliSidecar, createSidecarManifest } from './sidecar-lib.mjs'

describe('desktop sidecar packaging', () => {
  it('resolves the bundled Node entry relative to the manifest', () => {
    const manifest = createSidecarManifest()
    assert.equal(manifest.version, 1)
    assert.equal(manifest.command, 'node')
    assert.deepEqual(manifest.args, ['./runtime/lib/bin.js'])
    assert.deepEqual(manifest.sidecarArgs, ['./runtime/sidecar/bridge.mjs'])
    assert.equal(manifest.workingDirectory, './runtime')
  })

  it('collects the CLI runtime and writes a portable manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'physicsos-sidecar-test-'))
    const repoRoot = join(root, 'repo')
    const vendorRoot = join(repoRoot, 'vendor/deepseek-harness')
    const targetDir = join(repoRoot, 'apps/desktop/src-tauri/resources/agent-sidecar')
    mkdirSync(join(vendorRoot, 'vendor/example'), { recursive: true })
    mkdirSync(join(vendorRoot, 'apps/cli/lib'), { recursive: true })
    mkdirSync(join(vendorRoot, 'packages/example-child/lib'), { recursive: true })
    mkdirSync(join(repoRoot, 'apps/desktop/sidecar'), { recursive: true })
    writeFileSync(join(vendorRoot, 'apps/cli/lib/bin.js'), '#!/usr/bin/env node\n')
    writeFileSync(join(repoRoot, 'apps/desktop/sidecar/bridge.mjs'), '#!/usr/bin/env node\n')
    writeFileSync(
      join(vendorRoot, 'vendor/example/package.json'),
      JSON.stringify({ name: '@deepseek-ai/example', version: '1.0.0' }),
    )
    writeFileSync(
      join(vendorRoot, 'packages/example-child/package.json'),
      JSON.stringify({ name: '@deepseek-ai/example-child', version: '1.0.0' }),
    )
    writeFileSync(join(vendorRoot, 'packages/example-child/lib/index.js'), 'export {}\n')

    const result = collectHarnessCliSidecar({
      repoRoot,
      targetDir,
      run(command, args) {
        assert.equal(command, 'pnpm')
        const runtime = args.at(-1)
        mkdirSync(join(runtime, 'lib'), { recursive: true })
        writeFileSync(join(runtime, 'lib/bin.js'), '#!/usr/bin/env node\n')
        writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-fixture' }))
        return { status: 0 }
      },
    })

    assert.equal(result.entryPath, join(targetDir, 'runtime/lib/bin.js'))
    assert.equal(result.bridgePath, join(targetDir, 'runtime/sidecar/bridge.mjs'))
    assert.equal(existsSync(result.manifestPath), true)
    assert.equal(existsSync(result.bridgePath), true)
    assert.equal(
      existsSync(join(targetDir, 'runtime/node_modules/@deepseek-ai/example/package.json')),
      true,
    )
    assert.equal(
      existsSync(join(targetDir, 'runtime/node_modules/@deepseek-ai/example-child/lib/index.js')),
      true,
    )
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    assert.equal(manifest.command, 'node')
    assert.deepEqual(manifest.args, ['./runtime/lib/bin.js'])
    assert.deepEqual(manifest.sidecarArgs, ['./runtime/sidecar/bridge.mjs'])
  })
})
