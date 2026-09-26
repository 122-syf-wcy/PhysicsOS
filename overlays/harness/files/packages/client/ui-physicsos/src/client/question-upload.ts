/**
 * 题目图片/PDF 上传读取 — one file, two routes:
 *
 *   - an image (or a scanned PDF page rendered to PNG) becomes a base64
 *     {@link UploadedImage}: the student path hands it to the agent as a
 *     session prompt image part (the vision model transcribes it and calls
 *     physics_solve_question itself), the 出卷 path posts it to
 *     `/physicsos/paper/bank/ingest-image`;
 *   - a PDF with a real text layer is read locally by pdf.js and the text
 *     lands in the editable draft, so the deterministic pipeline sees exactly
 *     the words the student confirmed.
 *
 * Nothing here computes physics or mutates a scene — the file only reads bytes.
 *
 * pdf.js loads lazily: it references DOMMatrix at module evaluation, which only
 * exists in a real browser — a test environment that never uploads a PDF must
 * not pay that cost, and neither must a student who only sends images.
 */

/** One browser-selected image, ready to ride a `prompt` content part. */
export interface UploadedImage {
  readonly name: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Base64 without the `data:` prefix, as PromptContentPart expects. */
  readonly dataBase64: string
}

/** What one picked file read to: an image, a PDF text layer, or rendered pages. */
export type QuestionUploadRead =
  | { readonly kind: 'image'; readonly image: UploadedImage }
  | { readonly kind: 'pdf-text'; readonly text: string; readonly pageCount: number }
  | { readonly kind: 'pdf-pages'; readonly images: readonly UploadedImage[]; readonly pageCount: number }

/** Failure codes the picker turns into student-readable reasons. */
export type QuestionUploadErrorCode = 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'PDF_EMPTY' | 'PDF_UNREADABLE'

/** Structured upload refusal; the message is already student-readable. */
export class QuestionUploadError extends Error {
  /** Machine-readable failure kind the picker branches on. */
  readonly code: QuestionUploadErrorCode
  constructor(code: QuestionUploadErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'QuestionUploadError'
  }
}

/* attachment-local admits raster images only; mirror its headline limits so a
   rejected file fails here with a student-readable reason, not a server error. */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024

/** A worksheet is a handful of pages; beyond that the upload is a document, not a question. */
const MAX_PDF_PAGES = 6

/** A page whose text layer is shorter than this is a scan wearing a PDF container. */
const MIN_TEXT_LAYER_CHARS = 12

/** Render scale for scanned pages: ~144dpi keeps handwriting legible for the model. */
const SCAN_RENDER_SCALE = 2

const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => {
    /* readAsDataURL yields a string; the union still names ArrayBuffer|null,
       so narrowing beats String() — which would print "[object Object]". */
    if (typeof reader.result !== 'string') {
      reject(new Error('读取文件失败'))
      return
    }
    resolve(reader.result)
  }
  reader.onerror = () => { reject(new Error('读取文件失败')) }
  reader.readAsDataURL(file)
})

const base64OfDataUrl = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

/**
 * A browser-picked image file → one durable image prompt part.
 * @param file - the browser-picked image.
 * @returns the base64 payload and media type a prompt part carries.
 */
export async function readQuestionImage(file: File): Promise<UploadedImage> {
  const mediaType = file.type as UploadedImage['mediaType']
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new QuestionUploadError('UNSUPPORTED_TYPE',
      `不支持的图片格式 ${file.type || '未知'}（支持 PNG/JPEG/WebP/GIF）。`)
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new QuestionUploadError('FILE_TOO_LARGE', `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限。`)
  }
  return { name: file.name || 'question-image', mediaType, dataBase64: base64OfDataUrl(await readAsDataUrl(file)) }
}

/**
 * A PDF → its text layer, or rendered page images when the layer is too thin
 * to be real text (scanned worksheets). The worker script is served from the
 * app's public assets so no CDN or network probe is needed.
 * @param file - the browser-picked PDF.
 * @returns the extracted text layer, or the rendered page images for a scan.
 */
export async function readQuestionPdf(file: File): Promise<Exclude<QuestionUploadRead, { kind: 'image' }>> {
  if (file.size > MAX_PDF_BYTES) {
    throw new QuestionUploadError('FILE_TOO_LARGE', `PDF 超过 ${MAX_PDF_BYTES / 1024 / 1024}MB 上限。`)
  }
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  /* The static file server only maps .js to text/javascript — a .mjs worker
     URL arrives as application/octet-stream and module-worker MIME checking
     refuses it (pdf.js then falls back to a fake worker on the main thread). */
  GlobalWorkerOptions.workerSrc = '/physicsos/pdfjs/pdf.worker.min.js'
  const data = await file.arrayBuffer()
  /* cMapUrl is required for CJK text layers (the packed CMaps ship in the same
     public dir as the worker); without it a Chinese PDF reports 0 text items
     and silently falls into the scanned path. */
  const task = getDocument({ data, cMapUrl: '/physicsos/pdfjs/cmaps/', cMapPacked: true })
  let pdf
  try {
    pdf = await task.promise
  } catch {
    throw new QuestionUploadError('PDF_UNREADABLE', 'PDF 无法读取（文件可能损坏或受密码保护）。')
  }
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
    if (pageCount === 0) {
      throw new QuestionUploadError('PDF_EMPTY', 'PDF 没有页面。')
    }
    const texts: string[] = []
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      texts.push(content.items.map(item => ('str' in item ? item.str : '')).join(''))
    }
    const text = texts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length >= MIN_TEXT_LAYER_CHARS) return { kind: 'pdf-text', text, pageCount }

    /* Scanned PDF: no usable text layer → render each page to a PNG the
       vision-capable model can read. */
    const images: UploadedImage[] = []
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await pdf.getPage(index)
      const viewport = page.getViewport({ scale: SCAN_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (context === null) throw new QuestionUploadError('PDF_UNREADABLE', '浏览器无法创建画布渲染 PDF 页面。')
      /* Scans keep transparent backgrounds; a white underlay keeps handwriting
         legible when the PNG is flattened for the model. */
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport }).promise
      images.push({
        name: `${file.name || 'question'}-p${index}.png`,
        mediaType: 'image/png',
        dataBase64: base64OfDataUrl(canvas.toDataURL('image/png')),
      })
    }
    return { kind: 'pdf-pages', images, pageCount }
  } finally {
    void task.destroy()
  }
}

/**
 * The file picker lands here: image → durable image part; PDF → text layer or
 * rendered pages. `UNSUPPORTED_TYPE` covers everything else.
 * @param file - the browser-picked file.
 * @returns what the file read to: an image, a PDF text layer, or rendered pages.
 */
export async function readQuestionUpload(file: File): Promise<QuestionUploadRead> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return readQuestionPdf(file)
  }
  return { kind: 'image', image: await readQuestionImage(file) }
}
