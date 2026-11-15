import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentHash, paperFigureFileName, paperFigureInputHash } from '@physicsos/question-paper'
import { exportContentHash, exportPaper, generateFigures, type ExportTools } from '../src/export.ts'
import { exportFixture, simpleDiagram } from './export-fixture.ts'

const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'physicsos-synthetic-export-')) })
afterEach(async () => { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) })

/** Fault injection tests prove publication/identity rules, not real LO rendering. */
function fakeTools(mode: { missingPdf?: boolean; emptyPdf?: boolean; corruptPdf?: boolean; failAnswer?: boolean; outputSalt?: string; failFigure?: boolean; stockSection?: 'self-closing' | 'missing' } = {}) {
  const calls: { command: string; args: readonly string[]; cwd: string }[] = []
  const runProcess = vi.fn(async (command: string, args: readonly string[], cwd: string) => {
    calls.push({ command, args, cwd })
    if (command === 'pandoc-test' && args.includes('--print-default-data-file')) return { stdout: Buffer.from('STOCK_DOCX'), stderr: '' }
    if (command === 'unzip') {
      const destination = args[args.indexOf('-d') + 1]!
      await mkdir(join(destination, 'word'), { recursive: true })
      const section = mode.stockSection === 'self-closing' ? '<w:sectPr />' : mode.stockSection === 'missing' ? '' : '<w:sectPr></w:sectPr>'
      await writeFile(join(destination, 'word', 'document.xml'), `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/>${section}</w:body></w:document>`)
      await writeFile(join(destination, 'word', 'styles.xml'), '<w:styles><w:rFonts w:eastAsiaTheme="minorEastAsia"/></w:styles>')
    } else if (command === 'zip') {
      await writeFile(args[2]!, 'DOCX::REFERENCE_A4')
    } else if (command === 'pandoc-test') {
      const name = args[args.indexOf('-o') + 1]!
      await writeFile(join(cwd, name), `DOCX::${await readFile(join(cwd, args.at(-1)!), 'utf8')}${mode.outputSalt ?? ''}`)
    } else if (command === 'soffice-test') {
      const name = basename(args.at(-1)!, '.docx')
      if (mode.failAnswer && name === '答案解析') throw new Error('synthetic converter failure')
      if (!mode.missingPdf) await writeFile(join(cwd, `${name}.pdf`), mode.emptyPdf ? '' : mode.corruptPdf ? 'BROKEN' : `PDF::${await readFile(join(cwd, `${name}.docx`), 'utf8')}${mode.outputSalt ?? ''}`)
    }
    return { stdout: Buffer.alloc(0), stderr: '' }
  })
  const tools: ExportTools = { pandoc: 'pandoc-test', soffice: 'soffice-test', exportDir: root, runProcess,
    validateDocx: async (path) => { if (!(await readFile(path, 'utf8')).startsWith('DOCX::')) throw new Error('synthetic invalid DOCX') },
    validatePdf: async (path) => { if (!(await readFile(path, 'utf8')).startsWith('PDF::')) throw new Error('synthetic invalid PDF'); return { pageCount: 1, pages: [{ number: 1, width: 595.28, height: 841.89, textCharacters: 40 }] } },
    diagramRasterizer: vi.fn(async () => { if (mode.failFigure) throw new Error('synthetic raster failure'); return Buffer.from('PNG::controlled-spec') }),
    validatePng: async (bytes) => { if (!Buffer.from(bytes).toString().startsWith('PNG::')) throw new Error('synthetic invalid PNG') },
  }
  return { tools, calls, runProcess }
}
const temps = async (path: string) => (await readdir(path)).filter((name) => name.startsWith('.export-') || name.startsWith('.office-') || name.startsWith('.reference-'))

describe('four-file immutable export transaction', () => {
  it.each(['self-closing', 'missing'] as const)('supports valid Pandoc stock section shape: %s', async (stockSection) => {
    const { tools } = fakeTools({ stockSection })
    const bundle = await exportPaper(tools, 'job-a', exportFixture())
    expect(bundle.paperPdf).toBeDefined()
    expect(bundle.answerPdf).toBeDefined()
    expect(await temps(join(root, '_template'))).toEqual([])
  })

  it('publishes four files plus manifest, each byte digest independently verifiable', async () => {
    const { tools } = fakeTools()
    const doc = exportFixture()
    const bundle = await exportPaper(tools, 'job-a', doc, undefined, undefined, { version: 1, expectedDocumentHash: documentHash(doc) })
    expect(bundle.documentHash).toBe(documentHash(doc))
    expect(bundle.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(exportContentHash(bundle.manifest)).toBe(bundle.contentHash)
    for (const key of ['paperDocx', 'paperPdf', 'answerDocx', 'answerPdf'] as const) {
      expect(bundle[key]).toMatch(new RegExp(`^${bundle.documentHash}/${bundle.contentHash}/`))
      const bytes = await readFile(join(root, 'job-a', bundle[key]))
      expect(bundle.manifest.files[key].sha256).toBe(hash(bytes))
      expect(bundle.manifest.files[key].bytes).toBe(bytes.length)
    }
    expect(bundle.manifest.inputs.map((input) => input.role)).toEqual(expect.arrayContaining(['canonical-document', 'reference-docx', 'paper-markdown', 'answer-markdown', 'solve-report']))
    expect(JSON.parse(await readFile(join(root, 'job-a', bundle.manifestPath), 'utf8'))).toEqual(bundle.manifest)
    expect(await temps(join(root, 'job-a'))).toEqual([])
  })

  it('does not overwrite previous same-name paper files after a content edit or converter change', async () => {
    const { tools } = fakeTools()
    const doc = exportFixture()
    const original = await exportPaper(tools, 'job-a', doc)
    const originalBytes = await readFile(join(root, 'job-a', original.paperPdf))
    const edited = { ...doc, title: '合成内容修订卷' }
    const next = await exportPaper(tools, 'job-a', edited)
    expect(next.paperPdf).not.toBe(original.paperPdf)
    expect(await readFile(join(root, 'job-a', original.paperPdf))).toEqual(originalBytes)
    const differentToolBytes = await exportPaper(fakeTools({ outputSalt: 'new-converter' }).tools, 'job-a', doc)
    expect(differentToolBytes.documentHash).toBe(original.documentHash)
    expect(differentToolBytes.contentHash).not.toBe(original.contentHash)
    expect(await readFile(join(root, 'job-a', original.paperPdf))).toEqual(originalBytes)
  })

  it('reuses only byte-identical content and refuses corruption rather than repairing history in place', async () => {
    const { tools } = fakeTools()
    const doc = exportFixture()
    const original = await exportPaper(tools, 'job-a', doc)
    expect(await exportPaper(tools, 'job-a', doc)).toEqual(original)
    await writeFile(join(root, 'job-a', original.answerPdf), 'corrupted history')
    await expect(exportPaper(tools, 'job-a', doc)).rejects.toThrow('SHA-256 不符')
    expect(await readFile(join(root, 'job-a', original.answerPdf), 'utf8')).toBe('corrupted history')
    expect(await temps(join(root, 'job-a'))).toEqual([])
  })

  it.each([{ missingPdf: true }, { emptyPdf: true }, { corruptPdf: true }, { failAnswer: true }])('rejects exit-0 missing/empty/invalid/partial PDF output without a bundle (%j)', async (mode) => {
    const { tools } = fakeTools(mode)
    await mkdir(join(root, 'job-a'), { recursive: true })
    await writeFile(join(root, 'job-a', '试卷.pdf'), 'legacy-history-do-not-touch')
    await expect(exportPaper(tools, 'job-a', exportFixture())).rejects.toThrow()
    expect(await readFile(join(root, 'job-a', '试卷.pdf'), 'utf8')).toBe('legacy-history-do-not-touch')
    expect((await readdir(join(root, 'job-a'))).filter((name) => /^[0-9a-f]{64}$/.test(name))).toEqual([])
    expect(await temps(join(root, 'job-a'))).toEqual([])
  })

  it('requires LibreOffice and a matching approved document hash before any output work', async () => {
    const { tools, runProcess } = fakeTools()
    await expect(exportPaper({ ...tools, soffice: undefined }, 'job-a', exportFixture())).rejects.toThrow('仅 DOCX')
    await expect(exportPaper(tools, 'job-a', exportFixture(), undefined, undefined, { expectedDocumentHash: '0'.repeat(64) })).rejects.toThrow('已批准版本')
    await expect(exportPaper(tools, '../escape', exportFixture())).rejects.toThrow('job id')
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('isolates first template creation and concurrent exports, including LibreOffice profiles', async () => {
    const { tools, calls } = fakeTools()
    const [a, b] = await Promise.all([exportPaper(tools, 'job-a', exportFixture()), exportPaper(tools, 'job-b', exportFixture())])
    expect(a.paperPdf).toBeDefined(); expect(b.paperPdf).toBeDefined()
    expect(calls.filter((call) => call.args.includes('--print-default-data-file'))).toHaveLength(1)
    const profiles = calls.filter((call) => call.command === 'soffice-test').map((call) => call.args.find((arg) => arg.startsWith('-env:UserInstallation=')))
    expect(new Set(profiles).size).toBe(2)
    expect(await temps(join(root, '_template'))).toEqual([])
    const [sameA, sameB] = await Promise.all([exportPaper(tools, 'job-a', exportFixture()), exportPaper(tools, 'job-a', exportFixture())])
    expect(sameA.contentHash).toBe(sameB.contentHash)
  })
})

describe('required figures and reviewed-byte identity', () => {
  it('uses input/content hashes rather than legacy ref filenames and never calls an image API', async () => {
    const { tools } = fakeTools()
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const dir = join(root, 'job-a'); await mkdir(dir)
    await writeFile(join(dir, 'fig-q1-diagram.png'), 'old/untrusted')
    const doc = exportFixture(true); const question = doc.sections[0]!.items[0]!
    const files = await generateFigures({ ...tools, imageApi: { baseURL: 'https://not-called.invalid', model: 'unused', apiKeyEnv: 'UNUSED' } }, doc, dir)
    expect(files.get('q1-diagram')).toBe(paperFigureFileName(question))
    expect(fetchMock).not.toHaveBeenCalled()
    const second = await generateFigures(tools, doc, dir)
    expect(second).toEqual(files)
    expect(tools.diagramRasterizer).toHaveBeenCalledTimes(1)
    const edited = { ...doc, sections: [{ ...doc.sections[0]!, items: [{ ...question, figure: { ...question.figure!, diagram: { ...simpleDiagram, primitives: simpleDiagram.primitives.map((p) => p.id === 'block' ? { ...p, width: 79 } : p) } } }] }] }
    const changed = await generateFigures(tools, edited, dir)
    expect(changed.get('q1-diagram')).not.toBe(files.get('q1-diagram'))
    expect(tools.diagramRasterizer).toHaveBeenCalledTimes(2)
  })

  it('reports missing specifications and raster failure explicitly, with no placeholder export', async () => {
    const { tools } = fakeTools()
    const doc = exportFixture(true); const question = doc.sections[0]!.items[0]!
    const legacy = { ...doc, sections: [{ ...doc.sections[0]!, items: [{ ...question, figure: { kind: 'line-diagram' as const, ref: 'legacy', caption: '画图指令' } }] }] }
    const failure = vi.fn()
    await expect(generateFigures(tools, legacy, join(root, 'job-a'), undefined, failure)).rejects.toThrow('diagram spec')
    expect(failure).toHaveBeenCalledWith('legacy', expect.stringContaining('diagram spec'))
    await expect(generateFigures(fakeTools({ failFigure: true }).tools, doc, join(root, 'job-b'), undefined, failure)).rejects.toThrow('raster failure')
    await expect(exportPaper(tools, 'job-c', legacy)).rejects.toThrow('必要题图')
  })

  it('binds exported image bytes to the exact reviewed spec and rejects byte replacement', async () => {
    const { tools } = fakeTools(); const doc = exportFixture(true); const question = doc.sections[0]!.items[0]!
    const name = paperFigureFileName(question)
    await generateFigures(tools, doc, join(root, 'job-a'))
    const sha = hash(await readFile(join(root, 'job-a', name)))
    const binding = { expectedDocumentHash: documentHash(doc), figureAssets: [{ questionNo: 1, inputHash: paperFigureInputHash(question), sha256: sha }] }
    const bundle = await exportPaper(tools, 'job-a', doc, undefined, undefined, binding)
    expect(bundle.manifest.assets[0]?.sha256).toBe(sha)
    expect(bundle.manifest.assets[0]?.inputHash).toBe(binding.figureAssets[0]?.inputHash)
    await expect(exportPaper(tools, 'job-a', doc, undefined, undefined, { ...binding, figureAssets: [{ ...binding.figureAssets[0]!, sha256: '0'.repeat(64) }] })).rejects.toThrow('审核字节不一致')
    await writeFile(join(root, 'job-a', name), 'replaced-root-cache')
    await expect(generateFigures(tools, doc, join(root, 'job-a'))).rejects.toThrow('缓存与摘要不符')
    expect(await readFile(join(root, 'job-a', bundle.manifest.assets[0]!.path))).toEqual(Buffer.from('PNG::controlled-spec'))
  })
})
