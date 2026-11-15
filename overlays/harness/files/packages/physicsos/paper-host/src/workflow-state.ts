/** Host-owned workflow metadata. Optional fields leave historical rows readable. */
import { createHash } from 'node:crypto'
import { documentHash, type CheckFinding, type ExamBlueprint, type PaperApproval,
  type PaperDocument, type PaperJob, type PaperQuestion, type ReviewRecord,
  type SolveResult } from '@physicsos/question-paper'

export type PaperOperationKind = 'draft' | 'check' | 'repair' | 'replace'
export type PaperOperationPhase = PaperOperationKind | 'figure'

export interface PaperOperation {
  readonly id: string
  readonly kind: PaperOperationKind
  readonly phase: PaperOperationPhase
  readonly state: 'running' | 'completed' | 'failed'
  readonly questionNo?: number
  readonly suggestion?: string
  readonly reviewer?: string
  readonly startedAt: string
  readonly updatedAt: string
}

/** A result may only land on the exact operation and content it read. */
export interface PaperOperationFence {
  readonly operationId: string
  readonly version: number
  readonly documentHash?: string
  readonly specHash: string
}

export interface BoundReviewRecord extends ReviewRecord {
  readonly documentHash?: string
  readonly questionHash?: string
  /** Hash of this question's check evidence, not unrelated questions' findings. */
  readonly checkHash?: string
  readonly acknowledgedFindings?: readonly string[]
  readonly analysisConfirmed?: boolean
}

export interface BoundSolveResult extends SolveResult {
  readonly questionHash?: string
  /** Original input when a verified engine result subsequently changed answer.result. */
  readonly inputQuestionHash?: string
}

export interface CheckedFigureAsset {
  readonly questionNo: number
  readonly questionHash: string
  readonly inputHash: string
  readonly path: string
  readonly sha256: string
}

export interface PaperCheckBinding {
  readonly documentHash: string
  readonly version: number
  readonly requestHash: string
  readonly specHash: string
  readonly reportHash: string
  readonly questionHashes: Readonly<Record<string, string>>
  readonly questionReports: Readonly<Record<string, string>>
  readonly completedAt: string
}

export interface AnswerCorrection {
  readonly questionNo: number
  readonly questionHash: string
  readonly originalResult: string
  readonly engineResult: string
  readonly at: string
}

export interface PaperPlanSummary {
  readonly requestedTotalScore: number
  readonly totalScore: number
  readonly questionCount: number
  readonly scorePolicy: 'blueprint-slot-sum'
  readonly normalized: boolean
  readonly sections: readonly { title: string; note?: string; questionCount: number; totalScore: number }[]
  readonly unassignedQuestionNos: readonly number[]
}

export interface ManagedPaperJob extends PaperJob {
  readonly rowVersion?: number
  readonly operation?: PaperOperation
  readonly checkBinding?: PaperCheckBinding
  readonly reviews: readonly BoundReviewRecord[]
  readonly solveReport: readonly BoundSolveResult[]
  readonly approval?: PaperApproval & { readonly checkHash?: string }
  readonly answerCorrections?: readonly AnswerCorrection[]
  readonly figureAssets?: readonly CheckedFigureAsset[]
  readonly selectedBlueprint?: ExamBlueprint
  readonly planSummary?: PaperPlanSummary
  readonly draftCheckpoint?: {
    readonly specHash: string
    readonly sections: readonly { title: string; items: readonly PaperQuestion[] }[]
  }
  /** Result checkpoint prevents retrying a paid single-question proposal after
   * a persistence/continuation failure. Bound to the input version and question. */
  readonly questionCheckpoint?: {
    readonly kind: 'repair' | 'replace'
    readonly questionNo: number
    readonly baseQuestionHash: string
    readonly suggestion?: string
    readonly item: PaperQuestion
    readonly bankItemId?: string
    readonly bankMode?: 'verbatim' | 'adapted'
  }
  /** One bounded recovery point, never an automatic replay of a paid call. */
  readonly recovery?: { readonly document: PaperDocument; readonly hash: string; readonly at: string }
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export const workflowHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')

/** Status and review notes are audit metadata, like question-paper's documentHash. */
export const questionContentHash = ({ status: _status, reviewNote: _note, ...content }: PaperQuestion): string =>
  workflowHash(content)

export const findingHash = (finding: CheckFinding): string => workflowHash(finding)

export const operationFence = (job: ManagedPaperJob): PaperOperationFence => ({
  operationId: job.operation?.id ?? '',
  version: job.versions.length,
  documentHash: job.document === undefined ? undefined : documentHash(job.document),
  specHash: workflowHash(job.specTable),
})

export const fenceMatches = (job: ManagedPaperJob, fence: PaperOperationFence): boolean =>
  job.operation?.id === fence.operationId && job.operation.state === 'running'
  && job.versions.length === fence.version && workflowHash(job.specTable) === fence.specHash
  && (job.document === undefined ? undefined : documentHash(job.document)) === fence.documentHash

export const currentChecks = (job: ManagedPaperJob): PaperCheckBinding | undefined => {
  const binding = job.checkBinding
  const version = job.versions.at(-1)
  if (job.document === undefined || binding === undefined || version === undefined
    || binding.version !== version.version || binding.documentHash !== version.hash
    || binding.documentHash !== documentHash(job.document)
    || binding.requestHash !== workflowHash(job.request) || binding.specHash !== workflowHash(job.specTable)) return undefined
  const questions = job.document.sections.flatMap(section => section.items)
  const numbers = new Set(questions.map(question => question.number))
  if (numbers.size !== questions.length || questions.length === 0
    || Object.keys(binding.questionHashes).length !== questions.length
    || Object.keys(binding.questionReports).length !== questions.length
    || job.solveReport.length !== questions.length) return undefined
  for (const question of questions) {
    const hash = questionContentHash(question)
    const results = job.solveReport.filter(result => result.questionNo === question.number)
    if (binding.questionHashes[String(question.number)] !== hash
      || results.length !== 1 || results[0]?.questionHash !== hash
      || binding.questionReports[String(question.number)] !== questionCheckHash(question, job.findings, results, job.figureAssets)) return undefined
    if (question.figure !== undefined && !(job.figureAssets ?? []).some(asset =>
      asset.questionNo === question.number && asset.questionHash === hash && asset.sha256 !== '')) return undefined
  }
  return binding.reportHash === checkReportHash(job.document, job.request, job.specTable,
    job.findings, job.solveReport, job.figureAssets) ? binding : undefined
}

export const questionCheckHash = (question: PaperQuestion, findings: readonly CheckFinding[],
  solve: readonly BoundSolveResult[], assets: readonly CheckedFigureAsset[] = []): string => workflowHash({
  questionHash: questionContentHash(question),
  findings: findings.filter(finding => finding.questionNo === question.number),
  solve: solve.filter(result => result.questionNo === question.number),
  assets: assets.filter(asset => asset.questionNo === question.number),
})

export const checkReportHash = (document: PaperDocument, request: PaperJob['request'],
  spec: PaperJob['specTable'], findings: readonly CheckFinding[], solve: readonly BoundSolveResult[],
  assets: readonly CheckedFigureAsset[] = []): string => workflowHash({
  documentHash: documentHash(document), request, spec, findings, solve, assets,
})

export const latestQuestionReview = (job: ManagedPaperJob, question: PaperQuestion,
  binding = currentChecks(job)): BoundReviewRecord | undefined => {
  const questionHash = questionContentHash(question)
  const record = [...job.reviews].reverse().find(review => review.questionNo === question.number
    && review.questionHash === questionHash)
  return binding !== undefined && record?.checkHash === binding.questionReports[String(question.number)] ? record : undefined
}

export const ANALYSIS_FINDING_PREFIX = '引擎已更正最终答案；原解析与评分点尚未复核'
export const needsAnalysisReview = (job: ManagedPaperJob, question: PaperQuestion): boolean =>
  (job.answerCorrections ?? []).some(correction => correction.questionNo === question.number
    && correction.questionHash === questionContentHash(question))

/** Physical judgments require an explicit, hash-bound reason; structural facts never waive. */
export const unresolvedFindings = (job: ManagedPaperJob, binding = currentChecks(job)): CheckFinding[] =>
  job.findings.filter((finding) => {
    if (finding.severity !== 'error') return false
    const question = job.document?.sections.flatMap(section => section.items)
      .find(item => item.number === finding.questionNo)
    if (question === undefined) return true
    const review = latestQuestionReview(job, question, binding)
    if (review?.verdict !== 'approved' || !review.note?.trim()
      || !review.acknowledgedFindings?.includes(findingHash(finding))) return true
    if (finding.detail.startsWith(ANALYSIS_FINDING_PREFIX)) return review.analysisConfirmed !== true
    return finding.code !== 'solve-mismatch' && finding.code !== 'engine-mismatch'
  })

/** Ignore wire/model-proposed approval flags, but keep genuine unchanged-content verdicts. */
export function invalidateDocument(job: ManagedPaperJob, document: PaperDocument): PaperDocument {
  const previous = new Map(job.document?.sections.flatMap(section => section.items)
    .map(question => [question.number, question]) ?? [])
  return {
    ...document,
    sections: document.sections.map(section => ({
      ...section,
      items: section.items.map((question) => {
        const before = previous.get(question.number)
        const unchanged = before !== undefined && questionContentHash(before) === questionContentHash(question)
        const review = unchanged ? [...job.reviews].reverse().find(record => record.questionNo === question.number
          && record.questionHash === questionContentHash(question)) : undefined
        return { ...question, status: review?.verdict === 'approved' ? 'approved' as const
          : review?.verdict === 'changes-requested' ? 'rejected' as const : 'draft' as const,
        reviewNote: review?.note }
      }),
    })),
  }
}
