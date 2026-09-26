/**
 * Storage-domain spec for the 出卷专区 — one `physicsos_paper` unit over the
 * JSON backend with a table per pipeline stage: entered source papers, their
 * per-question annotations, verified structure templates, paper jobs, and
 * produced export bundles. Schemas here are the durable-boundary mirror of
 * `@physicsos/question-paper`'s types; widening happens in the model package
 * first, then here.
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { CHECK_CODES } from '@physicsos/question-paper'
import type {
  BankItem, BankUsage, ExamBlueprint, ExportBundle, KnowledgeAnnotation, PaperJob, SourcePaper,
} from '@physicsos/question-paper'

const level = z.enum(['zhongkao', 'gaokao'])
const subject = z.enum(['physics', 'chemistry'])
const kind = z.enum(['unit', 'weekly', 'monthly', 'midterm', 'final', 'mock'])
const questionKind = z.enum([
  'choice-single', 'choice-multi', 'blank', 'drawing', 'short-answer', 'experiment', 'calculation',
])
const evidenceTier = z.enum([
  'policy', 'original-scan', 'manual-transcript', 'institution-analysis', 'web-public', 'recalled',
])
const reviewStatus = z.enum(['pending', 'verified', 'rejected'])
const ability = z.enum(['识记', '理解', '应用', '分析', '探究'])
const difficulty = z.enum(['basic', 'medium', 'hard'])

const sourcePaperKind = z.enum(['real', 'mock', 'monthly', 'midterm', 'final', 'joint'])

/** Source-paper fields the wire caller supplies; service stamps the rest. */
const sourcePaperInput = {
  id: z.string().min(1),
  level,
  subject: z.union([subject, z.literal('combined')]),
  year: z.number().int().min(2000),
  examName: z.string().min(1),
  evidenceTier,
  sourceRef: z.string().min(1),
  pageCount: z.number().int().positive().optional(),
  totalScore: z.number().positive().optional(),
  minutes: z.number().positive().optional(),
  region: z.string().optional(),
  school: z.string().optional(),
  kind: sourcePaperKind.optional(),
  featured: z.boolean().optional(),
  enteredBy: z.string().min(1),
  note: z.string().optional(),
}

/** Wire validator for `POST /sources` — rejects before the domain write. */
export const sourcePaperWire = z.object(sourcePaperInput)

const sourcePaper = z.object({
  ...sourcePaperInput,
  schoolId: z.string().nullable().optional(),
  status: reviewStatus,
  enteredAt: z.string().min(1),
}) satisfies z.ZodType<SourcePaper>

/** Annotation fields the wire caller supplies; `status` starts `pending`. */
const annotationInput = {
  id: z.string().min(1),
  sourcePaperId: z.string().min(1),
  pageNo: z.number().int().positive().optional(),
  questionNo: z.string().min(1),
  subject,
  kind: questionKind,
  score: z.number().positive(),
  knowledgePrimary: z.string().min(1),
  knowledgeSecondary: z.array(z.string()),
  ability,
  experimentType: z.string().optional(),
  chapter: z.string().optional(),
  stem: z.string().optional(),
  answerSource: evidenceTier,
  reviewer: z.string().min(1),
}

/** Wire validator for `POST /sources/:id/annotations`. */
export const annotationWire = z.object(annotationInput)

const annotation = z.object({
  ...annotationInput,
  schoolId: z.string().nullable().optional(),
  status: reviewStatus,
}) satisfies z.ZodType<KnowledgeAnnotation>

const blueprint = z.object({
  id: z.string().min(1),
  schoolId: z.string().nullable().optional(),
  level,
  subject,
  title: z.string().min(1),
  totalScore: z.number().positive(),
  minutes: z.number().positive(),
  sections: z.array(z.object({
    title: z.string().min(1),
    note: z.string().optional(),
    slots: z.array(z.object({
      kind: questionKind,
      score: z.number().positive(),
      knowledgeHint: z.string().optional(),
    })),
  })),
  basedOn: z.array(z.string()),
  status: reviewStatus,
  policyLabel: z.string().optional(),
}) satisfies z.ZodType<ExamBlueprint>

/** Wire validator for `POST /blueprints` — `status` starts `pending`. */
export const blueprintWire = blueprint.omit({ status: true, schoolId: true })

/** Wire validator for `PUT /jobs/:id/spec` — the confirmed 双向细目表. */
const specRow = z.object({
  questionNo: z.number().int().positive(),
  sectionTitle: z.string(),
  kind: questionKind,
  score: z.number().positive(),
  knowledge: z.array(z.string()),
  ability,
  difficulty,
  chapter: z.string().optional(),
})

const paperRequest = z.object({
  level,
  subjects: z.array(subject).min(1),
  kind,
  totalScore: z.number().positive(),
  minutes: z.number().positive(),
  chapters: z.array(z.string()),
  exclude: z.array(z.string()),
  difficulty: z.object({
    basic: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    hard: z.number().min(0).max(1),
  }).refine(mix => Math.abs(mix.basic + mix.medium + mix.hard - 1) < 0.001, {
    message: 'difficulty mix must sum to 1',
  }),
  targetYear: z.number().int(),
  textbook: z.string(),
})

const gradingPoint = z.object({ text: z.string(), score: z.number() })

const paperAnswer = z.object({
  result: z.string(),
  steps: z.array(z.string()),
  gradingPoints: z.array(gradingPoint),
  equivalents: z.array(z.string()).optional(),
})

/** Draft-stage question schema — the shape the drafting model must emit. */
export const paperQuestionSchema = z.object({
  number: z.number().int().positive(),
  subject,
  kind: questionKind,
  score: z.number().positive(),
  stem: z.string().min(1),
  options: z.array(z.string()).optional(),
  subQuestions: z.array(z.object({
    no: z.string(), text: z.string(), score: z.number(),
  })).optional(),
  figure: z.object({
    kind: z.enum(['line-diagram', 'image']),
    ref: z.string(),
    caption: z.string().optional(),
  }).optional(),
  answer: paperAnswer.optional(),
  knowledge: z.array(z.string()),
  ability,
  difficulty,
  provenance: z.object({
    bankItemId: z.string().optional(),
    mode: z.enum(['verbatim', 'adapted', 'generated']),
    sourceLabel: z.string().optional(),
  }).optional(),
  status: z.enum(['draft', 'checked', 'flagged', 'approved', 'rejected']),
  reviewNote: z.string().optional(),
})

const paperDocument = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  level,
  kind,
  header: z.object({
    examName: z.string(),
    grade: z.string(),
    subjectLine: z.string(),
    totalScore: z.number(),
    minutes: z.number(),
    candidateFields: z.array(z.string()),
  }),
  sections: z.array(z.object({
    title: z.string(),
    note: z.string().optional(),
    items: z.array(paperQuestionSchema),
  })),
  specTable: z.array(specRow),
  policyLabel: z.string().optional(),
})

/* Wire validators — the REST boundary validates before the service writes:
   unvalidated durable rows fail domain-open schema checks on the next boot. */
/** Wire body for confirming/replacing a job's spec table. */
export const specTableWire = z.array(specRow)
/** Wire body for creating a generation job. */
export const jobCreateWire = z.object({ blueprintId: z.string().min(1), request: paperRequest })
/** Wire body for committing a generated paper document. */
export const paperDocumentWire = paperDocument

const paperVersion = z.object({
  version: z.number().int().nonnegative(),
  hash: z.string().min(1),
  at: z.string(),
  summary: z.string(),
})

const reviewRecord = z.object({
  paperId: z.string(),
  version: z.number().int(),
  questionNo: z.number().int(),
  verdict: z.enum(['approved', 'changes-requested']),
  note: z.string().optional(),
  reviewer: z.string(),
  at: z.string(),
})

const paperApproval = z.object({
  versionHash: z.string(),
  reviewer: z.string(),
  at: z.string(),
  physics: z.object({ reviewer: z.string(), at: z.string() }).optional(),
  chemistry: z.object({ reviewer: z.string(), at: z.string() }).optional(),
})

const checkFinding = z.object({
  questionNo: z.number().int().optional(),
  /* The durable enum derives from question-paper's CHECK_CODES so a new
     check code can never strand a stored finding at domain open. */
  code: z.enum(CHECK_CODES),
  detail: z.string(),
  severity: z.enum(['error', 'warning']),
})

const solveResult = z.object({
  questionNo: z.number().int(),
  draftAnswer: z.string(),
  solvedAnswer: z.string(),
  consistent: z.boolean(),
  note: z.string().optional(),
})

const paperJob = z.object({
  id: z.string().min(1),
  schoolId: z.string().nullable().optional(),
  blueprintId: z.string().min(1),
  request: paperRequest,
  specTable: z.array(specRow),
  document: paperDocument.optional(),
  versions: z.array(paperVersion),
  reviews: z.array(reviewRecord),
  approval: paperApproval.optional(),
  findings: z.array(checkFinding),
  solveReport: z.array(solveResult),
  bankPlan: z.array(z.object({
    questionNo: z.number().int(),
    mode: z.enum(['verbatim', 'adapt', 'generate', 'gap']),
    bankItemId: z.string().optional(),
    candidates: z.number().int().nonnegative(),
  })).optional(),
  repairRounds: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  status: z.enum(['spec', 'drafting', 'checking', 'review', 'approved', 'exported', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<PaperJob>

const exportBundle = z.object({
  paperId: z.string(),
  version: z.number().int(),
  hash: z.string(),
  files: z.object({
    paperPdf: z.string().optional(),
    paperDocx: z.string().optional(),
    answerPdf: z.string().optional(),
    answerDocx: z.string().optional(),
  }),
  exportedAt: z.string(),
}) satisfies z.ZodType<ExportBundle>

/* ------------------------------------------------------ question bank -- */

/** Bank-item fields the wire caller supplies; `status` starts `pending`. */
const bankItemInput = {
  id: z.string().min(1),
  sourcePaperId: z.string().optional(),
  level,
  subject,
  kind: questionKind,
  knowledge: z.array(z.string()).min(1),
  ability,
  difficulty,
  chapter: z.string().optional(),
  score: z.number().positive(),
  stem: z.string().min(1),
  options: z.array(z.string()).optional(),
  subQuestions: z.array(z.object({
    no: z.string(), text: z.string(), score: z.number(),
  })).optional(),
  figure: z.object({
    kind: z.enum(['line-diagram', 'image']),
    ref: z.string(),
    caption: z.string().optional(),
  }).optional(),
  answer: paperAnswer,
  answerTier: evidenceTier,
  sourceLabel: z.string().optional(),
  sourceQuestionNo: z.string().optional(),
  sourceUrl: z.string().optional(),
  anomalies: z.array(z.string()),
  reuseModes: z.array(z.enum(['verbatim', 'adapt'])).min(1),
  enteredBy: z.string().min(1),
}

/** Wire validator for `POST /bank/items` — teacher-entered or ingest-confirmed. */
export const bankItemWire = z.object(bankItemInput)

/** Wire validator for `PUT /bank/items/:id` — every field optional except
    service-owned identity/audit fields, which a patch must never rewrite:
    `id` is the table key and `enteredBy` is the ingest audit trail. */
export const bankItemPatchWire = bankItemWire.partial().omit({ id: true, enteredBy: true })

const bankItem = z.object({
  ...bankItemInput,
  schoolId: z.string().nullable().optional(),
  /* Service-owned: the fingerprint is computed from the stored stem, never
     trusted from the wire — a caller-supplied hash could dodge dedupe. */
  stemHash: z.string().min(1),
  status: reviewStatus,
  enteredAt: z.string().min(1),
  verifiedBy: z.string().optional(),
}) satisfies z.ZodType<BankItem>

const bankUsage = z.object({
  itemId: z.string().min(1),
  paperId: z.string().min(1),
  usedAt: z.string().min(1),
  mode: z.enum(['verbatim', 'adapted']),
}) satisfies z.ZodType<BankUsage>

/**
 * The 出卷 durable unit. `sourcePapers`/`annotations` are the hand-entered
 * evidence base, `blueprints` the verified structure templates, `jobs` the
 * full audit trail per paper, `exports` the produced file bundles.
 */
export const paperDomain = defineDomain({
  name: 'physicsos_paper',
  version: 0,
  tables: {
    source_papers: domainTable<string, SourcePaper>(sourcePaper),
    annotations: domainTable<string, KnowledgeAnnotation>(annotation),
    blueprints: domainTable<string, ExamBlueprint>(blueprint),
    jobs: domainTable<string, PaperJob>(paperJob),
    exports: domainTable<string, ExportBundle>(exportBundle),
    bank_items: domainTable<string, BankItem>(bankItem),
    bank_usage: domainTable<string, BankUsage>(bankUsage),
  },
})

/** Handle the opened domain hands to the route layer. */
export type PaperDomain = Awaited<ReturnType<typeof openPaperDomain>>

import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

/**
 * Open the paper domain on the mounted storage facility.
 * @param ctx - plugin context carrying the `storageDomain` service.
 * @returns the opened domain, typed by {@link paperDomain}.
 */
export async function openPaperDomain(ctx: Context): Promise<Domain<typeof paperDomain>> {
  return ctx.storageDomain.open(paperDomain)
}
