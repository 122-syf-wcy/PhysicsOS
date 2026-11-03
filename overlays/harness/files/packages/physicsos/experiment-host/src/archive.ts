/** Untrusted ZIP parsing only. Nothing in this module installs or runs a package. */
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { crc32 } from 'node:zlib'
import { createHash } from 'node:crypto'
import { init, parse } from 'es-module-lexer'
import { posix } from 'node:path'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import { ExperimentError } from './identity.ts'

export const ZIP_LIMIT = 20 * 1024 * 1024
export const EXPANDED_LIMIT = 40 * 1024 * 1024
export const FILE_LIMIT = 20 * 1024 * 1024
export const FILE_COUNT_LIMIT = 1000
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), protocolVersion: z.literal(1), packageType: z.literal('browser-static'),
  experimentId: z.literal('convex-lens'), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/).max(32),
  entry: z.literal('dist/index.html'), renderer: z.literal('three'), theme: z.literal('physicsos-warm-lab-v1'),
  engine: z.object({ id: z.literal('optics'), contractVersion: z.literal(1) }).strict(),
  parameters: z.literal('parameters.json'), teaching: z.literal('teaching.json'), referenceCases: z.literal('cases.json'),
  assetLicenses: z.literal('ASSET-LICENSES.json'), cover: z.string().startsWith('dist/'), license: z.string().min(1).max(80),
}).strict()
export type Manifest = z.infer<typeof manifestSchema>
export interface ValidatedArchive { manifest: Manifest; assets: Map<string, Buffer>; fileCount: number }
const invalid = (): ExperimentError => new ExperimentError(400, 'INVALID_ARCHIVE', 'ZIP 格式、文件、资源或实验协议不符合要求')
const roots = new Set(['experiment.json', 'parameters.json', 'teaching.json', 'cases.json', 'ASSET-LICENSES.json', 'README.md', 'MODEL.md', 'LICENSE'])
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
}
export const assetContentType = (name: string): string | undefined => mimeTypes[posix.extname(name).toLowerCase()]
export function safeArchivePath(name: string): boolean {
  return name.length > 0 && name.length <= 240 && /^[a-zA-Z0-9_./-]+$/.test(name)
    && !name.startsWith('/') && name.split('/').every(part => part !== '' && !part.startsWith('.'))
}
function allowedFile(name: string): boolean {
  return roots.has(name) || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(name)
    || (/^(?:src|public|tools|tests)\//.test(name) && /\.(?:ts|tsx|js|mjs|html|css|json|png|webp|jpe?g|svg|glb|gltf|bin|ktx2|woff2?|md|txt)$/i.test(name))
    || (name.startsWith('dist/') && assetContentType(name) !== undefined)
}
function checkReference(owner: string, ref: string, assets: Map<string, Buffer>): void {
  if (ref.startsWith('#')) return
  // Relative, same-package resources only. URLs and encoded separators are refused.
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(ref) || /[\\%\u0000]/.test(ref)) throw invalid()
  const clean = ref.split(/[?#]/, 1)[0]
  if (!clean) throw invalid()
  const resolved = posix.normalize(posix.join(posix.dirname(owner), clean))
  if (!resolved.startsWith('dist/') || !assets.has(resolved)) throw invalid()
}
const scriptAttribute = (attributes: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
  return match ? match[1] ?? match[2] ?? match[3] : undefined
}
function importMaps(bytes: Buffer): { contents: string; imports: Record<string, string> }[] {
  const maps: { contents: string; imports: Record<string, string> }[] = []
  for (const match of bytes.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? '', contents = match[2] ?? ''
    if (scriptAttribute(attributes, 'type')?.toLowerCase() !== 'importmap') continue
    if (scriptAttribute(attributes, 'src')) throw invalid()
    let value: unknown
    try { value = JSON.parse(contents) } catch { throw invalid() }
    const parsed = z.object({ imports: z.record(z.string().min(1), z.string().min(1)) }).strict().safeParse(value)
    if (!parsed.success || Object.keys(parsed.data.imports).length > FILE_COUNT_LIMIT) throw invalid()
    maps.push({ contents, imports: parsed.data.imports })
  }
  return maps
}
/** Exact, frozen JSON importmaps may execute inline; arbitrary inline code never may. */
export function inlineImportMapHashes(bytes: Buffer): string[] {
  return importMaps(bytes).map(map => `'sha256-${createHash('sha256').update(map.contents).digest('base64')}'`)
}
async function validateReferences(assets: Map<string, Buffer>): Promise<void> {
  await init
  const imported = new Map<string, string>()
  for (const map of importMaps(assets.get('dist/index.html') ?? Buffer.alloc(0))) {
    for (const [specifier, target] of Object.entries(map.imports)) {
      if (specifier.endsWith('/') || imported.has(specifier)) throw invalid()
      checkReference('dist/index.html', target, assets)
      imported.set(specifier, posix.normalize(posix.join('dist', target)))
    }
  }

  for (const [name, data] of assets) {
    const ext = posix.extname(name).toLowerCase(), text = data.toString('utf8')
    const references: string[] = []
    if (ext === '.html') {
      for (const map of importMaps(data)) {
        for (const target of Object.values(map.imports)) checkReference(name, target, assets)
      }
    }
    if (ext === '.html' || ext === '.svg') {
      for (const match of text.matchAll(/\b(?:src|href|xlink:href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) references.push(match[1] ?? match[2] ?? match[3] ?? '')
      // An alternate base or frame would undermine the package-relative graph.
      if (/<\s*(?:base|iframe|frame|object|embed)\b/i.test(text)) throw invalid()
      for (const match of text.matchAll(/\bsrcset\s*=\s*["']([^"']*)["']/gi)) {
        for (const source of (match[1] ?? '').split(',')) references.push(source.trim().split(/\s+/)[0] ?? '')
      }
    }
    if (['.html', '.svg', '.css'].includes(ext)) {
      for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) references.push(match[1] ?? match[2] ?? match[3] ?? '')
      for (const match of text.matchAll(/@import\s+["']([^"']+)["']/gi)) references.push(match[1] ?? '')
    }
    if (ext === '.js' || ext === '.mjs') {
      const [imports] = parse(text)
      for (const entry of imports) if (entry.n !== undefined) references.push(entry.n)
      for (const match of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g)) references.push(match[1] ?? '')
    }
    if (ext === '.gltf') {
      let gltf: unknown
      try { gltf = JSON.parse(text) } catch { throw invalid() }
      const walk = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'uri' && typeof child === 'string') references.push(child)
          else walk(child)
        }
      }
      walk(gltf)
    }
    for (const ref of references) {
      const mapped = imported.get(ref)
      if (mapped && (ext === '.js' || ext === '.mjs')) { if (!assets.has(mapped)) throw invalid() }
      else checkReference(name, ref, assets)
    }
  }
}
function open(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) reject(invalid()); else resolve(zip)
  }))
}
/** This size-limited contract needs ordinary single-disk ZIP, never ZIP64. */
function centralBoundary(bytes: Buffer): { start: number; end: number } {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50 || offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) continue
    const count = bytes.readUInt16LE(offset + 10), size = bytes.readUInt32LE(offset + 12), start = bytes.readUInt32LE(offset + 16)
    if (bytes.readUInt16LE(offset + 4) !== 0 || bytes.readUInt16LE(offset + 6) !== 0 || bytes.readUInt16LE(offset + 8) !== count
      || count === 0xffff || start === 0xffffffff || size === 0xffffffff || start + size !== offset) throw invalid()
    return { start, end: offset }
  }
  throw invalid()
}
/** Fully verify sizes, CRC, names and metadata before accepting any asset. */
export async function validateArchive(bytes: Buffer): Promise<ValidatedArchive> {
  if (bytes.length > ZIP_LIMIT) throw new ExperimentError(413, 'ZIP_TOO_LARGE', 'ZIP 不能超过 20 MiB')
  if (bytes.length < 22) throw invalid()
  const central = centralBoundary(bytes), boundary = central.start
  const zip = await open(bytes)
  try {
    if (zip.entryCount > FILE_COUNT_LIMIT) throw invalid()
    const files = new Map<string, Buffer>(), names = new Set<string>(), ranges: [number, number][] = []
    let total = 0, fileCount = 0, centralCursor = boundary
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject); zip.once('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const rawName = entry.fileName as unknown as Buffer
          if (centralCursor + 46 > central.end || bytes.readUInt32LE(centralCursor) !== 0x02014b50) throw invalid()
          const nameLength = bytes.readUInt16LE(centralCursor + 28)
          const nextCentral = centralCursor + 46 + nameLength + bytes.readUInt16LE(centralCursor + 30) + bytes.readUInt16LE(centralCursor + 32)
          if (nextCentral > central.end || !bytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength).equals(rawName)) throw invalid()
          centralCursor = nextCentral
          const name = rawName.toString('utf8'), directory = name.endsWith('/')
          if (!Buffer.from(name, 'utf8').equals(rawName) || !safeArchivePath(directory ? name.slice(0, -1) : name)) throw invalid()
          if (names.has(name) || names.has(directory ? name.slice(0, -1) : `${name}/`)) throw invalid()
          names.add(name)
          const type = (entry.externalFileAttributes >>> 16) & 0o170000
          if (type !== 0 && type !== (directory ? 0o040000 : 0o100000)) throw invalid()
          if ((entry.generalPurposeBitFlag & ~(0x800 | 8 | 2 | 4)) !== 0 || ![0, 8].includes(entry.compressionMethod)) throw invalid()
          const offset = entry.relativeOffsetOfLocalHeader
          if (offset < 0 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw invalid()
          const localNameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28)
          const start = offset + 30 + localNameLength + extraLength, end = start + entry.compressedSize
          if (end > boundary || !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(rawName)
            || bytes.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag || bytes.readUInt16LE(offset + 8) !== entry.compressionMethod) throw invalid()
          if (!(entry.generalPurposeBitFlag & 8) && (bytes.readUInt32LE(offset + 14) !== entry.crc32 || bytes.readUInt32LE(offset + 18) !== entry.compressedSize || bytes.readUInt32LE(offset + 22) !== entry.uncompressedSize)) throw invalid()
          let rangeEnd = end
          if (entry.generalPurposeBitFlag & 8) {
            if (end + 12 > boundary) throw invalid()
            const descriptorStart = bytes.readUInt32LE(end) === 0x08074b50 ? end + 4 : end
            rangeEnd = descriptorStart + 12
            if (rangeEnd > boundary || bytes.readUInt32LE(descriptorStart) !== entry.crc32
              || bytes.readUInt32LE(descriptorStart + 4) !== entry.compressedSize || bytes.readUInt32LE(descriptorStart + 8) !== entry.uncompressedSize) throw invalid()
          }
          if (ranges.some(([from, to]) => offset < to && rangeEnd > from)) throw invalid()
          ranges.push([offset, rangeEnd])
          if (directory) { if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) throw invalid(); zip.readEntry(); return }
          if (!allowedFile(name) || ++fileCount > FILE_COUNT_LIMIT || entry.uncompressedSize > FILE_LIMIT) throw invalid()
          total += entry.uncompressedSize
          if (total > EXPANDED_LIMIT) throw invalid()
          const stream = await new Promise<Readable>((resolveStream, rejectStream) => zip.openReadStream(entry, (error, stream) => error || !stream ? rejectStream(invalid()) : resolveStream(stream)))
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of stream) {
            const buffer = chunk as Buffer; size += buffer.length
            if (size > FILE_LIMIT || size > entry.uncompressedSize) { stream.destroy(); throw invalid() }
            chunks.push(buffer)
          }
          const data = Buffer.concat(chunks)
          if (size !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw invalid()
          files.set(name, data); zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
    if (centralCursor !== central.end) throw invalid()
    for (const name of roots) if (!files.has(name)) throw invalid()
    let value: unknown
    try { value = JSON.parse(files.get('experiment.json')!.toString('utf8')) } catch { throw invalid() }
    const parsed = manifestSchema.safeParse(value)
    if (!parsed.success) throw invalid()
    const assets = new Map([...files].filter(([name]) => name.startsWith('dist/')))
    if (!assets.has(parsed.data.entry) || !safeArchivePath(parsed.data.cover) || !assets.has(parsed.data.cover)) throw invalid()
    await validateReferences(assets)
    return { manifest: parsed.data, assets, fileCount }
  } catch {
    throw invalid()
  } finally { zip.close() }
}
