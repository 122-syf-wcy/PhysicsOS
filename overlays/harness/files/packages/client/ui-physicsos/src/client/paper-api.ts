/**
 * Fetch client for the paper host's `/physicsos/paper` REST surface.
 *
 * Same-origin calls only; every failure shape the route emits
 * (`{error:{code,message}}`) surfaces as an `Error` carrying the code.
 */

export interface PaperApiError extends Error {
  readonly code: string
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/physicsos/paper${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `${response.status}`) as PaperApiError
    Object.defineProperty(error, 'code', { value: body.error?.code ?? 'HTTP_' + response.status })
    throw error
  }
  return body as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

const put = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

/* Wire shapes — kept structural (no import of the host package into the
   client bundle): the fields the workspace actually reads/writes. */

export interface SourcePaperRow {
  readonly id: string
  readonly year: number
  readonly level: 'zhongkao' | 'gaokao'
  readonly subject: string
  readonly examName: string
  readonly evidenceTier: string
  readonly sourceRef: string
  readonly enteredBy: string
  readonly pageCount?: number
  readonly totalScore?: number
  readonly minutes?: number
  readonly note?: string
  readonly region?: string
  readonly school?: string
  readonly kind?: 'real' | 'mock' | 'monthly' | 'midterm' | 'final' | 'joint'
  readonly featured?: boolean
  readonly status: 'pending' | 'verified' | 'rejected'
  readonly enteredAt: string
}

export interface AnnotationRow {
  readonly id: string
  readonly sourcePaperId: string
  readonly questionNo: string
  readonly subject: string
  readonly kind: string
  readonly score: number
  readonly knowledgePrimary: string
  readonly knowledgeSecondary: readonly string[]
  readonly ability: string
  readonly pageNo?: number
  readonly stem?: string
  readonly answerSource: string
  readonly reviewer: string
  readonly status: 'pending' | 'verified' | 'rejected'
}

export interface BlueprintRow {
  readonly id: string
  readonly level: string
  readonly subject: string
  readonly title: string
  readonly totalScore: number
  readonly minutes: number
  readonly sections: readonly {
    title: string
    note?: string
    slots: readonly { kind: string; score: number; knowledgeHint?: string }[]
  }[]
  readonly basedOn: readonly string[]
  readonly status: 'pending' | 'verified' | 'rejected'
  readonly policyLabel?: string
}

export interface SpecRowWire {
  readonly questionNo: number
  readonly sectionTitle: string
  readonly kind: string
  readonly score: number
  readonly knowledge: readonly string[]
  readonly ability: string
  readonly difficulty: string
  readonly chapter?: string
}

export interface PaperQuestionWire {
  readonly number: number
  readonly subject: string
  readonly kind: string
  readonly score: number
  readonly stem: string
  readonly options?: readonly string[]
  readonly subQuestions?: readonly { no: string; text: string; score: number }[]
  readonly figure?: { kind: string; ref: string; caption?: string }
  readonly answer?: {
    result: string
    steps: readonly string[]
    gradingPoints: readonly { text: string; score: number }[]
    equivalents?: readonly string[]
  }
  readonly knowledge: readonly string[]
  readonly ability: string
  readonly difficulty: string
  /** Where the question came from — verbatim/adapted carry the bank item. */
  readonly provenance?: { bankItemId?: string; mode: 'verbatim' | 'adapted' | 'generated'; sourceLabel?: string }
  status: string
  reviewNote?: string
}

export interface PaperJobWire {
  readonly id: string
  readonly blueprintId: string
  readonly request: {
    level: string
    subjects: readonly string[]
    kind: string
    totalScore: number
    minutes: number
    chapters: readonly string[]
    exclude: readonly string[]
    difficulty: { basic: number; medium: number; hard: number }
    targetYear: number
    textbook: string
  }
  specTable: readonly SpecRowWire[]
  document?: {
    id: string
    title: string
    policyLabel?: string
    header: { examName: string; grade: string; subjectLine: string; totalScore: number; minutes: number; candidateFields: readonly string[] }
    sections: readonly { title: string; note?: string; items: readonly PaperQuestionWire[] }[]
  }
  readonly versions: readonly { version: number; hash: string; at: string; summary: string }[]
  readonly reviews: readonly { questionNo: number; verdict: string; note?: string; reviewer: string; at: string; version: number }[]
  readonly findings: readonly { severity: string; code: string; detail: string; questionNo?: number }[]
  readonly solveReport: readonly { questionNo: number; draftAnswer: string; solvedAnswer: string; consistent: boolean; note?: string }[]
  /** The assembly plan the draft ran with — per-row supply mode + source. */
  readonly bankPlan?: readonly { questionNo: number; mode: 'verbatim' | 'adapt' | 'generate' | 'gap'; bankItemId?: string; candidates: number }[]
  readonly repairRounds: number
  readonly lastError?: string
  readonly approval?: { versionHash: string; reviewer: string; at: string; physics?: { reviewer: string; at: string }; chemistry?: { reviewer: string; at: string } }
  readonly status: 'spec' | 'drafting' | 'checking' | 'review' | 'approved' | 'exported' | 'failed'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ExportBundleRow {
  readonly paperId: string
  readonly version: number
  readonly hash: string
  readonly files: { paperPdf?: string; paperDocx?: string; answerPdf?: string; answerDocx?: string }
  readonly exportedAt: string
}

/** One reusable bank item — the question bank's wire shape. */
export interface BankItemRow {
  readonly id: string
  readonly sourcePaperId?: string
  readonly level: 'zhongkao' | 'gaokao'
  readonly subject: string
  readonly kind: string
  readonly knowledge: readonly string[]
  readonly ability: string
  readonly difficulty: string
  readonly chapter?: string
  readonly score: number
  readonly stem: string
  readonly options?: readonly string[]
  readonly subQuestions?: readonly { no: string; text: string; score: number }[]
  readonly figure?: { kind: string; ref: string; caption?: string }
  readonly answer: {
    result: string
    steps: readonly string[]
    gradingPoints: readonly { text: string; score: number }[]
    equivalents?: readonly string[]
  }
  readonly answerTier: string
  readonly stemHash: string
  readonly sourceLabel?: string
  readonly sourceQuestionNo?: string
  readonly sourceUrl?: string
  readonly anomalies: readonly string[]
  readonly reuseModes: readonly ('verbatim' | 'adapt')[]
  readonly status: 'pending' | 'verified' | 'rejected'
  readonly enteredBy: string
  readonly enteredAt: string
  readonly verifiedBy?: string
}

/** One row of the live assembly preview — how the bank would serve a spec row now. */
export interface BankPlanRow {
  readonly questionNo: number
  readonly sectionTitle: string
  readonly mode: 'verbatim' | 'adapt' | 'generate' | 'gap'
  readonly candidates: number
  readonly candidateScore?: number
  readonly item?: { id: string; sourceLabel?: string; sourceQuestionNo?: string; stem: string }
}

/** The injected surface: plain callbacks returning wire data. */
export interface PaperApi {
  listSources: () => Promise<SourcePaperRow[]>
  addSource: (input: Omit<SourcePaperRow, 'status' | 'enteredAt'>) => Promise<SourcePaperRow>
  verifySource: (id: string, reviewer: string) => Promise<SourcePaperRow>
  listAnnotations: (sourcePaperId?: string) => Promise<AnnotationRow[]>
  addAnnotation: (input: Omit<AnnotationRow, 'status'>) => Promise<AnnotationRow>
  reviewAnnotation: (id: string, status: 'verified' | 'rejected' | 'pending') => Promise<AnnotationRow>
  annotationStats: (sourcePaperId?: string) => Promise<Record<string, { count: number; score: number; papers: number }>>
  importCsv: (sourcePaperId: string, csv: string, reviewer: string) => Promise<{ created: number }>
  listBlueprints: () => Promise<BlueprintRow[]>
  verifyBlueprint: (id: string) => Promise<BlueprintRow>
  listJobs: () => Promise<PaperJobWire[]>
  createJob: (blueprintId: string, requestBody: PaperJobWire['request']) => Promise<PaperJobWire>
  getJob: (id: string) => Promise<PaperJobWire>
  confirmSpec: (id: string, specTable: readonly SpecRowWire[]) => Promise<PaperJobWire>
  runDraft: (id: string) => Promise<{ status: string }>
  runChecks: (id: string) => Promise<{ status: string }>
  reviewQuestion: (id: string, questionNo: number, verdict: 'approved' | 'changes-requested', reviewer: string, note?: string) => Promise<PaperJobWire>
  /** Ask the model to revise one question per the teacher's suggestion (202 async). */
  repairQuestion: (id: string, questionNo: number, suggestion: string, reviewer: string) => Promise<unknown>
  replaceQuestion: (id: string, questionNo: number, reviewer: string) => Promise<{ status: string }>
  /** Live assembly preview for the job's spec table. */
  bankPlan: (id: string) => Promise<BankPlanRow[]>
  approve: (id: string, reviewer: string, subject: 'physics' | 'chemistry') => Promise<PaperJobWire>
  runExport: (id: string) => Promise<{ files: ExportBundleRow['files'] }>
  listExports: () => Promise<ExportBundleRow[]>
  fileUrl: (jobId: string, name: string) => string
  /* --- 题库 --- */
  listBankItems: (filter?: { status?: string; level?: string; kind?: string }) => Promise<BankItemRow[]>
  /** Paste web question text → model structures it → pending items queue. */
  ingestBank: (input: {
    text: string
    level: 'zhongkao' | 'gaokao'
    subject: 'physics' | 'chemistry'
    sourceUrl?: string
    sourcePaperId?: string
    enteredBy: string
  }) => Promise<{ created: BankItemRow[]; duplicates: string[] }>
  updateBankItem: (id: string, patch: Partial<Omit<BankItemRow, 'id' | 'stemHash' | 'status' | 'enteredAt' | 'enteredBy' | 'verifiedBy'>>) => Promise<BankItemRow>
  reviewBankItem: (id: string, status: 'verified' | 'rejected' | 'pending', reviewer: string) => Promise<BankItemRow>
}

/** The real client — bound once in `apply`, injected as callbacks. */
export function createPaperApi(): PaperApi {
  return {
    listSources: () => request('/sources'),
    addSource: input => post('/sources', input),
    verifySource: (id, reviewer) => post(`/sources/${id}/verify`, { reviewer }),
    listAnnotations: sourcePaperId =>
      request(`/annotations${sourcePaperId === undefined ? '' : `?source=${sourcePaperId}`}`),
    addAnnotation: input => post(`/sources/${input.sourcePaperId}/annotations`, input),
    reviewAnnotation: (id, status) => post(`/annotations/${id}/review`, { status }),
    annotationStats: sourcePaperId =>
      request(`/stats${sourcePaperId === undefined ? '' : `?source=${sourcePaperId}`}`),
    importCsv: (sourcePaperId, csv, reviewer) => post('/import/csv', { sourcePaperId, csv, reviewer }),
    listBlueprints: () => request('/blueprints'),
    verifyBlueprint: id => post(`/blueprints/${id}/verify`, {}),
    listJobs: () => request('/jobs'),
    createJob: (blueprintId, requestBody) => post('/jobs', { blueprintId, request: requestBody }),
    getJob: id => request(`/jobs/${id}`),
    confirmSpec: (id, specTable) => put(`/jobs/${id}/spec`, { specTable }),
    runDraft: id => post(`/jobs/${id}/draft`, {}),
    runChecks: id => post(`/jobs/${id}/check`, {}),
    reviewQuestion: (id, questionNo, verdict, reviewer, note) =>
      post(`/jobs/${id}/questions/${questionNo}/review`, { verdict, reviewer, note }),
    repairQuestion: (id, questionNo, suggestion, reviewer) =>
      post(`/jobs/${id}/questions/${questionNo}/repair`, { suggestion, reviewer }),
    replaceQuestion: (id, questionNo, reviewer) =>
      post(`/jobs/${id}/questions/${questionNo}/replace`, { reviewer }),
    bankPlan: id => request(`/jobs/${id}/bank-plan`),
    approve: (id, reviewer, subject) => post(`/jobs/${id}/approve`, { reviewer, subject }),
    runExport: id => post(`/jobs/${id}/export`, {}),
    listExports: () => request('/exports'),
    fileUrl: (jobId, name) => `/physicsos/paper/jobs/${jobId}/files/${encodeURIComponent(name)}`,
    listBankItems: filter => {
      const params = new URLSearchParams()
      if (filter?.status !== undefined) params.set('status', filter.status)
      if (filter?.level !== undefined) params.set('level', filter.level)
      if (filter?.kind !== undefined) params.set('kind', filter.kind)
      const qs = params.toString()
      return request(`/bank/items${qs === '' ? '' : `?${qs}`}`)
    },
    ingestBank: input => post('/bank/ingest', input),
    updateBankItem: (id, patch) => put(`/bank/items/${id}`, patch),
    reviewBankItem: (id, status, reviewer) => post(`/bank/items/${id}/review`, { status, reviewer }),
  }
}
