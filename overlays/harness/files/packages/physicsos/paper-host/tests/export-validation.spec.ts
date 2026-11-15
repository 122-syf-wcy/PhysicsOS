import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertA4PdfPage, inspectPdf, readExportFile } from '../src/export-validation.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'physicsos-validation-synthetic-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** A tiny synthetic PDF generator for parser failure tests, not a test oracle. */
function pdf(pages: readonly { width: number; height: number; content?: string }[]): Buffer {
  const bodies: string[] = []
  const pageIds = pages.map((_page, index) => 4 + index * 2)
  bodies.push('<< /Type /Catalog /Pages 2 0 R >>')
  bodies.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`)
  bodies.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((page, index) => {
    const content = page.content ?? 'BT /F1 12 Tf 40 100 Td (Synthetic physics paper text) Tj ET'
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index]! + 1} 0 R >>`)
    bodies.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  })
  let result = '%PDF-1.4\n'; const offsets: number[] = [0]
  bodies.forEach((body, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(result)
  result += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(result)
}

describe('real PDF byte/page validation', () => {
  it('parses actual synthetic PDF pages rather than trusting file names/exit status', async () => {
    const path = join(root, 'synthetic.pdf'); await writeFile(path, pdf([{ width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 }]))
    const validated = await inspectPdf(path)
    expect(validated.pageCount).toBe(2)
    expect(validated.text).toContain('Synthetic physics paper text')
    expect(validated.pages[1]?.number).toBe(2)
  })
  it('rejects a later Letter-sized page and empty/broken/truncated content', async () => {
    const mixed = join(root, 'mixed.pdf'); await writeFile(mixed, pdf([{ width: 595.28, height: 841.89 }, { width: 612, height: 792 }]))
    await expect(inspectPdf(mixed)).rejects.toThrow('第 2 页不是纵向 A4')
    const blank = join(root, 'blank.pdf'); await writeFile(blank, pdf([{ width: 595.28, height: 841.89, content: '' }]))
    await expect(inspectPdf(blank)).rejects.toThrow()
    const broken = join(root, 'broken.pdf'); await writeFile(broken, '%PDF-1.4\ninvalid\n%%EOF')
    await expect(inspectPdf(broken)).rejects.toThrow()
    await writeFile(broken, pdf([{ width: 595.28, height: 841.89 }]).subarray(0, 50))
    await expect(inspectPdf(broken)).rejects.toThrow('结束标记')
  })
  it('rejects symlinks, oversized files and nonfinite/landscape dimensions', async () => {
    const path = join(root, 'file'); await writeFile(path, 'synthetic')
    const link = join(root, 'link'); await symlink(path, link)
    await expect(readExportFile(link)).rejects.toThrow('链接')
    await expect(readExportFile(path, 2)).rejects.toThrow('字节限制')
    expect(() => assertA4PdfPage(595.28, 841.89, 1)).not.toThrow()
    expect(() => assertA4PdfPage(841.89, 595.28, 1)).toThrow()
    expect(() => assertA4PdfPage(Number.NaN, 841.89, 1)).toThrow()
  })
})
