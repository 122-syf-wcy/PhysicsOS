import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError } from './identity.ts'
import type { QuestionCodeArtifactService, QuestionCodeIdentity } from './question-code-service.ts'
import { QuestionCodeJobError, type QuestionCodeJobs } from './question-code-jobs.ts'
import { ValidationWorkerError } from './question-code-validation.ts'
import type { IdentityActor } from './identity.ts'
export const QUESTION_CODE_PREFIX = '/physicsos/question-code'

/** Browser-safe status view: no diagnostics, no source, no internal digests beyond the public hash. */
const projectJob = (job: import('./question-code-domain.ts').QuestionCodeJob) => {
  // Original evidence remains stored/readable, but an older lease or unbound
  // historical report must not claim the current preview passed validation.
  const evidence = job.validation
  const validation = evidence !== undefined && evidence.leaseEpoch === job.leaseEpoch
    && evidence.sceneSha256 === job.sceneSha256 && evidence.sceneRevision === job.sceneRevision
    && evidence.candidateSha256 === job.attempts.at(-1)?.candidateSha256 && evidence.sourceRef !== undefined
    && (job.status === 'ready' ? job.resultRef === evidence.sourceRef && job.resultSha256 === evidence.candidateSha256
      : job.status === 'failed' && evidence.passed === false) ? evidence : undefined
  return {
    jobId: job.id,
    status: job.status,
    sceneId: job.sceneId,
    sceneRevision: job.sceneRevision,
    /** Canonical hash used to bind acceptance to the preview's frozen scene. */
    sceneSha256: job.sceneSha256,
    resultSha256: job.resultSha256,
    code: job.code,
    message: job.message,
    attempts: job.attempts.map(attempt => ({
      index: attempt.index,
      status: attempt.status,
      finishedAt: attempt.finishedAt,
      code: attempt.code,
    })),
    validation: validation === undefined ? undefined : {
      passed: validation.passed,
      checks: validation.checks.map(check => ({ name: check.name, passed: check.passed })),
      finishedAt: validation.finishedAt,
    },
    updatedAt: job.updatedAt,
  }
}

/** Same JSON/Origin/Fetch-Metadata policy as this host's existing writes. */
async function readValidationRetry(req: IncomingMessage): Promise<void> {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ExperimentError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type 必须为 application/json')
  }
  if (req.headers.origin !== undefined) {
    try {
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
      const origin = new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin
      if (req.headers.origin !== new URL(req.headers.origin).origin || req.headers.origin !== origin) throw new Error('cross-site')
    } catch { throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝') }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = chunk as Buffer
    size += bytes.length
    if (size > 1024) throw new ExperimentError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(bytes)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ExperimentError(400, 'BAD_REQUEST', '请求不是合法 JSON') }
  if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw new ExperimentError(400, 'BAD_REQUEST', '隔离重验仅接受空对象，不接受场景、代码或资源地址。')
  }
}

export function questionCodeRoutes({
  service,
  identity,
  jobs,
  retryValidation,
  validator,
}: {
  service: QuestionCodeArtifactService
  identity: () => QuestionCodeIdentity | undefined
  jobs?: QuestionCodeJobs
  /** Validate-only: existing owner-scoped candidate, no generation or client input. */
  retryValidation?: (jobId: string, actor: IdentityActor) => Promise<import('./question-code-domain.ts').QuestionCodeJob>
  /** Ticket-scoped frozen-package serving for the isolated validator. */
  validator?: {
    /** Read within the active ticket's exact source/digest/path; undefined means refuse. */
    readonly packageFor: (input: { readonly ticket: string; readonly digest: string; readonly path: string }) => Promise<{ readonly bytes: Buffer; readonly contentType: string } | undefined>
    /**
     * The two platform-owned shell documents. They are not part of the frozen
     * candidate: the worker loads them, and they carry no account data.
     */
    readonly shell: (input: { readonly ticket: string; readonly digest: string; readonly kind: 'host' | 'wrapper' }) => Promise<Buffer | undefined>
  }
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      })
      res.end(JSON.stringify(body))
    }
    try {
      /* Validator package surface: no account cookie is involved. The
         ticket route is checked first and answers only for the exact digest
         it was minted for; every other path keeps the account rule below. */
      const url0 = new URL(req.url ?? '/', 'http://local')
      /* Shell documents first: `/shell/(host|wrapper).html` is the same
         ticket surface, but the path is not part of the frozen package. */
      const shellMatch = /^\/physicsos\/question-code\/validation\/([A-Za-z0-9_.-]{16,160})\/([a-f0-9]{64})\/shell\/(host|wrapper)\.html$/.exec(url0.pathname)
      if (shellMatch !== null) {
        const [, ticket = '', digest = '', kind = 'host'] = shellMatch
        if (req.method !== 'GET' || validator?.shell === undefined) { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        const bytes = await validator.shell({ ticket, digest, kind: kind === 'wrapper' ? 'wrapper' : 'host' })
        if (bytes === undefined) { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(bytes)
        return
      }
      const validatorMatch = /^\/physicsos\/question-code\/validation\/([A-Za-z0-9_.-]{16,160})\/([a-f0-9]{64})\/(.+)$/.exec(url0.pathname)
      if (validatorMatch !== null) {
        if (req.method !== 'GET' || validator === undefined) { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        const [, ticket, digest, rawPath] = validatorMatch
        if (ticket === undefined || digest === undefined || rawPath === undefined || rawPath.includes('..')) { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        const file = await validator.packageFor({ ticket, digest, path: rawPath })
        if (file === undefined) { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        // ES modules in the sandboxed inner frame send Origin:null. This
        // uncredentialed, ticket-scoped GET surface needs the same CORS rule
        // as the product's existing experiment-assets surface.
        res.writeHead(200, { 'content-type': file.contentType, 'content-length': file.bytes.length, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' })
        res.end(file.bytes)
        return
      }
      const seam = identity()
      if (!seam || typeof seam.sessionOwnerKey !== 'function')
        throw new ExperimentError(503, 'IDENTITY_UNAVAILABLE', '账号归属服务尚未就绪。')
      const actor = seam.actorOf(req)
      if (!actor) throw new ExperimentError(401, 'UNAUTHENTICATED', '未登录或会话已失效。')
      const url = new URL(req.url ?? '/', 'http://local'),
        match =
          /^\/physicsos\/question-code\/artifacts\/(qcode_[a-f0-9]{32})\/(preview|source)$/.exec(
            url.pathname,
          )
      /* Owner-scoped status of a background generation. It never exposes
         diagnostics or candidate digests the browser cannot already see. */
      const retryMatch = /^\/physicsos\/question-code\/jobs\/([A-Za-z0-9_.:-]{1,200})\/validate$/.exec(url.pathname)
      if (retryMatch?.[1] !== undefined) {
        if (req.method !== 'POST') { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        await readValidationRetry(req)
        if (jobs === undefined || retryValidation === undefined) throw new ExperimentError(503, 'JOBS_UNAVAILABLE', '隔离验收服务尚未就绪。')
        const job = jobs.get(retryMatch[1], actor.userKey)
        if (seam.sessionOwnerKey(job.ownerSessionId) !== actor.userKey) throw new ExperimentError(404, 'NOT_FOUND', '未找到该生成任务。')
        const result = await retryValidation(job.id, actor)
        if (seam.sessionOwnerKey(result.ownerSessionId) !== actor.userKey || result.ownerKey !== actor.userKey) {
          throw new ExperimentError(404, 'NOT_FOUND', '未找到该生成任务。')
        }
        await seam.record(actor, 'question-code.validate', job.id, { status: result.status })
        send(200, { job: projectJob(result) })
        return
      }
      const jobMatch = /^\/physicsos\/question-code\/jobs\/([A-Za-z0-9_.:-]{1,200})$/.exec(url.pathname)
      if (jobMatch?.[1] !== undefined) {
        if (req.method !== 'GET') { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        if (jobs === undefined) throw new ExperimentError(503, 'JOBS_UNAVAILABLE', '生成任务服务尚未就绪。')
        try {
          const job = jobs.get(jobMatch[1], actor.userKey)
          if (seam.sessionOwnerKey(job.ownerSessionId) !== actor.userKey) throw new ExperimentError(404, 'NOT_FOUND', '未找到该生成任务。')
          send(200, { job: projectJob(job) })
        } catch (error) {
          if (error instanceof Error && (error as { code?: string }).code === 'NOT_FOUND') throw new ExperimentError(404, 'NOT_FOUND', '未找到该生成任务。')
          throw error
        }
        return
      }
      if (req.method !== 'GET' || !match?.[1]) {
        send(404, { error: { code: 'NOT_FOUND', message: 'not found' } })
        return
      }
      const expected = url.searchParams.get('sha256') ?? undefined
      if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected))
        throw new ExperimentError(400, 'BAD_REQUEST', '实验引用摘要无效。')
      send(
        200,
        match[2] === 'source'
          ? await service.source(actor, match[1], expected)
          : service.preview(actor, match[1], expected),
      )
    } catch (error) {
      if (error instanceof ExperimentError)
        send(error.status, { error: { code: error.code, message: error.message } })
      else if (error instanceof QuestionCodeJobError)
        send(error.code === 'NOT_FOUND' ? 404 : 409, { error: { code: error.code, message: error.message } })
      else if (error instanceof ValidationWorkerError)
        send(503, { error: { code: error.code, message: error.message } })
      else send(500, { error: { code: 'INTERNAL', message: 'internal error' } })
    }
  }
}
