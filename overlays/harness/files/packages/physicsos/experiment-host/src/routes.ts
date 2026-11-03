import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError, guard, auditWrites, type PhysicsosIdentity } from './identity.ts'
import { ASSET_PREFIX, type ExperimentService } from './service.ts'
import { inlineImportMapHashes } from './archive.ts'
import { experimentWrapper } from './embed.ts'
import { experimentCatalog, experimentProfile } from './contract-v3.ts'
import type { QuestionCodeArtifactService } from './question-code-service.ts'

const JSON_LIMIT = Math.ceil((20 * 1024 * 1024) / 3) * 4 + 400_000
export interface RouteDeps {
  service: ExperimentService
  identity: () => PhysicsosIdentity | undefined
}
export interface AssetDeps {
  service: ExperimentService
  questionCodes?: QuestionCodeArtifactService
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
const errorResponse = (res: ServerResponse, error: unknown): void => {
  if (error instanceof ExperimentError)
    send(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
    })
  else send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}
function checkCsrf(req: IncomingMessage): void {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
    throw new ExperimentError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type 必须为 application/json')
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (origin !== new URL(origin).origin || origin !== requestOrigin(req))
        throw new Error('cross-site')
    } catch {
      throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝')
    }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝')
}
/** Bound accumulated JSON even for a chunked request; drain excess without buffering. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length']) > JSON_LIMIT) {
    req.resume()
    throw new ExperimentError(413, 'BODY_TOO_LARGE', '请求体过大')
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const clean = () => {
      req.off('data', data)
      req.off('end', end)
      req.off('error', failed)
      req.off('aborted', aborted)
    }
    const failed = () => {
      clean()
      reject(new ExperimentError(400, 'BAD_REQUEST', '请求体读取失败'))
    }
    const aborted = () => {
      failed()
    }
    const data = (chunk: Buffer) => {
      total += chunk.length
      if (total > JSON_LIMIT) {
        clean()
        req.resume()
        reject(new ExperimentError(413, 'BODY_TOO_LARGE', '请求体过大'))
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      clean()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new ExperimentError(400, 'BAD_REQUEST', '请求体不是合法 JSON'))
      }
    }
    req.on('data', data)
    req.once('end', end)
    req.once('error', failed)
    req.once('aborted', aborted)
  })
}
/** The authenticated API. Identity is deliberately resolved for each request. */
export function experimentRoutes({
  service,
  identity: identityOf,
}: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local'),
        path = url.pathname
      const method = req.method ?? 'GET'
      if (method === 'GET' && path === '/physicsos/experiments/catalog') {
        send(res, 200, { items: experimentCatalog })
        return
      }
      const download = /^\/physicsos\/experiments\/([a-z0-9-]+)\/(template|developer-prompt)$/.exec(
        path,
      )
      if (method === 'GET' && download?.[1]) {
        if (!experimentProfile(download[1]))
          throw new ExperimentError(404, 'NOT_FOUND', '实验模板未注册')
        const { buildExperimentTemplate, experimentDeveloperPrompt } =
          await import('./template-download.ts')
        if (download[2] === 'template') {
          const artifact = await buildExperimentTemplate(download[1])
          res.writeHead(200, {
            'content-type': 'application/zip',
            'content-length': artifact.bytes.length,
            'content-disposition': `attachment; filename="${artifact.filename}"`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            etag: `"${artifact.sha256}"`,
          })
          res.end(artifact.bytes)
        } else {
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="AGENTS.md"',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
          })
          res.end(experimentDeveloperPrompt(download[1]))
        }
        return
      }
      const identity = identityOf()
      const target = /^\/physicsos\/experiments\/([a-z0-9-]+)(?:\/(packages|rollback))?$/.exec(path)
      const floor = method === 'POST' && target?.[2] === 'packages' ? 'STUDENT' : 'SUPER_ADMIN'
      const { actor, writes } = guard(identity, req, floor)
      if (writes) checkCsrf(req)
      if (writes && identity)
        res.once('finish', () => {
          void auditWrites(identity, actor, req, res.statusCode, path).catch(() => {
            console.error('[experiment-host] audit write failed')
          })
        })
      if (method === 'GET' && path === '/physicsos/experiments/review-queue') {
        send(res, 200, service.reviewQueue(actor))
        return
      }
      if (method === 'GET' && target?.[1] && !target[2]) {
        send(res, 200, service.list(actor, target[1]))
        return
      }
      if (method === 'POST' && target?.[1] && target[2] === 'packages') {
        send(res, 201, { item: await service.upload(actor, await readJson(req), target[1]) })
        return
      }
      const archive = /^\/physicsos\/experiments\/packages\/([^/]+)\/archive$/.exec(path)
      if (method === 'GET' && archive?.[1]) {
        const bytes = await service.archive(actor, archive[1])
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': bytes.length,
          'content-disposition': `attachment; filename="${service.archiveFilename(actor, archive[1])}"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        })
        res.end(bytes)
        return
      }
      const preview = /^\/physicsos\/experiments\/packages\/([^/]+)\/preview$/.exec(path)
      if (method === 'GET' && preview?.[1]) {
        send(res, 200, await service.preview(actor, preview[1]))
        return
      }
      const review = /^\/physicsos\/experiments\/packages\/([^/]+)\/review$/.exec(path)
      if (method === 'POST' && review?.[1]) {
        send(res, 200, { item: await service.review(actor, review[1], await readJson(req)) })
        return
      }
      if (method === 'POST' && target?.[1] && target[2] === 'rollback') {
        send(res, 200, { item: await service.rollback(actor, await readJson(req), target[1]) })
        return
      }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) {
      errorResponse(res, error)
    }
  }
}
function requestOrigin(req: IncomingMessage, configured?: string): string {
  if (configured) return configured
  const forwarded = req.headers['x-forwarded-proto'],
    protocol = forwarded === 'https' ? 'https:' : 'http:'
  return new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin
}
/** Separate export for a dedicated uncredentialed resource origin deployment. */
export function experimentAssets({
  service,
  questionCodes,
}: AssetDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // These headers also cover error responses and direct navigation.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
    res.setHeader('cross-origin-resource-policy', 'cross-origin')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('cache-control', 'no-store')
    res.setHeader(
      'content-security-policy',
      "sandbox allow-scripts; default-src 'none'; base-uri 'none'; form-action 'none'",
    )
    try {
      const url = new URL(req.url ?? '/', 'http://local')
      if (!url.pathname.startsWith(`${ASSET_PREFIX}/`)) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
        return
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } })
        return
      }
      const embedded = url.pathname.startsWith(`${ASSET_PREFIX}/embed/`)
      const raw = embedded
        ? new URL(
            url.pathname.replace(`${ASSET_PREFIX}/embed/`, `${ASSET_PREFIX}/`),
            requestOrigin(req, service.assetOrigin),
          )
        : url
      const asset = raw.pathname.startsWith(`${ASSET_PREFIX}/question/`)
        ? await questionCodes?.asset(raw)
        : await service.asset(raw)
      if (!asset) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
        return
      }
      if (embedded) {
        if (
          !raw.pathname.endsWith('/dist/index.html') ||
          !asset.contentType.startsWith('text/html')
        ) {
          send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
          return
        }
        const wrapper = experimentWrapper(raw, asset.protocolVersion)
        res.setHeader('content-security-policy', wrapper.csp)
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': wrapper.bytes.length,
          'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : wrapper.bytes)
        return
      }
      if (asset.contentType.startsWith('text/html') || asset.contentType === 'image/svg+xml')
        res.setHeader('vary', 'Sec-Fetch-Dest, Sec-Fetch-Site')
      if (
        asset.contentType.startsWith('text/html') ||
        (asset.contentType === 'image/svg+xml' && req.headers['sec-fetch-dest'] !== 'image')
      ) {
        if (
          req.headers['sec-fetch-dest'] !== 'iframe' ||
          req.headers['sec-fetch-site'] !== 'same-origin'
        )
          throw new ExperimentError(403, 'RAW_DOCUMENT_REFUSED', '请通过平台隔离预览入口打开实验')
      }
      const scope = `${requestOrigin(req, service.assetOrigin)}${asset.scopePath}`
      const hashes = asset.contentType.startsWith('text/html')
        ? inlineImportMapHashes(asset.bytes)
        : []
      res.setHeader(
        'content-security-policy',
        [
          'sandbox allow-scripts',
          "default-src 'none'",
          `script-src ${[scope, ...hashes].join(' ')}`,
          "script-src-attr 'none'",
          `style-src ${scope} 'unsafe-inline'`,
          `img-src ${scope} data: blob:`,
          `font-src ${scope}`,
          `media-src ${scope}`,
          `connect-src ${scope}`,
          "worker-src 'none'",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; '),
      )
      res.writeHead(200, {
        'content-type': asset.contentType,
        'content-length': asset.bytes.length,
        'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store',
        etag: `"${asset.sha256}"`,
      })
      res.end(req.method === 'HEAD' ? undefined : asset.bytes)
    } catch (error) {
      errorResponse(res, error)
    }
  }
}
