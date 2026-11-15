/** Synthetic data only: no bank entry, source exam, student or provider call. */
import type { PaperDocument, PaperQuestion } from '@physicsos/question-paper'
import type { DiagramPaperFigure, PaperDiagramSpec } from '@physicsos/question-paper'

export const simpleDiagram: PaperDiagramSpec = { schemaVersion: 1, viewBox: { x: 0, y: 0, width: 240, height: 160 }, scale: 'schematic', primitives: [
  { id: 'block', role: 'given', type: 'rectangle', x: 70, y: 50, width: 80, height: 45 },
  { id: 'floor', role: 'given', type: 'line', points: [[35, 50], [195, 50]] },
  { id: 'known-name', role: 'given', type: 'text', x: 110, y: 110, text: '物块', fontSize: 12 },
  { id: 'answer-force', role: 'solution', type: 'arrow', points: [[110, 70], [110, 140]] },
] }
export function exportFixture(withFigure = false, count = 1): PaperDocument {
  const figure: DiagramPaperFigure = { kind: 'line-diagram', ref: 'q1-diagram', studentCaption: '示意图', caption: 'INTERNALDRAWINGONLYSUPPORTFORCEUP', diagram: simpleDiagram }
  const items: PaperQuestion[] = Array.from({ length: count }, (_, index) => ({ number: index + 1, subject: 'physics', kind: 'calculation', score: 8,
    stem: String.raw`${index === 0 && withFigure ? '如图，' : ''}这是独立合成的打印验收题 ${index + 1}。给定质量 $m=2\ \mathrm{kg}$，取 $g=10\ \mathrm{m/s^2}$，写出物块重力的计算过程。中文与公式应均可打印。`,
    ...(index === 0 && withFigure ? { figure } : {}),
    knowledge: ['重力'], ability: '应用', difficulty: 'basic', status: 'approved',
    answer: { result: 'TEACHERANSWERONLY20N', steps: [String.raw`$G=mg=20\ \mathrm{N}$。`, 'TEACHERONLYANALYSISSENTINEL'], gradingPoints: [{ text: '正确公式', score: 4 }, { text: '正确代入与单位', score: 4 }] },
  }))
  return { id: 'synthetic-export-paper', title: '合成 A4 打印验收卷', level: 'zhongkao', kind: 'unit',
    header: { examName: '合成物理训练（不是真实考试）', grade: '八年级', subjectLine: '物理', totalScore: count * 8, minutes: 30, candidateFields: ['姓名', '班级', '考号'] },
    sections: [{ title: '一、综合应用题', note: '要求写出必要的公式、计算过程或文字说明，只写结果不得分。', items }],
    specTable: items.map((question) => ({ questionNo: question.number, sectionTitle: '一、综合应用题', kind: question.kind, score: question.score, knowledge: question.knowledge, ability: question.ability, difficulty: question.difficulty })),
    policyLabel: '仅用于合成输出验收，不使用真实学生试题',
  }
}
