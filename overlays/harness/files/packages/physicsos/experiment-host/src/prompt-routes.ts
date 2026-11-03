/** Public published documents and SUPER_ADMIN management have separate access gates. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError, guard, type PhysicsosIdentity } from './identity.ts'
import type { DeveloperPromptService } from './prompt-service.ts'
import { renderPrompt, type PromptDocument } from './prompt-format.ts'

const LIMIT = 192 * 1024
const PREFIX = '/physicsos/developer-prompts'
export const PROMPT_MARKDOWN_ALIAS = '/physicsos/developers/downloads/AGENTS.md'
function markdown(req: IncomingMessage, res: ServerResponse, document: PromptDocument): void {
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
  const origin = new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin
  const body = renderPrompt(document, origin)
  res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': 'attachment; filename="AGENTS.md"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}
const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}
function csrf(req: IncomingMessage): void {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
    throw new ExperimentError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求须为 application/json。')
  const origin = req.headers.origin
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
  if (origin !== undefined) {
    try {
      if (
        new URL(origin).origin !== origin ||
        origin !== new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin
      )
        throw new Error('origin')
    } catch {
      throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝。')
    }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝。')
}
async function json(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length']) > LIMIT) {
    req.resume()
    throw new ExperimentError(413, 'BODY_TOO_LARGE', '提示词请求体过大。')
  }
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const clear = () => {
      req.off('data', data)
      req.off('end', end)
      req.off('error', failed)
      req.off('aborted', failed)
    }
    const failed = () => {
      clear()
      reject(new ExperimentError(400, 'BAD_REQUEST', '请求读取失败。'))
    }
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > LIMIT) {
        clear()
        req.resume()
        reject(new ExperimentError(413, 'BODY_TOO_LARGE', '提示词请求体过大。'))
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      clear()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new ExperimentError(400, 'BAD_REQUEST', '请求不是有效 JSON。'))
      }
    }
    req.on('data', data)
    req.once('end', end)
    req.once('error', failed)
    req.once('aborted', failed)
  })
}
export function developerPromptRoutes({
  service,
  identity,
}: {
  service: DeveloperPromptService
  identity: () => PhysicsosIdentity | undefined
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://local').pathname
      const method = req.method ?? 'GET'
      if (method === 'GET' && path === `${PREFIX}/template`) {
        res.writeHead(302, {
          location: service.current().binding.release.url,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end()
        return
      }
      if (method === 'GET' && (path === `${PREFIX}/current.md` || path === PROMPT_MARKDOWN_ALIAS)) {
        markdown(req, res, service.current())
        return
      }
      if (method === 'GET' && path === `${PREFIX}/current`) {
        send(res, 200, service.current())
        return
      }
      const published = new RegExp(`^${PREFIX}/versions/([^/]+)$`).exec(path)
      if (method === 'GET' && published?.[1]) {
        if (published[1].endsWith('.md'))
          markdown(req, res, service.published(published[1].slice(0, -3)))
        else send(res, 200, service.published(published[1]))
        return
      }
      const ledger = identity()
      const { actor, writes } = guard(ledger, req, 'SUPER_ADMIN')
      if (actor.role !== 'SUPER_ADMIN')
        throw new ExperimentError(403, 'FORBIDDEN', '仅平台管理员可管理开发提示词。')
      if (writes) csrf(req)
      if (method === 'GET' && path === `${PREFIX}/admin`) {
        send(res, 200, service.admin(actor))
        return
      }
      if (method === 'POST') {
        const action = path.slice(`${PREFIX}/admin/`.length)
        if (
          path.startsWith(`${PREFIX}/admin/`) &&
          ['draft', 'import', 'publish', 'activate'].includes(action)
        ) {
          const body = await json(req)
          const result =
            action === 'draft'
              ? await service.save(actor, body)
              : action === 'import'
                ? await service.import(actor, body)
                : action === 'publish'
                  ? await service.publish(actor, body)
                  : await service.activate(actor, body)
          if (ledger)
            void ledger
              .record(actor, `developer-prompts.${action}`, 'convex-lens', {
                revision: result.revision,
              })
              .catch(() => {
                console.error('[experiment-host] prompt audit write failed')
              })
          send(res, 200, result)
          return
        }
      }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) {
      if (error instanceof ExperimentError)
        send(res, error.status, { error: { code: error.code, message: error.message } })
      else send(res, 500, { error: { code: 'INTERNAL', message: '提示词操作失败，请稍后重试。' } })
    }
  }
}
