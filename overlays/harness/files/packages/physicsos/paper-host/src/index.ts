/**
 * @deepseek-ai/dsh-paper-host — the 出卷专区 host plugin.
 *
 * Owns the `physicsos_paper` storage domain (source intake, annotations,
 * verified blueprints, jobs, export bundles), serves the `/physicsos/paper`
 * REST surface on the webServer service, and drives the three long-running
 * steps: sectioned LLM drafting, checks + engine solving, and the
 * pandoc/LibreOffice export — all gated by the service layer's verified /
 * approved-hash rules. Nothing runs on boot: every generation step answers
 * an explicit HTTP call, so restarts never replay paid model calls.
 *
 * The model may propose, the engine decides: drafting (and repair/adaptation)
 * are model calls that produce stems and a candidate answer, but the answer
 * that lands in the paper is the PhysicsOS engine's, taken from
 * `@physicsos/agent-tools` in the check stage and verified before it prints.
 * A model answer that contradicts the engine, or a question the engine cannot
 * cover, becomes an explicit finding — never a fabricated number.
 *
 * @module @deepseek-ai/dsh-paper-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_BANK_POLICY, EXAM_BLUEPRINTS, planRow, questionFromBankItem, solveFindings,
  type BankItem, type BankSelectionPolicy, type CheckFinding, type PaperJob, type PaperQuestion,
  type SolveResult, type SpecRow,
} from '@physicsos/question-paper'
import { openPaperDomain, type PaperDomain } from './domain.ts'
import { PaperService, PaperError } from './service.ts'
import { adaptBankItem, draftSection, assembleDocument, repairQuestion } from './draft.ts'
import { applyEngineAnswers, engineRefusalFindings, independentSolve } from './solve.ts'
import { ingestBankText, type IngestInput } from './ingest.ts'
import { transcribeQuestionImages, type TranscribeImage } from './transcribe.ts'
import { exportPaper } from './export.ts'
import { paperRoutes } from './routes.ts'
import { identityOf } from './identity.ts'
import { access } from 'node:fs/promises'

export const name = 'paper-host'
export const inject = ['webServer', 'storageDomain', 'llm']

/** Plugin config: model route and tool paths are deployment decisions. */
export interface Config {
  /** Provider route for the model calls that propose stems and candidate
   *  answers — drafting, repair, adaptation, ingest and transcription. The
   *  answer itself is decided by the engine, not by this route. */
  provider: string
  /** Model id for the proposing calls above; the engine decides the answer. */
  model: string
  /** Export root; bundles land under `<exportDir>/<jobId>/`. */
  exportDir: string
  /** pandoc binary path. */
  pandoc: string
  /** soffice binary path; absent → docx-only bundles and an honest gap. */
  soffice?: string
  /** OpenAI-compatible image endpoint for figure generation; absent →
   *  figures print as caption placeholders. */
  imageApi?: {
    /** e.g. `https://host/v1` — `/images/generations` is appended. */
    baseURL: string
    /** Image model name passed to the endpoint. */
    model: string
    /** Env var holding the bearer key; never the key itself. */
    apiKeyEnv: string
    /** Pixel size passed to the API. */
    size?: string
  }
  /** Spacing between the serial engine solves a check run performs. */
  solveDelayMs?: number
  /** Per-attempt bound on one engine solve; a hung call must not park the job in 'checking'. */
  solveTimeoutMs?: number
  /** Bank-assisted assembly tuning; unset keys take the domain defaults. */
  bankPolicy?: Partial<BankSelectionPolicy>
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  exportDir: z.string().default(dshHomePath('papers')),
  pandoc: z.string().default('pandoc'),
  soffice: z.string(),
  /* `.default(undefined)` — NOT bare `z.object`. Every inner field here is
     `.required()`, which makes schemastery treat the WHOLE object as required
     too, so a deployment with no image endpoint would fail to boot instead of
     printing caption placeholders. That contradicts this field's own contract
     above and `export.ts`, which guards on `undefined`. */
  imageApi: z.object({
    baseURL: z.string().required(),
    model: z.string().required(),
    apiKeyEnv: z.string().required(),
    size: z.string(),
  }).default(undefined as unknown as { baseURL: string; model: string; apiKeyEnv: string; size: string }),
  solveDelayMs: z.number(),
  solveTimeoutMs: z.number(),
  bankPolicy: z.object({
    verbatimMax: z.number(),
    freshnessPapers: z.number(),
    exemplarCount: z.number(),
  }),
})

const binaryPresent = async (path: string | undefined): Promise<string | undefined> => {
  if (path === undefined) return undefined
  try { await access(path); return path } catch { /* fall through */ }
  /* Bare names resolve via PATH: probe with `--version` is the caller's job. */
  return path.includes('/') ? undefined : path
}

/** Group the confirmed spec rows back into blueprint sections for drafting. */
const rowsBySection = (job: PaperJob): Map<string, typeof job.specTable> => {
  const groups = new Map<string, typeof job.specTable>()
  for (const row of job.specTable) {
    groups.set(row.sectionTitle, [...(groups.get(row.sectionTitle) ?? []), row])
  }
  return groups
}

/**
 * Plugin entry: open the paper domain, seed built-in structure templates as
 * pending rows, then serve `/physicsos/paper` until the fiber unloads.
 * @param ctx - plugin context carrying webServer/storageDomain/llm.
 * @param config - validated plugin config.
 * @returns the effect disposer (route unregisters, domain closes).
 */
export function apply(ctx: Context, config: Config): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain: PaperDomain = await openPaperDomain(ctx)
    const service = new PaperService(domain)

    /* Seed built-in templates as pending rows; verified stays the gate. */
    for (const blueprint of EXAM_BLUEPRINTS) {
      if (domain.table('blueprints').get(blueprint.id) === undefined) {
        await domain.table('blueprints').put(blueprint.id, blueprint)
      }
    }

    /* A job left in 'drafting'/'checking' belongs to a dead process — no in-
       flight generation survives a restart, so mark it failed and let the
       teacher retry through spec confirmation (paid calls never replay). */
    for (const [id, job] of domain.table('jobs').entries()) {
      if (job.status === 'drafting' || job.status === 'checking') {
        await domain.table('jobs').put(id, {
          ...job, status: 'failed',
          lastError: 'interrupted by service restart — confirm the spec table to retry',
          updatedAt: new Date().toISOString(),
        })
      }
    }

    const route = { provider: config.provider, model: config.model }

    const bankPolicy: BankSelectionPolicy = { ...DEFAULT_BANK_POLICY, ...config.bankPolicy }

    /* Engine verdicts become findings: a disagreement with the engine's
       verified answer is a `solve-mismatch`; a question the engine could not
       decide is an explicit `engine-mismatch` refusal. Neither is a silent pass. */
    const engineFindingsFor = (solve: readonly SolveResult[]): CheckFinding[] => [
      ...solveFindings(solve.filter(result => result.solvedAnswer !== '')),
      ...engineRefusalFindings(solve),
    ]

    /* The engine's verified answer is what the paper carries: stamp it onto the
       document as a new version before the check results close the stage. */
    const applyEngine = async (jobId: string, solve: readonly SolveResult[]): Promise<void> => {
      const job = service.getJob(jobId)
      if (job.document === undefined) return
      const corrected = applyEngineAnswers(job.document, solve)
      if (corrected !== undefined) await service.commitEngineAnswers(jobId, corrected)
    }

    const runDraft = async (jobId: string): Promise<void> => {
      await service.markStage(jobId, 'drafting')
      try {
        const job = service.getJob(jobId)
        if (job.specTable.length === 0) {
          throw new PaperError(409, 'SPEC_UNCONFIRMED', 'confirm the spec table before drafting')
        }
        /* Bank-assisted assembly: plan every row first and stamp it for
           audit, then each row is served verbatim → adapt → generate. */
        const plans = service.bankPlanFor(job.specTable, job.request, bankPolicy, job.schoolId)
        await service.stampBankPlan(jobId, plans)
        const planByNo = new Map(plans.map(plan => [plan.row.questionNo, plan]))

        const drafted = new Map<string, PaperQuestion[]>()
        let lastError: Error | undefined
        for (const [sectionTitle, rows] of rowsBySection(job)) {
          const byNo = new Map<number, PaperQuestion>()
          const genRows: SpecRow[] = []
          const exemplars = new Map<string, BankItem>()
          for (const row of rows) {
            const plan = planByNo.get(row.questionNo)
            for (const ex of plan?.exemplars ?? []) exemplars.set(ex.id, ex)
            if (plan?.mode === 'verbatim' && plan.item !== undefined) {
              byNo.set(row.questionNo, questionFromBankItem(row, plan.item))
            } else if (plan?.mode === 'adapt' && plan.item !== undefined) {
              try {
                byNo.set(row.questionNo, await adaptBankItem(ctx, route, job, plan.item, row))
              } catch (error) {
                /* A failed adaptation degrades to generation — the row is
                   still served rather than failing the whole paper. */
                ctx.logger.warn(`paper-host: adapt Q${row.questionNo} failed, drafting instead: ${error instanceof Error ? error.message : String(error)}`)
                console.error(`[paper-host] adapt Q${row.questionNo} failed:`, error)
                genRows.push(row)
              }
            } else {
              genRows.push(row)
            }
          }
          if (genRows.length > 0) {
            try {
              for (const q of await draftSection(
                ctx, route, job, sectionTitle, genRows, undefined, [...exemplars.values()],
              )) {
                byNo.set(q.number, q)
              }
            } catch (error) {
              /* Structural failure → one repair round with the error fed back. */
              ctx.logger.warn(`paper-host: section '${sectionTitle}' draft error: ${error instanceof Error ? error.message : String(error)}`)
              const rounds = await service.spendRepairRound(jobId)
              if (rounds > 2) throw new PaperError(422, 'DRAFT_FAILED',
                `section '${sectionTitle}' still invalid after 2 repairs; last error: ${error instanceof Error ? error.message : String(error)}`)
              try {
                for (const q of await draftSection(
                  ctx, route, job, sectionTitle, genRows,
                  error instanceof Error ? error.message : String(error),
                  [...exemplars.values()],
                )) {
                  byNo.set(q.number, q)
                }
              } catch (retryError) {
                lastError = retryError instanceof Error ? retryError : new Error(String(retryError))
                ctx.logger.warn(`paper-host: section '${sectionTitle}' draft failed: ${lastError.message}`)
                throw new PaperError(422, 'DRAFT_FAILED', `section '${sectionTitle}': ${lastError.message}`)
              }
            }
          }
          const items = rows.map(row => byNo.get(row.questionNo)).filter((q): q is PaperQuestion => q !== undefined)
          if (items.length !== rows.length) {
            ctx.logger.warn(`paper-host: section '${sectionTitle}' produced ${items.length}/${rows.length} questions — spec coverage check will flag the gap`)
          }
          drafted.set(sectionTitle, items)
        }
        const titles = [...rowsBySection(job).keys()]
        await service.commitDocument(jobId, assembleDocument(job, titles, drafted), 'AI 起草')
        /* Usage lands only after the document commits — a failed draft
           must not consume freshness. Ledger follows the committed
           questions' provenance, not the plan: an adaptation that fell
           back to generation never touched the bank item. */
        const recorded = new Set<string>()
        for (const q of [...drafted.values()].flat()) {
          const { bankItemId, mode } = q.provenance ?? {}
          if (bankItemId === undefined || (mode !== 'verbatim' && mode !== 'adapted') || recorded.has(bankItemId)) continue
          recorded.add(bankItemId)
          await service.recordBankUsage(bankItemId, jobId, mode)
        }
        await service.markStage(jobId, 'checking')
      } catch (error) {
        await service.failJob(jobId, error instanceof Error ? error.message : String(error))
        throw error
      }
    }

    const runChecks = async (jobId: string): Promise<void> => {
      await service.markStage(jobId, 'checking')
      try {
        const job = service.getJob(jobId)
        if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${jobId} has no document`)
        const findings = service.runJobChecks(jobId, bankPolicy.freshnessPapers)
        const questions = job.document.sections.flatMap(section => section.items)
        const solve = await independentSolve(questions, config.solveDelayMs, config.solveTimeoutMs)
        await applyEngine(jobId, solve)
        await service.recordCheckResults(jobId, [...findings, ...engineFindingsFor(solve)], solve)
      } catch (error) {
        await service.failJob(jobId, error instanceof Error ? error.message : String(error))
        throw error
      }
    }

    /* Single-question repair: record the teacher's verdict, revise the
       question through the model, commit a new version, then refresh
       mechanical findings and re-solve just that question — the rest of
       the solve report still describes unchanged stems and stays valid. */
    const runRepair = async (jobId: string, questionNo: number, suggestion: string, reviewer: string): Promise<void> => {
      try {
        const job = service.getJob(jobId)
        const doc = job.document
        if (doc === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${jobId} has no document`)
        const question = doc.sections.flatMap(s => s.items).find(q => q.number === questionNo)
        if (question === undefined) throw new PaperError(404, 'NO_QUESTION', `job ${jobId} has no question ${questionNo}`)
        await service.reviewQuestion(jobId, questionNo, 'changes-requested', reviewer, suggestion)
        const revised = await repairQuestion(ctx, route, job, question, suggestion)
        const nextDoc = {
          ...doc,
          sections: doc.sections.map(section => ({
            ...section,
            items: section.items.map(q => q.number === questionNo ? { ...revised, reviewNote: suggestion } : q),
          })),
        }
        await service.commitDocument(jobId, nextDoc, `第${questionNo}题按审核意见修订`)
        await service.markStage(jobId, 'checking')
        const findings = service.runJobChecks(jobId, bankPolicy.freshnessPapers)
        const [solved] = await independentSolve([{ ...revised }], config.solveDelayMs, config.solveTimeoutMs)
        if (solved === undefined) {
          throw new PaperError(500, 'SOLVE_FAILED', `第${questionNo}题独立重解没有产出记录`)
        }
        const prior = service.getJob(jobId).solveReport
        const merged = prior.some(r => r.questionNo === questionNo)
          ? prior.map(r => r.questionNo === questionNo ? solved : r)
          : [...prior, solved]
        await applyEngine(jobId, merged)
        await service.recordCheckResults(jobId, [...findings, ...engineFindingsFor(merged)], merged)
      } catch (error) {
        ctx.logger.warn(`paper-host: repair ${jobId}#${questionNo} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    /* Swap one printed question for the next-best bank candidate: the
       current item joins `taken` so the planner serves a different one.
       Verbatim swaps land immediately; adapt candidates go through the
       model. Then the usual single-question refresh — checks + re-solve. */
    const planReplace = (jobId: string, questionNo: number) => {
      const job = service.getJob(jobId)
      const doc = job.document
      if (doc === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${jobId} has no document`)
      const row = job.specTable.find(r => r.questionNo === questionNo)
      if (row === undefined) throw new PaperError(404, 'NO_SPEC_ROW', `job ${jobId} has no spec row ${questionNo}`)
      if (!doc.sections.some(s => s.items.some(q => q.number === questionNo))) {
        throw new PaperError(404, 'NO_QUESTION', `job ${jobId} has no question ${questionNo}`)
      }
      const taken = new Set(
        doc.sections.flatMap(s => s.items)
          .map(q => q.provenance?.bankItemId)
          .filter((id): id is string => id !== undefined),
      )
      const verbatimOnPaper = doc.sections.flatMap(s => s.items)
        .filter(q => q.provenance?.mode === 'verbatim' && q.number !== questionNo).length
      const recentPaperIds = new Set(
        service.listJobs(undefined, job.schoolId)
          .filter(other => other.id !== jobId && (other.status === 'approved' || other.status === 'exported'))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, bankPolicy.freshnessPapers)
          .map(other => other.id),
      )
      const plan = planRow(row, job.request, service.listBankItems({ status: 'verified' }, job.schoolId), {
        taken,
        recentPaperIds,
        usageOf: itemId => service.bankUsageFor(itemId, job.schoolId),
        sourceOf: (id) => {
          const source = domain.table('source_papers').get(id)
          return source !== undefined && (job.schoolId == null || source.schoolId == null || source.schoolId === job.schoolId)
            ? source
            : undefined
        },
        verbatimSpent: verbatimOnPaper,
        policy: bankPolicy,
      })
      if (plan.item === undefined) {
        throw new PaperError(404, 'NO_CANDIDATE', `第${questionNo}题题库中没有其他可用候选`)
      }
      /* `item` is narrowed here so `runReplace` never re-asserts it. */
      return { job, doc, row, plan, item: plan.item }
    }

    const runReplace = async (jobId: string, questionNo: number, reviewer: string): Promise<void> => {
      try {
        const { job, doc, row, plan, item } = planReplace(jobId, questionNo)
        const replacement = plan.mode === 'verbatim'
          ? questionFromBankItem(row, item)
          : await adaptBankItem(ctx, route, job, item, row)
        const nextDoc = {
          ...doc,
          sections: doc.sections.map(section => ({
            ...section,
            items: section.items.map(q => q.number === questionNo
              ? { ...replacement, reviewNote: `题库换题（${reviewer}）` } : q),
          })),
        }
        await service.commitDocument(jobId, nextDoc, `第${questionNo}题更换题库候选（${plan.mode === 'verbatim' ? '原题' : '改编'} ${item.sourceLabel ?? item.id}）`)
        await service.markStage(jobId, 'checking')
        await service.recordBankUsage(item.id, jobId, plan.mode === 'verbatim' ? 'verbatim' : 'adapted')
        const findings = service.runJobChecks(jobId, bankPolicy.freshnessPapers)
        const [solved] = await independentSolve([{ ...replacement }], config.solveDelayMs, config.solveTimeoutMs)
        if (solved === undefined) {
          throw new PaperError(500, 'SOLVE_FAILED', `第${questionNo}题独立重解没有产出记录`)
        }
        const prior = service.getJob(jobId).solveReport
        const merged = prior.some(r => r.questionNo === questionNo)
          ? prior.map(r => r.questionNo === questionNo ? solved : r)
          : [...prior, solved]
        await applyEngine(jobId, merged)
        await service.recordCheckResults(jobId, [...findings, ...engineFindingsFor(merged)], merged)
      } catch (error) {
        ctx.logger.warn(`paper-host: replace ${jobId}#${questionNo} failed: ${error instanceof Error ? error.message : String(error)}`)
        console.error(`[paper-host] replace ${jobId}#${questionNo} failed:`, error)
      }
    }

    /* Pasted-text ingest: structure through the model, then write pending
       items — web-public tier and anomalies ride along for the reviewer. */
    const runIngest = async (input: IngestInput) => {
      const drafts = await ingestBankText(ctx, route, input)
      return service.ingestBankItems(drafts.map(draft => ({
        ...draft,
        level: input.level,
        subject: input.subject,
        answerTier: 'web-public' as const,
        reuseModes: ['adapt', 'verbatim'] as const,
        sourcePaperId: input.sourcePaperId,
        sourceUrl: input.sourceUrl,
        enteredBy: input.enteredBy,
        ...input.schoolId === undefined ? {} : { schoolId: input.schoolId },
      })))
    }

    /* 图片/扫描件录入：视觉模型转录题面（不解题），再走与粘贴导入同一条
       结构化管线。转录文本随响应返回，教师能在入库前对照原图。 */
    const runImageIngest = async (input: {
      images: readonly TranscribeImage[]
      level: IngestInput['level']
      subject: IngestInput['subject']
      sourceUrl?: string
      enteredBy: string
      schoolId: string | null
    }) => {
      const transcription = await transcribeQuestionImages(ctx, route, input.images)
      const ingested = await runIngest({
        text: transcription,
        level: input.level,
        subject: input.subject,
        sourceUrl: input.sourceUrl,
        enteredBy: input.enteredBy,
        schoolId: input.schoolId,
      })
      return { ...ingested, transcription }
    }

    /* Engine triage over pending bank rows: the solver answers each item
       blind and the verdict lands as an `engine-check:*` anomaly the reviewer
       can filter on. `status` never moves here — verifying stays a human
       decision. One run at a time: two overlapping passes would double the
       model spend for the same rows. */
    let triageRunning = false
    const triageBusy = (): boolean => triageRunning
    const runTriage = async (targets: readonly BankItem[]): Promise<void> => {
      triageRunning = true
      try {
        for (const [index, item] of targets.entries()) {
          const question: PaperQuestion = {
            number: index + 1,
            subject: item.subject,
            kind: item.kind,
            score: item.score,
            stem: item.stem,
            options: item.options,
            answer: item.answer,
            knowledge: item.knowledge,
            ability: item.ability,
            difficulty: item.difficulty,
            status: 'draft',
          }
          /* Serial per-item solves: one provider flake marks one row
             `unresolved` instead of parking the whole batch. */
          try {
            const [result] = await independentSolve(
              [question], config.solveDelayMs, config.solveTimeoutMs)
            const check = result === undefined || result.solvedAnswer === '' ? 'unresolved'
              : result.consistent ? 'agreed' : 'mismatch'
            await service.noteBankTriage(
              item.id, check,
              check === 'mismatch' && result !== undefined ? result.solvedAnswer : undefined)
          } catch (error) {
            await service.noteBankTriage(item.id, 'unresolved')
            ctx.logger.warn(`paper-host: triage ${item.id} failed: ${String(error)}`)
          }
        }
        ctx.logger.info(`paper-host: triage finished on ${targets.length} item(s)`)
      } finally {
        triageRunning = false
      }
    }

    const runExport = async (jobId: string): Promise<{ files: import('./export.ts').ExportFileSet }> => {
      const { document, job } = service.requireApprovedDocument(jobId)
      const soffice = await binaryPresent(config.soffice)
      const files = await exportPaper(
        { pandoc: config.pandoc, soffice, exportDir: config.exportDir, imageApi: config.imageApi },
        jobId,
        document,
        job.solveReport,
      )
      await service.recordExport(jobId, files)
      return { files }
    }

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/paper',
      handler: paperRoutes({
        service, exportDir: config.exportDir, bankPolicy,
        /* Resolved per request: this host is declared before auth-host, so the
           service does not exist yet when this line runs. */
        identity: () => identityOf(ctx),
        runDraft, runChecks, runRepair, runReplace, planReplace, runExport, runIngest,
        runImageIngest,
        planTriage: (input, schoolId) => service.planBankTriage(input, schoolId),
        runTriage, triageBusy,
      }),
    })
    yield () => domain.close()
  }, 'paper-host')
}
