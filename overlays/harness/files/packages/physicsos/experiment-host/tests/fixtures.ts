import { crc32, deflateRawSync } from 'node:zlib'

export const manifest = {
  schemaVersion: 1, protocolVersion: 1, packageType: 'browser-static',
  experimentId: 'convex-lens', version: '1.0.0', entry: 'dist/index.html',
  renderer: 'three', theme: 'physicsos-warm-lab-v1', engine: { id: 'optics', contractVersion: 1 },
  parameters: 'parameters.json', teaching: 'teaching.json', referenceCases: 'cases.json',
  assetLicenses: 'ASSET-LICENSES.json', cover: 'dist/assets/icon.svg', license: 'Apache-2.0',
}
export const files = () => ({
  'experiment.json': JSON.stringify(manifest),
  'dist/index.html': '<!doctype html><link rel="stylesheet" href="assets/main.css"><script type="module" src="runtime/main.js"></script>',
  'dist/runtime/main.js': 'import "./protocol.js"; document.body.textContent="Three lens"',
  'dist/runtime/protocol.js': 'export const protocolVersion=1;',
  'dist/assets/main.css': 'body{color:#333}',
  'dist/assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  'src/main.ts': 'export const neverExecute = true;',
  'parameters.json': '[]', 'teaching.json': '{}', 'cases.json': '[]', 'ASSET-LICENSES.json': '[]',
  'README.md': 'Review this package.', 'MODEL.md': 'Thin lens.', 'LICENSE': 'Apache-2.0',
})
export function checksum(bytes: Buffer): number { return crc32(bytes) }
export interface ZipItem { name: string; data: string | Buffer; localName?: string; flags?: number; method?: number; mode?: number; claimedSize?: number; badCrc?: boolean; descriptor?: boolean }
export function zip(items: ZipItem[] = Object.entries(files()).map(([name, data]) => ({ name, data }))): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const raw = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data)
    const method = item.method ?? 0, flags = item.flags ?? (item.descriptor ? 0x808 : 0x800)
    const packed = method === 8 ? deflateRawSync(raw) : raw
    const name = Buffer.from(item.name), localName = Buffer.from(item.localName ?? item.name)
    const crc = item.badCrc ? 0 : checksum(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(item.claimedSize ?? raw.length, 22); local.writeUInt16LE(localName.length, 26)
    const descriptor = item.descriptor ? Buffer.alloc(16) : Buffer.alloc(0)
    if (item.descriptor) { descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(packed.length, 8); descriptor.writeUInt32LE(raw.length, 12); local.fill(0, 14, 26) }
    locals.push(local, localName, packed, descriptor)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50); head.writeUInt16LE(0x314, 4); head.writeUInt16LE(20, 6)
    head.writeUInt16LE(flags, 8); head.writeUInt16LE(method, 10); head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(item.claimedSize ?? raw.length, 24)
    head.writeUInt16LE(name.length, 28); head.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38)
    head.writeUInt32LE(offset, 42)
    central.push(head, name); offset += local.length + localName.length + packed.length + descriptor.length
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, end])
}
export const uploadBody = (archive = zip()) => ({ zipBase64: archive.toString('base64'), author: { name: 'Contributor', bio: 'Lens author', github: 'https://github.com/lens-author' }, note: 'First version' })
export const contributor = { userKey: 'school:contributor', schoolId: 'school', username: 'contributor', role: 'STUDENT' as const }
export const other = { ...contributor, userKey: 'school:other', username: 'other' }
export const schoolAdmin = { ...other, role: 'SCHOOL_ADMIN' as const }
export const admin = { userKey: 'platform:ops', schoolId: 'platform', username: 'ops', role: 'SUPER_ADMIN' as const }
