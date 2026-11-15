/**
 * Approved paper → four validated deliverables, published atomically under
 * immutable document/content identities. Pandoc writes the A4 DOCX pair;
 * LibreOffice converts those same bytes to PDF. No partial bundle, unreviewed
 * generated image, empty exit-0 output or mutable legacy filename is success.
 */
import { createHash } from 'node:crypto'
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  canonicalDocument, documentHash, paperFigureFileName, paperFigureInputHash, parsePaperFigure,
  renderAnswerMarkdown, renderPaperMarkdown, runChecks, PAPER_DIAGRAM_RENDERER_VERSION, PAPER_PRINT_LAYOUT_VERSION,
  type PaperDiagramSpec, type PaperDocument, type PaperQuestion, type SolveResult, type SourceFigureAsset,
} from '@physicsos/question-paper'
import { DIAGRAM_RASTERIZER_VERSION, normalizeSourceFigure, rasterizePaperDiagram, validateFigurePng } from './diagram-rasterizer.ts'
import { EXPORT_LIMITS, EXPORT_VALIDATOR_VERSION, readExportFile, validateDocx, validatePdf, type PdfValidation } from './export-validation.ts'
import { runPrintProcess, type PrintProcessResult } from './print-process.ts'

/** Deployment tools plus narrow deterministic seams used by failure tests. */
export interface ExportTools {
  readonly pandoc: string
  readonly soffice: string | undefined
  readonly exportDir: string
  /** Legacy config remains readable, but AI images never express paper facts. */
  readonly imageApi?: { readonly baseURL: string; readonly model: string; readonly apiKeyEnv: string; readonly size?: string }
  readonly diagramRasterizer?: (spec: PaperDiagramSpec) => Promise<Uint8Array>
  readonly validatePng?: (data: Uint8Array) => Promise<unknown>
  /** Owner-scoped resolver for a real attachment, never an arbitrary URL/path. */
  readonly readSourceAsset?: (asset: SourceFigureAsset, question: PaperQuestion) => Promise<Uint8Array>
  readonly validateDocx?: (path: string) => Promise<void>
  readonly validatePdf?: (path: string) => Promise<PdfValidation>
  readonly runProcess?: (command: string, args: readonly string[], cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv, maxOutputBytes?: number) => Promise<PrintProcessResult>
}
export type ExportFileKind = 'paperDocx' | 'paperPdf' | 'answerDocx' | 'answerPdf'
export interface ExportFileDigest { readonly path: string; readonly sha256: string; readonly bytes: number; readonly mediaType: string }
export interface ExportAsset extends ExportFileDigest { readonly ref: string; readonly questionNo: number; readonly inputHash: string }
export interface ExportManifest {
  readonly schemaVersion: 1
  readonly paperId: string
  readonly documentHash: string
  readonly version?: number
  readonly contentHash: string
  readonly files: Readonly<Record<ExportFileKind, ExportFileDigest>>
  readonly assets: readonly ExportAsset[]
  readonly inputs: readonly (ExportFileDigest & { readonly role: string })[]
  readonly renderers: { readonly diagram: string; readonly raster: string; readonly layout: string; readonly validation: string }
  readonly validation: { readonly paperPdf: PdfValidation; readonly answerPdf: PdfValidation }
}
/** Four files are mandatory; paths are relative to `<exportDir>/<jobId>`. */
export interface ExportFileSet {
  readonly paperDocx: string
  readonly paperPdf: string
  readonly answerDocx: string
  readonly answerPdf: string
  readonly documentHash: string
  readonly contentHash: string
  readonly manifestPath: string
  readonly manifest: ExportManifest
}
export interface ExportBinding {
  readonly version?: number
  readonly expectedDocumentHash?: string
  readonly figureAssets?: readonly { readonly questionNo: number; readonly inputHash: string; readonly sha256: string }[]
}

const NAMES: Record<ExportFileKind, string> = { paperDocx: '试卷.docx', paperPdf: '试卷.pdf', answerDocx: '答案解析.docx', answerPdf: '答案解析.pdf' }
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
const processFor = (tools: ExportTools) => tools.runProcess ?? runPrintProcess
const exists = async (path: string): Promise<boolean> => {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
const assertJobId = (jobId: string): void => { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(jobId)) throw new Error('导出 job id 无效') }
const assertDirectory = async (path: string): Promise<void> => { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('导出目录必须为实际目录') }
const digestFile = async (dir: string, path: string, mediaType: string): Promise<ExportFileDigest> => {
  const bytes = await readExportFile(join(dir, path))
  return { path, sha256: sha256(bytes), bytes: bytes.length, mediaType }
}
const validateWord = (tools: ExportTools, path: string) => (tools.validateDocx ?? validateDocx)(path)
const validatePortable = (tools: ExportTools, path: string) => (tools.validatePdf ?? validatePdf)(path)

/* Reference v2 already has the correct A4/18mm geometry. Retain its name and
   dimensions, validate it, and generate it with isolated temporary trees so
   first exports for two jobs cannot race through a shared `_template/ref`. */
const references = new Map<string, Promise<string>>()
async function ensureReferenceDocx(tools: ExportTools): Promise<string> {
  const root = resolve(tools.exportDir); const key = `${root}\0${tools.pandoc}`
  const pending = references.get(key)
  if (pending !== undefined) return pending
  const create = async (): Promise<string> => {
    const dir = join(root, '_template'); const target = join(dir, 'reference-a4-v2.docx')
    await mkdir(dir, { recursive: true }); await assertDirectory(dir)
    if (await exists(target)) { await validateWord(tools, target); return target }
    const temp = await mkdtemp(join(dir, '.reference-'))
    try {
      const run = processFor(tools)
      const stock = await run(tools.pandoc, ['--print-default-data-file', 'reference.docx'], temp, 60_000, undefined, EXPORT_LIMITS.fileBytes)
      if (stock.stdout.length === 0) throw new Error('pandoc 返回空白 reference.docx')
      await writeFile(join(temp, 'stock.docx'), stock.stdout)
      const unzipped = join(temp, 'ref')
      await run('unzip', ['-q', join(temp, 'stock.docx'), '-d', unzipped], temp, 30_000)
      const docXml = join(unzipped, 'word', 'document.xml')
      const stockDoc = await readFile(docXml, 'utf8')
      if (!stockDoc.includes('</w:sectPr>')) throw new Error('pandoc 参考模板缺少 Word sectPr')
      const page = '<w:pgSz w:w="11906" w:h="16838"/>'
      const margin = '<w:pgMar w:top="1021" w:right="1021" w:bottom="1021" w:left="1021" w:header="720" w:footer="720" w:gutter="0"/>'
      const geometry = stockDoc.replace(/<w:pgSz\b[^>]*\/>/g, '').replace(/<w:pgMar\b[^>]*\/>/g, '').replace('</w:sectPr>', `${page}${margin}</w:sectPr>`)
      await writeFile(docXml, geometry)
      const stylesXml = join(unzipped, 'word', 'styles.xml')
      const restyle = (xml: string, id: string, halfPoints: string): string => xml.replace(new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`), (block) => block.replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${halfPoints}"/>`).replace(/<w:szCs w:val="\d+"\/>/, `<w:szCs w:val="${halfPoints}"/>`))
      /* Noto Serif CJK SC is installed by the server image. Keep the original
         styles/12pt sizing; never pretend the macOS-only font exists there. */
      let styles = (await readFile(stylesXml, 'utf8')).replace(/w:asciiTheme="majorHAnsi"/g, 'w:asciiTheme="minorHAnsi"').replace(/w:hAnsiTheme="majorHAnsi"/g, 'w:hAnsiTheme="minorHAnsi"')
        .replace(/w:eastAsiaTheme="(?:major|minor)EastAsia"/g, 'w:eastAsia="Noto Serif CJK SC"').replace(/w:color w:val="0F4761"/g, 'w:color w:val="auto"')
      styles = restyle(restyle(restyle(styles, 'Title', '36'), 'Heading1', '28'), 'Heading2', '24')
      await writeFile(stylesXml, styles)
      const candidate = join(temp, 'reference-a4-v2.docx')
      await run('zip', ['-q', '-r', candidate, '.'], unzipped, 30_000)
      await validateWord(tools, candidate)
      /* A different process may have finished first. Never replace its
         cached file, and never remove a historical template on failure. */
      try { await link(candidate, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      await validateWord(tools, target)
      return target
    } finally { await rm(temp, { recursive: true, force: true }) }
  }
  const promise = create(); references.set(key, promise)
  try { return await promise } finally { references.delete(key) }
}

interface FigureCacheRecord { readonly schemaVersion: 1; readonly inputHash: string; readonly sha256: string; readonly bytes: number; readonly renderer: string }
/**
 * The public signature stays compatible with the review driver. Ref is just
 * a map key; disk identity binds complete question/spec inputs, plus PNG
 * bytes. Legacy `fig-ref.png` is never a cache hit. All failures are explicit.
 */
export async function generateFigures(
  tools: ExportTools, doc: PaperDocument, dir: string,
  onProgress?: (done: number, total: number, ref: string) => void,
  onFailure?: (ref: string, reason: string) => void,
): Promise<Map<string, string>> {
  const figures = doc.sections.flatMap((section) => section.items).filter((question) => question.figure !== undefined)
  const files = new Map<string, string>()
  if (figures.length === 0) return files
  await mkdir(dir, { recursive: true }); await assertDirectory(dir)
  let done = 0
  const errors: string[] = []
  for (const question of figures) {
    const ref = question.figure!.ref
    onProgress?.(done, figures.length, ref)
    try {
      if (files.has(ref)) throw new Error('全卷题图 ref 重复，无法唯一对账')
      const figure = parsePaperFigure(question.figure)
      if (figure.kind === 'line-diagram' && figure.diagram === undefined) throw new Error('必要题图缺少可验证 diagram spec，不能用 AI 图片或图注占位')
      if (figure.kind === 'image' && (figure.sourceAsset === undefined || tools.readSourceAsset === undefined)) throw new Error('必要来源题图缺少已授权附件及读取能力')
      const inputHash = paperFigureInputHash(question); const name = paperFigureFileName(question)
      const cacheDir = join(dir, '_figures', inputHash); const cachePng = join(cacheDir, 'image.png'); const cacheRecord = join(cacheDir, 'manifest.json')
      let bytes: Uint8Array | undefined
      if (await exists(cacheDir)) {
        await assertDirectory(cacheDir)
        const meta = JSON.parse((await readExportFile(cacheRecord, 16 * 1024)).toString('utf8')) as FigureCacheRecord
        const cached = await readExportFile(cachePng)
        if (meta.schemaVersion !== 1 || meta.inputHash !== inputHash || meta.sha256 !== sha256(cached) || meta.bytes !== cached.length) throw new Error('题图内容缓存与摘要不符，必须显式修复，不能沿用旧图')
        await (tools.validatePng ?? validateFigurePng)(cached)
        bytes = cached
      } else {
        bytes = figure.diagram !== undefined
          ? await (tools.diagramRasterizer ?? rasterizePaperDiagram)(figure.diagram)
          : await normalizeSourceFigure(await tools.readSourceAsset!(figure.sourceAsset!, question), figure.sourceAsset!)
        await (tools.validatePng ?? validateFigurePng)(bytes)
        const parent = join(dir, '_figures'); await mkdir(parent, { recursive: true }); await assertDirectory(parent)
        const temp = await mkdtemp(join(parent, '.figure-'))
        try {
          const meta: FigureCacheRecord = { schemaVersion: 1, inputHash, sha256: sha256(bytes), bytes: bytes.byteLength, renderer: `${PAPER_DIAGRAM_RENDERER_VERSION}/${DIAGRAM_RASTERIZER_VERSION}` }
          await writeFile(join(temp, 'image.png'), bytes); await writeFile(join(temp, 'manifest.json'), JSON.stringify(meta))
          const verifyWinner = async (): Promise<void> => {
            await assertDirectory(cacheDir)
            const concurrent = await readExportFile(join(cacheDir, 'image.png'))
            const winner = JSON.parse((await readExportFile(join(cacheDir, 'manifest.json'), 16 * 1024)).toString('utf8')) as FigureCacheRecord
            if (winner.inputHash !== inputHash || winner.sha256 !== meta.sha256 || winner.bytes !== concurrent.length || sha256(concurrent) !== meta.sha256) throw new Error('同一题图输入得到不同字节，拒绝覆盖已存在题图')
            await (tools.validatePng ?? validateFigurePng)(concurrent)
          }
          if (await exists(cacheDir)) await verifyWinner()
          else {
            try { await rename(temp, cacheDir) } catch (error) {
              if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
              await verifyWinner()
            }
          }
        } finally { await rm(temp, { recursive: true, force: true }) }
      }
      const visible = join(dir, name)
      /* A hard link publishes fully-written cached bytes with exclusive
         creation, so reviewers never read a half-written root PNG. */
      try { await link(cachePng, visible) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (sha256(await readExportFile(visible)) !== sha256(bytes)) throw new Error('已发布题图字节被更改，拒绝覆盖')
      }
      files.set(ref, name); done++; onProgress?.(done, figures.length, ref)
    } catch (error) {
      const reason = error instanceof Error ? error.message : '题图准备失败'
      onFailure?.(ref, reason); errors.push(`第 ${question.number} 题（${ref}）：${reason}`)
    }
  }
  if (errors.length > 0 || files.size !== figures.length) throw new Error(`必要题图未完成：${errors.join('；')}`)
  return files
}

/** Stable content identity covers delivered bytes, source inputs and assets. */
export function exportContentHash(manifest: Omit<ExportManifest, 'contentHash'> | ExportManifest): string {
  /* Only bundle-local paths enter the hash; ignore the hash's own prefix
     and field so a stored manifest can independently recompute its identity. */
  const { contentHash: _hash, ...identity } = manifest as ExportManifest
  const local = <T extends ExportFileDigest>(file: T): T => ({ ...file, path: file.path.split('/').at(-1)! })
  return sha256(canonical({ ...identity,
    files: Object.fromEntries((Object.keys(identity.files) as ExportFileKind[]).map((kind) => [kind, local(identity.files[kind])])),
    assets: identity.assets.map(local), inputs: identity.inputs.map(local),
  }))
}
function assertPrintableDocument(doc: PaperDocument): void {
  const findings = runChecks(doc, { totalScore: doc.header.totalScore, chapters: [], exclude: [] })
  const blocking = new Set(['score-mismatch', 'numbering', 'spec-mismatch', 'format', 'missing-figure', 'missing-answer', 'answer-format'])
  const errors = findings.filter((finding) => finding.severity === 'error' && blocking.has(finding.code))
  if (errors.length > 0) throw new Error(`卷面不可导出：${errors.map((finding) => finding.detail).slice(0, 8).join('；')}`)
}
async function verifyBundleDirectory(tools: ExportTools, directory: string, manifest: ExportManifest): Promise<void> {
  await assertDirectory(directory)
  for (const file of [...Object.values(manifest.files), ...manifest.assets, ...manifest.inputs]) {
    const basename = file.path.split('/').at(-1)!
    const bytes = await readExportFile(join(directory, basename))
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('不可变导出文件或输入的 SHA-256 不符，拒绝复用或覆盖历史')
  }
  await validateWord(tools, join(directory, '试卷.docx')); await validateWord(tools, join(directory, '答案解析.docx'))
  await validatePortable(tools, join(directory, '试卷.pdf')); await validatePortable(tools, join(directory, '答案解析.pdf'))
}

/**
 * Generate in a private temporary directory, validate all four files, hash
 * all bytes/inputs/assets, then rename once. Failure removes only this call's
 * temporary tree; never touch a previous version or a partial legacy export.
 */
export async function exportPaper(
  tools: ExportTools, jobId: string, doc: PaperDocument, solves?: readonly SolveResult[],
  onProgress?: (stage: string, done: number, total: number, detail?: string) => void,
  binding?: ExportBinding,
): Promise<ExportFileSet> {
  assertJobId(jobId)
  if (tools.soffice === undefined || tools.soffice.trim() === '') throw new Error('缺少 LibreOffice，四件套导出失败；不能把仅 DOCX 标为成功')
  const hash = documentHash(doc)
  if (binding?.expectedDocumentHash !== undefined && binding.expectedDocumentHash !== hash) throw new Error('导出内容与已批准版本不一致')
  if (binding?.version !== undefined && (!Number.isSafeInteger(binding.version) || binding.version < 1)) throw new Error('导出版本号无效')
  assertPrintableDocument(doc)
  const root = join(resolve(tools.exportDir), jobId); await mkdir(root, { recursive: true }); await assertDirectory(root)
  const figures = await generateFigures(tools, doc, root, (done, total, ref) => onProgress?.('figure', done, total, `准备确定性题图 ${ref}`))
  const questions = doc.sections.flatMap((section) => section.items).filter((question) => question.figure !== undefined)
  const assets: ExportAsset[] = []
  if (binding?.figureAssets !== undefined && binding.figureAssets.length !== questions.length) throw new Error('审核题图覆盖与当前卷面题图数量不一致')
  for (const question of questions) {
    const name = figures.get(question.figure!.ref)!
    const digest = await digestFile(root, name, 'image/png'); const inputHash = paperFigureInputHash(question)
    if (binding?.figureAssets !== undefined) {
      const reviewed = binding.figureAssets.filter((asset) => asset.questionNo === question.number)
      if (reviewed.length !== 1 || reviewed[0]!.inputHash !== inputHash || reviewed[0]!.sha256 !== digest.sha256) throw new Error(`第 ${question.number} 题题图与审核字节不一致，必须重新审核`)
    }
    assets.push({ ...digest, ref: question.figure!.ref, questionNo: question.number, inputHash })
  }
  const temp = await mkdtemp(join(root, '.export-'))
  try {
    const reference = await ensureReferenceDocx(tools)
    await copyFile(reference, join(temp, 'reference-a4-v2.docx'))
    for (const asset of assets) {
      await copyFile(join(root, asset.path), join(temp, asset.path))
      const bytes = await readExportFile(join(temp, asset.path))
      if (sha256(bytes) !== asset.sha256) throw new Error('题图在生成卷面前被更改，必须重新审核')
      await (tools.validatePng ?? validateFigurePng)(bytes)
    }
    const paperMd = renderPaperMarkdown(doc, figures); const answerMd = renderAnswerMarkdown(doc, solves)
    await writeFile(join(temp, '试卷.md'), paperMd); await writeFile(join(temp, '答案解析.md'), answerMd)
    await writeFile(join(temp, 'document.json'), canonicalDocument(doc)); await writeFile(join(temp, 'solve-report.json'), canonical(solves ?? []))
    const run = processFor(tools)
    const format = 'markdown+tex_math_dollars+raw_attribute-implicit_figures-raw_html-raw_tex-autolink_bare_uris'
    for (const [index, name] of ['试卷', '答案解析'].entries()) {
      onProgress?.('export', index, 4, `排版 ${name}.docx`)
      await run(tools.pandoc, ['-f', format, '-t', 'docx', '--reference-doc', 'reference-a4-v2.docx', '--resource-path', '.', '-o', `${name}.docx`, `${name}.md`], temp, 60_000)
      await validateWord(tools, join(temp, `${name}.docx`))
    }
    /* Distinct profile per invocation avoids the silent success/no-output
       handoff to an already running headless LibreOffice process. */
    const profile = await mkdtemp(join(root, '.office-'))
    try {
      const env = process.platform === 'darwin' ? { SAL_USE_VCLPLUGIN: 'osx' } : undefined
      for (const [index, name] of ['试卷', '答案解析'].entries()) {
        onProgress?.('export', index + 2, 4, `验证 ${name}.pdf`)
        await run(tools.soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', temp, `${name}.docx`], temp, 180_000, env)
        /* Exit 0 is not evidence: actual bytes/page parsing must succeed. */
        await readExportFile(join(temp, `${name}.pdf`))
      }
    } finally { await rm(profile, { recursive: true, force: true }) }
    const validation = { paperPdf: await validatePortable(tools, join(temp, NAMES.paperPdf)), answerPdf: await validatePortable(tools, join(temp, NAMES.answerPdf)) }
    const files = {} as Record<ExportFileKind, ExportFileDigest>
    for (const kind of Object.keys(NAMES) as ExportFileKind[]) files[kind] = await digestFile(temp, NAMES[kind], kind.endsWith('Pdf') ? 'application/pdf' : MIME_DOCX)
    const inputs: (ExportFileDigest & { role: string })[] = []
    for (const [path, role, mediaType] of [['试卷.md', 'paper-markdown', 'text/markdown'], ['答案解析.md', 'answer-markdown', 'text/markdown'], ['reference-a4-v2.docx', 'reference-docx', MIME_DOCX], ['document.json', 'canonical-document', 'application/json'], ['solve-report.json', 'solve-report', 'application/json']] as const) inputs.push({ ...await digestFile(temp, path, mediaType), role })
    const source: Omit<ExportManifest, 'contentHash'> = { schemaVersion: 1, paperId: jobId, documentHash: hash, ...(binding?.version === undefined ? {} : { version: binding.version }), files, assets, inputs, renderers: { diagram: PAPER_DIAGRAM_RENDERER_VERSION, raster: DIAGRAM_RASTERIZER_VERSION, layout: PAPER_PRINT_LAYOUT_VERSION, validation: EXPORT_VALIDATOR_VERSION }, validation }
    const contentHash = exportContentHash(source); const prefix = `${hash}/${contentHash}`
    const prefixed = <T extends ExportFileDigest>(file: T): T => ({ ...file, path: `${prefix}/${file.path}` })
    const manifest: ExportManifest = { ...source, contentHash, files: Object.fromEntries((Object.keys(files) as ExportFileKind[]).map((kind) => [kind, prefixed(files[kind])])) as Record<ExportFileKind, ExportFileDigest>, assets: assets.map(prefixed), inputs: inputs.map(prefixed) }
    await writeFile(join(temp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const parent = join(root, hash); await mkdir(parent, { recursive: true }); await assertDirectory(parent)
    const destination = join(parent, contentHash)
    const verifyWinner = async (): Promise<void> => {
      const existing = JSON.parse((await readExportFile(join(destination, 'manifest.json'), 2 * 1024 * 1024)).toString('utf8')) as ExportManifest
      if (canonical(existing) !== canonical(manifest) || exportContentHash(existing) !== contentHash) throw new Error('同一内容目录已有不同 manifest，拒绝覆盖历史')
      await verifyBundleDirectory(tools, destination, manifest)
    }
    if (await exists(destination)) await verifyWinner()
    else {
      try { await rename(temp, destination) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await verifyWinner()
      }
    }
    onProgress?.('export', 4, 4, '四件套已验证并发布到不可变内容目录')
    return { paperDocx: manifest.files.paperDocx.path, paperPdf: manifest.files.paperPdf.path, answerDocx: manifest.files.answerDocx.path, answerPdf: manifest.files.answerPdf.path, documentHash: hash, contentHash, manifestPath: `${prefix}/manifest.json`, manifest }
  } finally { await rm(temp, { recursive: true, force: true }) }
}
