import { describe, expect, it } from 'vitest'
import { validateArchive } from '../src/archive.ts'
import { files, manifest, legacyFiles, zip } from './fixtures.ts'
const base = () => Object.entries(files()).map(([name, data]) => ({ name, data }))

describe('static experiment archive boundary', () => {
  it('accepts store and deflate packages without executing contributor source', async () => {
    for (const method of [0, 8]) {
      const result = await validateArchive(zip(base().map(item => ({ ...item, method }))))
      expect(result.manifest.version).toBe('1.0.0')
      expect([...result.assets.keys()]).toContain('dist/runtime/main.js')
      expect([...result.assets.keys()]).not.toContain('src/main.ts')
    }
  })
  it('accepts template source and license files but exposes compiled assets only', async () => {
    const result = await validateArchive(
      zip([
        ...base(),
        { name: 'dist/vendor/THREE-LICENSE.txt', data: 'MIT License' },
        { name: 'public/index.html', data: '<h1>Build source</h1>' },
        { name: 'tools/build.mjs', data: 'throw new Error("Must not run")' },
        { name: 'tests/package.test.mjs', data: 'throw new Error("Must not run")' },
        { name: 'eslint.config.mjs', data: 'export default []' },
        { name: 'prettier.config.mjs', data: 'export default {}' },
        { name: 'package.json', data: '{"scripts":{"install":"exit 1"}}' },
        { name: 'tsconfig.json', data: '{}' },
        { name: 'tsconfig.build.json', data: '{}' },
        { name: 'package-lock.json', data: '{}' },
      ]),
    )
    expect(result.assets.get('dist/vendor/THREE-LICENSE.txt')?.toString()).toBe('MIT License')
    expect([...result.assets.keys()]).not.toContain('tools/build.mjs')
    expect([...result.assets.keys()]).not.toContain('package.json')
  })
  it('accepts ordinary data descriptors but rejects missing or forged ones', async () => {
    const descriptors = zip(base().map(item => ({ ...item, method: 8, descriptor: true })))
    expect((await validateArchive(descriptors)).manifest.version).toBe('1.0.0')
    await expect(
      validateArchive(zip(base().map(item => ({ ...item, flags: 0x808 })))),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    const corrupt = Buffer.from(descriptors)
    const at = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
    corrupt.writeUInt32LE(0, at + 4)
    await expect(validateArchive(corrupt)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
  it('resolves template importmaps only to verified package assets', async () => {
    const entries = base().filter(
      item => !['dist/index.html', 'dist/runtime/main.js'].includes(item.name),
    )
    const mapped = [
      {
        name: 'dist/index.html',
        data: '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script><script type="module" src="runtime/main.js"></script>',
      },
      { name: 'dist/runtime/main.js', data: 'import * as THREE from "three";' },
      { name: 'dist/vendor/three.module.js', data: 'export const Three=true;' },
    ]
    expect(
      (await validateArchive(zip([...entries, ...mapped]))).assets.has(
        'dist/vendor/three.module.js',
      ),
    ).toBe(true)
    for (const target of [
      'https://evil.example/three.js',
      '../src/main.ts',
      './vendor/missing.js',
    ]) {
      await expect(
        validateArchive(
          zip([
            ...entries,
            ...mapped.map(item =>
              item.name === 'dist/index.html'
                ? { ...item, data: item.data.replace('./vendor/three.module.js', target) }
                : item,
            ),
          ]),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    }
  })
  it('rejects a central directory whose declared count hides extra entries', async () => {
    const items = [...base(), { name: 'dist/hidden.js', data: 'hidden' }]
    const bytes = zip(items),
      end = bytes.length - 22
    bytes.writeUInt16LE(items.length - 1, end + 8)
    bytes.writeUInt16LE(items.length - 1, end + 10)
    await expect(validateArchive(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
  it.each([
    '../escape.js',
    '/escape.js',
    'C:/escape.js',
    'dist/../escape.js',
    'dist\\escape.js',
    'dist/.secret',
    'dist/%2e%2e/escape.js',
    'dist//escape.js',
  ])('rejects unsafe path %s', async (name) => {
    await expect(validateArchive(zip([...base(), { name, data: 'x' }]))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    })
  })
  it.each([
    { name: 'dist/runtime/main.js', data: 'duplicate' },
    { name: 'dist/symlink.js', data: '/etc/passwd', mode: 0o120777 },
    { name: 'dist/encrypted.js', data: 'x', flags: 0x801 },
    { name: 'dist/unknown.js', data: 'x', method: 99 },
    { name: 'dist/mismatch.js', localName: 'dist/different.js', data: 'x' },
    { name: 'dist/corrupt.js', data: 'x', badCrc: true },
    { name: 'dist/bomb.js', data: 'x', claimedSize: 21 * 1024 * 1024 },
    { name: 'dist/truncated.js', data: 'x', claimedSize: 10 },
    { name: 'dist/page.php', data: 'source' },
    { name: '.env', data: 'private' },
  ])('rejects malformed archive entry $name', async (item) => {
    await expect(validateArchive(zip([...base(), item]))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    })
  })
  it('rejects truncated zip, compressed body size, expanded size and entry count', async () => {
    await expect(validateArchive(zip().subarray(0, -8))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    })
    await expect(validateArchive(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toMatchObject({
      status: 413,
    })
    await expect(
      validateArchive(
        zip([
          ...base(),
          ...Array.from({ length: 1001 }, (_, i) => ({ name: `dist/${i}.js`, data: 'x' })),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(
      validateArchive(
        zip([
          ...base(),
          ...Array.from({ length: 3 }, (_, i) => ({
            name: `dist/${i}.js`,
            data: Buffer.alloc(15 * 1024 * 1024),
            method: 8,
          })),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
  it.each([
    { change: { engine: { id: 'mechanics', contractVersion: 1 } }, code: 'INVALID_MANIFEST' },
    { change: { protocolVersion: 1 }, code: 'INCOMPATIBLE_PROTOCOL' },
    { change: { renderer: 'two' }, code: 'INVALID_MANIFEST' },
    { change: { experimentId: 'other' }, code: 'UNSUPPORTED_EXPERIMENT' },
    { change: { entry: '../index.html' }, code: 'INVALID_MANIFEST' },
    { change: { entry: 'src/main.ts' }, code: 'INVALID_MANIFEST' },
    { change: { theme: 'other' }, code: 'INVALID_MANIFEST' },
  ])('rejects incompatible manifest %j', async ({ change, code }) => {
    const entries = base().filter(item => item.name !== 'experiment.json')
    await expect(
      validateArchive(
        zip([
          ...entries,
          { name: 'experiment.json', data: JSON.stringify({ ...manifest, ...change }) },
        ]),
      ),
    ).rejects.toMatchObject({ code })
  })
  it.each([
    ['dist/index.html', '<script src="https://evil.example/x.js"></script>'],
    ['dist/index.html', '<script src="../src/main.ts"></script>'],
    ['dist/index.html', '<script src="runtime/missing.js"></script>'],
    ['dist/runtime/main.js', 'import "https://evil.example/x.js"'],
    ['dist/runtime/main.js', 'import "../../src/main.ts"'],
    ['dist/assets/main.css', 'body{background:url(https://evil.example/pixel)}'],
    ['dist/assets/main.css', '@import "missing.css";'],
    [
      'dist/other.html',
      '<script type="importmap">{"imports":{"three":"https://evil.example/three.js"}}</script>',
    ],
  ])('rejects unsafe or missing dependency in %s', async (name, data) => {
    await expect(
      validateArchive(zip([...base().filter(item => item.name !== name), { name, data }])),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
})

describe('version-aware archive intake', () => {
  it('rejects new V1 intake but verifies frozen legacy packages explicitly', async () => {
    const bytes = zip(Object.entries(legacyFiles()).map(([name, data]) => ({ name, data })))
    await expect(validateArchive(bytes)).rejects.toMatchObject({ code: 'PACKAGE_UPGRADE_REQUIRED' })
    expect((await validateArchive(bytes, { allowLegacy: true })).manifest.schemaVersion).toBe(1)
  })
  it('returns bounded safe metadata issues rather than collapsing them into ZIP errors', async () => {
    const entries = Object.entries(files()).map(([name, data]) => ({
      name,
      data: name === 'teaching.json' ? '{secret-sensitive-value' : data,
    }))
    await expect(validateArchive(zip(entries))).rejects.toMatchObject({
      code: 'INVALID_METADATA',
      issues: [{ file: 'teaching.json', path: '$', suggestion: expect.any(String) as unknown }],
    })
  })
})
