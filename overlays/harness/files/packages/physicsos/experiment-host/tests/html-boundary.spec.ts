import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inlineImportMapHashes, validateArchive } from '../src/archive.ts'
import { createHash } from 'node:crypto'
import { files, zip } from './fixtures.ts'
const run = promisify(execFile)

describe('bounded HTML tokenization', () => {
  it('scans 400 KB of unmatched script openings within a bounded subprocess', async () => {
    const source = fileURLToPath(new URL('../src/archive.ts', import.meta.url))
    const script = `import { inlineImportMapHashes } from ${JSON.stringify(source)}; console.log(JSON.stringify(inlineImportMapHashes(Buffer.from('<script>'.repeat(50000)))));`
    const result = await run(process.execPath, ['--experimental-transform-types', '--input-type=module', '--eval', script], { timeout: 2000 })
    expect(result.stdout.trim()).toBe('[]')
  })
  it('hashes the exact importmap text while ignoring fake scripts in comments and attributes', () => {
    const map = '\n{ "imports": { "three": "./runtime/main.js" } }\n'
    const html = `<!-- <script type="importmap">broken</script> --><div data-type="importmap" title="<script>"></div><script type="IMPORTMAP">${map}</script>`
    expect(inlineImportMapHashes(Buffer.from(html))).toEqual([`'sha256-${createHash('sha256').update(map).digest('base64')}'`])
  })
  it('rejects an entity-encoded external attribute through decoded HTML attributes', async () => {
    const entries = Object.entries(files()).map(([name, data]) => ({ name, data: name === 'dist/index.html' ? '<script src="https&#58;//evil.example/module.js"></script>' : data }))
    await expect(validateArchive(zip(entries))).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
})
