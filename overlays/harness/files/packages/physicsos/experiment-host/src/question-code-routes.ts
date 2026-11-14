import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError } from './identity.ts'
import type { QuestionCodeArtifactService, QuestionCodeIdentity } from './question-code-service.ts'
import type { QuestionCodeJobs } from './question-code-jobs.ts'
export const QUESTION_CODE_PREFIX = '/physicsos/question-code'

/** Browser-safe status view: no diagnostics, no source, no internal digests beyond the public hash. */
const projectJob = (job: import('./question-code-domain.ts').QuestionCodeJob) => ({
  jobId: job.id,
  status: job.status,
  sceneId: job.sceneId,
  sceneRevision: job.sceneRevision,
  resultSha256: job.resultSha256,
  code: job.code,
  message: job.message,
  attempts: job.attempts.map(attempt => ({
    index: attempt.index,
    status: attempt.status,
    finishedAt: attempt.finishedAt,
    code: attempt.code,
  })),
  validation: job.validation === undefined ? undefined : {
    passed: job.validation.passed,
    checks: job.validation.checks.map(check => ({ name: check.name, passed: check.passed })),
    finishedAt: job.validation.finishedAt,
  },
  updatedAt: job.updatedAt,
})

export function questionCodeRoutes({
  service,
  identity,
  jobs,
  validator,
}: {
  service: QuestionCodeArtifactService
  identity: () => QuestionCodeIdentity | undefined
  jobs?: QuestionCodeJobs
  /** Ticket-scoped frozen-package serving for the isolated validator. */
  validator?: {
    /** Redeem the ticket for this exact digest/path; undefined means refuse. */
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
        res.writeHead(200, { 'content-type': file.contentType, 'content-length': file.bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
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
      const jobMatch = /^\/physicsos\/question-code\/jobs\/([A-Za-z0-9_.:-]{1,200})$/.exec(url.pathname)
      if (jobMatch?.[1] !== undefined) {
        if (req.method !== 'GET') { send(404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
        if (jobs === undefined) throw new ExperimentError(503, 'JOBS_UNAVAILABLE', '生成任务服务尚未就绪。')
        try {
          send(200, { job: projectJob(jobs.get(jobMatch[1], actor.userKey)) })
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
      else send(500, { error: { code: 'INTERNAL', message: 'internal error' } })
    }
  }
}
