import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, statfs, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateSync } from 'node:zlib'
import { afterEach, expect, it } from 'vitest'
import { FileVisualMaterialBlobStore } from '../src/visual-material-blobs.ts'
import { VISUAL_MATERIAL_DISK_RESERVE, type VisualMaterialRecord } from '../src/visual-material-contracts.ts'
import { visualMaterialDigest, visualMaterialIndex } from '../src/visual-material-domain.ts'
import { validateVisualMaterialPng } from '../src/visual-material-png.ts'

const homes: string[] = []
async function homeOf(): Promise<string> {
  const home = await mkdtemp(path.join(await realpath(tmpdir()), 'physicsos-vmat-blobs-')); homes.push(home); await chmod(home, 0o700); return home
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4), tag = Buffer.from(type), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])))
  return Buffer.concat([length, tag, data, crc])
}
const header = (width = 256, height = 256): Buffer => {
  const bytes = Buffer.alloc(13); bytes.writeUInt32BE(width); bytes.writeUInt32BE(height, 4); bytes[8] = 8; bytes[9] = 6; return bytes
}
function pngOf(data = Buffer.alloc(256 * 1025), compressed?: Buffer): Buffer {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header()), chunk('IDAT', compressed ?? deflateSync(data)), chunk('IEND', Buffer.alloc(0))])
}
const bytes = pngOf()
function recordOf(idChar = 'a'): VisualMaterialRecord {
  const descriptor = { id: `vmat_${idChar.repeat(32)}`, revision: 1, sha256: visualMaterialDigest(bytes), byteLength: bytes.length,
    mediaType: 'image/png' as const, width: 256, height: 256, kind: 'environment' as const,
    theme: 'lab', purpose: 'appearance', tags: ['wood'], model: 'test', lifecycle: 'pending' as const,
    visibility: 'private' as const, createdAt: 100, updatedAt: 100, metadataTrust: 'untrusted' as const }
  return { ...descriptor, ownerKey: 'owner-private', schoolId: 'school-one', operationId: 'op', index: visualMaterialIndex(descriptor),
    blobDurable: false, publicationPending: true, retentionCharged: true }
}
const finalPath = (home: string, row: VisualMaterialRecord): string => path.join(home, 'visual-materials', 'owners', visualMaterialDigest(Buffer.from(row.ownerKey)), row.sha256.slice(0, 2), `${row.sha256}.png`)
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

it('checks PNG CRC/chunk order/complete decoded rows/filter bytes rather than trusting image declarations', () => {
  expect(validateVisualMaterialPng(bytes)).toEqual({ width: 256, height: 256 })
  const crcBad = Buffer.from(bytes); crcBad[29] = crcBad[29]! ^ 1
  expect(() => validateVisualMaterialPng(crcBad)).toThrow('decodable PNG')
  const filters = Buffer.alloc(256 * 1025); filters[0] = 5
  expect(() => validateVisualMaterialPng(pngOf(filters))).toThrow()
  expect(() => validateVisualMaterialPng(pngOf(Buffer.alloc(256 * 1025 - 1)))).toThrow()
  expect(() => validateVisualMaterialPng(pngOf(Buffer.alloc(256 * 1025 + 1)))).toThrow()
  expect(() => validateVisualMaterialPng(Buffer.concat([bytes, Buffer.from('trailing')]))).toThrow()
  expect(() => validateVisualMaterialPng(pngOf(undefined, Buffer.concat([deflateSync(Buffer.alloc(256 * 1025)), Buffer.from('trailing zlib')])))).toThrow()
  const oversize = Buffer.concat([bytes.subarray(0, 8), chunk('IHDR', header(4096, 4096)), bytes.subarray(33)])
  expect(() => validateVisualMaterialPng(oversize)).toThrow()
  const apng = Buffer.concat([bytes.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), bytes.subarray(33)])
  expect(() => validateVisualMaterialPng(apng)).toThrow()
})

it('durably publishes original bytes owner-privately, deduplicates same-owner digest, and refuses digest/size mismatches', async () => {
  const home = await homeOf(), blobs = new FileVisualMaterialBlobStore({ dshHome: home }), row = recordOf()
  await blobs.initialize()
  await blobs.publish(row, bytes, bytes.length, () => {})
  const file = finalPath(home, row), info = await lstat(file)
  expect(info.nlink).toBe(1)
  expect(info.mode & 0o777).toBe(0o400)
  expect(await blobs.read(row, () => {})).toEqual(bytes)
  await blobs.publish(recordOf('b'), bytes, bytes.length, () => {})
  expect((await lstat(file)).ino).toBe(info.ino)
  await expect(blobs.publish({ ...row, sha256: 'b'.repeat(64) }, bytes, bytes.length, () => {})).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' })
  await expect(blobs.read({ ...row, byteLength: row.byteLength - 1 }, () => {})).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
  await expect(blobs.read({ ...row, id: '../secret' }, () => {})).rejects.toMatchObject({ code: 'INPUT_INVALID' })
})

it('never trusts symlink files, hardlinks, public modes or symlink owner directories', async () => {
  const home = await homeOf(), blobs = new FileVisualMaterialBlobStore({ dshHome: home }), row = recordOf()
  await blobs.initialize(); await blobs.publish(row, bytes, bytes.length, () => {})
  const file = finalPath(home, row), external = path.join(home, 'external.png')
  await writeFile(external, bytes, { mode: 0o600 }); await unlink(file); await symlink(external, file)
  await expect(blobs.read(row, () => {})).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
  await unlink(file); await link(external, file)
  await expect(blobs.read(row, () => {})).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
  await unlink(file); await writeFile(file, bytes, { mode: 0o644 })
  await expect(blobs.read(row, () => {})).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
  const ownerDir = path.dirname(path.dirname(file)), outside = path.join(home, 'outside-owner')
  await rm(ownerDir, { recursive: true }); await mkdir(outside, { mode: 0o700 }); await symlink(outside, ownerDir)
  await expect(blobs.publish(row, bytes, bytes.length, () => {})).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
})

it('validates every physical DSH_HOME component and refuses unsafe private directory permissions', async () => {
  const home = await homeOf(), linked = path.join(home, 'home-link')
  await symlink(home, linked)
  await expect(new FileVisualMaterialBlobStore({ dshHome: linked }).initialize()).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
  expect(() => new FileVisualMaterialBlobStore({ dshHome: '../not-home' })).toThrow()
  expect(() => new FileVisualMaterialBlobStore({ dshHome: home + '/../other' })).toThrow()
  await mkdir(path.join(home, 'visual-materials'), { mode: 0o755 })
  await expect(new FileVisualMaterialBlobStore({ dshHome: home }).initialize()).rejects.toMatchObject({ code: 'BLOB_PATH_UNSAFE' })
})

it('detects same-size disk corruption by SHA and decoded dimensions on every read', async () => {
  const home = await homeOf(), blobs = new FileVisualMaterialBlobStore({ dshHome: home }), row = recordOf()
  await blobs.initialize(); await blobs.publish(row, bytes, bytes.length, () => {})
  const file = finalPath(home, row), corrupted = Buffer.from(bytes); corrupted[40] = corrupted[40]! ^ 1
  await chmod(file, 0o600); await writeFile(file, corrupted)
  await expect(blobs.read(row, () => {})).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' })
  await writeFile(file, bytes)
  await expect(blobs.read({ ...row, width: 512 }, () => {})).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' })
})

it('recovers a complete fsynced staging file and reports a genuinely absent original without deleting metadata', async () => {
  const home = await homeOf(), blobs = new FileVisualMaterialBlobStore({ dshHome: home }), row = recordOf()
  await blobs.initialize()
  expect(await blobs.recover(row, bytes.length, () => {})).toBe('missing')
  const stage = path.join(home, 'visual-materials', '_stages', `${row.id}.part`)
  await writeFile(stage, bytes, { mode: 0o600 })
  expect(await blobs.recover(row, bytes.length, () => {})).toBe('durable')
  expect(await readFile(finalPath(home, row))).toEqual(bytes)
  await expect(lstat(stage)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await blobs.recover(row, 0, () => {})).toBe('durable')
})

it('keeps the 256MiB disk reserve PLUS actual outstanding stage budget before allocating a stage', async () => {
  const home = await homeOf(), space = await statfs(home, { bigint: true }), available = Number(space.bavail * space.bsize)
  // Far above total free space so unrelated host frees/allocations cannot flip the assertion.
  const budget = available + VISUAL_MATERIAL_DISK_RESERVE + 1024 * 1024 * 1024
  expect(budget).toBeGreaterThan(6 * 1024 * 1024)
  const blobs = new FileVisualMaterialBlobStore({ dshHome: home, limits: { maxStageBytes: budget } }), row = recordOf()
  await blobs.initialize()
  await expect(blobs.publish(row, bytes, budget, () => {})).rejects.toMatchObject({ code: 'DISK_RESERVE' })
  await expect(lstat(path.join(home, 'visual-materials', '_stages', `${row.id}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
})
