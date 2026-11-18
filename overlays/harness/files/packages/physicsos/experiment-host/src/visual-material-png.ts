/** Same bounded 8-bit/non-interlaced PNG subset as QuestionCodeAssets, without importing its generator. */
import { crc32, inflateSync } from 'node:zlib'
import {
  VisualMaterialError, VISUAL_MATERIAL_HARD_IMAGE_BYTES, VISUAL_MATERIAL_MAX_DIMENSION,
  VISUAL_MATERIAL_MAX_PIXELS,
} from './visual-material-contracts.ts'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const invalid = (): never => { throw new VisualMaterialError(422, 'IMAGE_INVALID', 'Image is not a bounded, decodable PNG.') }

/** CRC, chunk order, complete zlib payload, decoded row lengths and filters, not an IHDR-only sniff. */
export function validateVisualMaterialPng(bytes: Buffer): { readonly width: number; readonly height: number } {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > VISUAL_MATERIAL_HARD_IMAGE_BYTES
    || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return invalid()
  let width = 0, height = 0, color = 0, ended = false, afterData = false, palette = false, chunks = 0
  const compressed: Buffer[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    if (++chunks > 4096) return invalid()
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length || length > VISUAL_MATERIAL_HARD_IMAGE_BYTES) return invalid()
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    if (![...typeBytes].every(byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122)
      || (typeBytes[2]! & 32) !== 0) return invalid()
    const type = typeBytes.toString('ascii'), data = bytes.subarray(offset + 8, offset + 8 + length)
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return invalid()
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) return invalid()
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); color = data[9] ?? 255
      if (width < 64 || height < 64 || width > VISUAL_MATERIAL_MAX_DIMENSION || height > VISUAL_MATERIAL_MAX_DIMENSION
        || width * height > VISUAL_MATERIAL_MAX_PIXELS || data[8] !== 8 || ![0, 2, 4, 6].includes(color)
        || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return invalid()
    } else if (type === 'IDAT') {
      if (!width || afterData) return invalid()
      compressed.push(data)
    } else if (type === 'IEND') {
      ended = length === 0 && end === bytes.length
      break
    } else if (type === 'PLTE') {
      if (!width || palette || compressed.length || [0, 4].includes(color) || length === 0 || length > 768 || length % 3) return invalid()
      palette = true
    } else {
      if (!width || (typeBytes[0]! & 32) === 0 || ['acTL', 'fcTL', 'fdAT'].includes(type)) return invalid()
      if (type === 'tRNS' && (compressed.length || ![0, 2].includes(color) || length !== (color === 0 ? 2 : 6))) return invalid()
      if (compressed.length) afterData = true
    }
    offset = end
  }
  if (!ended || !width || !compressed.length) return invalid()
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1
  const stride = width * channels + 1, expected = height * stride
  try {
    const input = Buffer.concat(compressed)
    // Node's info:true result is not modeled by all installed @types/node versions.
    const decoded = inflateSync(input, { maxOutputLength: expected, info: true }) as unknown as {
      readonly buffer: Buffer; readonly engine: { readonly bytesWritten: number }
    }
    // Do not accept a second zlib member or trailing compressed garbage.
    if (decoded.engine.bytesWritten !== input.length || decoded.buffer.length !== expected) return invalid()
    for (let row = 0; row < height; row++) if ((decoded.buffer[row * stride] ?? 255) > 4) return invalid()
  } catch { return invalid() }
  return { width, height }
}
