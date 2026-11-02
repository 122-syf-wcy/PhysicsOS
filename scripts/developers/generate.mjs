import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
for (const [name, body] of resources) await emit(name, body)

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
