/**
 * REST surface for the 出卷专区 — one `/physicsos/paper` prefix route on the
 * webServer service dispatching to PaperService operations. All bodies are
 * JSON; file downloads stream from the job's export dir; every rule failure
 * surfaces as a structured `{error:{code,message}}` with its HTTP status.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { PaperError, type PaperService } from './service.ts'
import type { ExportFileSet } from './export.ts'
import {
  annotationWire, bankItemPatchWire, bankItemWire, blueprintWire, jobCreateWire, paperDocumentWire,
  sourcePaperWire, specTableWire,
} from './domain.ts'
import type { IngestInput } from './ingest.ts'
import type {
  BankSelectionPolicy, PaperDocument, PaperRequest, ReviewStatus,
} from '@physicsos/question-paper'

const REVIEW_STATUSES: readonly ReviewStatus[] = ['pending', 'verified', 'rejected']

/**
 * Bank review-status filter. An unrecognised value is a client error rather
 * than a silently ignored filter — the old `as never` cast both defeated the
 * type check and made every typo return the unfiltered list.
 */
const reviewStatusOf = (value: string | null): ReviewStatus | undefined => {
  if (value === null) return undefined
  const match = REVIEW_STATUSES.find(status => status === value)
  if (match === undefined) throw new PaperError(400, 'BAD_QUERY', `未知的题库状态：${value}`)
  return match
}

/** Upper bound on one batch review, so a single request cannot pin the loop. */
const BATCH_REVIEW_LIMIT = 500

/** Downloadable file whitelist — nothing else under the export dir serves. */
const FILE_NAMES = new Set(['试卷.pdf', '试卷.docx', '答案解析.pdf', '答案解析.docx'])

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof PaperError) {
    send(res, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } })
}

/** Path segment `index`; a shorter path than the route matched answers 400. */
const segment = (parts: readonly string[], index: number): string => {
  const value = parts[index]
  if (value === undefined) throw new PaperError(400, 'BAD_ROUTE', '路径缺少参数')
  return value
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PaperError(400, 'BAD_JSON', 'request body is not valid JSON')
  }
}

/** Route deps the handlers close over. */
export interface RouteDeps {
  readonly service: PaperService
  /** Export-root resolver for file downloads. */
  readonly exportDir: string
  /** Draft+check driver wired by the plugin. */
  readonly runDraft: (jobId: string) => Promise<void>
  readonly runChecks: (jobId: string) => Promise<void>
  /** Single-question revision driven by the teacher's suggestion. */
  readonly runRepair: (jobId: string, questionNo: number, suggestion: string, reviewer: string) => Promise<void>
  /** Swap a printed question for the next-best bank candidate. */
  readonly runReplace: (jobId: string, questionNo: number, reviewer: string) => Promise<void>
  /** Sync half of a swap — throws NO_CANDIDATE before the 202 is answered. */
  readonly planReplace: (jobId: string, questionNo: number) => unknown
  readonly runExport: (jobId: string) => Promise<{ files: ExportFileSet }>
  /** Pasted-text ingest: model call plus durable write, awaited in-band. */
  readonly runIngest: (input: IngestInput) => Promise<{ created: unknown[]; duplicates: string[] }>
  /** Resolved selection policy for the assembly-plan preview. */
  readonly bankPolicy: BankSelectionPolicy
}

type Body = Record<string, unknown>
const str = (body: Body, key: string): string =>
  typeof body[key] === 'string' && (body[key]).length > 0 ? body[key] : ''

interface WireSchema<T> { parse(data: unknown): T }
/* Wire bodies hit the durable domain verbatim; validate at the boundary —
   a malformed row written through would fail domain-open schema checks on
   the next boot. */
const parse = <T>(schema: WireSchema<T>, data: unknown): T => {
  try {
    return schema.parse(data)
  } catch (error) {
    throw new PaperError(400, 'BAD_BODY', error instanceof Error ? error.message : String(error))
  }
}

/**
 * The `/physicsos/paper` prefix handler.
 * @param deps - service, export root, and the three async drivers.
 * @returns the webServer route handler.
 */
export function paperRoutes(deps: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { service } = deps
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/paper/, '') || '/'
      const method = req.method ?? 'GET'
      const seg = path.split('/').filter(Boolean)

      /* --- 原卷与考点录入 --- */
      if (method === 'GET' && path === '/sources') {
        send(res, 200, service.listSources())
        return
      }
      if (method === 'POST' && path === '/sources') {
        const body = await readJson(req)
        send(res, 201, await service.addSource(parse(sourcePaperWire, body)))
        return
      }
      if (method === 'GET' && path === '/annotations') {
        send(res, 200, service.listAnnotations(url.searchParams.get('source') ?? undefined))
        return
      }
      if (method === 'POST' && seg[0] === 'sources' && seg[2] === 'annotations') {
        const body = await readJson(req)
        send(res, 201, await service.addAnnotation(
          parse(annotationWire, { ...(body as object), sourcePaperId: seg[1] })))
        return
      }
      if (method === 'POST' && seg[0] === 'sources' && seg[2] === 'verify') {
        const body = await readJson(req) as Body
        send(res, 200, await service.reviewSource(segment(seg, 1), 'verified', str(body, 'reviewer')))
        return
      }
      if (method === 'POST' && seg[0] === 'annotations' && seg[2] === 'review') {
        const body = await readJson(req) as Body
        const status = body['status'] === 'verified' ? 'verified' : body['status'] === 'rejected' ? 'rejected' : 'pending'
        send(res, 200, await service.reviewAnnotation(segment(seg, 1), status))
        return
      }
      if (method === 'GET' && path === '/stats') {
        send(res, 200, service.annotationStats(url.searchParams.get('source') ?? undefined))
        return
      }
      if (method === 'POST' && path === '/import/csv') {
        const body = await readJson(req) as Body
        const csv = typeof body['csv'] === 'string' ? body['csv'] : ''
        const rows = csv.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('题号'))
        /* Parse every row before writing any — a bad row rejects the whole
           import instead of leaving a misleading partial import behind. */
        const parsed = []
        for (const [index, line] of rows.entries()) {
          const [questionNo, subjectName, qkind, score, primary, secondary, ability, page] = line.split(/[,\t]/).map(cell => cell.trim())
          if (questionNo === undefined || primary === undefined) continue
          try {
            parsed.push(parse(annotationWire, {
              id: `${str(body, 'sourcePaperId')}-${questionNo}`,
              sourcePaperId: str(body, 'sourcePaperId'),
              questionNo,
              subject: subjectName === '化学' || subjectName === 'chemistry' ? 'chemistry' : 'physics',
              kind: qkind === '' || qkind === undefined ? 'choice-single' : qkind,
              score: Number(score) || 1,
              knowledgePrimary: primary,
              knowledgeSecondary: (secondary ?? '').split(/[;；]/).filter(Boolean),
              ability: ability === '' || ability === undefined ? '应用' : ability,
              pageNo: page === '' || page === undefined ? undefined : Number(page),
              answerSource: 'manual-transcript',
              reviewer: str(body, 'reviewer') || 'entry',
            }))
          } catch (error) {
            throw new PaperError(400, 'BAD_BODY', `CSV 第 ${index + 1} 行：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        for (const row of parsed) {
          await service.addAnnotation(row)
        }
        send(res, 201, { created: parsed.length })
        return
      }

      /* --- 题库 --- */
      if (method === 'GET' && path === '/bank/items') {
        send(res, 200, service.listBankItems({
          status: reviewStatusOf(url.searchParams.get('status')),
          level: url.searchParams.get('level') ?? undefined,
          kind: url.searchParams.get('kind') ?? undefined,
        }))
        return
      }
      if (method === 'POST' && path === '/bank/items') {
        const body = await readJson(req)
        send(res, 201, await service.addBankItem(parse(bankItemWire, body)))
        return
      }
      if (method === 'POST' && path === '/bank/ingest') {
        const body = await readJson(req) as Body
        const text = str(body, 'text')
        if (text.length === 0) throw new PaperError(400, 'BAD_REQUEST', 'ingest needs pasted question text')
        const level = body['level'] === 'gaokao' ? 'gaokao' : 'zhongkao'
        const subject = body['subject'] === 'chemistry' ? 'chemistry' : 'physics'
        send(res, 200, await deps.runIngest({
          text, level, subject,
          sourceUrl: str(body, 'sourceUrl') || undefined,
          sourcePaperId: str(body, 'sourcePaperId') || undefined,
          enteredBy: str(body, 'enteredBy') || 'ingest',
        }))
        return
      }
      if (method === 'PUT' && seg[0] === 'bank' && seg[1] === 'items' && seg.length === 3) {
        const body = await readJson(req)
        send(res, 200, await service.updateBankItem(
          segment(seg, 2), parse(bankItemPatchWire, body)))
        return
      }
      if (method === 'POST' && seg[0] === 'bank' && seg[1] === 'items' && seg[2] === 'review-batch') {
        const body = await readJson(req) as Body
        const raw = body['ids']
        const ids = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
        if (ids.length === 0) throw new PaperError(400, 'BAD_BODY', 'ids 不能为空')
        if (ids.length > BATCH_REVIEW_LIMIT) {
          throw new PaperError(400, 'BATCH_TOO_LARGE', `一次最多核验 ${BATCH_REVIEW_LIMIT} 条，请分批提交`)
        }
        const status = body['status'] === 'verified' ? 'verified' : body['status'] === 'rejected' ? 'rejected' : 'pending'
        send(res, 200, await service.reviewBankItems(ids, status, str(body, 'reviewer') || 'reviewer'))
        return
      }
      if (method === 'POST' && seg[0] === 'bank' && seg[1] === 'items' && seg[3] === 'review') {
        const body = await readJson(req) as Body
        const status = body['status'] === 'verified' ? 'verified' : body['status'] === 'rejected' ? 'rejected' : 'pending'
        send(res, 200, await service.reviewBankItem(segment(seg, 2), status, str(body, 'reviewer') || 'reviewer'))
        return
      }
      if (method === 'GET' && seg[0] === 'bank' && seg[1] === 'items' && seg[3] === 'usage') {
        send(res, 200, service.bankUsageFor(segment(seg, 2)))
        return
      }

      /* --- 结构模板 --- */
      if (method === 'GET' && path === '/blueprints') {
        send(res, 200, service.listBlueprints())
        return
      }
      if (method === 'POST' && path === '/blueprints') {
        const body = await readJson(req) as Body
        send(res, 201, await service.addBlueprint(parse(blueprintWire, body)))
        return
      }
      if (method === 'POST' && seg[0] === 'blueprints' && seg[2] === 'verify') {
        send(res, 200, await service.verifyBlueprint(segment(seg, 1)))
        return
      }

      /* --- 试卷任务 --- */
      if (method === 'GET' && path === '/jobs') {
        send(res, 200, service.listJobs((url.searchParams.get('status') ?? undefined) as never))
        return
      }
      if (method === 'POST' && path === '/jobs') {
        const body = await readJson(req)
        send(res, 201, await service.createJob(
          parse<{ blueprintId: string; request: PaperRequest }>(jobCreateWire, body)))
        return
      }
      if (method === 'GET' && seg[0] === 'jobs' && seg.length === 2) {
        send(res, 200, service.getJob(segment(seg, 1)))
        return
      }
      if (method === 'PUT' && seg[0] === 'jobs' && seg[2] === 'spec') {
        const body = await readJson(req) as Body
        send(res, 200, await service.confirmSpec(segment(seg, 1), parse(specTableWire, body['specTable'])))
        return
      }
      /* Live assembly preview: how the confirmed spec table would be served
         by the bank right now — per-row mode, candidate count, chosen item.
         Recomputed on each call so bank edits show immediately. */
      if (method === 'GET' && seg[0] === 'jobs' && seg[2] === 'bank-plan') {
        const job = service.getJob(segment(seg, 1))
        const plans = service.bankPlanFor(job.specTable, job.request, deps.bankPolicy)
        send(res, 200, plans.map(plan => ({
          questionNo: plan.row.questionNo,
          sectionTitle: plan.row.sectionTitle,
          mode: plan.mode,
          candidates: plan.candidates,
          candidateScore: plan.candidateScore,
          item: plan.item === undefined ? undefined : {
            id: plan.item.id,
            sourceLabel: plan.item.sourceLabel,
            sourceQuestionNo: plan.item.sourceQuestionNo,
            stem: plan.item.stem.slice(0, 120),
          },
        })))
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'draft') {
        /* Draft runs long: answer 202 and let the client poll the job —
           the driver marks the job 'failed' with its error on rejection. */
        void deps.runDraft(segment(seg, 1)).catch((error: unknown) => {
          console.error(`[paper-host] draft ${seg[1]} failed:`, error)
        })
        send(res, 202, { status: 'drafting' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'check') {
        void deps.runChecks(segment(seg, 1)).catch((error: unknown) => {
          console.error(`[paper-host] check ${seg[1]} failed:`, error)
        })
        send(res, 202, { status: 'checking' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'repair') {
        const body = await readJson(req) as Body
        const suggestion = str(body, 'suggestion')
        if (suggestion === '') throw new PaperError(400, 'BAD_REQUEST', 'repair needs a suggestion')
        void deps.runRepair(segment(seg, 1), Number(seg[3]), suggestion, str(body, 'reviewer')).catch((error: unknown) => {
          console.error(`[paper-host] repair ${seg[1]}#${seg[3]} failed:`, error)
        })
        send(res, 202, { status: 'repairing' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'replace') {
        const body = await readJson(req) as Body
        /* Validate first — a row with no spare candidate answers 404
           synchronously instead of vanishing into the async driver. */
        deps.planReplace(segment(seg, 1), Number(seg[3]))
        void deps.runReplace(segment(seg, 1), Number(seg[3]), str(body, 'reviewer')).catch((error: unknown) => {
          console.error(`[paper-host] replace ${seg[1]}#${seg[3]} failed:`, error)
        })
        send(res, 202, { status: 'replacing' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'review') {
        const body = await readJson(req) as Body
        send(res, 200, await service.reviewQuestion(
          segment(seg, 1), Number(seg[3]),
          body['verdict'] === 'approved' ? 'approved' : 'changes-requested',
          str(body, 'reviewer'),
          body['note'] as string | undefined,
        ))
        return
      }
      if (method === 'PUT' && seg[0] === 'jobs' && seg[2] === 'document') {
        const body = await readJson(req) as Body
        send(res, 200, await service.commitDocument(
          segment(seg, 1), parse<PaperDocument>(paperDocumentWire, body['document']), str(body, 'summary') || 'edit',
          typeof body['expectedVersion'] === 'number' ? body['expectedVersion'] : undefined,
        ))
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'approve') {
        const body = await readJson(req) as Body
        send(res, 200, await service.approve(
          segment(seg, 1), str(body, 'reviewer'),
          body['subject'] === 'chemistry' ? 'chemistry' : 'physics',
        ))
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'export') {
        send(res, 200, await deps.runExport(segment(seg, 1)))
        return
      }
      if (method === 'GET' && seg[0] === 'jobs' && seg[2] === 'files') {
        const name = decodeURIComponent(seg[3] ?? '')
        if (!FILE_NAMES.has(name)) throw new PaperError(404, 'NO_FILE', 'no such export file')
        const file = join(deps.exportDir, segment(seg, 1), normalize(name))
        const content = await readFile(file).catch(() => undefined)
        if (content === undefined) throw new PaperError(404, 'NO_FILE', `file '${name}' not produced`)
        res.writeHead(200, {
          'content-type': MIME[extname(name)] ?? 'application/octet-stream',
          'content-length': content.length,
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        })
        res.end(content)
        return
      }
      if (method === 'GET' && path === '/exports') {
        send(res, 200, service.listExports())
        return
      }

      send(res, 404, { error: { code: 'NO_ROUTE', message: `${method} ${path}` } })
    } catch (error) {
      sendError(res, error)
    }
  }
}
