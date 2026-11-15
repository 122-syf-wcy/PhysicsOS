/** Native raster boundary for controlled paper diagrams, not arbitrary SVG. */
import { createHash } from 'node:crypto'
import { parsePaperDiagram, renderPaperDiagramSvg, type PaperDiagramSpec, type SourceFigureAsset } from '@physicsos/question-paper'

export const DIAGRAM_RASTERIZER_VERSION = 'sharp-paper-png-v1'
export const FIGURE_LIMITS = { bytes: 12 * 1024 * 1024, pixels: 8_000_000, dimension: 4000 } as const
const sharpModule = () => import('sharp').then((module) => module.default)

/** Metadata alone is not validation: decode the complete raster payload. */
export async function validateFigurePng(data: Uint8Array): Promise<{ width: number; height: number }> {
  if (data.byteLength === 0 || data.byteLength > FIGURE_LIMITS.bytes) throw new Error('题图 PNG 为空或超过字节限制')
  const sharp = await sharpModule()
  const image = sharp(Buffer.from(data), { failOn: 'warning', limitInputPixels: FIGURE_LIMITS.pixels, limitInputChannels: 4, sequentialRead: true })
  try {
    const meta = await image.metadata()
    if (meta.format !== 'png' || meta.width === undefined || meta.height === undefined || (meta.pages ?? 1) !== 1
      || meta.width < 16 || meta.height < 16 || meta.width > FIGURE_LIMITS.dimension || meta.height > FIGURE_LIMITS.dimension
      || meta.width * meta.height > FIGURE_LIMITS.pixels) throw new Error('题图必须为限额内的单页有效 PNG')
    const decoded = await image.raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== meta.width || decoded.info.height !== meta.height || decoded.data.length === 0) throw new Error('题图 PNG 像素无法完整解码')
    /* A blank white/transparent bitmap is another placeholder, not a diagram. */
    const channels = decoded.info.channels
    let ink = 0
    for (let offset = 0; offset < decoded.data.length; offset += channels) {
      const alpha = channels === 2 || channels === 4 ? decoded.data[offset + channels - 1]! : 255
      const red = decoded.data[offset]!
      const green = channels <= 2 ? red : decoded.data[offset + 1]!
      const blue = channels <= 2 ? red : decoded.data[offset + 2]!
      if (alpha > 32 && Math.min(red, green, blue) < 240) { ink++; if (ink >= 16) break }
    }
    if (ink < 16) throw new Error('题图 PNG 没有可见图形，拒绝空白占位')
    return { width: meta.width, height: meta.height }
  } finally {
    image.destroy()
  }
}

/**
 * SVG is freshly rendered from the validated spec; no caller may submit SVG
 * markup, network resources, a model path or a computed instrument reading.
 */
export async function rasterizePaperDiagram(input: PaperDiagramSpec): Promise<Uint8Array> {
  const spec = parsePaperDiagram(input)
  const svg = renderPaperDiagramSvg(spec, 'student')
  if (Buffer.byteLength(svg) > 1024 * 1024) throw new Error('受控题图 SVG 超过限额')
  const sharp = await sharpModule()
  const image = sharp(Buffer.from(svg, 'utf8'), { density: 144, failOn: 'warning', limitInputPixels: FIGURE_LIMITS.pixels, limitInputChannels: 4 })
  try {
    const png = await image.flatten({ background: '#ffffff' }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
    await validateFigurePng(png)
    return new Uint8Array(png)
  } finally {
    image.destroy()
  }
}

/** Owned raster attachments preserve their real byte digest before conversion. */
export async function normalizeSourceFigure(data: Uint8Array, source: SourceFigureAsset): Promise<Uint8Array> {
  if (data.byteLength === 0 || data.byteLength > FIGURE_LIMITS.bytes) throw new Error('来源题图为空或超过字节限制')
  if (createHash('sha256').update(data).digest('hex') !== source.sha256) throw new Error('来源题图 SHA-256 与已授权附件不符')
  const sharp = await sharpModule()
  const image = sharp(Buffer.from(data), { failOn: 'warning', limitInputPixels: FIGURE_LIMITS.pixels, limitInputChannels: 4 })
  try {
    const meta = await image.metadata()
    const expected = source.mediaType.slice('image/'.length)
    if (meta.format !== expected || (meta.pages ?? 1) !== 1 || meta.width === undefined || meta.height === undefined
      || meta.width > FIGURE_LIMITS.dimension || meta.height > FIGURE_LIMITS.dimension) throw new Error('来源题图格式或尺寸与附件声明不符')
    const png = await image.flatten({ background: '#ffffff' }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
    await validateFigurePng(png)
    return new Uint8Array(png)
  } finally {
    image.destroy()
  }
}
