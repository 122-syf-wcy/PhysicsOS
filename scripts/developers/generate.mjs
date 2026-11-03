import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { zipBytes } from '../../developer-kit/experiment-template/tools/archive.mjs'
import { downloadableResources, styleKitFiles } from './resources.mjs'

const output = fileURLToPath(
  new URL(
    '../../overlays/harness/files/apps/web/public/physicsos/developers/downloads/',
    import.meta.url,
  ),
)
const check = process.argv.includes('--check')
if (!check) await mkdir(output, { recursive: true })
async function emit(name, body) {
  if (!check) return writeFile(`${output}/${name}`, body)
  const expected = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const actual = await readFile(`${output}/${name}`)
  if (!expected.equals(actual)) throw new Error(`Generated resource is stale: ${name}`)
}
const resources = downloadableResources()

// Store-only ZIP: deterministic paths and timestamps, UTF-8, no archive dependency.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
const local = []
const central = []
let offset = 0
const files = styleKitFiles()
files.set('LICENSE', await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'))
for (const [path, body] of files) {
  const name = Buffer.from(`physicsos-code-style-v1/${path}`)
  const data = Buffer.from(body)
  const checksum = crc32(data)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x800, 6)
  header.writeUInt16LE(0x5d62, 12) // 2026-11-02
  header.writeUInt32LE(checksum, 14)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(name.length, 26)
  local.push(header, name, data)
  const index = Buffer.alloc(46)
  index.writeUInt32LE(0x02014b50)
  index.writeUInt16LE(20, 4)
  index.writeUInt16LE(20, 6)
  index.writeUInt16LE(0x800, 8)
  index.writeUInt16LE(0x5d62, 14)
  index.writeUInt32LE(checksum, 16)
  index.writeUInt32LE(data.length, 20)
  index.writeUInt32LE(data.length, 24)
  index.writeUInt16LE(name.length, 28)
  index.writeUInt32LE(offset, 42)
  central.push(index, name)
  offset += header.length + name.length + data.length
}
const directory = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50)
end.writeUInt16LE(files.size, 8)
end.writeUInt16LE(files.size, 10)
end.writeUInt32LE(directory.length, 12)
end.writeUInt32LE(offset, 16)
await emit('physicsos-code-style-v1.zip', Buffer.concat([...local, directory, end]))
console.log(
  `${check ? 'Verified' : 'Generated'} ${resources.size} documents and ${files.size}-file style kit`,
)

const template = new URL('../../developer-kit/experiment-template/', import.meta.url)
const templateFiles = new Map()
const roots = ['src', 'public', 'tools', 'tests', 'preview']
const rootFiles = [
  '.editorconfig',
  '.gitignore',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'eslint.config.mjs',
  'prettier.config.mjs',
  'experiment.json',
  'parameters.json',
  'teaching.json',
  'cases.json',
  'ASSET-LICENSES.json',
  'LICENSE',
  ...[...resources.keys()].filter(
    (name) =>
      name.endsWith('.md') || name.endsWith('.schema.json') || name === 'experiment.example.json',
  ),
  'README.md',
  'MODEL.md',
]
async function collectTemplate(path) {
  const { lstat } = await import('node:fs/promises')
  const item = await lstat(new URL(path, template))
  if (item.isSymbolicLink()) throw new Error('Unexpected template symlink')
  if (item.isDirectory()) {
    for (const name of (await readdir(new URL(path + '/', template))).sort()) {
      if (name.startsWith('.') || name === 'node_modules')
        throw new Error('Unexpected template resource')
      await collectTemplate(path + '/' + name)
    }
  } else if (item.isFile())
    templateFiles.set(
      'physicsos-experiment-template-v2/' + path,
      await readFile(new URL(path, template)),
    )
  else throw new Error('Unexpected template resource')
}
for (const path of [...new Set([...roots, ...rootFiles])].sort()) await collectTemplate(path)
const bytes = zipBytes(templateFiles)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const release = {
  schemaVersion: 2,
  experimentId: 'convex-lens',
  url: `/physicsos/developers/downloads/physicsos-experiment-template-v2-${sha256}.zip`,
  sha256,
  bytes: bytes.length,
}
await emit('physicsos-experiment-template-v2.zip', bytes)
await emit(`physicsos-experiment-template-v2-${sha256}.zip`, bytes)
await emit('template-release.json', JSON.stringify(release, null, 2) + '\n')
for (const [name, body] of downloadableResources({
  release,
  origin: 'https://physics.dongsiwei.com',
}))
  await emit(name, body)
console.log(
  `${check ? 'Verified' : 'Generated'} V2 template (${templateFiles.size} files, ${bytes.length} bytes; SHA-256 ${sha256})`,
)
// Historical V1 archive remains frozen and is deliberately never regenerated.
