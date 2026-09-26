/**
 * Export chain — the approved version becomes four deliverables:
 * 试卷.docx → 试卷.pdf and 答案解析.docx → 答案解析.pdf.
 *
 * Rendering is pandoc Markdown → .docx against an A4 reference document
 * (18 mm margins, 12 pt body, generated once from pandoc's stock reference
 * and patched in place); PDF comes from headless LibreOffice converting the
 * same .docx, so preview, Word and print never diverge. Tools run as
 * spawned processes with timeouts inside the job's export directory — no
 * shell, no model-supplied paths.
 */

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderAnswerMarkdown, renderPaperMarkdown, type PaperDocument, type SolveResult } from '@physicsos/question-paper'

/** Tool locations and the export root — deployment config, never defaults baked in. */
export interface ExportTools {
  readonly pandoc: string
  readonly soffice: string | undefined
  readonly exportDir: string
  /** OpenAI-compatible image endpoint for figure generation; absent →
   *  figures print as caption placeholders. */
  readonly imageApi?: {
    readonly baseURL: string
    readonly model: string
    readonly apiKeyEnv: string
    readonly size?: string
  }
}

/** The four deliverable filenames for one paper version. */
export interface ExportFileSet {
  readonly paperDocx: string
  readonly paperPdf?: string
  readonly answerDocx: string
  readonly answerPdf?: string
}

const run = (cmd: string, args: string[], cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env === undefined ? undefined : { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`${cmd} failed to start: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })

/**
 * Build the A4 reference .docx once under `exportDir/_template`: pandoc's
 * stock reference patched to A4 (11906×16838 twips), 18 mm margins
 * (≈1021 twips) and 12 pt body (24 half-points). `unzip`/`zip` are stock
 * macOS tools; both run inside the template dir.
 * @param tools - configured tool paths and export root.
 * @returns the reference .docx path.
 */
async function ensureReferenceDocx(tools: ExportTools): Promise<string> {
  const dir = join(tools.exportDir, '_template')
  /* Bump the version segment whenever the style patching below changes —
     the cached reference must be regenerated, not reused. */
  const target = join(dir, 'reference-a4-v2.docx')
  try {
    await readFile(target)
    return target
  } catch { /* build it below */ }

  await mkdir(dir, { recursive: true })
  const stock = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(tools.pandoc, ['--print-default-data-file', 'reference.docx'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error('pandoc reference.docx failed'))
    })
  })
  await writeFile(join(dir, 'reference.docx'), stock)

  const unzipped = join(dir, 'ref')
  await run('unzip', ['-o', '-q', join(dir, 'reference.docx'), '-d', unzipped], dir, 30_000)

  const docXml = join(unzipped, 'word', 'document.xml')
  // Pandoc's stock reference carries a bare `<w:sectPr>` with no page
  // geometry, so Word/LibreOffice fall back to US Letter. A4 + 18 mm
  // margins go in as sectPr children — the CT_SectPr sequence puts
  // pgSz/pgMar after footnotePr and before cols/docGrid, which a
  // `</w:sectPr>` prepend satisfies for this stock file.
  const pageSetup =
    '<w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1021" w:right="1021" w:bottom="1021" w:left="1021" w:header="720" w:footer="720" w:gutter="0"/>'
  const stockDoc = await readFile(docXml, 'utf8')
  const patchedDoc = stockDoc.includes('<w:pgSz')
    ? stockDoc
      .replace(/<w:pgSz[^/]*\/>/, '<w:pgSz w:w="11906" w:h="16838"/>')
      .replace(/<w:pgMar[^/]*\/>/, '<w:pgMar w:top="1021" w:right="1021" w:bottom="1021" w:left="1021" w:header="720" w:footer="720" w:gutter="0"/>')
    : stockDoc.replace('</w:sectPr>', `${pageSetup}</w:sectPr>`)
  await writeFile(docXml, patchedDoc)
  // The stock docDefaults already set 12 pt body (`w:sz 24` half-points) and
  // eastAsia zh-CN; what they do not pin is the CJK font itself, and
  // LibreOffice's theme-font fallback drops Chinese glyphs entirely in
  // headless PDF export. `Songti SC` resolves on every macOS (宋体-简);
  // Word substitutes 宋体-family fonts when opening the .docx elsewhere.
  const stylesXml = join(unzipped, 'word', 'styles.xml')
  /* One typographic voice for the whole deliverable: headings keep their
     weight but take the body's theme font, black ink, and print-conventional
     sizes (title 18 pt, H1 14 pt, H2 12 pt) instead of pandoc's colored
     Calibri-Light defaults. */
  const restyle = (xml: string, id: string, halfPoints: string): string =>
    xml.replace(
      new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`),
      block => block
        .replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${halfPoints}"/>`)
        .replace(/<w:szCs w:val="\d+"\/>/, `<w:szCs w:val="${halfPoints}"/>`),
    )
  let patchedStyles = (await readFile(stylesXml, 'utf8'))
    .replace(/w:asciiTheme="majorHAnsi"/g, 'w:asciiTheme="minorHAnsi"')
    .replace(/w:hAnsiTheme="majorHAnsi"/g, 'w:hAnsiTheme="minorHAnsi"')
    .replace(/w:eastAsiaTheme="majorEastAsia"/g, 'w:eastAsia="Songti SC"')
    .replace(/w:eastAsiaTheme="minorEastAsia"/g, 'w:eastAsia="Songti SC"')
    .replace(/w:color w:val="0F4761"/g, 'w:color w:val="auto"')
  patchedStyles = restyle(patchedStyles, 'Title', '36')
  patchedStyles = restyle(patchedStyles, 'Heading1', '28')
  patchedStyles = restyle(patchedStyles, 'Heading2', '24')
  await writeFile(stylesXml, patchedStyles)

  await run('zip', ['-q', '-r', 'reference-a4-v2.docx', '.', '-x', 'reference.docx'], unzipped, 30_000)
  await rename(join(unzipped, 'reference-a4-v2.docx'), target)
  return target
}

/**
 * Render and convert one approved document into its four deliverables.
 * PDF steps run only when `soffice` resolves — without LibreOffice the
 * bundle carries the .docx pair and reports the gap.
 * @param tools - configured tool paths and export root.
 * @param jobId - owning job (export dir is `<exportDir>/<jobId>`).
 * @param doc - the approved document version.
 * @param solves - independent-solve results; printed as the per-question
 *   verification trail in the answer document.
 * @returns produced filenames, missing entries omitted.
 */
const FIGURE_STYLE =
  '。初中物理试卷题图，黑白线稿教材插图风格，白底黑线，构图简洁，标注清晰，无彩色，无水印，无多余文字'

interface ImageGenerationResponse {
  data?: { b64_json?: string; url?: string }[]
}

/** Generate one PNG per `figure.ref` into `dir`; failures leave the caption
 *  placeholder in place rather than failing the export. */
async function generateFigures(tools: ExportTools, doc: PaperDocument, dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const api = tools.imageApi
  if (api === undefined) return files
  const key = process.env[api.apiKeyEnv]
  if (key === undefined || key === '') return files
  for (const section of doc.sections) {
    for (const question of section.items) {
      const figure = question.figure
      if (figure === undefined) continue
      const name = `fig-${figure.ref}.png`
      /* Re-export reuses images already on disk — regenerating costs ~70 s
         per figure; delete the file to force a redraw. */
      try {
        await access(join(dir, name))
        files.set(figure.ref, name)
        continue
      } catch { /* not generated yet */ }
      try {
        const res = await fetch(`${api.baseURL}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: api.model, n: 1, size: api.size ?? '1024x1024',
            prompt: (figure.caption ?? figure.ref) + FIGURE_STYLE,
          }),
          signal: AbortSignal.timeout(180_000),
        })
        if (!res.ok) continue
        const body = await res.json() as ImageGenerationResponse
        const first = body.data?.[0]
        if (first?.b64_json !== undefined) {
          await writeFile(join(dir, name), Buffer.from(first.b64_json, 'base64'))
        } else if (first?.url !== undefined) {
          const image = await fetch(first.url, { signal: AbortSignal.timeout(60_000) })
          if (!image.ok) continue
          await writeFile(join(dir, name), Buffer.from(await image.arrayBuffer()))
        } else continue
        files.set(figure.ref, name)
      } catch { /* placeholder stands */ }
    }
  }
  return files
}

/**
 * Write the job's export set — markdown paper, answers, docx copies — under
 * `exportDir/<jobId>` and return the produced file names for `recordExport`.
 * @param tools - the host-provided export dependencies (dirs, renderers, figure generation).
 * @param jobId - the job these files belong to; also the output subdirectory.
 * @param doc - the approved paper document being exported.
 * @param solves - optional independent-solve results folded into the answer doc.
 * @returns the set of produced files keyed by kind.
 */
export async function exportPaper(
  tools: ExportTools, jobId: string, doc: PaperDocument, solves?: readonly SolveResult[],
): Promise<ExportFileSet> {
  const dir = join(tools.exportDir, jobId)
  await mkdir(dir, { recursive: true })
  const reference = await ensureReferenceDocx(tools)

  const figures = await generateFigures(tools, doc, dir)
  const paperMd = join(dir, '试卷.md')
  const answerMd = join(dir, '答案解析.md')
  await writeFile(paperMd, renderPaperMarkdown(doc, figures), 'utf8')
  await writeFile(answerMd, renderAnswerMarkdown(doc, solves), 'utf8')

  await run(tools.pandoc, ['-f', 'markdown+tex_math_dollars-implicit_figures', '-t', 'docx',
    '--reference-doc', reference, '-o', '试卷.docx', '试卷.md'], dir, 60_000)
  await run(tools.pandoc, ['-f', 'markdown+tex_math_dollars-implicit_figures', '-t', 'docx',
    '--reference-doc', reference, '-o', '答案解析.docx', '答案解析.md'], dir, 60_000)

  const files: ExportFileSet = { paperDocx: '试卷.docx', answerDocx: '答案解析.docx' }
  if (tools.soffice !== undefined) {
    // Headless soffice on macOS starts under a VCL plugin that never
    // enumerates system fonts — every CJK glyph falls back to the bundled
    // Latin fonts and prints as nothing. The `osx` plugin makes system
    // fonts visible; other platforms keep their default (svp) headless path.
    const env = process.platform === 'darwin' ? { SAL_USE_VCLPLUGIN: 'osx' } : undefined
    await run(tools.soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, '试卷.docx'], dir, 180_000, env)
    await run(tools.soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, '答案解析.docx'], dir, 180_000, env)
    return { ...files, paperPdf: '试卷.pdf', answerPdf: '答案解析.pdf' }
  }
  return files
}
