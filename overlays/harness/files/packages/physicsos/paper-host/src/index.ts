/**
 * @deepseek-ai/dsh-paper-host — the 出卷专区 host plugin.
 *
 * Owns the `physicsos_paper` storage domain (source intake, annotations,
 * verified blueprints, jobs, export bundles), serves the `/physicsos/paper`
 * REST surface on the webServer service, and drives the three long-running
 * steps: sectioned LLM drafting, checks + engine solving, and the
 * pandoc/LibreOffice export — all gated by the service layer's verified /
 * approved-hash rules. One explicit action owns draft → checks → review on
 * the server. Restarts settle interrupted work; they never replay paid calls.
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

import { ModelUsageOutbox, type ReceiptSink } from '@physicsos/model-usage-outbox'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_BANK_POLICY, EXAM_BLUEPRINTS, planRow, questionFromBankItem, solveFindings,
  paperFigureInputHash, type BankItem, type BankSelectionPolicy, type CheckFinding, type PaperJob, type PaperQuestion,
  type SolveResult, type SpecRow,
} from '@physicsos/question-paper'
import { openPaperDomain, type PaperDomain } from './domain.ts'
import { PaperService, PaperError } from './service.ts'
import { PaperPipeline } from './pipeline.ts'
import { fenceMatches, operationFence, questionContentHash, type BoundSolveResult, type CheckedFigureAsset,
  type ManagedPaperJob, type PaperOperationFence } from './workflow-state.ts'
import { adaptBankItem, draftSection, assembleDocument, repairQuestion } from './draft.ts'
import { applyEngineAnswers, engineRefusalFindings, independentSolve } from './solve.ts'
import { ingestBankText, type IngestInput } from './ingest.ts'
import { transcribeQuestionImages, type TranscribeImage } from './transcribe.ts'
import { exportPaper, generateFigures } from './export.ts'
import { paperRoutes } from './routes.ts'
import { identityOf } from './identity.ts'
import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'

/* The web host routes process output through its own logger, which does not
   reach the terminal during a local run — an async stage that dies silently
   leaves no trace at all. Setting PHYSICSOS_PAPER_TRACE to a path turns on a
   file sink for those stages; unset, every call is a no-op. */
const TRACE_PATH = process.env.PHYSICSOS_PAPER_TRACE
const trace = (line: string): void => {
  if (TRACE_PATH === undefined || TRACE_PATH === '') return
  try { appendFileSync(TRACE_PATH, `${new Date().toISOString()} ${line}\n`) } catch { /* tracing must never break a job */ }
}

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
    yield () => domain.close()
    const receipts = new ModelUsageOutbox({ source: 'paper', table: domain.table('usage_receipts'),
      sink: () => ctx.get('physicsosUsage') as ReceiptSink | undefined,
      onError: phase => ctx.logger.warn(`paper-host: usage ${phase} pending; receipt retained for retry`),
    })
    await receipts.initialize()
    yield () => receipts.close()
    const service = new PaperService(domain)

    /* Seed built-in templates as pending rows; verified stays the gate. */
    for (const blueprint of EXAM_BLUEPRINTS) {
      if (domain.table('blueprints').get(blueprint.id) === undefined) {
        await domain.table('blueprints').put(blueprint.id, blueprint)
      }
    }

    /* Never automatically replay a chargeable call after restart. */
    await service.settleInterrupted()

    const route = { provider: config.provider, model: config.model, receipts }

    const bankPolicy: BankSelectionPolicy = { ...DEFAULT_BANK_POLICY, ...config.bankPolicy }

    /* Engine verdicts become findings: a disagreement with the engine's
       verified answer is a `solve-mismatch`; a question the engine could not
       decide is an explicit `engine-mismatch` refusal. Neither is a silent pass. */
    const engineFindingsFor = (
      solve: readonly SolveResult[],
      kindByNo: ReadonlyMap<number, string> = new Map(),
    ): CheckFinding[] => [
      ...solveFindings(solve.filter(result => result.solvedAnswer !== '')),
      ...engineRefusalFindings(solve, kindByNo),
    ]

    /* The engine's verified answer is what the paper carries: stamp it onto the
       document as a new version before the check results close the stage. */
    const assertLive = (jobId: string, fence: PaperOperationFence): ManagedPaperJob => {
      const job = service.getJob(jobId)
      if (!fenceMatches(job, fence)) throw new PaperError(409, 'STALE_OPERATION', '本次操作已过期，未覆盖当前试卷')
      return job
    }
    const applyEngine = async (jobId: string, solve: readonly SolveResult[], fence: PaperOperationFence): Promise<PaperOperationFence> => {
      const job = assertLive(jobId, fence)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', '当前稿不存在')
      const corrected = applyEngineAnswers(job.document, solve)
      return corrected === undefined ? fence : operationFence(await service.commitEngineAnswers(jobId, corrected, fence))
    }

    const runDraft = async (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob): Promise<PaperOperationFence> => {
      assertLive(jobId, fence)
      const blueprint = service.blueprintForJob(job)
        if (job.specTable.length === 0) {
          throw new PaperError(409, 'SPEC_UNCONFIRMED', 'confirm the spec table before drafting')
        }
        /* Bank-assisted assembly: plan every row first and stamp it for
           audit, then each row is served verbatim → adapt → generate. */
        await service.reportProgress(jobId, 'plan', 0, 1, '规划题库供给', fence)
        const plans = service.bankPlanFor(job.specTable, job.request, bankPolicy, job.schoolId)
        await service.stampBankPlan(jobId, plans, fence)
        const planByNo = new Map(plans.map(plan => [plan.row.questionNo, plan]))

        const drafted = new Map<string, PaperQuestion[]>(job.draftCheckpoint?.specHash === fence.specHash
          ? job.draftCheckpoint.sections.map(section => [section.title, [...section.items]]) : [])
        const sections = [...rowsBySection(job)]
        for (const [sectionIndex, [sectionTitle, rows]] of sections.entries()) {
          assertLive(jobId, fence)
          await service.reportProgress(jobId, 'draft', sectionIndex, sections.length, `起草「${sectionTitle}」`, fence)
          const byNo = new Map<number, PaperQuestion>((drafted.get(sectionTitle) ?? []).map(question => [question.number, question]))
          const genRows: SpecRow[] = []
          const exemplars = new Map<string, BankItem>()
          for (const row of rows) {
            if (byNo.has(row.questionNo)) continue
            assertLive(jobId, fence)
            const plan = planByNo.get(row.questionNo)
            for (const ex of plan?.exemplars ?? []) exemplars.set(ex.id, ex)
            if (plan?.mode === 'verbatim' && plan.item !== undefined) {
              byNo.set(row.questionNo, questionFromBankItem(row, plan.item))
            } else if (plan?.mode === 'adapt' && plan.item !== undefined) {
              try {
                await service.reportProgress(jobId, 'adapt', sectionIndex, sections.length, `改编题库题（第${row.questionNo}题）`, fence)
                byNo.set(row.questionNo, await adaptBankItem(ctx, route, job, plan.item, row))
                await service.checkpointDraft(jobId, sectionTitle, [...byNo.values()], fence)
              } catch (error) {
                /* A failed adaptation degrades to generation — the row is
                   still served rather than failing the whole paper. */
                if (error instanceof PaperError && error.code === 'STALE_OPERATION') throw error
                ctx.logger.warn(`paper-host: adapt Q${row.questionNo} failed; generating this row once instead`)
                genRows.push(row)
              }
            } else {
              genRows.push(row)
            }
          }
          if (genRows.length > 0) {
            try {
              /* Draft in small batches. One call returning a whole section's
                 questions outgrew what the upstream will emit in a single
                 completion: a seven-question 单项选择题 section came back cut
                 mid-string at ~5.3k characters and the JSON parse failed, so
                 the section never landed. Asking for a few questions at a time
                 keeps every completion inside the response budget. */
              const BATCH = 3
              for (let start = 0; start < genRows.length; start += BATCH) {
                assertLive(jobId, fence)
                const batch = genRows.slice(start, start + BATCH)
                for (const q of await draftSection(
                  ctx, route, job, sectionTitle, batch, undefined, [...exemplars.values()], blueprint,
                )) byNo.set(q.number, q)
                await service.checkpointDraft(jobId, sectionTitle, [...byNo.values()], fence)
              }
            } catch (error) {
              /* Structural failure → one repair round with the error fed back. */
              if (error instanceof PaperError && error.code === 'STALE_OPERATION') throw error
              ctx.logger.warn(`paper-host: section '${sectionTitle}' draft invalid; one bounded repair`)
              const rounds = await service.spendRepairRound(jobId, fence)
              if (rounds > 2) throw new PaperError(422, 'DRAFT_FAILED',
                `板块「${sectionTitle}」已达到2轮修复上限；已完成批次保留，检查原稿或调整细目表后再试`)
              try {
                const missing = genRows.filter(row => !byNo.has(row.questionNo))
                for (const q of await draftSection(
                  ctx, route, job, sectionTitle, missing,
                  error instanceof Error ? error.message : String(error),
                  [...exemplars.values()], blueprint,
                )) byNo.set(q.number, q)
                await service.checkpointDraft(jobId, sectionTitle, [...byNo.values()], fence)
              } catch (retryError) {
                if (retryError instanceof PaperError && retryError.code === 'STALE_OPERATION') throw retryError
                ctx.logger.warn(`paper-host: section '${sectionTitle}' failed the bounded repair`)
                throw new PaperError(422, 'DRAFT_FAILED', `板块「${sectionTitle}」起草未完成，已完成批次保留；可显式重试未完成阶段`)
              }
            }
          }
          const items = rows.map(row => byNo.get(row.questionNo)).filter((q): q is PaperQuestion => q !== undefined)
          if (items.length !== rows.length) {
            ctx.logger.warn(`paper-host: section '${sectionTitle}' produced ${items.length}/${rows.length} questions — spec coverage check will flag the gap`)
          }
          drafted.set(sectionTitle, items)
          await service.checkpointDraft(jobId, sectionTitle, items, fence)
        }
        const titles = [...rowsBySection(job).keys()]
        await service.reportProgress(jobId, 'assemble', sections.length, sections.length, '组卷提交', fence)
        const committed = await service.commitDocument(jobId, assembleDocument(job, titles, drafted, blueprint), 'AI 起草', fence.version, fence)
        fence = operationFence(committed)
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
        return fence
    }

    const runChecks = async (jobId: string, fence: PaperOperationFence, checkedJob: ManagedPaperJob): Promise<void> => {
      let job = assertLive(jobId, fence)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${jobId} has no document`)
      await service.reportProgress(jobId, 'check', 0, 1, '规范与覆盖检查', fence)
      const questions = job.document.sections.flatMap(section => section.items)
      /* Unchanged questions may reuse only content-bound results. Legacy/unbound
         reports are never relabeled as current evidence. */
      const prior = new Map(checkedJob.solveReport.filter(result => result.questionHash !== undefined)
        .map(result => [result.questionNo, result]))
      const missing = questions.filter(question => prior.get(question.number)?.questionHash !== questionContentHash(question))
      const fresh = await independentSolve(missing, config.solveDelayMs, config.solveTimeoutMs, undefined,
        (done, total, questionNo) => { void service.reportProgress(jobId, 'solve', done, total,
          `物理引擎复核第 ${questionNo} 题`, fence) })
      const freshByNo = new Map(fresh.map(result => [result.questionNo, result]))
      const solve: BoundSolveResult[] = questions.map((question) => {
        const result = freshByNo.get(question.number) ?? prior.get(question.number)
        if (result === undefined) throw new PaperError(500, 'CHECK_COVERAGE', '独立解题没有覆盖当前题目')
        return { ...result, inputQuestionHash: result.inputQuestionHash ?? questionContentHash(question),
          questionHash: questionContentHash(question) }
      })
      fence = await applyEngine(jobId, solve, fence)
      job = assertLive(jobId, fence)
      if (job.document === undefined) throw new PaperError(409, 'NO_DOCUMENT', '当前稿不存在')
      const currentQuestions = job.document.sections.flatMap(section => section.items)
      const currentSolve = solve.map((result) => {
        const question = currentQuestions.find(item => item.number === result.questionNo)
        if (question === undefined) throw new PaperError(409, 'CHECK_COVERAGE', '解题结果含旧题号')
        return { ...result, questionHash: questionContentHash(question) }
      })
      const assets: CheckedFigureAsset[] = []
      if (currentQuestions.some(question => question.figure !== undefined)) {
        const drawing = await service.operationPhase(jobId, 'figure', fence)
        fence = operationFence(drawing)
        await service.reportProgress(jobId, 'figure', 0, 1, '验证并绘制题图（审稿版）', fence)
        const directory = join(config.exportDir, jobId)
        let figures: Map<string, string>
        try {
          figures = await generateFigures(
            { pandoc: config.pandoc, soffice: undefined, exportDir: config.exportDir, imageApi: config.imageApi },
            job.document, directory,
            (done, total) => { void service.reportProgress(jobId, 'figure', done, total, '绘制已校验题图', fence) },
            () => { ctx.logger.warn(`paper-host: ${jobId} figure validation failed`) },
          )
        } catch (error) {
          if (error instanceof PaperError && error.code === 'STALE_OPERATION') throw error
          throw new PaperError(422, 'FIGURE_CHECK_FAILED', '题图未通过验证，原稿已保留；请修正图规范后仅重试检查')
        }
        for (const question of currentQuestions) {
          if (question.figure === undefined) continue
          const path = figures.get(question.figure.ref)
          if (path === undefined) throw new PaperError(422, 'FIGURE_CHECK_FAILED', `第${question.number}题题图未产出`)
          const bytes = await readFile(join(directory, path))
          assets.push({ questionNo: question.number, questionHash: questionContentHash(question),
            inputHash: paperFigureInputHash(question), path,
            sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
      assertLive(jobId, fence)
      /* Engine answer corrections affect answer-format/marking checks, so run
         mechanical checks on the corrected current document, not the old draft. */
      const findings = service.runJobChecks(jobId, bankPolicy.freshnessPapers)
      await service.recordCheckResults(jobId,
        [...findings, ...engineFindingsFor(currentSolve, new Map(currentQuestions.map(question => [question.number, question.kind])))],
        currentSolve, fence, assets)
    }

    /* Single-question repair: record the teacher's verdict, revise the
       question through the model, commit a new version, then refresh
       mechanical findings and re-solve just that question — the rest of
       the solve report still describes unchanged stems and stays valid. */
    const runRepair = async (jobId: string, fence: PaperOperationFence, job: ManagedPaperJob): Promise<PaperOperationFence> => {
      const questionNo = job.operation?.questionNo
      const suggestion = job.operation?.suggestion
      const doc = job.document
      if (doc === undefined) throw new PaperError(409, 'NO_DOCUMENT', `job ${jobId} has no document`)
      const question = doc.sections.flatMap(section => section.items).find(item => item.number === questionNo)
      if (question === undefined || suggestion === undefined) throw new PaperError(404, 'NO_QUESTION', '修订题号或建议不存在')
      assertLive(jobId, fence)
      const checkpoint = job.questionCheckpoint?.kind === 'repair' && job.questionCheckpoint.questionNo === questionNo
        && job.questionCheckpoint.baseQuestionHash === questionContentHash(question) && job.questionCheckpoint.suggestion === suggestion
        ? job.questionCheckpoint : undefined
      const revised = checkpoint?.item ?? await repairQuestion(ctx, route, job, question, suggestion)
      if (checkpoint === undefined) await service.checkpointQuestion(jobId, { kind: 'repair', questionNo: question.number,
        baseQuestionHash: questionContentHash(question), suggestion, item: revised }, fence)
      const nextDoc = { ...doc, sections: doc.sections.map(section => ({ ...section,
        items: section.items.map(item => item.number === questionNo ? { ...revised, reviewNote: suggestion } : item),
      })) }
      return operationFence(await service.commitDocument(jobId, nextDoc, `第${questionNo}题按审核意见修订`, fence.version, fence))
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

    const runReplace = async (jobId: string, fence: PaperOperationFence, reserved: ManagedPaperJob): Promise<PaperOperationFence> => {
      const questionNo = reserved.operation?.questionNo
      if (questionNo === undefined) throw new PaperError(400, 'BAD_QUESTION', '换题需要题号')
      assertLive(jobId, fence)
      const current = assertLive(jobId, fence)
      const doc = current.document
      const original = doc?.sections.flatMap(section => section.items).find(question => question.number === questionNo)
      if (doc === undefined || original === undefined) throw new PaperError(404, 'NO_QUESTION', '换题原题不存在')
      let checkpoint = current.questionCheckpoint?.kind === 'replace' && current.questionCheckpoint.questionNo === questionNo
        && current.questionCheckpoint.baseQuestionHash === questionContentHash(original) ? current.questionCheckpoint : undefined
      if (checkpoint === undefined) {
        const { job, row, plan, item } = planReplace(jobId, questionNo)
        const replacement = plan.mode === 'verbatim' ? questionFromBankItem(row, item) : await adaptBankItem(ctx, route, job, item, row)
        checkpoint = { kind: 'replace', questionNo, baseQuestionHash: questionContentHash(original), item: replacement,
          bankItemId: item.id, bankMode: plan.mode === 'verbatim' ? 'verbatim' : 'adapted' }
        await service.checkpointQuestion(jobId, checkpoint, fence)
      }
      const replacement = checkpoint.item
      const nextDoc = { ...doc, sections: doc.sections.map(section => ({ ...section,
        items: section.items.map(question => question.number === questionNo
          ? { ...replacement, reviewNote: `题库换题（${reserved.operation?.reviewer ?? '教师'}）` } : question),
      })) }
      const committed = await service.commitDocument(jobId, nextDoc, `第${questionNo}题更换题库候选`, fence.version, fence)
      if (checkpoint.bankItemId !== undefined && checkpoint.bankMode !== undefined) {
        await service.recordBankUsage(checkpoint.bankItemId, jobId, checkpoint.bankMode)
      }
      return operationFence(committed)
    }

    const pipeline = new PaperPipeline(service, { draft: runDraft, check: runChecks, repair: runRepair, replace: runReplace },
      (jobId, code) => { trace(`operation ${jobId} failed ${code}`); ctx.logger.warn(`paper-host: ${jobId} ${code}`) })
    yield () => pipeline.close()

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
              check === 'mismatch' && result !== undefined ? result.solvedAnswer : undefined, service.bankContentHash(item))
          } catch (error) {
            await service.noteBankTriage(item.id, 'unresolved', undefined, service.bankContentHash(item)).catch(() => undefined)
            ctx.logger.warn(`paper-host: triage ${item.id} failed; outdated/reviewed items left unchanged`)
          }
        }
        ctx.logger.info(`paper-host: triage finished on ${targets.length} item(s)`)
      } finally {
        triageRunning = false
      }
    }

    const exporting = new Set<string>()
    const runExport = async (jobId: string): Promise<{ files: import('./export.ts').ExportFileSet }> => {
      if (exporting.has(jobId)) throw new PaperError(409, 'EXPORT_RUNNING', '该试卷正在导出，请勿重复发起')
      exporting.add(jobId)
      try {
        const { document, job } = service.requireApprovedDocument(jobId)
        const soffice = await binaryPresent(config.soffice)
        const files = await exportPaper(
          { pandoc: config.pandoc, soffice, exportDir: config.exportDir, imageApi: config.imageApi },
          jobId,
          document,
          job.solveReport,
          (stage, done, total, detail) => {
            void service.reportProgress(jobId, stage, done, total, detail)
          },
          { version: job.versions.at(-1)?.version, expectedDocumentHash: job.approval?.versionHash,
            figureAssets: job.figureAssets },
        )
        await service.recordExport(jobId, files)
        return { files }
      } catch (error) {
        /* A raw tool failure (missing pandoc/unzip/soffice, pandoc exit) used
           to surface as an opaque INTERNAL 500; name the failing step instead. */
        if (error instanceof PaperError) throw error
        throw new PaperError(500, 'EXPORT_FAILED',
          `导出失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        exporting.delete(jobId)
      }
    }

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/paper',
      handler: paperRoutes({
        service, exportDir: config.exportDir, bankPolicy,
        withUsageOwner: (actor, operation) => receipts.withOwner({ schoolId: actor.schoolId, userKey: actor.userKey }, operation),
        /* Resolved per request: this host is declared before auth-host, so the
           service does not exist yet when this line runs. */
        identity: () => identityOf(ctx),
        startOperation: (jobId, kind, input) => pipeline.start(jobId, kind, input),
        retryOperation: (jobId, expectedVersion) => pipeline.retry(jobId, expectedVersion),
        planReplace, runExport, runIngest,
        runImageIngest,
        planTriage: (input, schoolId) => service.planBankTriage(input, schoolId),
        runTriage, triageBusy,
      }),
    })
  }, 'paper-host')
}
