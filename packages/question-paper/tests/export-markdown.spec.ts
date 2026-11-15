import { describe, expect, it } from 'vitest'
import { renderAnswerMarkdown, renderPaperMarkdown } from '../src/export-markdown.ts'
import { wordAnswerSpace } from '../src/print-layout.ts'
import type { PaperDocument, PaperQuestion } from '../src/paper.ts'
import type { DiagramPaperFigure } from '../src/print-diagram.ts'

const figure: DiagramPaperFigure = { kind: 'line-diagram', ref: 'f', caption: '内部指令：画出竖直向上的支持力 N，并标出正确答案', studentCaption: '示意图', diagram: { schemaVersion: 1, viewBox: { x: 0, y: 0, width: 120, height: 80 }, scale: 'schematic', primitives: [{ id: 'block', role: 'given', type: 'rectangle', x: 20, y: 20, width: 60, height: 40 }] } }
const item: PaperQuestion = { number: 1, subject: 'physics', kind: 'calculation', score: 8, stem: '如图，求物块受到的支持力 $N$。质量为 $m$。', figure, knowledge: ['力的平衡'], ability: '应用', difficulty: 'basic', status: 'approved', answer: { result: 'ANSWERS-ONLY-SENTINEL', steps: ['TEACHER-ONLY-STEP $N=mg$'], gradingPoints: [{ text: 'TEACHER-ONLY-RUBRIC', score: 8 }] } }
const doc: PaperDocument = { id: 'synthetic-print', title: '合成打印验收卷', level: 'zhongkao', kind: 'unit', header: { examName: '合成训练', grade: '八年级', subjectLine: '物理', totalScore: 8, minutes: 30, candidateFields: ['姓名', '班级'] }, sections: [{ title: '一、计算题', note: '须写出必要的公式和计算过程，只写结果不得分。', items: [item] }], specTable: [{ questionNo: 1, sectionTitle: '一、计算题', kind: 'calculation', score: 8, knowledge: ['力的平衡'], ability: '应用', difficulty: 'basic' }] }
const files = new Map([['f', `fig-${'a'.repeat(64)}.png`]])

describe('Word-ready student and teacher exports', () => {
  it('prints an explicit on-paper mode, real Word answer space, safe labels and section rules', () => {
    const markdown = renderPaperMarkdown(doc, files)
    expect(markdown).toContain('注意事项（卷内作答）')
    expect(markdown).toContain('姓名：＿＿＿＿＿＿')
    expect(markdown).toContain('班级：＿＿＿＿＿＿')
    expect(markdown).not.toContain('写在本试卷上无效')
    expect(markdown).toContain('作答区（在本卷作答')
    expect(markdown).toContain('```{=openxml}')
    expect(markdown).toContain('w:line="360" w:lineRule="exact"')
    expect(markdown).not.toContain('\\vspace')
    expect(markdown).toContain('只写结果不得分')
    expect(markdown).toContain('图 1 · 示意图（示意图，非比例绘制）')
    expect(markdown).not.toContain('内部指令')
    expect(markdown).not.toContain('竖直向上')
    expect(markdown).not.toContain('ANSWERS-ONLY-SENTINEL')
    expect(markdown).not.toContain('TEACHER-ONLY')
    expect(markdown).toContain('$N$')
  })

  it('blocks a missing/unsafe image instead of printing a placeholder or external path', () => {
    expect(() => renderPaperMarkdown(doc)).toThrow('不能导出图注占位')
    expect(() => renderPaperMarkdown(doc, new Map([['f', 'https://untrusted.example/a.png']]))).toThrow('已验证的内容文件')
    expect(() => renderPaperMarkdown(doc, new Map([['f', '../secret.png']]))).toThrow('已验证的内容文件')
  })

  it('keeps the answer key separate, without forcing a mostly empty cover page', () => {
    const markdown = renderAnswerMarkdown(doc)
    expect(markdown).toContain('ANSWERS-ONLY-SENTINEL')
    expect(markdown).toContain('TEACHER-ONLY-RUBRIC')
    expect(markdown).toContain('只写结果不得分')
    expect(markdown).not.toContain('w:br w:type="page"')
    expect(markdown).not.toContain('\\newpage')
    expect(markdown).not.toContain('内部指令')
    expect(markdown).not.toContain('作答区（在本卷作答')
  })

  it('treats body/header/answer resource syntax as literal data, never a renderer path', () => {
    const resourceText = '![image](file:///not-a-real-file.png) [link](https://not-requested.invalid/) <img src="http://not-requested.invalid/p.png"> ```{=openxml} <w:altChunk/> ``` \\includegraphics{/not-a-real-file}'
    const data = { ...doc, title: resourceText, header: { ...doc.header, examName: resourceText, candidateFields: [resourceText] }, sections: [{ ...doc.sections[0]!, note: resourceText, items: [{ ...item, stem: `${resourceText} 合法公式 $F=ma$`, options: [resourceText], answer: { result: resourceText, steps: [resourceText], gradingPoints: [{ text: resourceText, score: 8 }] } }] }] }
    const paper = renderPaperMarkdown(data, files)
    const answers = renderAnswerMarkdown(data)
    for (const markdown of [paper, answers]) {
      expect(markdown).not.toContain('![image](')
      expect(markdown).not.toContain('[link](')
      expect(markdown).not.toContain('<img')
      expect(markdown).not.toContain('<w:altChunk')
      expect(markdown).not.toContain('\\includegraphics')
      expect(markdown).toContain('&lt;img')
    }
    expect(paper).toContain('$F=ma$')
    const unmatched = renderPaperMarkdown({ ...data, sections: [{ ...data.sections[0]!, items: [{ ...data.sections[0]!.items[0]!, stem: '$unclosed\n' + resourceText }] }] }, files)
    expect(unmatched).not.toContain('![image](')
    expect(unmatched).not.toContain('<img')
    expect((paper.match(/!\[\]\(fig-[a-f0-9]{64}\.png\)/g) ?? [])).toHaveLength(1)
    expect(() => renderPaperMarkdown({ ...doc, sections: [{ ...doc.sections[0]!, items: [{ ...item, stem: '$\\input{/not-a-real-file}$' }] }] }, files)).toThrow('可执行 TeX 指令')
  })

  it('reserves actual paragraphs for drawings, short answers, experiments and calculations only', () => {
    expect(wordAnswerSpace({ kind: 'drawing' }).match(/<w:p>/g)).toHaveLength(5)
    expect(wordAnswerSpace({ kind: 'short-answer' }).match(/<w:p>/g)).toHaveLength(3)
    expect(wordAnswerSpace({ kind: 'experiment' }).match(/<w:p>/g)).toHaveLength(5)
    expect(wordAnswerSpace({ kind: 'calculation' }).match(/<w:p>/g)).toHaveLength(7)
    expect(wordAnswerSpace({ kind: 'choice-single' })).toBe('')
    expect(wordAnswerSpace({ kind: 'blank' })).toBe('')
  })
})
