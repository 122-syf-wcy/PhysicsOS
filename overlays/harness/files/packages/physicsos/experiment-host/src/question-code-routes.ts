import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError } from './identity.ts'
import type { QuestionCodeArtifactService, QuestionCodeIdentity } from './question-code-service.ts'
export const QUESTION_CODE_PREFIX = '/physicsos/question-code'
export function questionCodeRoutes({
  service,
  identity,
}: {
  service: QuestionCodeArtifactService
  identity: () => QuestionCodeIdentity | undefined
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
