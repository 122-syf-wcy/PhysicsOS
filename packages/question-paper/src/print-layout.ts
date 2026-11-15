/** Real Word layout, not raw TeX that the DOCX writer silently discards. */
import type { PaperQuestion } from './paper.ts'

export const PAPER_PRINT_LAYOUT_VERSION = 'paper-a4-inline-answer-v1'
export const A4_PAGE_TWIPS = { width: 11906, height: 16838, margin: 1021 } as const
/** Rounded A4 media size: allow only the conversion's twip rounding noise. */
export const A4_PAGE_POINTS = { width: 595.28, height: 841.89, tolerance: 0.5 } as const

/** A DOCX-native page break that Pandoc passes through as Open XML. */
export const wordPageBreak = (): string => '\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n'

/**
 * Empty, exact-height Word paragraphs reserve actual printable writing space.
 * They remain individual paragraphs so LibreOffice can paginate a long answer
 * instead of losing a single large TeX skip or producing an overflowing row.
 */
export function wordAnswerSpace(question: Pick<PaperQuestion, 'kind' | 'subQuestions'>): string {
  const rows = question.kind === 'drawing' ? 5
    : question.kind === 'short-answer' ? 3
      : question.kind === 'experiment' ? 5
        : question.kind === 'calculation' ? 7 : 0
  if (rows === 0) return ''
  const count = Math.max(rows, Math.min(10, (question.subQuestions?.length ?? 0) * 2))
  const blank = '<w:p><w:pPr><w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'
  return `作答区（在本卷作答，计算题须写出必要过程）：\n\n\`\`\`{=openxml}\n${blank.repeat(count)}\n\`\`\`\n`
}
