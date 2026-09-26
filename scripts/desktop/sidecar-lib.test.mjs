import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  collectHarnessCliSidecar,
  createSidecarManifest,
  nodeDistribution,
  PINNED_NODE_VERSION,
} from './sidecar-lib.mjs'

describe('desktop sidecar packaging', () => {
  it('resolves the bundled Node entry relative to the manifest', () => {
    const manifest = createSidecarManifest()
    assert.equal(manifest.version, 1)
    assert.equal(manifest.command, './runtime/node')
    assert.deepEqual(manifest.args, ['./runtime/lib/bin.js'])
    assert.deepEqual(manifest.sidecarArgs, ['./runtime/sidecar/bridge.mjs'])
    assert.equal(manifest.workingDirectory, './runtime')
    assert.equal(createSidecarManifest({ platform: 'win32' }).command, './runtime/node.exe')
  })

  it('maps target platforms to checksum-pinned official Node archives', () => {
    assert.equal(
      nodeDistribution('darwin', 'arm64').archive,
      `node-v${PINNED_NODE_VERSION}-darwin-arm64.tar.gz`,
    )
    assert.equal(nodeDistribution('darwin', 'x64').sha256.length, 64)
    assert.equal(nodeDistribution('win32', 'x64').executable, 'node.exe')
    assert.throws(() => nodeDistribution('win32', 'arm64'), /No bundled Node runtime/)
  })

  it('collects the CLI runtime and writes a portable manifest', async () => {
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

    const result = await collectHarnessCliSidecar({
      repoRoot,
      targetDir,
      cacheDir: join(root, 'cache'),
      verifyChecksum: false,
      async downloadArchive(url, destination) {
        assert.match(url, /nodejs\.org\/dist/)
        writeFileSync(destination, 'fixture archive')
      },
      extractArchive({ destination, distribution }) {
        const extractedRoot = join(destination, distribution.directory)
        mkdirSync(join(extractedRoot, 'bin'), { recursive: true })
        writeFileSync(join(extractedRoot, 'bin/node'), '#!/usr/bin/env node\n')
        writeFileSync(join(extractedRoot, 'LICENSE'), 'Node license fixture\n')
        return {
          extractedRoot,
          source: join(extractedRoot, 'bin/node'),
        }
      },
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
    assert.equal(result.nodePath, join(targetDir, 'runtime/node'))
    assert.equal(existsSync(result.manifestPath), true)
    assert.equal(existsSync(result.bridgePath), true)
    assert.equal(existsSync(join(targetDir, 'runtime/node-runtime.json')), true)
    assert.equal(
      existsSync(join(targetDir, 'runtime/node_modules/@deepseek-ai/example/package.json')),
      true,
    )
    assert.equal(
      existsSync(join(targetDir, 'runtime/node_modules/@deepseek-ai/example-child/lib/index.js')),
      true,
    )
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    assert.equal(manifest.command, './runtime/node')
    assert.deepEqual(manifest.args, ['./runtime/lib/bin.js'])
    assert.deepEqual(manifest.sidecarArgs, ['./runtime/sidecar/bridge.mjs'])
  })
})
