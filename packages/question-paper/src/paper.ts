/**
 * Paper domain model — the 出卷专区 source of truth.
 *
 * Entities follow the 组卷 pipeline: real-paper intake (SourcePaper,
 * KnowledgeAnnotation) → verified structure templates (ExamBlueprint) →
 * teacher-confirmed specification table (SpecRow) → AI-drafted questions
 * (PaperDocument) → review and hash-bound approval → export bundle.
 *
 * The package is pure types and pure functions: no cordis, no IO. Host
 * plugins own storage, transport and model calls; this package owns what a
 * paper IS and what "correct" means for it.
 *
 * Evidence discipline: anything derived from an unverified source stays out
 * of statistics and templates — `ReviewStatus` gates it, and the draft bank
 * files in this package are authoring scaffolding, not production data.
 */

/* --------------------------------------------------------- vocabulary -- */

/** Exam track. */
export type PaperLevel = 'zhongkao' | 'gaokao'

/** Subject a paper or annotation belongs to. */
export type Subject = 'physics' | 'chemistry'

/** Paper product. `mock` is the 模拟预测卷; the rest are school-stage papers. */
export type PaperKind = 'unit' | 'weekly' | 'monthly' | 'midterm' | 'final' | 'mock'

/** Question categories a blueprint slot may carry. */
export type QuestionKind =
  | 'choice-single'
  | 'choice-multi'
  | 'blank'
  | 'drawing'
  | 'short-answer'
  | 'experiment'
  | 'calculation'

/**
 * Evidence tier of a record's source. `recalled` and unverified entries are
 * excluded from statistics and template eligibility.
 */
export type EvidenceTier =
  | 'policy' // official policy / 考试方案文件
  | 'original-scan' // 原卷扫描件
  | 'manual-transcript' // 人工转录的原卷
  | 'institution-analysis' // 机构解析版
  | 'web-public' // 公开网络题源 — 题库候选可用, never stats-eligible
  | 'recalled' // 回忆版 — never stats-eligible

/** Review lifecycle shared by source records and templates. */
export type ReviewStatus = 'pending' | 'verified' | 'rejected'

/** Ability level a question exercises (能力层次). */
export type Ability = '识记' | '理解' | '应用' | '分析' | '探究'

/** Difficulty tier — always labelled 教研估计 until trial-calibrated. */
export type Difficulty = 'basic' | 'medium' | 'hard'

/** Occasion a real paper belongs to — the 卷库 type filter axis. */
export type SourcePaperKind =
  | 'real' // 真题（官方考试原卷）
  | 'mock' // 模拟预测卷
  | 'monthly' // 月考
  | 'midterm' // 期中
  | 'final' // 期末
  | 'joint' // 联考/统考

/* ------------------------------------------------- real-paper intake -- */

/** One real Guizhou exam paper on file (原卷登记). */
export interface SourcePaper {
  readonly id: string
  /** Tenant owner; null is platform-wide and absence is a legacy unscoped row. */
  readonly schoolId?: string | null
  readonly level: PaperLevel
  /**
   * `combined` covers the 物化合卷: annotations then carry the per-question
   * subject split.
   */
  readonly subject: Subject | 'combined'
  readonly year: number
  /** e.g. `贵州省初中学业水平考试` / `贵州省选择性考试`. */
  readonly examName: string
  readonly evidenceTier: EvidenceTier
  /** Where the evidence lives: scan filename, archive path, transcript ref. */
  readonly sourceRef: string
  readonly pageCount?: number
  readonly totalScore?: number
  readonly minutes?: number
  /** Issuing region, e.g. `贵州·贵阳` — blank for province-wide papers. */
  readonly region?: string
  /** Issuing school for 名校卷, e.g. `贵阳一中`. */
  readonly school?: string
  /** Which occasion the paper belongs to — the 卷库 type axis. */
  readonly kind?: SourcePaperKind
  /** 含金量 marker: curated 名校卷/联考/教研推荐 papers carry this badge. */
  readonly featured?: boolean
  /** Only `verified` papers may anchor a blueprint. */
  readonly status: ReviewStatus
  readonly enteredBy: string
  readonly enteredAt: string
  readonly note?: string
}

/** One independently scored sub-question of a source paper (逐小题考点记录). */
export interface KnowledgeAnnotation {
  readonly id: string
  /** Tenant owner; null is platform-wide and absence is a legacy unscoped row. */
  readonly schoolId?: string | null
  readonly sourcePaperId: string
  readonly pageNo?: number
  /** Printed question number; sub-questions use `12(2)` form. */
  readonly questionNo: string
  readonly subject: Subject
  readonly kind: QuestionKind
  /** Points this sub-question alone carries. */
  readonly score: number
  /** 主考点 label, e.g. `浮力`, `伏安法测电阻`. */
  readonly knowledgePrimary: string
  readonly knowledgeSecondary: readonly string[]
  readonly ability: Ability
  /** 实验题细分: `课标必做` / `拓展探究` / `演示实验` etc. */
  readonly experimentType?: string
  /** Textbook anchor, e.g. `人教版九年级·第13章 内能`. */
  readonly chapter?: string
  /** Transcribed question stem — present when the annotator typed the 题干. */
  readonly stem?: string
  readonly answerSource: EvidenceTier
  readonly reviewer: string
  readonly status: ReviewStatus
}

/* ------------------------------------------------------ question bank -- */

/** Ways a bank item may enter a paper. */
export type BankReuseMode = 'verbatim' | 'adapt'

/**
 * One reusable question in the curated bank — content-level entry ingested
 * from a public source (web-public) or lifted out of a registered source
 * paper. Distinct from {@link KnowledgeAnnotation}: the annotation records
 * what a source question tests; the bank item carries the question itself —
 * stem, options, answer — plus the provenance a reviewer needs to trust it.
 * Only `verified` items enter the assembly candidate pool.
 */
export interface BankItem {
  readonly id: string
  /** Tenant owner; null is platform-wide and absence is a legacy unscoped row. */
  readonly schoolId?: string | null
  /** Registered paper this item was lifted from; absent for loose 散题. */
  readonly sourcePaperId?: string
  readonly level: PaperLevel
  readonly subject: Subject
  readonly kind: QuestionKind
  /** `[主考点, ...次考点]` — primary first, matching annotation vocabulary. */
  readonly knowledge: readonly string[]
  readonly ability: Ability
  /** 教研估计 until trial data recalibrates it. */
  readonly difficulty: Difficulty
  readonly chapter?: string
  readonly score: number
  readonly stem: string
  readonly options?: readonly string[]
  readonly subQuestions?: readonly PaperSubQuestion[]
  readonly figure?: PaperFigure
  readonly answer: PaperAnswer
  /** Where the answer came from; `web-public`/`recalled` warn at review. */
  readonly answerTier: EvidenceTier
  /** Normalized-stem fingerprint — the dedupe key at ingest. */
  readonly stemHash: string
  /** Printed source attribution, e.g. `2024·贵阳一中高三月考`. */
  readonly sourceLabel?: string
  /** Question number on the source paper, e.g. `5` or `12(2)`. */
  readonly sourceQuestionNo?: string
  /** Page the item was pasted/fetched from, when known. */
  readonly sourceUrl?: string
  /** Data-quality anomalies the ingest pass flagged for the reviewer. */
  readonly anomalies: readonly string[]
  /** Reuse modes the reviewer allows: verbatim entry, adaptation, or both. */
  readonly reuseModes: readonly BankReuseMode[]
  readonly status: ReviewStatus
  readonly enteredBy: string
  readonly enteredAt: string
  readonly verifiedBy?: string
}

/** One use of a bank item on a produced paper — the anti-repeat ledger. */
export interface BankUsage {
  readonly itemId: string
  readonly paperId: string
  readonly usedAt: string
  readonly mode: 'verbatim' | 'adapted'
}

/** Where a paper question came from — surfaced to the reviewer. */
export interface QuestionProvenance {
  /** Bank item this question reuses or adapts; absent for pure AI drafting. */
  readonly bankItemId?: string
  readonly mode: 'verbatim' | 'adapted' | 'generated'
  /** Human-readable source, e.g. `2024·贵阳一中高三月考 T5`. */
  readonly sourceLabel?: string
}

/* -------------------------------------------------------- blueprints -- */

/** One scored slot inside a blueprint section. */
export interface BlueprintSlot {
  readonly kind: QuestionKind
  readonly score: number
  /** Expected 考点 the slot should exercise (advisory for drafting). */
  readonly knowledgeHint?: string
}

/** A printed section: heading plus its ordered slots. */
export interface BlueprintSection {
  readonly title: string
  /** Grading note printed under the heading (多选计分规则、过程分说明). */
  readonly note?: string
  readonly slots: readonly BlueprintSlot[]
}

/**
 * An exam structure template. Only `status: 'verified'` blueprints may drive
 * paper generation, and a blueprint may enter `verified` only when every
 * entry in `basedOn` names a verified SourcePaper — the host enforces this.
 */
export interface ExamBlueprint {
  readonly id: string
  /** Tenant owner; null is platform-wide and absence is a legacy unscoped row. */
  readonly schoolId?: string | null
  readonly level: PaperLevel
  readonly subject: Subject
  readonly title: string
  readonly totalScore: number
  readonly minutes: number
  readonly sections: readonly BlueprintSection[]
  readonly basedOn: readonly string[]
  readonly status: ReviewStatus
  /**
   * Printed on the paper when the target year's policy is not verified,
   * e.g. `依据已核实政策编制的训练卷`.
   */
  readonly policyLabel?: string
}

/* ---------------------------------------------- specification table -- */

/** One row of the teacher-confirmed 双向细目表. */
export interface SpecRow {
  readonly questionNo: number
  /** Printed section the row belongs to, e.g. `一、选择题`. */
  readonly sectionTitle: string
  readonly kind: QuestionKind
  readonly score: number
  readonly knowledge: readonly string[]
  readonly ability: Ability
  readonly difficulty: Difficulty
  readonly chapter?: string
}

/** What the teacher asked for: everything the draft must honor. */
export interface PaperRequest {
  readonly level: PaperLevel
  /** Subjects on the paper; `['physics','chemistry']` is the 理综 combined paper. */
  readonly subjects: readonly Subject[]
  readonly kind: PaperKind
  readonly totalScore: number
  readonly minutes: number
  /** Taught chapter range, e.g. `['人教版八年级·第1-4章']`. */
  readonly chapters: readonly string[]
  /** Content to exclude explicitly. */
  readonly exclude: readonly string[]
  /** Difficulty target over question counts; labels stay 教研估计. */
  readonly difficulty: { readonly basic: number; readonly medium: number; readonly hard: number }
  /** Exam year the paper trains toward. */
  readonly targetYear: number
  /** Textbook edition baseline, e.g. `人教版`. */
  readonly textbook: string
}

/* ------------------------------------------------------- the document -- */

/** A sub-question inside a compound item. */
export interface PaperSubQuestion {
  readonly no: string
  readonly text: string
  readonly score: number
}

/** A figure a question needs. Line diagrams are regenerated, never screenshots. */
export interface PaperFigure {
  readonly kind: 'line-diagram' | 'image'
  /** Reference the renderer resolves (diagram spec id or asset path). */
  readonly ref: string
  readonly caption?: string
}

/** One grading point inside the marking scheme. */
export interface GradingPoint {
  readonly text: string
  readonly score: number
}

/** Structured answer for one question. */
export interface PaperAnswer {
  readonly result: string
  /** Solution steps, LaTeX-capable (`$...$`). */
  readonly steps: readonly string[]
  readonly gradingPoints: readonly GradingPoint[]
  /** Accepted equivalent answers (等效表述). */
  readonly equivalents?: readonly string[]
}

/** Per-question pipeline state inside a draft. */
export type QuestionStatus = 'draft' | 'checked' | 'flagged' | 'approved' | 'rejected'

/** One question in the draft document. */
export interface PaperQuestion {
  readonly number: number
  readonly subject: Subject
  readonly kind: QuestionKind
  readonly score: number
  readonly stem: string
  readonly options?: readonly string[]
  readonly subQuestions?: readonly PaperSubQuestion[]
  readonly figure?: PaperFigure
  readonly answer?: PaperAnswer
  readonly knowledge: readonly string[]
  readonly ability: Ability
  readonly difficulty: Difficulty
  /** Bank lineage — absent on pure AI-drafted questions. */
  readonly provenance?: QuestionProvenance
  status: QuestionStatus
  reviewNote?: string
}

/** A printed section of the document. */
export interface PaperDocumentSection {
  readonly title: string
  readonly note?: string
  readonly items: readonly PaperQuestion[]
}

/** Header fields printed at the top of the student paper. */
export interface PaperHeader {
  readonly examName: string
  readonly grade: string
  readonly subjectLine: string
  readonly totalScore: number
  readonly minutes: number
  /** Fill-in lines shown to the candidate. */
  readonly candidateFields: readonly string[]
}

/** The whole paper as data — the export and review source of truth. */
export interface PaperDocument {
  readonly id: string
  readonly title: string
  readonly level: PaperLevel
  readonly kind: PaperKind
  readonly header: PaperHeader
  readonly sections: readonly PaperDocumentSection[]
  /** The confirmed 双向细目表 this document was drafted against. */
  readonly specTable: readonly SpecRow[]
  /** Printed disclaimer when policy for the target year is unverified. */
  readonly policyLabel?: string
}

/* ---------------------------------------------------- review & version -- */

/** A teacher's verdict on one question of one version. */
export interface ReviewRecord {
  readonly paperId: string
  readonly version: number
  readonly questionNo: number
  readonly verdict: 'approved' | 'changes-requested'
  readonly note?: string
  readonly reviewer: string
  readonly at: string
}

/** An immutable snapshot identity of the document. */
export interface PaperVersion {
  readonly version: number
  /** SHA-256 over the canonical PaperDocument JSON. */
  readonly hash: string
  readonly at: string
  readonly summary: string
}

/** Subject-scoped approval half of a combined paper. */
export interface SubjectApproval {
  readonly reviewer: string
  readonly at: string
}

/**
 * Whole-paper approval, bound to one exact version hash. Any document edit
 * mints a new version and voids this record — the host deletes it on commit.
 */
export interface PaperApproval {
  readonly versionHash: string
  readonly reviewer: string
  readonly at: string
  /** Combined papers require both halves before export opens. */
  readonly physics?: SubjectApproval
  readonly chemistry?: SubjectApproval
}

/* --------------------------------------------------------- checking -- */

/** All check-finding codes; durable schemas and adjudication sets derive from this one list. */
export const CHECK_CODES = [
  'score-mismatch', // per-question, grading-point or total score wrong
  'missing-answer', // no answer/grading points
  'missing-figure', // stem references a figure that is absent
  'numbering', // question numbers broken
  'out-of-scope', // chapter/knowledge outside the request
  'duplicate', // near-duplicate inside the paper
  'format', // choice options malformed etc.
  'spec-mismatch', // question drifts off its confirmed spec-table row
  'missing-knowledge', // no stated knowledge point — 命题依据缺失
  'answer-format', // answer text is not a valid option letter set
  'difficulty-drift', // paper coefficient drifts from the target mix
  'solve-mismatch', // independent solver disagrees with the draft answer
  'engine-mismatch', // PhysicsOS engine result disagrees
  'bank-reuse', // verbatim placement of an item used on a recent paper
  'provenance-mismatch', // stamped source mode disagrees with the printed content
  'answer-source', // sourced question rests on weak answer evidence
] as const

/** One automated finding on a draft. */
export interface CheckFinding {
  readonly questionNo?: number
  readonly code: (typeof CHECK_CODES)[number]
  readonly detail: string
  readonly severity: 'error' | 'warning'
}

/** Independent solving outcome for one question. */
export interface SolveResult {
  readonly questionNo: number
  readonly draftAnswer: string
  readonly solvedAnswer: string
  readonly consistent: boolean
  readonly note?: string
}

/* ---------------------------------------------------------- the job -- */

/** Lifecycle of one paper-generation job. */
export type PaperJobStatus =
  | 'spec' // spec table being confirmed
  | 'drafting' // AI drafting in progress / done, checks pending
  | 'checking' // auto checks + independent solving ran
  | 'review' // teacher reviewing per question
  | 'approved' // whole-paper approval bound to the current hash
  | 'exported' // export bundle produced from the approved hash
  | 'failed' // unrecoverable — draft kept, export blocked

/** The durable record the host stores — document plus its audit trail. */
export interface PaperJob {
  readonly id: string
  /** Tenant owner; null is platform-wide and absence is a legacy unscoped row. */
  readonly schoolId?: string | null
  /** The structure template this job draws from. */
  readonly blueprintId: string
  readonly request: PaperRequest
  /** Confirmed 双向细目表; empty until the teacher confirms. */
  readonly specTable: readonly SpecRow[]
  /** Current working document; absent before drafting. */
  readonly document?: PaperDocument
  /** Append-only version ledger; `versions.at(-1)` is current. */
  readonly versions: readonly PaperVersion[]
  readonly reviews: readonly ReviewRecord[]
  readonly approval?: PaperApproval
  readonly findings: readonly CheckFinding[]
  readonly solveReport: readonly SolveResult[]
  /**
   * The bank-assembly plan the draft ran with — per-row supply mode,
   * chosen item, and eligible candidate count, for audit and the spec-tab
   * preview. Absent on jobs drafted before bank assembly existed.
   */
  readonly bankPlan?: readonly {
    readonly questionNo: number
    readonly mode: 'verbatim' | 'adapt' | 'generate' | 'gap'
    readonly bankItemId?: string
    readonly candidates: number
  }[]
  /** Auto-repair rounds already spent (plan caps at 2). */
  readonly repairRounds: number
  /** Terminal error from the last failed async stage, surfaced to the UI. */
  readonly lastError?: string
  /**
   * Live telemetry from the async drivers (draft/check/export), written as
   * each step advances so the UI can show WHAT the pipeline is doing — the
   * thinking/writing/figure/solve phases — instead of a bare stage label.
   * Absent on jobs that predate progress reporting or have not started.
   */
  readonly progress?: {
    /** Machine phase: plan | draft | adapt | assemble | check | solve | figure | export. */
    readonly stage: string
    /** Human line for the current step, e.g. the section being drafted. */
    readonly detail?: string
    readonly done: number
    readonly total: number
    readonly updatedAt: string
  }
  status: PaperJobStatus
  readonly createdAt: string
  readonly updatedAt: string
}

/* ----------------------------------------------------------- export -- */

/** The four deliverable files of one approved version. */
export interface ExportBundle {
  readonly paperId: string
  readonly version: number
  readonly hash: string
  readonly files: {
    readonly paperPdf?: string
    readonly paperDocx?: string
    readonly answerPdf?: string
    readonly answerDocx?: string
  }
  readonly exportedAt: string
}

/* ----------------------------------------- draft-only legacy vocabulary -- */

/**
 * Draft scaffolding kept from the earlier sampler spike: {@link BankQuestion}
 * remains for draft-side sampling utilities, which are NOT a production path.
 * Production papers are AI-drafted against confirmed spec tables and pass
 * review before export.
 */
export interface BankQuestion {
  readonly id: string
  readonly level: PaperLevel
  readonly kind: QuestionKind
  readonly domain: string
  readonly knowledge: readonly string[]
  readonly difficulty: Difficulty
  readonly score: number
  readonly stem: string
  readonly options?: readonly string[]
  readonly answer: string
  readonly analysis: string
  readonly source: string
}
