/** Validate actual DOCX/PDF bytes before a four-file bundle is published. */
import { lstat, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { A4_PAGE_POINTS, A4_PAGE_TWIPS } from '@physicsos/question-paper'
import { runPrintProcess } from './print-process.ts'

export const EXPORT_VALIDATOR_VERSION = 'paper-four-files-validation-v1'
export const EXPORT_LIMITS = { fileBytes: 48 * 1024 * 1024, xmlBytes: 16 * 1024 * 1024, zipEntries: 2048, pages: 120, operatorsPerPage: 200_000, imagePixels: 8_000_000, timeoutMs: 120_000 } as const
export interface PdfPageValidation { readonly number: number; readonly width: number; readonly height: number; readonly textCharacters: number }
export interface PdfValidation { readonly pageCount: number; readonly pages: readonly PdfPageValidation[] }
export interface PdfInspection extends PdfValidation { readonly text: string }

/** Limits are checked before reading a tool's generated file into memory. */
export async function readExportFile(path: string, max = EXPORT_LIMITS.fileBytes): Promise<Buffer> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > max) throw new Error('导出文件不存在、为空、是链接或超过字节限制')
  const bytes = await readFile(path)
  if (bytes.length !== info.size) throw new Error('导出文件在验证期间发生变更')
  return bytes
}

/**
 * `unzip -t` verifies every CRC, not only the PK header. Read only a bounded
 * set of required XML parts; never extract model-supplied ZIP paths to disk.
 */
export async function inspectDocx(path: string): Promise<{ documentXml: string; stylesXml: string; entries: readonly string[] }> {
  await readExportFile(path)
  const cwd = dirname(path)
  const listing = (await runPrintProcess('unzip', ['-Z1', path], cwd, 30_000, undefined, 1024 * 1024)).stdout.toString('utf8')
  const entries = listing.split(/\r?\n/).filter(Boolean)
  if (entries.length === 0 || entries.length > EXPORT_LIMITS.zipEntries || new Set(entries).size !== entries.length
    || entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..'))) throw new Error('DOCX 包路径或条目数量无效')
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) if (!entries.includes(required)) throw new Error(`DOCX 缺少 ${required}`)
  await runPrintProcess('unzip', ['-tqq', path], cwd, 30_000)
  const xmlPart = async (entry: string): Promise<string> => {
    const content = (await runPrintProcess('unzip', ['-p', path, entry], cwd, 30_000, undefined, EXPORT_LIMITS.xmlBytes)).stdout.toString('utf8')
    if (!content.trim() || /<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('DOCX XML 内容无效')
    return content
  }
  const documentXml = await xmlPart('word/document.xml'); const stylesXml = await xmlPart('word/styles.xml')
  if (!/<w:document\b/.test(documentXml) || !/<w:body\b/.test(documentXml) || !/<w:p\b/.test(documentXml) || !/<w:styles\b/.test(stylesXml)) throw new Error('DOCX 不是有效的 Word 文档')
  const pages = [...documentXml.matchAll(/<w:pgSz\b[^>]*\/>/g)]
  const margins = [...documentXml.matchAll(/<w:pgMar\b[^>]*\/>/g)]
  if (pages.length === 0 || margins.length === 0) throw new Error('DOCX 未声明实际 A4 页幅或页边距')
  const attr = (tag: string, key: string): number => Number(new RegExp(`\\bw:${key}="(\\d+)"`).exec(tag)?.[1])
  if (pages.some(([tag]) => attr(tag, 'w') !== A4_PAGE_TWIPS.width || attr(tag, 'h') !== A4_PAGE_TWIPS.height
    || /w:orient="landscape"/.test(tag))) throw new Error('DOCX 实际页幅不是纵向 A4')
  if (margins.some(([tag]) => ['top', 'right', 'bottom', 'left'].some((side) => !Number.isFinite(attr(tag, side)) || Math.abs(attr(tag, side) - A4_PAGE_TWIPS.margin) > 1))) throw new Error('DOCX 实际页边距不是 18mm')
  if (documentXml.includes('\\vspace')) throw new Error('DOCX 含无效 TeX 作答空间')
  for (const entry of entries.filter((name) => name.endsWith('.rels'))) {
    const rels = await xmlPart(entry)
    if (/TargetMode="External"/.test(rels)) throw new Error('DOCX 不允许未打包的外部资源或链接')
  }
  return { documentXml, stylesXml, entries }
}

/** Pure page check shared by real parsing and failure-path tests. */
export function assertA4PdfPage(width: number, height: number, number: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || Math.abs(width - A4_PAGE_POINTS.width) > A4_PAGE_POINTS.tolerance
    || Math.abs(height - A4_PAGE_POINTS.height) > A4_PAGE_POINTS.tolerance) throw new Error(`PDF 第 ${number} 页不是纵向 A4（${width}×${height} pt）`)
}

/**
 * PDF.js uses its documented Node legacy module/fake worker. Only immutable
 * local pdfjs-dist resource directories are provided; the PDF is a bounded
 * Uint8Array, never a URL. PDF JS/actions/attachments are inspected, not run.
 * This walks every page, its operators and text, with strict parse failures.
 */
export async function inspectPdf(path: string): Promise<PdfInspection> {
  const bytes = await readExportFile(path)
  if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') || !/%%EOF\s*$/.test(bytes.subarray(-2048).toString('latin1'))) throw new Error('PDF 文件头或结束标记不完整')
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: EXPORT_LIMITS.imagePixels,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    canvasMaxAreaInBytes: EXPORT_LIMITS.imagePixels * 4,
    cMapUrl: `${join(packageRoot, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${join(packageRoot, 'standard_fonts')}/`,
    wasmUrl: `${join(packageRoot, 'wasm')}/`,
    iccUrl: `${join(packageRoot, 'iccs')}/`,
    useWasm: false,
    verbosity: 0,
  })
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const walk = async (): Promise<PdfInspection> => {
    const document = await loading.promise
    if (document.numPages < 1 || document.numPages > EXPORT_LIMITS.pages) throw new Error('PDF 页数为空或超过限制')
    const [actions, attachments, fields] = await Promise.all([document.getJSActions(), document.getAttachments(), document.hasJSActions()])
    const hasEntries = (value: unknown): boolean => value instanceof Map ? value.size > 0 : value !== null && typeof value === 'object' && Object.keys(value).length > 0
    if (hasEntries(actions) || hasEntries(attachments) || fields) throw new Error('导出 PDF 不允许脚本或嵌入附件')
    const pages: PdfPageValidation[] = []; const text: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      if (timedOut) throw new Error('PDF 验证超过时限')
      const page = await document.getPage(number)
      try {
        /* Rotation is forced to zero: a rotated Letter page must not be
           accepted merely because its cropped display viewport looks A4. */
        const viewport = page.getViewport({ scale: 1, rotation: 0 })
        assertA4PdfPage(viewport.width, viewport.height, number)
        const media = page.view
        if (media.length !== 4 || !media.every(Number.isFinite)) throw new Error('PDF 页框无效')
        const [operators, content, pageActions] = await Promise.all([
          page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), page.getTextContent(), page.getJSActions(),
        ])
        if (operators.fnArray.length === 0 || operators.fnArray.length > EXPORT_LIMITS.operatorsPerPage) throw new Error(`PDF 第 ${number} 页为空或操作数量超限`)
        if (hasEntries(pageActions)) throw new Error('PDF 页面包含脚本')
        const pageText = content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ')
        if (pageText.trim() === '') throw new Error(`PDF 第 ${number} 页没有可读卷面文字`)
        if (pageText.includes('�')) throw new Error(`PDF 第 ${number} 页包含无法解码的文字`)
        pages.push({ number, width: viewport.width, height: viewport.height, textCharacters: pageText.length })
        text.push(pageText)
      } finally {
        page.cleanup()
      }
    }
    await document.cleanup()
    return { pageCount: pages.length, pages, text: text.join('\n') }
  }
  try {
    return await Promise.race([walk(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { timedOut = true; void loading.destroy().catch(() => undefined); reject(new Error('PDF 验证超过时限')) }, EXPORT_LIMITS.timeoutMs)
    })])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await loading.destroy()
  }
}
export async function validatePdf(path: string): Promise<PdfValidation> {
  const { text: _text, ...validation } = await inspectPdf(path)
  return validation
}
export async function validateDocx(path: string): Promise<void> { await inspectDocx(path) }
