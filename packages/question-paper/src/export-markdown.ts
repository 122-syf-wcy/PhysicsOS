/**
 * Export rendering — PaperDocument → pandoc-ready Markdown.
 *
 * Two documents are produced from one approved version: the student paper
 * (no answers, no hints) and the answer/analysis document (answers, steps,
 * grading points, equivalents). Math stays in `$...$` so pandoc writes real
 * OMML equations into the .docx; page layout (A4, 18 mm margins, 12 pt)
 * lives in the Word reference document, not here.
 */

import { coefficientLabel, paperCoefficient } from './difficulty.ts'
import type { PaperDocument, PaperQuestion, SolveResult } from './paper.ts'
import { studentFigureCaption } from './print-diagram.ts'
import { wordAnswerSpace } from './print-layout.ts'

/** Section-order group the answer key needs for its own headings and rules. */
const questionsOf = (doc: PaperDocument): { title: string; note?: string; items: PaperQuestion[] }[] =>
  doc.sections.map((section) => ({ title: section.title, ...(section.note === undefined ? {} : { note: section.note }), items: [...section.items] }))

// Options join the stem paragraph as hard line breaks (trailing `\` is
// pandoc's escaped_line_breaks): a 4-space indent would become a code block
// and leak `$...$` literally.
const renderOptions = (question: PaperQuestion): string[] =>
  (question.options ?? []).map((option) => `${tex(option)} \\`)

/**
 * Normalize model-authored text for pandoc. A space before the closing `$`
 * defeats `tex_math_dollars` and the dollars print literally, so delimiters
 * hug their content; `____` blank runs become fullwidth low lines outside
 * math so they never parse as emphasis. Two OMML conversion traps are fixed
 * inside math: `^\circ\mathrm{C}` attaches its superscript to a space base
 * and prints as a missing-glyph box, so it becomes the `℃` character fonts
 * carry; and a blank run following `=$`/`+$`/… would leave the equation
 * with a dangling operator (a `¿` placeholder box), so the blanks move
 * inside as `\text{＿…}`.
 */
/**
 * Models write data tables as display-math `$$\begin{array}{|c|…|}…\end{array}$$`
 * blocks; pandoc's OMML writer cannot express `\hline`, so every rule and
 * empty cell prints as a `¿` placeholder and the grid dissolves into loose
 * text. Convert each block to a pipe table — a real bordered Word table —
 * before the inline-math pass touches anything else.
 */
/** The model supplies text data, never Markdown resources or raw writer code. */
const literalText = (text: string): string => text
  .replace(/_{2,}/g, (match) => '＿'.repeat(match.length))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\\/g, '\u0001')
  .replace(/&/g, '&amp;')
  .replace(/[<>]/g, (char) => char === '<' ? '&lt;' : '&gt;')
  .replace(/([`*_[\]{}!#|$])/g, '\\$1')
  .replace(/^\s*(?:(\d+)[.)]|([-+]))\s+/gm, (_match, number: string | undefined, bullet: string | undefined) => number === undefined ? `\\${bullet} ` : `${number}\\. `)
  .replace(/^ {4,}/gm, '')
  .replace(/\u0001/g, '&#92;')

const mathText = (text: string): string => {
  if (/\\(?:input|include(?:graphics)?|graphicspath|write\d*|open(?:in|out)|read|usepackage|documentclass|special|href|url|html(?:Class|Id|Style)?|def|gdef|newcommand|renewcommand|catcode|csname|directlua|verbatim(?:input)?|import|markdownInput)\b/i.test(text)) throw new Error('公式中不允许资源、文件或可执行 TeX 指令')
  return text
}
const arrayTables = (text: string): string =>
  text.replace(
    /\$\$?\s*\\begin\{array\}\{[^}]*\}([\s\S]*?)\\end\{array\}\s*\$\$?/g,
    (_m, body: string) => {
      const rows = body
        .split(/\\\\/)
        .map((row) =>
          row
            .replace(/\\hline|\\cline\{[^}]*\}|\\toprule|\\midrule|\\bottomrule/g, '')
            .split('&')
            .map((cell) => cell.trim()),
        )
        .filter((row) => row.some((cell) => cell !== ''))
      if (rows.length === 0) return ''
      const cell = (c: string): string => (/[\\^_]/.test(c) ? `$${mathText(c).replace(/\$/g, '').replace(/\|/g, '\\vert')}$` : literalText(c))
      const width = Math.max(...rows.map((row) => row.length))
      if (rows.length > 80 || width > 24) throw new Error('题面数据表超过排版限额')
      const line = (row: string[]): string =>
        `| ${[...row, ...Array<string>(width - row.length).fill('')].map(cell).join(' | ')} |`
      return `\n\n${line(rows[0]!)}\n| ${'--- | '.repeat(width).trimEnd()}\n${rows.slice(1).map(line).join('\n')}\n\n`
    },
  )

const tex = (text: string): string => {
  const tables: string[] = []
  const source = text.replace(/\u0000/g, '').replace(/\$\$?\s*\\begin\{array\}\{[^}]*\}[\s\S]*?\\end\{array\}\s*\$\$?/g, (match) => {
    tables.push(arrayTables(match))
    return `\u0000TABLE${tables.length - 1}\u0000`
  })
  const normalized = source
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/)
    .map((part, index) => {
      if (index % 2 === 0) return part.split(/(\u0000TABLE\d+\u0000)/).map((piece) => /^\u0000TABLE\d+\u0000$/.test(piece) ? piece : literalText(piece)).join('')
      const dollars = part.startsWith('$$') ? '$$' : '$'
      const inner = mathText(part.slice(dollars.length, -dollars.length).trim())
        .replace(/\\,?\s*\^\s*\{?\s*\\circ\s*\}?\s*\\mathrm\s*\{\s*C\s*\}/g, '\\ \\mathrm{℃}')
        .replace(/\\,?\s*\^\s*\{?\s*\\circ\s*\}?\s*C(?=\s*\})/g, '℃')
      return `${dollars}${inner}${dollars}`
    }).join('')
    .replace(/\$([^$]*?[+\-×÷=<>])\$(＿+)/g, (_match, math: string, blanks: string) => `$${math}\\text{${blanks}}$`)
  return normalized.replace(/\u0000TABLE(\d+)\u0000/g, (_match, index: string) => tables[Number(index)]!)
}
const headerText = (value: string): string => literalText(value.replace(/[\r\n]+/g, ' '))

/** Sub-question numbers arrive as `1`, `(1)`, or `（1）`; print one pair. */
const subNo = (no: string): string => no.replace(/^[（(]+|[)）]+$/g, '')

/**
 * This exporter supplies a question paper and answers, not a separate answer
 * sheet. Instructions and native Word writing space therefore use one
 * consistent, explicit on-paper mode.
 */

/**
 * Render the student-facing paper: header block, candidate fields, section
 * headings with scoring notes, numbered stems, option lines, sub-questions
 * and answer space. No answers or hints appear anywhere in this output.
 * @param doc - the approved document version.
 * @param figures - validated image files keyed by `figure.ref`, relative to
 *   the markdown's directory; a required missing image blocks export.
 * @returns pandoc Markdown for `试卷.docx`.
 */
export function renderPaperMarkdown(
  doc: PaperDocument,
  figures?: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [
    `% ${headerText(doc.title)}`,
    '',
    `**${headerText(doc.header.examName)}**\u3000${headerText(doc.header.grade)}\u3000${headerText(doc.header.subjectLine)}`,
    '',
    `满分：${doc.header.totalScore} 分\u3000\u3000考试时间：${doc.header.minutes} 分钟`,
    '',
    `${doc.header.candidateFields.map((field) => `${headerText(field)}\uff1a\uff3f\uff3f\uff3f\uff3f\uff3f\uff3f`).join('\u3000\u3000')}`,
    '',
    '**注意事项（卷内作答）：**',
    '',
    '1. 答题前，请在本试卷卷首填写姓名、班级及考号等信息。',
    '2. 选择题请将所选选项字母写在题号后的作答处；单选题只选一项，多选题按相应板块给分规则作答。',
    '3. 非选择题请在本试卷的空格或作答区内作答，作图题用铅笔规范作图；计算题须写出必要的公式、计算过程或文字说明。',
    '4. 考试结束后交回本试卷。本套文件不另附答题卡。',
    '',
  ]
  if (doc.policyLabel !== undefined) lines.push(tex(doc.policyLabel), '')

  for (const section of doc.sections) {
    const sectionScore = section.items.reduce((sum, q) => sum + q.score, 0)
    lines.push(
      `## ${headerText(section.title)}（本节共 ${section.items.length} 小题，满分 ${sectionScore} 分）`,
      '',
    )
    /* Plain paragraphs, not emphasis: CJK print has no italics, and the italic
       runs lose Latin digits in LibreOffice's headless font fallback. */
    if (section.note !== undefined) lines.push(tex(section.note), '')
    for (const question of section.items) {
      const choiceAnswer = question.kind === 'choice-single' || question.kind === 'choice-multi' ? '作答：＿＿＿＿　' : ''
      lines.push(`**${question.number}.**（${question.score} 分）${choiceAnswer}${tex(question.stem)}`, '')
      lines.push(...renderOptions(question), '')
      for (const sub of question.subQuestions ?? []) {
        lines.push(`\u3000（${headerText(subNo(sub.no))}）（${sub.score} 分）${tex(sub.text)}`, '')
      }
      if (question.figure !== undefined) {
        const caption = studentFigureCaption(question)
        const image = figures?.get(question.figure.ref)
        if (image === undefined) throw new Error(`第 ${question.number} 题必要题图未准备完成，不能导出图注占位`)
        if (!/^fig-[0-9a-f]{64}\.png$/.test(image)) throw new Error(`第 ${question.number} 题图片路径不是已验证的内容文件`)
        /* `implicit_figures` stays disabled: the neutral caption is ordinary
           text, never the internal drawing instruction (legacy caption). */
        lines.push(`![](${image}){width=55%}\n\n${caption}`, '')
      }
      lines.push(wordAnswerSpace(question))
    }
  }
  return lines.join('\n')
}

const KIND_LABEL: Record<string, string> = {
  'choice-single': '单选',
  'choice-multi': '多选',
  blank: '填空',
  drawing: '作图',
  'short-answer': '简答',
  experiment: '实验探究',
  calculation: '综合计算',
}
const DIFFICULTY_LABEL: Record<string, string> = { basic: '基础', medium: '中档', hard: '较难' }

/**
 * Render the answer/analysis document: per question the result, solution
 * steps, the grading-point breakdown, accepted equivalents, and the
 * provenance trail teachers need — the spec-table basis (考点/能力/难度)
 * plus the independent-solve verification outcome.
 * @param doc - the approved document version.
 * @param solves - independent-solve results keyed by question number;
 *   absent entries render as “未执行”.
 * @returns pandoc Markdown for `答案解析.docx`.
 */
export function renderAnswerMarkdown(doc: PaperDocument, solves?: readonly SolveResult[]): string {
  const verify = new Map((solves ?? []).map((s) => [s.questionNo, s]))
  const lines: string[] = [
    `% ${headerText(doc.title)} · 参考答案及解析`,
    '',
    '教师用参考答案及解析（不得随学生卷发放）',
    '',
    `整卷预估：${coefficientLabel(paperCoefficient(doc))}`,
    '',
  ]
  for (const section of questionsOf(doc)) {
    const sectionScore = section.items.reduce((sum, q) => sum + q.score, 0)
    lines.push(
      `## ${headerText(section.title)}（本节共 ${section.items.length} 小题，满分 ${sectionScore} 分）`,
      '',
    )
    if (section.note !== undefined) lines.push(tex(section.note), '')
    for (const question of section.items) {
      const answer = question.answer
      lines.push(
        `**${question.number}.（${question.score} 分）${KIND_LABEL[question.kind] ?? question.kind}**`,
        '',
      )
      lines.push(
        `命题依据：考点 ${headerText(question.knowledge.join('、') || '—')} ｜ 能力 ${headerText(question.ability)} ｜ 难度 ${headerText(DIFFICULTY_LABEL[question.difficulty] ?? question.difficulty)}`,
        '',
      )
      const solved = verify.get(question.number)
      lines.push(
        solved === undefined
          ? '二次验证：未执行'
          : solved.consistent
            ? `二次验证：独立解题一致${solved.note === undefined ? '' : `（${tex(solved.note)}）`}`
            : `二次验证：独立解题不一致——${tex(solved.solvedAnswer)}${solved.note === undefined ? '，经教研复核裁定' : `（${tex(solved.note)}）`}`,
        '',
      )
      if (answer === undefined) {
        lines.push('（本题暂无参考答案）', '')
        continue
      }
      lines.push(`**答案：**${tex(answer.result)}`, '')
      if (answer.steps.length > 0) {
        lines.push('**解析：**', '')
        for (const [index, step] of answer.steps.entries()) {
          lines.push(`${index + 1}. ${tex(step)}`)
        }
        lines.push('')
      }
      if (answer.gradingPoints.length > 0) {
        lines.push('**评分点：**', '')
        for (const point of answer.gradingPoints) {
          /* Models often embed the score inside `text`; skip the suffix then. */
          const text = /[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*$/.test(point.text)
            ? tex(point.text)
            : `${tex(point.text)}（${point.score} 分）`
          lines.push(`- ${text}`)
        }
        lines.push('')
      }
      if (answer.equivalents !== undefined && answer.equivalents.length > 0) {
        lines.push(`*等价表述：${answer.equivalents.map(tex).join('；')}*`, '')
      }
    }
  }
  return lines.join('\n')
}
