/** Website HTTP routes, kept separate from the existing tenant feedback contract. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { guard, NoticeError, type PhysicsosIdentity } from './identity.ts'
import { clientAddress, requestScheme } from './website-proxy.ts'
import { requireWebsiteAdmin, type WebsiteService } from './website-service.ts'

interface LimiterPolicy {
  readonly name: string
  readonly limit: number
  readonly windowMs: number
  readonly maxBuckets: number
}
export interface WebsiteLimiter {
  consume(policy: LimiterPolicy, key: string): boolean | Promise<boolean>
}
export interface WebsiteRouteDeps {
  service: WebsiteService
  identity: () => PhysicsosIdentity | undefined
  limiter: () => unknown
  trustedProxies: readonly string[]
}
const IP_POLICY: LimiterPolicy = { name: 'website-feedback-ip', limit: 3, windowMs: 10 * 60_000, maxBuckets: 10_000 }
const GLOBAL_POLICY: LimiterPolicy = { name: 'website-feedback-global', limit: 60, windowMs: 60 * 60_000, maxBuckets: 1 }
const dependencyError = () => new NoticeError(503, 'DEPENDENCY_UNAVAILABLE', '反馈服务暂不可用，请稍后重试')

async function consumeBudget(value: unknown, key: string): Promise<void> {
  if (typeof value !== 'object' || value === null || !('consume' in value) || typeof value.consume !== 'function') throw dependencyError()
  const limiter = value as WebsiteLimiter
  try {
    for (const [policy, bucket] of [[IP_POLICY, key], [GLOBAL_POLICY, 'all']] as const) {
      const allowed = await limiter.consume(policy, bucket)
      if (allowed === false) throw new NoticeError(429, 'RATE_LIMITED', '提交过于频繁，请稍后再试')
      if (allowed !== true) throw dependencyError()
    }
  } catch (error) {
    if (error instanceof NoticeError) throw error
    throw dependencyError()
  }
}

function checkJsonOrigin(req: IncomingMessage, trustedProxies: readonly string[]): void {
  const type = req.headers['content-type']
  if (typeof type !== 'string' || type.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new NoticeError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      const parsed = typeof origin === 'string' ? new URL(origin) : undefined
      if (parsed === undefined || !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username !== '' || parsed.password !== '' || parsed.host !== req.headers.host
        || (requestScheme(req, trustedProxies) === 'https' && parsed.protocol !== 'https:')) {
        throw new Error('origin mismatch')
      }
    } catch { throw new NoticeError(403, 'FORBIDDEN', '跨站请求被拒绝') }
  }
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && !['same-origin', 'same-site', 'none'].includes(site)) throw new NoticeError(403, 'FORBIDDEN', '跨站请求被拒绝')
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new NoticeError(413, 'BODY_TOO_LARGE', '请求体过大')
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as string)
    size += chunk.length
    if (size > limit) throw new NoticeError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new NoticeError(400, 'BAD_REQUEST', '请求体不是合法 JSON') }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Return false only for paths belonging to the existing notice router. */
export async function handleWebsiteRoute(
  deps: WebsiteRouteDeps, req: IncomingMessage, res: ServerResponse, url: URL, path: string,
): Promise<boolean> {
  const method = req.method ?? 'GET'
  const seg = path.split('/').filter(Boolean)
  const publicContent = path === '/public/website'
  const publicFeedback = path === '/public/website-feedback'
  const management = seg[0] === 'website' || seg[0] === 'website-feedback'
  if (!publicContent && !publicFeedback && !management) return false

  if (publicContent && method === 'GET') {
    send(res, 200, deps.service.getPublicContent())
    return true
  }
  if (publicFeedback && method === 'POST') {
    checkJsonOrigin(req, deps.trustedProxies)
    await consumeBudget(deps.limiter(), clientAddress(req, deps.trustedProxies))
    send(res, 201, await deps.service.submitFeedback(await readJson(req, 22 * 1024 * 1024)))
    return true
  }
  if (!management) {
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    return true
  }

  // actorOf exposes the account role but omits API-token scope. Management
  // mutations therefore require the browser's cookie session, even when an
  // Authorization header accompanies an otherwise valid session cookie.
  if (method !== 'GET' && method !== 'HEAD' && req.headers.authorization !== undefined) {
    throw new NoticeError(403, 'TOKEN_SCOPE_REQUIRED', '官网管理写入需要 Cookie 登录会话，不接受 Authorization 令牌')
  }
  const identity = deps.identity()
  const { actor, writes } = guard(identity, req, 'SUPER_ADMIN')
  requireWebsiteAdmin(actor)
  if (writes) {
    checkJsonOrigin(req, deps.trustedProxies)
    if (identity !== undefined) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return
        // Action, endpoint and status only: no feedback text, contact, filenames or image bytes.
        void identity.record(actor, `notice.website.${method.toLowerCase()}`, path, { status: res.statusCode })
          .catch(() => { console.error('[notice-host] website audit failed') })
      })
    }
  }
  if (method === 'GET' && path === '/website') {
    send(res, 200, { content: deps.service.getContent(actor) })
  } else if (method === 'PUT' && path === '/website') {
    send(res, 200, { content: await deps.service.updateContent(actor, await readJson(req)) })
  } else if (method === 'GET' && path === '/website-feedback') {
    send(res, 200, deps.service.listFeedback(actor, url.searchParams))
  } else if (method === 'POST' && seg.length === 3 && seg[0] === 'website-feedback' && seg[2] === 'reply' && seg[1] !== undefined) {
    send(res, 200, { feedback: await deps.service.replyFeedback(actor, seg[1], await readJson(req)) })
  } else if (method === 'GET' && seg.length === 4 && seg[0] === 'website-feedback' && seg[2] === 'images' && seg[1] !== undefined && seg[3] !== undefined) {
    const image = await deps.service.readFeedbackImage(actor, seg[1], seg[3])
    res.writeHead(200, {
      'content-type': image.ref.mediaType,
      'content-length': image.data.byteLength,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    res.end(image.data)
  } else {
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
  }
  return true
}
