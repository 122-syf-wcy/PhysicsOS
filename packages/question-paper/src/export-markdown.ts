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

/** Section-order group the answer key needs for its own headings. */
const questionsOf = (doc: PaperDocument): { title: string; items: PaperQuestion[] }[] =>
  doc.sections.map(section => ({ title: section.title, items: [...section.items] }))

// Options join the stem paragraph as hard line breaks (trailing `\` is
// pandoc's escaped_line_breaks): a 4-space indent would become a code block
// and leak `$...$` literally.
const renderOptions = (question: PaperQuestion): string[] =>
  (question.options ?? []).map(option => `${tex(option)} \\`)

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
const arrayTables = (text: string): string =>
  text.replace(/\$\$?\s*\\begin\{array\}\{[^}]*\}([\s\S]*?)\\end\{array\}\s*\$\$?/g, (_m, body: string) => {
    const rows = body.split(/\\\\/).map(row =>
      row.replace(/\\hline|\\cline\{[^}]*\}|\\toprule|\\midrule|\\bottomrule/g, '')
        .split('&').map(cell => cell.trim()))
      .filter(row => row.some(cell => cell !== ''))
    if (rows.length === 0) return ''
    const cell = (c: string): string => /[\\^_]/.test(c) ? `$${c}$` : c
    const width = Math.max(...rows.map(row => row.length))
    const line = (row: string[]): string =>
      `| ${[...row, ...Array<string>(width - row.length).fill('')].map(cell).join(' | ')} |`
    return `\n\n${line(rows[0]!)}\n| ${'--- | '.repeat(width).trimEnd()}\n${rows.slice(1).map(line).join('\n')}\n\n`
  })

const tex = (text: string): string =>
  arrayTables(text).split(/(\$[^$]*\$)/).map(part => {
    if (!part.startsWith('$'))
      return part.replace(/_{2,}/g, m => '＿'.repeat(m.length))
    const inner = part.slice(1, -1).trim()
      .replace(/\\,?\s*\^\s*\{?\s*\\circ\s*\}?\s*\\mathrm\s*\{\s*C\s*\}/g, '\\ \\mathrm{℃}')
      .replace(/\\,?\s*\^\s*\{?\s*\\circ\s*\}?\s*C(?=\s*\})/g, '℃')
    return `$${inner}$`
  }).join('')
    .replace(/\$([^$]*?[+\-×÷=<>])\$(＿+)/g, (_m, math: string, blanks: string) =>
      `$${math}\\text{${blanks}}$`)

/** Sub-question numbers arrive as `1`, `(1)`, or `（1）`; print one pair. */
const subNo = (no: string): string => no.replace(/^[（(]+|[)）]+$/g, '')

/** Space a question reserves for on-paper answering, by kind. */
const answerSpace = (question: PaperQuestion): string => {
  switch (question.kind) {
    case 'short-answer': return '\n\\vspace{2.2cm}\n'
    case 'experiment': return '\n\\vspace{3.5cm}\n'
    case 'calculation': return '\n\\vspace{4.5cm}\n'
    default: return ''
  }
}

/**
 * Render the student-facing paper: header block, candidate fields, section
 * headings with scoring notes, numbered stems, option lines, sub-questions
 * and answer space. No answers or hints appear anywhere in this output.
 * @param doc - the approved document version.
 * @param figures - generated image files keyed by `figure.ref`, relative to
 *   the markdown's directory; refs without an image print as captions.
 * @returns pandoc Markdown for `试卷.docx`.
 */
export function renderPaperMarkdown(doc: PaperDocument, figures?: ReadonlyMap<string, string>): string {
  const lines: string[] = [
    `% ${doc.title}`,
    '',
    `**${doc.header.examName}**\u3000${doc.header.grade}\u3000${doc.header.subjectLine}`,
    '',
    `满分：${doc.header.totalScore} 分\u3000\u3000考试时间：${doc.header.minutes} 分钟`,
    '',
    `${doc.header.candidateFields.join('\u3000\u3000')}：____________`,
    '',
    '**注意事项：**',
    '',
    '1. 答题前，考生务必将自己的姓名、准考证号填写在答题卡上。',
    '2. 回答选择题时，选出每小题正确选项后，用铅笔把答题卡上对应题目的选项标号涂黑；如需改动，用橡皮擦干净后，再选涂其他标号。',
    '3. 回答非选择题时，将作答写在答题卡上，写在本试卷上无效。',
    '4. 考试结束后，将本试卷和答题卡一并交回。',
    '',
  ]
  if (doc.policyLabel !== undefined) lines.push(doc.policyLabel, '')

  for (const section of doc.sections) {
    const sectionScore = section.items.reduce((sum, q) => sum + q.score, 0)
    lines.push(`## ${section.title}（本题共 ${section.items.length} 小题，满分 ${sectionScore} 分）`, '')
    /* Plain paragraphs, not emphasis: CJK print has no italics, and the italic
       runs lose Latin digits in LibreOffice's headless font fallback. */
    if (section.note !== undefined) lines.push(tex(section.note), '')
    for (const question of section.items) {
      lines.push(`**${question.number}.**（${question.score} 分）${tex(question.stem)}`, '')
      lines.push(...renderOptions(question), '')
      for (const sub of question.subQuestions ?? []) {
        lines.push(`\u3000（${subNo(sub.no)}）（${sub.score} 分）${tex(sub.text)}`, '')
      }
      if (question.figure !== undefined) {
        const caption = tex(question.figure.caption ?? question.figure.ref)
        const image = figures?.get(question.figure.ref)
        /* `implicit_figures` is disabled in the pandoc flags: its italic
           caption style drops digits in headless PDF export. The caption
           prints as an ordinary paragraph instead. */
        lines.push(image === undefined
          ? `[题图：${caption}]`
          : `![](${image}){width=55%}\n\n题图：${caption}`, '')
      }
      lines.push(answerSpace(question))
    }
  }
  return lines.join('\n')
}

const KIND_LABEL: Record<string, string> = {
  'choice-single': '单选', 'choice-multi': '多选', blank: '填空',
  drawing: '作图', 'short-answer': '简答', experiment: '实验探究', calculation: '综合计算',
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
  const verify = new Map((solves ?? []).map(s => [s.questionNo, s]))
  const lines: string[] = [
    `% ${doc.title} · 参考答案及解析`,
    '',
    `整卷预估：${coefficientLabel(paperCoefficient(doc))}`,
    '',
  ]
  for (const section of questionsOf(doc)) {
    const sectionScore = section.items.reduce((sum, q) => sum + q.score, 0)
    lines.push(`## ${section.title}（本题共 ${section.items.length} 小题，满分 ${sectionScore} 分）`, '')
    for (const question of section.items) {
      const answer = question.answer
      lines.push(`**${question.number}.（${question.score} 分）${KIND_LABEL[question.kind] ?? question.kind}**`, '')
      lines.push(`命题依据：考点 ${question.knowledge.join('、') || '—'} ｜ 能力 ${question.ability} ｜ 难度 ${DIFFICULTY_LABEL[question.difficulty] ?? question.difficulty}`, '')
      const solved = verify.get(question.number)
      lines.push(solved === undefined
        ? '二次验证：未执行'
        : solved.consistent
          ? `二次验证：独立解题一致${solved.note === undefined ? '' : `（${tex(solved.note)}）`}`
          : `二次验证：独立解题不一致——${tex(solved.solvedAnswer)}${solved.note === undefined ? '，经教研复核裁定' : `（${tex(solved.note)}）`}`, '')
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
