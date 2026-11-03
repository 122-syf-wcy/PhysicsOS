/** Untrusted ZIP parsing only. Nothing in this module installs or runs a package. */
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { crc32 } from 'node:zlib'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import { ExperimentError } from './identity.ts'
import { manifestV2Schema, schemaContractIssues, validatePackageMetadata } from './contract-v2.ts'
import { evaluateCase } from './contract-optics.ts'
import {
  ZIP_LIMIT,
  safeArchivePath,
  allowedFile,
  validatePackageResources,
  EXPANDED_LIMIT,
  FILE_LIMIT,
  FILE_COUNT_LIMIT,
} from './package-resources.ts'
export {
  ZIP_LIMIT,
  assetContentType,
  safeArchivePath,
  inlineImportMapHashes,
  EXPANDED_LIMIT,
  FILE_LIMIT,
  FILE_COUNT_LIMIT,
} from './package-resources.ts'

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    packageType: z.literal('browser-static'),
    experimentId: z.literal('convex-lens'),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(32),
    entry: z.literal('dist/index.html'),
    renderer: z.literal('three'),
    theme: z.literal('physicsos-warm-lab-v1'),
    engine: z.object({ id: z.literal('optics'), contractVersion: z.literal(1) }).strict(),
    parameters: z.literal('parameters.json'),
    teaching: z.literal('teaching.json'),
    referenceCases: z.literal('cases.json'),
    assetLicenses: z.literal('ASSET-LICENSES.json'),
    cover: z.string().startsWith('dist/'),
    license: z.string().min(1).max(80),
  })
  .strict()
export type Manifest = z.infer<typeof manifestSchema> | z.infer<typeof manifestV2Schema>
export interface ValidatedArchive {
  manifest: Manifest
  assets: Map<string, Buffer>
  fileCount: number
}
const invalid = (): ExperimentError =>
  new ExperimentError(400, 'INVALID_ARCHIVE', 'ZIP 格式、文件、资源或实验协议不符合要求')
function open(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: false, validateEntrySizes: true },
      (error: Error | null, zip: ZipFile | undefined) => {
        if (error || !zip) reject(invalid())
        else resolve(zip)
      },
    )
  })
}
/** This size-limited contract needs ordinary single-disk ZIP, never ZIP64. */
function centralBoundary(bytes: Buffer): { start: number; end: number } {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (
      bytes.readUInt32LE(offset) !== 0x06054b50 ||
      offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length
    )
      continue
    const count = bytes.readUInt16LE(offset + 10),
      size = bytes.readUInt32LE(offset + 12),
      start = bytes.readUInt32LE(offset + 16)
    if (
      bytes.readUInt16LE(offset + 4) !== 0 ||
      bytes.readUInt16LE(offset + 6) !== 0 ||
      bytes.readUInt16LE(offset + 8) !== count ||
      count === 0xffff ||
      start === 0xffffffff ||
      size === 0xffffffff ||
      start + size !== offset
    )
      throw invalid()
    return { start, end: offset }
  }
  throw invalid()
}
/** Fully verify sizes, CRC, names and metadata before accepting any asset. */
export async function validateArchive(
  bytes: Buffer,
  options: { allowLegacy?: boolean } = {},
): Promise<ValidatedArchive> {
  if (bytes.length > ZIP_LIMIT)
    throw new ExperimentError(413, 'ZIP_TOO_LARGE', 'ZIP 不能超过 20 MiB')
  if (bytes.length < 22) throw invalid()
  const central = centralBoundary(bytes),
    boundary = central.start
  const zip = await open(bytes)
  try {
    if (zip.entryCount > FILE_COUNT_LIMIT) throw invalid()
    const files = new Map<string, Buffer>(),
      names = new Set<string>(),
      ranges: [number, number][] = []
    let total = 0,
      fileCount = 0,
      centralCursor = boundary
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject)
      zip.once('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const rawName: unknown = entry.fileName
          if (!Buffer.isBuffer(rawName)) throw invalid()
          if (centralCursor + 46 > central.end || bytes.readUInt32LE(centralCursor) !== 0x02014b50)
            throw invalid()
          const nameLength = bytes.readUInt16LE(centralCursor + 28)
          const nextCentral =
            centralCursor +
            46 +
            nameLength +
            bytes.readUInt16LE(centralCursor + 30) +
            bytes.readUInt16LE(centralCursor + 32)
          if (
            nextCentral > central.end ||
            !bytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength).equals(rawName)
          )
            throw invalid()
          centralCursor = nextCentral
          const name = rawName.toString('utf8'),
            directory = name.endsWith('/')
          if (
            !Buffer.from(name, 'utf8').equals(rawName) ||
            !safeArchivePath(directory ? name.slice(0, -1) : name)
          )
            throw invalid()
          if (names.has(name) || names.has(directory ? name.slice(0, -1) : `${name}/`))
            throw invalid()
          names.add(name)
          const type = (entry.externalFileAttributes >>> 16) & 0o170000
          if (type !== 0 && type !== (directory ? 0o040000 : 0o100000)) throw invalid()
          if (
            (entry.generalPurposeBitFlag & ~(0x800 | 8 | 2 | 4)) !== 0 ||
            ![0, 8].includes(entry.compressionMethod)
          )
            throw invalid()
          const offset = entry.relativeOffsetOfLocalHeader
          if (offset < 0 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
            throw invalid()
          const localNameLength = bytes.readUInt16LE(offset + 26),
            extraLength = bytes.readUInt16LE(offset + 28)
          const start = offset + 30 + localNameLength + extraLength,
            end = start + entry.compressedSize
          if (
            end > boundary ||
            !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(rawName) ||
            bytes.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag ||
            bytes.readUInt16LE(offset + 8) !== entry.compressionMethod
          )
            throw invalid()
          if (
            !(entry.generalPurposeBitFlag & 8) &&
            (bytes.readUInt32LE(offset + 14) !== entry.crc32 ||
              bytes.readUInt32LE(offset + 18) !== entry.compressedSize ||
              bytes.readUInt32LE(offset + 22) !== entry.uncompressedSize)
          )
            throw invalid()
          let rangeEnd = end
          if (entry.generalPurposeBitFlag & 8) {
            if (end + 12 > boundary) throw invalid()
            const descriptorStart = bytes.readUInt32LE(end) === 0x08074b50 ? end + 4 : end
            rangeEnd = descriptorStart + 12
            if (
              rangeEnd > boundary ||
              bytes.readUInt32LE(descriptorStart) !== entry.crc32 ||
              bytes.readUInt32LE(descriptorStart + 4) !== entry.compressedSize ||
              bytes.readUInt32LE(descriptorStart + 8) !== entry.uncompressedSize
            )
              throw invalid()
          }
          if (ranges.some(([from, to]) => offset < to && rangeEnd > from)) throw invalid()
          ranges.push([offset, rangeEnd])
          if (directory) {
            if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) throw invalid()
            zip.readEntry()
            return
          }
          if (
            !allowedFile(name) ||
            ++fileCount > FILE_COUNT_LIMIT ||
            entry.uncompressedSize > FILE_LIMIT
          )
            throw invalid()
          total += entry.uncompressedSize
          if (total > EXPANDED_LIMIT) throw invalid()
          const stream = await new Promise<Readable>((resolveStream, rejectStream) => {
            zip.openReadStream(
              entry,
              (error: Error | null, stream: Readable | null | undefined) => {
                if (error || !stream) {
                  rejectStream(invalid())
                  return
                }
                resolveStream(stream)
              },
            )
          })
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of stream) {
            const buffer = chunk as Buffer
            size += buffer.length
            if (size > FILE_LIMIT || size > entry.uncompressedSize) {
              stream.destroy()
              throw invalid()
            }
            chunks.push(buffer)
          }
          const data = Buffer.concat(chunks)
          if (size !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw invalid()
          files.set(name, data)
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
    if (centralCursor !== central.end) throw invalid()
    let value: unknown
    try {
      const metadata = files.get('experiment.json')
      if (metadata === undefined || metadata.length > 256 * 1024) throw new Error('manifest size')
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata))
    } catch {
      throw new ExperimentError(
        400,
        'INVALID_MANIFEST',
        'experiment.json 缺失、过大或不是有效 UTF-8 JSON',
        [
          {
            code: 'INVALID_MANIFEST',
            file: 'experiment.json',
            path: '$',
            message: '文件缺失、过大或 JSON 无效。',
            suggestion: '恢复 V2 模板的 experiment.json。',
          },
        ],
      )
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ExperimentError(400, 'INVALID_MANIFEST', '实验清单不符合 V2 契约')
    const header = value as Record<string, unknown>
    if (header.experimentId !== 'convex-lens')
      throw new ExperimentError(400, 'UNSUPPORTED_EXPERIMENT', '只支持已注册的 convex-lens 实验')
    if (
      (header.schemaVersion === 1 || header.schemaVersion === 2) &&
      header.protocolVersion !== header.schemaVersion
    )
      throw new ExperimentError(400, 'INCOMPATIBLE_PROTOCOL', '清单版本与运行协议版本必须一致')
    if (header.schemaVersion === 1 && !options.allowLegacy)
      throw new ExperimentError(
        400,
        'PACKAGE_UPGRADE_REQUIRED',
        '新投稿须升级为 V2，请使用最新模板重新发布',
      )
    const parsed =
      header.schemaVersion === 1 && options.allowLegacy
        ? manifestSchema.safeParse(value)
        : manifestV2Schema.safeParse(value)
    if (!parsed.success)
      throw new ExperimentError(
        400,
        'INVALID_MANIFEST',
        '实验清单不符合受支持的契约',
        schemaContractIssues('experiment.json', parsed.error, 'INVALID_MANIFEST'),
      )
    if (parsed.data.schemaVersion === 2) {
      const issues = validatePackageMetadata(files, evaluateCase)
      if (issues.length)
        throw new ExperimentError(400, 'INVALID_METADATA', '实验元数据不符合 V2 契约', issues)
    }
    const assets = await validatePackageResources(files, parsed.data)
    return { manifest: parsed.data, assets, fileCount }
  } catch (error) {
    if (error instanceof ExperimentError) throw error
    throw invalid()
  } finally {
    zip.close()
  }
}
