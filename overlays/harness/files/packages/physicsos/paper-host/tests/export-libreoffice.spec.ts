import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { documentHash, paperFigureFileName, paperFigureInputHash } from '@physicsos/question-paper'
import { exportPaper, generateFigures, type ExportTools } from '../src/export.ts'
import { inspectDocx, inspectPdf } from '../src/export-validation.ts'
import { exportFixture } from './export-fixture.ts'
import { createHash } from 'node:crypto'

/**
 * Run ONLY in the server candidate/test container. No skip-to-success if the
 * flag is set but a tool/native dependency is absent: the real export fails.
 * PHYSICSOS_REAL_PRINT_TESTS=1 pnpm exec vitest run \
 *   packages/physicsos/paper-host/tests/export-libreoffice.spec.ts
 * Optional PHYSICSOS_PRINT_TEST_OUTPUT preserves ONLY this mkdtemp fixture
 * output for PDF/screenshot review; never points to production exports.
 */
const real = process.env.PHYSICSOS_REAL_PRINT_TESTS === '1' && process.platform === 'linux'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
describe.runIf(real)('real Pandoc/LibreOffice A4 output regression', () => {
  it('creates four real valid files with Chinese/OMML/Word answer space and no student answer/instruction leakage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physicsos-real-print-'))
    try {
      const tools: ExportTools = { exportDir: root, pandoc: process.env.PHYSICSOS_PANDOC ?? '/usr/bin/pandoc', soffice: process.env.PHYSICSOS_SOFFICE ?? '/usr/bin/soffice' }
      const doc = exportFixture(true, 10)
      const questions = doc.sections[0]!.items
      const figs = await generateFigures(tools, doc, join(root, 'synthetic-only'))
      const figureQuestion = questions[0]!
      const figureName = figs.get(figureQuestion.figure!.ref)!
      expect(figureName).toBe(paperFigureFileName(figureQuestion))
      const bundle = await exportPaper(tools, 'synthetic-only', doc, undefined, undefined, { version: 1, expectedDocumentHash: documentHash(doc), figureAssets: [{ questionNo: 1, inputHash: paperFigureInputHash(figureQuestion), sha256: sha(await readFile(join(root, 'synthetic-only', figureName))) }] })
      const paperDocx = await inspectDocx(join(root, 'synthetic-only', bundle.paperDocx))
      const answerDocx = await inspectDocx(join(root, 'synthetic-only', bundle.answerDocx))
      expect(paperDocx.documentXml).toContain('11906')
      expect(paperDocx.documentXml).toContain('16838')
      expect(paperDocx.documentXml).toContain('w:line="360"')
      expect(paperDocx.documentXml).toContain('<m:oMath')
      expect(paperDocx.entries.some((name) => name.startsWith('word/media/'))).toBe(true)
      expect(paperDocx.documentXml).not.toContain('INTERNALDRAWINGONLY')
      expect(paperDocx.documentXml).not.toContain('TEACHERANSWERONLY')
      expect(paperDocx.documentXml).not.toContain('answer-force')
      expect(answerDocx.documentXml).not.toContain('w:br w:type="page"')
      const ommlText = (xml: string): string => [...xml.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)].map((match) => match[1]!).join('').replace(/\s+/g, '')
      expect(ommlText(paperDocx.documentXml)).toContain('m=2kg')
      expect(ommlText(paperDocx.documentXml)).toContain('g=10m/s2')
      expect(ommlText(answerDocx.documentXml)).toContain('G=mg=20N')
      const paper = await inspectPdf(join(root, 'synthetic-only', bundle.paperPdf), { proveTextInk: true })
      const answers = await inspectPdf(join(root, 'synthetic-only', bundle.answerPdf), { proveTextInk: true })
      expect(paper.pageCount).toBeGreaterThan(1)
      for (const file of [paper, answers]) for (const page of file.pages) {
        expect(page.width).toBeCloseTo(595.28, 0)
        expect(page.height).toBeCloseTo(841.89, 0)
      }
      const paperText = paper.text.replace(/\s+/g, '')
      const answerText = answers.text.replace(/\s+/g, '')
      expect(paperText).toContain('合成')
      expect(paperText).toContain('卷内作答')
      expect(paperText).toContain('作答区')
      expect(paperText).not.toContain('TEACHERANSWERONLY')
      expect(paperText).not.toContain('INTERNALDRAWINGONLY')
      expect(answerText).toContain('TEACHERANSWERONLY20N')
      expect(answerText).toContain('参考答案')
      /* The previous OMML-tag check passed when Writer omitted every formula
         in PDF. Require the original symbols/values/units for each question,
         and nonwhite rendered pixels inside their actual text-run boxes. */
      const compact = (value: string): string => value.normalize('NFKC').replace(/[\s​⁠]/g, '')
      const assertVisibleFormula = (inspection: typeof paper, formula: string, expected: number): void => {
        const runs = inspection.textProofs.filter((proof) => compact(proof.text) !== '')
        const text = runs.map((proof) => compact(proof.text)).join('')
        let start = 0; let found = 0
        while ((start = text.indexOf(formula, start)) >= 0) {
          let offset = 0
          const matched = runs.filter((proof) => { const end = offset + compact(proof.text).length; const overlaps = offset < start + formula.length && end > start; offset = end; return overlaps })
          expect(matched.length).toBeGreaterThan(0)
          for (const proof of matched) expect(proof.inkPixels, `formula ${formula} must be visible on page ${proof.page}`).toBeGreaterThan(0)
          found++; start += formula.length
        }
        expect(found, `actual PDF must retain all ${expected} copies of ${formula}`).toBe(expected)
      }
      assertVisibleFormula(paper, 'm=2kg', questions.length)
      assertVisibleFormula(paper, 'g=10m/s2', questions.length)
      assertVisibleFormula(answers, 'G=mg=20N', questions.length)
      const firstAnswerPage = compact(answers.textProofs.filter((proof) => proof.page === 1).map((proof) => proof.text).join(''))
      expect(firstAnswerPage).toContain('1.(8分)')
      expect(firstAnswerPage).toContain('G=mg=20N')
      for (const digest of [...Object.values(bundle.manifest.files), ...bundle.manifest.assets, ...bundle.manifest.inputs]) expect(sha(await readFile(join(root, 'synthetic-only', digest.path)))).toBe(digest.sha256)
      const original = await readFile(join(root, 'synthetic-only', bundle.paperPdf))
      const revised = await exportPaper(tools, 'synthetic-only', { ...doc, title: '合成 A4 修订卷' })
      expect(revised.paperPdf).not.toBe(bundle.paperPdf)
      expect(await readFile(join(root, 'synthetic-only', bundle.paperPdf))).toEqual(original)
      if (process.env.PHYSICSOS_PRINT_TEST_OUTPUT === '1') console.info(`Synthetic print evidence: ${root}`)
    } finally {
      if (process.env.PHYSICSOS_PRINT_TEST_OUTPUT !== '1') await rm(root, { recursive: true, force: true })
    }
  }, 600_000)
})
