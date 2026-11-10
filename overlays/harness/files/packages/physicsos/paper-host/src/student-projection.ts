/** Shared allowlisted student library fields; teacher audit and local paths never cross this projection. */
import type { BankItem, KnowledgeAnnotation, SourcePaper } from '@physicsos/question-paper'

export const safeSourceRef = (value: string): string => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch { return '' }
}
export const studentSource = (source: SourcePaper) => ({
  id: source.id, level: source.level, subject: source.subject, year: source.year,
  examName: source.examName, evidenceTier: source.evidenceTier, sourceRef: safeSourceRef(source.sourceRef),
  pageCount: source.pageCount, totalScore: source.totalScore, minutes: source.minutes,
  region: source.region, school: source.school, kind: source.kind, featured: source.featured,
  enteredBy: '', status: source.status, enteredAt: source.enteredAt,
})
export const studentAnnotation = (annotation: KnowledgeAnnotation) => ({
  id: annotation.id, sourcePaperId: annotation.sourcePaperId, pageNo: annotation.pageNo,
  questionNo: annotation.questionNo, subject: annotation.subject, kind: annotation.kind,
  score: annotation.score, knowledgePrimary: annotation.knowledgePrimary,
  knowledgeSecondary: annotation.knowledgeSecondary, ability: annotation.ability,
  experimentType: annotation.experimentType, chapter: annotation.chapter, stem: annotation.stem,
  answerSource: annotation.answerSource, reviewer: '', status: annotation.status,
})
export const studentBankItem = (item: BankItem) => ({
  id: item.id, level: item.level, subject: item.subject, kind: item.kind,
  knowledge: item.knowledge, ability: item.ability, difficulty: item.difficulty,
  chapter: item.chapter, score: item.score, stem: item.stem, options: item.options,
  subQuestions: item.subQuestions, figure: item.figure, answer: item.answer,
  answerTier: item.answerTier, anomalies: [], reuseModes: item.reuseModes, status: 'verified' as const,
})
