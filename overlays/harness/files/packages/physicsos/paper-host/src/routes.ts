/**
 * REST surface for the 出卷专区 — one `/physicsos/paper` prefix route on the
 * webServer service dispatching to PaperService operations. All bodies are
 * JSON; file downloads stream from the job's export dir; every rule failure
 * surfaces as a structured `{error:{code,message}}` with its HTTP status.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { PaperError, type PaperService } from './service.ts'
import { auditWrites, guard, type PhysicsosIdentity } from './identity.ts'
import { canManagePaperRecord, canReadPaperRecord, schoolScopeOf } from './scope.ts'
import type { ExportFileSet } from './export.ts'
import {
  annotationWire, bankItemPatchWire, bankItemWire, blueprintWire, jobCreateWire, paperDocumentWire,
  sourcePaperWire, specTableWire,
} from './domain.ts'
import type { IngestInput } from './ingest.ts'
import type { TranscribeImage } from './transcribe.ts'
import type {
  BankItem, BankSelectionPolicy, KnowledgeAnnotation, PaperDocument, PaperRequest, ReviewStatus, SourcePaper,
} from '@physicsos/question-paper'

const REVIEW_STATUSES: readonly ReviewStatus[] = ['pending', 'verified', 'rejected']
const STUDENT_READS = new Set(['/sources', '/annotations', '/bank/items'])

const safeSourceRef = (value: string): string => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

const studentSource = (source: SourcePaper) => ({
  id: source.id, level: source.level, subject: source.subject, year: source.year,
  examName: source.examName, evidenceTier: source.evidenceTier, sourceRef: safeSourceRef(source.sourceRef),
  pageCount: source.pageCount, totalScore: source.totalScore, minutes: source.minutes,
  region: source.region, school: source.school, kind: source.kind, featured: source.featured,
  enteredBy: '', status: source.status, enteredAt: source.enteredAt,
})

const studentAnnotation = (annotation: KnowledgeAnnotation) => ({
  id: annotation.id, sourcePaperId: annotation.sourcePaperId, pageNo: annotation.pageNo,
  questionNo: annotation.questionNo, subject: annotation.subject, kind: annotation.kind,
  score: annotation.score, knowledgePrimary: annotation.knowledgePrimary,
  knowledgeSecondary: annotation.knowledgeSecondary, ability: annotation.ability,
  experimentType: annotation.experimentType, chapter: annotation.chapter, stem: annotation.stem,
  answerSource: annotation.answerSource, reviewer: '', status: annotation.status,
})

const studentBankItem = (item: BankItem) => ({
  id: item.id, level: item.level, subject: item.subject, kind: item.kind,
  knowledge: item.knowledge, ability: item.ability, difficulty: item.difficulty,
  chapter: item.chapter, score: item.score, stem: item.stem, options: item.options,
  subQuestions: item.subQuestions, figure: item.figure, answer: item.answer,
  answerTier: item.answerTier, anomalies: [], reuseModes: item.reuseModes, status: 'verified' as const,
})

/** One 图片录入 request may carry this many pages; a whole 卷 is 4–6. */
const MAX_INGEST_IMAGES = 8
const BODY_LIMIT = 64 * 1024 * 1024

/** Media types the attachment store accepts, mirrored for wire validation. */
const INGEST_IMAGE_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

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
/** Question figures pre-generated at check time (`fig-<ref>.png`), served so
 *  the review UI can show the actual drawing next to each question. Model refs
 *  may carry any non-separator character (e.g. `fig:15`); only path
 *  separators are excluded — `normalize` plus the job-id scoping contain the
 *  rest. */
const FIGURE_NAME = /^fig-[^/\\]+\.png$/

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
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
  send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}

/** Path segment `index`; a shorter path than the route matched answers 400. */
const segment = (parts: readonly string[], index: number): string => {
  const value = parts[index]
  if (value === undefined) throw new PaperError(400, 'BAD_ROUTE', '路径缺少参数')
  return value
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT) {
    throw new PaperError(413, 'BODY_TOO_LARGE', 'request body exceeds the allowed size')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) {
      throw new PaperError(413, 'BODY_TOO_LARGE', 'request body exceeds the allowed size')
    }
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PaperError(400, 'BAD_JSON', 'request body is not valid JSON')
  }
}

const checkCsrf = (req: IncomingMessage): void => {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string'
    || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new PaperError(400, 'BAD_CONTENT_TYPE', 'content-type must be application/json')
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (typeof origin !== 'string' || new URL(origin).host !== req.headers.host) {
        throw new PaperError(403, 'FORBIDDEN', 'cross-site request refused')
      }
    } catch (error) {
      if (error instanceof PaperError) throw error
      throw new PaperError(403, 'FORBIDDEN', 'cross-site request refused')
    }
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new PaperError(403, 'FORBIDDEN', 'cross-site request refused')
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
  /**
   * 图片/扫描件录入: vision transcription plus the same structuring pipeline,
   * awaited in-band; the transcription rides back so the UI can show what was
   * read before the teacher verifies the rows.
   */
  readonly runImageIngest: (input: {
    images: readonly TranscribeImage[]
    level: IngestInput['level']
    subject: IngestInput['subject']
    sourceUrl?: string
    enteredBy: string
    schoolId: string | null
  }) => Promise<{ created: unknown[]; duplicates: string[]; transcription: string }>
  /** Sync half of engine triage: pick the pending rows to solve, never mutates. */
  readonly planTriage: (input: { ids?: readonly string[]; limit?: number }, schoolId?: string | null) => {
    targets: BankItem[]
    missing: string[]
    skipped: string[]
  }
  /** Async half: blind-solve each target and stamp `engine-check:*` anomalies. */
  readonly runTriage: (targets: readonly BankItem[]) => Promise<void>
  /** True while a triage pass is solving — a second run would double-spend. */
  readonly triageBusy: () => boolean
  /** Resolved selection policy for the assembly-plan preview. */
  readonly bankPolicy: BankSelectionPolicy
  /**
   * Resolver for the 账户体系's identity service.
   *
   * A GETTER rather than the service itself, because this host is declared
   * BEFORE auth-host in the bundle and would look it up before it exists. Asking
   * per request costs one property read and removes the load-order coupling
   * entirely.
   *
   * It may still answer `undefined` — a stripped composition, a test harness,
   * a half-configured deployment. That is not an error at load: the host mounts,
   * and every request is refused with a message naming what is missing, which is
   * far better than the alternative of quietly serving the question bank.
   */
  readonly identity: () => PhysicsosIdentity | undefined
}

type Body = Record<string, unknown>
const str = (body: Body, key: string): string =>
  typeof body[key] === 'string' && (body[key]).length > 0 ? body[key] : ''

const reviewStatusBody = (body: Body): ReviewStatus => {
  const status = typeof body['status'] === 'string' ? reviewStatusOf(body['status']) : undefined
  if (status === undefined) throw new PaperError(400, 'BAD_BODY', 'status must be pending, verified, or rejected')
  return status
}

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
  const { service, identity: identityOf } = deps
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/paper/, '') || '/'
      const method = req.method ?? 'GET'
      const seg = path.split('/').filter(Boolean)

      /* THE gate, in front of every route below it: reads need a session,
         writes need a teacher. It sits here rather than in each branch so a
         route added tomorrow is guarded by construction — the failure mode this
         replaces is thirty routes each remembering, and the thirty-first. */
      const identity = identityOf()
      const { actor, writes } = guard(identity, req, method)
      const jobForActor = (id: string) => {
        const job = service.getJob(id)
        if (!canManagePaperRecord(actor, job)) throw new PaperError(404, 'NOT_FOUND', 'not found')
        return job
      }
      if (actor.role === 'STUDENT' && !(method === 'GET' && STUDENT_READS.has(path))) {
        throw new PaperError(403, 'FORBIDDEN', '学生只能读取已核验题库与真题目录')
      }
      if (writes) checkCsrf(req)
      if (writes && identity !== undefined) {
        /* Captured in a local so the ledger write does not need an assertion:
           `guard` has already refused the request if the service is missing, and
           narrowing here says so in the type system too. */
        const ledger = identity
        res.on('finish', () => {
          /* Fire-and-forget: the response is already out, and a ledger write
             that failed must not retroactively fail the action it recorded. */
          void auditWrites(ledger, actor, req, res, path).catch(() => undefined)
        })
      }

      /* --- 原卷与考点录入 --- */
      if (method === 'GET' && path === '/sources') {
        const sources = service.listSources().filter(source => canReadPaperRecord(actor, source))
        send(res, 200, actor.role === 'STUDENT' ? sources.map(studentSource) : sources)
        return
      }
      if (method === 'POST' && path === '/sources') {
        const input = parse(sourcePaperWire, await readJson(req))
        send(res, 201, await service.addSource({
          ...input, enteredBy: actor.userKey, schoolId: schoolScopeOf(actor),
        }))
        return
      }
      if (method === 'GET' && path === '/annotations') {
        const sourceId = url.searchParams.get('source') ?? undefined
        const visibleSources = new Set(service.listSources()
          .filter(source => canReadPaperRecord(actor, source))
          .map(source => source.id))
        const annotations = service.listAnnotations(sourceId).filter(annotation =>
          visibleSources.has(annotation.sourcePaperId) && canReadPaperRecord(actor, annotation))
        send(res, 200, actor.role === 'STUDENT' ? annotations.map(studentAnnotation) : annotations)
        return
      }
      if (method === 'POST' && seg[0] === 'sources' && seg[2] === 'annotations') {
        const sourceId = segment(seg, 1)
        const source = service.listSources().find(row => row.id === sourceId)
        if (source === undefined || !canManagePaperRecord(actor, source)) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        const body = await readJson(req)
        const input = parse(annotationWire, {
          ...(body as object), sourcePaperId: sourceId, reviewer: actor.userKey,
        })
        send(res, 201, await service.addAnnotation({ ...input, schoolId: source.schoolId ?? null }))
        return
      }
      if (method === 'POST' && seg[0] === 'sources' && seg[2] === 'verify') {
        const sourceId = segment(seg, 1)
        const source = service.listSources().find(row => row.id === sourceId)
        if (source === undefined || !canManagePaperRecord(actor, source)) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        await readJson(req)
        send(res, 200, await service.reviewSource(sourceId, 'verified', actor.userKey))
        return
      }
      if (method === 'POST' && seg[0] === 'annotations' && seg[2] === 'review') {
        const id = segment(seg, 1)
        const annotation = service.listAnnotations().find(row => row.id === id)
        if (annotation === undefined || !canManagePaperRecord(actor, annotation)) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        const body = await readJson(req) as Body
        const status = reviewStatusBody(body)
        send(res, 200, await service.reviewAnnotation(id, status))
        return
      }
      if (method === 'GET' && path === '/stats') {
        send(res, 200, service.annotationStats(
          url.searchParams.get('source') ?? undefined, schoolScopeOf(actor)))
        return
      }
      if (method === 'POST' && path === '/import/csv') {
        const body = await readJson(req) as Body
        const sourcePaperId = str(body, 'sourcePaperId')
        const source = service.listSources().find(row => row.id === sourcePaperId)
        if (source === undefined || !canManagePaperRecord(actor, source)) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        const csv = typeof body['csv'] === 'string' ? body['csv'] : ''
        const rows = csv.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('题号'))
        /* Parse every row before writing any — a bad row rejects the whole
           import instead of leaving a misleading partial import behind. */
        const parsed = []
        for (const [index, line] of rows.entries()) {
          const [questionNo, subjectName, qkind, score, primary, secondary, ability, page] = line.split(/[,\t]/).map(cell => cell.trim())
          if (questionNo === undefined || primary === undefined) continue
          try {
            const row = parse(annotationWire, {
              id: `${sourcePaperId}-${questionNo}`,
              sourcePaperId,
              questionNo,
              subject: subjectName === '化学' || subjectName === 'chemistry' ? 'chemistry' : 'physics',
              kind: qkind === '' || qkind === undefined ? 'choice-single' : qkind,
              score: Number(score) || 1,
              knowledgePrimary: primary,
              knowledgeSecondary: (secondary ?? '').split(/[;；]/).filter(Boolean),
              ability: ability === '' || ability === undefined ? '应用' : ability,
              pageNo: page === '' || page === undefined ? undefined : Number(page),
              answerSource: 'manual-transcript',
              reviewer: actor.userKey,
            })
            parsed.push({ ...row, schoolId: source.schoolId ?? null })
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
        const items = service.listBankItems({
          status: actor.role === 'STUDENT' ? 'verified' : reviewStatusOf(url.searchParams.get('status')),
          level: url.searchParams.get('level') ?? undefined,
          kind: url.searchParams.get('kind') ?? undefined,
        }, schoolScopeOf(actor)).filter(item => canReadPaperRecord(actor, item))
        send(res, 200, actor.role === 'STUDENT' ? items.map(studentBankItem) : items)
        return
      }
      if (method === 'POST' && path === '/bank/items') {
        const input = parse(bankItemWire, await readJson(req))
        if (input.sourcePaperId !== undefined) {
          const source = service.listSources().find(row => row.id === input.sourcePaperId)
          if (source === undefined || !canReadPaperRecord(actor, source)) {
            throw new PaperError(404, 'NOT_FOUND', 'not found')
          }
        }
        send(res, 201, await service.addBankItem({
          ...input, enteredBy: actor.userKey, schoolId: schoolScopeOf(actor),
        }))
        return
      }
      if (method === 'POST' && path === '/bank/ingest') {
        const body = await readJson(req) as Body
        const text = str(body, 'text')
        if (text.length === 0) throw new PaperError(400, 'BAD_REQUEST', 'ingest needs pasted question text')
        const level = body['level'] === 'gaokao' ? 'gaokao' : 'zhongkao'
        const subject = body['subject'] === 'chemistry' ? 'chemistry' : 'physics'
        const sourcePaperId = str(body, 'sourcePaperId') || undefined
        if (sourcePaperId !== undefined) {
          const source = service.listSources().find(row => row.id === sourcePaperId)
          if (source === undefined || !canReadPaperRecord(actor, source)) {
            throw new PaperError(404, 'NOT_FOUND', 'not found')
          }
        }
        send(res, 200, await deps.runIngest({
          text, level, subject, schoolId: schoolScopeOf(actor),
          sourceUrl: str(body, 'sourceUrl') || undefined,
          sourcePaperId, enteredBy: actor.userKey,
        }))
        return
      }
      /* 图片/扫描件录入: base64 images in, transcription + pending rows out.
         In-band like the paste path — the teacher is waiting on one artifact. */
      if (method === 'POST' && path === '/bank/ingest-image') {
        const body = await readJson(req) as Body
        const rawImages = body['images']
        if (!Array.isArray(rawImages) || rawImages.length === 0) {
          throw new PaperError(400, 'BAD_REQUEST', 'ingest-image needs at least one image')
        }
        if (rawImages.length > MAX_INGEST_IMAGES) {
          throw new PaperError(400, 'TOO_MANY_IMAGES', `一次最多 ${MAX_INGEST_IMAGES} 张图片`)
        }
        const images: TranscribeImage[] = []
        for (const entry of rawImages) {
          const item = entry as Record<string, unknown>
          const data = typeof item['data'] === 'string' ? item['data'] : ''
          const mediaType = item['mediaType']
          if (data === '' || !INGEST_IMAGE_TYPES.includes(mediaType as ImageMediaType)) {
            throw new PaperError(400, 'BAD_REQUEST', 'each image needs base64 data and a supported mediaType')
          }
          images.push({
            data: Buffer.from(data, 'base64'),
            mediaType: mediaType as ImageMediaType,
            ...typeof item['name'] === 'string' && item['name'] !== '' ? { name: item['name'] } : {},
          })
        }
        const level = body['level'] === 'gaokao' ? 'gaokao' : 'zhongkao'
        const subject = body['subject'] === 'chemistry' ? 'chemistry' : 'physics'
        send(res, 200, await deps.runImageIngest({
          images, level, subject,
          sourceUrl: str(body, 'sourceUrl') || undefined,
          enteredBy: actor.userKey,
          schoolId: schoolScopeOf(actor),
        }))
        return
      }
      if (method === 'PUT' && seg[0] === 'bank' && seg[1] === 'items' && seg.length === 3) {
        const id = segment(seg, 2)
        if (!canManagePaperRecord(actor, service.getBankItem(id))) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        const body = await readJson(req)
        send(res, 200, await service.updateBankItem(id, parse(bankItemPatchWire, body)))
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
        const byId = new Map(service.listBankItems().map(item => [item.id, item]))
        if (ids.some((id) => {
          const item = byId.get(id)
          return item !== undefined && !canManagePaperRecord(actor, item)
        })) throw new PaperError(404, 'NOT_FOUND', 'not found')
        const status = reviewStatusBody(body)
        send(res, 200, await service.reviewBankItems(ids, status, actor.userKey))
        return
      }
      /* Engine triage: blind-solve pending rows and stamp `engine-check:*`
         anomalies so the reviewer can sort the wheat before reading. The plan
         runs in-band (it is the validation), the solving runs detached. */
      if (method === 'POST' && seg[0] === 'bank' && seg[1] === 'items' && seg[2] === 'triage') {
        const body = await readJson(req) as Body
        if (deps.triageBusy()) {
          throw new PaperError(409, 'TRIAGE_RUNNING', '一轮引擎初筛正在进行中，等它跑完再发起')
        }
        const rawIds = body['ids']
        const ids = Array.isArray(rawIds) ? rawIds.filter((v): v is string => typeof v === 'string') : undefined
        const limit = typeof body['limit'] === 'number' && body['limit'] > 0 ? body['limit'] : undefined
        const plan = deps.planTriage({ ids, limit }, schoolScopeOf(actor))
        if (plan.targets.length === 0) {
          throw new PaperError(400, 'NOTHING_PENDING', '没有可初筛的待核验条目')
        }
        void deps.runTriage(plan.targets).catch((error: unknown) => {
          console.error('[paper-host] bank triage failed:', error)
        })
        send(res, 202, {
          status: 'triaging',
          accepted: plan.targets.length,
          missing: plan.missing,
          skipped: plan.skipped,
        })
        return
      }
      if (method === 'POST' && seg[0] === 'bank' && seg[1] === 'items' && seg[3] === 'review') {
        const id = segment(seg, 2)
        if (!canManagePaperRecord(actor, service.getBankItem(id))) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        const body = await readJson(req) as Body
        const status = reviewStatusBody(body)
        send(res, 200, await service.reviewBankItem(id, status, actor.userKey))
        return
      }
      if (method === 'GET' && seg[0] === 'bank' && seg[1] === 'items' && seg[3] === 'usage') {
        const item = service.getBankItem(segment(seg, 2))
        if (!canReadPaperRecord(actor, item)) throw new PaperError(404, 'NOT_FOUND', 'not found')
        send(res, 200, service.bankUsageFor(item.id, schoolScopeOf(actor)))
        return
      }

      /* --- 结构模板 --- */
      if (method === 'GET' && path === '/blueprints') {
        send(res, 200, service.listBlueprints().filter(row => canReadPaperRecord(actor, row)))
        return
      }
      if (method === 'POST' && path === '/blueprints') {
        const input = parse(blueprintWire, await readJson(req))
        send(res, 201, await service.addBlueprint({ ...input, schoolId: schoolScopeOf(actor) }))
        return
      }
      if (method === 'POST' && seg[0] === 'blueprints' && seg[2] === 'verify') {
        const id = segment(seg, 1)
        const blueprint = service.listBlueprints().find(row => row.id === id)
        if (blueprint !== undefined && !canManagePaperRecord(actor, blueprint)) {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        if (blueprint === undefined && actor.role !== 'SUPER_ADMIN') {
          throw new PaperError(404, 'NOT_FOUND', 'not found')
        }
        send(res, 200, await service.verifyBlueprint(id))
        return
      }

      /* --- 试卷任务 --- */
      if (method === 'GET' && path === '/jobs') {
        send(res, 200, service.listJobs(
          (url.searchParams.get('status') ?? undefined) as never, schoolScopeOf(actor),
        ).filter(job => canManagePaperRecord(actor, job)))
        return
      }
      if (method === 'POST' && path === '/jobs') {
        const input = parse<{ blueprintId: string; request: PaperRequest }>(jobCreateWire, await readJson(req))
        send(res, 201, await service.createJob({ ...input, schoolId: schoolScopeOf(actor) }))
        return
      }
      if (method === 'GET' && seg[0] === 'jobs' && seg.length === 2) {
        send(res, 200, jobForActor(segment(seg, 1)))
        return
      }
      if (method === 'PUT' && seg[0] === 'jobs' && seg[2] === 'spec') {
        const id = segment(seg, 1)
        jobForActor(id)
        const body = await readJson(req) as Body
        send(res, 200, await service.confirmSpec(id, parse(specTableWire, body['specTable'])))
        return
      }
      /* Live assembly preview: how the confirmed spec table would be served
         by the bank right now — per-row mode, candidate count, chosen item.
         Recomputed on each call so bank edits show immediately. */
      if (method === 'GET' && seg[0] === 'jobs' && seg[2] === 'bank-plan') {
        const job = jobForActor(segment(seg, 1))
        const plans = service.bankPlanFor(job.specTable, job.request, deps.bankPolicy, job.schoolId)
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
        const id = segment(seg, 1)
        jobForActor(id)
        void deps.runDraft(id).catch((error: unknown) => {
          console.error(`[paper-host] draft ${seg[1]} failed:`, error)
        })
        send(res, 202, { status: 'drafting' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'check') {
        const id = segment(seg, 1)
        jobForActor(id)
        void deps.runChecks(id).catch((error: unknown) => {
          console.error(`[paper-host] check ${seg[1]} failed:`, error)
        })
        send(res, 202, { status: 'checking' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'repair') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        const body = await readJson(req) as Body
        const suggestion = str(body, 'suggestion')
        if (suggestion === '') throw new PaperError(400, 'BAD_REQUEST', 'repair needs a suggestion')
        void deps.runRepair(segment(seg, 1), Number(seg[3]), suggestion, actor.userKey).catch((error: unknown) => {
          console.error(`[paper-host] repair ${seg[1]}#${seg[3]} failed:`, error)
        })
        send(res, 202, { status: 'repairing' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'replace') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        await readJson(req)
        /* Validate first — a row with no spare candidate answers 404
           synchronously instead of vanishing into the async driver. */
        deps.planReplace(jobId, Number(seg[3]))
        void deps.runReplace(jobId, Number(seg[3]), actor.userKey).catch((error: unknown) => {
          console.error(`[paper-host] replace ${seg[1]}#${seg[3]} failed:`, error)
        })
        send(res, 202, { status: 'replacing' })
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'questions' && seg[4] === 'review') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        const body = await readJson(req) as Body
        send(res, 200, await service.reviewQuestion(
          jobId, Number(seg[3]),
          body['verdict'] === 'approved' ? 'approved' : 'changes-requested',
          actor.userKey,
          body['note'] as string | undefined,
        ))
        return
      }
      if (method === 'PUT' && seg[0] === 'jobs' && seg[2] === 'document') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        const body = await readJson(req) as Body
        send(res, 200, await service.commitDocument(
          jobId, parse<PaperDocument>(paperDocumentWire, body['document']), str(body, 'summary') || 'edit',
          typeof body['expectedVersion'] === 'number' ? body['expectedVersion'] : undefined,
        ))
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'approve') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        const body = await readJson(req) as Body
        send(res, 200, await service.approve(
          jobId, actor.userKey,
          body['subject'] === 'chemistry' ? 'chemistry' : 'physics',
        ))
        return
      }
      if (method === 'POST' && seg[0] === 'jobs' && seg[2] === 'export') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        send(res, 200, await deps.runExport(jobId))
        return
      }
      if (method === 'GET' && seg[0] === 'jobs' && seg[2] === 'files') {
        const jobId = segment(seg, 1)
        jobForActor(jobId)
        const name = decodeURIComponent(seg[3] ?? '')
        if (!FILE_NAMES.has(name) && !FIGURE_NAME.test(name)) throw new PaperError(404, 'NO_FILE', 'no such export file')
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
        const visibleJobs = new Set(service.listJobs(undefined, schoolScopeOf(actor))
          .filter(job => canManagePaperRecord(actor, job))
          .map(job => job.id))
        send(res, 200, service.listExports().filter(bundle => visibleJobs.has(bundle.paperId)))
        return
      }

      send(res, 404, { error: { code: 'NO_ROUTE', message: `${method} ${path}` } })
    } catch (error) {
      sendError(res, error)
    }
  }
}
